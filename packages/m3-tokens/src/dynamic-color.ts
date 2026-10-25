// -----------------------------------------------------------------------------
// @aphrody/m3-tokens — dynamic-color
// -----------------------------------------------------------------------------
// Runtime "Material You" dynamic colour: derive the full set of M3
// `--md-sys-color-*` roles from ANY single seed colour, for light and dark, and
// apply them live. This is the signature Material 3 capability — a host app can
// re-theme every `<md-*>` element (and every `@aphrody/m3-react` wrapper) from
// one colour, with no rebuild — that MUI has no native equivalent for.
//
// Built on @material/material-color-utilities (7 scheme variants: tonalSpot,
// content, fidelity, expressive, vibrant, neutral, monochrome).
// Pure functions are environment-agnostic and unit-testable under bun;
// only `applyDynamicColor` touches the DOM.
// -----------------------------------------------------------------------------

import {
  argbFromHex,
  hexFromArgb,
  Hct,
  SchemeTonalSpot,
  SchemeContent,
  SchemeFidelity,
  SchemeExpressive,
  SchemeVibrant,
  SchemeNeutral,
  SchemeMonochrome,
  MaterialDynamicColors,
  type DynamicColor,
  type DynamicScheme,
} from "@material/material-color-utilities";
import { ROLES } from "./native-theme";

export { ROLES };

export { argbFromHex, hexFromArgb, Hct, MaterialDynamicColors, type DynamicColor, type DynamicScheme };

// ---------------------------------------------------------------------------
// Variant type
// ---------------------------------------------------------------------------

/**
 * MCU colour scheme variants, exposed as a string union for ergonomic use.
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
 */
export type SchemeVariant = "tonalSpot" | "content" | "fidelity" | "expressive" | "vibrant" | "neutral" | "monochrome";

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
   * MCU colour scheme variant (default: `"tonalSpot"`).
   * All variants produce the same ~47 `--md-sys-color-*` roles; only the
   * palette relationships and chroma differ.
   */
  variant?: SchemeVariant;
}

/** A map of `--md-sys-color-*` custom-property names to hex colours. */
export type ColorRoleMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const dynamicColors = MaterialDynamicColors as unknown as Record<string, DynamicColor | undefined>;

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

/** Normalize a CSS hex seed, rejecting malformed colours before calling MCU. */
export function normalizeSeedHex(seed: string): string {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(seed.trim());
  if (!match) throw new TypeError(`Invalid M3 seed color: ${seed}`);
  const digits = match[1]!;
  return `#${(digits.length === 3 ? [...digits].map(digit => digit + digit).join("") : digits).toLowerCase()}`;
}

/** Build the MCU DynamicScheme for the requested variant. */
function buildScheme(hct: Hct, isDark: boolean, contrastLevel: number, variant: SchemeVariant): DynamicScheme {
  switch (variant) {
    case "content":
      return new SchemeContent(hct, isDark, contrastLevel);
    case "fidelity":
      return new SchemeFidelity(hct, isDark, contrastLevel);
    case "expressive":
      return new SchemeExpressive(hct, isDark, contrastLevel);
    case "vibrant":
      return new SchemeVibrant(hct, isDark, contrastLevel);
    case "neutral":
      return new SchemeNeutral(hct, isDark, contrastLevel);
    case "monochrome":
      return new SchemeMonochrome(hct, isDark, contrastLevel);
    case "tonalSpot":
      return new SchemeTonalSpot(hct, isDark, contrastLevel);
    default:
      throw new TypeError(`Unknown M3 scheme variant: ${variant}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve every M3 colour role for one mode from a seed colour.
 *
 * Backwards-compatible: calling `schemeFromSeed(hex)` or
 * `schemeFromSeed(hex, { dark, contrast })` still works exactly as before.
 *
 * @param seedHex Source colour, e.g. `"#6750A4"`.
 * @param opts    Optional: `dark`, `contrastLevel` (or legacy `contrast`), `variant`.
 * @returns `{ "--md-sys-color-primary": "#…", … }` (~47 roles).
 */
export function schemeFromSeed(seedHex: string, opts: SchemeOptions = {}): ColorRoleMap {
  const dark = opts.dark ?? false;
  const contrastLevel = resolveContrast(opts);
  const variant = opts.variant ?? "tonalSpot";

  const hct = Hct.fromInt(argbFromHex(normalizeSeedHex(seedHex)));
  const scheme = buildScheme(hct, dark, contrastLevel, variant);

  const out: ColorRoleMap = {};
  for (const role of ROLES) {
    const dynamicColor = dynamicColors[role];
    if (!dynamicColor) continue;
    out[`--md-sys-color-${kebab(role)}`] = hexFromArgb(dynamicColor.getArgb(scheme));
  }
  return out;
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
 * Apply a seed's roles for one mode directly onto an element's inline style
 * (overriding any stylesheet `:root` values). Browser-only; a no-op in SSR.
 */
export function applyDynamicColor(seedHex: string, opts: ApplyOptions = {}): void {
  const target = opts.target ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!target) return;
  const vars = schemeFromSeed(seedHex, opts);
  for (const [k, v] of Object.entries(vars)) target.style.setProperty(k, v);
}

/** Remove every `--md-sys-color-*` role this module may have set inline. */
export function clearDynamicColor(target?: HTMLElement | null): void {
  const el = target ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return;
  for (const role of ROLES) el.style.removeProperty(`--md-sys-color-${kebab(role)}`);
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
