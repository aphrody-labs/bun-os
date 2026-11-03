// SPDX-License-Identifier: Apache-2.0
//! Windows half: presents Linux toplevels as native Win32/DWM windows.
#![cfg_attr(windows, windows_subsystem = "console")]
#[cfg(windows)]
fn main() {
    if let Err(e) = bunos_wayland_win::presenter::run(std::env::args().skip(1).collect()) {
        eprintln!("bunos-wayland-win: {e}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("bunos-wayland-win is the Windows presenter; on Linux run bunos-wlhost");
    std::process::exit(64);
}
