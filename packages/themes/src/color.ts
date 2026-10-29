// Color math shared by the generator and the contrast tests: sRGB hex with optional alpha, compositing,
// WCAG 2.x relative luminance and contrast ratio, APCA-W3 0.0.98G-4g Lc.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

export function parseHex(hex: string): Rgba {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex.trim());
  if (!m) throw new Error(`bad color ${hex}`);
  const n = parseInt(m[1]!, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
    a: m[2] ? parseInt(m[2], 16) / 255 : 1,
  };
}

const h2 = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();

export function toHex(c: Rgba): string {
  return `#${h2(c.r)}${h2(c.g)}${h2(c.b)}${c.a >= 0.9995 ? "" : h2(c.a * 255)}`;
}

/** Source-over: `top` painted on `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const f = (t: number, b: number) =>
    (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return {
    r: f(top.r, bottom.r),
    g: f(top.g, bottom.g),
    b: f(top.b, bottom.b),
    a,
  };
}

/** Linear mix in sRGB: `t` of `b` over `a`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a),
    y = parseHex(b);
  return toHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
    a: x.a + (y.a - x.a) * t,
  });
}

export function withAlpha(hex: string, a: number): string {
  const c = parseHex(hex);
  return toHex({ ...c, a });
}

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(c: Rgba): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 2.x contrast ratio of `fg` (alpha composited over `bg`) against `bg`. `bg` must be opaque. */
export function wcag(fg: string, bg: string): number {
  const b = parseHex(bg);
  const f = over(parseHex(fg), b);
  const [l1, l2] = [luminance(f), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** APCA-W3 0.0.98G-4g lightness contrast Lc (signed: positive for dark text on light). */
export function apca(text: string, bg: string): number {
  const b = parseHex(bg);
  const t = over(parseHex(text), b);
  const y = (c: Rgba) => {
    const f = (v: number) => (v / 255) ** 2.4;
    return 0.2126729 * f(c.r) + 0.7151522 * f(c.g) + 0.072175 * f(c.b);
  };
  const soft = (v: number) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const yt = soft(y(t)),
    yb = soft(y(b));
  if (Math.abs(yb - yt) < 0.0005) return 0;
  let out: number;
  if (yb > yt) {
    out = (yb ** 0.56 - yt ** 0.57) * 1.14;
    out = out < 0.1 ? 0 : out - 0.027;
  } else {
    out = (yb ** 0.65 - yt ** 0.62) * 1.14;
    out = out > -0.1 ? 0 : out + 0.027;
  }
  return out * 100;
}
