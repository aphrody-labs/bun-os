// SPDX-License-Identifier: Apache-2.0
//! Linux Wayland backend, pure Rust (`wayland-client` with its Rust wire backend):
//! `wlr-screencopy` capture into a shared-memory buffer, `wlr-virtual-pointer` and
//! `zwp-virtual-keyboard` input. Works on wlroots-protocol compositors (Hyprland, Sway,
//! labwc, cage). The output is `APHRODY_WAYLAND_OUTPUT` when set, else the first one.

use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::os::fd::AsFd;
use std::os::unix::fs::FileExt;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result, anyhow, bail};
use wayland_client::globals::{GlobalList, GlobalListContents, registry_queue_init};
use wayland_client::protocol::wl_buffer::WlBuffer;
use wayland_client::protocol::wl_output::{self, WlOutput};
use wayland_client::protocol::wl_pointer::{Axis, AxisSource, ButtonState};
use wayland_client::protocol::wl_registry::WlRegistry;
use wayland_client::protocol::wl_seat::WlSeat;
use wayland_client::protocol::wl_shm::{self, WlShm};
use wayland_client::protocol::wl_shm_pool::WlShmPool;
use wayland_client::{Connection, Dispatch, EventQueue, Proxy, QueueHandle, WEnum, delegate_noop};
use wayland_protocols_misc::zwp_virtual_keyboard_v1::client::zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1;
use wayland_protocols_misc::zwp_virtual_keyboard_v1::client::zwp_virtual_keyboard_v1::ZwpVirtualKeyboardV1;
use wayland_protocols_wlr::screencopy::v1::client::zwlr_screencopy_frame_v1::{
    self, ZwlrScreencopyFrameV1,
};
use wayland_protocols_wlr::screencopy::v1::client::zwlr_screencopy_manager_v1::ZwlrScreencopyManagerV1;
use wayland_protocols_wlr::virtual_pointer::v1::client::zwlr_virtual_pointer_manager_v1::ZwlrVirtualPointerManagerV1;
use wayland_protocols_wlr::virtual_pointer::v1::client::zwlr_virtual_pointer_v1::ZwlrVirtualPointerV1;

use super::{MouseButton, RawFrame, ScreenBackend};

const KEYMAP: &str = include_str!("wayland-us.xkb");
const XKB_V1: u32 = 1;
const BTN_LEFT: u32 = 0x110;
const BTN_RIGHT: u32 = 0x111;
const BTN_MIDDLE: u32 = 0x112;
// xkb modifier masks of the uploaded keymap.
const MOD_SHIFT: u32 = 1;
const MOD_CAPS: u32 = 2;
const MOD_CTRL: u32 = 4;
const MOD_ALT: u32 = 8;
const MOD_SUPER: u32 = 64;
const MOD_ALTGR: u32 = 128;

#[derive(Default)]
struct OutputInfo {
    name: Option<String>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Default)]
struct FrameState {
    info: Option<(wl_shm::Format, u32, u32, u32)>,
    buffer_done: bool,
    y_invert: bool,
    ready: bool,
    failed: bool,
}

#[derive(Default)]
struct State {
    outputs: Vec<OutputInfo>,
    frame: FrameState,
}

struct Shm {
    file: File,
    pool: WlShmPool,
    buffer: WlBuffer,
    key: (wl_shm::Format, u32, u32, u32),
}

struct Input {
    pointer: ZwlrVirtualPointerV1,
    keyboard: Option<ZwpVirtualKeyboardV1>,
    mods: u32,
}

pub struct WaylandBackend {
    conn: Connection,
    queue: EventQueue<State>,
    qh: QueueHandle<State>,
    state: State,
    globals: GlobalList,
    output: WlOutput,
    out_idx: usize,
    shm: WlShm,
    screencopy: Option<ZwlrScreencopyManagerV1>,
    seat: Option<WlSeat>,
    buffer: Option<Shm>,
    input: Option<Input>,
    started: Instant,
}

/// Anonymous file in `XDG_RUNTIME_DIR` (unlinked at once) for shared-memory buffers and the keymap.
fn anon_file(size: u64) -> Result<File> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let mut n = [0u8; 8];
    getrandom::fill(&mut n).map_err(|e| anyhow!("random: {e}"))?;
    let path = dir.join(format!(
        "aphrody-rd-{}-{:016x}",
        std::process::id(),
        u64::from_le_bytes(n)
    ));
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)
        .with_context(|| format!("cannot create {}", path.display()))?;
    let _ = std::fs::remove_file(&path);
    file.set_len(size)?;
    Ok(file)
}

impl WaylandBackend {
    pub fn connect() -> Result<Self> {
        let conn = Connection::connect_to_env()
            .context("cannot connect to the Wayland display (WAYLAND_DISPLAY/XDG_RUNTIME_DIR)")?;
        let (globals, mut queue) =
            registry_queue_init::<State>(&conn).context("Wayland registry")?;
        let qh = queue.handle();
        let mut state = State::default();
        let shm: WlShm = globals.bind(&qh, 1..=1, ()).context("wl_shm missing")?;
        let screencopy = globals
            .bind::<ZwlrScreencopyManagerV1, _, _>(&qh, 1..=3, ())
            .ok();
        let seat = globals.bind::<WlSeat, _, _>(&qh, 1..=7, ()).ok();
        let outputs: Vec<(u32, u32)> = globals.contents().with_list(|l| {
            l.iter()
                .filter(|g| g.interface == WlOutput::interface().name)
                .map(|g| (g.name, g.version))
                .collect()
        });
        let mut proxies = Vec::new();
        for (i, (name, version)) in outputs.into_iter().enumerate() {
            state.outputs.push(OutputInfo::default());
            proxies.push(
                globals
                    .registry()
                    .bind::<WlOutput, _, _>(name, version.min(4), &qh, i),
            );
        }
        if proxies.is_empty() {
            bail!("the Wayland compositor has no output");
        }
        queue.roundtrip(&mut state)?;
        queue.roundtrip(&mut state)?;
        let wanted = std::env::var("APHRODY_WAYLAND_OUTPUT")
            .ok()
            .filter(|s| !s.is_empty());
        let out_idx = match &wanted {
            Some(w) => state
                .outputs
                .iter()
                .position(|o| o.name.as_deref() == Some(w.as_str()))
                .with_context(|| format!("no Wayland output named {w}"))?,
            None => state.outputs.iter().position(|o| o.width > 0).unwrap_or(0),
        };
        let output = proxies[out_idx].clone();
        Ok(Self {
            conn,
            queue,
            qh,
            state,
            globals,
            output,
            out_idx,
            shm,
            screencopy,
            seat,
            buffer: None,
            input: None,
            started: Instant::now(),
        })
    }

    fn now(&self) -> u32 {
        u32::try_from(self.started.elapsed().as_millis() & 0xFFFF_FFFF).unwrap_or(0)
    }

    fn dispatch_until(&mut self, done: impl Fn(&FrameState) -> bool) -> Result<()> {
        while !done(&self.state.frame) {
            self.queue
                .blocking_dispatch(&mut self.state)
                .context("Wayland dispatch")?;
        }
        Ok(())
    }

    fn ensure_buffer(&mut self, key: (wl_shm::Format, u32, u32, u32)) -> Result<()> {
        if self.buffer.as_ref().is_some_and(|b| b.key == key) {
            return Ok(());
        }
        if let Some(old) = self.buffer.take() {
            old.buffer.destroy();
            old.pool.destroy();
        }
        let (format, w, h, stride) = key;
        let size = u64::from(stride) * u64::from(h);
        let file = anon_file(size)?;
        let pool = self
            .shm
            .create_pool(file.as_fd(), i32::try_from(size)?, &self.qh, ());
        let buffer = pool.create_buffer(
            0,
            i32::try_from(w)?,
            i32::try_from(h)?,
            i32::try_from(stride)?,
            format,
            &self.qh,
            (),
        );
        self.buffer = Some(Shm {
            file,
            pool,
            buffer,
            key,
        });
        Ok(())
    }

    fn input(&mut self) -> Result<&mut Input> {
        if self.input.is_none() {
            let vpm: ZwlrVirtualPointerManagerV1 = self
                .globals
                .bind(&self.qh, 1..=2, ())
                .context("compositor lacks zwlr_virtual_pointer_manager_v1")?;
            let pointer = if vpm.version() >= 2 {
                vpm.create_virtual_pointer_with_output(
                    self.seat.as_ref(),
                    Some(&self.output),
                    &self.qh,
                    (),
                )
            } else {
                vpm.create_virtual_pointer(self.seat.as_ref(), &self.qh, ())
            };
            let keyboard = match (
                &self.seat,
                self.globals
                    .bind::<ZwpVirtualKeyboardManagerV1, _, _>(&self.qh, 1..=1, ()),
            ) {
                (Some(seat), Ok(vkm)) => {
                    let kb = vkm.create_virtual_keyboard(seat, &self.qh, ());
                    let mut file = anon_file(0)?;
                    file.write_all(KEYMAP.as_bytes())?;
                    file.write_all(&[0])?;
                    kb.keymap(XKB_V1, file.as_fd(), u32::try_from(KEYMAP.len() + 1)?);
                    Some(kb)
                }
                _ => None,
            };
            self.input = Some(Input {
                pointer,
                keyboard,
                mods: 0,
            });
        }
        self.input.as_mut().context("input")
    }

    fn flush(&self) -> Result<()> {
        self.conn.flush().context("Wayland flush")
    }

    fn evdev_key(&mut self, code: u32, down: bool) -> Result<()> {
        let time = self.now();
        let input = self.input()?;
        let kb = input
            .keyboard
            .as_ref()
            .context("compositor lacks zwp_virtual_keyboard_manager_v1 or a seat")?;
        let bit = match code {
            42 | 54 => MOD_SHIFT,
            29 | 97 => MOD_CTRL,
            56 => MOD_ALT,
            100 => MOD_ALTGR,
            125 | 126 => MOD_SUPER,
            _ => 0,
        };
        kb.key(time, code, u32::from(down));
        if bit != 0 {
            if down {
                input.mods |= bit
            } else {
                input.mods &= !bit
            }
            kb.modifiers(input.mods, 0, if code == 58 { MOD_CAPS } else { 0 }, 0);
        }
        self.flush()
    }
}

/// Linux evdev key code of a `KeyboardEvent.code`.
pub fn code_to_evdev(code: &str) -> Option<u32> {
    const LETTERS: [u32; 26] = [
        30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50, 49, 24, 25, 16, 19, 31, 20, 22, 47, 17,
        45, 21, 44,
    ];
    if let Some(l) = code.strip_prefix("Key") {
        let b = l.as_bytes();
        if b.len() == 1 && b[0].is_ascii_uppercase() {
            return Some(LETTERS[usize::from(b[0] - b'A')]);
        }
    }
    if let Some(d) = code.strip_prefix("Digit") {
        let b = d.as_bytes();
        if b.len() == 1 && b[0].is_ascii_digit() {
            return Some(if b[0] == b'0' {
                11
            } else {
                u32::from(b[0] - b'1') + 2
            });
        }
    }
    if let Some(n) = code.strip_prefix('F').and_then(|n| n.parse::<u32>().ok()) {
        return match n {
            1..=10 => Some(58 + n),
            11 => Some(87),
            12 => Some(88),
            13..=24 => Some(170 + n),
            _ => None,
        };
    }
    Some(match code {
        "Escape" => 1,
        "Minus" => 12,
        "Equal" => 13,
        "Backspace" => 14,
        "Tab" => 15,
        "BracketLeft" => 26,
        "BracketRight" => 27,
        "Enter" => 28,
        "ControlLeft" => 29,
        "Semicolon" => 39,
        "Quote" => 40,
        "Backquote" => 41,
        "ShiftLeft" => 42,
        "Backslash" => 43,
        "Comma" => 51,
        "Period" => 52,
        "Slash" => 53,
        "ShiftRight" => 54,
        "NumpadMultiply" => 55,
        "AltLeft" => 56,
        "Space" => 57,
        "CapsLock" => 58,
        "NumLock" => 69,
        "ScrollLock" => 70,
        "Numpad7" => 71,
        "Numpad8" => 72,
        "Numpad9" => 73,
        "NumpadSubtract" => 74,
        "Numpad4" => 75,
        "Numpad5" => 76,
        "Numpad6" => 77,
        "NumpadAdd" => 78,
        "Numpad1" => 79,
        "Numpad2" => 80,
        "Numpad3" => 81,
        "Numpad0" => 82,
        "NumpadDecimal" => 83,
        "IntlBackslash" => 86,
        "NumpadEnter" => 96,
        "ControlRight" => 97,
        "NumpadDivide" => 98,
        "PrintScreen" => 99,
        "AltRight" => 100,
        "Home" => 102,
        "ArrowUp" => 103,
        "PageUp" => 104,
        "ArrowLeft" => 105,
        "ArrowRight" => 106,
        "End" => 107,
        "ArrowDown" => 108,
        "PageDown" => 109,
        "Insert" => 110,
        "Delete" => 111,
        "NumpadEqual" => 117,
        "Pause" => 119,
        "MetaLeft" | "OSLeft" => 125,
        "MetaRight" | "OSRight" => 126,
        "ContextMenu" => 127,
        _ => return None,
    })
}

/// evdev key and Shift of an ASCII character on the US layout of [`KEYMAP`].
fn char_to_evdev(c: char) -> Option<(u32, bool)> {
    const SHIFTED: &str = "~!@#$%^&*()_+{}|:\"<>?";
    const PLAIN: &str = "`1234567890-=[]\\;',./";
    let code = |s: &str| code_to_evdev(s);
    match c {
        'a'..='z' => code(&format!("Key{}", c.to_ascii_uppercase())).map(|k| (k, false)),
        'A'..='Z' => code(&format!("Key{c}")).map(|k| (k, true)),
        ' ' => Some((57, false)),
        '\n' | '\r' => Some((28, false)),
        '\t' => Some((15, false)),
        '\u{8}' => Some((14, false)),
        c => {
            let (i, shift) = PLAIN
                .find(c)
                .map(|i| (i, false))
                .or_else(|| SHIFTED.find(c).map(|i| (i, true)))?;
            let base = PLAIN.as_bytes()[i] as char;
            let name = match base {
                '`' => "Backquote".to_owned(),
                '0'..='9' => format!("Digit{base}"),
                '-' => "Minus".to_owned(),
                '=' => "Equal".to_owned(),
                '[' => "BracketLeft".to_owned(),
                ']' => "BracketRight".to_owned(),
                '\\' => "Backslash".to_owned(),
                ';' => "Semicolon".to_owned(),
                '\'' => "Quote".to_owned(),
                ',' => "Comma".to_owned(),
                '.' => "Period".to_owned(),
                _ => "Slash".to_owned(),
            };
            code(&name).map(|k| (k, shift))
        }
    }
}

impl ScreenBackend for WaylandBackend {
    fn name(&self) -> &'static str {
        "wayland"
    }

    fn capture(&mut self) -> Result<RawFrame> {
        let mgr = self
            .screencopy
            .clone()
            .context("compositor lacks zwlr_screencopy_manager_v1")?;
        self.state.frame = FrameState::default();
        let frame = mgr.capture_output(1, &self.output, &self.qh, ());
        let v3 = frame.version() >= 3;
        self.dispatch_until(|f| f.failed || (f.info.is_some() && (!v3 || f.buffer_done)))?;
        let Some(key) = self.state.frame.info.filter(|_| !self.state.frame.failed) else {
            frame.destroy();
            bail!("screencopy failed (no usable shm format)");
        };
        self.ensure_buffer(key)?;
        let shm = self.buffer.as_ref().context("buffer")?;
        frame.copy(&shm.buffer);
        self.dispatch_until(|f| f.ready || f.failed)?;
        frame.destroy();
        if self.state.frame.failed {
            bail!("screencopy copy failed");
        }
        let (format, w, h, stride) = key;
        let mut raw = vec![0u8; stride as usize * h as usize];
        self.buffer
            .as_ref()
            .context("buffer")?
            .file
            .read_exact_at(&mut raw, 0)?;
        let swap = matches!(format, wl_shm::Format::Xbgr8888 | wl_shm::Format::Abgr8888);
        let row = w as usize * 4;
        let mut bgra = vec![0u8; row * h as usize];
        for y in 0..h as usize {
            let src_y = if self.state.frame.y_invert {
                h as usize - 1 - y
            } else {
                y
            };
            let src = &raw[src_y * stride as usize..src_y * stride as usize + row];
            let dst = &mut bgra[y * row..(y + 1) * row];
            dst.copy_from_slice(src);
            if swap {
                for px in dst.chunks_exact_mut(4) {
                    px.swap(0, 2);
                }
            }
        }
        let o = &self.state.outputs[self.out_idx];
        Ok(RawFrame {
            origin_x: o.x,
            origin_y: o.y,
            width: w,
            height: h,
            bgra,
        })
    }

    fn mouse_move(&mut self, x: i32, y: i32) -> Result<()> {
        let time = self.now();
        let o = &self.state.outputs[self.out_idx];
        let (ox, oy, w, h) = (o.x, o.y, o.width.max(1), o.height.max(1));
        let input = self.input()?;
        let px = (x - ox).clamp(0, w - 1);
        let py = (y - oy).clamp(0, h - 1);
        input
            .pointer
            .motion_absolute(time, px as u32, py as u32, w as u32, h as u32);
        input.pointer.frame();
        self.flush()
    }

    fn mouse_button(&mut self, button: MouseButton, down: bool) -> Result<()> {
        let time = self.now();
        let code = match button {
            MouseButton::Left => BTN_LEFT,
            MouseButton::Right => BTN_RIGHT,
            MouseButton::Middle => BTN_MIDDLE,
        };
        let input = self.input()?;
        input.pointer.button(
            time,
            code,
            if down {
                ButtonState::Pressed
            } else {
                ButtonState::Released
            },
        );
        input.pointer.frame();
        self.flush()
    }

    fn wheel(&mut self, dx: i32, dy: i32) -> Result<()> {
        let time = self.now();
        let input = self.input()?;
        input.pointer.axis_source(AxisSource::Wheel);
        // Trait convention: positive dy scrolls up; Wayland axis values grow downwards (15 per notch).
        if dy != 0 {
            input.pointer.axis_discrete(
                time,
                Axis::VerticalScroll,
                -f64::from(dy) / 8.0,
                -dy / 120,
            );
        }
        if dx != 0 {
            input.pointer.axis_discrete(
                time,
                Axis::HorizontalScroll,
                f64::from(dx) / 8.0,
                dx / 120,
            );
        }
        input.pointer.frame();
        self.flush()
    }

    fn key(&mut self, code: &str, down: bool) -> Result<()> {
        let k = code_to_evdev(code).ok_or_else(|| anyhow!("unmapped key code {code}"))?;
        self.evdev_key(k, down)
    }

    fn text(&mut self, text: &str) -> Result<()> {
        for c in text.chars() {
            let Some((k, shift)) = char_to_evdev(c) else {
                continue; // not on the US layout: clipboard paste carries it
            };
            if shift {
                self.evdev_key(42, true)?;
            }
            self.evdev_key(k, true)?;
            self.evdev_key(k, false)?;
            if shift {
                self.evdev_key(42, false)?;
            }
        }
        Ok(())
    }
}

impl Dispatch<WlRegistry, GlobalListContents> for State {
    fn event(
        _: &mut Self,
        _: &WlRegistry,
        _: <WlRegistry as Proxy>::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<WlOutput, usize> for State {
    fn event(
        state: &mut Self,
        _: &WlOutput,
        event: wl_output::Event,
        idx: &usize,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let Some(o) = state.outputs.get_mut(*idx) else {
            return;
        };
        match event {
            wl_output::Event::Geometry { x, y, .. } => {
                o.x = x;
                o.y = y;
            }
            wl_output::Event::Mode {
                flags,
                width,
                height,
                ..
            } => {
                if matches!(flags, WEnum::Value(f) if f.contains(wl_output::Mode::Current)) {
                    o.width = width;
                    o.height = height;
                }
            }
            wl_output::Event::Name { name } => o.name = Some(name),
            _ => {}
        }
    }
}

impl Dispatch<ZwlrScreencopyFrameV1, ()> for State {
    fn event(
        state: &mut Self,
        _: &ZwlrScreencopyFrameV1,
        event: zwlr_screencopy_frame_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let f = &mut state.frame;
        match event {
            zwlr_screencopy_frame_v1::Event::Buffer {
                format: WEnum::Value(format),
                width,
                height,
                stride,
            } => {
                if matches!(
                    format,
                    wl_shm::Format::Xrgb8888
                        | wl_shm::Format::Argb8888
                        | wl_shm::Format::Xbgr8888
                        | wl_shm::Format::Abgr8888
                ) && f.info.is_none()
                {
                    f.info = Some((format, width, height, stride));
                }
            }
            zwlr_screencopy_frame_v1::Event::Flags {
                flags: WEnum::Value(flags),
            } => {
                f.y_invert = flags.contains(zwlr_screencopy_frame_v1::Flags::YInvert);
            }
            zwlr_screencopy_frame_v1::Event::BufferDone => f.buffer_done = true,
            zwlr_screencopy_frame_v1::Event::Ready { .. } => f.ready = true,
            zwlr_screencopy_frame_v1::Event::Failed => f.failed = true,
            _ => {}
        }
    }
}

delegate_noop!(State: ignore WlShm);
delegate_noop!(State: WlShmPool);
delegate_noop!(State: ignore WlBuffer);
delegate_noop!(State: ignore WlSeat);
delegate_noop!(State: ZwlrScreencopyManagerV1);
delegate_noop!(State: ZwlrVirtualPointerManagerV1);
delegate_noop!(State: ZwlrVirtualPointerV1);
delegate_noop!(State: ZwpVirtualKeyboardManagerV1);
delegate_noop!(State: ZwpVirtualKeyboardV1);
