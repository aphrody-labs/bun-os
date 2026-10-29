//! Minimal software compositor speaking a subset of the Wayland wire protocol.
//!
//! Host contract (plain C ABI, no wasm-bindgen):
//! - `init(w, h)` allocates the RGBA framebuffer (`fb_ptr`, `w*h*4` bytes, R,G,B,A byte order).
//! - the client writes wire messages at `in_ptr()` and calls `feed(len)`; events for the client
//!   appear at `out_ptr()` / `out_len()` until `out_clear()`.
//! - there is no fd passing: `wl_shm.create_pool(new_id, size)` carries no fd, the client writes
//!   pixels into `pool_ptr(pool_id)` before `wl_surface.commit`.
//! - `render()` composes the frame (the host calls it once per frame).
use std::cell::RefCell;
use std::collections::HashMap;

const IN_CAP: usize = 1 << 16;
const TITLE_H: i32 = 24;
const BG: u32 = 0xFF1C_1B1F; // M3 baseline surface (dark), ARGB
const TITLE: u32 = 0xFF67_50A4; // M3 baseline primary
const BORDER: u32 = 0xFFD0_BCFF; // M3 baseline primary container (dark)

#[derive(Clone, Copy)]
struct Buf {
    pool: u32,
    off: usize,
    w: i32,
    h: i32,
    stride: i32,
    argb: bool,
}

enum Obj {
    Display,
    Registry,
    Compositor,
    Shm,
    XdgWm,
    Pool(Vec<u8>),
    Buffer(Buf),
    Surface(Surface),
    XdgSurface(u32),
    Toplevel(u32),
    Other,
}

#[derive(Default)]
struct Surface {
    pending: Option<u32>,
    frame_cbs: Vec<u32>,
    px: Vec<u32>, // committed content, 0xAARRGGBB
    w: i32,
    h: i32,
    toplevel: bool,
    configured: bool,
    title: String,
    order: u32,
}

struct State {
    w: i32,
    h: i32,
    fb: Vec<u32>,
    input: Vec<u8>,
    out: Vec<u8>,
    objs: HashMap<u32, Obj>,
    serial: u32,
    clock: u32,
    next_order: u32,
}

thread_local! { static ST: RefCell<Option<State>> = const { RefCell::new(None) }; }

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    ST.with(|s| f(s.borrow_mut().as_mut().expect("init() not called")))
}

#[unsafe(no_mangle)]
pub extern "C" fn init(w: i32, h: i32) {
    let (w, h) = (w.clamp(16, 4096), h.clamp(16, 4096));
    let mut objs = HashMap::new();
    objs.insert(1, Obj::Display);
    ST.with(|s| {
        *s.borrow_mut() = Some(State {
            w,
            h,
            fb: vec![0; (w * h) as usize],
            input: vec![0; IN_CAP],
            out: Vec::with_capacity(IN_CAP),
            objs,
            serial: 1,
            clock: 0,
            next_order: 0,
        })
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn fb_ptr() -> *const u8 {
    with(|s| s.fb.as_ptr() as *const u8)
}
#[unsafe(no_mangle)]
pub extern "C" fn in_ptr() -> *mut u8 {
    with(|s| s.input.as_mut_ptr())
}
#[unsafe(no_mangle)]
pub extern "C" fn in_cap() -> u32 {
    IN_CAP as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    with(|s| s.out.as_ptr())
}
#[unsafe(no_mangle)]
pub extern "C" fn out_len() -> u32 {
    with(|s| s.out.len() as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn out_clear() {
    with(|s| s.out.clear())
}
/// Pointer to the pixel memory of a `wl_shm_pool` (null if unknown). Stable until the pool is resized.
#[unsafe(no_mangle)]
pub extern "C" fn pool_ptr(id: u32) -> *mut u8 {
    with(|s| match s.objs.get_mut(&id) {
        Some(Obj::Pool(v)) => v.as_mut_ptr(),
        _ => std::ptr::null_mut(),
    })
}
/// Number of mapped toplevel windows.
#[unsafe(no_mangle)]
pub extern "C" fn window_count() -> u32 {
    with(|s| {
        s.objs
            .values()
            .filter(|o| matches!(o, Obj::Surface(x) if x.toplevel && x.configured && x.w > 0))
            .count() as u32
    })
}

struct Rd<'a> {
    b: &'a [u8],
    p: usize,
}
impl Rd<'_> {
    fn u32(&mut self) -> u32 {
        let v = self
            .b
            .get(self.p..self.p + 4)
            .map_or(0, |x| u32::from_le_bytes(x.try_into().unwrap()));
        self.p += 4;
        v
    }
    fn i32(&mut self) -> i32 {
        self.u32() as i32
    }
    fn string(&mut self) -> String {
        let n = self.u32() as usize;
        let s = self.b.get(self.p..self.p + n.saturating_sub(1)).unwrap_or(&[]);
        let s = String::from_utf8_lossy(s).into_owned();
        self.p += n.div_ceil(4) * 4;
        s
    }
}

fn ev(out: &mut Vec<u8>, id: u32, op: u16, args: &[u8]) {
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(&((((8 + args.len()) as u32) << 16) | op as u32).to_le_bytes());
    out.extend_from_slice(args);
}
fn wstr(a: &mut Vec<u8>, s: &str) {
    a.extend_from_slice(&(s.len() as u32 + 1).to_le_bytes());
    a.extend_from_slice(s.as_bytes());
    a.push(0);
    while a.len() % 4 != 0 {
        a.push(0);
    }
}

const GLOBALS: [(&str, u32); 3] = [("wl_compositor", 4), ("wl_shm", 1), ("xdg_wm_base", 1)];

/// Consume `len` bytes of wire messages from the input buffer. Returns the number of messages handled.
#[unsafe(no_mangle)]
pub extern "C" fn feed(len: u32) -> u32 {
    with(|s| {
        let data = s.input[..(len as usize).min(IN_CAP)].to_vec();
        let (mut p, mut n) = (0usize, 0u32);
        while p + 8 <= data.len() {
            let id = u32::from_le_bytes(data[p..p + 4].try_into().unwrap());
            let w = u32::from_le_bytes(data[p + 4..p + 8].try_into().unwrap());
            let (size, op) = ((w >> 16) as usize, (w & 0xffff) as u16);
            if size < 8 || p + size > data.len() {
                break;
            }
            let mut r = Rd { b: &data[p + 8..p + size], p: 0 };
            dispatch(s, id, op, &mut r);
            p += size;
            n += 1;
        }
        n
    })
}

fn delete_id(s: &mut State, id: u32) {
    s.objs.remove(&id);
    ev(&mut s.out, 1, 1, &id.to_le_bytes());
}

fn dispatch(s: &mut State, id: u32, op: u16, r: &mut Rd) {
    let kind = match s.objs.get(&id) {
        Some(Obj::Display) => 0,
        Some(Obj::Registry) => 1,
        Some(Obj::Compositor) => 2,
        Some(Obj::Shm) => 3,
        Some(Obj::XdgWm) => 4,
        Some(Obj::Pool(_)) => 5,
        Some(Obj::Buffer(_)) => 6,
        Some(Obj::Surface(_)) => 7,
        Some(Obj::XdgSurface(_)) => 8,
        Some(Obj::Toplevel(_)) => 9,
        Some(Obj::Other) => 10,
        None => return,
    };
    match (kind, op) {
        (0, 0) => {
            // sync(callback)
            let cb = r.u32();
            s.clock += 16;
            ev(&mut s.out, cb, 0, &s.clock.to_le_bytes());
            ev(&mut s.out, 1, 1, &cb.to_le_bytes());
        }
        (0, 1) => {
            let reg = r.u32();
            s.objs.insert(reg, Obj::Registry);
            for (i, (name, ver)) in GLOBALS.iter().enumerate() {
                let mut a = (i as u32 + 1).to_le_bytes().to_vec();
                wstr(&mut a, name);
                a.extend_from_slice(&ver.to_le_bytes());
                ev(&mut s.out, reg, 0, &a);
            }
        }
        (1, 0) => {
            let name = r.u32();
            let _iface = r.string();
            let _ver = r.u32();
            let new = r.u32();
            match name {
                1 => {
                    s.objs.insert(new, Obj::Compositor);
                }
                2 => {
                    s.objs.insert(new, Obj::Shm);
                    for fmt in [0u32, 1] {
                        ev(&mut s.out, new, 0, &fmt.to_le_bytes());
                    }
                }
                3 => {
                    s.objs.insert(new, Obj::XdgWm);
                }
                _ => {}
            }
        }
        (2, 0) => {
            let new = r.u32();
            s.objs.insert(new, Obj::Surface(Surface::default()));
        }
        (2, 1) => {
            let new = r.u32();
            s.objs.insert(new, Obj::Other);
        }
        (3, 0) => {
            let new = r.u32();
            let size = r.i32().clamp(0, 64 << 20) as usize;
            s.objs.insert(new, Obj::Pool(vec![0; size]));
        }
        (5, 0) => {
            let new = r.u32();
            let (off, w, h, stride, fmt) = (r.i32(), r.i32(), r.i32(), r.i32(), r.u32());
            if off >= 0 && w > 0 && h > 0 && stride >= w * 4 && fmt <= 1 {
                s.objs.insert(
                    new,
                    Obj::Buffer(Buf { pool: id, off: off as usize, w, h, stride, argb: fmt == 0 }),
                );
            }
        }
        (5, 2) => {
            let size = r.i32().clamp(0, 64 << 20) as usize;
            if let Some(Obj::Pool(v)) = s.objs.get_mut(&id) {
                v.resize(size, 0);
            }
        }
        (5, 1) | (6, 0) | (7, 0) | (8, 0) | (9, 0) => delete_id(s, id),
        (4, 2) => {
            let (new, surf) = (r.u32(), r.u32());
            s.objs.insert(new, Obj::XdgSurface(surf));
        }
        (4, _) | (10, _) => {}
        (8, 1) => {
            let new = r.u32();
            let surf = match s.objs.get(&id) {
                Some(Obj::XdgSurface(x)) => *x,
                _ => return,
            };
            s.objs.insert(new, Obj::Toplevel(surf));
            s.next_order += 1;
            let order = s.next_order;
            if let Some(Obj::Surface(sf)) = s.objs.get_mut(&surf) {
                sf.toplevel = true;
                sf.order = order;
            }
            // xdg_toplevel.configure(0, 0, []) then xdg_surface.configure(serial)
            let mut a = 0u32.to_le_bytes().to_vec();
            a.extend_from_slice(&0u32.to_le_bytes());
            a.extend_from_slice(&0u32.to_le_bytes());
            ev(&mut s.out, new, 0, &a);
            s.serial += 1;
            ev(&mut s.out, id, 0, &s.serial.to_le_bytes());
        }
        (8, 4) => {
            let surf = match s.objs.get(&id) {
                Some(Obj::XdgSurface(x)) => *x,
                _ => return,
            };
            if let Some(Obj::Surface(sf)) = s.objs.get_mut(&surf) {
                sf.configured = true;
            }
        }
        (9, 2) => {
            let t = r.string();
            let surf = match s.objs.get(&id) {
                Some(Obj::Toplevel(x)) => *x,
                _ => return,
            };
            if let Some(Obj::Surface(sf)) = s.objs.get_mut(&surf) {
                sf.title = t;
            }
        }
        (7, 1) => {
            let b = r.u32();
            if let Some(Obj::Surface(sf)) = s.objs.get_mut(&id) {
                sf.pending = (b != 0).then_some(b);
            }
        }
        (7, 3) => {
            let cb = r.u32();
            s.objs.insert(cb, Obj::Other);
            if let Some(Obj::Surface(sf)) = s.objs.get_mut(&id) {
                sf.frame_cbs.push(cb);
            }
        }
        (7, 6) => commit(s, id),
        _ => {}
    }
}

fn commit(s: &mut State, id: u32) {
    let (pending, cbs) = match s.objs.get_mut(&id) {
        Some(Obj::Surface(sf)) => (sf.pending.take(), std::mem::take(&mut sf.frame_cbs)),
        _ => return,
    };
    if let Some(bid) = pending {
        let mut copy = None;
        if let Some(Obj::Buffer(b)) = s.objs.get(&bid)
            && let Some(Obj::Pool(pool)) = s.objs.get(&b.pool)
        {
            let mut px = Vec::with_capacity((b.w * b.h) as usize);
            for y in 0..b.h as usize {
                for x in 0..b.w as usize {
                    let o = b.off + y * b.stride as usize + x * 4;
                    let v = pool
                        .get(o..o + 4)
                        .map_or(0, |c| u32::from_le_bytes(c.try_into().unwrap()));
                    px.push(if b.argb { v } else { v | 0xFF00_0000 });
                }
            }
            copy = Some((px, b.w, b.h));
        }
        if let Some((px, w, h)) = copy {
            if let Some(Obj::Surface(sf)) = s.objs.get_mut(&id) {
                sf.px = px;
                sf.w = w;
                sf.h = h;
            }
            ev(&mut s.out, bid, 0, &[]); // wl_buffer.release
        }
    }
    for cb in cbs {
        s.clock += 16;
        ev(&mut s.out, cb, 0, &s.clock.to_le_bytes());
        ev(&mut s.out, 1, 1, &cb.to_le_bytes());
        s.objs.remove(&cb);
    }
}

/// Top-left of window `order` (1-based): cascade. Content starts `TITLE_H` below.
fn origin(order: u32) -> (i32, i32) {
    (24 + (order as i32 - 1) * 56, 24 + (order as i32 - 1) * 48)
}

#[unsafe(no_mangle)]
pub extern "C" fn window_x(order: u32) -> i32 {
    origin(order).0
}
#[unsafe(no_mangle)]
pub extern "C" fn window_y(order: u32) -> i32 {
    origin(order).1
}
#[unsafe(no_mangle)]
pub extern "C" fn title_height() -> i32 {
    TITLE_H
}

/// 0xAARRGGBB to the little-endian u32 whose bytes are R,G,B,A.
fn rgba(argb: u32) -> u32 {
    (argb & 0xFF00_FF00) | ((argb >> 16) & 0xFF) | ((argb & 0xFF) << 16)
}

fn fill(s: &mut State, x: i32, y: i32, w: i32, h: i32, argb: u32) {
    let c = rgba(argb);
    for yy in y.max(0)..(y + h).min(s.h) {
        for xx in x.max(0)..(x + w).min(s.w) {
            s.fb[(yy * s.w + xx) as usize] = c;
        }
    }
}

/// Compose background, then windows by creation order (later on top), each with border + title bar.
#[unsafe(no_mangle)]
pub extern "C" fn render() {
    with(|s| {
        let (w, h) = (s.w, s.h);
        fill(s, 0, 0, w, h, BG);
        let mut wins: Vec<(u32, i32, i32, Vec<u32>)> = s
            .objs
            .values()
            .filter_map(|o| match o {
                Obj::Surface(sf) if sf.toplevel && sf.configured && sf.w > 0 => {
                    Some((sf.order, sf.w, sf.h, sf.px.clone()))
                }
                _ => None,
            })
            .collect();
        wins.sort_by_key(|x| x.0);
        for (order, ww, wh, px) in wins {
            let (x, y) = origin(order);
            fill(s, x - 1, y - 1, ww + 2, wh + TITLE_H + 2, BORDER);
            fill(s, x, y, ww, TITLE_H, TITLE);
            for row in 0..wh {
                for col in 0..ww {
                    let (fx, fy) = (x + col, y + TITLE_H + row);
                    if fx >= 0 && fy >= 0 && fx < w && fy < h {
                        s.fb[(fy * w + fx) as usize] = rgba(px[(row * ww + col) as usize]);
                    }
                }
            }
        }
    })
}
