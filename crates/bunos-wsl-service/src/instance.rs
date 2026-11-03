// SPDX-License-Identifier: Apache-2.0
//! The `BunOSWsl` service: starts the distro at boot as its owner, keeps one wsl.exe client attached (so neither the
//! instance nor the utility VM idles out), reports RUNNING once systemd is up, restarts the instance when it goes away,
//! publishes the state of mirrored units and forwards their journal to the event log.

use crate::{
    config::{self, Config},
    eventlog::{EventLog, ID_JOURNAL, ID_UNIT_STATE, Level},
    units::{Line, SERVICE_NAME, UnitState, classify, monitor_script, parse_show, windows_name},
    user::{Proc, Runner, UserSession},
};
use anyhow::Result;
use std::{
    collections::HashMap,
    ffi::OsString,
    io::{BufRead, BufReader, Read},
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};
use windows_service::{
    define_windows_service,
    service::{ServiceAccess, ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType},
    service_control_handler::{self, ServiceControlHandlerResult, ServiceStatusHandle},
    service_dispatcher,
    service_manager::{ServiceManager, ServiceManagerAccess},
};

define_windows_service!(ffi_instance_main, instance_main);

pub fn dispatch() -> Result<()> {
    service_dispatcher::start(SERVICE_NAME, ffi_instance_main)?;
    Ok(())
}

enum Msg {
    Stop,
    Line(u64, Line),
    Eof(u64, String),
}

/// Exit codes reported to SCM as service-specific errors (they trigger the recovery actions).
const EXIT_CONFIG: u32 = 1;
const EXIT_LOGON: u32 = 2;
const EXIT_INSTANCE: u32 = 3;

fn instance_main(_args: Vec<OsString>) {
    let log = EventLog::open(SERVICE_NAME);
    let (tx, rx) = mpsc::channel();
    let ctl = tx.clone();
    let handle = match service_control_handler::register(SERVICE_NAME, move |c| match c {
        ServiceControl::Stop | ServiceControl::Preshutdown => {
            let _ = ctl.send(Msg::Stop);
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
    let code = run(&handle, &log, tx, rx);
    let _ = set(&handle, ServiceState::Stopped, code, 0, Duration::ZERO);
}

fn set(h: &ServiceStatusHandle, state: ServiceState, exit: ServiceExitCode, checkpoint: u32, wait: Duration) -> windows_service::Result<()> {
    let controls = if state == ServiceState::Running { ServiceControlAccept::STOP | ServiceControlAccept::PRESHUTDOWN } else { ServiceControlAccept::empty() };
    h.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: controls,
        exit_code: exit,
        checkpoint,
        wait_hint: wait,
        process_id: None,
    })
}

struct Keeper {
    proc: Proc,
    started: Instant,
    /// Replaces a running keeper after a unit-list change: its READY is not a restart.
    reload: bool,
    generation: u64,
    units: Vec<String>,
}

fn spawn_keeper(runner: &Runner, cfg: &Config, units: Vec<String>, generation: u64, tx: &mpsc::Sender<Msg>) -> Result<Keeper> {
    let mut args = vec!["-d".to_string(), cfg.distro.clone(), "-u".into(), "root".into(), "--exec".into(), "/bin/sh".into(), "-c".into()];
    args.push(monitor_script(&units, cfg.state_period));
    let mut proc = runner.spawn(&args)?;
    let stdout = proc.stdout.take().unwrap();
    let mut stderr = proc.stderr.take().unwrap();
    let tx = tx.clone();
    std::thread::spawn(move || {
        let err = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = stderr.read_to_end(&mut b);
            b
        });
        for line in BufReader::new(stdout).split(b'\n') {
            let Ok(line) = line else { break };
            let _ = tx.send(Msg::Line(generation, classify(&String::from_utf8_lossy(&line))));
        }
        let err = err.join().unwrap_or_default();
        let _ = tx.send(Msg::Eof(generation, crate::units::decode_wsl(&err).trim().to_string()));
    });
    Ok(Keeper { proc, generation, units, started: Instant::now(), reload: false })
}

/// Caps journal forwarding so a chatty unit cannot flood the Application log.
struct RateLimit {
    window: Instant,
    count: u32,
    dropped: u32,
}

const JOURNAL_PER_10S: u32 = 200;

fn run(h: &ServiceStatusHandle, log: &EventLog, tx: mpsc::Sender<Msg>, rx: mpsc::Receiver<Msg>) -> ServiceExitCode {
    let start = Instant::now();
    let mut checkpoint = 1;
    let _ = set(h, ServiceState::StartPending, ServiceExitCode::NO_ERROR, checkpoint, Duration::from_secs(30));
    let cfg = match Config::load() {
        Ok(c) => c,
        Err(e) => {
            log.error(&format!("configuration: {e:#}"));
            return ServiceExitCode::ServiceSpecific(EXIT_CONFIG);
        }
    };
    let session = match UserSession::s4u(&cfg.user) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            log.error(&format!("{e:#}"));
            return ServiceExitCode::ServiceSpecific(EXIT_LOGON);
        }
    };
    let logon_ms = start.elapsed().as_millis();
    let runner = Runner::As(session.clone());
    config::set_status("LastStart", &config::now_ms().to_string());
    config::set_status("LastReadyMs", "");

    let mut generation = 0u64;
    let mut keeper = match spawn_keeper(&runner, &cfg, config::units(), generation, &tx) {
        Ok(k) => Some(k),
        Err(e) => {
            log.error(&format!("starting the instance: {e:#}"));
            return ServiceExitCode::ServiceSpecific(EXIT_INSTANCE);
        }
    };
    let mut ready = false;
    let mut failures: Vec<Instant> = Vec::new();
    let mut retry_at: Option<Instant> = None;
    let mut show = String::new();
    let mut last: HashMap<String, UnitState> = HashMap::new();
    let mut sources: HashMap<String, EventLog> = HashMap::new();
    let mut rate = RateLimit { window: Instant::now(), count: 0, dropped: 0 };
    let mut units_checked = Instant::now();
    let scm = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT).ok();

    let exit = loop {
        let msg = rx.recv_timeout(Duration::from_secs(1));
        match msg {
            Ok(Msg::Stop) => break ServiceExitCode::NO_ERROR,
            Ok(Msg::Line(g, line)) if keeper.as_ref().is_some_and(|k| k.generation == g) => match line {
                Line::Ready { state, uptime_s } => {
                    let k = keeper.as_ref().expect("generation matched");
                    // From service start for the first instance, from the respawn for later ones.
                    let ms = if ready { k.started.elapsed() } else { start.elapsed() }.as_millis();
                    if !k.reload {
                        config::set_status("LastReadyMs", &ms.to_string());
                        config::set_status("LastSystemdState", &state);
                        config::set_status("LastGuestUptimeS", &format!("{uptime_s:.2}"));
                    }
                    if !ready {
                        ready = true;
                        let _ = set(h, ServiceState::Running, ServiceExitCode::NO_ERROR, 0, Duration::ZERO);
                        log.info(&format!(
                            "Bun OS distro '{}' is up as {} (systemd {state}): {ms} ms from service start to systemd ready                              (S4U logon and profile {logon_ms} ms, guest uptime {uptime_s:.2} s, keeper wsl.exe PID {}).",
                            cfg.distro, session.account, k.proc.pid
                        ));
                    } else if !k.reload {
                        log.info(&format!(
                            "Bun OS distro '{}' is back (systemd {state}): {ms} ms from respawn to systemd ready, guest uptime {uptime_s:.2} s.",
                            cfg.distro
                        ));
                    }
                    failures.retain(|t| t.elapsed() < Duration::from_secs(600));
                }
                Line::Show(l) => {
                    show.push_str(&l);
                    show.push('\n');
                }
                Line::End => {
                    for s in parse_show(&std::mem::take(&mut show)) {
                        publish(&s, last.get(&s.id), &mut sources, scm.as_ref());
                        last.insert(s.id.clone(), s);
                    }
                }
                Line::Journal(e) => {
                    if rate.window.elapsed() > Duration::from_secs(10) {
                        if rate.dropped > 0 {
                            log.warn(&format!("{} journal entries were not forwarded (limit {JOURNAL_PER_10S} per 10 s).", rate.dropped));
                        }
                        rate = RateLimit { window: Instant::now(), count: 0, dropped: 0 };
                    }
                    rate.count += 1;
                    if rate.count > JOURNAL_PER_10S {
                        rate.dropped += 1;
                    } else {
                        // Only registered sources (the mirrored units), so Event Viewer can render every entry.
                        let mirrored = keeper.as_ref().map(|k| k.units.as_slice()).unwrap_or_default();
                        match e.units.iter().find(|u| mirrored.contains(u)) {
                            Some(u) => sources
                                .entry(u.clone())
                                .or_insert_with(|| EventLog::open(&windows_name(u)))
                                .report(Level::from_priority(e.priority), ID_JOURNAL, &e.message),
                            None => log.report(Level::from_priority(e.priority), ID_JOURNAL, &e.message),
                        }
                    }
                }
            },
            Ok(Msg::Eof(g, err)) if keeper.as_ref().is_some_and(|k| k.generation == g) => {
                let code = keeper.as_ref().and_then(|k| k.proc.wait(Some(Duration::from_secs(5))));
                keeper = None;
                failures.push(Instant::now());
                let recent = failures.iter().filter(|t| t.elapsed() < Duration::from_secs(120)).count();
                log.warn(&format!(
                    "The Bun OS distro '{}' stopped (wsl.exe exit {code:?}{}); restarting it ({recent} in the last 2 min).",
                    cfg.distro,
                    if err.is_empty() { String::new() } else { format!(": {err}") }
                ));
                if recent >= 5 {
                    log.error("The distro keeps stopping; giving up so the service recovery actions apply.");
                    break ServiceExitCode::ServiceSpecific(EXIT_INSTANCE);
                }
                retry_at = Some(Instant::now() + Duration::from_secs(1 << recent.min(4)));
            }
            Ok(_) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break ServiceExitCode::NO_ERROR,
        }
        if !ready {
            checkpoint += 1;
            let _ = set(h, ServiceState::StartPending, ServiceExitCode::NO_ERROR, checkpoint, Duration::from_secs(30));
        }
        if retry_at.is_some_and(|t| Instant::now() >= t) {
            retry_at = None;
            generation += 1;
            match spawn_keeper(&runner, &cfg, config::units(), generation, &tx) {
                Ok(k) => keeper = Some(k),
                Err(e) => {
                    log.error(&format!("restarting the instance: {e:#}"));
                    break ServiceExitCode::ServiceSpecific(EXIT_INSTANCE);
                }
            }
        }
        // The mirrored unit set changed (export/unexport): start the new monitor before stopping the old one, so a client
        // stays attached throughout.
        if units_checked.elapsed() > Duration::from_secs(5) {
            units_checked = Instant::now();
            let now = config::units();
            if let Some(k) = keeper.as_ref()
                && k.units != now
            {
                generation += 1;
                match spawn_keeper(&runner, &cfg, now, generation, &tx) {
                    Ok(mut n) => {
                        n.reload = true;
                        let old = keeper.replace(n);
                        if let Some(o) = old {
                            o.proc.kill();
                        }
                        show.clear();
                    }
                    Err(e) => log.error(&format!("reloading the unit list: {e:#}")),
                }
            }
        }
    };

    let _ = set(h, ServiceState::StopPending, ServiceExitCode::NO_ERROR, 1, Duration::from_secs(30));
    if let Some(k) = keeper.take() {
        k.proc.kill();
    }
    if cfg.terminate_on_stop {
        match runner.output(&["--terminate".into(), cfg.distro.clone()], Duration::from_secs(25)) {
            Ok((0, _, _)) => log.info(&format!("Bun OS distro '{}' terminated.", cfg.distro)),
            Ok((c, o, e)) => log.warn(&format!("wsl --terminate {} exited {c}: {}{}", cfg.distro, e.trim(), o.trim())),
            Err(e) => log.warn(&format!("wsl --terminate {}: {e:#}", cfg.distro)),
        }
    } else {
        log.info(&format!("Service stopped; distro '{}' left running (TerminateOnStop=0).", cfg.distro));
    }
    exit
}

/// Publishes a unit state to the registry, logs transitions, and starts the unit's Windows service when the unit
/// starts inside the distro (enabled at boot, socket activation, `systemctl start` in a shell).
fn publish(s: &UnitState, prev: Option<&UnitState>, sources: &mut HashMap<String, EventLog>, scm: Option<&ServiceManager>) {
    config::write_unit_state(s);
    let changed = prev.is_none_or(|p| p.active != s.active || p.sub != s.sub);
    if !changed {
        return;
    }
    let src = sources.entry(s.id.clone()).or_insert_with(|| EventLog::open(&windows_name(&s.id)));
    let level = if s.active == "failed" { Level::Error } else { Level::Info };
    src.report(level, ID_UNIT_STATE, &format!("{} is {} ({}), result {}, main PID {}.", s.id, s.active, s.sub, s.result, s.main_pid));
    let was_running = prev.is_some_and(UnitState::is_running);
    if s.is_running()
        && !was_running
        && let Some(scm) = scm
        && let Ok(svc) = scm.open_service(windows_name(&s.id), ServiceAccess::QUERY_STATUS | ServiceAccess::START)
        && svc.query_status().is_ok_and(|st| st.current_state == ServiceState::Stopped)
    {
        let _ = svc.start::<&str>(&[]);
    }
}
