//! Checked Wii homebrew loading shared by native and browser hosts.

use aphrody_wii::dol::{Dol, DolError};

use crate::{GameCube, Wii};

fn mapped_range(address: u32, size: u32, wii: bool) -> bool {
    let Some(end) = address.checked_add(size) else {
        return false;
    };
    (address >= 0x8000_0000 && address < 0x8180_0000 && end <= 0x8180_0000)
        || (wii && address >= 0x9000_0000 && address < 0x9400_0000 && end <= 0x9400_0000)
}

fn validate_dol(bytes: &[u8], wii: bool) -> Result<(), DolError> {
    let dol = Dol::parse(bytes)?;
    for section in dol.sections().iter().filter(|section| section.size != 0) {
        if !mapped_range(section.address, section.size, wii) {
            return Err(DolError::OutsideMemory);
        }
    }
    if dol.bss_size != 0 && !mapped_range(dol.bss_address, dol.bss_size, wii) {
        return Err(DolError::OutsideMemory);
    }
    if !dol.sections()[..7].iter().any(|section| {
        section.size != 0
            && dol.entry_point >= section.address
            && dol.entry_point < section.address + section.size
    }) {
        return Err(DolError::OutsideMemory);
    }
    Ok(())
}

impl Wii {
    /// Validate all sections before allocating the console or touching devices.
    pub fn with_dol(bytes: &[u8]) -> Result<Self, DolError> {
        validate_dol(bytes, true)?;
        Ok(Self::with_image(&image::Dol::parse(bytes.to_vec())))
    }
}

impl GameCube {
    /// Validate the DOL and its GameCube memory ranges before creating the console.
    pub fn with_dol(bytes: &[u8]) -> Result<Self, DolError> {
        validate_dol(bytes, false)?;
        Ok(Self::with_image(&image::Dol::parse(bytes.to_vec())))
    }
}
