// SPDX-License-Identifier: Apache-2.0
//! bunos-wlhost: a headless smithay compositor. Every xdg_toplevel is rendered on its own (pixman, CPU, any Linux,
//! no GPU or DRM node needed) into a picture the size of its xdg window geometry, and the damaged rectangles are
//! shipped to the Windows presenter. Frame callbacks are released when the presenter acknowledges a frame, so the
//! client runs at the speed the Windows side actually shows frames (no queueing over slow links).
//!
//! Usage: bunos-wlhost [--stats] [--no-compress] [--socket NAME] [--spawn] [-- COMMAND...]
//! The protocol runs on stdin/stdout (ssh, wsl.exe, socat to vsock/TCP); logs go to stderr.

use std::{
    error::Error,
    ffi::OsString,
    io::{self, BufWriter, Write},
    os::fd::AsFd,
    process::{Command, Stdio},
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};

use smithay::{
    backend::{
        allocator::{Fourcc, dmabuf::Dmabuf},
        input::{ButtonState, InputTime, KeyState},
        renderer::{
            Bind, ImportDma, Offscreen,
            damage::OutputDamageTracker,
            element::{AsRenderElements, surface::WaylandSurfaceRenderElement},
            pixman::PixmanRenderer,
            utils::on_commit_buffer_handler,
        },
    },
    delegate_dispatch2,
    desktop::{PopupKind, PopupManager, Window, WindowSurface, WindowSurfaceType},
    input::{
        Seat, SeatHandler, SeatState,
        keyboard::{FilterResult, XkbConfig},
        pointer::{AxisFrame, ButtonEvent, CursorImageStatus, MotionEvent},
    },
    output::{Mode, Output, PhysicalProperties, Subpixel},
    reexports::{
        calloop::{
            EventLoop, Interest, LoopHandle, LoopSignal, Mode as IoMode, PostAction, channel,
            generic::Generic,
        },
        pixman,
        wayland_protocols::xdg::{
            decoration::zv1::server::zxdg_toplevel_decoration_v1::Mode as DecorationMode,
            shell::server::xdg_toplevel,
        },
        wayland_server::{
            Client, Display, DisplayHandle, Resource,
            backend::{ClientData, ClientId, DisconnectReason},
            protocol::{wl_buffer, wl_output, wl_seat, wl_surface::WlSurface},
        },
    },
    utils::{Point, Rectangle, SERIAL_COUNTER, Scale, Serial, Transform},
    wayland::{
        background_effect::{BackgroundEffectState, ExtBackgroundEffectHandler},
        buffer::BufferHandler,
        compositor::{
            CompositorClientState, CompositorHandler, CompositorState, get_parent,
            is_sync_subsurface, with_states,
        },
        cursor_shape::CursorShapeManagerState,
        dmabuf::{DmabufFeedbackBuilder, DmabufGlobal, DmabufHandler, DmabufState, ImportNotifier},
        fractional_scale::{
            FractionalScaleHandler, FractionalScaleManagerState, with_fractional_scale,
        },
        output::{OutputHandler, OutputManagerState},
        seat::WaylandFocus,
        selection::{
            SelectionHandler,
            data_device::{
                DataDeviceHandler, DataDeviceState, WaylandDndGrabHandler, set_data_device_focus,
            },
        },
        shell::xdg::{
            PopupSurface, PositionerState, ToplevelSurface, XdgShellHandler, XdgShellState,
            XdgToplevelSurfaceData,
            decoration::{XdgDecorationHandler, XdgDecorationState},
        },
        shm::{ShmHandler, ShmState},
        socket::ListeningSocketSource,
        viewporter::ViewporterState,
        xwayland_shell::{XWaylandShellHandler, XWaylandShellState},
    },
    xwayland::{
        X11Surface, X11Wm, XWayland, XWaylandClientData, XWaylandEvent, XwmHandler,
        xwm::{Reorder, ResizeEdge as X11ResizeEdge, XwmId},
    },
};

use crate::wire::{self, Backdrop, HostMsg, Interactive, PresenterMsg, Rect};

/// Each toplevel lives at its own origin in the compositor's global space, so pointer coordinates never overlap.
const STRIDE_X: i32 = 20_000;

struct Toplevel {
    id: u32,
    window: Window,
    image: Option<pixman::Image<'static, 'static>>,
    tracker: Option<OutputDamageTracker>,
    size: (i32, i32),
    seq: u32,
    /// Frames sent and not yet acknowledged, oldest first.
    inflight: std::collections::VecDeque<(u32, Instant)>,
    dirty: bool,
    announced: bool,
    title: String,
    app_id: String,
    blur: bool,
    translucent: bool,
    /// Where the window's origin sits in the compositor's global space (X11 override-redirect windows choose it).
    origin: Point<i32, smithay::utils::Logical>,
    /// Override-redirect X11 window (menu, tooltip): shown as an owned Win32 popup of `parent`.
    parent: u32,
}

impl Toplevel {
    fn new(
        id: u32,
        window: Window,
        origin: Point<i32, smithay::utils::Logical>,
        parent: u32,
    ) -> Self {
        Self {
            id,
            window,
            image: None,
            tracker: None,
            size: (0, 0),
            seq: 0,
            inflight: Default::default(),
            dirty: false,
            announced: false,
            title: String::new(),
            app_id: String::new(),
            blur: false,
            translucent: false,
            origin,
            parent,
        }
    }

    fn wl(&self) -> Option<WlSurface> {
        self.window.wl_surface().map(|s| s.into_owned())
    }
}

#[derive(Default)]
struct Stats {
    frames: u64,
    bytes_raw: u64,
    bytes_wire: u64,
    rtt_sum: Duration,
    rtt_n: u64,
    render: Duration,
}

pub struct Host {
    start: Instant,
    dh: DisplayHandle,
    socket_name: OsString,
    loop_signal: LoopSignal,
    compositor_state: CompositorState,
    xdg_shell_state: XdgShellState,
    #[allow(dead_code)]
    xdg_decoration_state: XdgDecorationState,
    shm_state: ShmState,
    #[allow(dead_code)]
    output_manager_state: OutputManagerState,
    seat_state: SeatState<Host>,
    data_device_state: DataDeviceState,
    popups: PopupManager,
    seat: Seat<Host>,
    output: Output,
    renderer: PixmanRenderer,
    dmabuf_state: DmabufState,
    _dmabuf_global: Option<DmabufGlobal>,
    windows: Vec<Toplevel>,
    next_id: u32,
    out: mpsc::Sender<Vec<u8>>,
    compress: bool,
    stats: Stats,
    stats_enabled: bool,
    stats_at: Instant,
    cursor: String,
    /// Windows DPI scale (1.25 at 120 dpi). Configure sizes and pointer positions arrive in physical pixels.
    scale: f64,
    #[allow(dead_code)]
    globals: (
        FractionalScaleManagerState,
        ViewporterState,
        CursorShapeManagerState,
        BackgroundEffectState,
    ),
    loop_handle: LoopHandle<'static, Host>,
    xwayland_shell_state: XWaylandShellState,
    xwm: Option<X11Wm>,
    xdisplay: Option<u32>,
    /// The app to start once Xwayland is ready (so X11 apps find DISPLAY).
    pending_command: Option<String>,
    /// Apps start once the presenter's Hello (scale, layout) and Xwayland are both in, so the first frame is final.
    hello_done: bool,
    xwayland_pending: bool,
    max_inflight: u32,
}

#[derive(Default)]
struct ClientState {
    compositor_state: CompositorClientState,
}

impl ClientData for ClientState {
    fn initialized(&self, _client_id: ClientId) {}
    fn disconnected(&self, _client_id: ClientId, _reason: DisconnectReason) {}
}

/// `--sink`: decodes frames like the presenter would (lz4 + rectangle blit into a full picture) and acks them.
fn sink_presenter(rx: mpsc::Receiver<Vec<u8>>, ack: channel::Sender<PresenterMsg>) {
    let _ = ack.send(PresenterMsg::Hello {
        version: wire::VERSION,
        xkb_layout: "us".into(),
        xkb_variant: String::new(),
        scale_120: 120,
        output_w: 1920,
        output_h: 1080,
    });
    let mut pictures: std::collections::HashMap<u32, (u32, u32, Vec<u8>)> = Default::default();
    while let Ok(bytes) = rx.recv() {
        let Ok(HostMsg::Frame {
            id,
            seq,
            width,
            height,
            rects,
            codec,
            raw_len,
            data,
            ..
        }) = HostMsg::decode(&bytes[4..])
        else {
            continue;
        };
        let p = pictures.entry(id).or_insert_with(|| (0, 0, Vec::new()));
        if (p.0, p.1) != (width, height) {
            *p = (width, height, vec![0; width as usize * height as usize * 4]);
        }
        let _ = wire::apply_rects(&mut p.2, width, &rects, codec, raw_len, &data);
        if ack.send(PresenterMsg::FrameAck { id, seq }).is_err() {
            return;
        }
    }
}

fn sh_quote(s: &str) -> String {
    if !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./=:,+@%".contains(c))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// The DRM node GBM clients should allocate on: `BUNOS_WLHOST_DMABUF_NODE`, else the first render node with a real
/// driver, else the first KMS (primary) node. On WSL2 the only render node is vgem, which has no GBM/EGL driver
/// ("DRI2: failed to create screen"); the kernel's vkms KMS node has none either but Mesa's kms_swrast allocates linear
/// dumb buffers on it, which pixman maps. Aquamarine opens the primary node when the device has no render node.
fn dmabuf_main_node() -> Option<(String, u64)> {
    use std::os::unix::fs::MetadataExt;
    let rdev = |p: &str| std::fs::metadata(p).ok().map(|m| (p.to_string(), m.rdev()));
    if let Ok(p) = std::env::var("BUNOS_WLHOST_DMABUF_NODE") {
        return rdev(&p);
    }
    let driver = |name: &str| {
        std::fs::read_link(format!("/sys/class/drm/{name}/device"))
            .ok()
            .and_then(|l| l.file_name().map(|f| f.to_string_lossy().into_owned()))
            .unwrap_or_default()
    };
    let mut nodes: Vec<String> = std::fs::read_dir("/dev/dri")
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    nodes.sort();
    let pick = |prefix: &str| {
        nodes
            .iter()
            .filter(|n| {
                n.starts_with(prefix) && n[prefix.len()..].chars().all(|c| c.is_ascii_digit())
            })
            .find(|n| driver(n) != "vgem")
            .and_then(|n| rdev(&format!("/dev/dri/{n}")))
    };
    pick("renderD").or_else(|| pick("card"))
}

fn origin(id: u32) -> Point<i32, smithay::utils::Logical> {
    (id as i32 * STRIDE_X, 0).into()
}

pub fn run(mut args: Vec<String>) -> Result<(), Box<dyn Error>> {
    if args.first().map(String::as_str) == Some("--args-env") {
        let name = args
            .get(1)
            .cloned()
            .ok_or("--args-env needs a variable name")?;
        let v = std::env::var(&name).map_err(|_| format!("{name} is not set"))?;
        args = crate::wire::unhex_args(&v)
            .ok_or_else(|| format!("{name} is not hex-encoded arguments"))?;
    }
    let mut stats_enabled = false;
    let mut compress = true;
    let mut socket: Option<String> = None;
    let mut sink = false;
    let mut xwayland = true;
    let mut max_inflight = 2u32;
    let mut dmabuf = false;
    let mut command: Vec<String> = Vec::new();
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--stats" => stats_enabled = true,
            "--no-compress" => compress = false,
            "--stdio" => {}
            // Benchmark: an in-process presenter decodes every frame (lz4 included) and acknowledges it at once.
            "--sink" => sink = true,
            "--no-xwayland" => xwayland = false,
            "--dmabuf" => dmabuf = true,
            // Frames in flight before the client is throttled: 1 = stop-and-wait (lowest latency on a local link),
            // 2-3 hide a WAN round trip.
            "--inflight" => {
                max_inflight = it
                    .next()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(2)
                    .clamp(1, 8)
            }
            "--socket" => socket = it.next(),
            "--" => {
                command = it.collect();
                break;
            }
            "-h" | "--help" => {
                eprintln!(
                    "usage: bunos-wlhost [--stats] [--no-compress] [--sink] [--no-xwayland] [--dmabuf] [--inflight N] [--socket NAME] [-- COMMAND...]"
                );
                return Ok(());
            }
            other => return Err(format!("unknown argument {other}").into()),
        }
    }

    if std::env::var_os("XDG_RUNTIME_DIR").is_none() {
        let dir = std::env::temp_dir().join(format!("bunos-wlhost-{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        unsafe { std::env::set_var("XDG_RUNTIME_DIR", &dir) };
    }

    let (in_tx, in_rx) = channel::channel::<PresenterMsg>();
    // Protocol output: a writer thread owns stdout so a slow link never blocks the compositor.
    let stdout = io::stdout();
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    if sink {
        let ack = in_tx.clone();
        std::thread::spawn(move || sink_presenter(out_rx, ack));
    } else {
        std::thread::spawn(move || {
            let mut w = BufWriter::with_capacity(1 << 20, stdout.lock());
            while let Ok(msg) = out_rx.recv() {
                if w.write_all(&msg).is_err() {
                    return;
                }
                // Coalesce whatever is already queued before flushing.
                while let Ok(more) = out_rx.try_recv() {
                    if w.write_all(&more).is_err() {
                        return;
                    }
                }
                if w.flush().is_err() {
                    return;
                }
            }
        });
    }

    // Protocol input: a reader thread decodes presenter messages into the event loop.
    if !sink {
        std::thread::spawn(move || {
            let mut stdin = io::stdin().lock();
            let mut buf = Vec::new();
            loop {
                match wire::read_message(&mut stdin, &mut buf) {
                    Ok(Some(())) => match PresenterMsg::decode(&buf) {
                        Ok(m) => {
                            if in_tx.send(m).is_err() {
                                return;
                            }
                        }
                        Err(e) => eprintln!("bunos-wlhost: {e}"),
                    },
                    Ok(None) | Err(_) => return,
                }
            }
        });
    }

    let mut event_loop: EventLoop<'static, Host> = EventLoop::try_new()?;
    let display: Display<Host> = Display::new()?;
    let dh = display.handle();

    let listening = match &socket {
        Some(name) => ListeningSocketSource::with_name(name)?,
        None => ListeningSocketSource::new_auto()?,
    };
    let socket_name = listening.socket_name().to_os_string();
    let handle = event_loop.handle();
    handle.insert_source(listening, |stream, _, state| {
        if let Err(e) = state
            .dh
            .insert_client(stream, Arc::new(ClientState::default()))
        {
            eprintln!("bunos-wlhost: client rejected: {e}");
        }
    })?;
    handle.insert_source(
        Generic::new(display, Interest::READ, IoMode::Level),
        |_, display, state| {
            unsafe { display.get_mut().dispatch_clients(state).unwrap() };
            Ok(PostAction::Continue)
        },
    )?;
    handle.insert_source(in_rx, |event, _, state| match event {
        channel::Event::Msg(m) => state.on_presenter(m),
        channel::Event::Closed => {
            eprintln!("bunos-wlhost: presenter closed the stream");
            state.loop_signal.stop();
        }
    })?;

    let compositor_state = CompositorState::new_v6::<Host>(&dh);
    let xdg_shell_state = XdgShellState::new::<Host>(&dh);
    let xdg_decoration_state = XdgDecorationState::new::<Host>(&dh);
    let shm_state = ShmState::new::<Host>(&dh, vec![]);
    let output_manager_state = OutputManagerState::new_with_xdg_output::<Host>(&dh);
    let data_device_state = DataDeviceState::new::<Host>(&dh);
    // linux-dmabuf: pixman maps linear dmabufs, so GBM-based clients (Hyprland/aquamarine, wlroots, Chromium) can
    // allocate on a DRM node and hand their buffers over. v4 with default feedback names that node (dmabuf_main_node).
    let renderer = PixmanRenderer::new()?;
    let formats = renderer.dmabuf_formats();
    let mut dmabuf_state = DmabufState::new();
    let main_node = dmabuf_main_node();
    if dmabuf {
        eprintln!(
            "bunos-wlhost: linux-dmabuf main device {}",
            main_node.as_ref().map_or("none", |(p, _)| p.as_str())
        );
    }
    let feedback = main_node.and_then(|(_, dev)| {
        DmabufFeedbackBuilder::new(dev as _, formats.clone())
            .build()
            .ok()
    });
    // Opt-in: with linux-dmabuf advertised, Mesa's WSI prefers it, and on WSL2 the d3d12/Dozen drivers cannot export
    // dmabufs (vkcube hangs), so GPU clients stay on wl_shm unless --dmabuf asks for GBM clients.
    let dmabuf_global = match (dmabuf, &feedback) {
        (false, _) => None,
        (true, Some(fb)) => Some(dmabuf_state.create_global_with_default_feedback::<Host>(&dh, fb)),
        (true, None) => Some(dmabuf_state.create_global::<Host>(&dh, formats.clone())),
    };
    let globals = (
        FractionalScaleManagerState::new::<Host>(&dh),
        ViewporterState::new::<Host>(&dh),
        CursorShapeManagerState::new::<Host>(&dh),
        BackgroundEffectState::new::<Host>(&dh),
    );
    let mut seat_state = SeatState::new();
    let mut seat: Seat<Host> = seat_state.new_wl_seat(&dh, "windows");
    seat.add_keyboard(XkbConfig::default(), 400, 30)?;
    seat.add_pointer();

    let output = Output::new(
        "WIN-1".into(),
        PhysicalProperties {
            size: (0, 0).into(),
            subpixel: Subpixel::Unknown,
            make: "Bun OS".into(),
            model: "Windows desktop".into(),
            serial_number: "0".into(),
        },
    );
    let _global = output.create_global::<Host>(&dh);
    let mode = Mode {
        size: (1920, 1080).into(),
        refresh: 60_000,
    };
    output.change_current_state(
        Some(mode),
        Some(Transform::Normal),
        None,
        Some((0, 0).into()),
    );
    output.set_preferred(mode);

    let dh_for_x = dh.clone();
    let mut host = Host {
        start: Instant::now(),
        dh,
        socket_name: socket_name.clone(),
        loop_signal: event_loop.get_signal(),
        compositor_state,
        xdg_shell_state,
        xdg_decoration_state,
        shm_state,
        output_manager_state,
        seat_state,
        data_device_state,
        popups: PopupManager::default(),
        seat,
        output,
        renderer,
        dmabuf_state,
        _dmabuf_global: dmabuf_global,
        windows: Vec::new(),
        next_id: 1,
        out: out_tx,
        compress,
        stats: Stats::default(),
        stats_enabled,
        stats_at: Instant::now(),
        cursor: String::new(),
        scale: 1.0,
        globals,
        loop_handle: event_loop.handle(),
        xwayland_shell_state: XWaylandShellState::new::<Host>(&dh_for_x),
        xwm: None,
        xdisplay: None,
        pending_command: None,
        hello_done: false,
        xwayland_pending: false,
        max_inflight,
    };
    host.send(HostMsg::Hello {
        version: wire::VERSION,
        host: std::fs::read_to_string("/etc/hostname")
            .unwrap_or_default()
            .trim()
            .to_string(),
    });
    eprintln!(
        "bunos-wlhost: WAYLAND_DISPLAY={}",
        socket_name.to_string_lossy()
    );

    // One argument is a shell line ("weston-terminal & xterm"); several are an argv, quoted for /bin/sh -c.
    let command = match command.len() {
        0 => None,
        1 => command.into_iter().next(),
        _ => Some(
            command
                .iter()
                .map(|w| sh_quote(w))
                .collect::<Vec<_>>()
                .join(" "),
        ),
    };
    host.xwayland_pending = xwayland && host.start_xwayland();
    host.pending_command = command;
    host.spawn_pending();

    event_loop.run(Some(Duration::from_millis(4)), &mut host, |h| h.flush())?;
    Ok(())
}

impl Host {
    fn send(&mut self, m: HostMsg) {
        if self.out.send(m.encode()).is_err() {
            self.loop_signal.stop();
        }
    }

    fn spawn(&self, command: &str) {
        // Children must never write to our stdout: it carries the protocol.
        let stderr = io::stderr().as_fd().try_clone_to_owned().ok();
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c")
            .arg(command)
            .env("WAYLAND_DISPLAY", &self.socket_name)
            .env("XDG_SESSION_TYPE", "wayland")
            .env("GDK_BACKEND", "wayland")
            .env("QT_QPA_PLATFORM", "wayland")
            .env("SDL_VIDEODRIVER", "wayland")
            .env("MOZ_ENABLE_WAYLAND", "1")
            .env_remove("DISPLAY")
            .stdin(Stdio::null());
        if let Some(d) = self.xdisplay {
            cmd.env("DISPLAY", format!(":{d}"));
        }
        match stderr {
            Some(fd) => cmd.stdout(Stdio::from(fd)),
            None => cmd.stdout(Stdio::null()),
        };
        match cmd.spawn() {
            Ok(child) => eprintln!("bunos-wlhost: spawned `{command}` (pid {})", child.id()),
            Err(e) => eprintln!("bunos-wlhost: spawn `{command}`: {e}"),
        }
    }

    fn index_of_surface(&self, surface: &WlSurface) -> Option<usize> {
        self.windows.iter().position(|t| {
            t.window
                .wl_surface()
                .map(|s| *s == *surface)
                .unwrap_or(false)
        })
    }

    fn index_of_id(&self, id: u32) -> Option<usize> {
        self.windows.iter().position(|t| t.id == id)
    }

    fn now_ms(&self) -> u32 {
        self.start.elapsed().as_millis() as u32
    }

    fn release_frame_callbacks(&self, idx: usize) {
        let output = self.output.clone();
        self.windows[idx].window.send_frame(
            &self.output,
            self.start.elapsed(),
            Some(Duration::ZERO),
            |_, _| Some(output.clone()),
        );
    }

    fn on_presenter(&mut self, m: PresenterMsg) {
        match m {
            PresenterMsg::Hello {
                version,
                xkb_layout,
                xkb_variant,
                scale_120,
                output_w,
                output_h,
            } => {
                eprintln!(
                    "bunos-wlhost: presenter v{version}, layout {xkb_layout}({xkb_variant}), scale {:.2}, output {output_w}x{output_h}",
                    scale_120 as f64 / 120.0
                );
                let keyboard = self.seat.get_keyboard().unwrap();
                let cfg = XkbConfig {
                    layout: &xkb_layout,
                    variant: &xkb_variant,
                    ..Default::default()
                };
                if let Err(e) = keyboard.set_xkb_config(self, cfg) {
                    eprintln!("bunos-wlhost: xkb layout {xkb_layout}: {e:?}");
                }
                self.scale = (scale_120.max(120) as f64 / 120.0).clamp(1.0, 4.0);
                if let Some(v) = std::env::var("BUNOS_WLHOST_SCALE")
                    .ok()
                    .and_then(|v| v.parse::<f64>().ok())
                {
                    self.scale = v.clamp(1.0, 4.0);
                }
                let scale = smithay::output::Scale::Fractional(self.scale);
                let mode = (output_w > 0 && output_h > 0).then(|| Mode {
                    size: (output_w as i32, output_h as i32).into(),
                    refresh: 60_000,
                });
                self.output
                    .change_current_state(mode, None, Some(scale), None);
                if let Some(mode) = mode {
                    self.output.set_preferred(mode);
                }
                self.hello_done = true;
                self.spawn_pending();
                let s = self.scale;
                for t in &self.windows {
                    if let Some(wl) = t.wl() {
                        with_states(&wl, |st| {
                            with_fractional_scale(st, |fs| fs.set_preferred_scale(s))
                        });
                    }
                }
            }
            PresenterMsg::Configure {
                id,
                width,
                height,
                states,
            } => {
                if let Some(i) = self.index_of_id(id) {
                    let (lw, lh) = (
                        (width as f64 / self.scale).round() as i32,
                        (height as f64 / self.scale).round() as i32,
                    );
                    if let Some(x) = self.windows[i].window.x11_surface() {
                        let _ = x.set_activated(states & wire::STATE_ACTIVATED != 0);
                        let _ = x.set_maximized(states & wire::STATE_MAXIMIZED != 0);
                        let _ = x.set_fullscreen(states & wire::STATE_FULLSCREEN != 0);
                        if lw > 0 && lh > 0 && !x.is_override_redirect() {
                            let _ = x
                                .configure(Rectangle::new(self.windows[i].origin, (lw, lh).into()));
                        }
                        return;
                    }
                    let Some(tl) = self.windows[i].window.toplevel().cloned() else {
                        return;
                    };
                    tl.with_pending_state(|s| {
                        s.size = if lw > 0 && lh > 0 {
                            Some((lw, lh).into())
                        } else {
                            None
                        };
                        for (bit, st) in [
                            (wire::STATE_ACTIVATED, xdg_toplevel::State::Activated),
                            (wire::STATE_MAXIMIZED, xdg_toplevel::State::Maximized),
                            (wire::STATE_FULLSCREEN, xdg_toplevel::State::Fullscreen),
                        ] {
                            if states & bit != 0 {
                                s.states.set(st);
                            } else {
                                s.states.unset(st);
                            }
                        }
                    });
                    if tl.is_initial_configure_sent() {
                        tl.send_pending_configure();
                    }
                }
            }
            PresenterMsg::PointerMotion { id, x, y, time_ms } => {
                let Some(i) = self.index_of_id(id) else {
                    return;
                };
                let geo = self.windows[i].window.geometry();
                let local: Point<f64, smithay::utils::Logical> = (
                    x / self.scale + geo.loc.x as f64,
                    y / self.scale + geo.loc.y as f64,
                )
                    .into();
                let o = self.windows[i].origin;
                let under = self.windows[i]
                    .window
                    .surface_under(local, WindowSurfaceType::ALL)
                    .map(|(s, p)| (s, (p + o).to_f64()));
                let pointer = self.seat.get_pointer().unwrap();
                let event = MotionEvent {
                    location: local + o.to_f64(),
                    serial: SERIAL_COUNTER.next_serial(),
                    time: InputTime::from_millis(time_ms),
                };
                pointer.motion(self, under, &event);
                pointer.frame(self);
            }
            PresenterMsg::PointerLeave { .. } => {
                let pointer = self.seat.get_pointer().unwrap();
                let loc = pointer.current_location();
                let event = MotionEvent {
                    location: loc,
                    serial: SERIAL_COUNTER.next_serial(),
                    time: InputTime::from_millis(self.now_ms()),
                };
                pointer.motion(self, None, &event);
                pointer.frame(self);
            }
            PresenterMsg::PointerButton {
                id,
                button,
                pressed,
                time_ms,
            } => {
                let serial = SERIAL_COUNTER.next_serial();
                if pressed
                    && self
                        .index_of_id(id)
                        .map(|i| self.windows[i].parent == 0)
                        .unwrap_or(false)
                {
                    self.focus(id, true, serial);
                }
                let pointer = self.seat.get_pointer().unwrap();
                let state = if pressed {
                    ButtonState::Pressed
                } else {
                    ButtonState::Released
                };
                pointer.button(
                    self,
                    &ButtonEvent {
                        button,
                        state,
                        serial,
                        time: InputTime::from_millis(time_ms),
                    },
                );
                pointer.frame(self);
            }
            PresenterMsg::PointerAxis {
                dx,
                dy,
                v120_x,
                v120_y,
                time_ms,
                ..
            } => {
                use smithay::backend::input::{Axis, AxisSource};
                let mut frame =
                    AxisFrame::new(InputTime::from_millis(time_ms)).source(AxisSource::Wheel);
                if dx != 0.0 {
                    frame = frame
                        .value(Axis::Horizontal, dx)
                        .v120(Axis::Horizontal, v120_x);
                }
                if dy != 0.0 {
                    frame = frame.value(Axis::Vertical, dy).v120(Axis::Vertical, v120_y);
                }
                let pointer = self.seat.get_pointer().unwrap();
                pointer.axis(self, frame);
                pointer.frame(self);
            }
            PresenterMsg::Key {
                keycode,
                pressed,
                time_ms,
            } => {
                let keyboard = self.seat.get_keyboard().unwrap();
                let state = if pressed {
                    KeyState::Pressed
                } else {
                    KeyState::Released
                };
                keyboard.input::<(), _>(
                    self,
                    (keycode + 8).into(),
                    state,
                    SERIAL_COUNTER.next_serial(),
                    InputTime::from_millis(time_ms),
                    |_, _, _| FilterResult::Forward,
                );
            }
            PresenterMsg::Focus { id, focused } => {
                self.focus(id, focused, SERIAL_COUNTER.next_serial())
            }
            PresenterMsg::Close { id } => {
                if let Some(i) = self.index_of_id(id) {
                    match self.windows[i].window.underlying_surface() {
                        WindowSurface::Wayland(tl) => tl.send_close(),
                        WindowSurface::X11(x) => {
                            let _ = x.close();
                        }
                    }
                }
            }
            PresenterMsg::FrameAck { id, seq } => {
                if let Some(i) = self.index_of_id(id) {
                    let tl = &mut self.windows[i];
                    if tl.inflight.iter().any(|(s, _)| *s == seq) {
                        while let Some((s, at)) = tl.inflight.pop_front() {
                            if s == seq {
                                self.stats.rtt_sum += at.elapsed();
                                self.stats.rtt_n += 1;
                                break;
                            }
                        }
                    }
                    self.release_frame_callbacks(i);
                }
            }
            PresenterMsg::Launch { command } => self.spawn(&command),
        }
    }

    fn focus(&mut self, id: u32, focused: bool, serial: Serial) {
        let Some(i) = self.index_of_id(id) else {
            return;
        };
        let keyboard = self.seat.get_keyboard().unwrap();
        let Some(surface) = self.windows[i].wl() else {
            return;
        };
        if let (Some(x), Some(wm)) = (
            self.windows[i].window.x11_surface().cloned(),
            self.xwm.as_mut(),
        ) {
            if focused {
                let _ = wm.raise_window(&x);
            }
        }
        if focused {
            if keyboard.current_focus().as_ref() != Some(&surface) {
                keyboard.set_focus(self, Some(surface), serial);
            }
        } else if keyboard.current_focus().as_ref() == Some(&surface) {
            keyboard.set_focus(self, None::<WlSurface>, serial);
        }
        for t in &self.windows {
            let active = focused && t.id == id || (!focused && false);
            if t.id == id || active {
                t.window.set_activated(focused && t.id == id);
                if let Some(tl) = t.window.toplevel() {
                    if tl.is_initial_configure_sent() {
                        tl.send_pending_configure();
                    }
                }
            }
        }
    }

    /// Renders and ships every dirty toplevel whose previous frame was acknowledged.
    fn flush(&mut self) {
        self.popups.cleanup();
        for i in 0..self.windows.len() {
            self.update_meta(i);
            if self.windows[i].dirty && (self.windows[i].inflight.len() as u32) < self.max_inflight
            {
                self.windows[i].dirty = false;
                // Nothing visible changed, or credit left for another frame on the link: let the client draw now.
                if !self.render(i) || (self.windows[i].inflight.len() as u32) < self.max_inflight {
                    self.release_frame_callbacks(i);
                }
            }
        }
        let _ = self.dh.flush_clients();
        if self.stats_enabled && self.stats_at.elapsed() >= Duration::from_secs(5) {
            let s = &self.stats;
            let secs = self.stats_at.elapsed().as_secs_f64();
            eprintln!(
                "bunos-wlhost: {:.1} fps, raw {:.1} MB/s, wire {:.2} MB/s, render {:.2} ms/frame, ack rtt {:.1} ms",
                s.frames as f64 / secs,
                s.bytes_raw as f64 / secs / 1e6,
                s.bytes_wire as f64 / secs / 1e6,
                if s.frames > 0 {
                    s.render.as_secs_f64() * 1e3 / s.frames as f64
                } else {
                    0.0
                },
                if s.rtt_n > 0 {
                    s.rtt_sum.as_secs_f64() * 1e3 / s.rtt_n as f64
                } else {
                    0.0
                },
            );
            self.stats = Stats::default();
            self.stats_at = Instant::now();
        }
    }

    fn update_meta(&mut self, i: usize) {
        let (title, app_id) = match self.windows[i].window.underlying_surface() {
            WindowSurface::Wayland(tl) => with_states(tl.wl_surface(), |states| {
                let d = states
                    .data_map
                    .get::<XdgToplevelSurfaceData>()
                    .unwrap()
                    .lock()
                    .unwrap();
                (
                    d.title.clone().unwrap_or_default(),
                    d.app_id.clone().unwrap_or_default(),
                )
            }),
            WindowSurface::X11(x) => (x.title(), x.class()),
        };
        let t = &mut self.windows[i];
        if t.announced && (title != t.title || app_id != t.app_id) {
            t.title = title.clone();
            t.app_id = app_id.clone();
            let id = t.id;
            self.send(HostMsg::ToplevelMeta { id, title, app_id });
        } else if !t.announced {
            t.title = title;
            t.app_id = app_id;
        }
    }

    /// Returns true when a frame was sent.
    fn render(&mut self, i: usize) -> bool {
        let started = Instant::now();
        let geo = self.windows[i].window.geometry();
        let scale = self.scale;
        let phys = geo.size.to_f64().to_physical(scale).to_i32_round::<i32>();
        let (w, h) = (phys.w, phys.h);
        if w <= 0 || h <= 0 {
            return false;
        }
        let Host {
            windows, renderer, ..
        } = self;
        let t = &mut windows[i];
        let resized = t.size != (w, h) || t.image.is_none();
        if resized {
            if std::env::var_os("BUNOS_WLHOST_DEBUG").is_some() {
                eprintln!(
                    "bunos-wlhost: toplevel {} geometry {:?} bbox {:?} scale {scale} -> {w}x{h}",
                    t.id,
                    geo,
                    t.window.bbox()
                );
            }
            let image: pixman::Image<'static, 'static> =
                match Offscreen::<pixman::Image<'static, 'static>>::create_buffer(
                    renderer,
                    Fourcc::Argb8888,
                    (w, h).into(),
                ) {
                    Ok(img) => img,
                    Err(e) => {
                        eprintln!("bunos-wlhost: offscreen {w}x{h}: {e}");
                        return false;
                    }
                };
            t.image = Some(image);
            t.tracker = Some(OutputDamageTracker::new((w, h), scale, Transform::Normal));
            t.size = (w, h);
        }
        let elements: Vec<WaylandSurfaceRenderElement<PixmanRenderer>> = t.window.render_elements(
            renderer,
            Point::<f64, smithay::utils::Logical>::from((-geo.loc.x as f64, -geo.loc.y as f64))
                .to_physical(scale)
                .to_i32_round(),
            Scale::from(scale),
            1.0,
        );
        let image = t.image.as_mut().unwrap();
        let damage: Vec<Rectangle<i32, smithay::utils::Physical>> = {
            let mut target = match renderer.bind(image) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("bunos-wlhost: bind: {e}");
                    return false;
                }
            };
            let tracker = t.tracker.as_mut().unwrap();
            match tracker.render_output(
                renderer,
                &mut target,
                1,
                &elements,
                [0.0f32, 0.0, 0.0, 0.0],
            ) {
                Ok(res) => res.damage.cloned().unwrap_or_default(),
                Err(e) => {
                    eprintln!("bunos-wlhost: render: {e:?}");
                    return false;
                }
            }
        };
        let rects: Vec<Rect> = if resized {
            vec![Rect {
                x: 0,
                y: 0,
                w: w as u32,
                h: h as u32,
            }]
        } else {
            damage
                .iter()
                .filter_map(|r| {
                    let r = r.intersection(Rectangle::from_size((w, h).into()))?;
                    (r.size.w > 0 && r.size.h > 0).then(|| Rect {
                        x: r.loc.x as u32,
                        y: r.loc.y as u32,
                        w: r.size.w as u32,
                        h: r.size.h as u32,
                    })
                })
                .collect()
        };
        if rects.is_empty() {
            return false;
        }
        let image = t.image.as_ref().unwrap();
        let stride = image.stride();
        let pixels =
            unsafe { std::slice::from_raw_parts(image.data() as *const u8, stride * h as usize) };
        // Translucency drives the DWM backdrop: sample the alpha channel of the first damaged rectangle.
        let sample_all = resized || t.seq % 60 == 0;
        let translucent = if !sample_all {
            t.translucent
        } else {
            let r = Rect {
                x: 0,
                y: 0,
                w: w as u32,
                h: h as u32,
            };
            (r.y..r.y + r.h).step_by(7).any(|y| {
                let row = &pixels[y as usize * stride + r.x as usize * 4..][..r.w as usize * 4];
                row.chunks_exact(4).step_by(5).any(|p| p[3] != 255)
            })
        };
        let opaque = !translucent;
        let effect_changed = translucent != t.translucent;
        t.translucent = translucent;
        let (codec, raw_len, data) = wire::pack_rects(pixels, stride, &rects, self.compress);
        t.seq = t.seq.wrapping_add(1);
        t.inflight.push_back((t.seq, Instant::now()));
        let (id, seq) = (t.id, t.seq);
        if !t.announced {
            t.announced = true;
            let ssd = match t.window.underlying_surface() {
                WindowSurface::Wayland(tl) => tl.with_committed_state(|s| {
                    s.and_then(|s| s.decoration_mode) == Some(DecorationMode::ServerSide)
                }),
                WindowSurface::X11(x) => !x.is_decorated() && !x.is_override_redirect(),
            };
            let parent = t.parent;
            let offset = t.origin - origin(parent);
            let offset = offset.to_f64().to_physical(scale).to_i32_round::<i32>();
            let msg = HostMsg::ToplevelNew {
                id,
                parent,
                x: offset.x,
                y: offset.y,
                width: w as u32,
                height: h as u32,
                ssd,
                title: t.title.clone(),
                app_id: t.app_id.clone(),
            };
            self.send(msg);
        }
        if effect_changed {
            let blur = self.windows[i].blur;
            self.send(HostMsg::ToplevelEffect {
                id,
                backdrop: if blur {
                    Backdrop::Acrylic
                } else {
                    Backdrop::Mica
                },
                translucent,
            });
        }
        self.stats.frames += 1;
        self.stats.bytes_raw += raw_len as u64;
        self.stats.bytes_wire += data.len() as u64;
        self.stats.render += started.elapsed();
        self.send(HostMsg::Frame {
            id,
            seq,
            width: w as u32,
            height: h as u32,
            opaque,
            rects,
            codec,
            raw_len,
            data,
        });
        true
    }

    fn request(
        &mut self,
        surface: &ToplevelSurface,
        states: u32,
        minimize: bool,
        interactive: Interactive,
        edges: u32,
    ) {
        if let Some(i) = self.index_of_surface(surface.wl_surface()) {
            let id = self.windows[i].id;
            self.send(HostMsg::ToplevelRequest {
                id,
                states,
                minimize,
                interactive,
                edges,
            });
        }
    }
}

impl CompositorHandler for Host {
    fn compositor_state(&mut self) -> &mut CompositorState {
        &mut self.compositor_state
    }

    fn client_compositor_state<'a>(&self, client: &'a Client) -> &'a CompositorClientState {
        if let Some(x) = client.get_data::<XWaylandClientData>() {
            return &x.compositor_state;
        }
        &client.get_data::<ClientState>().unwrap().compositor_state
    }

    fn commit(&mut self, surface: &WlSurface) {
        on_commit_buffer_handler::<Self>(surface);
        let mut root = surface.clone();
        if !is_sync_subsurface(surface) {
            while let Some(parent) = get_parent(&root) {
                root = parent;
            }
        }
        self.popups.commit(surface);
        if let Some(popup) = self.popups.find_popup(surface) {
            if let PopupKind::Xdg(ref xdg) = popup {
                if !xdg.is_initial_configure_sent() {
                    let _ = xdg.send_configure();
                }
            }
            if let Ok(r) = smithay::desktop::find_popup_root_surface(&popup) {
                root = r;
            }
        }
        if let Some(i) = self.index_of_surface(&root) {
            let t = &mut self.windows[i];
            t.window.on_commit();
            t.dirty = true;
            if let Some(tl) = t.window.toplevel() {
                if !tl.is_initial_configure_sent() {
                    tl.send_configure();
                }
            }
        }
    }
}

impl BufferHandler for Host {
    fn buffer_destroyed(&mut self, _buffer: &wl_buffer::WlBuffer) {}
}

impl DmabufHandler for Host {
    fn dmabuf_state(&mut self) -> &mut DmabufState {
        &mut self.dmabuf_state
    }

    fn dmabuf_imported(
        &mut self,
        _global: &DmabufGlobal,
        dmabuf: Dmabuf,
        notifier: ImportNotifier,
    ) {
        if std::env::var_os("BUNOS_WLHOST_DEBUG").is_some() {
            use smithay::backend::allocator::Buffer;
            eprintln!(
                "bunos-wlhost: dmabuf {:?} {:?} {}x{}",
                dmabuf.format().code,
                dmabuf.format().modifier,
                dmabuf.width(),
                dmabuf.height()
            );
        }
        if self.renderer.import_dmabuf(&dmabuf, None).is_ok() {
            let _ = notifier.successful::<Host>();
        } else {
            notifier.failed();
        }
    }
}

impl ShmHandler for Host {
    fn shm_state(&self) -> &ShmState {
        &self.shm_state
    }
}

impl XdgShellHandler for Host {
    fn xdg_shell_state(&mut self) -> &mut XdgShellState {
        &mut self.xdg_shell_state
    }

    fn new_toplevel(&mut self, surface: ToplevelSurface) {
        self.output.enter(surface.wl_surface());
        let id = self.next_id;
        self.next_id += 1;
        self.windows.push(Toplevel::new(
            id,
            Window::new_wayland_window(surface),
            origin(id),
            0,
        ));
        let s = self.scale;
        if let Some(wl) = self.windows.last().and_then(|t| t.wl()) {
            with_states(&wl, |st| {
                with_fractional_scale(st, |fs| fs.set_preferred_scale(s))
            });
        }
    }

    fn toplevel_destroyed(&mut self, surface: ToplevelSurface) {
        if let Some(i) = self.index_of_surface(surface.wl_surface()) {
            let t = self.windows.remove(i);
            if t.announced {
                self.send(HostMsg::ToplevelClosed { id: t.id });
            }
        }
    }

    fn new_popup(&mut self, surface: PopupSurface, _positioner: PositionerState) {
        let _ = self.popups.track_popup(PopupKind::Xdg(surface));
    }

    fn reposition_request(
        &mut self,
        surface: PopupSurface,
        positioner: PositionerState,
        token: u32,
    ) {
        surface.with_pending_state(|state| {
            state.geometry = positioner.get_geometry();
            state.positioner = positioner;
        });
        surface.send_repositioned(token);
    }

    fn grab(&mut self, _surface: PopupSurface, _seat: wl_seat::WlSeat, _serial: Serial) {}

    fn move_request(&mut self, surface: ToplevelSurface, _seat: wl_seat::WlSeat, _serial: Serial) {
        self.request(&surface, 0, false, Interactive::Move, 0);
    }

    fn resize_request(
        &mut self,
        surface: ToplevelSurface,
        _seat: wl_seat::WlSeat,
        _serial: Serial,
        edges: xdg_toplevel::ResizeEdge,
    ) {
        self.request(&surface, 0, false, Interactive::Resize, u32::from(edges));
    }

    fn maximize_request(&mut self, surface: ToplevelSurface) {
        self.request(&surface, wire::STATE_MAXIMIZED, false, Interactive::None, 0);
    }

    fn unmaximize_request(&mut self, surface: ToplevelSurface) {
        self.request(&surface, 0, false, Interactive::None, 0);
    }

    fn fullscreen_request(
        &mut self,
        surface: ToplevelSurface,
        _output: Option<wl_output::WlOutput>,
    ) {
        self.request(
            &surface,
            wire::STATE_FULLSCREEN,
            false,
            Interactive::None,
            0,
        );
    }

    fn unfullscreen_request(&mut self, surface: ToplevelSurface) {
        self.request(&surface, 0, false, Interactive::None, 0);
    }

    fn minimize_request(&mut self, surface: ToplevelSurface) {
        self.request(&surface, 0, true, Interactive::None, 0);
    }
}

impl XdgDecorationHandler for Host {
    fn new_decoration(&mut self, toplevel: ToplevelSurface) {
        // The Win32 frame (caption, snap, Mica) is the decoration.
        toplevel.with_pending_state(|s| s.decoration_mode = Some(DecorationMode::ServerSide));
    }

    fn request_mode(&mut self, toplevel: ToplevelSurface, mode: DecorationMode) {
        toplevel.with_pending_state(|s| s.decoration_mode = Some(mode));
        if toplevel.is_initial_configure_sent() {
            toplevel.send_pending_configure();
        }
    }

    fn unset_mode(&mut self, toplevel: ToplevelSurface) {
        toplevel.with_pending_state(|s| s.decoration_mode = Some(DecorationMode::ServerSide));
        if toplevel.is_initial_configure_sent() {
            toplevel.send_pending_configure();
        }
    }
}

impl SeatHandler for Host {
    type KeyboardFocus = WlSurface;
    type PointerFocus = WlSurface;
    type TouchFocus = WlSurface;

    fn seat_state(&mut self) -> &mut SeatState<Host> {
        &mut self.seat_state
    }

    fn cursor_image(&mut self, _seat: &Seat<Self>, image: CursorImageStatus) {
        let name = match image {
            CursorImageStatus::Hidden => String::new(),
            CursorImageStatus::Named(icon) => icon.name().to_string(),
            _ => "default".to_string(),
        };
        if name != self.cursor {
            self.cursor = name.clone();
            self.send(HostMsg::Cursor { name });
        }
    }

    fn focus_changed(&mut self, seat: &Seat<Self>, focused: Option<&WlSurface>) {
        let client = focused.and_then(|s| self.dh.get_client(s.id()).ok());
        set_data_device_focus(&self.dh, seat, client);
    }
}

impl SelectionHandler for Host {
    type SelectionUserData = ();
}

impl DataDeviceHandler for Host {
    fn data_device_state(&mut self) -> &mut DataDeviceState {
        &mut self.data_device_state
    }
}

impl smithay::input::dnd::DndGrabHandler for Host {}
impl WaylandDndGrabHandler for Host {}

impl OutputHandler for Host {}

impl smithay::wayland::pointer_constraints::PointerConstraintsHandler for Host {}

impl FractionalScaleHandler for Host {
    fn new_fractional_scale(&mut self, surface: WlSurface) {
        let s = self.scale;
        with_states(&surface, |st| {
            with_fractional_scale(st, |fs| fs.set_preferred_scale(s))
        });
    }
}

impl smithay::input::tablet::TabletSeatHandler for Host {
    type ToolFocus = WlSurface;
}

impl ExtBackgroundEffectHandler for Host {
    fn set_blur_region(
        &mut self,
        wl_surface: WlSurface,
        _region: smithay::wayland::compositor::RegionAttributes,
    ) {
        self.set_blur(&wl_surface, true);
    }

    fn unset_blur_region(&mut self, wl_surface: WlSurface) {
        self.set_blur(&wl_surface, false);
    }
}

impl Host {
    /// ext-background-effect-v1 blur on a toplevel maps to DWM Acrylic (live blur of what is behind the window).
    fn set_blur(&mut self, surface: &WlSurface, on: bool) {
        let mut root = surface.clone();
        while let Some(p) = get_parent(&root) {
            root = p;
        }
        if let Some(i) = self.index_of_surface(&root) {
            let t = &mut self.windows[i];
            if t.blur != on {
                t.blur = on;
                let (id, translucent, announced) = (t.id, t.translucent || on, t.announced);
                if announced {
                    self.send(HostMsg::ToplevelEffect {
                        id,
                        backdrop: if on {
                            Backdrop::Acrylic
                        } else {
                            Backdrop::Mica
                        },
                        translucent,
                    });
                }
            }
        }
    }
}

impl Host {
    /// Starts Xwayland (rootless, on-demand X11 for apps without Wayland support). Returns false when unavailable.
    fn start_xwayland(&mut self) -> bool {
        let spawned = XWayland::spawn(
            &self.dh,
            None,
            std::iter::empty::<(String, String)>(),
            std::iter::empty::<String>(),
            true,
            Stdio::null(),
            Stdio::null(),
            |_| (),
        );
        let (xwayland, client) = match spawned {
            Ok(x) => x,
            Err(e) => {
                eprintln!("bunos-wlhost: Xwayland not started: {e}");
                return false;
            }
        };
        let dh = self.dh.clone();
        let handle = self.loop_handle.clone();
        let r = self
            .loop_handle
            .insert_source(xwayland, move |event, _, state| match event {
                XWaylandEvent::Ready {
                    x11_socket,
                    display_number,
                } => {
                    // X11 clients draw in physical pixels: sharp at any Windows scale.
                    state
                        .client_compositor_state(&client)
                        .set_client_scale(state.scale);
                    match X11Wm::start_wm(handle.clone(), &dh, x11_socket, client.clone()) {
                        Ok(wm) => {
                            state.xwm = Some(wm);
                            state.xdisplay = Some(display_number);
                            eprintln!("bunos-wlhost: Xwayland ready, DISPLAY=:{display_number}");
                        }
                        Err(e) => eprintln!("bunos-wlhost: X11 window manager: {e}"),
                    }
                    state.xwayland_pending = false;
                    state.spawn_pending();
                }
                XWaylandEvent::Error => {
                    eprintln!("bunos-wlhost: Xwayland failed to start");
                    state.xwayland_pending = false;
                    state.spawn_pending();
                }
            });
        r.is_ok()
    }

    fn spawn_pending(&mut self) {
        if self.hello_done && !self.xwayland_pending {
            if let Some(c) = self.pending_command.take() {
                self.spawn(&c);
            }
        }
    }

    fn index_of_x11(&self, window: &X11Surface) -> Option<usize> {
        self.windows
            .iter()
            .position(|t| t.window.x11_surface() == Some(window))
    }

    fn remove_window(&mut self, i: usize) {
        let t = self.windows.remove(i);
        if t.announced {
            self.send(HostMsg::ToplevelClosed { id: t.id });
        }
    }
}

impl XWaylandShellHandler for Host {
    fn xwayland_shell_state(&mut self) -> &mut XWaylandShellState {
        &mut self.xwayland_shell_state
    }
}

impl XwmHandler for Host {
    fn xwm_state(&mut self, _xwm: XwmId) -> &mut X11Wm {
        self.xwm.as_mut().unwrap()
    }

    fn new_window(&mut self, _xwm: XwmId, _window: X11Surface) {}

    fn new_override_redirect_window(&mut self, _xwm: XwmId, _window: X11Surface) {}

    fn map_window_request(&mut self, _xwm: XwmId, window: X11Surface) {
        let _ = window.set_mapped(true);
        let id = self.next_id;
        self.next_id += 1;
        let o = origin(id);
        let size = window.geometry().size;
        let size = if size.w > 0 && size.h > 0 {
            size
        } else {
            (640, 480).into()
        };
        let _ = window.configure(Rectangle::new(o, size));
        self.windows
            .push(Toplevel::new(id, Window::new_x11_window(window), o, 0));
    }

    fn mapped_override_redirect_window(&mut self, _xwm: XwmId, window: X11Surface) {
        let loc = window.last_configure().loc;
        // The owning toplevel is the one whose slice of the global space contains the popup.
        let parent = (loc.x.max(0) / STRIDE_X) as u32;
        let parent = if self.index_of_id(parent).is_some() {
            parent
        } else {
            0
        };
        let id = self.next_id;
        self.next_id += 1;
        self.windows.push(Toplevel::new(
            id,
            Window::new_x11_window(window),
            loc,
            parent,
        ));
    }

    fn unmapped_window(&mut self, _xwm: XwmId, window: X11Surface) {
        if let Some(i) = self.index_of_x11(&window) {
            self.remove_window(i);
        }
        if !window.is_override_redirect() {
            let _ = window.set_mapped(false);
        }
    }

    fn destroyed_window(&mut self, _xwm: XwmId, window: X11Surface) {
        if let Some(i) = self.index_of_x11(&window) {
            self.remove_window(i);
        }
    }

    fn configure_request(
        &mut self,
        _xwm: XwmId,
        window: X11Surface,
        _x: Option<i32>,
        _y: Option<i32>,
        w: Option<u32>,
        h: Option<u32>,
        _reorder: Option<Reorder>,
    ) {
        // Sizes are honoured, positions are not: the Win32 window owns placement.
        let mut geo = window.last_configure();
        if let Some(i) = self.index_of_x11(&window) {
            geo.loc = self.windows[i].origin;
        }
        if let Some(w) = w {
            geo.size.w = w as i32;
        }
        if let Some(h) = h {
            geo.size.h = h as i32;
        }
        let _ = window.configure(geo);
    }

    fn configure_notify(
        &mut self,
        _xwm: XwmId,
        window: X11Surface,
        geometry: Rectangle<i32, smithay::utils::Logical>,
        _above: Option<u32>,
    ) {
        if window.is_override_redirect() {
            if let Some(i) = self.index_of_x11(&window) {
                self.windows[i].origin = geometry.loc;
            }
        }
    }

    fn resize_request(
        &mut self,
        _xwm: XwmId,
        window: X11Surface,
        _button: u32,
        edges: X11ResizeEdge,
    ) {
        if let Some(i) = self.index_of_x11(&window) {
            let id = self.windows[i].id;
            let edges = match edges {
                X11ResizeEdge::Top => 1,
                X11ResizeEdge::Bottom => 2,
                X11ResizeEdge::Left => 4,
                X11ResizeEdge::TopLeft => 5,
                X11ResizeEdge::BottomLeft => 6,
                X11ResizeEdge::Right => 8,
                X11ResizeEdge::TopRight => 9,
                X11ResizeEdge::BottomRight => 10,
            };
            self.send(HostMsg::ToplevelRequest {
                id,
                states: 0,
                minimize: false,
                interactive: Interactive::Resize,
                edges,
            });
        }
    }

    fn move_request(&mut self, _xwm: XwmId, window: X11Surface, _button: u32) {
        if let Some(i) = self.index_of_x11(&window) {
            let id = self.windows[i].id;
            self.send(HostMsg::ToplevelRequest {
                id,
                states: 0,
                minimize: false,
                interactive: Interactive::Move,
                edges: 0,
            });
        }
    }
}

delegate_dispatch2!(Host);
