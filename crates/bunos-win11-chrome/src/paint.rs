// SPDX-License-Identifier: Apache-2.0
//! Layout and rasterisation of the traffic-light caption buttons, platform-independent so it is unit-tested
//! everywhere. The art is our own, the same geometry as `packages/m3-os-themes/src/chrome.ts` `trafficLightSvg`: a
//! 12 px circle in a 24 px hit box, a 1.4 px round-capped cross / bar, and two filled zoom triangles. No Apple asset.
//!
//! Pixels are premultiplied BGRA (`u32` = 0xAARRGGBB in memory order B, G, R, A), the format `UpdateLayeredWindow`
//! takes from a 32-bit top-down DIB.

use crate::{Buttons, Rgb, Traffic};

/// The three buttons in macOS order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Button {
    Close,
    Minimize,
    Zoom,
}

impl Button {
    pub const ALL: [Self; 3] = [Self::Close, Self::Minimize, Self::Zoom];

    /// The UIA name (docs/DESIGN-M3-WINDOWS.md, `x-bunos.names`).
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Close => "Close",
            Self::Minimize => "Minimise",
            Self::Zoom => "Zoom",
        }
    }

    #[must_use]
    pub fn automation_id(self) -> &'static str {
        match self {
            Self::Close => "close",
            Self::Minimize => "minimize",
            Self::Zoom => "zoom",
        }
    }

    #[must_use]
    pub fn index(self) -> usize {
        self as usize
    }
}

/// Everything that changes the picture.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct State {
    pub width: u32,
    pub height: u32,
    /// Device pixels per DIP (`dpi / 96`).
    pub scale: f32,
    /// The owner is the foreground window.
    pub active: bool,
    /// The pointer is over the button group: glyphs on all three (macOS).
    pub hover: bool,
    pub pressed: Option<Button>,
    /// UIA focus (an assistive technology moved focus onto a button): glyphs and the focus ring.
    pub focus: Option<Button>,
    /// Which buttons the owner has (`WS_MINIMIZEBOX`, `WS_MAXIMIZEBOX`); close is always there.
    pub enabled: [bool; 3],
    /// Only close is drawn (a dialog without minimise and maximise boxes).
    pub close_only: bool,
    /// Title-bar colour behind the buttons (sampled from the owner), so the native buttons are covered.
    pub background: Rgb,
    /// Radius of the window corner the top-right of the overlay sits in (0 = square: maximised or not at the edge).
    pub corner: f32,
}

/// Circle centres (x, y) in overlay pixels, `None` for a button that is not drawn.
#[must_use]
pub fn centres(st: &State, traffic: &Traffic) -> [Option<(f32, f32)>; 3] {
    let s = st.scale;
    let (w, h) = (st.width as f32, st.height as f32);
    let cy = h / 2.0;
    if st.close_only {
        return [Some((w / 2.0, cy)), None, None];
    }
    let d = traffic.diameter as f32 * s;
    // macOS spacing, tightened when the native rect is narrower than the group (never below 2 DIP).
    let gap = (traffic.gap as f32 * s).min(((w - 3.0 * d - 4.0 * s) / 2.0).max(2.0 * s));
    let step = d + gap;
    let x0 = w / 2.0 - step;
    [Some((x0, cy)), Some((x0 + step, cy)), Some((x0 + 2.0 * step, cy))]
}

/// The button under overlay pixel `x`: the rect is split between the drawn buttons at the midpoints, so every hit area
/// spans the full height and at least the circle spacing (>= 24 px at every scale for the native rect).
#[must_use]
pub fn hit(st: &State, traffic: &Traffic, x: f32, y: f32) -> Option<Button> {
    if x < 0.0 || y < 0.0 || x >= st.width as f32 || y >= st.height as f32 {
        return None;
    }
    let c = centres(st, traffic);
    let mut best: Option<(Button, f32)> = None;
    for b in Button::ALL {
        if let Some((cx, _)) = c[b.index()] {
            let dist = (x - cx).abs();
            if best.is_none_or(|(_, d)| dist < d) {
                best = Some((b, dist));
            }
        }
    }
    best.map(|(b, _)| b).filter(|b| st.enabled[b.index()])
}

/// Horizontal extent `[left, right)` of `button`'s hit area in overlay pixels.
#[must_use]
pub fn hit_span(st: &State, traffic: &Traffic, button: Button) -> Option<(f32, f32)> {
    let c = centres(st, traffic);
    let (cx, _) = c[button.index()]?;
    let drawn: Vec<f32> = c.iter().flatten().map(|p| p.0).collect();
    let left = drawn.iter().filter(|&&x| x < cx).fold(0.0_f32, |a, &x| a.max((x + cx) / 2.0));
    let right = drawn.iter().filter(|&&x| x > cx).fold(st.width as f32, |a, &x| a.min((x + cx) / 2.0));
    Some((left, right))
}

#[derive(Clone, Copy)]
struct Rgba {
    r: f32,
    g: f32,
    b: f32,
    a: f32,
}

impl Rgba {
    fn of(c: Rgb, a: f32) -> Self {
        Self {
            r: ((c.0 >> 16) & 0xff) as f32 / 255.0,
            g: ((c.0 >> 8) & 0xff) as f32 / 255.0,
            b: (c.0 & 0xff) as f32 / 255.0,
            a,
        }
    }

    /// Source-over of a straight-alpha `top` onto `self`.
    fn over(self, top: Self) -> Self {
        let a = top.a + self.a * (1.0 - top.a);
        if a <= 0.0 {
            return Self { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };
        }
        let mix = |t: f32, b: f32| (t * top.a + b * self.a * (1.0 - top.a)) / a;
        Self { r: mix(top.r, self.r), g: mix(top.g, self.g), b: mix(top.b, self.b), a }
    }
}

fn segment_distance(p: (f32, f32), a: (f32, f32), b: (f32, f32)) -> f32 {
    let (px, py) = (p.0 - a.0, p.1 - a.1);
    let (bx, by) = (b.0 - a.0, b.1 - a.1);
    let t = ((px * bx + py * by) / (bx * bx + by * by)).clamp(0.0, 1.0);
    (px - bx * t).hypot(py - by * t)
}

fn in_triangle(p: (f32, f32), a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> bool {
    let side = |u: (f32, f32), v: (f32, f32)| (v.0 - u.0) * (p.1 - u.1) - (v.1 - u.1) * (p.0 - u.0);
    let (d1, d2, d3) = (side(a, b), side(b, c), side(c, a));
    !((d1 < 0.0 || d2 < 0.0 || d3 < 0.0) && (d1 > 0.0 || d2 > 0.0 || d3 > 0.0))
}

/// Whether point `q` (in DIP, relative to the circle centre) is inside `button`'s glyph.
fn in_glyph(button: Button, q: (f32, f32)) -> bool {
    const G: f32 = 3.0;
    const HALF_STROKE: f32 = 0.7;
    match button {
        Button::Close => {
            segment_distance(q, (-G, -G), (G, G)) <= HALF_STROKE || segment_distance(q, (G, -G), (-G, G)) <= HALF_STROKE
        }
        Button::Minimize => segment_distance(q, (-G - 0.5, 0.0), (G + 0.5, 0.0)) <= HALF_STROKE,
        Button::Zoom => {
            in_triangle(q, (-G, -G), (1.0, -G), (-G, 1.0)) || in_triangle(q, (G, G), (-1.0, G), (G, -1.0))
        }
    }
}

/// Supersampling grid per pixel axis (4 x 4 = 16 coverage levels, crisp at 100-200 %).
const SS: u32 = 4;

/// Render `st` to premultiplied BGRA pixels, row-major, top-down.
#[must_use]
pub fn render(st: &State, traffic: &Traffic, buttons: &Buttons) -> Vec<u32> {
    let (w, h) = (st.width, st.height);
    let s = st.scale;
    let centres = centres(st, traffic);
    let radius = traffic.diameter as f32 * s / 2.0;
    let fills = [traffic.close, traffic.minimize, traffic.zoom];
    let glyphs = [buttons.glyph.close, buttons.glyph.minimize, buttons.glyph.zoom];
    let pressed = [buttons.pressed.close, buttons.pressed.minimize, buttons.pressed.zoom];
    let bg = Rgba::of(st.background, 1.0);
    let corner = st.corner;
    let mut out = vec![0u32; (w * h) as usize];
    for py in 0..h {
        for px in 0..w {
            let (mut r, mut g, mut b, mut a) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
            for sy in 0..SS {
                for sx in 0..SS {
                    let x = px as f32 + (sx as f32 + 0.5) / SS as f32;
                    let y = py as f32 + (sy as f32 + 0.5) / SS as f32;
                    // The window's rounded top-right corner: outside it the overlay is transparent.
                    let outside_corner = corner > 0.0 && x > w as f32 - corner && y < corner && {
                        let (dx, dy) = (x - (w as f32 - corner), corner - y);
                        dx.hypot(dy) > corner
                    };
                    if outside_corner {
                        continue;
                    }
                    let mut c = bg;
                    for button in Button::ALL {
                        let i = button.index();
                        let Some((cx, cy)) = centres[i] else { continue };
                        let (dx, dy) = (x - cx, y - cy);
                        let dist = dx.hypot(dy);
                        let enabled = st.enabled[i];
                        let focused = enabled && st.focus == Some(button);
                        if focused {
                            let ring = radius + 2.0 * s + s; // offset 2, width 2, centred
                            if (dist - ring).abs() <= s {
                                c = c.over(Rgba::of(buttons.focus_ring, 1.0));
                            }
                        }
                        if dist > radius {
                            continue;
                        }
                        let coloured = enabled && (st.active || st.hover || focused);
                        let fill = if !coloured {
                            buttons.inactive_fill
                        } else if st.pressed == Some(button) {
                            pressed[i]
                        } else {
                            fills[i]
                        };
                        c = c.over(Rgba::of(fill, 1.0));
                        if !coloured {
                            if dist >= radius - s {
                                c = c.over(Rgba::of(buttons.inactive_border, 1.0));
                            }
                        } else if dist >= radius - 0.5 * s {
                            c = c.over(Rgba::of(Rgb(0), 0.12));
                        }
                        let glyph = coloured && (st.hover || focused || st.pressed == Some(button));
                        if glyph && in_glyph(button, (dx / s, dy / s)) {
                            c = c.over(Rgba::of(glyphs[i], 1.0));
                        }
                    }
                    r += c.r * c.a;
                    g += c.g * c.a;
                    b += c.b * c.a;
                    a += c.a;
                }
            }
            let n = (SS * SS) as f32;
            let q = |v: f32| ((v / n) * 255.0).round().clamp(0.0, 255.0) as u32;
            out[(py * w + px) as usize] = (q(a) << 24) | (q(r) << 16) | (q(g) << 8) | q(b);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(width: u32, height: u32, scale: f32) -> State {
        State {
            width,
            height,
            scale,
            active: true,
            hover: false,
            pressed: None,
            focus: None,
            enabled: [true; 3],
            close_only: false,
            background: Rgb(0x1e1e24),
            corner: 0.0,
        }
    }

    fn px(img: &[u32], st: &State, x: f32, y: f32) -> u32 {
        img[(y as u32 * st.width + x as u32) as usize]
    }

    #[test]
    fn macos_order_left_to_right_and_hit_areas_at_least_24px() {
        let t = Traffic::default();
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let st = state((138.0 * scale) as u32, (30.0 * scale) as u32, scale);
            let c = centres(&st, &t);
            let xs: Vec<f32> = c.iter().map(|p| p.unwrap().0).collect();
            assert!(xs[0] < xs[1] && xs[1] < xs[2]);
            for b in Button::ALL {
                let (l, r) = hit_span(&st, &t, b).unwrap();
                assert!(r - l >= 24.0 * scale - 0.01, "{b:?} at {scale}: {}", r - l);
                let mid = (l + r) / 2.0;
                assert_eq!(hit(&st, &t, mid, st.height as f32 / 2.0), Some(b));
            }
        }
    }

    #[test]
    fn colours_glyphs_and_inactive_grey() {
        let (t, b) = (Traffic::default(), Buttons::default());
        let mut st = state(172, 40, 1.25);
        let [close, ..] = centres(&st, &t);
        let (cx, cy) = close.unwrap();
        let fill = 0xff00_0000 | t.close.0;
        // Normal: centre is the close fill, no glyph.
        assert_eq!(px(&render(&st, &t, &b), &st, cx, cy), fill);
        // Hover: the glyph crosses the centre.
        st.hover = true;
        assert_eq!(px(&render(&st, &t, &b), &st, cx, cy), 0xff00_0000 | b.glyph.close.0);
        // Inactive, not hovered: grey, no glyph.
        st.hover = false;
        st.active = false;
        assert_eq!(px(&render(&st, &t, &b), &st, cx, cy), 0xff00_0000 | b.inactive_fill.0);
        // Background covers the native buttons (opaque).
        assert_eq!(px(&render(&st, &t, &b), &st, 1.0, 1.0), 0xff1e_1e24);
    }

    #[test]
    fn rounded_corner_is_transparent() {
        let (t, b) = (Traffic::default(), Buttons::default());
        let mut st = state(172, 40, 1.25);
        st.corner = 10.0;
        let img = render(&st, &t, &b);
        assert_eq!(px(&img, &st, 171.0, 0.0) >> 24, 0);
        assert_eq!(px(&img, &st, 150.0, 20.0) >> 24, 0xff);
    }

    #[test]
    fn close_only_dialog() {
        let t = Traffic::default();
        let mut st = state(57, 40, 1.25);
        st.close_only = true;
        st.enabled = [true, false, false];
        assert_eq!(hit(&st, &t, 5.0, 5.0), Some(Button::Close));
        assert_eq!(hit(&st, &t, 50.0, 5.0), Some(Button::Close));
    }
}
