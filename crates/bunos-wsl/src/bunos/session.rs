// SPDX-License-Identifier: GPL-3.0-only
//! Graphical session preference and per-distro resource limits of a Bun OS distro.
//!
//! The compositor names are the `WSL2_COMPOSITOR` values of the Bun OS WSLd switch
//! (aphrody-labs/wslg, `WSLGd/Compositor.h`). The preference is written to
//! `/etc/bunos/session.conf` inside the distro; that WSLGd reads it is only true with the Bun OS
//! WSLg build, which is not verified end to end (docs/WSLG.md "Not done / unverified").
//! Limits are cgroup v2 limits on the distro's `user.slice` through a systemd drop-in, because
//! WSL2 itself only limits the shared VM (`.wslconfig`), never a single distro.

use crate::wsl::executor::WslCommandExecutor;
use crate::wsl::WslError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Compositor {
    Weston,
    HyprlandNested,
    HyprlandHeadless,
}

impl Compositor {
    pub fn as_env_value(self) -> &'static str {
        match self {
            Compositor::Weston => "weston",
            Compositor::HyprlandNested => "hyprland-nested",
            Compositor::HyprlandHeadless => "hyprland-headless",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "weston" => Some(Compositor::Weston),
            "hyprland-nested" => Some(Compositor::HyprlandNested),
            "hyprland-headless" => Some(Compositor::HyprlandHeadless),
            _ => None,
        }
    }
}

/// Content of `/etc/bunos/session.conf` (sourced by sh).
pub fn session_conf(c: Compositor) -> String {
    format!("# written by the Bun OS WSL manager\nWSL2_COMPOSITOR={}\n", c.as_env_value())
}

fn write_file_command(path: &str, content: &str) -> String {
    // Content is generated from validated enums and numbers only: no quoting beyond single quotes.
    format!(
        "mkdir -p \"$(dirname {path})\" && printf '%s' '{}' > {path}",
        content.replace('\'', "'\\''")
    )
}

pub fn apply_session(exec: &dyn WslCommandExecutor, distro: &str, c: Compositor) -> Result<(), WslError> {
    let out = exec.exec_as_root(distro, None, &write_file_command("/etc/bunos/session.conf", &session_conf(c)))?;
    if out.success { Ok(()) } else { Err(WslError::CommandFailed(out.stderr)) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistroLimits {
    /// `MemoryMax` in MiB.
    pub memory_mib: Option<u64>,
    /// `CPUQuota` in percent of one CPU (200 = two CPUs).
    pub cpu_percent: Option<u32>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LimitError {
    #[error("memory limit must be between 256 MiB and 4194304 MiB")]
    Memory,
    #[error("cpu limit must be between 10 and 6400 percent")]
    Cpu,
}

impl DistroLimits {
    pub fn validate(&self) -> Result<(), LimitError> {
        if self.memory_mib.is_some_and(|m| !(256..=4_194_304).contains(&m)) {
            return Err(LimitError::Memory);
        }
        if self.cpu_percent.is_some_and(|c| !(10..=6400).contains(&c)) {
            return Err(LimitError::Cpu);
        }
        Ok(())
    }

    /// systemd drop-in for `user.slice` (applies to every login session of the distro).
    pub fn dropin(&self) -> String {
        let mut s = String::from("[Slice]\n");
        if let Some(m) = self.memory_mib {
            s.push_str(&format!("MemoryMax={m}M\n"));
        }
        if let Some(c) = self.cpu_percent {
            s.push_str(&format!("CPUQuota={c}%\n"));
        }
        s
    }
}

pub const LIMITS_DROPIN_PATH: &str = "/etc/systemd/system/user.slice.d/50-bunos-limits.conf";

/// Write (or, with empty limits, remove) the drop-in and reload systemd. Needs `[boot] systemd=true`,
/// which the Bun OS image sets.
pub fn apply_limits(exec: &dyn WslCommandExecutor, distro: &str, limits: DistroLimits) -> Result<(), LimitApplyError> {
    limits.validate().map_err(LimitApplyError::Invalid)?;
    let cmd = if limits.memory_mib.is_none() && limits.cpu_percent.is_none() {
        format!("rm -f {LIMITS_DROPIN_PATH} && systemctl daemon-reload")
    } else {
        format!("{} && systemctl daemon-reload", write_file_command(LIMITS_DROPIN_PATH, &limits.dropin()))
    };
    let out = exec.exec_as_root(distro, None, &cmd).map_err(LimitApplyError::Wsl)?;
    if out.success { Ok(()) } else { Err(LimitApplyError::Wsl(WslError::CommandFailed(out.stderr))) }
}

#[derive(Debug, thiserror::Error)]
pub enum LimitApplyError {
    #[error(transparent)]
    Invalid(LimitError),
    #[error(transparent)]
    Wsl(WslError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compositor_names_match_the_wslgd_switch() {
        for c in [Compositor::Weston, Compositor::HyprlandNested, Compositor::HyprlandHeadless] {
            assert_eq!(Compositor::parse(c.as_env_value()), Some(c));
        }
        assert_eq!(Compositor::parse("sway"), None);
        assert_eq!(serde_json::to_string(&Compositor::HyprlandNested).unwrap(), "\"hyprland-nested\"");
    }

    #[test]
    fn session_conf_is_sourceable() {
        assert_eq!(session_conf(Compositor::Weston), "# written by the Bun OS WSL manager\nWSL2_COMPOSITOR=weston\n");
    }

    #[test]
    fn limits_dropin_and_validation() {
        let l = DistroLimits { memory_mib: Some(4096), cpu_percent: Some(200) };
        assert_eq!(l.dropin(), "[Slice]\nMemoryMax=4096M\nCPUQuota=200%\n");
        assert_eq!(DistroLimits { memory_mib: Some(1), cpu_percent: None }.validate(), Err(LimitError::Memory));
        assert_eq!(DistroLimits { memory_mib: None, cpu_percent: Some(5) }.validate(), Err(LimitError::Cpu));
        assert!(DistroLimits { memory_mib: None, cpu_percent: None }.validate().is_ok());
    }

    #[test]
    fn write_command_quotes_single_quotes() {
        let c = write_file_command("/etc/x", "a'b");
        assert!(c.contains("'a'\\''b'"));
    }
}
