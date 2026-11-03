// SPDX-License-Identifier: Apache-2.0
// Bun OS window chrome: one cross-platform spec (macOS-style traffic-light caption buttons, rounded corners, soft
// layered shadows, translucent chrome materials) on top of the M3 tokens, and its per-desktop renderings:
//   chromeSpec()            the resolved spec (JSON): geometry, colours per mode, materials, elevation, motion, checks
//   trafficLightSvg()       our own caption-button artwork (no Apple asset: plain circles and stroked glyphs)
//   gtkChromeCss()          GTK 3 / GTK 4 / libadwaita window controls, decorations and header bar
//   hyprlandChrome()        Hyprland decoration/animation block plus hyprbars plugin settings and buttons
//   cosmicTk()              COSMIC toolkit config (com.system76.CosmicTk) and the window-controls patch note
//   win11Chrome()           crates/bunos-win11-chrome `describe` JSON (Chrome, Traffic, Dock) for one mode
// Colours: the traffic-light hues are harmonised towards the theme primary (MCU harmonize: hue rotation of at most
// 15 deg), so they stay recognisable but sit in the M3 palette. Everything else is an M3 role.
import { EXPRESSIVE_SPRINGS } from "@aphrody/m3-tokens/expressive";
import { Hct, argbFromHex, hexFromArgb } from "@aphrody/m3-tokens/dynamic-color";
import { allModes, rgb } from "./color.ts";
import type { Mode, Roles, ThemeInput } from "./types.ts";

// ------------------------------------------------------------------------------------------------------ colour math

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.040_45 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** `over` composited at `alpha` on `under` (sRGB, the average a blurred backdrop converges to). */
export function composite(over: string, alpha: number, under: string): string {
  const [a, b] = [rgb(over), rgb(under)];
  return `#${a
    .map((c, i) =>
      Math.round(c * alpha + b[i]! * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
/** A role at `a` alpha as a CSS `rgba()` value (GTK 3 has no color-mix). */
const rgba = (hex: string, a: number): string => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
const sanitize = (d: number): number => ((d % 360) + 360) % 360;
/** MCU `Blend.harmonize`: rotate `design`'s hue towards `source` by min(diff / 2, 15 deg), keep chroma and tone. */
export function harmonize(design: string, source: string): string {
  const d = Hct.fromInt(argbFromHex(design));
  const s = Hct.fromInt(argbFromHex(source));
  const diff = 180 - Math.abs(Math.abs(d.hue - s.hue) - 180);
  const rot = Math.min(diff * 0.5, 15);
  const dir = sanitize(s.hue - d.hue) <= 180 ? 1 : -1;
  return hexFromArgb(Hct.from(sanitize(d.hue + rot * dir), d.chroma, d.tone).toInt());
}
const tone = (hex: string, t: number): string => {
  const h = Hct.fromInt(argbFromHex(hex));
  return hexFromArgb(Hct.from(h.hue, h.chroma, t).toInt());
};

// ------------------------------------------------------------------------------------------------------------ spec

/** Generic red / amber / green signal hues (not Apple artwork), harmonised per theme: recognisable traffic-light content. */
// design:content
const SIGNAL = { close: "#ff5f57", minimize: "#febc2e", zoom: "#28c840" } as const;
export type Button = keyof typeof SIGNAL;
export const BUTTONS: readonly Button[] = ["close", "minimize", "zoom"];
export const BUTTON_NAMES: Record<Button, string> = { close: "Close", minimize: "Minimise", zoom: "Zoom" };

/** M3 Expressive motion: springs (MCU damping ratio, stiffness) and their published cubic-bezier approximations. */
export const MOTION = {
  springs: EXPRESSIVE_SPRINGS,
  spatial: {
    fast: { ms: 350, bezier: [0.42, 1.67, 0.21, 0.9] },
    default: { ms: 500, bezier: [0.38, 1.21, 0.22, 1] },
    slow: { ms: 650, bezier: [0.39, 1.29, 0.35, 0.98] },
  },
  effects: {
    fast: { ms: 150, bezier: [0.31, 0.94, 0.34, 1] },
    default: { ms: 200, bezier: [0.34, 0.8, 0.34, 1] },
    slow: { ms: 300, bezier: [0.34, 0.88, 0.34, 1] },
  },
  /** Exit runs at 65 % of the enter duration (spec: 60-70 %). */
  exitRatio: 0.65,
} as const;

/** One elevation scale (M3 levels 0-5, dp) rendered as two-layer soft shadows (key + ambient) in the `shadow` role. */
export const ELEVATION = [0, 1, 3, 6, 8, 12] as const;
export function shadow(level: number, dark: boolean, shadowRole: string): string {
  const dp = ELEVATION[level] ?? 0;
  if (dp === 0) return "none";
  const k = dark ? 0.5 : 0.22;
  const a = dark ? 0.36 : 0.14;
  return `0 ${dp}px ${dp * 3}px ${rgba(shadowRole, Number(k.toFixed(2)))}, 0 ${Math.max(1, dp / 4)}px ${Math.max(2, dp / 2)}px ${rgba(shadowRole, Number(a.toFixed(2)))}`;
}

/** Geometry shared by every desktop (px at 100 % scale). */
export const GEOMETRY = {
  /** Window corner: M3 `corner-large`. */
  radius: 16,
  titlebarHeight: 40,
  button: { diameter: 12, hit: 24, gap: 8, inset: 14, glyphStroke: 1.4 },
  focusRing: { width: 2, offset: 2 },
  /** Windows 11 DWM: DWMWCP_ROUND (8 px) is the nearest supported corner to `radius` (DWMWCP_ROUNDSMALL is 4 px). */
  dwmCorner: "DWMWCP_ROUND",
  activeElevation: 4,
  inactiveElevation: 2,
} as const;

export interface Material {
  role: string;
  color: string;
  alpha: number;
  blur: number;
}
export interface ModeChrome {
  mode: Mode;
  titlebar: Material;
  sidebar: Material;
  dock: Material;
  /** The `shadow` role: elevation shadows and the caption-button rim. */
  shadowColor: string;
  title: string;
  titleInactive: string;
  border: string;
  focusRing: string;
  buttons: Record<Button, { fill: string; glyph: string; pressed: string }>;
  inactive: { fill: string; border: string };
  shadow: { active: string; inactive: string };
  checks: { name: string; ratio: number; min: number; pass: boolean }[];
}

/** Reference backdrops for the material contrast check (the extremes a wallpaper can reach), not chrome colours. */
// design:content
const WALLPAPERS = { light: "#ffffff", dark: "#000000" } as const;

/** Smallest alpha (>= base) keeping `text` at `min`:1 on the material over both reference wallpapers. */
function tuneAlpha(material: string, text: string, base: number, min: number): number {
  for (let a = base; a < 1; a += 0.02) {
    if (Object.values(WALLPAPERS).every(w => contrast(text, composite(material, a, w)) >= min))
      return Number(a.toFixed(2));
  }
  return 1;
}

function modeChrome(r: Roles, mode: Mode): ModeChrome {
  const dark = mode === "dark";
  const primary = r["primary"]!;
  const material = (role: string, base: number, blur: number): Material => ({
    role,
    color: r[role]!,
    alpha: tuneAlpha(r[role]!, r["onSurface"]!, base, 4.5),
    blur,
  });
  const titlebar = material("surfaceContainer", 0.78, 24);
  const buttons = Object.fromEntries(
    BUTTONS.map(b => {
      const fill = harmonize(SIGNAL[b], primary);
      return [b, { fill, glyph: tone(fill, dark ? 20 : 25), pressed: tone(fill, dark ? 55 : 50) }];
    }),
  ) as ModeChrome["buttons"];
  const opaqueBar = r["surfaceContainer"]!;
  const inactive = { fill: r["surfaceContainerHighest"]!, border: r["outline"]! };
  const checks = [
    ...Object.entries(WALLPAPERS).map(([w, bg]) => {
      const ratio = contrast(r["onSurface"]!, composite(titlebar.color, titlebar.alpha, bg));
      return { name: `title text on translucent title bar over ${w} wallpaper`, ratio, min: 4.5, pass: ratio >= 4.5 };
    }),
    { name: "title text on opaque title bar", ratio: contrast(r["onSurface"]!, opaqueBar), min: 4.5 },
    { name: "inactive button boundary vs title bar", ratio: contrast(inactive.border, opaqueBar), min: 3 },
    { name: "focus ring vs title bar", ratio: contrast(r["secondary"]!, opaqueBar), min: 3 },
    ...BUTTONS.map(b => ({
      name: `${b} glyph on button`,
      ratio: contrast(buttons[b].glyph, buttons[b].fill),
      min: 3,
    })),
  ].map(c => ({ ...c, ratio: Number(c.ratio.toFixed(2)), pass: c.ratio >= c.min }));
  return {
    mode,
    titlebar,
    sidebar: material("surfaceContainerLow", 0.72, 32),
    dock: material("surfaceContainerHigh", 0.7, 40),
    title: r["onSurface"]!,
    titleInactive: r["onSurfaceVariant"]!,
    border: r["outlineVariant"]!,
    focusRing: r["secondary"]!,
    buttons,
    inactive,
    shadowColor: r["shadow"]!,
    shadow: {
      active: shadow(GEOMETRY.activeElevation, dark, r["shadow"]!),
      inactive: shadow(GEOMETRY.inactiveElevation, dark, r["shadow"]!),
    },
    checks,
  };
}

export interface ChromeSpec {
  schema: 1;
  seed: string;
  geometry: typeof GEOMETRY;
  motion: typeof MOTION;
  elevation: typeof ELEVATION;
  accessibility: Record<string, string>;
  light: ModeChrome;
  dark: ModeChrome;
}

export function chromeSpec(input: ThemeInput): ChromeSpec {
  const [light, dark] = allModes(input);
  return {
    schema: 1,
    seed: input.seed.toLowerCase(),
    geometry: GEOMETRY,
    motion: MOTION,
    elevation: ELEVATION,
    accessibility: {
      names: "Close / Minimise / Zoom exposed through UIA (Windows) and AT-SPI (Linux); tooltips carry the same names",
      glyphs: "shown on hover of the button group and on keyboard focus, never hover-only",
      hitArea: "24x24 px minimum around the 12 px visual circle",
      transparency:
        "materials fall back to alpha 1 when reduce-transparency / Windows transparency effects are off or forced colours are on",
      motion:
        "spring animations are skipped when reduced motion is requested (Windows animation effects off, gtk-enable-animations=false, Hyprland animations:enabled=false)",
    },
    light: modeChrome(light!.roles, "light"),
    dark: modeChrome(dark!.roles, "dark"),
  };
}

// --------------------------------------------------------------------------------------------------- button artwork

export type ButtonState = "normal" | "hover" | "pressed" | "inactive" | "focus";
export const BUTTON_STATES: readonly ButtonState[] = ["normal", "hover", "pressed", "inactive", "focus"];

/** One caption button at its hit-area size (24 x 24 viewBox), drawn from the spec. */
export function trafficLightSvg(m: ModeChrome, button: Button, state: ButtonState): string {
  const { diameter, hit, glyphStroke } = GEOMETRY.button;
  const c = hit / 2;
  const rad = diameter / 2;
  const b = m.buttons[button];
  const fill = state === "inactive" ? m.inactive.fill : state === "pressed" ? b.pressed : b.fill;
  const ring =
    state === "inactive"
      ? `<circle cx="${c}" cy="${c}" r="${rad - 0.5}" fill="none" stroke="${m.inactive.border}" stroke-width="1"/>`
      : `<circle cx="${c}" cy="${c}" r="${rad - 0.25}" fill="none" stroke="${m.shadowColor}" stroke-opacity="0.12" stroke-width="0.5"/>`;
  const focus =
    state === "focus"
      ? `<circle cx="${c}" cy="${c}" r="${rad + GEOMETRY.focusRing.offset + GEOMETRY.focusRing.width / 2}" fill="none" stroke="${m.focusRing}" stroke-width="${GEOMETRY.focusRing.width}"/>`
      : "";
  const g = 3; // glyph half-extent
  const glyphPath: Record<Button, string> = {
    close: `M${c - g} ${c - g}L${c + g} ${c + g}M${c + g} ${c - g}L${c - g} ${c + g}`,
    minimize: `M${c - g - 0.5} ${c}H${c + g + 0.5}`,
    zoom: `M${c - g} ${c - g}H${c + 1}L${c - g} ${c + 1}Z M${c + g} ${c + g}H${c - 1}L${c + g} ${c - 1}Z`,
  };
  const showGlyph = state === "hover" || state === "pressed" || state === "focus";
  const glyph = showGlyph
    ? button === "zoom"
      ? `<path d="${glyphPath.zoom}" fill="${b.glyph}"/>`
      : `<path d="${glyphPath[button]}" stroke="${b.glyph}" stroke-width="${glyphStroke}" stroke-linecap="round" fill="none"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${hit}" height="${hit}" viewBox="0 0 ${hit} ${hit}"><title>${BUTTON_NAMES[button]}</title>${focus}<circle cx="${c}" cy="${c}" r="${rad}" fill="${fill}"/>${ring}${glyph}</svg>`;
}

// ------------------------------------------------------------------------------------------------------------- GTK

/** GTK chrome: traffic-light window controls (GTK 4 `windowcontrols`, GTK 3 `.titlebutton`), decorations, header bar. */
export function gtkChromeCss(spec: ChromeSpec, mode: Mode, version: 3 | 4): string {
  const m = spec[mode];
  const { diameter, hit, gap } = GEOMETRY.button;
  const sel = version === 4 ? "windowcontrols > button" : "headerbar button.titlebutton, .titlebar button.titlebutton";
  const cls = (b: Button) => (b === "zoom" ? "maximize" : b);
  const per = BUTTONS.map(
    b => `${sel}.${cls(b)} ${version === 4 ? "image" : ""} { background-color: ${m.buttons[b].fill}; }
${sel}.${cls(b)}:active ${version === 4 ? "image" : ""} { background-color: ${m.buttons[b].pressed}; }
${version === 4 ? "windowcontrols:hover > button" : "headerbar:hover button.titlebutton"}.${cls(b)} ${version === 4 ? "image" : ""}, ${sel}.${cls(b)}:focus-visible ${version === 4 ? "image" : ""} { color: ${m.buttons[b].glyph}; }`,
  ).join("\n");
  const img = version === 4 ? " image" : "";
  return `/* Bun OS window chrome (${mode}, GTK ${version}): generated by @aphrody/m3-os-themes chrome.ts from the M3 tokens. */
${version === 4 ? "windowcontrols" : "headerbar .titlebutton-box"} { border-spacing: ${gap - (hit - diameter)}px; margin: 0 ${GEOMETRY.button.inset - (hit - diameter) / 2}px; }
${sel} { min-width: ${hit}px; min-height: ${hit}px; padding: 0; margin: 0; border: none; background: none; box-shadow: none; outline: none; }
${sel}${img} { min-width: ${diameter}px; min-height: ${diameter}px; border-radius: 9999px; color: transparent; -gtk-icon-size: 8px;
  box-shadow: inset 0 0 0 0.5px ${rgba(m.shadowColor, 0.12)}; transition: background-color ${MOTION.effects.fast.ms}ms cubic-bezier(${MOTION.effects.fast.bezier.join(", ")}); }
${per}
${sel}:focus-visible { outline: ${GEOMETRY.focusRing.width}px solid ${m.focusRing}; outline-offset: -${(hit - diameter) / 2 - GEOMETRY.focusRing.offset}px; border-radius: 9999px; }
${version === 4 ? "window:backdrop windowcontrols > button image" : "headerbar:backdrop button.titlebutton"} { background-color: ${m.inactive.fill}; box-shadow: inset 0 0 0 1px ${m.inactive.border}; color: transparent; }
window.csd${version === 3 ? ", window.csd decoration" : ""} { border-radius: ${GEOMETRY.radius}px; }
${version === 3 ? "decoration" : "window.csd"} { box-shadow: ${m.shadow.active}, 0 0 0 1px ${rgba(m.border, 0.6)}; }
${version === 3 ? "decoration:backdrop" : "window.csd:backdrop"} { box-shadow: ${m.shadow.inactive}, 0 0 0 1px ${rgba(m.border, 0.5)}; }
headerbar { min-height: ${GEOMETRY.titlebarHeight}px; background-color: ${m.titlebar.color}; color: ${m.title}; box-shadow: inset 0 -1px ${m.border}; }
headerbar:backdrop { color: ${m.titleInactive}; }
headerbar .title, windowtitle .title { font-weight: 600; }
`;
}

/** gtk-3.0/settings.ini and gtk-4.0/settings.ini: macOS button order (left), fonts, icon theme. */
export function gtkSettings(font: string, icons: string, dark: boolean): string {
  return `[Settings]
gtk-decoration-layout=close,minimize,maximize:menu
gtk-font-name=${font} 11
gtk-icon-theme-name=${icons}
gtk-application-prefer-dark-theme=${dark ? 1 : 0}
gtk-enable-animations=true
`;
}

// -------------------------------------------------------------------------------------------------------- Hyprland

const hypr = (hex: string, a = 1): string =>
  `rgba(${hex.slice(1)}${Math.round(a * 255)
    .toString(16)
    .padStart(2, "0")})`;
const bez = (b: readonly number[]): string => b.join(", ");
const ds = (ms: number): string => (ms / 100).toFixed(1);

/** Hyprland decoration, animations (M3 Expressive curves) and hyprbars (left traffic lights, glyph on hover). */
export function hyprlandChrome(spec: ChromeSpec, mode: Mode, font: string): string {
  const m = spec[mode];
  const { spatial, effects, exitRatio } = MOTION;
  const buttons = [...BUTTONS]
    .reverse() // hyprbars lists buttons from the outer edge inwards
    .map(b => {
      const action = {
        close: "hyprctl dispatch killactive",
        minimize: "hyprctl dispatch movetoworkspacesilent special:minimized",
        zoom: "hyprctl dispatch fullscreen 1",
      }[b];
      const icon = { close: "×", minimize: "−", zoom: "+" }[b];
      return `        hyprbars-button = ${hypr(m.buttons[b].fill)}, ${GEOMETRY.button.diameter + 2}, ${icon}, ${action}, ${hypr(m.buttons[b].glyph)}`;
    })
    .join("\n");
  return `# Bun OS window chrome for Hyprland (${mode}): generated by @aphrody/m3-os-themes chrome.ts. Do not hand-edit.
# Needs the hyprbars plugin (vendor/hyprland/hyprland-plugins, BSD-3-Clause): hyprpm or the bunos hyprbars package.
general {
    border_size = 1
    col.active_border = ${hypr(m.border)}
    col.inactive_border = ${hypr(m.border, 0.6)}
    gaps_in = 6
    gaps_out = 12
}
decoration {
    rounding = ${GEOMETRY.radius}
    rounding_power = 3.0
    active_opacity = 1.0
    inactive_opacity = 1.0
    shadow {
        enabled = true
        range = ${ELEVATION[GEOMETRY.activeElevation] * 3}
        render_power = 3
        offset = 0 ${ELEVATION[GEOMETRY.activeElevation]}
        color = ${hypr(m.shadowColor, mode === "dark" ? 0.5 : 0.22)}
        color_inactive = ${hypr(m.shadowColor, mode === "dark" ? 0.36 : 0.14)}
    }
    blur {
        enabled = true
        size = ${Math.round(m.titlebar.blur / 3)}
        passes = 3
        vibrancy = 0.17
        new_optimizations = true
    }
}
# M3 Expressive motion: spatial springs for windows, effects curves for fades; exit at ${exitRatio * 100} % of enter.
# Reduced motion: set animations:enabled = false (bunos-theme does it when the session asks for reduced motion).
animations {
    enabled = true
    bezier = m3SpatialFast, ${bez(spatial.fast.bezier)}
    bezier = m3SpatialDefault, ${bez(spatial.default.bezier)}
    bezier = m3EffectsDefault, ${bez(effects.default.bezier)}
    bezier = m3Exit, 0.3, 0, 0.8, 0.15
    animation = windowsIn, 1, ${ds(spatial.default.ms)}, m3SpatialDefault, popin 88%
    animation = windowsOut, 1, ${ds(spatial.default.ms * exitRatio)}, m3Exit, popin 88%
    animation = windowsMove, 1, ${ds(spatial.fast.ms)}, m3SpatialFast
    animation = fade, 1, ${ds(effects.default.ms)}, m3EffectsDefault
    animation = workspaces, 1, ${ds(spatial.default.ms)}, m3SpatialDefault, slidefade 12%
    animation = layers, 1, ${ds(spatial.fast.ms)}, m3SpatialFast, popin 92%
}
plugin {
    hyprbars {
        enabled = true
        bar_height = ${GEOMETRY.titlebarHeight - 12}
        bar_color = ${hypr(m.titlebar.color, m.titlebar.alpha)}
        bar_blur = true
        col.text = ${hypr(m.title)}
        bar_text_font = ${font}
        bar_text_size = 11
        bar_text_weight = semibold
        bar_text_align = center
        bar_buttons_alignment = left
        bar_padding = ${GEOMETRY.button.inset}
        bar_button_padding = ${GEOMETRY.button.gap}
        bar_part_of_window = true
        bar_precedence_over_border = true
        icon_on_hover = true
        inactive_button_color = ${hypr(m.inactive.fill)}
        on_double_click = hyprctl dispatch fullscreen 1
${buttons}
    }
}
# Translucency only on chrome (bars, panels, launcher), never under content.
layerrule = blur, waybar
layerrule = blur, walker
layerrule = ignorezero, waybar
`;
}

// ---------------------------------------------------------------------------------------------------------- COSMIC

/** com.system76.CosmicTk v1 entries (one file per key under ~/.config/cosmic/com.system76.CosmicTk/v1/). */
export function cosmicTk(sans: string, mono: string, icons: string): Record<string, string> {
  const font = (family: string) =>
    `(\n    family: "${family}",\n    weight: Normal,\n    stretch: Normal,\n    style: Normal,\n)`;
  return {
    apply_theme_global: "true",
    show_minimize: "true",
    show_maximize: "true",
    icon_theme: `"${icons}"`,
    header_size: "Standard",
    interface_density: "Standard",
    interface_font: font(sans),
    monospace_font: font(mono),
  };
}

// --------------------------------------------------------------------------------------------------------- Windows

/** `bunos-win11-chrome describe` shape: Chrome { rounded, mica, dark, caption, border }, Traffic, Dock (Rgb = u32). */
export function win11Chrome(spec: ChromeSpec, mode: Mode): object {
  const m = spec[mode];
  const u = (hex: string) => Number.parseInt(hex.slice(1), 16);
  return {
    chrome: { rounded: true, mica: true, dark: mode === "dark", caption: u(m.titlebar.color), border: u(m.border) },
    traffic: {
      close: u(m.buttons.close.fill),
      minimize: u(m.buttons.minimize.fill),
      zoom: u(m.buttons.zoom.fill),
      diameter: GEOMETRY.button.diameter,
      gap: GEOMETRY.button.gap,
      inset: GEOMETRY.button.inset,
    },
    dock: {
      position: "bottom",
      icon_size: 48,
      magnification: 1.5,
      autohide: true,
      background: u(m.dock.color),
      items: [],
    },
    "x-bunos": {
      corner: GEOMETRY.dwmCorner,
      hit: GEOMETRY.button.hit,
      glyph: Object.fromEntries(BUTTONS.map(b => [b, u(m.buttons[b].glyph)])),
      inactive: { fill: u(m.inactive.fill), border: u(m.inactive.border) },
      focusRing: u(m.focusRing),
      titleText: u(m.title),
      names: BUTTON_NAMES,
    },
  };
}
