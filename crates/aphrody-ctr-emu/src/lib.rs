//! Nintendo 3DS emulation core.
//!
//! The crate is the single Bun OS owner of the 3DS machine, shaped like the Dust DS core: an
//! [`Emu`] built from a [`Builder`], stepped one frame at a time, fed [`Input`], and read back as
//! [`Video`], PCM audio, saved states and [`Debug`] views. Execution is high-level emulated, the
//! way libctru homebrew and retail titles see the console: an ARM11 MPCore interpreter (ARMv6K +
//! VFP11), the Horizon kernel SVCs, and the `srv`, `fs`, `gsp`, `hid`, `apt`, `cfg`, `dsp` and
//! further services, a PICA200 renderer and the DSP mixer, all provided by Zakuro
//! (`vendor/zakuro`, MIT). No firmware, boot ROM or key material is needed or accepted.
//!
//! Supported images: decrypted `.cxi`, `.cci`/`.3ds` and `.cia`, and homebrew `.3dsx`
//! ([`homebrew::cxi_from_3dsx`] wraps it as a NoCrypto CXI).

pub mod homebrew;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use zakuro_common::Screen;
use zakuro_core::services::hid::InputState;
use zakuro_core::{Config, FrameOutcome, System, loader};

pub use zakuro_core::CYCLES_PER_FRAME;
pub use zakuro_core::services::hid::PadState as Buttons;

/// ARM11 clock in hertz.
pub const CPU_CLOCK_HZ: f64 = 268_111_856.0;
/// Screen refresh rate in hertz (about 59.83).
pub const REFRESH_RATE: f64 = CPU_CLOCK_HZ / CYCLES_PER_FRAME as f64;
/// DSP output rate in hertz (the ARM11 clock divided by 8192).
pub const AUDIO_SAMPLE_RATE: f64 = zakuro_core::AUDIO_SAMPLE_RATE;
/// Top screen size in pixels.
pub const TOP_SIZE: (u32, u32) = (400, 240);
/// Bottom (touch) screen size in pixels.
pub const BOTTOM_SIZE: (u32, u32) = (320, 240);

/// Console model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Model {
    /// Original 3DS, 3DS XL and 2DS.
    #[default]
    Old3ds,
    /// New 3DS family (higher clock, extra buttons).
    New3ds,
}

/// Console region reported by the configuration service.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Region {
    Japan = 0,
    #[default]
    Usa = 1,
    Europe = 2,
}

/// Failure to boot or restore a title.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(pub String);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

type Result<T> = std::result::Result<T, Error>;

fn err(context: &str, error: impl std::fmt::Display) -> Error {
    Error(format!("{context}: {error}"))
}

/// Console settings and boot options.
#[derive(Debug, Clone)]
pub struct Builder {
    model: Model,
    region: Region,
    language: u8,
    slider_3d: f32,
    username: String,
    data_dir: Option<PathBuf>,
    clock: Option<u64>,
    skip_idle_loops: bool,
}

impl Default for Builder {
    fn default() -> Self {
        Self {
            model: Model::default(),
            region: Region::default(),
            language: zakuro_core::services::cfg::LANGUAGE_ENGLISH,
            slider_3d: 0.0,
            username: "Bun OS".into(),
            data_dir: None,
            clock: None,
            skip_idle_loops: true,
        }
    }
}

impl Builder {
    pub fn model(mut self, model: Model) -> Self {
        self.model = model;
        self
    }

    pub fn region(mut self, region: Region) -> Self {
        self.region = region;
        self
    }

    /// System language index as stored in the CFG block (0 Japanese, 1 English, ...).
    pub fn language(mut self, language: u8) -> Self {
        self.language = language;
        self
    }

    /// 3D depth slider position, 0.0 (off) to 1.0.
    pub fn slider_3d(mut self, value: f32) -> Self {
        self.slider_3d = value.clamp(0.0, 1.0);
        self
    }

    /// Owner name (at most ten characters) titles display.
    pub fn username(mut self, name: impl Into<String>) -> Self {
        self.username = name.into();
        self
    }

    /// Directory holding save data, the emulated SD card and mods.
    pub fn data_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.data_dir = Some(dir.into());
        self
    }

    /// Fixes the console clock (milliseconds since 1900) so runs repeat exactly.
    pub fn clock(mut self, millis_since_1900: u64) -> Self {
        self.clock = Some(millis_since_1900);
        self
    }

    /// Lets the interpreter skip to the next event past loops that change nothing.
    pub fn skip_idle_loops(mut self, skip: bool) -> Self {
        self.skip_idle_loops = skip;
        self
    }

    fn config(&self) -> Config {
        Config {
            model: match self.model {
                Model::Old3ds => zakuro_common::ConsoleModel::Old3ds,
                Model::New3ds => zakuro_common::ConsoleModel::New3ds,
            },
            new3ds: self.model == Model::New3ds,
            region: self.region as u8,
            language: self.language,
            slider_3d: self.slider_3d,
            username: self.username.clone(),
            data_dir: self.data_dir.clone(),
            clock: self.clock,
            skip_idle_loops: self.skip_idle_loops,
            ..Config::default()
        }
    }

    /// Boots an image held in memory: `.3dsx`, `.cxi`, `.cci`/`.3ds` or `.cia`.
    pub fn boot_bytes(self, name: &str, image: &[u8]) -> Result<Emu> {
        let bytes = if image.get(..4) == Some(b"3DSX") {
            homebrew::cxi_from_3dsx(image, name).map_err(Error)?
        } else {
            image.to_vec()
        };
        let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("cxi");
        let ext = if image.get(..4) == Some(b"3DSX") { "cxi" } else { ext };
        let tmp = std::env::temp_dir().join(format!("aphrody-ctr-{}-{}.{ext}", std::process::id(), name.len()));
        std::fs::write(&tmp, &bytes).map_err(|e| err("3DS", e))?;
        let loaded = loader::load(&tmp, self.config());
        let _ = std::fs::remove_file(&tmp);
        let system = loaded.map_err(|e| err("3DS", e))?;
        Ok(Emu::from_system(system))
    }

    /// Boots the image at `path`.
    pub fn boot(self, path: impl AsRef<Path>) -> Result<Emu> {
        let path = path.as_ref();
        let image = std::fs::read(path).map_err(|e| err(&path.display().to_string(), e))?;
        let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("title");
        self.boot_bytes(name, &image)
    }
}

/// Pad, circle pad, C-stick, touch and tilt state for one frame.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Input {
    pub buttons: Buttons,
    /// Circle pad, -1.0 to 1.0 per axis.
    pub circle: [f32; 2],
    /// C-stick (New 3DS), -1.0 to 1.0 per axis.
    pub c_stick: [f32; 2],
    /// Touch position in bottom-screen pixels (0..320, 0..240) when pressed.
    pub touch: Option<(u16, u16)>,
    /// Tilt away from upright in radians (right, bottom) for the motion sensors.
    pub tilt: [f32; 2],
}

/// One rendered screen, RGBA8, row-major, top-left origin.
#[derive(Debug, Clone)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Arc<Vec<u8>>,
}

/// Both screens of a frame; the right eye exists only while the title draws in stereo 3D.
#[derive(Debug, Clone)]
pub struct Video {
    pub top: Image,
    pub bottom: Image,
    pub top_right: Option<Image>,
}

/// How a frame ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Completed,
    /// The title called `svcExitProcess`.
    Exited,
    /// `svcBreak` or an undefined instruction; the text carries the last fatal error.
    Faulted(String),
}

/// A running 3DS.
pub struct Emu {
    system: Box<System>,
    console_read: usize,
}

impl Emu {
    pub fn builder() -> Builder {
        Builder::default()
    }

    fn from_system(system: System) -> Self {
        Self {
            system: Box::new(system),
            console_read: 0,
        }
    }

    /// Runs one screen refresh (about 59.83 per second).
    pub fn run_frame(&mut self) -> Frame {
        match self.system.run_frame() {
            FrameOutcome::Completed => Frame::Completed,
            FrameOutcome::Exited => Frame::Exited,
            FrameOutcome::Faulted => {
                Frame::Faulted(self.system.fatal_errors.last().cloned().unwrap_or_default())
            }
        }
    }

    /// Frames completed since boot.
    pub fn frames(&self) -> u64 {
        self.system.frames
    }

    pub fn set_input(&mut self, input: Input) {
        self.system.set_input(InputState {
            buttons: input.buttons,
            circle_x: input.circle[0],
            circle_y: input.circle[1],
            c_stick_x: input.c_stick[0],
            c_stick_y: input.c_stick[1],
            touch: input.touch,
            tilt: input.tilt,
        });
    }

    /// Moves the 3D depth slider, 0.0 to 1.0.
    pub fn set_slider_3d(&mut self, value: f32) {
        self.system.set_slider_3d(value.clamp(0.0, 1.0));
    }

    /// The current picture of both screens.
    pub fn video(&mut self) -> Video {
        let mut image = |screen| {
            let (rgba, width, height) = self.system.read_screen_scaled(screen);
            Image {
                width,
                height,
                rgba,
            }
        };
        let top = image(Screen::Top);
        let bottom = image(Screen::Bottom);
        let top_right = self
            .system
            .read_right_eye_scaled()
            .map(|(rgba, width, height)| Image {
                width,
                height,
                rgba,
            });
        Video {
            top,
            bottom,
            top_right,
        }
    }

    /// DSP output produced since the last call: stereo signed 16-bit PCM at
    /// [`AUDIO_SAMPLE_RATE`].
    pub fn take_audio(&mut self) -> Vec<[i16; 2]> {
        self.system.take_audio()
    }

    /// Text the guest wrote with `svcOutputDebugString` (libctru's debug console) since the
    /// last call.
    pub fn take_console(&mut self) -> String {
        let out = &self.system.debug_output;
        let new = out.get(self.console_read..).unwrap_or_default().to_owned();
        self.console_read = out.len();
        new
    }

    /// The whole console (CPU, memory, kernel, services, GPU) as a compressed saved state.
    pub fn save_state(&mut self) -> Result<Vec<u8>> {
        self.system.save_state().map_err(Error)
    }

    /// Restores a saved state taken from the same title. The console is untouched on failure.
    pub fn load_state(&mut self, state: &[u8]) -> Result<()> {
        self.system.load_state(state).map_err(Error)?;
        self.console_read = self.system.debug_output.len();
        Ok(())
    }

    /// Debugger view over the machine.
    pub fn debug(&mut self) -> Debug<'_> {
        Debug {
            system: &mut self.system,
        }
    }
}

/// ARM11 core register file as the debugger shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Registers {
    pub r: [u32; 16],
    pub cpsr: u32,
    pub spsr: u32,
}

/// Inspection and sampling hooks.
pub struct Debug<'a> {
    system: &'a mut System,
}

impl Debug<'_> {
    pub fn registers(&self) -> Registers {
        let cpu = &self.system.cpu;
        Registers {
            r: cpu.regs,
            cpsr: cpu.cpsr.to_bits(),
            spsr: cpu.spsr.to_bits(),
        }
    }

    /// Reads guest virtual memory; unmapped pages read as zero.
    pub fn read_memory(&mut self, address: u32, length: usize) -> Vec<u8> {
        let mut out = vec![0u8; length];
        self.system.memory.read_bytes(address, &mut out);
        out
    }

    pub fn read_u32(&mut self, address: u32) -> u32 {
        self.system.memory.peek32(address)
    }

    /// Addresses of the instructions executed most recently, oldest first.
    pub fn recent_instructions(&self) -> Vec<u32> {
        self.system.recent_instructions()
    }

    /// Starts the PC sampling profiler.
    pub fn enable_profiler(&mut self) {
        self.system.enable_profiler();
    }

    /// Hottest sampled locations as (thread, pc, hits).
    pub fn hot_spots(&self, count: usize) -> Vec<(String, u32, u64)> {
        self.system.hot_spots(count)
    }

    /// Errors the title reported through `err:f`, newest last.
    pub fn fatal_errors(&self) -> &[String] {
        &self.system.fatal_errors
    }

    /// Names of the services the title has opened.
    pub fn services_seen(&self) -> Vec<String> {
        self.system.services_seen.iter().cloned().collect()
    }

    /// SVC numbers the title called that the kernel does not implement.
    pub fn unimplemented_svcs(&self) -> Vec<u32> {
        self.system.unimplemented_svcs.iter().copied().collect()
    }

    /// One-line summary of the machine.
    pub fn status_line(&self) -> String {
        self.system.status_line()
    }
}
