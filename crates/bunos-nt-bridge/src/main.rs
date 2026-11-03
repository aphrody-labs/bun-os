// SPDX-License-Identifier: Apache-2.0
//! `bunos-winbridge`: serve the WinClean tool catalog to the Bun OS WSL guest.
//!
//! ```text
//! bunos-winbridge serve [--transport hvsocket|loopback] [--port N] [--token T|--token-file F] [--allow PREFIX]...
//! bunos-winbridge service           # run under the Windows Service Control Manager (BunOSWinBridge)
//! bunos-winbridge tools             # print the served tool names and exit
//! ```
//!
//! The token defaults to `%SystemRoot%\BunOS\bridge.token` (created on first run, admin-writable only); the guest
//! reads the same file shared into the distro. `loopback` (TCP on 127.0.0.1) is the transport used to test on this
//! workstation before a WSL distro exists; `hvsocket` is the real guest transport (`AF_HYPERV` here, `AF_VSOCK` in
//! the guest). See docs/NTCORE.md section 9.
use std::io;

use bunos_nt_bridge::{DEFAULT_PORT, Policy, serve_stream};

fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("serve");
    let rest = &args[args.len().min(1)..];
    let result = match cmd {
        "tools" => {
            for name in load_policy(rest).visible_tools() {
                println!("{name}");
            }
            Ok(())
        }
        "serve" => serve(load_policy(rest), options(rest)),
        #[cfg(windows)]
        "service" => win::run_as_service(),
        other => {
            eprintln!("unknown command {other}: serve | service | tools");
            return std::process::ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("bunos-winbridge: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}

struct Options {
    transport: String,
    port: u32,
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

fn options(args: &[String]) -> Options {
    Options {
        transport: flag(args, "--transport").unwrap_or("hvsocket").to_string(),
        port: flag(args, "--port").and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_PORT),
    }
}

/// Builds the policy: token from `--token`, `--token-file`, or the default store; extra allow prefixes from `--allow`.
fn load_policy(args: &[String]) -> Policy {
    let extra: Vec<String> = args
        .iter()
        .enumerate()
        .filter(|(_, a)| a.as_str() == "--allow")
        .filter_map(|(i, _)| args.get(i + 1).cloned())
        .collect();
    let token = if let Some(t) = flag(args, "--token") {
        t.to_string()
    } else if let Some(path) = flag(args, "--token-file") {
        std::fs::read_to_string(path).map(|s| s.trim().to_string()).unwrap_or_default()
    } else {
        default_token()
    };
    Policy::new(token, extra)
}

/// The default token store under `%SystemRoot%\BunOS\bridge.token` (or `$BUNOS_BRIDGE_TOKEN` when set). Created with
/// 32 random bytes hex on first use; on a non-Windows host (tests) it falls back to a temp path.
fn default_token() -> String {
    if let Ok(t) = std::env::var("BUNOS_BRIDGE_TOKEN") {
        return t;
    }
    let dir = std::env::var("SystemRoot").map(|r| std::path::PathBuf::from(r).join("BunOS")).unwrap_or_else(|_| std::env::temp_dir().join("bunos"));
    let path = dir.join("bridge.token");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let t = existing.trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }
    let token = random_hex();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&path, &token);
    token
}

fn random_hex() -> String {
    // A one-shot token: time + pid + address entropy, hashed by splitmix64. Not a key store; the file's ACL is the
    // boundary (admin-writable only under %SystemRoot%).
    let mut seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0)
        ^ (std::process::id() as u64).rotate_left(21)
        ^ (&SEED_ANCHOR as *const u8 as u64);
    let mut out = String::with_capacity(64);
    for _ in 0..4 {
        seed = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = seed;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        out.push_str(&format!("{z:016x}"));
    }
    out
}
static SEED_ANCHOR: u8 = 0;

fn serve(policy: Policy, opts: Options) -> io::Result<()> {
    eprintln!("bunos-winbridge: {} tools, transport {}, port {:#x}", policy.visible_tools().len(), opts.transport, opts.port);
    match opts.transport.as_str() {
        "loopback" => serve_loopback(policy, opts.port),
        #[cfg(windows)]
        "hvsocket" => win::serve_hvsocket(policy, opts.port),
        #[cfg(not(windows))]
        "hvsocket" => Err(io::Error::other("hvsocket is Windows-only; use --transport loopback off Windows")),
        other => Err(io::Error::other(format!("unknown transport {other}"))),
    }
}

/// Loopback transport: TCP on `127.0.0.1:<low 16 bits of port>`, for testing on this workstation.
fn serve_loopback(policy: Policy, port: u32) -> io::Result<()> {
    let tcp_port = (port & 0xffff) as u16;
    let listener = std::net::TcpListener::bind(("127.0.0.1", tcp_port))?;
    eprintln!("bunos-winbridge: loopback on 127.0.0.1:{}", listener.local_addr()?.port());
    let policy = std::sync::Arc::new(policy);
    for stream in listener.incoming() {
        let stream = stream?;
        let policy = policy.clone();
        std::thread::spawn(move || {
            if let Err(e) = serve_stream(&policy, stream) {
                eprintln!("bunos-winbridge: connection ended: {e}");
            }
        });
    }
    Ok(())
}

#[cfg(windows)]
mod win {
    use std::io::{self, Read, Write};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    use bunos_nt_bridge::{DEFAULT_PORT, Policy, serve_stream};
    use windows::Win32::Networking::WinSock::{
        AF_HYPERV, INVALID_SOCKET, SEND_RECV_FLAGS, SOCKET, SOCK_STREAM, SOMAXCONN, WSADATA, WSAStartup, accept, bind,
        closesocket, listen, recv, send, socket,
    };
    use windows::core::GUID;

    const HV_PROTOCOL_RAW: i32 = 1;
    /// `HV_GUID_WILDCARD` (00000000-0000-0000-0000-000000000000): accept from any partition.
    const HV_GUID_WILDCARD: GUID = GUID::from_u128(0);
    /// VSOCK-template service-id base `00000000-facb-11e6-bd58-64006a7986d3`; the first DWORD is the port, so a Linux
    /// `AF_VSOCK` client in the guest reaches it by that port number.
    fn service_id(port: u32) -> GUID {
        GUID::from_values(port, 0xfacb, 0x11e6, [0xbd, 0x58, 0x64, 0x00, 0x6a, 0x79, 0x86, 0xd3])
    }

    #[repr(C)]
    struct SockaddrHv {
        family: u16,
        reserved: u16,
        vm_id: GUID,
        service_id: GUID,
    }

    /// A Read+Write adapter over a Winsock SOCKET (closed on drop).
    struct SocketStream(SOCKET);
    // SAFETY: the socket is owned by this stream and used from one thread at a time.
    unsafe impl Send for SocketStream {}
    impl Read for SocketStream {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            // SAFETY: `buf` is valid for its length for the call.
            let n = unsafe { recv(self.0, buf, SEND_RECV_FLAGS(0)) };
            if n < 0 { Err(io::Error::last_os_error()) } else { Ok(n as usize) }
        }
    }
    impl Write for SocketStream {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            // SAFETY: `buf` is valid for its length for the call.
            let n = unsafe { send(self.0, buf, SEND_RECV_FLAGS(0)) };
            if n < 0 { Err(io::Error::last_os_error()) } else { Ok(n as usize) }
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    impl Drop for SocketStream {
        fn drop(&mut self) {
            // SAFETY: the socket came from accept() and is closed exactly once.
            unsafe { closesocket(self.0) };
        }
    }

    fn wsa_startup() -> io::Result<()> {
        let mut data = WSADATA::default();
        // SAFETY: plain out-parameter; version 2.2.
        if unsafe { WSAStartup(0x0202, &mut data) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub fn serve_hvsocket(policy: Policy, port: u32) -> io::Result<()> {
        serve_hvsocket_until(policy, port, &STOP)
    }

    static STOP: AtomicBool = AtomicBool::new(false);

    fn serve_hvsocket_until(policy: Policy, port: u32, stop: &AtomicBool) -> io::Result<()> {
        wsa_startup()?;
        // SAFETY: standard socket creation on AF_HYPERV.
        let listener = unsafe { socket(AF_HYPERV as i32, SOCK_STREAM, HV_PROTOCOL_RAW) }
            .map_err(|e| io::Error::other(format!("socket(AF_HYPERV): {e}")))?;
        let addr = SockaddrHv { family: AF_HYPERV, reserved: 0, vm_id: HV_GUID_WILDCARD, service_id: service_id(port) };
        // SAFETY: `addr` is a valid SOCKADDR_HV for its size, valid for the call.
        let rc = unsafe {
            bind(listener, &addr as *const _ as *const _, core::mem::size_of::<SockaddrHv>() as i32)
        };
        if rc != 0 {
            let e = io::Error::last_os_error();
            // SAFETY: the listener socket is valid.
            unsafe { closesocket(listener) };
            return Err(io::Error::other(format!("bind(hvsocket {port:#x}): {e}")));
        }
        // SAFETY: the listener socket is valid.
        if unsafe { listen(listener, SOMAXCONN as i32) } != 0 {
            let e = io::Error::last_os_error();
            unsafe { closesocket(listener) };
            return Err(e);
        }
        eprintln!("bunos-winbridge: hvsocket listening on service {port:#x}");
        let policy = Arc::new(policy);
        while !stop.load(Ordering::Acquire) {
            // SAFETY: the listener is valid; accept blocks until a guest connects or the socket is closed.
            let client = unsafe { accept(listener, None, None) };
            let client = match client {
                Ok(s) if s != INVALID_SOCKET => s,
                _ => {
                    if stop.load(Ordering::Acquire) {
                        break;
                    }
                    continue;
                }
            };
            let policy = policy.clone();
            std::thread::spawn(move || {
                if let Err(e) = serve_stream(&policy, SocketStream(client)) {
                    eprintln!("bunos-winbridge: connection ended: {e}");
                }
            });
        }
        // SAFETY: the listener socket is valid and closed once here.
        unsafe { closesocket(listener) };
        Ok(())
    }

    // ----- Windows Service Control Manager glue (service name BunOSWinBridge) -----
    use windows::Win32::System::Services::{
        RegisterServiceCtrlHandlerExW, SERVICE_ACCEPT_STOP, SERVICE_CONTROL_STOP, SERVICE_RUNNING, SERVICE_STATUS,
        SERVICE_STATUS_HANDLE, SERVICE_STOPPED, SERVICE_STOP_PENDING, SERVICE_TABLE_ENTRYW, SERVICE_WIN32_OWN_PROCESS,
        SetServiceStatus, StartServiceCtrlDispatcherW,
    };
    use windows::core::{PWSTR, w};

    static mut STATUS_HANDLE: Option<SERVICE_STATUS_HANDLE> = None;
    static SERVICE_STOP: AtomicBool = AtomicBool::new(false);

    fn set_state(state: u32, accept: u32) {
        let status = SERVICE_STATUS {
            dwServiceType: SERVICE_WIN32_OWN_PROCESS,
            dwCurrentState: windows::Win32::System::Services::SERVICE_STATUS_CURRENT_STATE(state),
            dwControlsAccepted: accept,
            ..Default::default()
        };
        // SAFETY: the handle was set in ServiceMain before any state change.
        unsafe {
            if let Some(h) = STATUS_HANDLE {
                let _ = SetServiceStatus(h, &status);
            }
        }
    }

    unsafe extern "system" fn handler(control: u32, _ev: u32, _data: *mut core::ffi::c_void, _ctx: *mut core::ffi::c_void) -> u32 {
        if control == SERVICE_CONTROL_STOP {
            SERVICE_STOP.store(true, Ordering::Release);
            STOP.store(true, Ordering::Release);
            set_state(SERVICE_STOP_PENDING.0, 0);
        }
        0
    }

    unsafe extern "system" fn service_main(_argc: u32, _argv: *mut PWSTR) {
        // SAFETY: called once by the SCM on the service thread.
        let handle = unsafe { RegisterServiceCtrlHandlerExW(w!("BunOSWinBridge"), Some(handler), None) };
        let Ok(handle) = handle else { return };
        unsafe { STATUS_HANDLE = Some(handle) };
        set_state(SERVICE_RUNNING.0, SERVICE_ACCEPT_STOP);
        // Token and allow-list from the default store; transport hvsocket on the default port.
        let policy = super::load_policy(&[]);
        let _ = serve_hvsocket_until(policy, DEFAULT_PORT, &STOP);
        set_state(SERVICE_STOPPED.0, 0);
    }

    pub fn run_as_service() -> io::Result<()> {
        // lpServiceName is a PWSTR (mutable): own the wide name for the duration of the blocking dispatch call.
        let mut name: Vec<u16> = "BunOSWinBridge\0".encode_utf16().collect();
        let table = [
            SERVICE_TABLE_ENTRYW { lpServiceName: PWSTR(name.as_mut_ptr()), lpServiceProc: Some(service_main) },
            SERVICE_TABLE_ENTRYW { lpServiceName: PWSTR::null(), lpServiceProc: None },
        ];
        // SAFETY: the table ends with a null entry as the SCM requires.
        unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) }.map_err(|e| io::Error::other(format!("{e}")))
    }
}
