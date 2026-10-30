//! Nintendo DS and 3DS SDK.
//!
//! One [`Handheld`] interface over two cores that already live in the workspace: Dust
//! (`aphrody-dust-*`, Nintendo DS) and Zakuro through `aphrody-ctr-emu` (Nintendo 3DS). The SDK
//! detects the image format by content ([`Format::detect`]), boots it ([`open`], [`boot`]),
//! steps frames, feeds buttons, touch and circle pad, returns both screens as RGBA8 images and
//! stereo audio, keeps persistent saves and saved states, and exposes registers and memory for
//! debugging. The optional `bevy` feature adds `HandheldPlugin`; Bun Engine's `nds` and `ctr`
//! machines run through the same trait.
//!
//! No Nintendo firmware, key or title ships with the SDK.

pub mod format;
pub mod handheld;

#[cfg(feature = "ctr")]
pub mod ctr;
#[cfg(feature = "nds")]
pub mod nds;

#[cfg(feature = "bevy")]
pub mod plugin;

use std::path::{Path, PathBuf};

#[cfg(feature = "nds-gpu")]
pub use aphrody_dust_wgpu::wgpu;
pub use format::{Format, Platform};
#[cfg(feature = "nds-gpu")]
pub use handheld::GpuFrame;
pub use handheld::{
    Error, Handheld, Image, Input, Result, ScreenId, ScreenSpec, Step, button, frame_hash,
};
#[cfg(feature = "bevy")]
pub use plugin::{HandheldPlugin, HandheldScreens};

/// Cartridge backup chip of a DS game (the 8, 64 and 128 KiB variants cover EEPROM and FRAM,
/// which share one protocol). The cartridge header does not say which chip a game uses, so
/// `Auto` follows the size of an existing save file, then [`SaveType::known`], and otherwise
/// assumes a 512 KiB flash; pick the real chip for games that probe a different one. A wrong
/// chip makes the game report a card or save error (Inazuma Eleven stops on "loading failed"
/// with a flash).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SaveType {
    #[default]
    Auto,
    None,
    Eeprom512B,
    Eeprom8K,
    Eeprom64K,
    Eeprom128K,
    Flash256K,
    Flash512K,
    Flash1M,
}

impl SaveType {
    /// Chips verified by booting the game (game code, region letter ignored).
    pub fn known(game_code: &[u8]) -> Option<SaveType> {
        match game_code.get(..3)? {
            // Inazuma Eleven (YEE) and Inazuma Eleven 2 (BEB), French releases.
            b"YEE" | b"BEB" => Some(SaveType::Eeprom64K),
            _ => None,
        }
    }

    /// Backup size assumed when nothing says otherwise.
    pub const DEFAULT_SIZE: usize = 0x8_0000;

    /// Backup size in bytes (0 for none).
    pub fn size(self) -> usize {
        match self {
            SaveType::Auto => Self::DEFAULT_SIZE,
            SaveType::None => 0,
            SaveType::Eeprom512B => 0x200,
            SaveType::Eeprom8K => 0x2000,
            SaveType::Eeprom64K => 0x1_0000,
            SaveType::Eeprom128K => 0x2_0000,
            SaveType::Flash256K => 0x4_0000,
            SaveType::Flash512K => 0x8_0000,
            SaveType::Flash1M => 0x10_0000,
        }
    }
}

/// Boot options.
#[derive(Clone, Debug, Default)]
pub struct Options {
    /// DS cartridge backup file; created and updated while the game saves.
    pub save_path: Option<PathBuf>,
    pub save_type: SaveType,
    /// 3DS save data, SD card and mods directory. Default: [`default_data_dir`]`("3ds")`.
    pub data_dir: Option<PathBuf>,
}

/// Persistent data directory: `$BUN_ENGINE_DATA/<name>`, else the user data directory
/// (`%APPDATA%\bun-engine\<name>`, `$XDG_DATA_HOME/bun-engine/<name>` or
/// `~/.local/share/bun-engine/<name>`).
pub fn default_data_dir(name: &str) -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("BUN_ENGINE_DATA") {
        return Some(PathBuf::from(dir).join(name));
    }
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
            })
    };
    base.map(|base| base.join("bun-engine").join(name))
}

/// Boot `image` (named `name`, used for the title of homebrew and the save file stem), detecting
/// its format from the content.
pub fn boot(name: &str, image: &[u8], options: &Options) -> Result<Box<dyn Handheld>> {
    let format = Format::detect(image).ok_or_else(|| {
        Error(format!(
            "{name}: not a Nintendo DS or 3DS image (NDS, CCI, CIA, CXI or 3DSX)"
        ))
    })?;
    match format.platform() {
        #[cfg(feature = "nds")]
        Platform::Ds => Ok(Box::new(nds::Nds::from_rom(image, options)?)),
        #[cfg(feature = "ctr")]
        Platform::Ctr => Ok(Box::new(ctr::Ctr::from_image(name, image, options)?)),
        #[allow(unreachable_patterns)]
        other => Err(Error(format!(
            "{name}: the {other:?} core is disabled in this build"
        ))),
    }
}

/// Read and boot the image at `path`. DS games keep their backup in `<path>.sav` unless
/// `options.save_path` is set.
pub fn open(path: impl AsRef<Path>, options: &Options) -> Result<Box<dyn Handheld>> {
    let path = path.as_ref();
    let image = std::fs::read(path).map_err(|e| handheld::err(&path.display().to_string(), e))?;
    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("title");
    let mut options = options.clone();
    if options.save_path.is_none() {
        options.save_path = Some(path.with_extension("sav"));
    }
    boot(name, &image, &options)
}
