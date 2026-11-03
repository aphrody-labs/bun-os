// SPDX-License-Identifier: Apache-2.0
//! Install, uninstall, unit export and the read-only views (`units`, `status`).

use crate::{
    config::{self, Config},
    eventlog,
    units::{SERVICE_NAME, UNIT_PREFIX, UnitRow, parse_list, valid_unit, windows_name},
    user::Runner,
};
use anyhow::{Context, Result, bail};
use serde::Serialize;
use std::{ffi::OsString, path::PathBuf, time::Duration};
use windows_service::{
    service::{
        ServiceAccess, ServiceAction, ServiceActionType, ServiceDependency, ServiceErrorControl,
        ServiceFailureActions, ServiceFailureResetPeriod, ServiceInfo, ServiceStartType,
        ServiceState, ServiceType,
    },
    service_manager::{ServiceManager, ServiceManagerAccess},
};

/// Where the service binary lives: LocalSystem must not run an executable from a user-writable path.
pub fn install_dir() -> PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    PathBuf::from(root).join("BunOS").join("wsl-service")
}

fn installed_exe() -> PathBuf {
    install_dir().join("bunos-wsl-service.exe")
}

fn scm_admin() -> Result<ServiceManager> {
    ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )
    .context("opening the Service Control Manager (run elevated: sudo bunos-wsl-service ...)")
}

fn upsert(scm: &ServiceManager, info: &ServiceInfo) -> Result<windows_service::service::Service> {
    let access = ServiceAccess::QUERY_STATUS
        | ServiceAccess::CHANGE_CONFIG
        | ServiceAccess::START
        | ServiceAccess::STOP
        | ServiceAccess::DELETE;
    match scm.open_service(&info.name, access) {
        Ok(s) => {
            s.change_config(info)?;
            Ok(s)
        }
        Err(_) => Ok(scm.create_service(info, access)?),
    }
}

fn current_user() -> String {
    let user = std::env::var("USERNAME").unwrap_or_default();
    let domain = std::env::var("USERDOMAIN").unwrap_or_default();
    if domain.is_empty() {
        user
    } else {
        format!("{domain}\\{user}")
    }
}

pub fn install(
    distro: String,
    user: Option<String>,
    terminate_on_stop: Option<bool>,
    start: bool,
) -> Result<()> {
    let exe = installed_exe();
    std::fs::create_dir_all(install_dir())?;
    let me = std::env::current_exe()?;
    let was_running = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .ok()
        .and_then(|m| {
            m.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS)
                .ok()
        })
        .and_then(|s| s.query_status().ok())
        .is_some_and(|s| s.current_state != ServiceState::Stopped);
    if !me.eq(&exe) {
        // A running service holds the file; stop everything first (units keep running) so the copy can replace it.
        stop_detached();
        std::fs::copy(&me, &exe).with_context(|| format!("copying to {}", exe.display()))?;
    }
    let user = user.unwrap_or_else(current_user);
    let prev = Config::load().ok();
    Config {
        distro: distro.clone(),
        user: user.clone(),
        terminate_on_stop: terminate_on_stop
            .unwrap_or(prev.as_ref().is_none_or(|c| c.terminate_on_stop)),
        state_period: prev.as_ref().map(|c| c.state_period).unwrap_or(2),
    }
    .save()?;
    let scm = scm_admin()?;
    let svc = upsert(
        &scm,
        &ServiceInfo {
            name: SERVICE_NAME.into(),
            display_name: "Bun OS (WSL)".into(),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::AutoStart,
            error_control: ServiceErrorControl::Normal,
            executable_path: exe.clone(),
            launch_arguments: vec![OsString::from("instance")],
            dependencies: vec![ServiceDependency::Service("WSLService".into())],
            account_name: None,
            account_password: None,
        },
    )?;
    svc.set_description(format!(
        "Runs the Bun OS WSL 2 distro '{distro}' as {user} from boot, without a logon, and restarts it if it stops. \
         Mirrored systemd units appear as {UNIT_PREFIX}<unit> services. See docs/WSL-SERVICE.md."
    ))?;
    svc.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(86_400)),
        reboot_msg: None,
        command: None,
        actions: Some(vec![
            ServiceAction {
                action_type: ServiceActionType::Restart,
                delay: Duration::from_secs(5),
            },
            ServiceAction {
                action_type: ServiceActionType::Restart,
                delay: Duration::from_secs(15),
            },
            ServiceAction {
                action_type: ServiceActionType::Restart,
                delay: Duration::from_secs(60),
            },
        ]),
    })?;
    // Service-specific exit codes (logon failure, instance keeps dying) count as failures too.
    svc.set_failure_actions_on_non_crash_failures(true)?;
    svc.set_delayed_auto_start(false)?;
    svc.set_preshutdown_timeout(Duration::from_secs(30))?;
    eventlog::register_source_at(SERVICE_NAME, &exe)?;
    for unit in config::units() {
        export_one(&scm, &exe, &unit, None)?;
    }
    println!(
        "installed {SERVICE_NAME}: {} instance (distro {distro}, user {user})",
        exe.display()
    );
    if start || was_running {
        start_service(&scm, SERVICE_NAME)?;
    }
    Ok(())
}

fn start_service(scm: &ServiceManager, name: &str) -> Result<()> {
    let s = scm.open_service(name, ServiceAccess::START | ServiceAccess::QUERY_STATUS)?;
    if s.query_status()?.current_state == ServiceState::Stopped {
        s.start::<&str>(&[])?;
    }
    println!("started {name}");
    Ok(())
}

/// Stops the unit services and the instance service without stopping the systemd units (the unit services see
/// `Parameters\Detach=1` and exit without `systemctl stop`). The instance service starts them again for running units.
fn stop_detached() {
    config::set_status("Detach", "1");
    for unit in config::units() {
        stop_quiet(&windows_name(&unit));
    }
    stop_quiet(SERVICE_NAME);
    config::set_status("Detach", "0");
}

fn stop_quiet(name: &str) {
    let Ok(scm) = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
    else {
        return;
    };
    let Ok(s) = scm.open_service(name, ServiceAccess::STOP | ServiceAccess::QUERY_STATUS) else {
        return;
    };
    if s.query_status()
        .is_ok_and(|st| st.current_state != ServiceState::Stopped)
    {
        let _ = s.stop();
        for _ in 0..60 {
            if s.query_status()
                .is_ok_and(|st| st.current_state == ServiceState::Stopped)
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }
}

pub fn uninstall() -> Result<()> {
    let scm = scm_admin()?;
    stop_detached();
    for unit in config::units() {
        let name = windows_name(&unit);
        if let Ok(s) = scm.open_service(&name, ServiceAccess::DELETE) {
            s.delete()?;
        }
        eventlog::unregister_source(&name);
    }
    if let Ok(s) = scm.open_service(SERVICE_NAME, ServiceAccess::DELETE) {
        s.delete()?;
    }
    // Deleting the service removes its registry key (Parameters included) once the last handle closes.
    eventlog::unregister_source(SERVICE_NAME);
    println!("removed {SERVICE_NAME} and its unit services (event log entries are kept)");
    Ok(())
}

fn export_one(
    scm: &ServiceManager,
    exe: &std::path::Path,
    unit: &str,
    description: Option<&str>,
) -> Result<()> {
    let name = windows_name(unit);
    let svc = upsert(
        scm,
        &ServiceInfo {
            name: name.clone().into(),
            display_name: format!("Bun OS: {unit}").into(),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::OnDemand,
            error_control: ServiceErrorControl::Ignore,
            executable_path: exe.to_path_buf(),
            launch_arguments: vec![OsString::from("unit"), OsString::from(unit)],
            dependencies: vec![ServiceDependency::Service(SERVICE_NAME.into())],
            account_name: None,
            account_password: None,
        },
    )?;
    let d = description
        .filter(|d| !d.is_empty())
        .unwrap_or("systemd unit of the Bun OS WSL distro");
    svc.set_description(format!("{d} ({unit} in the Bun OS distro, through {SERVICE_NAME}). Start/stop = systemctl start/stop."))?;
    eventlog::register_source_at(&name, exe)?;
    config::add_unit(unit)?;
    Ok(())
}

pub fn export(units: &[String]) -> Result<()> {
    for u in units {
        if !valid_unit(u) {
            bail!("not a unit name: {u:?} (expected e.g. docker.service)");
        }
    }
    let exe = installed_exe();
    if !exe.exists() {
        bail!("{SERVICE_NAME} is not installed (run `bunos-wsl-service install` first)");
    }
    let scm = scm_admin()?;
    let cfg = Config::load()?;
    let rows = list_rows(&Runner::Current, &cfg.distro).unwrap_or_default();
    for u in units {
        let desc = rows
            .iter()
            .find(|r| &r.unit == u)
            .map(|r| r.description.as_str());
        export_one(&scm, &exe, u, desc)?;
        println!("exported {u} as {}", windows_name(u));
    }
    Ok(())
}

pub fn unexport(units: &[String]) -> Result<()> {
    let scm = scm_admin()?;
    for u in units {
        let name = windows_name(u);
        // Removing the mirror leaves the unit itself alone: the Windows service is marked for deletion without a stop.
        if let Ok(s) = scm.open_service(&name, ServiceAccess::DELETE) {
            s.delete()?;
        }
        eventlog::unregister_source(&name);
        config::remove_unit(u);
        println!("removed {name}");
    }
    Ok(())
}

fn list_rows(runner: &Runner, distro: &str) -> Result<Vec<UnitRow>> {
    let t = Duration::from_secs(60);
    let units = runner.exec_root(
        distro,
        &[
            "systemctl",
            "list-units",
            "--type=service",
            "--all",
            "--no-legend",
            "--plain",
            "--no-pager",
        ],
        t,
    )?;
    let files = runner.exec_root(
        distro,
        &[
            "systemctl",
            "list-unit-files",
            "--type=service",
            "--no-legend",
            "--no-pager",
        ],
        t,
    )?;
    Ok(parse_list(&units, &files))
}

#[derive(Serialize)]
struct Row {
    #[serde(flatten)]
    unit: UnitRow,
    windows_service: Option<String>,
    windows_state: Option<String>,
}

fn windows_state(scm: Option<&ServiceManager>, name: &str) -> Option<String> {
    let s = scm?.open_service(name, ServiceAccess::QUERY_STATUS).ok()?;
    Some(format!("{:?}", s.query_status().ok()?.current_state))
}

/// Read-only: every service unit of the distro, with its Windows mirror if it has one. Runs as the calling user, so it
/// starts the distro like any wsl.exe call when it is not running.
pub fn units(distro: Option<String>, json: bool, all: bool) -> Result<()> {
    let distro = distro
        .or_else(|| Config::load().ok().map(|c| c.distro))
        .unwrap_or_else(|| "bunos".into());
    let rows = list_rows(&Runner::Current, &distro)?;
    let scm = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT).ok();
    let mirrored = config::units();
    let out: Vec<Row> = rows
        .into_iter()
        .filter(|r| all || r.load != "not-loaded" || mirrored.contains(&r.unit))
        .map(|r| {
            let name = windows_name(&r.unit);
            let state = windows_state(scm.as_ref(), &name);
            Row {
                windows_service: state.as_ref().map(|_| name),
                windows_state: state,
                unit: r,
            }
        })
        .collect();
    if json {
        println!("{}", serde_json::to_string_pretty(&out)?);
        return Ok(());
    }
    println!(
        "{:<44} {:<9} {:<10} {:<10} {:<16} DESCRIPTION",
        "UNIT", "ACTIVE", "SUB", "ENABLED", "WINDOWS"
    );
    for r in out {
        println!(
            "{:<44} {:<9} {:<10} {:<10} {:<16} {}",
            r.unit.unit,
            r.unit.active,
            r.unit.sub,
            r.unit.enabled,
            r.windows_state.unwrap_or_else(|| "-".into()),
            r.unit.description
        );
    }
    Ok(())
}

#[derive(Serialize)]
struct Status {
    service: Option<String>,
    distro: Option<String>,
    user: Option<String>,
    last_ready_ms: Option<String>,
    last_systemd_state: Option<String>,
    last_guest_uptime_s: Option<String>,
    units: Vec<UnitStatus>,
}

#[derive(Serialize)]
struct UnitStatus {
    unit: String,
    windows_service: String,
    windows_state: Option<String>,
    active: Option<String>,
    sub: Option<String>,
    age_ms: Option<u64>,
}

pub fn status(json: bool) -> Result<()> {
    let scm = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT).ok();
    let cfg = Config::load().ok();
    let st = Status {
        service: windows_state(scm.as_ref(), SERVICE_NAME),
        distro: cfg.as_ref().map(|c| c.distro.clone()),
        user: cfg.as_ref().map(|c| c.user.clone()),
        last_ready_ms: config::get_status("LastReadyMs").filter(|s| !s.is_empty()),
        last_systemd_state: config::get_status("LastSystemdState"),
        last_guest_uptime_s: config::get_status("LastGuestUptimeS"),
        units: config::units()
            .into_iter()
            .map(|u| {
                let name = windows_name(&u);
                let s = config::read_unit_state(&u);
                UnitStatus {
                    windows_state: windows_state(scm.as_ref(), &name),
                    windows_service: name,
                    active: s.as_ref().map(|(s, _)| s.active.clone()),
                    sub: s.as_ref().map(|(s, _)| s.sub.clone()),
                    age_ms: s.map(|(_, a)| a),
                    unit: u,
                }
            })
            .collect(),
    };
    if json {
        println!("{}", serde_json::to_string_pretty(&st)?);
    } else {
        println!(
            "{SERVICE_NAME}: {}  distro {}  user {}  last ready {} ms (systemd {})",
            st.service.as_deref().unwrap_or("not installed"),
            st.distro.as_deref().unwrap_or("-"),
            st.user.as_deref().unwrap_or("-"),
            st.last_ready_ms.as_deref().unwrap_or("-"),
            st.last_systemd_state.as_deref().unwrap_or("-")
        );
        for u in st.units {
            println!(
                "  {:<40} windows {:<12} systemd {} ({})",
                u.unit,
                u.windows_state.as_deref().unwrap_or("-"),
                u.active.as_deref().unwrap_or("-"),
                u.sub.as_deref().unwrap_or("-")
            );
        }
    }
    Ok(())
}
