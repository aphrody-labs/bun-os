// Reads the three W3C design-token files and resolves every (theme, scheme, accent) combination to the
// shared semantic contract (SLOTS) plus theme-native extras. This is the only place that knows how a vendor
// token set maps to the contract; every output format is generated from its result.
import {
  argbFromHex,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeTonalSpot,
} from "@material/material-color-utilities";
import { join } from "node:path";
import { mix, parseHex, toHex, withAlpha } from "./color.ts";
// Type scale and Expressive springs come from the existing M3 owner, not copied.
import { EMPHASIZED_STYLES, TYPE_BASE } from "../../m3-tokens/src/expressive.ts";

export const SLOTS = [
  "bg",
  "bgAlt",
  "surface",
  "surfaceRaised",
  "layer",
  "fg",
  "fgMuted",
  "fgSubtle",
  "fgDisabled",
  "border",
  "borderStrong",
  "divider",
  "control",
  "controlHover",
  "controlPressed",
  "accent",
  "accentHover",
  "accentPressed",
  "onAccent",
  "accentContainer",
  "onAccentContainer",
  "danger",
  "onDanger",
  "warning",
  "success",
  "focus",
  "selection",
  "scrim",
  "shadow",
  "glassTint",
  "glass",
  "glassBorder",
  "glassHighlight",
] as const;
export type Slot = (typeof SLOTS)[number];
export const THEME_IDS = ["m3", "fluent", "apple"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const SCHEMES = ["light", "dark"] as const;
export type Scheme = (typeof SCHEMES)[number];

export interface TextStyle {
  size: number;
  line: number;
  weight: number;
}
export interface ThemeStatic {
  id: ThemeId;
  name: string;
  accents: string[];
  defaultAccent: string;
  shape: Record<string, number>;
  fonts: { ui: string; display: string; mono: string };
  ramp: Record<string, TextStyle>;
  /** Apple only: macOS ramp, used on fine-pointer devices. */
  rampDesktop?: Record<string, TextStyle>;
  motion: {
    fastMs: number;
    normalMs: number;
    slowMs: number;
    easing: [number, number, number, number];
  };
  springs?: Record<string, { damping: number; stiffness: number }>;
  glass: {
    blur: number;
    saturate: number;
    opacity: Record<Scheme, number>;
    clearOpacity?: Record<Scheme, number>;
    clearBlur?: number;
    dim?: number;
  };
  controls: "traffic-lights" | "caption" | "m3";
  windowEffects: { windows: string[]; macos: string[]; other: string[] };
  sources: { what: string; url: string; version?: string }[];
  unknown: string[];
}
export interface Resolved {
  theme: ThemeId;
  scheme: Scheme;
  accent: string;
  colors: Record<Slot, string>;
  /** Theme-native custom properties (full name, e.g. --md-sys-color-primary). */
  extra: Record<string, string>;
}

type Node = Record<string, any>;
const v = (n: Node | undefined): any => {
  if (!n || !("$value" in n)) throw new Error("missing $value");
  return n.$value;
};
const px = (s: string) => parseFloat(s);
const ms = (s: string) => parseFloat(s);
const dir = join(import.meta.dir, "..", "tokens");
const load = async (f: string): Promise<Node> => JSON.parse(await Bun.file(join(dir, f)).text());
const fam = (n: Node) =>
  (v(n) as string[]).map(f => (/[\s]|^-/.test(f) && !f.startsWith("-apple") ? `"${f}"` : f)).join(", ");
const kebab = (s: string) => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const hexOf = (argb: number) => hexFromArgb(argb).toUpperCase();

function statics(t: Node, id: ThemeId): ThemeStatic {
  const meta = t.$extensions.aphrody;
  const shape = Object.fromEntries(
    Object.entries(t.shape)
      .filter(([k]) => !k.startsWith("$"))
      .map(([k, n]) => [k, px(v(n as Node))]),
  );
  const ty = t.typography;
  const m = t.motion;
  const easing = v(m.easing) as [number, number, number, number];
  const mat = t.material;
  const ramp = ty.ramp as Record<string, TextStyle> | undefined;
  const base: ThemeStatic = {
    id,
    name: meta.name,
    accents: Object.keys(t.accent).filter(k => !k.startsWith("$")),
    defaultAccent: meta.defaultAccent,
    shape,
    fonts: {
      ui: fam(ty.fontUi),
      display: fam(ty.fontDisplay),
      mono: fam(ty.fontMono),
    },
    ramp: ramp ?? {},
    motion: {
      fastMs: ms(v(m.fast)),
      normalMs: ms(v(m.normal)),
      slowMs: ms(v(m.slow)),
      easing,
    },
    springs: m.springs,
    glass: {
      blur: mat.blur,
      saturate: mat.saturate,
      opacity: { light: 1, dark: 1 },
    },
    controls: mat.controls,
    windowEffects: mat.windowEffects,
    sources: meta.sources,
    unknown: meta.unknown ?? [],
  };
  if (id === "m3") {
    // M3 type scale from the existing owner: size/line in px (rem * 16), base weights.
    const toPx = (r: string) => Math.round(parseFloat(r) * 16 * 1000) / 1000;
    base.ramp = Object.fromEntries(
      Object.entries(TYPE_BASE).map(([k, b]) => [
        k,
        { size: toPx(b.size), line: toPx(b.lineHeight), weight: b.weight },
      ]),
    );
    base.ramp = {
      ...base.ramp,
      ...Object.fromEntries(
        EMPHASIZED_STYLES.map(s => [
          `${s.name}-emphasized`,
          { size: toPx(s.size), line: toPx(s.lineHeight), weight: s.weight },
        ]),
      ),
    };
  }
  if (id === "apple") {
    base.rampDesktop = ty.rampMac;
    base.glass = {
      blur: mat.regular.blur,
      saturate: mat.saturate,
      opacity: { light: mat.regular.light.alpha, dark: mat.regular.dark.alpha },
      clearOpacity: {
        light: mat.clear.light.alpha,
        dark: mat.clear.dark.alpha,
      },
      clearBlur: mat.clear.blur,
      dim: mat.clear.dim,
    };
  }
  if (id === "fluent") base.glass = { ...base.glass, opacity: { light: 0.7, dark: 0.7 } };
  return base;
}

export interface Model {
  statics: Record<ThemeId, ThemeStatic>;
  resolved: Resolved[];
  fluentExtras: {
    light: Record<string, string | number>;
    dark: Record<string, string | number>;
  };
}

export async function build(): Promise<Model> {
  const [m3, fl, ap, fluent2] = await Promise.all([
    load("m3-googlebook.tokens.json"),
    load("fluent-win11.tokens.json"),
    load("apple-glass.tokens.json"),
    Bun.file(join(import.meta.dir, "..", "..", "fluent", "tokens", "fluent2.json")).json() as Promise<Node>,
  ]);
  const st: Record<ThemeId, ThemeStatic> = {
    m3: statics(m3, "m3"),
    fluent: statics(fl, "fluent"),
    apple: statics(ap, "apple"),
  };
  const out: Resolved[] = [];
  for (const scheme of SCHEMES) {
    for (const accent of st.m3.accents) out.push(resolveM3(m3, scheme, accent));
    for (const accent of st.fluent.accents) out.push(resolveFluent(fl, fluent2, scheme, accent));
    for (const accent of st.apple.accents) out.push(resolveApple(ap, scheme, accent));
  }
  return {
    statics: st,
    resolved: out,
    fluentExtras: { light: fluent2.light, dark: fluent2.dark },
  };
}

/** Fills the slots every theme derives the same way once its base slots are known. */
function finish(r: Omit<Resolved, "colors"> & { colors: Partial<Record<Slot, string>> }): Resolved {
  const c = r.colors as Record<Slot, string>;
  return { ...r, colors: c };
}

function resolveM3(t: Node, scheme: Scheme, accent: string): Resolved {
  const dark = scheme === "dark";
  const seed = Hct.fromInt(argbFromHex(v(t.accent[accent])));
  const s = new SchemeTonalSpot(seed, dark, 0);
  const D = MaterialDynamicColors as unknown as Record<string, { getArgb(s: SchemeTonalSpot): number } | undefined>;
  const role: Record<string, string> = {};
  const extra: Record<string, string> = {};
  for (const k of Object.getOwnPropertyNames(MaterialDynamicColors)) {
    const dc = D[k];
    if (dc && typeof dc === "object" && typeof dc.getArgb === "function") {
      role[k] = hexOf(dc.getArgb(s));
      extra[`--md-sys-color-${kebab(k)}`] = role[k]!;
    }
  }
  const x = t.extra[scheme];
  const accentHex = role.primary!;
  const glassTint = role.surfaceContainerHigh!;
  return finish({
    theme: "m3",
    scheme,
    accent,
    extra,
    colors: {
      bg: role.background,
      bgAlt: role.surfaceContainerLow,
      surface: role.surfaceContainer,
      surfaceRaised: role.surfaceContainerHigh,
      layer: role.surfaceContainerLowest,
      fg: role.onSurface,
      fgMuted: role.onSurfaceVariant,
      fgSubtle: role.outline,
      fgDisabled: withAlpha(role.onSurface!, 0.38),
      border: role.outlineVariant,
      borderStrong: role.outline,
      divider: role.outlineVariant,
      control: role.surfaceContainerHighest,
      controlHover: mix(role.surfaceContainerHighest!, role.onSurface!, 0.08),
      controlPressed: mix(role.surfaceContainerHighest!, role.onSurface!, 0.1),
      accent: accentHex,
      accentHover: mix(accentHex, role.onPrimary!, 0.08),
      accentPressed: mix(accentHex, role.onPrimary!, 0.12),
      onAccent: role.onPrimary,
      accentContainer: role.primaryContainer,
      onAccentContainer: role.onPrimaryContainer,
      danger: role.error,
      onDanger: role.onError,
      warning: v(x.warning),
      success: v(x.success),
      focus: accentHex,
      selection: role.primaryContainer,
      scrim: withAlpha(role.scrim!, 0.32),
      shadow: withAlpha(role.shadow!, 0.2),
      glassTint,
      glass: glassTint,
      glassBorder: role.outlineVariant,
      glassHighlight: "#FFFFFF00",
    },
  });
}

// Windows derives SystemAccentColorLight/Dark shades with an OS algorithm. For the measured default accent the
// palette is exact; other accents keep their HCT hue and chroma and take the tone offsets fitted on the measured
// blue (0078D4 tone 49.7 -> Dark1 43.5, Light2 74.4, Light3 88.6, Dark2 28.2). Dark1 and Dark2 are capped at the blue's
// tones so light accents (yellow, orange) stay dark enough for white text: a design choice, not the Windows algorithm.
function fluentShades(
  t: Node,
  accent: string,
): {
  light3: string;
  light2: string;
  dark1: string;
  dark2: string;
  base: string;
} {
  const sh = t.accentShades;
  if (accent === t.$extensions.aphrody.defaultAccent)
    return {
      light3: v(sh.light3),
      light2: v(sh.light2),
      dark1: v(sh.dark1),
      dark2: v(sh.dark2),
      base: v(sh.base),
    };
  const base = v(t.accent[accent]);
  const h = Hct.fromInt(argbFromHex(base));
  const atTone = (tone: number) => hexOf(Hct.from(h.hue, h.chroma, Math.min(98, Math.max(2, tone))).toInt());
  const at = (dt: number) => atTone(h.tone + dt);
  return {
    light3: at(88.6 - 49.7),
    light2: at(74.4 - 49.7),
    dark1: atTone(Math.min(h.tone - 6.2, 43.5)),
    dark2: atTone(Math.min(h.tone - 21.5, 28.2)),
    base,
  };
}

function resolveFluent(t: Node, f2: Node, scheme: Scheme, accent: string): Resolved {
  const dark = scheme === "dark";
  const c = t.color[scheme] as Node;
  const g = (k: string): string => v(c[k]);
  const sh = fluentShades(t, accent);
  const a = dark ? sh.light2 : sh.dark1;
  const accentText = dark ? sh.light3 : sh.dark2;
  const glassTint = g("bgAlt");
  const extra: Record<string, string> = {};
  for (const [k, val] of Object.entries(f2[scheme] as Node)) extra[`--${k}`] = String(val);
  // Fluent 2 web components speak the brand ramp: point it at the Windows accent so the two layers agree.
  const brand: Record<string, string> = {
    colorBrandBackground: a,
    colorBrandBackgroundHover: withAlpha(a, 0.9),
    colorBrandBackgroundPressed: withAlpha(a, 0.8),
    colorBrandBackgroundSelected: withAlpha(a, 0.8),
    colorBrandForeground1: accentText,
    colorBrandForeground2: accentText,
    colorBrandForegroundLink: accentText,
    colorBrandStroke1: a,
    colorCompoundBrandStroke: a,
    colorCompoundBrandBackground: a,
  };
  for (const [k, val] of Object.entries(brand)) extra[`--${k}`] = val;
  const bg = g("bg");
  return finish({
    theme: "fluent",
    scheme,
    accent,
    extra,
    colors: {
      bg,
      bgAlt: g("bgAlt"),
      surface: g("surface"),
      surfaceRaised: g("surfaceRaised"),
      layer: g("layer"),
      fg: g("fg"),
      fgMuted: g("fgMuted"),
      fgSubtle: g("fgSubtle"),
      fgDisabled: g("fgDisabled"),
      border: g("border"),
      borderStrong: g("borderStrong"),
      divider: g("divider"),
      control: g("control"),
      controlHover: g("controlHover"),
      controlPressed: g("controlPressed"),
      accent: a,
      accentHover: withAlpha(a, 0.9),
      accentPressed: withAlpha(a, 0.8),
      onAccent: g("onAccent"),
      accentContainer: mix(bg, a, 0.2),
      onAccentContainer: g("fg"),
      danger: g("danger"),
      onDanger: g("onDanger"),
      warning: g("warning"),
      success: g("success"),
      focus: g("focus"),
      selection: withAlpha(sh.base, 0.4),
      scrim: g("scrim"),
      shadow: g("shadow"),
      glassTint,
      glass: withAlpha(glassTint, 0.7),
      glassBorder: g("border"),
      glassHighlight: "#FFFFFF00",
    },
  });
}

function resolveApple(t: Node, scheme: Scheme, accent: string): Resolved {
  const dark = scheme === "dark";
  const c = t.color[scheme] as Node;
  const g = (k: string): string => v(c[k]);
  const a = v((dark ? t.accentDark : t.accent)[accent]);
  const bg = g("bg");
  const mat = t.material;
  const tint = mat.regular[scheme].tint as string;
  const hover = dark ? "#FFFFFF" : "#000000";
  return finish({
    theme: "apple",
    scheme,
    accent,
    extra: {},
    colors: {
      bg,
      bgAlt: g("bgAlt"),
      surface: g("surface"),
      surfaceRaised: g("surfaceRaised"),
      layer: g("layer"),
      fg: g("fg"),
      fgMuted: g("fgMuted"),
      fgSubtle: g("fgSubtle"),
      fgDisabled: g("fgDisabled"),
      border: g("border"),
      borderStrong: g("borderStrong"),
      divider: g("divider"),
      control: g("control"),
      controlHover: g("controlHover"),
      controlPressed: g("controlPressed"),
      accent: a,
      accentHover: mix(a, hover, 0.1),
      accentPressed: mix(a, hover, 0.2),
      onAccent: g("onAccent"),
      accentContainer: mix(bg, a, 0.16),
      onAccentContainer: g("fg"),
      danger: g("danger"),
      onDanger: g("onDanger"),
      warning: g("warning"),
      success: g("success"),
      focus: withAlpha(a, 0.6),
      selection: withAlpha(a, 0.3),
      scrim: g("scrim"),
      shadow: g("shadow"),
      glassTint: tint,
      glass: withAlpha(tint, mat.regular[scheme].alpha),
      glassBorder: withAlpha("#FFFFFF", dark ? 0.18 : 0.6),
      glassHighlight: withAlpha("#FFFFFF", mat.specular[scheme]),
    },
  });
}

export function opaque(hex: string): boolean {
  return parseHex(hex).a >= 0.9995;
}
export { toHex };
