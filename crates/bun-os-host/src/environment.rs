//! Bounded, read-only context inventory. Nothing here runs during VM startup,
//! enables privileged features, changes affinity, or contacts a cloud endpoint.

use std::io::{IsTerminal, Read};

use crate::schema::{EnvironmentInfo, HostInfo};

const MAX_PROBE_BYTES: u64 = 8192;

fn read(path: &str) -> Option<String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(MAX_PROBE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > usize::try_from(MAX_PROBE_BYTES).ok()? {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn populated(value: Option<String>) -> bool {
    value.is_some_and(|value| !value.trim().is_empty())
}

fn constrain_parallelism(result: &mut EnvironmentInfo, visible: Option<u32>) {
    result.available_parallelism = visible.filter(|count| *count > 0);
    if let Some(visible) = result.available_parallelism {
        result.recommended_workers = result.recommended_workers.max(1).min(visible);
    }
}

fn enabled(value: Option<String>) -> bool {
    value.is_some_and(|value| matches!(value.trim(), "1" | "true" | "TRUE"))
}

/// Pure policy over caller-provided facts; environment values never enter output.
pub fn classify(info: &HostInfo, get: impl Fn(&str) -> Option<String>) -> EnvironmentInfo {
    let mut result = EnvironmentInfo {
        elevation: "unknown".into(),
        ..EnvironmentInfo::default()
    };
    let vercel = enabled(get("VERCEL"));
    let lambda = populated(get("AWS_LAMBDA_FUNCTION_NAME"));
    let cloud_run = populated(get("K_SERVICE"));
    let azure_functions = populated(get("FUNCTIONS_WORKER_RUNTIME"));
    let netlify = enabled(get("NETLIFY"));
    for (known, provider) in [
        (vercel, "vercel"),
        (lambda, "aws-lambda"),
        (cloud_run, "google-cloud-run"),
        (azure_functions, "azure-functions"),
        (netlify, "netlify"),
        (enabled(get("CODESPACES")), "github-codespaces"),
        (populated(get("GITPOD_WORKSPACE_ID")), "gitpod"),
        (populated(get("FLY_APP_NAME")), "fly-io"),
        (populated(get("RAILWAY_ENVIRONMENT_ID")), "railway"),
    ] {
        if known {
            result.providers.push(provider.into());
        }
    }
    if vercel || lambda || cloud_run || azure_functions || netlify {
        result.serverless = Some(true);
    }
    if populated(get("KUBERNETES_SERVICE_HOST")) {
        result.container = Some("kubernetes-hint".into());
    }
    result.sudo_context = get("SUDO_UID").is_some_and(|uid| uid.parse::<u32>().is_ok());
    if info.os.family == "linux" {
        result.display_protocol = if populated(get("WAYLAND_DISPLAY")) {
            Some("wayland-hint".into())
        } else if populated(get("DISPLAY")) {
            Some("x11-hint".into())
        } else {
            None
        };
    } else if info.os.family == "windows" && populated(get("SESSIONNAME")) {
        result.display_protocol = Some("windows-session-hint".into());
    }
    result.display_advertised = result.display_protocol.is_some();
    let product = info.os.name.to_ascii_lowercase();
    result.windows_11 = if info.os.family == "windows" && product.contains("windows 11") {
        info.os
            .build
            .as_deref()
            .and_then(|build| build.parse::<u32>().ok())
            .map(|build| build >= 22000)
    } else if info.os.family == "windows" && product.contains("windows 10") {
        info.os
            .build
            .as_deref()
            .and_then(|build| build.parse::<u32>().ok())
            .filter(|build| *build < 22000)
            .map(|_| false)
    } else {
        None
    };
    let model = info.cpu.model.to_ascii_lowercase();
    result.cpu_vendor = ["intel", "amd", "apple"]
        .into_iter()
        .find(|vendor| model.contains(vendor))
        .map(str::to_string);
    for gpu in &info.gpus {
        if matches!(gpu.vendor.as_str(), "nvidia" | "amd" | "intel" | "apple")
            && !result.gpu_vendors.contains(&gpu.vendor)
        {
            result.gpu_vendors.push(gpu.vendor.clone());
        }
    }
    // Recommendations do not reserve RAM or prove the allocation will succeed.
    // Unknown / sub-256 MiB headroom serializes work rather than guessing capacity.
    let memory_workers = (info.memory.available_mib / 256)
        .max(1)
        .min(u64::from(u32::MAX));
    result.recommended_workers = info
        .cpu
        .logical_cores
        .max(1)
        .min(u32::try_from(memory_workers).unwrap_or(u32::MAX));
    result
}

fn process_status(result: &mut EnvironmentInfo, status: &str) {
    for line in status.lines() {
        if let Some(values) = line.strip_prefix("Uid:") {
            let mut values = values.split_whitespace();
            result.real_uid = values.next().and_then(|value| value.parse().ok());
            result.effective_uid = values.next().and_then(|value| value.parse().ok());
        } else if let Some(value) = line.strip_prefix("PPid:") {
            result.parent_pid = value.trim().parse().ok().filter(|pid| *pid > 0);
        }
    }
    result.elevation = match result.effective_uid {
        Some(0) => "root",
        Some(_) => "user",
        None => "unknown",
    }
    .into();
}

fn device_context(
    result: &mut EnvironmentInfo,
    model: Option<&str>,
    vendor: Option<&str>,
    product: Option<&str>,
) {
    let model = model.unwrap_or_default().to_ascii_lowercase();
    if model.contains("raspberry pi") {
        result.device = Some("raspberry-pi".into());
    } else if !model.trim_matches('\0').trim().is_empty() {
        result.device = Some("device-tree-board".into());
    }
    let dmi = format!(
        "{} {}",
        vendor.unwrap_or_default(),
        product.unwrap_or_default()
    )
    .to_ascii_lowercase();
    for (pattern, provider) in [
        ("amazon", "aws-ec2"),
        ("google", "google-compute"),
        ("openstack", "openstack"),
        ("digitalocean", "digitalocean"),
    ] {
        if dmi.contains(pattern) && !result.providers.iter().any(|value| value == provider) {
            result.providers.push(provider.into());
        }
    }
    result.virtualization = [
        "kvm",
        "qemu",
        "vmware",
        "virtualbox",
        "hyper-v",
        "openstack",
    ]
    .into_iter()
    .find(|value| dmi.contains(value))
    .map(str::to_string);
}

fn default_route(text: &str) -> bool {
    text.lines().skip(1).any(|line| {
        let fields: Vec<_> = line.split_whitespace().take(4).collect();
        fields.len() == 4
            && fields[1] == "00000000"
            && u32::from_str_radix(fields[3], 16)
                .is_ok_and(|flags| flags & 1 != 0 && flags & 0x200 == 0)
    })
}

fn default_ipv6_route(text: &str) -> bool {
    text.lines().any(|line| {
        let fields: Vec<_> = line.split_whitespace().take(10).collect();
        fields.len() == 10
            && fields[0] == "00000000000000000000000000000000"
            && fields[1] == "00"
            && u32::from_str_radix(fields[8], 16)
                .is_ok_and(|flags| flags & 1 != 0 && flags & 0x200 == 0)
    })
}

fn parent_name(result: &mut EnvironmentInfo, name: &str) {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 64
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return;
    }
    result.parent_name = Some(name.into());
    let shell = name.trim_end_matches(".exe").to_ascii_lowercase();
    if matches!(
        shell.as_str(),
        "sh" | "bash" | "dash" | "zsh" | "fish" | "nu" | "pwsh" | "powershell" | "cmd"
    ) {
        result.parent_shell = Some(shell);
    }
}

#[cfg(unix)]
fn unix_identity(result: &mut EnvironmentInfo) {
    unsafe extern "C" {
        fn getuid() -> u32;
        fn geteuid() -> u32;
        fn getppid() -> i32;
    }
    // SAFETY: POSIX identity accessors have no pointer arguments or side effects.
    let (real, effective, parent) = unsafe { (getuid(), geteuid(), getppid()) };
    result.real_uid = Some(real);
    result.effective_uid = Some(effective);
    result.parent_pid = u32::try_from(parent).ok().filter(|pid| *pid > 0);
    result.elevation = if effective == 0 { "root" } else { "user" }.into();
}

#[cfg(target_os = "macos")]
fn macos_parent(result: &mut EnvironmentInfo) {
    #[link(name = "proc")]
    unsafe extern "C" {
        fn proc_name(pid: i32, buffer: *mut core::ffi::c_void, size: u32) -> i32;
    }
    let Some(pid) = result.parent_pid.and_then(|pid| i32::try_from(pid).ok()) else {
        return;
    };
    let mut name = [0u8; 64];
    // SAFETY: `name` is writable for exactly 64 bytes; proc_name only reads a
    // process name and the bounded array remains valid for the complete call.
    if unsafe { proc_name(pid, name.as_mut_ptr().cast(), 64) } > 0 {
        let end = name
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(name.len());
        if let Ok(name) = std::str::from_utf8(&name[..end]) {
            parent_name(result, name);
        }
    }
}

#[cfg(windows)]
fn windows_identity(result: &mut EnvironmentInfo) {
    use core::ffi::c_void;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn OpenProcessToken(process: *mut c_void, access: u32, token: *mut *mut c_void) -> i32;
        fn GetTokenInformation(
            token: *mut c_void,
            class: u32,
            value: *mut c_void,
            length: u32,
            returned: *mut u32,
        ) -> i32;
    }
    let mut token = core::ptr::null_mut();
    // SAFETY: output points to initialized handle storage; TOKEN_QUERY requests
    // read access only to this process's token, without adjusting any privilege.
    if unsafe { OpenProcessToken(GetCurrentProcess(), 0x0008, &mut token) } == 0 || token.is_null()
    {
        return;
    }
    let mut elevated: u32 = 0;
    let mut returned: u32 = 0;
    // SAFETY: TOKEN_ELEVATION (20) is one DWORD, with both output pointers valid
    // for this synchronous query. The successfully opened token is owned here.
    let found =
        unsafe { GetTokenInformation(token, 20, (&raw mut elevated).cast(), 4, &mut returned) }
            != 0
            && returned == 4;
    // SAFETY: token came from successful OpenProcessToken and is closed once.
    let _ = unsafe { CloseHandle(token) };
    if found {
        result.elevation = if elevated != 0 {
            "administrator"
        } else {
            "user"
        }
        .into();
    }
}

/// Called only by explicit host inventory after CPU and memory constraints.
pub fn collect(info: &HostInfo) -> EnvironmentInfo {
    let mut result = classify(info, |key| std::env::var(key).ok());
    constrain_parallelism(
        &mut result,
        std::thread::available_parallelism()
            .ok()
            .and_then(|count| u32::try_from(count.get()).ok()),
    );
    result.stdin_terminal = std::io::stdin().is_terminal();
    result.stdout_terminal = std::io::stdout().is_terminal();
    #[cfg(unix)]
    unix_identity(&mut result);
    #[cfg(target_os = "macos")]
    macos_parent(&mut result);
    #[cfg(windows)]
    windows_identity(&mut result);
    if info.os.family == "linux" {
        if let Some(status) = read("/proc/self/status") {
            process_status(&mut result, &status);
        }
        if let Some(pid) = result.parent_pid
            && let Some(name) = read(&format!("/proc/{pid}/comm"))
        {
            parent_name(&mut result, &name);
        }
        if std::fs::metadata("/.dockerenv").is_ok() {
            result.container = Some("docker-marker".into());
        } else if std::fs::metadata("/run/.containerenv").is_ok() {
            result.container = Some("oci-container-marker".into());
        }
        device_context(
            &mut result,
            read("/proc/device-tree/model").as_deref(),
            read("/sys/class/dmi/id/sys_vendor").as_deref(),
            read("/sys/class/dmi/id/product_name").as_deref(),
        );
        result.default_ipv4_route = read("/proc/net/route").map(|route| default_route(&route));
        result.default_ipv6_route =
            read("/proc/net/ipv6_route").map(|route| default_ipv6_route(&route));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{Cpu, Gpu, Memory, Os};

    fn host() -> HostInfo {
        HostInfo {
            os: Os {
                family: "linux".into(),
                ..Os::default()
            },
            cpu: Cpu {
                model: "AMD EPYC".into(),
                logical_cores: 32,
                ..Cpu::default()
            },
            memory: Memory {
                available_mib: 512,
                ..Memory::default()
            },
            ..HostInfo::default()
        }
    }

    #[test]
    fn additive_inventory_keeps_old_cards_and_unknown_fields_readable() {
        let mut card = serde_json::to_value(host()).unwrap();
        assert!(card.get("environment").is_none());
        assert!(
            serde_json::from_value::<HostInfo>(card.clone())
                .unwrap()
                .environment
                .is_none()
        );
        card["environment"] = serde_json::json!({"providers": ["vercel"]});
        let environment = serde_json::from_value::<HostInfo>(card)
            .unwrap()
            .environment
            .unwrap();
        assert_eq!(environment.elevation, "unknown");
        assert_eq!(environment.recommended_workers, 1);
        assert_eq!(environment.default_ipv6_route, None);
    }

    #[test]
    fn process_parallelism_caps_policy_without_changing_hardware_inventory() {
        let mut info = host();
        info.memory.available_mib = 8192;
        let mut environment = classify(&info, |_| None);
        constrain_parallelism(&mut environment, Some(3));
        assert_eq!(environment.available_parallelism, Some(3));
        assert_eq!(environment.recommended_workers, 3);
        assert_eq!(info.cpu.logical_cores, 32);
        constrain_parallelism(&mut environment, Some(0));
        assert_eq!(environment.available_parallelism, None);
        assert_eq!(environment.recommended_workers, 3);
    }

    #[test]
    fn provider_values_are_never_serialized() {
        let result = classify(&host(), |key| match key {
            "VERCEL" => Some("1".into()),
            "AWS_LAMBDA_FUNCTION_NAME" => Some("private-function-name".into()),
            "SUDO_UID" => Some("1000".into()),
            _ => None,
        });
        assert_eq!(result.providers, ["vercel", "aws-lambda"]);
        assert_eq!(result.serverless, Some(true));
        assert!(result.sudo_context);
        assert!(
            !serde_json::to_string(&result)
                .unwrap()
                .contains("private-function-name")
        );
        assert_eq!(result.outbound_network, None);
        assert_eq!(result.recommended_workers, 2);
    }

    #[test]
    fn absent_hints_and_small_memory_remain_conservative() {
        let mut info = host();
        info.memory.available_mib = 0;
        info.cpu.logical_cores = 0;
        let result = classify(&info, |_| None);
        assert_eq!(result.serverless, None);
        assert_eq!(result.elevation, "unknown");
        assert!(!result.display_advertised);
        assert_eq!(result.recommended_workers, 1);
        assert_eq!(
            classify(&host(), |key| (key == "VERCEL").then(|| "0".into())).serverless,
            None
        );
    }

    #[test]
    fn effective_uid_controls_root_not_sudo_hint() {
        let mut result = EnvironmentInfo::default();
        process_status(&mut result, "Uid:\t1000\t0\t0\t0\nPPid:\t123\n");
        assert_eq!(result.real_uid, Some(1000));
        assert_eq!(result.effective_uid, Some(0));
        assert_eq!(result.elevation, "root");
        assert_eq!(result.parent_pid, Some(123));
        process_status(&mut result, "Uid: 0 1000 1000 1000\nPPid: 0\n");
        assert_eq!(result.elevation, "user");
        assert_eq!(result.parent_pid, None);
    }

    #[test]
    fn device_and_cloud_facts_do_not_invent_serverless() {
        let mut result = EnvironmentInfo::default();
        device_context(
            &mut result,
            Some("Raspberry Pi 5 Model B\0"),
            Some("Amazon EC2"),
            Some("KVM"),
        );
        assert_eq!(result.device.as_deref(), Some("raspberry-pi"));
        assert_eq!(result.virtualization.as_deref(), Some("kvm"));
        assert_eq!(result.providers, ["aws-ec2"]);
        assert_eq!(result.serverless, None);
    }

    #[test]
    fn windows_server_build_is_not_a_windows_11_desktop() {
        let mut info = host();
        info.os.family = "windows".into();
        info.os.build = Some("26100".into());
        info.os.name = "Windows Server 2025".into();
        assert_eq!(classify(&info, |_| None).windows_11, None);
        info.os.name = "Windows 11".into();
        assert_eq!(classify(&info, |_| None).windows_11, Some(true));
        info.os.name = "Windows".into();
        assert_eq!(classify(&info, |_| None).windows_11, None);
    }

    #[test]
    fn display_and_hardware_are_hints_not_driver_qualification() {
        let mut info = host();
        info.cpu.model = "Apple M4".into();
        info.gpus = vec![Gpu {
            vendor: "apple".into(),
            ..Gpu::default()
        }];
        let result = classify(&info, |key| {
            (key == "WAYLAND_DISPLAY").then(|| "secret-session-name".into())
        });
        assert_eq!(result.display_protocol.as_deref(), Some("wayland-hint"));
        assert_eq!(result.cpu_vendor.as_deref(), Some("apple"));
        assert_eq!(result.gpu_vendors, ["apple"]);
        assert!(
            !serde_json::to_string(&result)
                .unwrap()
                .contains("secret-session-name")
        );
    }

    #[test]
    fn route_and_parent_are_bounded_local_evidence() {
        assert!(default_route(
            "Iface Destination Gateway Flags\neth0 00000000 0100000A 0003\n"
        ));
        assert!(!default_route(
            "Iface Destination Gateway Flags\neth0 00000000 00000000 0000\n"
        ));
        assert!(default_ipv6_route(
            "00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000064 00000000 00000000 00000003 eth0"
        ));
        assert!(!default_ipv6_route(
            "00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 00000000 00000000 00000000 00000201 lo"
        ));
        let mut result = EnvironmentInfo::default();
        parent_name(&mut result, "bash\n");
        assert_eq!(result.parent_shell.as_deref(), Some("bash"));
        parent_name(&mut result, "sh --password=private");
        assert_eq!(result.parent_name.as_deref(), Some("bash"));
    }
}
