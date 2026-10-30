// SPDX-License-Identifier: GPL-3.0-or-later
//! Host readiness report. Everything Waydroid needs from the kernel and the system, decided
//! from plain inputs so the same logic runs on a CI runner, the VPS and in tests.

use serde::Serialize;

#[derive(Debug, Default, Clone)]
pub struct Inputs {
    pub kernel: String,
    pub proc_filesystems: String,
    pub dev_names: Vec<String>,
    /// Text of /proc/config.gz or /boot/config-*, when readable.
    pub kernel_config: Option<String>,
    pub lxc_version: Option<String>,
    pub wayland_display: Option<String>,
    pub is_linux: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Check {
    pub id: &'static str,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct Report {
    pub kernel: String,
    pub ready: bool,
    pub checks: Vec<Check>,
}

/// `y`, `m` or absent for a `CONFIG_*` symbol.
pub fn config_state(config: &str, sym: &str) -> Option<char> {
    for line in config.lines() {
        if let Some(v) = line.strip_prefix(sym).and_then(|r| r.strip_prefix('=')) {
            return v.trim().chars().next();
        }
    }
    None
}

pub fn run(i: &Inputs) -> Report {
    let mut checks = Vec::new();
    let mut add = |id, ok, detail: String| checks.push(Check { id, ok, detail });

    add(
        "linux",
        i.is_linux,
        if i.is_linux {
            "linux".into()
        } else {
            "Waydroid needs a Linux host".into()
        },
    );

    let loaded = crate::binder::binderfs_loaded(&i.proc_filesystems);
    let nodes = crate::binder::detect(&i.dev_names, true);
    let have_nodes =
        nodes.binder.is_some() && nodes.vndbinder.is_some() && nodes.hwbinder.is_some();
    add(
        "binder",
        loaded || have_nodes,
        match (loaded, have_nodes) {
            (_, true) => format!("nodes: {:?}", nodes),
            (true, false) => {
                "binderfs registered, nodes not allocated yet (waydroid init allocates them)".into()
            }
            _ => "binder not loaded and no /dev nodes".into(),
        },
    );

    if let Some(cfg) = &i.kernel_config {
        let b = config_state(cfg, "CONFIG_ANDROID_BINDER_IPC");
        let f = config_state(cfg, "CONFIG_ANDROID_BINDERFS");
        add(
            "kernel-config-binder",
            matches!(b, Some('y' | 'm')) && matches!(f, Some('y' | 'm')),
            format!("BINDER_IPC={:?} BINDERFS={:?}", b, f),
        );
        // ashmem was removed from mainline; memfd is the fallback Waydroid enables itself.
        let a = config_state(cfg, "CONFIG_ANDROID_ASHMEM");
        let have_ashmem = i.dev_names.iter().any(|d| d == "ashmem");
        add(
            "ashmem-or-memfd",
            true,
            format!(
                "ASHMEM={:?}, /dev/ashmem={}; sys.use_memfd used otherwise",
                a, have_ashmem
            ),
        );
    }

    add(
        "lxc",
        i.lxc_version
            .as_deref()
            .map(crate::lxc::parse_version)
            .unwrap_or(0)
            > 0,
        i.lxc_version
            .clone()
            .unwrap_or_else(|| "lxc-start not found".into()),
    );
    add(
        "wayland",
        i.wayland_display.is_some(),
        i.wayland_display.clone().unwrap_or_else(|| {
            "WAYLAND_DISPLAY unset (headless needs a compositor such as weston)".into()
        }),
    );

    let ready = checks.iter().all(|c| c.ok);
    Report {
        kernel: i.kernel.clone(),
        ready,
        checks,
    }
}

/// Collect inputs from the running host. Non-Linux hosts get an empty, honest report.
pub fn collect() -> Inputs {
    use std::fs;
    let is_linux = cfg!(target_os = "linux");
    if !is_linux {
        return Inputs {
            kernel: std::env::consts::OS.into(),
            ..Default::default()
        };
    }
    let kernel = fs::read_to_string("/proc/sys/kernel/osrelease")
        .unwrap_or_default()
        .trim()
        .to_string();
    let dev_names = fs::read_dir("/dev")
        .map(|d| {
            d.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    let kernel_config = fs::read_to_string(format!("/boot/config-{kernel}")).ok();
    let lxc_version = std::process::Command::new("lxc-start")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    Inputs {
        kernel,
        proc_filesystems: fs::read_to_string("/proc/filesystems").unwrap_or_default(),
        dev_names,
        kernel_config,
        lxc_version,
        wayland_display: std::env::var("WAYLAND_DISPLAY").ok(),
        is_linux,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_symbols() {
        let c = "CONFIG_ANDROID_BINDER_IPC=m\n# CONFIG_ANDROID_BINDER_IPC_RUST is not set\nCONFIG_ANDROID_BINDERFS=y\n";
        assert_eq!(config_state(c, "CONFIG_ANDROID_BINDER_IPC"), Some('m'));
        assert_eq!(config_state(c, "CONFIG_ANDROID_BINDER_IPC_RUST"), None);
        assert_eq!(config_state(c, "CONFIG_ANDROID_BINDERFS"), Some('y'));
    }

    #[test]
    fn vps_like_host_is_not_ready() {
        // Facts measured on the VPS on 2026-10-29: binder=m but not loaded, no nodes, no sudo.
        let i = Inputs {
            kernel: "7.3.0-9-generic".into(),
            proc_filesystems: "nodev\tsysfs\n".into(),
            dev_names: vec!["null".into()],
            kernel_config: Some("CONFIG_ANDROID_BINDER_IPC=m\nCONFIG_ANDROID_BINDERFS=m\n".into()),
            lxc_version: None,
            wayland_display: None,
            is_linux: true,
        };
        let r = run(&i);
        assert!(!r.ready);
        let get = |id| r.checks.iter().find(|c| c.id == id).unwrap().ok;
        assert!(get("kernel-config-binder"));
        assert!(!get("binder"));
        assert!(!get("lxc"));
    }

    #[test]
    fn ready_host() {
        let i = Inputs {
            kernel: "k".into(),
            proc_filesystems: "nodev\tbinder\n".into(),
            dev_names: vec!["binder".into(), "vndbinder".into(), "hwbinder".into()],
            kernel_config: None,
            lxc_version: Some("5.0.3".into()),
            wayland_display: Some("wayland-0".into()),
            is_linux: true,
        };
        assert!(run(&i).ready);
    }
}
