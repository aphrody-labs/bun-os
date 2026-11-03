// SPDX-License-Identifier: Apache-2.0
//! `BunOSWsl.<unit>`: one Windows service per mirrored systemd unit. Start runs `systemctl start`, stop runs
//! `systemctl stop`; while running it follows the state the instance service publishes and stops itself when the unit
//! stops inside the distro (exit code 0 for inactive, service-specific 1 for failed). The unit's journal and state
//! changes are logged by the instance service under this service's event source.

use crate::{
    config::{self, Config},
    eventlog::EventLog,
    units::windows_name,
    user::{Runner, UserSession},
};
use anyhow::Result;
use std::{
    ffi::OsString,
    sync::{Arc, OnceLock, mpsc},
    time::{Duration, Instant},
};
use windows_service::{
    define_windows_service,
    service::{ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType},
    service_control_handler::{self, ServiceControlHandlerResult, ServiceStatusHandle},
    service_dispatcher,
};

static UNIT: OnceLock<String> = OnceLock::new();

define_windows_service!(ffi_proxy_main, proxy_main);

pub fn dispatch(unit: &str) -> Result<()> {
    UNIT.set(unit.to_string()).ok();
    service_dispatcher::start(windows_name(unit), ffi_proxy_main)?;
    Ok(())
}

const EXIT_FAILED: u32 = 1;
const EXIT_START: u32 = 2;
const EXIT_INSTANCE_GONE: u32 = 3;

fn set(h: &ServiceStatusHandle, state: ServiceState, exit: ServiceExitCode, checkpoint: u32, wait: Duration) {
    let controls = if state == ServiceState::Running { ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN } else { ServiceControlAccept::empty() };
    let _ = h.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: controls,
        exit_code: exit,
        checkpoint,
        wait_hint: wait,
        process_id: None,
    });
}

enum Msg {
    Stop,
    Shutdown,
}

fn proxy_main(_args: Vec<OsString>) {
    let unit = UNIT.get().cloned().unwrap_or_default();
    let name = windows_name(&unit);
    let log = EventLog::open(&name);
    let (tx, rx) = mpsc::channel();
    let h = match service_control_handler::register(&name, move |c| match c {
        ServiceControl::Stop => {
            let _ = tx.send(Msg::Stop);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Shutdown => {
            let _ = tx.send(Msg::Shutdown);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    }) {
        Ok(h) => h,
        Err(e) => {
            log.error(&format!("RegisterServiceCtrlHandler: {e}"));
            return;
        }
    };
    let code = run(&h, &log, &unit, rx);
    set(&h, ServiceState::Stopped, code, 0, Duration::ZERO);
}

fn runner(cfg: &Config, cache: &mut Option<Runner>) -> Result<Runner> {
    if let Some(r) = cache {
        return Ok(r.clone());
    }
    let r = Runner::As(Arc::new(UserSession::s4u(&cfg.user)?));
    *cache = Some(r.clone());
    Ok(r)
}

fn run(h: &ServiceStatusHandle, log: &EventLog, unit: &str, rx: mpsc::Receiver<Msg>) -> ServiceExitCode {
    set(h, ServiceState::StartPending, ServiceExitCode::NO_ERROR, 1, Duration::from_secs(120));
    let cfg = match Config::load() {
        Ok(c) => c,
        Err(e) => {
            log.error(&format!("{e:#}"));
            return ServiceExitCode::ServiceSpecific(EXIT_START);
        }
    };
    let mut cache = None;
    let fresh = |age: u64| age < u64::from(cfg.state_period) * 1000 + 5000;
    let already = config::read_unit_state(unit).is_some_and(|(s, age)| s.is_running() && fresh(age));
    if !already {
        let r = match runner(&cfg, &mut cache) {
            Ok(r) => r,
            Err(e) => {
                log.error(&format!("{e:#}"));
                return ServiceExitCode::ServiceSpecific(EXIT_START);
            }
        };
        if let Err(e) = r.exec_root(&cfg.distro, &["systemctl", "start", "--", unit], Duration::from_secs(110)) {
            log.error(&format!("systemctl start {unit}: {e:#}"));
            return ServiceExitCode::ServiceSpecific(EXIT_START);
        }
    }
    set(h, ServiceState::Running, ServiceExitCode::NO_ERROR, 0, Duration::ZERO);
    let started = Instant::now();
    let mut down = 0;
    loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            // Install/uninstall stop the services to replace or remove the binary: leave the unit running.
            Ok(Msg::Stop) if config::get_status("Detach").as_deref() == Some("1") => return ServiceExitCode::NO_ERROR,
            Ok(Msg::Stop) => {
                set(h, ServiceState::StopPending, ServiceExitCode::NO_ERROR, 1, Duration::from_secs(100));
                match runner(&cfg, &mut cache).and_then(|r| r.exec_root(&cfg.distro, &["systemctl", "stop", "--", unit], Duration::from_secs(95))) {
                    Ok(_) => return ServiceExitCode::NO_ERROR,
                    Err(e) => {
                        log.error(&format!("systemctl stop {unit}: {e:#}"));
                        return ServiceExitCode::ServiceSpecific(EXIT_FAILED);
                    }
                }
            }
            // System shutdown: the instance service terminates the distro; systemd stops the unit itself.
            Ok(Msg::Shutdown) => return ServiceExitCode::NO_ERROR,
            Err(mpsc::RecvTimeoutError::Disconnected) => return ServiceExitCode::NO_ERROR,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        // Give the instance service a few publishes to see the unit active after our start.
        if started.elapsed() < Duration::from_secs(u64::from(cfg.state_period) * 2 + 3) {
            continue;
        }
        match config::read_unit_state(unit) {
            Some((s, age)) if fresh(age) => {
                if s.is_running() {
                    down = 0;
                } else {
                    down += 1;
                    if down >= 2 {
                        let failed = s.active == "failed";
                        log.report(
                            if failed { crate::eventlog::Level::Error } else { crate::eventlog::Level::Info },
                            crate::eventlog::ID_LIFECYCLE,
                            &format!("{unit} is {} ({}) in the distro; the Windows service stops with it.", s.active, s.result),
                        );
                        return if failed { ServiceExitCode::ServiceSpecific(EXIT_FAILED) } else { ServiceExitCode::NO_ERROR };
                    }
                }
            }
            _ => {
                down += 1;
                if down >= 30 {
                    log.warn("No state from the BunOSWsl service for 30 s; stopping.");
                    return ServiceExitCode::ServiceSpecific(EXIT_INSTANCE_GONE);
                }
            }
        }
    }
}
