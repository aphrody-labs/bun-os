// SPDX-License-Identifier: Apache-2.0
//! Linux half: headless Wayland compositor that ships toplevels to the Windows presenter.
#[cfg(target_os = "linux")]
fn main() {
    if let Err(e) = bunos_wayland_win::host::run(std::env::args().skip(1).collect()) {
        eprintln!("bunos-wlhost: {e}");
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!(
        "bunos-wlhost runs on Linux (the WSL distro, a VM or a remote host); on Windows run bunos-wayland-win"
    );
    std::process::exit(64);
}
