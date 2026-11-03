// SPDX-License-Identifier: Apache-2.0
//! bunos-wayland-win: the Windows half. Starts (or attaches to) a bunos-wlhost over a byte stream and shows every Linux
//! toplevel as a real Win32 window: DWM composes it (Mica/Acrylic backdrop, rounded corners, shadow, snap layouts,
//! Alt+Tab, taskbar), keyboard/mouse/focus/resize/close go back to the host.
//!
//! bunos-wayland-win [--ssh HOST | --wsl [DISTRO] | --command "TRANSPORT"] [--host-bin PATH] [--backdrop B]
//!                   [--glass] [--gdi] [--vsync] [--stats] [-- APP...]
//!   --ssh HOST      run the host on HOST over OpenSSH (stdin/stdout carry the protocol)
//!   --wsl DISTRO    run the host in a WSL distro through wsl.exe (default distro: bunos)
//!   --host-arg A    pass A to bunos-wlhost (repeatable), e.g. --host-arg --inflight --host-arg 3
//!   --command CMD   any program whose stdin/stdout reach a bunos-wlhost (socat to vsock/TCP, a VM console...)
//!   --desktop       full-screen session mode (nested compositor in one borderless monitor-sized window; F11 toggles)
//!   --glass         translucent Linux windows show a system backdrop under their content (default: chrome only)
//!   --backdrop B    the --glass backdrop: mica (default) | acrylic | mica-alt | none
//!   Chrome (caption, border, corners, Mica caption) follows the design spec; BUNOS_CHROME points at it.

mod gpu;
mod window;

use std::{
    collections::VecDeque,
    io::{BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, mpsc},
    time::Instant,
};

use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForSystem, SetProcessDpiAwarenessContext},
            Input::KeyboardAndMouse::GetKeyboardLayout,
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetSystemMetrics, HWND_MESSAGE, MSG,
                PostMessageW, PostQuitMessage, RegisterClassExW, SM_CXSCREEN, SM_CYSCREEN, TranslateMessage,
                WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WNDCLASSEXW,
            },
        },
    },
    core::{PCWSTR, w},
};

use crate::{
    keys,
    wire::{self, Backdrop, HostMsg, PresenterMsg},
};

pub(crate) const WM_HOST: u32 = WM_APP + 1;
pub(crate) const WM_HOST_EOF: u32 = WM_APP + 2;

pub(crate) struct Options {
    /// Backdrop under translucent content when `glass` is on (Acrylic is always used for blur-requesting clients).
    pub backdrop: Backdrop,
    pub glass: bool,
    /// Full-screen desktop mode: every toplevel (a nested cosmic-comp / Hyprland / Weston / GNOME session) opens
    /// borderless full screen on its monitor, so DWM can hand the flip chain straight to the display (independent flip).
    pub desktop: bool,
    pub gdi: bool,
    pub vsync: bool,
    pub stats: bool,
}

/// What the reader thread hands to the UI thread.
pub(crate) type Inbox = Arc<Mutex<VecDeque<HostMsg>>>;

pub(crate) struct Link {
    tx: mpsc::Sender<Vec<u8>>,
    pub started: Instant,
}

impl Link {
    pub fn send(&self, m: PresenterMsg) {
        let _ = self.tx.send(m.encode());
    }
    pub fn now_ms(&self) -> u32 {
        self.started.elapsed().as_millis() as u32
    }
}

fn find_ssh() -> String {
    for p in [
        std::env::var("ProgramFiles").map(|p| format!("{p}\\OpenSSH\\ssh.exe")).unwrap_or_default(),
        std::env::var("SystemRoot").map(|p| format!("{p}\\System32\\OpenSSH\\ssh.exe")).unwrap_or_default(),
    ] {
        if !p.is_empty() && std::path::Path::new(&p).exists() {
            return p;
        }
    }
    "ssh".into()
}

/// Windows "Transparency effects" switch (Settings > Personalization > Colors). Off = reduced transparency.
pub(crate) fn transparency_enabled() -> bool {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
    let mut value: u32 = 1;
    let mut size = std::mem::size_of::<u32>() as u32;
    let r = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("EnableTransparency"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    r.is_err() || value != 0
}

pub fn run(args: Vec<String>) -> Result<(), Box<dyn std::error::Error>> {
    let mut transport: Option<Vec<String>> = None;
    let mut host_bin = "bunos-wlhost".to_string();
    let mut app: Vec<String> = Vec::new();
    let mut opts = Options { backdrop: Backdrop::Mica, glass: false, desktop: false, gdi: false, vsync: false, stats: false };
    let mut host_stats = false;
    let mut host_extra: Vec<String> = Vec::new();
    let mut kind = "wsl";
    let mut target = "bunos".to_string();
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--ssh" => {
                kind = "ssh";
                target = it.next().ok_or("--ssh needs a host")?;
            }
            "--wsl" => {
                kind = "wsl";
                if let Some(d) = it.next() {
                    target = d;
                }
            }
            "--command" => {
                kind = "command";
                transport = Some(it.next().ok_or("--command needs a program")?.split_whitespace().map(String::from).collect());
            }
            "--host-bin" => host_bin = it.next().ok_or("--host-bin needs a path")?,
            "--host-arg" => host_extra.push(it.next().ok_or("--host-arg needs a value")?),
            "--backdrop" => {
                opts.backdrop = match it.next().as_deref() {
                    Some("acrylic") => Backdrop::Acrylic,
                    Some("mica-alt") => Backdrop::MicaAlt,
                    Some("none") => Backdrop::None,
                    _ => Backdrop::Mica,
                }
            }
            "--glass" => opts.glass = true,
            "--desktop" => opts.desktop = true,
            "--gdi" => opts.gdi = true,
            "--vsync" => opts.vsync = true,
            "--stats" => {
                opts.stats = true;
                host_stats = true;
            }
            "--" => {
                app = it.collect();
                break;
            }
            "-h" | "--help" => {
                eprintln!(
                    "usage: bunos-wayland-win [--ssh HOST | --wsl [DISTRO] | --command CMD] [--host-bin PATH] \
                     [--backdrop mica|acrylic|mica-alt|none] [--glass] [--gdi] [--vsync] [--stats] [-- APP...]"
                );
                return Ok(());
            }
            other => return Err(format!("unknown argument {other}").into()),
        }
    }
    if !transparency_enabled() {
        opts.backdrop = Backdrop::None;
    }

    let mut host_args: Vec<String> = vec![host_bin];
    if host_stats {
        host_args.push("--stats".into());
    }
    host_args.extend(host_extra);
    if !app.is_empty() {
        host_args.push("--".into());
        host_args.extend(app);
    }
    let mut wsl_env: Option<String> = None;
    let argv: Vec<String> = match kind {
        "ssh" => {
            let mut v = vec![find_ssh(), "-T".into(), "-o".into(), "Compression=no".into(), "-o".into(), "BatchMode=yes".into(), target];
            // One remote command line; the remote shell splits it.
            v.push(host_args.iter().map(|a| shell_quote(a)).collect::<Vec<_>>().join(" "));
            v
        }
        "wsl" => {
            // wsl.exe re-splits --exec arguments on spaces: the host argv travels hex-encoded in an environment
            // variable forwarded by WSLENV, so app command lines arrive byte-exact.
            let bin = host_args.remove(0);
            wsl_env = Some(crate::wire::hex_args(&host_args));
            vec!["wsl.exe".into(), "-d".into(), target, "--exec".into(), bin, "--args-env".into(), "BUNOS_WLHOST_ARGS".into()]
        }
        _ => transport.unwrap_or_default(),
    };
    if argv.is_empty() {
        return Err("empty transport command".into());
    }
    eprintln!("bunos-wayland-win: transport: {}", argv.join(" "));
    let mut cmd = Command::new(&argv[0]);
    cmd.args(&argv[1..]);
    if let Some(v) = &wsl_env {
        let wslenv = std::env::var("WSLENV").unwrap_or_default();
        cmd.env("BUNOS_WLHOST_ARGS", v)
            .env("WSLENV", if wslenv.is_empty() { "BUNOS_WLHOST_ARGS".to_string() } else { format!("{wslenv}:BUNOS_WLHOST_ARGS") });
    }
    let mut child: Child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("start {}: {e}", argv[0]))?;
    let mut child_in = child.stdin.take().unwrap();
    let child_out = child.stdout.take().unwrap();

    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }

    // Message-only window that receives "host message ready" notifications.
    let hinstance = unsafe { GetModuleHandleW(None)? };
    let class = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        lpfnWndProc: Some(pump_proc),
        hInstance: hinstance.into(),
        lpszClassName: w!("BunOSWaylandPump"),
        ..Default::default()
    };
    unsafe { RegisterClassExW(&class) };
    let pump = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("BunOSWaylandPump"),
            PCWSTR::null(),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(hinstance.into()),
            None,
        )?
    };
    window::register_class(hinstance.into())?;

    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        while let Ok(m) = rx.recv() {
            if child_in.write_all(&m).is_err() {
                return;
            }
            while let Ok(more) = rx.try_recv() {
                if child_in.write_all(&more).is_err() {
                    return;
                }
            }
            if child_in.flush().is_err() {
                return;
            }
        }
    });

    let inbox: Inbox = Arc::new(Mutex::new(VecDeque::new()));
    let pump_raw = pump.0 as isize;
    {
        let inbox = inbox.clone();
        std::thread::spawn(move || {
            let mut r = BufReader::with_capacity(1 << 20, child_out);
            let mut buf = Vec::new();
            let pump = HWND(pump_raw as *mut _);
            loop {
                match wire::read_message(&mut r, &mut buf) {
                    Ok(Some(())) => match HostMsg::decode(&buf) {
                        Ok(m) => {
                            let first = {
                                let mut q = inbox.lock().unwrap();
                                q.push_back(m);
                                q.len() == 1
                            };
                            if first {
                                unsafe {
                                    let _ = PostMessageW(Some(pump), WM_HOST, WPARAM(0), LPARAM(0));
                                }
                            }
                        }
                        Err(e) => eprintln!("bunos-wayland-win: {e}"),
                    },
                    Ok(None) | Err(_) => break,
                }
            }
            unsafe {
                let _ = PostMessageW(Some(pump), WM_HOST_EOF, WPARAM(0), LPARAM(0));
            }
        });
    }

    let link = Link { tx, started: Instant::now() };
    let hkl = unsafe { GetKeyboardLayout(0) };
    let (layout, variant) = keys::langid_to_xkb((hkl.0 as usize & 0xffff) as u16);
    let (layout, variant) = (
        std::env::var("BUNOS_XKB_LAYOUT").unwrap_or_else(|_| layout.to_string()),
        std::env::var("BUNOS_XKB_VARIANT").unwrap_or_else(|_| variant.to_string()),
    );
    let dpi = unsafe { GetDpiForSystem() };
    link.send(PresenterMsg::Hello {
        version: wire::VERSION,
        xkb_layout: layout,
        xkb_variant: variant,
        scale_120: dpi * 120 / 96,
        output_w: unsafe { GetSystemMetrics(SM_CXSCREEN) } as u32,
        output_h: unsafe { GetSystemMetrics(SM_CYSCREEN) } as u32,
    });

    window::install(window::App::new(link, inbox, opts));

    let mut msg = MSG::default();
    unsafe {
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    window::shutdown();
    let _ = child.kill();
    let _ = child.wait();
    Ok(())
}

fn shell_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./=:,+@%~".contains(c)) {
        // `~` stays unquoted so the remote shell expands it.
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

unsafe extern "system" fn pump_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_HOST => {
            window::drain_inbox();
            LRESULT(0)
        }
        WM_HOST_EOF => {
            window::drain_inbox();
            eprintln!("bunos-wayland-win: host stream ended");
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}
