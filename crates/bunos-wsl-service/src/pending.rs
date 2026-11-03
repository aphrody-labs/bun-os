// SPDX-License-Identifier: Apache-2.0
//! Pending-state heartbeat. The SCM considers a service hung when a `*_PENDING` status keeps the same checkpoint past
//! its wait hint, and `Stop-Service` / `sc stop` callers wait on that status. Instead of one long wait hint reported
//! once (the old 100 s stop), the service reports a short hint and bumps the checkpoint every second for as long as
//! the work really runs, so callers see progress, and a stuck step is cut by its own deadline rather than by the SCM.
//! See <https://learn.microsoft.com/windows/win32/services/service-status-transitions>.

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::Duration,
};
use windows_service::{
    service::{ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType},
    service_control_handler::ServiceStatusHandle,
};

/// Wait hint reported with every checkpoint: short, because the checkpoint moves every second.
pub const HINT: Duration = Duration::from_secs(5);

pub struct Pending {
    run: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Pending {
    /// Reports `state` (StartPending or StopPending) now and every second until dropped.
    pub fn start(h: ServiceStatusHandle, state: ServiceState) -> Self {
        let run = Arc::new(AtomicBool::new(true));
        let flag = run.clone();
        let report = move |checkpoint: u32| {
            let _ = h.set_service_status(ServiceStatus {
                service_type: ServiceType::OWN_PROCESS,
                current_state: state,
                controls_accepted: ServiceControlAccept::empty(),
                exit_code: ServiceExitCode::NO_ERROR,
                checkpoint,
                wait_hint: HINT,
                process_id: None,
            });
        };
        report(1);
        let thread = std::thread::spawn(move || {
            let mut checkpoint = 1u32;
            while flag.load(Ordering::Acquire) {
                // Sleep in short slices so dropping the guard does not wait a full second.
                for _ in 0..10 {
                    std::thread::sleep(Duration::from_millis(100));
                    if !flag.load(Ordering::Acquire) {
                        return;
                    }
                }
                checkpoint = checkpoint.wrapping_add(1).max(1);
                report(checkpoint);
            }
        });
        Self {
            run,
            thread: Some(thread),
        }
    }
}

impl Drop for Pending {
    fn drop(&mut self) {
        self.run.store(false, Ordering::Release);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}
