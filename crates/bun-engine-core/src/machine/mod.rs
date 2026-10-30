//! One `Machine` interface over every emulation core owned by Bun Engine.

#[cfg(feature = "arm")]
pub mod arm;
#[cfg(feature = "cpp-host")]
pub mod cpp_host;
#[cfg(feature = "gba")]
pub mod gba;
#[cfg(any(feature = "nds", feature = "ctr"))]
pub mod handheld;
#[cfg(feature = "libretro")]
pub mod libretro;
#[cfg(feature = "nes")]
pub mod nes;
#[cfg(feature = "psx")]
pub mod psx;
#[cfg(feature = "switch")]
pub mod switch;
#[cfg(feature = "wii")]
pub mod wii;
#[cfg(all(windows, feature = "x86"))]
pub mod x86;

/// Button bits shared by every machine, in DS/GBA order.
pub mod keys {
    pub const A: u32 = 1 << 0;
    pub const B: u32 = 1 << 1;
    pub const SELECT: u32 = 1 << 2;
    pub const START: u32 = 1 << 3;
    pub const RIGHT: u32 = 1 << 4;
    pub const LEFT: u32 = 1 << 5;
    pub const UP: u32 = 1 << 6;
    pub const DOWN: u32 = 1 << 7;
    pub const R: u32 = 1 << 8;
    pub const L: u32 = 1 << 9;
    pub const X: u32 = 1 << 10;
    pub const Y: u32 = 1 << 11;
}

/// The one input model: buttons plus a touch point on the second screen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Input {
    pub keys: u32,
    pub touch: Option<(u16, u16)>,
}

/// A 24-bit RGB image, row-major.
pub struct Screen {
    pub width: usize,
    pub height: usize,
    pub rgb: Vec<u8>,
}

/// A machine frame rendered on the host's existing WGPU device.
#[cfg(feature = "nds-gpu")]
pub use aphrody_nds_sdk::GpuFrame;

/// Write every screen as `screen<i>.ppm` (binary P6) into `dir`.
///
/// # Errors
/// Returns the first I/O error.
pub fn write_screens(dir: &std::path::Path, screens: &[Screen]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for (i, s) in screens.iter().enumerate() {
        let mut ppm = format!("P6\n{} {}\n255\n", s.width, s.height).into_bytes();
        ppm.extend_from_slice(&s.rgb);
        std::fs::write(dir.join(format!("screen{i}.ppm")), ppm)?;
    }
    Ok(())
}

/// Result of advancing a machine by one video frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Frame,
    Shutdown,
    Stopped,
}

pub trait Machine {
    fn name(&self) -> &'static str;
    fn run_frame(&mut self) -> Step;
    fn screens(&self) -> Vec<Screen>;
    /// GPU-owned screens, when the core renders directly on the host device.
    #[cfg(feature = "nds-gpu")]
    fn gpu_frame(&mut self) -> Option<GpuFrame> {
        None
    }
    /// True when CPU screen images are not the authoritative display output.
    #[cfg(feature = "nds-gpu")]
    fn gpu_rendering(&self) -> bool {
        false
    }
    fn set_input(&mut self, _input: Input) {}
    /// Why the machine stopped, when it stopped abnormally.
    fn diagnostic(&self) -> Option<String> {
        None
    }
    /// Serial output produced since the last call.
    fn console(&mut self) -> Vec<u8> {
        Vec::new()
    }
    /// Video frames per second of the emulated display (frame pacing).
    fn refresh_rate(&self) -> f64 {
        60.0
    }
    /// Sample rate of [`Machine::audio`] in Hz; 0 when the machine produces no audio.
    fn sample_rate(&self) -> u32 {
        0
    }
    /// Append the interleaved stereo samples (-1.0..=1.0) produced since the last call.
    fn audio(&mut self, _out: &mut Vec<f32>) {}
    /// Serialized machine state (suspend/resume, save states); `None` when the core cannot save.
    fn save_state(&mut self) -> Option<Vec<u8>> {
        None
    }
    /// Restore a state produced by [`Machine::save_state`] for the same image.
    fn load_state(&mut self, _state: &[u8]) -> Result<(), String> {
        Err(format!("{} has no save states", self.name()))
    }
}
