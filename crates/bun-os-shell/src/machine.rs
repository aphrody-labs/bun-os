//! Bun Engine machines in the shell. The engine runtime (`bun_engine::runtime`) owns the running
//! machine (`MachineSlot`, `MachineStatus`, `MachineScreen`, run in `FixedUpdate`); this module
//! builds the factory for `InsertMachine` (with the suspend state restored before the first
//! frame) and keeps the on-disk suspend states.

use std::path::{Path, PathBuf};

use bun_engine::machine::Machine;

/// What the shell shows about the running machine (HUD, quick menu).
#[derive(Default, Clone, Debug)]
pub struct Info {
    pub name: String,
    pub refresh: f64,
    pub frames: u64,
    /// Measured emulation rate over the last second.
    pub fps: f32,
    pub paused: bool,
    pub resumed_from_disk: bool,
    pub error: Option<String>,
}

/// A machine factory for `InsertMachine`: builds the core from the image and restores `state`
/// (a previous `Machine::save_state`) before the first frame.
pub fn factory(
    system: String,
    image: PathBuf,
    bios: Option<PathBuf>,
    state: Option<Vec<u8>>,
) -> impl FnOnce() -> Result<Box<dyn Machine>, String> + Send + 'static {
    move || {
        let rom = std::fs::read(&image).map_err(|e| format!("{}: {e}", image.display()))?;
        let mut machine: Box<dyn Machine> = match system.as_str() {
            "nes" => Box::new(bun_engine::machine::nes::Nes::from_rom(
                &image.to_string_lossy(),
                &rom,
            )?),
            "gba" => Box::new(bun_engine::machine::gba::Gba::from_rom(&rom, None)?),
            "psx" => {
                let bios = bios
                    .ok_or("PlayStation needs the free OpenBIOS: bep add free-firmware openbios")?;
                let bios = std::fs::read(bios).map_err(|e| e.to_string())?;
                Box::new(bun_engine::machine::psx::Psx::new(&bios, &rom)?)
            }
            "nds" => Box::new(bun_engine::machine::handheld::HandheldMachine::from_path(
                &image,
            )?),
            other => return Err(format!("no in-process machine for `{other}`")),
        };
        if let Some(state) = state.as_deref()
            && let Err(e) = machine.load_state(state)
        {
            eprintln!("bun-os-shell: resume failed, starting fresh: {e}");
        }
        Ok(machine)
    }
}

/// On-disk suspend state of a game: `<slug>.state` plus a `<slug>.png` thumbnail.
pub struct Suspended {
    pub state: PathBuf,
    pub thumb: PathBuf,
}

impl Suspended {
    pub fn of(dir: &Path, key: &str) -> Self {
        let slug = crate::paths::Paths::slug(key);
        Self {
            state: dir.join(format!("{slug}.state")),
            thumb: dir.join(format!("{slug}.png")),
        }
    }

    pub fn exists(&self) -> bool {
        self.state.is_file()
    }

    pub fn write(&self, state: &[u8], frame: Option<(u32, u32, Vec<u8>)>) -> std::io::Result<()> {
        std::fs::write(&self.state, state)?;
        if let Some((w, h, rgba)) = frame
            && let Some(img) = image::RgbaImage::from_raw(w, h, rgba)
        {
            let _ = img.save(&self.thumb);
        }
        Ok(())
    }

    pub fn discard(&self) {
        let _ = std::fs::remove_file(&self.state);
        let _ = std::fs::remove_file(&self.thumb);
    }
}
