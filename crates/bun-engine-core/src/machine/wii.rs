//! GameCube and Wii on the in-tree Gekko/Broadway interpreter (`aphrody-wii-runtime`).
//!
//! The machine boots a DOL directly (no IPL or system menu). Frames are read back from the
//! external framebuffer the guest scans out, so CPU-drawn output (homebrew consoles, direct XFB
//! writes) is shown; GX-rendered scenes need the GPU renderer and come out blank here.

use aphrody_wii_runtime::{GameCube, System, SystemId, Wii};

use super::{Machine, Screen, Step};

pub enum Console {
    GameCube(Box<GameCube>),
    Wii(Box<Wii>),
}

pub struct WiiMachine {
    console: Console,
}

impl WiiMachine {
    pub fn wii_dol(bytes: &[u8]) -> Result<Self, String> {
        let wii = Wii::with_dol(bytes).map_err(|e| format!("Wii DOL: {e:?}"))?;
        Ok(Self {
            console: Console::Wii(Box::new(wii)),
        })
    }

    pub fn gamecube_dol(bytes: &[u8]) -> Result<Self, String> {
        let gamecube = GameCube::with_dol(bytes).map_err(|e| format!("GameCube DOL: {e:?}"))?;
        Ok(Self {
            console: Console::GameCube(Box::new(gamecube)),
        })
    }
}

fn frame<const SYSTEM: SystemId>(system: &mut System<SYSTEM>) -> Step {
    system.run_until_vsync();
    Step::Frame
}

fn screen<const SYSTEM: SystemId>(system: &System<SYSTEM>) -> Screen {
    let (width, height) = system.frame_size();
    let mut rgb = Vec::with_capacity(width * height * 3);
    for px in system.render_xfb() {
        rgb.extend_from_slice(&[(px >> 16) as u8, (px >> 8) as u8, px as u8]);
    }
    Screen { width, height, rgb }
}

impl Machine for WiiMachine {
    fn name(&self) -> &'static str {
        match self.console {
            Console::GameCube(_) => "nintendo-gamecube",
            Console::Wii(_) => "nintendo-wii",
        }
    }

    fn run_frame(&mut self) -> Step {
        match &mut self.console {
            Console::GameCube(system) => frame(system),
            Console::Wii(system) => frame(system),
        }
    }

    fn screens(&self) -> Vec<Screen> {
        vec![match &self.console {
            Console::GameCube(system) => screen(system),
            Console::Wii(system) => screen(system),
        }]
    }
}
