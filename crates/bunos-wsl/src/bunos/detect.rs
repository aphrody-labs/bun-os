// SPDX-License-Identifier: GPL-3.0-only
//! Recognise a Bun OS distro, its kernel and the WSLg/GPU state from command output.

use super::ini;
use crate::wsl::executor::WslCommandExecutor;
use crate::wsl::WslError;
use serde::Serialize;
use std::collections::BTreeMap;

/// `KEY=value` / `KEY="value"` lines of `/etc/os-release`.
pub fn parse_os_release(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() || l.starts_with('#') {
                return None;
            }
            let (k, v) = l.split_once('=')?;
            Some((
                k.trim().to_string(),
                v.trim().trim_matches('"').trim_matches('\'').to_string(),
            ))
        })
        .collect()
}

/// The Bun OS WSL image sets `NAME="Bun OS (WSL)"` (factory/wsl/bunos-wsl.sh).
pub fn is_bunos_os_release(text: &str) -> bool {
    parse_os_release(text)
        .get("NAME")
        .is_some_and(|n| n.starts_with("Bun OS"))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelRelease {
    pub raw: String,
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    /// Microsoft's WSL2 kernels carry `microsoft-standard-WSL2` in the release string.
    pub is_wsl: bool,
}

/// Parse `uname -r`, e.g. `6.18.58.1-microsoft-standard-WSL2` or `7.3.0-microsoft-standard-WSL2+`.
pub fn parse_kernel_release(raw: &str) -> Option<KernelRelease> {
    let raw = raw.trim();
    let numeric: String = raw
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let mut it = numeric
        .split('.')
        .filter(|p| !p.is_empty())
        .map(|p| p.parse::<u32>().ok());
    let major = it.next()??;
    let minor = it.next().flatten().unwrap_or(0);
    let patch = it.next().flatten().unwrap_or(0);
    Some(KernelRelease {
        raw: raw.to_string(),
        major,
        minor,
        patch,
        is_wsl: raw.to_ascii_lowercase().contains("microsoft"),
    })
}

/// Kernel files selected in `.wslconfig` (`[wsl2] kernel=` / `kernelModules=`), unescaped.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelSelection {
    pub kernel: Option<String>,
    pub kernel_modules: Option<String>,
}

pub fn kernel_selection(wslconfig: &str) -> KernelSelection {
    KernelSelection {
        kernel: ini::get(wslconfig, "wsl2", "kernel").map(|v| ini::unescape_windows_path(&v)),
        kernel_modules: ini::get(wslconfig, "wsl2", "kernelModules")
            .map(|v| ini::unescape_windows_path(&v)),
    }
}

/// Shell snippet printing `key=value` lines about the guest side of WSLg and GPU access.
pub const GUI_PROBE_COMMAND: &str = "uname -r | sed 's/^/kernel=/'; \
test -e /dev/dxg && echo dxg=1 || echo dxg=0; \
test -S /mnt/wslg/runtime-dir/wayland-0 && echo wayland=1 || echo wayland=0; \
test -e /mnt/wslg/.X11-unix/X0 && echo x11=1 || echo x11=0; \
test -S /mnt/wslg/PulseServer && echo pulse=1 || echo pulse=0; \
echo compositor=$(. /etc/bunos/session.conf 2>/dev/null; echo ${WSL2_COMPOSITOR:-weston}); \
grep -m1 '^NAME=' /etc/os-release | sed 's/^NAME=/os=/' | tr -d '\"'";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuiStatus {
    pub kernel: Option<String>,
    pub os: Option<String>,
    /// `/dev/dxg` present: GPU paravirtualization (dxgkrnl) is active.
    pub gpu: bool,
    pub wayland: bool,
    pub x11: bool,
    pub pulse: bool,
    pub compositor: Option<String>,
}

pub fn parse_gui_probe(output: &str) -> GuiStatus {
    let mut s = GuiStatus::default();
    for line in output.lines() {
        let Some((k, v)) = line.trim().split_once('=') else {
            continue;
        };
        let on = v.trim() == "1";
        match k.trim() {
            "kernel" => s.kernel = Some(v.trim().to_string()),
            "os" => s.os = Some(v.trim().to_string()),
            "dxg" => s.gpu = on,
            "wayland" => s.wayland = on,
            "x11" => s.x11 = on,
            "pulse" => s.pulse = on,
            "compositor" => s.compositor = Some(v.trim().to_string()).filter(|v| !v.is_empty()),
            _ => {}
        }
    }
    s
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistroReport {
    pub name: String,
    pub is_bunos: bool,
    pub gui: GuiStatus,
    pub kernel: Option<KernelRelease>,
}

/// Inspect a running distro through the executor (`wsl -d <name> -- sh -c ...`).
pub fn inspect_distro(exec: &dyn WslCommandExecutor, name: &str) -> Result<DistroReport, WslError> {
    let osr = exec.exec(name, None, "cat /etc/os-release")?;
    let probe = exec.exec(name, None, GUI_PROBE_COMMAND)?;
    let gui = parse_gui_probe(&probe.stdout);
    let kernel = gui.kernel.as_deref().and_then(parse_kernel_release);
    Ok(DistroReport {
        name: name.to_string(),
        is_bunos: osr.success && is_bunos_os_release(&osr.stdout),
        gui,
        kernel,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const OS_RELEASE: &str =
        "NAME=\"Bun OS (WSL)\"\nPRETTY_NAME=\"Arch Linux\"\nID=arch\nBUILD_ID=rolling\n";

    #[test]
    fn os_release_detection() {
        assert!(is_bunos_os_release(OS_RELEASE));
        assert!(!is_bunos_os_release("NAME=\"Ubuntu\"\nID=ubuntu\n"));
        assert_eq!(
            parse_os_release(OS_RELEASE).get("ID").map(String::as_str),
            Some("arch")
        );
    }

    #[test]
    fn kernel_release_forms() {
        let k = parse_kernel_release("6.18.58.1-microsoft-standard-WSL2\n").unwrap();
        assert_eq!((k.major, k.minor, k.patch, k.is_wsl), (6, 18, 58, true));
        let k = parse_kernel_release("7.3.0-microsoft-standard-WSL2+").unwrap();
        assert_eq!((k.major, k.minor), (7, 3));
        assert!(!parse_kernel_release("6.12.1-arch1-1").unwrap().is_wsl);
        assert!(parse_kernel_release("garbage").is_none());
    }

    #[test]
    fn wslconfig_kernel_selection_unescapes_paths() {
        let cfg = "[wsl2]\r\nkernel=C:\\\\bunos\\\\bzImage\r\nkernelModules=C:\\\\bunos\\\\modules.vhdx\r\n";
        let s = kernel_selection(cfg);
        assert_eq!(s.kernel.as_deref(), Some("C:\\bunos\\bzImage"));
        assert_eq!(s.kernel_modules.as_deref(), Some("C:\\bunos\\modules.vhdx"));
        assert_eq!(
            kernel_selection("[wsl2]\nmemory=4GB\n"),
            KernelSelection::default()
        );
    }

    #[test]
    fn gui_probe_fixture() {
        let out = "kernel=7.3.0-microsoft-standard-WSL2+\ndxg=1\nwayland=1\nx11=1\npulse=0\ncompositor=hyprland-nested\nos=Bun OS (WSL)\n";
        let g = parse_gui_probe(out);
        assert!(g.gpu && g.wayland && g.x11 && !g.pulse);
        assert_eq!(g.compositor.as_deref(), Some("hyprland-nested"));
        assert_eq!(g.os.as_deref(), Some("Bun OS (WSL)"));
        assert_eq!(parse_gui_probe(""), GuiStatus::default());
    }
}
