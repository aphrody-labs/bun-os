// SPDX-License-Identifier: Apache-2.0
//! Embeds a message table (RT_MESSAGETABLE) so the executable is its own EventMessageFile: every event ID 1..=4 is the
//! message "%1", so Event Viewer shows the inserted string instead of "the description cannot be found". The table is
//! written in the documented MESSAGE_RESOURCE_DATA layout, so no mc.exe is needed. The Windows identity (icon,
//! VERSIONINFO, manifest) comes from crates/bunos-winres in the same resource script.

use std::{env, fs, path::PathBuf};

/// Event IDs, mirrored in src/eventlog.rs.
const IDS: std::ops::RangeInclusive<u32> = 1..=4;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let count = (IDS.end() - IDS.start() + 1) as usize;
    let mut table = Vec::new();
    // MESSAGE_RESOURCE_DATA: NumberOfBlocks, then one MESSAGE_RESOURCE_BLOCK {LowId, HighId, OffsetToEntries}.
    table.extend_from_slice(&1u32.to_le_bytes());
    table.extend_from_slice(&IDS.start().to_le_bytes());
    table.extend_from_slice(&IDS.end().to_le_bytes());
    table.extend_from_slice(&16u32.to_le_bytes());
    for _ in 0..count {
        // MESSAGE_RESOURCE_ENTRY {Length, Flags = 1 (UTF-16), Text}, Length padded to a multiple of 4.
        let text: Vec<u8> = "%1\r\n\0"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        let len = (4 + text.len()).next_multiple_of(4);
        table.extend_from_slice(&(len as u16).to_le_bytes());
        table.extend_from_slice(&1u16.to_le_bytes());
        table.extend_from_slice(&text);
        table.resize(table.len() + len - 4 - text.len(), 0);
    }
    let bin = out.join("messages.bin");
    fs::write(&bin, table).unwrap();
    let bin_path = bin.display().to_string().replace('\\', "\\\\");
    // One resource script: icon, VERSIONINFO, application manifest (crates/bunos-winres) plus the message table.
    bunos_winres::Identity::from_env("Bun OS WSL service")
        .icon_role("linux")
        .embed(&format!("1 MESSAGETABLE \"{bin_path}\"\n"));
}
