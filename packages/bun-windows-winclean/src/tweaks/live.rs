// SPDX-License-Identifier: Apache-2.0
//! Live backend: the running Windows, through the WinClean primitives (Registry API in `winreg`, Service Control
//! Manager in `services`, `schtasks` and `powercfg` in `system`, WinRT `PackageManager` for per-user packages).
//!
//! Detection is read-only and works unelevated (HKLM reads, SCM queries, task queries, package enumeration).
//! Applying machine-wide changes needs an elevated process; the engine reports `PermissionDenied` per step
//! otherwise and continues.

use std::io;

use super::{Backend, FeatureState, Op, RegData, RegHive, State, StartType, TargetKind};
use crate::{registry::Hive, services, system, winreg};

#[derive(Debug, Default)]
pub struct LiveBackend;

fn hive(h: RegHive) -> Hive {
    match h {
        RegHive::Machine => Hive::LocalMachine,
        RegHive::User => Hive::CurrentUser,
    }
}

fn reg_get(h: RegHive, key: &str, name: &str) -> io::Result<Option<RegData>> {
    let Ok(k) = winreg::open_read(hive(h), key) else { return Ok(None) };
    match winreg::query_value(&k, name) {
        Ok(raw) => Ok(Some(RegData::decode(raw.kind, &raw.data))),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn reg_set(h: RegHive, key: &str, name: &str, data: &RegData) -> io::Result<()> {
    let k = winreg::create(hive(h), key)?;
    let (kind, bytes) = data.encode();
    winreg::set_value(&k, name, kind, &bytes)
}

fn reg_delete(h: RegHive, key: &str, name: &str) -> io::Result<()> {
    let Ok(k) = winreg::open_write(hive(h), key) else { return Ok(()) };
    match winreg::delete_value(&k, name) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Whether a scheduled task exists and is enabled (`None` when it does not exist), read through the Task Scheduler
/// COM API (`ITaskService` → `ITaskFolder::GetTask` → `IRegisteredTask::Enabled`): `schtasks` prints a localised
/// status column ("Désactivé" on a French Windows), so parsing its output misreads disabled tasks.
fn task_enabled(path: &str) -> io::Result<Option<bool>> {
    use windows::Win32::Foundation::VARIANT_BOOL;
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
    use windows::Win32::System::TaskScheduler::{ITaskService, TaskScheduler};
    use windows::Win32::System::Variant::VARIANT;
    use windows::core::BSTR;

    use crate::win32::hresult_error;

    let (folder, name) = path.rsplit_once('\\').unwrap_or(("", path));
    let folder = if folder.is_empty() { "\\" } else { folder };
    // SAFETY: plain COM calls on interfaces owned by this function; COM is initialised for this thread first
    // (an already-initialised thread returns S_FALSE or RPC_E_CHANGED_MODE, both fine for an in-process server).
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let service: ITaskService =
            CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER).map_err(|e| hresult_error(&e, "TaskScheduler"))?;
        let none = VARIANT::default();
        service.Connect(&none, &none, &none, &none).map_err(|e| hresult_error(&e, "ITaskService::Connect"))?;
        let Ok(folder) = service.GetFolder(&BSTR::from(folder)) else { return Ok(None) };
        let Ok(task) = folder.GetTask(&BSTR::from(name)) else { return Ok(None) };
        let enabled: VARIANT_BOOL = task.Enabled().map_err(|e| hresult_error(&e, "IRegisteredTask::Enabled"))?;
        Ok(Some(enabled.as_bool()))
    }
}

fn active_power() -> io::Result<String> {
    Ok(system::get_active_power_plan()?.guid.to_ascii_lowercase())
}

mod appx {
    use std::io;

    use windows::{Management::Deployment::{PackageManager, RemovalOptions}, core::HSTRING};

    use crate::win32::hresult_error;

    fn manager() -> io::Result<PackageManager> {
        PackageManager::new().map_err(|e| hresult_error(&e, "PackageManager"))
    }

    /// Full names of the current user's packages whose family name starts with `family_`.
    pub(super) fn installed(family: &str) -> io::Result<Vec<String>> {
        let pm = manager()?;
        let packages = pm.FindPackagesByUserSecurityId(&HSTRING::new()).map_err(|e| hresult_error(&e, "FindPackages"))?;
        let prefix = format!("{}_", family.to_ascii_lowercase());
        let mut out = Vec::new();
        for p in packages {
            let Ok(id) = p.Id() else { continue };
            let Ok(full) = id.FullName() else { continue };
            let full = full.to_string();
            if full.to_ascii_lowercase().starts_with(&prefix) {
                out.push(full);
            }
        }
        Ok(out)
    }

    /// Remove one package for the current user only; provisioned copies stay staged so it can be re-registered.
    pub(super) fn remove(full_name: &str) -> io::Result<()> {
        let pm = manager()?;
        let op = pm
            .RemovePackageWithOptionsAsync(&HSTRING::from(full_name), RemovalOptions::None)
            .map_err(|e| hresult_error(&e, "RemovePackage"))?;
        op.join().map(|_| ()).map_err(|e| hresult_error(&e, &format!("remove {full_name}")))
    }

    /// Re-register a staged package for the current user (undo of `remove`).
    pub(super) fn register(full_name: &str) -> io::Result<()> {
        let pm = manager()?;
        let op = pm
            .RegisterPackageByFullNameAsync(
                &HSTRING::from(full_name),
                None,
                windows::Management::Deployment::DeploymentOptions::None,
            )
            .map_err(|e| hresult_error(&e, "RegisterPackageByFullName"))?;
        op.join().map(|_| ()).map_err(|e| hresult_error(&e, &format!("register {full_name}")))
    }
}

impl Backend for LiveBackend {
    fn kind(&self) -> TargetKind {
        TargetKind::Live
    }

    fn detect(&mut self, op: &Op) -> io::Result<State> {
        Ok(match op {
            Op::RegSet { hive, key, name, .. } | Op::RegDeleteValue { hive, key, name } => {
                reg_get(*hive, key, name)?.map_or(State::Absent, |data| State::Value { data })
            }
            Op::RegDeleteKey { hive: h, key } => {
                if winreg::key_exists(hive(*h), key) { State::KeyPresent } else { State::Absent }
            }
            Op::AppxRemove { family } => {
                let full_names = appx::installed(family)?;
                if full_names.is_empty() { State::Absent } else { State::Packages { full_names } }
            }
            Op::ServiceStart { name, .. } => match services::start_type_code(name)? {
                None => State::Absent,
                Some(code) => StartType::from_code(code)
                    .map(|start| State::Start { start })
                    .ok_or_else(|| io::Error::other(format!("{name}: unknown start type {code}")))?,
            },
            Op::TaskDisable { path } => task_enabled(path)?.map_or(State::Absent, |enabled| State::Task { enabled }),
            Op::PowerScheme { .. } => State::Power { guid: active_power()? },
            Op::Feature { .. } | Op::CapabilityRemove { .. } => {
                return Err(io::Error::new(io::ErrorKind::Unsupported, "features/capabilities: use the DISM online session (bunos-win11)"));
            }
            Op::FileRemove { .. } => return Err(io::Error::new(io::ErrorKind::Unsupported, "file removal is offline-only")),
        })
    }

    fn apply(&mut self, op: &Op) -> io::Result<()> {
        match op {
            Op::RegSet { hive, key, name, data } => reg_set(*hive, key, name, data),
            Op::RegDeleteValue { hive, key, name } => reg_delete(*hive, key, name),
            Op::AppxRemove { family } => {
                for full in appx::installed(family)? {
                    appx::remove(&full)?;
                }
                Ok(())
            }
            Op::ServiceStart { name, start } => services::set_start_type(name, start.code()),
            Op::TaskDisable { path } => system::control_scheduled_task("disable", path).map(|_| ()),
            Op::PowerScheme { guid } => system::set_active_power_plan(guid).map(|_| ()),
            Op::RegDeleteKey { .. } | Op::Feature { .. } | Op::CapabilityRemove { .. } | Op::FileRemove { .. } => {
                Err(io::Error::new(io::ErrorKind::Unsupported, "not a live operation"))
            }
        }
    }

    fn restore(&mut self, op: &Op, before: &State) -> io::Result<()> {
        match (op, before) {
            (Op::RegSet { hive, key, name, .. } | Op::RegDeleteValue { hive, key, name }, State::Absent) => {
                reg_delete(*hive, key, name)
            }
            (Op::RegSet { hive, key, name, .. } | Op::RegDeleteValue { hive, key, name }, State::Value { data }) => {
                reg_set(*hive, key, name, data)
            }
            (Op::AppxRemove { .. }, State::Packages { full_names }) => {
                for full in full_names {
                    appx::register(full)?;
                }
                Ok(())
            }
            (Op::ServiceStart { name, .. }, State::Start { start }) => services::set_start_type(name, start.code()),
            (Op::TaskDisable { path }, State::Task { enabled: true }) => {
                system::control_scheduled_task("enable", path).map(|_| ())
            }
            (Op::PowerScheme { .. }, State::Power { guid }) => system::set_active_power_plan(guid).map(|_| ()),
            (_, State::Absent | State::Task { enabled: false }) => Ok(()),
            (Op::Feature { .. }, State::Feature { state: FeatureState::Enabled | FeatureState::Disabled }) | _ => {
                Err(io::Error::new(io::ErrorKind::Unsupported, format!("cannot restore {op:?}")))
            }
        }
    }
}
