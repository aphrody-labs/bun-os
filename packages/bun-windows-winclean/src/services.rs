// SPDX-License-Identifier: Apache-2.0
//! Windows services through the Service Control Manager API (`OpenSCManagerW`,
//! `EnumServicesStatusExW`, `OpenServiceW`, `QueryServiceStatusEx`, `QueryServiceConfigW`,
//! `StartServiceW`, `ControlService`) instead of `sc.exe`. State and start-type names follow
//! .NET `ServiceControllerStatus` / `ServiceStartMode`, the WinClean vocabulary.

use std::io;

use crate::system::{ServiceInfo, ServiceListResponse};

/// How long `start`/`stop` wait for the target state (per phase for `restart`).
const STATE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// List Win32 services, optionally filtered by a case-insensitive name substring and by an
/// exact (case-insensitive) status name.
pub fn list_services(
    name_filter: Option<&str>,
    status_filter: Option<&str>,
) -> io::Result<ServiceListResponse> {
    let name_needle = name_filter
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    let status_needle = status_filter
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    let services: Vec<ServiceInfo> = imp::enumerate()?
        .into_iter()
        .filter(|service| {
            name_needle
                .as_ref()
                .is_none_or(|needle| service.name.to_ascii_lowercase().contains(needle))
                && status_needle
                    .as_ref()
                    .is_none_or(|needle| service.status.to_ascii_lowercase() == *needle)
        })
        .map(|mut service| {
            service.start_type = imp::start_type(&service.name);
            service
        })
        .collect();
    Ok(ServiceListResponse {
        count: services.len(),
        services,
    })
}

/// `start`, `stop` or `restart` one service and wait for the resulting state.
pub fn control_service(action: &str, name: &str) -> io::Result<String> {
    let service = name.trim();
    if service.is_empty()
        || !service
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'$'))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid service name",
        ));
    }
    let verb = match action {
        "start" => "Started",
        "stop" => "Stopped",
        "restart" => "Restarted",
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "unsupported service action",
            ));
        }
    };
    imp::control(action, service, STATE_TIMEOUT)?;
    Ok(format!("{verb} service '{service}'."))
}

/// Start type code of one service, `None` when it does not exist.
#[cfg(windows)]
pub(crate) fn start_type_code(name: &str) -> io::Result<Option<u32>> {
    imp::start_type_code(name)
}

/// Change the start type of one service.
#[cfg(windows)]
pub(crate) fn set_start_type(name: &str, code: u32) -> io::Result<()> {
    imp::set_start_type(name, code)
}

/// Current state name of one service (`Running`, `Stopped`, …).
#[cfg(windows)]
pub(crate) fn service_status(name: &str) -> io::Result<String> {
    imp::status(name)
}

/// `SERVICE_STATUS_CURRENT_STATE` (1..=7) to its `ServiceControllerStatus` name.
#[cfg(any(windows, test))]
fn state_name(state: u32) -> &'static str {
    match state {
        1 => "Stopped",
        2 => "StartPending",
        3 => "StopPending",
        4 => "Running",
        5 => "ContinuePending",
        6 => "PausePending",
        7 => "Paused",
        _ => "Unknown",
    }
}

/// `SERVICE_START_TYPE` (0..=4) to its `ServiceStartMode` name.
#[cfg(any(windows, test))]
fn start_type_name(start_type: u32) -> &'static str {
    match start_type {
        0 => "Boot",
        1 => "System",
        2 => "Automatic",
        3 => "Manual",
        4 => "Disabled",
        _ => "Unknown",
    }
}

#[cfg(windows)]
mod imp {
    use std::{io, time::Duration};

    use windows::Win32::{
        Foundation::{
            ERROR_INSUFFICIENT_BUFFER, ERROR_MORE_DATA, ERROR_SERVICE_ALREADY_RUNNING,
            ERROR_SERVICE_NOT_ACTIVE,
        },
        System::Services::{
            CloseServiceHandle, ControlService, ENUM_SERVICE_STATUS_PROCESSW,
            EnumServicesStatusExW, OpenSCManagerW, OpenServiceW, QUERY_SERVICE_CONFIGW,
            QueryServiceConfigW, QueryServiceStatusEx, SC_ENUM_PROCESS_INFO, SC_HANDLE,
            SC_MANAGER_CONNECT, SC_MANAGER_ENUMERATE_SERVICE, SC_STATUS_PROCESS_INFO,
            SERVICE_CONTROL_STOP, SERVICE_QUERY_CONFIG, SERVICE_QUERY_STATUS, SERVICE_RUNNING,
            SERVICE_START, SERVICE_STATE_ALL, SERVICE_STATUS, SERVICE_STATUS_PROCESS, SERVICE_STOP,
            SERVICE_STOPPED, SERVICE_WIN32, StartServiceW,
        },
    };

    use super::{start_type_name, state_name};
    use crate::{
        system::ServiceInfo,
        win32::{from_wide_ptr, hresult_error, pcwstr, wide, win32_code},
    };

    /// A service or SCM handle, closed on drop.
    struct Handle(SC_HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: the handle came from OpenSCManagerW/OpenServiceW and is closed once.
            let _ = unsafe { CloseServiceHandle(self.0) };
        }
    }

    fn manager(access: u32) -> io::Result<Handle> {
        // SAFETY: local machine, default database.
        unsafe { OpenSCManagerW(None, None, access) }
            .map(Handle)
            .map_err(|error| hresult_error(&error, "open the service control manager"))
    }

    fn open(name: &str, access: u32) -> io::Result<Handle> {
        let scm = manager(SC_MANAGER_CONNECT)?;
        let wide_name = wide(name);
        // SAFETY: `wide_name` is NUL-terminated and `scm` is open.
        unsafe { OpenServiceW(scm.0, pcwstr(&wide_name), access) }
            .map(Handle)
            .map_err(|error| hresult_error(&error, &format!("open service '{name}'")))
    }

    fn query_status(service: &Handle, name: &str) -> io::Result<SERVICE_STATUS_PROCESS> {
        let mut status = SERVICE_STATUS_PROCESS::default();
        let mut needed = 0u32;
        // SAFETY: the byte view covers exactly one SERVICE_STATUS_PROCESS.
        let bytes = unsafe {
            std::slice::from_raw_parts_mut(
                (&raw mut status).cast::<u8>(),
                std::mem::size_of::<SERVICE_STATUS_PROCESS>(),
            )
        };
        // SAFETY: `service` was opened with SERVICE_QUERY_STATUS.
        unsafe {
            QueryServiceStatusEx(service.0, SC_STATUS_PROCESS_INFO, Some(bytes), &mut needed)
        }
        .map_err(|error| hresult_error(&error, &format!("query service '{name}'")))?;
        Ok(status)
    }

    pub(super) fn status(name: &str) -> io::Result<String> {
        let service = open(name, SERVICE_QUERY_STATUS)?;
        Ok(state_name(query_status(&service, name)?.dwCurrentState.0).to_owned())
    }

    pub(super) fn enumerate() -> io::Result<Vec<ServiceInfo>> {
        let scm = manager(SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE)?;
        // u64 storage keeps the pointer-bearing records 8-byte aligned.
        let mut buffer = vec![0u64; 64 * 1024 / 8];
        let mut resume = 0u32;
        let mut services = Vec::new();
        loop {
            let mut needed = 0u32;
            let mut returned = 0u32;
            // SAFETY: the byte view covers the whole u64 buffer.
            let bytes = unsafe {
                std::slice::from_raw_parts_mut(buffer.as_mut_ptr().cast::<u8>(), buffer.len() * 8)
            };
            // SAFETY: `scm` has SC_MANAGER_ENUMERATE_SERVICE; the out-pointers are valid.
            let result = unsafe {
                EnumServicesStatusExW(
                    scm.0,
                    SC_ENUM_PROCESS_INFO,
                    SERVICE_WIN32,
                    SERVICE_STATE_ALL,
                    Some(bytes),
                    &mut needed,
                    &mut returned,
                    Some(&mut resume),
                    None,
                )
            };
            let more = match &result {
                Ok(()) => false,
                Err(error) if win32_code(error) == Some(ERROR_MORE_DATA) => true,
                Err(error) => return Err(hresult_error(error, "enumerate services")),
            };
            // SAFETY: the API wrote `returned` records at the start of the buffer; their string
            // pointers point into the same buffer, which is alive until the next iteration.
            let records = unsafe {
                std::slice::from_raw_parts(
                    buffer.as_ptr().cast::<ENUM_SERVICE_STATUS_PROCESSW>(),
                    returned as usize,
                )
            };
            for record in records {
                services.push(ServiceInfo {
                    // SAFETY: the names are NUL-terminated strings inside `buffer`.
                    name: unsafe { from_wide_ptr(record.lpServiceName.0) },
                    // SAFETY: as above.
                    display_name: unsafe { from_wide_ptr(record.lpDisplayName.0) },
                    status: state_name(record.ServiceStatusProcess.dwCurrentState.0).to_owned(),
                    start_type: "Unknown".to_owned(),
                });
            }
            if !more {
                return Ok(services);
            }
            if returned == 0 {
                buffer.resize((needed as usize).div_ceil(8).max(buffer.len() * 2), 0);
            }
        }
    }

    /// Start type code of one service (`SERVICE_START_TYPE`), `None` when the service does not exist.
    pub(super) fn start_type_code(name: &str) -> io::Result<Option<u32>> {
        let service = match open(name, SERVICE_QUERY_CONFIG) {
            Ok(service) => service,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let mut needed = 0u32;
        // SAFETY: size probe with no buffer.
        let probe = unsafe { QueryServiceConfigW(service.0, None, 0, &mut needed) };
        if probe.as_ref().err().and_then(win32_code) != Some(ERROR_INSUFFICIENT_BUFFER) {
            return Err(io::Error::other(format!("query service {name} configuration")));
        }
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let size = u32::try_from(buffer.len() * 8).unwrap_or(u32::MAX);
        let config = buffer.as_mut_ptr().cast::<QUERY_SERVICE_CONFIGW>();
        // SAFETY: `buffer` is 8-byte aligned and holds `size` bytes.
        unsafe { QueryServiceConfigW(service.0, Some(config), size, &mut needed) }
            .map_err(|error| hresult_error(&error, &format!("query service {name} configuration")))?;
        // SAFETY: the API filled a QUERY_SERVICE_CONFIGW at the start of the buffer.
        Ok(Some(unsafe { (*config).dwStartType.0 }))
    }

    /// Change the start type of one service (`ChangeServiceConfigW`, nothing else is altered).
    pub(super) fn set_start_type(name: &str, code: u32) -> io::Result<()> {
        use windows::Win32::System::Services::{
            ChangeServiceConfigW, ENUM_SERVICE_TYPE, SERVICE_CHANGE_CONFIG, SERVICE_ERROR, SERVICE_START_TYPE,
        };
        const SERVICE_NO_CHANGE: u32 = 0xFFFF_FFFF;
        let service = open(name, SERVICE_CHANGE_CONFIG)?;
        // SAFETY: `service` is open with SERVICE_CHANGE_CONFIG; every other field is SERVICE_NO_CHANGE / null.
        unsafe {
            ChangeServiceConfigW(
                service.0,
                ENUM_SERVICE_TYPE(SERVICE_NO_CHANGE),
                SERVICE_START_TYPE(code),
                SERVICE_ERROR(SERVICE_NO_CHANGE),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
        }
        .map_err(|error| hresult_error(&error, &format!("change service {name} start type")))
    }

    /// Start type of one service; `Unknown` when its configuration is not readable.
    pub(super) fn start_type(name: &str) -> String {
        let Ok(service) = open(name, SERVICE_QUERY_CONFIG) else {
            return "Unknown".to_owned();
        };
        let mut needed = 0u32;
        // SAFETY: size probe with no buffer.
        let probe = unsafe { QueryServiceConfigW(service.0, None, 0, &mut needed) };
        if probe.as_ref().err().and_then(win32_code) != Some(ERROR_INSUFFICIENT_BUFFER) {
            return "Unknown".to_owned();
        }
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let size = u32::try_from(buffer.len() * 8).unwrap_or(u32::MAX);
        let config = buffer.as_mut_ptr().cast::<QUERY_SERVICE_CONFIGW>();
        // SAFETY: `buffer` is 8-byte aligned and holds `size` bytes.
        if unsafe { QueryServiceConfigW(service.0, Some(config), size, &mut needed) }.is_err() {
            return "Unknown".to_owned();
        }
        // SAFETY: the API filled a QUERY_SERVICE_CONFIGW at the start of the buffer.
        start_type_name(unsafe { (*config).dwStartType.0 }).to_owned()
    }

    fn wait_for(service: &Handle, name: &str, target: u32, timeout: Duration) -> io::Result<()> {
        let started = std::time::Instant::now();
        loop {
            let current = query_status(service, name)?.dwCurrentState.0;
            if current == target {
                return Ok(());
            }
            if started.elapsed() >= timeout {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!(
                        "service '{name}' did not reach {} within {}s (current state: {})",
                        state_name(target),
                        timeout.as_secs(),
                        state_name(current)
                    ),
                ));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn start(service: &Handle, name: &str, timeout: Duration) -> io::Result<()> {
        // SAFETY: `service` was opened with SERVICE_START; no service arguments.
        match unsafe { StartServiceW(service.0, None) } {
            Ok(()) => {}
            Err(error) if win32_code(&error) == Some(ERROR_SERVICE_ALREADY_RUNNING) => {}
            Err(error) => return Err(hresult_error(&error, &format!("start service '{name}'"))),
        }
        wait_for(service, name, SERVICE_RUNNING.0, timeout)
    }

    fn stop(service: &Handle, name: &str, timeout: Duration) -> io::Result<()> {
        let mut status = SERVICE_STATUS::default();
        // SAFETY: `service` was opened with SERVICE_STOP; `status` receives the last status.
        match unsafe { ControlService(service.0, SERVICE_CONTROL_STOP, &mut status) } {
            Ok(()) => {}
            Err(error) if win32_code(&error) == Some(ERROR_SERVICE_NOT_ACTIVE) => {}
            Err(error) => return Err(hresult_error(&error, &format!("stop service '{name}'"))),
        }
        wait_for(service, name, SERVICE_STOPPED.0, timeout)
    }

    pub(super) fn control(action: &str, name: &str, timeout: Duration) -> io::Result<()> {
        let service = open(name, SERVICE_START | SERVICE_STOP | SERVICE_QUERY_STATUS)?;
        match action {
            "start" => start(&service, name, timeout),
            "stop" => stop(&service, name, timeout),
            _ => {
                stop(&service, name, timeout)?;
                start(&service, name, timeout)
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::{io, time::Duration};

    use crate::system::ServiceInfo;

    fn unsupported() -> io::Error {
        io::Error::new(io::ErrorKind::Unsupported, "services are Windows-only")
    }

    pub(super) fn enumerate() -> io::Result<Vec<ServiceInfo>> {
        Err(unsupported())
    }

    pub(super) fn start_type(_name: &str) -> String {
        "Unknown".to_owned()
    }

    pub(super) fn control(_action: &str, _name: &str, _timeout: Duration) -> io::Result<()> {
        Err(unsupported())
    }
}

#[cfg(test)]
mod tests {
    use super::{control_service, start_type_name, state_name};

    #[test]
    fn names_follow_the_servicecontroller_vocabulary() {
        assert_eq!(state_name(1), "Stopped");
        assert_eq!(state_name(4), "Running");
        assert_eq!(state_name(7), "Paused");
        assert_eq!(start_type_name(2), "Automatic");
        assert_eq!(start_type_name(3), "Manual");
        assert_eq!(start_type_name(4), "Disabled");
    }

    #[test]
    fn invalid_names_and_actions_are_rejected_before_the_scm() {
        for name in ["", "bad;service", "a b", "x\"y"] {
            assert_eq!(
                control_service("start", name).expect_err(name).kind(),
                std::io::ErrorKind::InvalidInput
            );
        }
        assert_eq!(
            control_service("pause", "EventLog")
                .expect_err("pause")
                .kind(),
            std::io::ErrorKind::InvalidInput
        );
    }

    #[cfg(windows)]
    #[test]
    fn builtin_event_log_service_is_listed_and_queried() {
        let listed = super::list_services(Some("eventlog"), None).expect("enumerate services");
        let service = listed
            .services
            .iter()
            .find(|service| service.name.eq_ignore_ascii_case("EventLog"))
            .expect("the EventLog service is always installed");
        assert_eq!(service.status, "Running");
        assert_eq!(service.start_type, "Automatic");
        assert!(!service.display_name.is_empty());
        assert_eq!(
            super::service_status("EventLog").expect("query EventLog"),
            "Running"
        );

        let running = super::list_services(None, Some("running")).expect("filter by status");
        assert!(running.count > 0);
        assert!(
            running
                .services
                .iter()
                .all(|service| service.status == "Running")
        );
        let all = super::list_services(None, None).expect("all services");
        assert!(all.count > running.count);
    }

    #[cfg(windows)]
    #[test]
    fn missing_services_map_to_not_found() {
        let error = super::service_status("AphrodyNoSuchService").expect_err("absent service");
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
        let error = control_service("start", "AphrodyNoSuchService").expect_err("absent service");
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
    }
}
