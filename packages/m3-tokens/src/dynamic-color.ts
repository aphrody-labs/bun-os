// SPDX-License-Identifier: Apache-2.0
// -----------------------------------------------------------------------------
// @aphrody/m3-tokens — dynamic-color
// -----------------------------------------------------------------------------
// Runtime "Material You" dynamic colour: derive every M3 `--md-sys-color-*`
// role from one seed colour, for light and dark, and apply them live.
//
// The colour maths runs in the canonical engine (crates/aphrody-m3-tokens),
// compiled to WebAssembly by crates/libm3-wasm and loaded through ./wasm. This
// module converts between CSS hex strings and the engine's ARGB words and owns
// the stylesheet formatting; it computes no colour itself.
// Pure functions are environment-agnostic; only `applyDynamicColor` and
// `clearDynamicColor` touch the DOM.
// -----------------------------------------------------------------------------

import { ROLES } from "./native-theme";
import { materialWasm } from "./wasm";

export { ROLES };

// ---------------------------------------------------------------------------
// Variant type
// ---------------------------------------------------------------------------

/**
 * Scheme variants provided by the canonical engine.
 *
 * | Variant        | Character                                                  |
 * |----------------|------------------------------------------------------------|
 * | `tonalSpot`    | Default M3 (Android 12+): low–medium chroma, complementary tertiary |
 * | `content`      | Source colour in `primaryContainer`, high fidelity to input |
 * | `fidelity`     | Like content but tertiary from temperature complement       |
 * | `expressive`   | Detached from source — bold, diverse palette               |
 * | `vibrant`      | Maximum chroma at every tonal position                     |
 * | `neutral`      | Near-greyscale, very low chroma                             |
 * | `monochrome`   | Pure greyscale — zero chroma                               |
 * | `rainbow`      | Tonal spot with a stronger primary and grey neutrals        |
 * | `fruitSalad`   | Primary and secondary rotated -50°                          |
 */
export type SchemeVariant =
  "tonalSpot" | "content" | "fidelity" | "expressive" | "vibrant" | "neutral" | "monochrome" | "rainbow" | "fruitSalad";

/** Options shared by every scheme-deriving function. */
export interface SchemeOptions {
  /** Resolve the dark variant of the scheme. */
  dark?: boolean;
  /**
   * Contrast level in `[-1, 1]` (0 = standard, 0.5 = medium, 1 = maximum /
   * AAA-grade). Negative values reduce contrast below the M3 standard.
   * Alias: `contrast` (legacy, same field).
   */
  contrastLevel?: number;
  /**
   * @deprecated Use `contrastLevel`. Kept for backwards compatibility.
   * When both are provided, `contrastLevel` takes precedence.
   */
  contrast?: number;
  /**
   * Scheme variant (default: `"tonalSpot"`). Every variant produces the same
   * 49 `--md-sys-color-*` roles; only the palette relationships and chroma differ.
   */
  variant?: SchemeVariant;
}

/** A map of `--md-sys-color-*` custom-property names to hex colours. */
export type ColorRoleMap = Record<string, string>;

// ---------------------------------------------------------------------------
// ARGB <-> hex and HCT, backed by the engine
// ---------------------------------------------------------------------------

/** `#rrggbb` (or `rrggbb`) to opaque ARGB. */
export function argbFromHex(hex: string): number {
  return (0xff000000 | parseInt(normalizeSeedHex(hex).slice(1), 16)) >>> 0;
}

/** Opaque ARGB to lowercase `#rrggbb`. */
export function hexFromArgb(argb: number): string {
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** Hue, chroma and tone of a colour, resolved by the canonical engine (`Hct` of the M3 colour model). */
export class Hct {
  private constructor(
    readonly hue: number,
    readonly chroma: number,
    readonly tone: number,
    private readonly argb: number,
  ) {}

  /** The HCT of an ARGB colour. */
  static fromInt(argb: number): Hct {
    const { hue, chroma, tone } = materialWasm().hct(argb);
    return new Hct(hue, chroma, tone, argb >>> 0);
  }

  /** The displayable colour closest to `hue`, `chroma` and `tone`. */
  static from(hue: number, chroma: number, tone: number): Hct {
    return Hct.fromInt(materialWasm().hctToArgb(hue, chroma, tone));
  }

  /** Opaque ARGB value of this colour. */
  toInt(): number {
    return this.argb;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** `onPrimaryContainer` -> `on-primary-container`. */
function kebab(role: string): string {
  return role.replace(/([A-Z])/g, "-$1").toLowerCase();
}

/** Resolve the effective contrast level, preferring `contrastLevel` over `contrast`. */
function resolveContrast(opts: SchemeOptions): number {
  const contrast = opts.contrastLevel ?? opts.contrast ?? 0;
  if (!Number.isFinite(contrast) || contrast < -1 || contrast > 1) {
    throw new RangeError("M3 contrast must be a finite number between -1 and 1");
  }
  return contrast;
}

/** Engine variant index for a camelCase variant name. */
function variantIndex(variant: SchemeVariant): number {
  const index = materialWasm().variantNames.indexOf(kebab(String(variant)));
  if (index < 0) throw new TypeError(`Unknown M3 scheme variant: ${variant}`);
  return index;
}

/** Normalize a CSS hex seed, rejecting malformed colours before they reach the engine. */
export function normalizeSeedHex(seed: string): string {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(seed.trim());
  if (!match) throw new TypeError(`Invalid M3 seed color: ${seed}`);
  const digits = match[1]!;
  return `#${(digits.length === 3 ? [...digits].map(digit => digit + digit).join("") : digits).toLowerCase()}`;
}

/** Validated engine arguments for one request. */
function request(seedHex: string, opts: SchemeOptions) {
  const contrast = resolveContrast(opts);
  return {
    seed: argbFromHex(seedHex),
    variant: variantIndex(opts.variant ?? "tonalSpot"),
    contrast,
    mode: opts.dark ? ("dark" as const) : ("light" as const),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve every M3 colour role for one mode from a seed colour.
 *
 * @param seedHex Source colour, e.g. `"#6750A4"`.
 * @param opts    Optional: `dark`, `contrastLevel` (or legacy `contrast`), `variant`.
 * @returns `{ "--md-sys-color-primary": "#…", … }` (49 roles).
 */
export function schemeFromSeed(seedHex: string, opts: SchemeOptions = {}): ColorRoleMap {
  const { seed, variant, contrast, mode } = request(seedHex, opts);
  const wasm = materialWasm();
  const words = wasm.schemeFromSeed(seed, variant, contrast, mode);
  const byName = new Map(wasm.roleNames.map((name, index) => [name, words[index]!]));
  const out: ColorRoleMap = {};
  for (const role of ROLES) {
    const argb = byName.get(role);
    if (argb === undefined) throw new Error(`Material WASM omitted the ${role} role`);
    out[`--md-sys-color-${kebab(role)}`] = hexFromArgb(argb);
  }
  return out;
}

/** The seed best suited to a theme, from RGBA8 pixels (`ImageData.data`); alpha < 255 is ignored. */
export function themeFromImage(rgba: Uint8Array | Uint8ClampedArray): string {
  return hexFromArgb(materialWasm().themeFromImage(rgba));
}

/** Serialise a role map to CSS custom-property declarations. */
function declarations(vars: ColorRoleMap, indent = "  "): string {
  return Object.entries(vars)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join("\n");
}

/** Options for {@link cssFromSeed}: scheme options plus the selectors each mode lands on. */
export interface CssFromSeedOptions extends SchemeOptions {
  /** Selector receiving the light roles (default `:root`). */
  lightSelector?: string;
  /** Selector receiving the dark roles (default `:root[data-theme="dark"]`). */
  darkSelector?: string;
}

/**
 * Full stylesheet text: system light/dark by default, with explicit
 * `data-theme="light"` and `data-theme="dark"` overrides on `:root`,
 * ready to inline into a `<style>` for SSR or static theming. Apps whose mode
 * switch uses other selectors (e.g. a dark-by-default `:root, .dark` and a
 * `.light` class) pass `lightSelector` / `darkSelector`.
 */
export function cssFromSeed(seedHex: string, opts: CssFromSeedOptions = {}): string {
  const { lightSelector = ":root", darkSelector = ':root[data-theme="dark"]', ...scheme } = opts;
  const light = schemeFromSeed(seedHex, { ...scheme, dark: false });
  const dark = schemeFromSeed(seedHex, { ...scheme, dark: true });
  if (lightSelector === ":root" && darkSelector === ':root[data-theme="dark"]') {
    return (
      `:root {\n  color-scheme: light dark;\n${declarations(light)}\n}\n\n` +
      `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n${declarations(dark, "    ")}\n  }\n}\n\n` +
      `:root[data-theme="light"] {\n  color-scheme: light;\n}\n\n` +
      `${darkSelector} {\n  color-scheme: dark;\n${declarations(dark)}\n}\n`
    );
  }
  return (
    `${lightSelector} {\n  color-scheme: light;\n${declarations(light)}\n}\n\n` +
    `${darkSelector} {\n  color-scheme: dark;\n${declarations(dark)}\n}\n`
  );
}

/** Options for {@link applyDynamicColor}. */
export interface ApplyOptions extends SchemeOptions {
  /** Element whose inline style receives the roles (default `<html>`). */
  target?: HTMLElement | null;
}

/**
 * Every custom property the engine's scheme sheet sets for one mode: the 49
 * `--md-sys-color-*` roles plus the extended `--md-ext-color-*` success and
 * warning roles.
 */
export function dynamicColorProperties(seedHex: string, opts: SchemeOptions = {}): ColorRoleMap {
  const { seed, variant, contrast, mode } = request(seedHex, opts);
  const sheet = materialWasm().applyDynamicColor(seed, variant, contrast, mode);
  return Object.fromEntries(
    [...sheet.matchAll(/^\s*(--md-(?:sys|ext)-color-[a-z-]+):\s*(#[\da-f]{6});$/gm)].map(match => [
      match[1]!,
      match[2]!,
    ]),
  );
}

/**
 * Apply a seed's roles for one mode directly onto an element's inline style
 * (overriding any stylesheet `:root` values). Browser-only; a no-op in SSR.
 */
export function applyDynamicColor(seedHex: string, opts: ApplyOptions = {}): void {
  const target = opts.target ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!target) return;
  const vars = dynamicColorProperties(seedHex, opts);
  for (const [k, v] of Object.entries(vars)) target.style.setProperty(k, v);
}

/** Remove every `--md-sys-color-*` and `--md-ext-color-*` property this module may have set inline. */
export function clearDynamicColor(target?: HTMLElement | null): void {
  const el = target ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return;
  const names = Array.from(el.style).filter(name => /^--md-(?:sys|ext)-color-/.test(name));
  for (const name of names) el.style.removeProperty(name);
}

// ---------------------------------------------------------------------------
// Fusion CSS exports (shadcn/ui + Tailwind v4 + M3)
// ---------------------------------------------------------------------------

/**
 * Mapping from semantic UI-system token name to the M3 `--md-sys-color-*`
 * role it aliases. Shared by `exportShadcnAliases` and `exportTailwindTheme`.
 * In exact lockstep with Rust `crates/aphrody-m3-tokens/src/color.rs:FUSION_ALIAS_MAP`.
 */
export const FUSION_ALIAS_MAP = [
  ["background", "surface"],
  ["foreground", "on-surface"],
  ["card", "surface-container-low"],
  ["card-foreground", "on-surface"],
  ["popover", "surface-container"],
  ["popover-foreground", "on-surface"],
  ["primary", "primary"],
  ["primary-foreground", "on-primary"],
  ["secondary", "secondary-container"],
  ["secondary-foreground", "on-secondary-container"],
  ["muted", "surface-variant"],
  ["muted-foreground", "on-surface-variant"],
  ["accent", "tertiary-container"],
  ["accent-foreground", "on-tertiary-container"],
  ["destructive", "error"],
  ["destructive-foreground", "on-error"],
  ["border", "outline-variant"],
  ["input", "outline-variant"],
  ["ring", "primary"],
] as const;

/** Alias for backward compatibility */
export const ALIASES = FUSION_ALIAS_MAP;

/**
 * Emits a shadcn/ui semantic-token `:root` block aliasing shadcn variables to
 * the M3 system colors produced by `cssFromSeed`. Pure `var()` references.
 */
export function exportShadcnAliases(): string {
  let out = ":root {\n";
  for (const [name, role] of FUSION_ALIAS_MAP) {
    out += `  --${name}: var(--md-sys-color-${role});\n`;
  }
  out += "}\n";
  return out;
}

/**
 * Emits a Tailwind v4 `@theme inline { ... }` block mapping Tailwind's
 * `--color-*` design tokens to the M3 system colors.
 */
export function exportTailwindTheme(): string {
  let out = "@theme inline {\n";
  for (const [name, role] of FUSION_ALIAS_MAP) {
    out += `  --color-${name}: var(--md-sys-color-${role});\n`;
  }
  out += "}\n";
  return out;
}

/**
 * Emits the complete fusion stylesheet: the M3 system colors (`cssFromSeed`)
 * followed by the shadcn/ui alias block (`exportShadcnAliases`) and the
 * Tailwind v4 `@theme inline` block (`exportTailwindTheme`).
 */
export function exportFusionCss(seedHex: string, opts: CssFromSeedOptions = {}): string {
  const m3Css = cssFromSeed(seedHex, opts);
  const shadcn = exportShadcnAliases();
  const tailwind = exportTailwindTheme();
  return `${m3Css}\n${shadcn}\n${tailwind}`;
}
