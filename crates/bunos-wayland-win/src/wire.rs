// SPDX-License-Identifier: Apache-2.0
//! The host <-> presenter protocol. Every message is `u32 length (LE) | u8 tag | payload`, the length counting tag and
//! payload. Integers are little endian, strings are `u32 length | UTF-8`. Pixels are BGRA8 premultiplied
//! (pixman `A8R8G8B8` in memory, Windows `DXGI_FORMAT_B8G8R8A8_UNORM` / 32 bpp DIB), rows tightly packed per rectangle.
//! The stream is ordered and reliable (stdio, TCP, AF_UNIX, hvsocket/vsock); no file descriptors cross it, which is the
//! point: Windows AF_UNIX has no SCM_RIGHTS, so Wayland itself cannot cross the VM or the network unchanged.

use std::io::{self, Read, Write};

pub const VERSION: u32 = 1;
/// Upper bound for one message (a full 8K frame, uncompressed, plus headers).
pub const MAX_MESSAGE: usize = 7680 * 4320 * 4 + 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    pub fn area(&self) -> usize {
        self.w as usize * self.h as usize
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Codec {
    Raw = 0,
    Lz4 = 1,
}

/// DWM backdrop requested for a toplevel (Wayland `ext-background-effect-v1` / KDE blur map to `Acrylic`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Backdrop {
    /// Opaque client area, no system backdrop.
    None = 0,
    /// Mica (DWMSBT_MAINWINDOW): wallpaper-tinted, cheap, for main windows.
    Mica = 1,
    /// Acrylic (DWMSBT_TRANSIENTWINDOW): live blur of what is behind, for blur-requesting and translucent surfaces.
    Acrylic = 2,
    /// Mica Alt (DWMSBT_TABBEDWINDOW).
    MicaAlt = 3,
}

impl Backdrop {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Mica,
            2 => Self::Acrylic,
            3 => Self::MicaAlt,
            _ => Self::None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Interactive {
    None = 0,
    Move = 1,
    /// `edges` carries the xdg_toplevel.resize_edge value (1 top, 2 bottom, 4 left, 8 right, sums for corners).
    Resize = 2,
}

pub const STATE_ACTIVATED: u32 = 1;
pub const STATE_MAXIMIZED: u32 = 2;
pub const STATE_FULLSCREEN: u32 = 4;

/// Host (Linux compositor) to presenter (Windows).
#[derive(Clone, Debug, PartialEq)]
pub enum HostMsg {
    Hello { version: u32, host: String },
    /// A toplevel was mapped. `ssd` = the client accepted server-side decorations (the Win32 frame). A non-zero
    /// `parent` marks a popup (X11 override-redirect menu or tooltip) placed at `x`,`y` physical pixels from the
    /// parent's client origin.
    ToplevelNew { id: u32, parent: u32, x: i32, y: i32, width: u32, height: u32, ssd: bool, title: String, app_id: String },
    ToplevelMeta { id: u32, title: String, app_id: String },
    /// The client asked, from its own CSD, for a state (maximize/fullscreen/minimize) or an interactive move/resize,
    /// which the presenter turns into the native Win32 move/resize loop (snap layouts included).
    ToplevelRequest { id: u32, states: u32, minimize: bool, interactive: Interactive, edges: u32 },
    ToplevelEffect { id: u32, backdrop: Backdrop, translucent: bool },
    ToplevelClosed { id: u32 },
    /// A new picture of the toplevel. Only `rects` changed since the previous frame of the same size; a size change
    /// always comes with one full rectangle. `data` holds the rectangles' rows back to back, coded with `codec`.
    Frame { id: u32, seq: u32, width: u32, height: u32, opaque: bool, rects: Vec<Rect>, codec: Codec, raw_len: u32, data: Vec<u8> },
    /// Named cursor (CSS / cursor-shape-v1 names), empty = hidden.
    Cursor { name: String },
    Bye { reason: String },
}

/// Presenter (Windows) to host.
#[derive(Clone, Debug, PartialEq)]
pub enum PresenterMsg {
    /// `xkb_layout`/`xkb_variant` follow the active Windows keyboard layout; `scale_120` = DPI scale x120.
    Hello { version: u32, xkb_layout: String, xkb_variant: String, scale_120: u32, output_w: u32, output_h: u32 },
    Configure { id: u32, width: u32, height: u32, states: u32 },
    PointerMotion { id: u32, x: f64, y: f64, time_ms: u32 },
    PointerButton { id: u32, button: u32, pressed: bool, time_ms: u32 },
    PointerAxis { id: u32, dx: f64, dy: f64, v120_x: i32, v120_y: i32, time_ms: u32 },
    PointerLeave { id: u32 },
    /// evdev key code (linux/input-event-codes.h), not xkb (+8).
    Key { keycode: u32, pressed: bool, time_ms: u32 },
    Focus { id: u32, focused: bool },
    Close { id: u32 },
    FrameAck { id: u32, seq: u32 },
    Launch { command: String },
}

#[derive(Default)]
struct Enc(Vec<u8>);

impl Enc {
    fn new(tag: u8) -> Self {
        let mut v = Vec::with_capacity(64);
        v.extend_from_slice(&[0, 0, 0, 0, tag]);
        Self(v)
    }
    fn u8(&mut self, v: u8) -> &mut Self {
        self.0.push(v);
        self
    }
    fn u32(&mut self, v: u32) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    fn i32(&mut self, v: i32) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    fn f64(&mut self, v: f64) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    fn str(&mut self, s: &str) -> &mut Self {
        self.u32(s.len() as u32);
        self.0.extend_from_slice(s.as_bytes());
        self
    }
    fn bytes(&mut self, b: &[u8]) -> &mut Self {
        self.u32(b.len() as u32);
        self.0.extend_from_slice(b);
        self
    }
    fn finish(mut self) -> Vec<u8> {
        let len = (self.0.len() - 4) as u32;
        self.0[..4].copy_from_slice(&len.to_le_bytes());
        self.0
    }
}

struct Dec<'a> {
    b: &'a [u8],
    at: usize,
}

fn bad(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("wire: {what}"))
}

impl<'a> Dec<'a> {
    fn take(&mut self, n: usize) -> io::Result<&'a [u8]> {
        if self.at + n > self.b.len() {
            return Err(bad("truncated message"));
        }
        let s = &self.b[self.at..self.at + n];
        self.at += n;
        Ok(s)
    }
    fn u8(&mut self) -> io::Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn bool(&mut self) -> io::Result<bool> {
        Ok(self.u8()? != 0)
    }
    fn u32(&mut self) -> io::Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> io::Result<i32> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn f64(&mut self) -> io::Result<f64> {
        Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn str(&mut self) -> io::Result<String> {
        let n = self.u32()? as usize;
        String::from_utf8(self.take(n)?.to_vec()).map_err(|_| bad("string is not UTF-8"))
    }
    fn bytes(&mut self) -> io::Result<Vec<u8>> {
        let n = self.u32()? as usize;
        Ok(self.take(n)?.to_vec())
    }
}

impl HostMsg {
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Self::Hello { version, host } => {
                let mut e = Enc::new(1);
                e.u32(*version).str(host);
                e.finish()
            }
            Self::ToplevelNew { id, parent, x, y, width, height, ssd, title, app_id } => {
                let mut e = Enc::new(2);
                e.u32(*id).u32(*parent).i32(*x).i32(*y).u32(*width).u32(*height).u8(*ssd as u8).str(title).str(app_id);
                e.finish()
            }
            Self::ToplevelMeta { id, title, app_id } => {
                let mut e = Enc::new(3);
                e.u32(*id).str(title).str(app_id);
                e.finish()
            }
            Self::ToplevelRequest { id, states, minimize, interactive, edges } => {
                let mut e = Enc::new(4);
                e.u32(*id).u32(*states).u8(*minimize as u8).u8(*interactive as u8).u32(*edges);
                e.finish()
            }
            Self::ToplevelEffect { id, backdrop, translucent } => {
                let mut e = Enc::new(5);
                e.u32(*id).u8(*backdrop as u8).u8(*translucent as u8);
                e.finish()
            }
            Self::ToplevelClosed { id } => {
                let mut e = Enc::new(6);
                e.u32(*id);
                e.finish()
            }
            Self::Frame { id, seq, width, height, opaque, rects, codec, raw_len, data } => {
                let mut e = Enc::new(7);
                e.u32(*id).u32(*seq).u32(*width).u32(*height).u8(*opaque as u8).u32(rects.len() as u32);
                for r in rects {
                    e.u32(r.x).u32(r.y).u32(r.w).u32(r.h);
                }
                e.u8(*codec as u8).u32(*raw_len).bytes(data);
                e.finish()
            }
            Self::Cursor { name } => {
                let mut e = Enc::new(8);
                e.str(name);
                e.finish()
            }
            Self::Bye { reason } => {
                let mut e = Enc::new(9);
                e.str(reason);
                e.finish()
            }
        }
    }

    pub fn decode(b: &[u8]) -> io::Result<Self> {
        let mut d = Dec { b, at: 1 };
        let tag = *b.first().ok_or_else(|| bad("empty message"))?;
        Ok(match tag {
            1 => Self::Hello { version: d.u32()?, host: d.str()? },
            2 => Self::ToplevelNew {
                id: d.u32()?,
                parent: d.u32()?,
                x: d.i32()?,
                y: d.i32()?,
                width: d.u32()?,
                height: d.u32()?,
                ssd: d.bool()?,
                title: d.str()?,
                app_id: d.str()?,
            },
            3 => Self::ToplevelMeta { id: d.u32()?, title: d.str()?, app_id: d.str()? },
            4 => Self::ToplevelRequest {
                id: d.u32()?,
                states: d.u32()?,
                minimize: d.bool()?,
                interactive: match d.u8()? {
                    1 => Interactive::Move,
                    2 => Interactive::Resize,
                    _ => Interactive::None,
                },
                edges: d.u32()?,
            },
            5 => Self::ToplevelEffect { id: d.u32()?, backdrop: Backdrop::from_u8(d.u8()?), translucent: d.bool()? },
            6 => Self::ToplevelClosed { id: d.u32()? },
            7 => {
                let (id, seq, width, height, opaque) = (d.u32()?, d.u32()?, d.u32()?, d.u32()?, d.bool()?);
                let n = d.u32()? as usize;
                if n > 65536 {
                    return Err(bad("too many rectangles"));
                }
                let mut rects = Vec::with_capacity(n);
                for _ in 0..n {
                    rects.push(Rect { x: d.u32()?, y: d.u32()?, w: d.u32()?, h: d.u32()? });
                }
                let codec = match d.u8()? {
                    0 => Codec::Raw,
                    1 => Codec::Lz4,
                    _ => return Err(bad("unknown codec")),
                };
                Self::Frame { id, seq, width, height, opaque, rects, codec, raw_len: d.u32()?, data: d.bytes()? }
            }
            8 => Self::Cursor { name: d.str()? },
            9 => Self::Bye { reason: d.str()? },
            t => return Err(bad(&format!("unknown host tag {t}"))),
        })
    }
}

impl PresenterMsg {
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Self::Hello { version, xkb_layout, xkb_variant, scale_120, output_w, output_h } => {
                let mut e = Enc::new(101);
                e.u32(*version).str(xkb_layout).str(xkb_variant).u32(*scale_120).u32(*output_w).u32(*output_h);
                e.finish()
            }
            Self::Configure { id, width, height, states } => {
                let mut e = Enc::new(102);
                e.u32(*id).u32(*width).u32(*height).u32(*states);
                e.finish()
            }
            Self::PointerMotion { id, x, y, time_ms } => {
                let mut e = Enc::new(103);
                e.u32(*id).f64(*x).f64(*y).u32(*time_ms);
                e.finish()
            }
            Self::PointerButton { id, button, pressed, time_ms } => {
                let mut e = Enc::new(104);
                e.u32(*id).u32(*button).u8(*pressed as u8).u32(*time_ms);
                e.finish()
            }
            Self::PointerAxis { id, dx, dy, v120_x, v120_y, time_ms } => {
                let mut e = Enc::new(105);
                e.u32(*id).f64(*dx).f64(*dy).i32(*v120_x).i32(*v120_y).u32(*time_ms);
                e.finish()
            }
            Self::PointerLeave { id } => {
                let mut e = Enc::new(106);
                e.u32(*id);
                e.finish()
            }
            Self::Key { keycode, pressed, time_ms } => {
                let mut e = Enc::new(107);
                e.u32(*keycode).u8(*pressed as u8).u32(*time_ms);
                e.finish()
            }
            Self::Focus { id, focused } => {
                let mut e = Enc::new(108);
                e.u32(*id).u8(*focused as u8);
                e.finish()
            }
            Self::Close { id } => {
                let mut e = Enc::new(109);
                e.u32(*id);
                e.finish()
            }
            Self::FrameAck { id, seq } => {
                let mut e = Enc::new(110);
                e.u32(*id).u32(*seq);
                e.finish()
            }
            Self::Launch { command } => {
                let mut e = Enc::new(111);
                e.str(command);
                e.finish()
            }
        }
    }

    pub fn decode(b: &[u8]) -> io::Result<Self> {
        let mut d = Dec { b, at: 1 };
        let tag = *b.first().ok_or_else(|| bad("empty message"))?;
        Ok(match tag {
            101 => Self::Hello {
                version: d.u32()?,
                xkb_layout: d.str()?,
                xkb_variant: d.str()?,
                scale_120: d.u32()?,
                output_w: d.u32()?,
                output_h: d.u32()?,
            },
            102 => Self::Configure { id: d.u32()?, width: d.u32()?, height: d.u32()?, states: d.u32()? },
            103 => Self::PointerMotion { id: d.u32()?, x: d.f64()?, y: d.f64()?, time_ms: d.u32()? },
            104 => Self::PointerButton { id: d.u32()?, button: d.u32()?, pressed: d.bool()?, time_ms: d.u32()? },
            105 => Self::PointerAxis {
                id: d.u32()?,
                dx: d.f64()?,
                dy: d.f64()?,
                v120_x: d.i32()?,
                v120_y: d.i32()?,
                time_ms: d.u32()?,
            },
            106 => Self::PointerLeave { id: d.u32()? },
            107 => Self::Key { keycode: d.u32()?, pressed: d.bool()?, time_ms: d.u32()? },
            108 => Self::Focus { id: d.u32()?, focused: d.bool()? },
            109 => Self::Close { id: d.u32()? },
            110 => Self::FrameAck { id: d.u32()?, seq: d.u32()? },
            111 => Self::Launch { command: d.str()? },
            t => return Err(bad(&format!("unknown presenter tag {t}"))),
        })
    }
}

/// Reads one framed message body (tag + payload). `Ok(None)` on a clean end of stream.
pub fn read_message(r: &mut impl Read, buf: &mut Vec<u8>) -> io::Result<Option<()>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len) as usize;
    if len == 0 || len > MAX_MESSAGE {
        return Err(bad("message length out of range"));
    }
    buf.resize(len, 0);
    r.read_exact(buf)?;
    Ok(Some(()))
}

pub fn write_message(w: &mut impl Write, encoded: &[u8]) -> io::Result<()> {
    w.write_all(encoded)
}

/// Packs the rectangles of a BGRA picture (`stride` bytes per row) and codes them. Returns (codec, raw_len, data).
pub fn pack_rects(pixels: &[u8], stride: usize, rects: &[Rect], compress: bool) -> (Codec, u32, Vec<u8>) {
    let raw_len: usize = rects.iter().map(|r| r.area() * 4).sum();
    let mut raw = Vec::with_capacity(raw_len);
    for r in rects {
        for row in r.y..r.y + r.h {
            let start = row as usize * stride + r.x as usize * 4;
            raw.extend_from_slice(&pixels[start..start + r.w as usize * 4]);
        }
    }
    if compress && raw_len >= 4096 {
        (Codec::Lz4, raw_len as u32, lz4_flex::block::compress(&raw))
    } else {
        (Codec::Raw, raw_len as u32, raw)
    }
}

/// Applies a frame's rectangles onto a BGRA picture of `width` x `height` (stride = width * 4).
pub fn apply_rects(
    target: &mut [u8],
    width: u32,
    rects: &[Rect],
    codec: Codec,
    raw_len: u32,
    data: &[u8],
) -> io::Result<()> {
    let decoded;
    let raw: &[u8] = match codec {
        Codec::Raw => data,
        Codec::Lz4 => {
            decoded = lz4_flex::block::decompress(data, raw_len as usize).map_err(|_| bad("lz4 frame"))?;
            &decoded
        }
    };
    let stride = width as usize * 4;
    let mut at = 0;
    for r in rects {
        let row_bytes = r.w as usize * 4;
        for row in r.y..r.y + r.h {
            let dst = row as usize * stride + r.x as usize * 4;
            if at + row_bytes > raw.len() || dst + row_bytes > target.len() {
                return Err(bad("rectangle outside the picture"));
            }
            target[dst..dst + row_bytes].copy_from_slice(&raw[at..at + row_bytes]);
            at += row_bytes;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip_host(m: HostMsg) {
        let enc = m.encode();
        let mut cur = io::Cursor::new(enc);
        let mut buf = Vec::new();
        read_message(&mut cur, &mut buf).unwrap().unwrap();
        assert_eq!(HostMsg::decode(&buf).unwrap(), m);
    }

    fn roundtrip_presenter(m: PresenterMsg) {
        let enc = m.encode();
        let mut cur = io::Cursor::new(enc);
        let mut buf = Vec::new();
        read_message(&mut cur, &mut buf).unwrap().unwrap();
        assert_eq!(PresenterMsg::decode(&buf).unwrap(), m);
    }

    #[test]
    fn host_messages_roundtrip() {
        roundtrip_host(HostMsg::Hello { version: VERSION, host: "vps".into() });
        roundtrip_host(HostMsg::ToplevelNew {
            id: 3,
            parent: 0,
            x: 0,
            y: 0,
            width: 800,
            height: 600,
            ssd: true,
            title: "foot — été".into(),
            app_id: "foot".into(),
        });
        roundtrip_host(HostMsg::ToplevelEffect { id: 3, backdrop: Backdrop::Acrylic, translucent: true });
        roundtrip_host(HostMsg::Frame {
            id: 3,
            seq: 9,
            width: 2,
            height: 2,
            opaque: false,
            rects: vec![Rect { x: 0, y: 0, w: 2, h: 2 }],
            codec: Codec::Raw,
            raw_len: 16,
            data: vec![7; 16],
        });
        roundtrip_host(HostMsg::ToplevelRequest {
            id: 3,
            states: STATE_MAXIMIZED,
            minimize: false,
            interactive: Interactive::Resize,
            edges: 10,
        });
        roundtrip_host(HostMsg::Bye { reason: "done".into() });
    }

    #[test]
    fn presenter_messages_roundtrip() {
        roundtrip_presenter(PresenterMsg::Hello {
            version: VERSION,
            xkb_layout: "fr".into(),
            xkb_variant: String::new(),
            scale_120: 180,
            output_w: 2560,
            output_h: 1440,
        });
        roundtrip_presenter(PresenterMsg::PointerAxis { id: 1, dx: 0.0, dy: -15.0, v120_x: 0, v120_y: -120, time_ms: 5 });
        roundtrip_presenter(PresenterMsg::Key { keycode: 30, pressed: true, time_ms: 6 });
        roundtrip_presenter(PresenterMsg::Launch { command: "foot".into() });
    }

    #[test]
    fn rects_pack_and_apply_through_lz4() {
        let (w, h) = (64u32, 48u32);
        let src: Vec<u8> = (0..w * h * 4).map(|i| (i % 251) as u8).collect();
        let rects = [Rect { x: 3, y: 5, w: 40, h: 30 }, Rect { x: 50, y: 0, w: 14, h: 48 }];
        let (codec, raw_len, data) = pack_rects(&src, w as usize * 4, &rects, true);
        assert_eq!(codec, Codec::Lz4);
        let mut dst = vec![0u8; src.len()];
        apply_rects(&mut dst, w, &rects, codec, raw_len, &data).unwrap();
        for r in &rects {
            for y in r.y..r.y + r.h {
                let a = (y * w + r.x) as usize * 4;
                let b = a + r.w as usize * 4;
                assert_eq!(dst[a..b], src[a..b]);
            }
        }
        assert_eq!(dst[0], 0, "outside the rectangles stays untouched");
    }

    #[test]
    fn rejects_rect_outside_picture() {
        let mut dst = vec![0u8; 16];
        let err = apply_rects(&mut dst, 2, &[Rect { x: 1, y: 1, w: 2, h: 2 }], Codec::Raw, 16, &[0; 16]);
        assert!(err.is_err());
    }
}
