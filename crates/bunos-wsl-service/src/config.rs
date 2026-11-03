// SPDX-License-Identifier: Apache-2.0
//! Configuration and shared state in the service's own registry key:
//! `HKLM\SYSTEM\CurrentControlSet\Services\BunOSWsl\Parameters` (Distro, User, TerminateOnStop, StatePeriod; status
//! values written by the service) and `...\Parameters\Units\<unit>` (one key per mirrored systemd unit, holding the
//! last state the instance service read from the guest; the per-unit services poll it).

use crate::units::{SERVICE_NAME, UnitState};
use anyhow::{Context, Result};
use std::time::{SystemTime, UNIX_EPOCH};
use winreg::{RegKey, enums::*};

pub fn params_path() -> String {
    format!(r"SYSTEM\CurrentControlSet\Services\{SERVICE_NAME}\Parameters")
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone)]
pub struct Config {
    pub distro: String,
    pub user: String,
    pub terminate_on_stop: bool,
    pub state_period: u32,
}

impl Config {
    pub fn load() -> Result<Self> {
        let k = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(params_path())
            .with_context(|| {
                format!(
                    "HKLM\\{} missing: run `bunos-wsl-service install`",
                    params_path()
                )
            })?;
        Ok(Self {
            distro: k.get_value("Distro").unwrap_or_else(|_| "bunos".into()),
            user: k.get_value("User").context("Parameters\\User is not set")?,
            terminate_on_stop: k.get_value::<u32, _>("TerminateOnStop").unwrap_or(1) != 0,
            state_period: k
                .get_value::<u32, _>("StatePeriod")
                .unwrap_or(2)
                .clamp(1, 60),
        })
    }

    pub fn save(&self) -> Result<()> {
        let (k, _) = RegKey::predef(HKEY_LOCAL_MACHINE).create_subkey(params_path())?;
        k.set_value("Distro", &self.distro)?;
        k.set_value("User", &self.user)?;
        k.set_value("TerminateOnStop", &(self.terminate_on_stop as u32))?;
        k.set_value("StatePeriod", &self.state_period)?;
        let _ = k.create_subkey("Units")?;
        Ok(())
    }
}

/// Status values the instance service publishes (read by `bunos-wsl-service status`).
pub fn set_status(name: &str, value: &str) {
    if let Ok((k, _)) = RegKey::predef(HKEY_LOCAL_MACHINE).create_subkey(params_path()) {
        let _ = k.set_value(name, &value.to_string());
    }
}

pub fn get_status(name: &str) -> Option<String> {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(params_path())
        .ok()?
        .get_value(name)
        .ok()
}

/// Mirrored units, sorted.
pub fn units() -> Vec<String> {
    let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(format!(r"{}\Units", params_path()))
    else {
        return Vec::new();
    };
    let mut v: Vec<String> = k.enum_keys().filter_map(|k| k.ok()).collect();
    v.sort();
    v
}

pub fn add_unit(unit: &str) -> Result<()> {
    RegKey::predef(HKEY_LOCAL_MACHINE).create_subkey(format!(r"{}\Units\{unit}", params_path()))?;
    Ok(())
}

pub fn remove_unit(unit: &str) {
    let _ = RegKey::predef(HKEY_LOCAL_MACHINE)
        .delete_subkey_all(format!(r"{}\Units\{unit}", params_path()));
}

pub fn write_unit_state(s: &UnitState) {
    if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(format!(r"{}\Units\{}", params_path(), s.id), KEY_SET_VALUE)
    {
        let _ = k.set_value("ActiveState", &s.active);
        let _ = k.set_value("SubState", &s.sub);
        let _ = k.set_value("Result", &s.result);
        let _ = k.set_value("MainPID", &s.main_pid);
        let _ = k.set_value("Updated", &now_ms());
    }
}

/// The last published state of a unit and its age in milliseconds.
pub fn read_unit_state(unit: &str) -> Option<(UnitState, u64)> {
    let k = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(format!(r"{}\Units\{unit}", params_path()))
        .ok()?;
    let updated: u64 = k.get_value("Updated").ok()?;
    Some((
        UnitState {
            id: unit.to_string(),
            active: k.get_value("ActiveState").unwrap_or_default(),
            sub: k.get_value("SubState").unwrap_or_default(),
            result: k.get_value("Result").unwrap_or_default(),
            main_pid: k.get_value("MainPID").unwrap_or(0),
        },
        now_ms().saturating_sub(updated),
    ))
}
