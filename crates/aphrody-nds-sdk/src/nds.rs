//! Nintendo DS on the in-tree Dust core: interpreter CPUs, software 2D and 3D renderers, HLE BIOS
//! and a built-in default firmware, so direct boot needs no caller-supplied system file.

use std::{cell::RefCell, path::PathBuf, rc::Rc, sync::Arc};

use aphrody_dust_core::{
    Model, SaveContents, audio,
    cpu::interpreter::Interpreter,
    ds_slot::{self, spi::Spi},
    emu::{self, Emu, RunOutput, input::Keys},
    flash::Flash,
    gpu::{
        Scanline,
        engine_3d::{Polygon, RendererTx, RenderingState, ScreenVertex, SoftRendererRx},
    },
    rtc,
    spi::firmware,
    utils::{
        BoxedByteSlice, PersistentReadSavestate, PersistentWriteSavestate, ReadSavestate,
        WriteSavestate, mem_prelude::*,
    },
};
use aphrody_dust_soft_3d::{Renderer, RenderingData};

use crate::{
    Options, SaveType,
    format::Platform,
    handheld::{Handheld, Image, Input, Result, ScreenId, ScreenSpec, Step, button, err},
};

/// DS output: 32.768 kHz, 10-bit unsigned samples around the 0x200 bias.
const SAMPLE_RATE: u32 = 32_768;
/// 33.513982 MHz ARM7 bus / (355 dots * 263 lines * 6 cycles).
const REFRESH_RATE: f64 = 59.826_098_288_598_9;
const WIDTH: u32 = 256;
const HEIGHT: u32 = 192;
/// Main RAM base in the ARM9 address space.
const MAIN_RAM: u32 = 0x0200_0000;

/// Collects the mixer output for the host's audio sink.
struct Capture(Rc<RefCell<Vec<f32>>>);

impl audio::Backend for Capture {
    fn handle_sample_chunk(&mut self, samples: &mut Vec<[audio::OutputSample; 2]>) {
        let mut out = self.0.borrow_mut();
        // Keep at most two seconds queued when nobody drains it (headless runs).
        if out.len() > SAMPLE_RATE as usize * 4 {
            out.clear();
        }
        out.extend(
            samples
                .drain(..)
                .flat_map(|pair| pair.map(|s| (f32::from(s) - 512.0) / 512.0)),
        );
    }
}

struct Soft3d {
    data: Box<RenderingData>,
    renderer: Renderer,
    output: Box<[Scanline<u32>; 192]>,
}

struct Tx(Rc<RefCell<Soft3d>>);

struct Rx {
    shared: Rc<RefCell<Soft3d>>,
    line: usize,
    output: Scanline<u32>,
}

struct Renderers {
    two_d: Box<dyn aphrody_dust_core::gpu::engine_2d::Renderer>,
    three_d: Box<dyn RendererTx>,
    #[cfg(feature = "nds-gpu")]
    gpu: Option<GpuPresentation>,
}

#[cfg(feature = "nds-gpu")]
struct GpuPresentation {
    two_d: aphrody_dust_wgpu::render_2d::threaded::lockstep_scanlines::FrontendChannels,
    three_d: aphrody_dust_wgpu::render_3d::local::Frontend,
    view: aphrody_dust_wgpu::wgpu::TextureView,
    scale_shift: u8,
}

fn software_renderers() -> Renderers {
    let shared = Rc::new(RefCell::new(Soft3d {
        // The retained software data consists of integer/SIMD arrays; zero is valid.
        data: unsafe { Box::new_zeroed().assume_init() },
        renderer: Renderer::new(),
        output: unsafe { Box::new_zeroed().assume_init() },
    }));
    let rx = Rx {
        shared: shared.clone(),
        line: 0,
        output: Scanline([0; 256]),
    };
    Renderers {
        two_d: Box::new(aphrody_dust_soft_2d::sync::Renderer::new(Box::new(rx))),
        three_d: Box::new(Tx(shared)),
        #[cfg(feature = "nds-gpu")]
        gpu: None,
    }
}

impl RendererTx for Tx {
    fn set_capture_enabled(&mut self, _: bool) {}

    fn swap_buffers(
        &mut self,
        vertices: &[ScreenVertex],
        polygons: &[Polygon],
        state: &RenderingState,
    ) {
        self.0.borrow_mut().data.prepare(vertices, polygons, state);
    }

    fn repeat_last_frame(&mut self, state: &RenderingState) {
        self.0.borrow_mut().data.repeat_last_frame(state);
    }

    fn start_rendering(
        &mut self,
        texture: &Bytes<0x80000>,
        palette: &Bytes<0x18000>,
        state: &RenderingState,
    ) {
        let mut shared = self.0.borrow_mut();
        let Soft3d {
            data,
            renderer,
            output,
        } = &mut *shared;
        data.copy_vram(texture, palette, state);
        renderer.start_frame(data);
        renderer.render_line(0, data);
        for y in 0..192_u8 {
            if y < 191 {
                renderer.render_line(y + 1, data);
            }
            renderer.postprocess_line(y, &mut output[y as usize], data);
        }
    }

    fn skip_rendering(&mut self) {}
}

impl SoftRendererRx for Rx {
    fn start_frame(&mut self) {
        self.line = 0;
    }

    fn read_scanline(&mut self) -> &Scanline<u32> {
        self.output
            .0
            .copy_from_slice(&self.shared.borrow().output[self.line].0);
        self.line += 1;
        &self.output
    }

    fn skip_scanline(&mut self) {
        self.line += 1;
    }
}

/// A running Nintendo DS.
pub struct Nds {
    emu: Emu<Interpreter>,
    title: String,
    ended: bool,
    frames: u64,
    keys: Keys,
    touching: bool,
    samples: Rc<RefCell<Vec<f32>>>,
    images: [Image; 2],
    save_path: Option<PathBuf>,
    #[cfg(feature = "nds-gpu")]
    gpu: Option<GpuPresentation>,
}

/// Cartridge backup chip for a save size in bytes.
fn backup(size: usize, save: Option<BoxedByteSlice>) -> Result<Spi> {
    use ds_slot::spi::{Empty, eeprom_4k::Eeprom4k, eeprom_fram::EepromFram, flash::Flash};
    let contents = match save {
        Some(data) => SaveContents::Existing(data),
        None => SaveContents::New(size),
    };
    Ok(match size {
        0 => Empty::new().into(),
        0x200 => Eeprom4k::new(contents, None)
            .map_err(|e| err("eeprom", format!("{e:?}")))?
            .into(),
        0x2000 | 0x1_0000 | 0x2_0000 => EepromFram::new(contents, None)
            .map_err(|e| err("fram", format!("{e:?}")))?
            .into(),
        0x4_0000 | 0x8_0000 | 0x10_0000 => {
            let mut id = [0_u8; 20];
            let model = match size {
                0x4_0000 => 0x12,
                0x8_0000 => 0x13,
                _ => 0x14,
            };
            id[..3].copy_from_slice(&[0x20, 0x40, model]);
            Flash::new(contents, id, false)
                .map_err(|e| err("flash", format!("{e:?}")))?
                .into()
        }
        other => return Err(err("save", format!("unsupported backup size {other:#x}"))),
    })
}

impl Nds {
    /// Boots a cartridge image directly, without BIOS or firmware files.
    pub fn from_rom(rom: &[u8], options: &Options) -> Result<Self> {
        Self::from_rom_with_renderers(rom, options, software_renderers())
    }

    /// Boot on the existing host device, preserving software rasterization for guest display capture.
    #[cfg(feature = "nds-gpu")]
    pub fn from_rom_gpu(
        rom: &[u8],
        options: &Options,
        device: Arc<aphrody_dust_wgpu::wgpu::Device>,
        queue: Arc<aphrody_dust_wgpu::wgpu::Queue>,
        resolution_scale_shift: u8,
    ) -> Result<Self> {
        if resolution_scale_shift > 4 {
            return Err(err("DS GPU", "resolution scale must be between 1x and 16x"));
        }
        let (tx, rx, three_d) = aphrody_dust_wgpu::render_3d::local::init(
            Arc::clone(&device),
            Arc::clone(&queue),
            resolution_scale_shift,
        );
        let output = three_d.output_view();
        let next_view = three_d.clone();
        let (two_d, view, frontend) =
            aphrody_dust_wgpu::render_2d::threaded::lockstep_scanlines::Renderer::new(
                device,
                queue,
                resolution_scale_shift,
                aphrody_dust_wgpu::render_2d::Renderer3dRx::LocalAccel {
                    rx: Box::new(rx),
                    color_output_view: output,
                    new_color_output_view: Box::new(move || next_view.output_view()),
                },
            );
        Self::from_rom_with_renderers(
            rom,
            options,
            Renderers {
                two_d: Box::new(two_d),
                three_d: Box::new(tx),
                gpu: Some(GpuPresentation {
                    two_d: frontend,
                    three_d,
                    view,
                    scale_shift: resolution_scale_shift,
                }),
            },
        )
    }

    fn from_rom_with_renderers(
        rom: &[u8],
        options: &Options,
        renderers: Renderers,
    ) -> Result<Self> {
        let existing = options
            .save_path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .filter(|data| !data.is_empty());
        let size = match (&existing, options.save_type) {
            (Some(data), SaveType::Auto) => data.len(),
            (None, SaveType::Auto) => rom
                .get(0xC..0x10)
                .and_then(SaveType::known)
                .map_or(SaveType::DEFAULT_SIZE, SaveType::size),
            (_, other) => other.size(),
        };
        let existing = existing.filter(|data| data.len() == size).map(|data| {
            let mut bytes = BoxedByteSlice::new_zeroed(data.len());
            bytes.copy_from_slice(&data);
            bytes
        });
        let spi = backup(size, existing)?;

        // Cartridge chips are power-of-two sized; dumps and homebrew builds are often trimmed.
        // Pad with 0xFF (erased flash) like a real cartridge reads past the image.
        let padded = rom.len().max(0x200).next_power_of_two();
        let mut contents = BoxedByteSlice::new_zeroed(padded);
        contents[..rom.len()].copy_from_slice(rom);
        contents[rom.len()..].fill(0xFF);
        let flash = Flash::new(
            SaveContents::Existing(firmware::default(Model::Ds)),
            firmware::id_for_model(Model::Ds),
        )
        .map_err(|e| err("firmware", format!("{e:?}")))?;
        let samples = Rc::new(RefCell::new(Vec::new()));
        let builder = emu::Builder::new(
            flash,
            Some(Box::new(contents)),
            spi,
            Box::new(Capture(samples.clone())),
            None,
            Box::new(rtc::DummyBackend),
            renderers.two_d,
            renderers.three_d,
            None,
        );
        let emu = builder.build(Interpreter).map_err(|e| {
            let why = match e {
                emu::BuildError::MissingRom => "no ROM",
                emu::BuildError::MissingSysFiles => "BIOS files required",
                emu::BuildError::RomCreation(_) => "invalid ROM size",
                emu::BuildError::RomNeedsDecryptionButNoBiosProvided => {
                    "the secure area is encrypted and direct boot has no BIOS to decrypt it"
                }
            };
            err("DS", format!("the cartridge image is not bootable: {why}"))
        })?;
        let title = rom
            .get(..12)
            .map(|t| {
                String::from_utf8_lossy(t)
                    .trim_end_matches('\0')
                    .trim()
                    .to_owned()
            })
            .unwrap_or_default();
        let blank = || Image {
            width: WIDTH,
            height: HEIGHT,
            rgba: Arc::new(vec![0; (WIDTH * HEIGHT * 4) as usize]),
        };
        Ok(Self {
            emu,
            title,
            ended: false,
            frames: 0,
            keys: Keys::empty(),
            touching: false,
            samples,
            images: [blank(), blank()],
            save_path: options.save_path.clone(),
            #[cfg(feature = "nds-gpu")]
            gpu: renderers.gpu,
        })
    }

    fn capture(&mut self) {
        // The accelerated renderer owns a GPU texture; its framebuffer() CPU
        // adapter is intentionally unavailable. Guest display capture is handled
        // within the renderer itself, independently from host screenshots.
        #[cfg(feature = "nds-gpu")]
        if self.gpu.is_some() {
            return;
        }
        for (image, fb) in self
            .images
            .iter_mut()
            .zip(self.emu.gpu.renderer_2d().framebuffer().iter())
        {
            let mut rgba = Vec::with_capacity((WIDTH * HEIGHT * 4) as usize);
            for px in fb.iter().take((WIDTH * HEIGHT) as usize) {
                // The software renderer hands out RGBA8, red lowest, alpha unused.
                rgba.extend_from_slice(&[*px as u8, (*px >> 8) as u8, (*px >> 16) as u8, 0xFF]);
            }
            image.rgba = Arc::new(rgba);
        }
    }
}

fn keys_from(buttons: u32) -> Keys {
    const MAP: [(u32, Keys); 12] = [
        (button::A, Keys::A),
        (button::B, Keys::B),
        (button::SELECT, Keys::SELECT),
        (button::START, Keys::START),
        (button::RIGHT, Keys::RIGHT),
        (button::LEFT, Keys::LEFT),
        (button::UP, Keys::UP),
        (button::DOWN, Keys::DOWN),
        (button::R, Keys::R),
        (button::L, Keys::L),
        (button::X, Keys::X),
        (button::Y, Keys::Y),
    ];
    MAP.iter()
        .filter(|(bit, _)| buttons & bit != 0)
        .fold(Keys::empty(), |acc, (_, key)| acc | *key)
}

impl Handheld for Nds {
    fn platform(&self) -> Platform {
        Platform::Ds
    }

    fn title(&self) -> String {
        self.title.clone()
    }

    fn screens(&self) -> [ScreenSpec; 2] {
        [
            ScreenSpec {
                id: ScreenId::Top,
                width: WIDTH,
                height: HEIGHT,
            },
            ScreenSpec {
                id: ScreenId::Bottom,
                width: WIDTH,
                height: HEIGHT,
            },
        ]
    }

    fn refresh_rate(&self) -> f64 {
        REFRESH_RATE
    }

    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    fn run_frame(&mut self) -> Step {
        if self.ended {
            return Step::Shutdown;
        }
        match self.emu.run() {
            RunOutput::FrameFinished => {
                self.frames += 1;
                self.capture();
                // Persist backup writes about once per second.
                if self.frames % 60 == 0 {
                    let _ = self.flush_save();
                }
                Step::Frame
            }
            RunOutput::Shutdown => {
                self.ended = true;
                let _ = self.flush_save();
                Step::Shutdown
            }
        }
    }

    fn frames(&self) -> u64 {
        self.frames
    }

    fn image(&self, screen: ScreenId) -> Image {
        self.images[usize::from(screen == ScreenId::Bottom)].clone()
    }

    #[cfg(feature = "nds-gpu")]
    fn gpu_frame(&mut self) -> Option<crate::GpuFrame> {
        let gpu = self.gpu.as_mut()?;
        if let Some(view) = gpu.two_d.new_color_output_view() {
            gpu.view = view;
        }
        let gpu2d_submitted_frames = gpu.two_d.submitted_frames();
        let gpu3d_submitted_frames = gpu.three_d.submitted_frames();
        Some(crate::GpuFrame {
            texture: gpu.view.texture().clone(),
            view: gpu.view.clone(),
            width: WIDTH << gpu.scale_shift,
            height: (HEIGHT * 2) << gpu.scale_shift,
            submitted_frames: gpu2d_submitted_frames.saturating_add(gpu3d_submitted_frames),
            gpu2d_submitted_frames,
            gpu3d_submitted_frames,
        })
    }

    #[cfg(feature = "nds-gpu")]
    fn gpu_rendering(&self) -> bool {
        self.gpu.is_some()
    }

    fn set_input(&mut self, input: &Input) {
        let now = keys_from(input.buttons);
        let (pressed, released) = (now & !self.keys, self.keys & !now);
        if !pressed.is_empty() {
            self.emu.press_keys(pressed);
        }
        if !released.is_empty() {
            self.emu.release_keys(released);
        }
        self.keys = now;
        match input.touch {
            Some((x, y)) => {
                self.emu.set_touch_pos([x, y]);
                self.touching = true;
            }
            None if self.touching => {
                self.emu.end_touch();
                self.touching = false;
            }
            None => {}
        }
    }

    fn take_audio(&mut self, out: &mut Vec<f32>) {
        out.append(&mut self.samples.borrow_mut());
    }

    fn save_state(&mut self) -> Result<Vec<u8>> {
        let mut state = Vec::new();
        PersistentWriteSavestate::new(&mut state)
            .store(&mut self.emu)
            .map_err(|e| err("save state", format!("{e:?}")))?;
        Ok(state)
    }

    fn load_state(&mut self, state: &[u8]) -> Result<()> {
        let mut read =
            PersistentReadSavestate::new(state).map_err(|()| err("load state", "too large"))?;
        read.load_into(&mut self.emu)
            .map_err(|e| err("load state", format!("{e:?}")))?;
        self.capture();
        Ok(())
    }

    fn flush_save(&mut self) -> Result<()> {
        let Some(path) = &self.save_path else {
            return Ok(());
        };
        let spi = &mut self.emu.ds_slot.spi;
        if !spi.contents_dirty() {
            return Ok(());
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| err("save", e))?;
        }
        std::fs::write(path, spi.contents()).map_err(|e| err(&path.display().to_string(), e))?;
        spi.mark_contents_flushed();
        Ok(())
    }

    fn registers(&mut self) -> Vec<(String, u32)> {
        let regs = self.emu.arm9.regs();
        let mut out: Vec<(String, u32)> = regs
            .gprs
            .iter()
            .enumerate()
            .map(|(i, v)| (format!("r{i}"), *v))
            .collect();
        out.push(("cpsr".into(), self.emu.arm9.cpsr().raw()));
        out
    }

    fn read_memory(&mut self, address: u32, length: usize) -> Vec<u8> {
        // Main RAM (4 MiB mirrored through 0x02000000..0x03000000) is the debugger view.
        let mem = self.emu.main_mem();
        (0..length as u32)
            .map(|i| {
                let at = address.wrapping_add(i);
                if (MAIN_RAM..MAIN_RAM + 0x0100_0000).contains(&at) {
                    // SAFETY: the offset is masked to the 4 MiB the console maps.
                    unsafe { *mem.as_ptr().add((at & 0x3F_FFFF) as usize) }
                } else {
                    0
                }
            })
            .collect()
    }

    fn status(&mut self) -> String {
        let regs = self.emu.arm9.regs();
        format!(
            "DS \"{}\" arm9 pc={:08x} sp={:08x}",
            self.title,
            self.emu.arm9.r15(),
            regs.gprs[13]
        )
    }
}

impl Drop for Nds {
    fn drop(&mut self) {
        let _ = self.flush_save();
    }
}
