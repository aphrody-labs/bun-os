// SPDX-License-Identifier: Apache-2.0
// -----------------------------------------------------------------------------
// lib/theme.ts — MUI theme (Material 2, `createTheme`) to M3 `--md-sys-*` CSS.
// -----------------------------------------------------------------------------
// The theme half of the MUI -> Material 3 migration: it reads a MUI theme object
// and emits the token block a migrated app loads next to @aphrody/m3-tokens.
//
// The roles MUI has no equivalent for (tertiary, *-container, surface-variant,
// outline, inverse-*, tonal surfaces) come from the canonical engine through
// `@aphrody/m3-tokens/dynamic-color`, seeded with the theme's primary colour.
// Colours the MUI theme spells out explicitly are carried over unchanged: they
// are the app's own design input, not values this tool picks.
//
// Fidelity notes M2 -> M3:
//  * MUI `primary.main` != the M3 "primary" tone; the engine snaps the hue onto
//    a tonal palette. Explicit MUI colours override the derived roles.
//  * MUI handles light/dark via two distinct themes; M3 derives both from one
//    source. The source of each mode is honoured when provided.
// -----------------------------------------------------------------------------

import { schemeFromSeed } from "@aphrody/m3-tokens/dynamic-color";
import { materialWasm } from "@aphrody/m3-tokens/wasm";

export interface MuiColor {
  main?: string;
  contrastText?: string;
}

export interface MuiPalette {
  mode?: "light" | "dark";
  primary?: MuiColor;
  secondary?: MuiColor;
  tertiary?: MuiColor;
  error?: MuiColor;
  background?: { default?: string; paper?: string };
  text?: { primary?: string; secondary?: string };
  divider?: string;
}

export interface MuiTypographyVariant {
  fontFamily?: string;
  fontSize?: number | string;
  lineHeight?: number | string;
  fontWeight?: number | string;
  letterSpacing?: number | string;
}

export interface MuiTypography {
  fontFamily?: string;
  [variant: string]: MuiTypographyVariant | string | undefined;
}

export interface MuiShape {
  borderRadius?: number | string;
}

export interface MuiTheme {
  palette?: MuiPalette;
  typography?: MuiTypography;
  shape?: MuiShape;
  colorSchemes?: { dark?: MuiTheme };
}

export interface ThemeToTokensOptions {
  /** Explicit dark theme (MUI v6 `colorSchemes.dark`, or a 2nd createTheme). */
  darkTheme?: MuiTheme | null;
}

export interface ThemeToTokensResult {
  css: string;
  lightRoles: Record<string, string>;
  darkRoles: Record<string, string>;
  typescale: Record<string, string>;
  shape: Record<string, string>;
}

// design:content — reference MUI light theme (MUI default primary): the input used when no theme file is given.
export const MUI_DEFAULT_THEME: MuiTheme = {
  palette: {
    mode: "light",
    primary: { main: "#1976d2", contrastText: "#ffffff" },
    secondary: { main: "#9c27b0" },
    error: { main: "#d32f2f" },
    background: { default: "#fafafa", paper: "#ffffff" },
    text: { primary: "#212121", secondary: "#757575" },
    divider: "#e0e0e0",
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: 96, fontWeight: 300, lineHeight: 1.167, letterSpacing: -1.5 },
    h6: { fontSize: 20, fontWeight: 500, lineHeight: 1.6 },
    body1: { fontSize: 16, fontWeight: 400, lineHeight: 1.5 },
    button: { fontSize: 14, fontWeight: 500, lineHeight: 1.75 },
  },
  shape: { borderRadius: 4 },
};

// design:content — reference MUI dark theme (MUI default dark primary).
export const MUI_DEFAULT_DARK_THEME: MuiTheme = {
  palette: {
    mode: "dark",
    primary: { main: "#90caf9" },
    secondary: { main: "#ce93d8" },
    error: { main: "#f44336" },
    background: { default: "#121212", paper: "#1e1e1e" },
    text: { primary: "#ffffff", secondary: "#b0b0b0" },
    divider: "#373737",
  },
};

// MUI typography.variant -> M3 typescale <scale>-<size>.
const MUI_VARIANT_TO_TYPESCALE: Record<string, string> = {
  h1: "display-large",
  h2: "display-medium",
  h3: "display-small",
  h4: "headline-large",
  h5: "headline-medium",
  h6: "headline-small",
  subtitle1: "title-medium",
  subtitle2: "title-small",
  body1: "body-large",
  body2: "body-medium",
  button: "label-large",
  caption: "body-small",
  overline: "label-small",
};

// The M3 corner scale in engine order (`aphrody_m3_tokens::shape::ALL`); radii come from the engine.
const M3_CORNERS = [
  "corner-none",
  "corner-extra-small",
  "corner-small",
  "corner-medium",
  "corner-large",
  "corner-large-increased",
  "corner-extra-large",
  "corner-extra-large-increased",
  "corner-extra-extra-large",
  "corner-full",
] as const;

/** Normalise a hex colour (#rgb / #rrggbb) to #rrggbb, or null. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let h = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(h))
    h = h
      .split("")
      .map(c => c + c)
      .join("");
  if (/^[0-9a-fA-F]{6}$/.test(h)) return "#" + h.toLowerCase();
  return null;
}

/** Engine roles seeded with `source`, then the colours `palette` spells out explicitly. */
function buildScheme(source: string, palette: MuiPalette, mode: "light" | "dark"): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const [name, value] of Object.entries(schemeFromSeed(source, { dark: mode === "dark" })))
    roles[name.slice("--md-sys-color-".length)] = value;

  const carry = (token: string, value: unknown) => {
    const hex = normalizeHex(value);
    if (hex) roles[token] = hex;
  };
  carry("primary", palette.primary?.main);
  carry("on-primary", palette.primary?.contrastText);
  carry("secondary", palette.secondary?.main);
  carry("on-secondary", palette.secondary?.contrastText);
  carry("tertiary", palette.tertiary?.main);
  carry("on-tertiary", palette.tertiary?.contrastText);
  carry("error", palette.error?.main);
  carry("on-error", palette.error?.contrastText);
  carry("background", palette.background?.default);
  carry("surface", palette.background?.default);
  carry("surface-container", palette.background?.paper);
  carry("on-background", palette.text?.primary);
  carry("on-surface", palette.text?.primary);
  carry("on-surface-variant", palette.text?.secondary);
  carry("outline-variant", palette.divider);
  return roles;
}

function cssLen(x: number | string): string {
  return typeof x === "number" ? `${x}px` : String(x);
}

function cssLineHeight(lh: number | string, fontSize?: number | string): string {
  if (typeof lh === "number" && lh < 4) {
    if (typeof fontSize === "number") return `${(lh * fontSize).toFixed(2)}px`;
    return `${lh}em`;
  }
  return cssLen(lh);
}

function buildTypescale(typography?: MuiTypography): Record<string, string> {
  if (!typography) return {};
  const out: Record<string, string> = {};
  const globalFamily = typography.fontFamily;
  for (const [variant, token] of Object.entries(MUI_VARIANT_TO_TYPESCALE)) {
    const v = typography[variant] as MuiTypographyVariant | undefined;
    const family = v?.fontFamily || globalFamily;
    if (family) out[`${token}-font`] = family;
    if (v?.fontSize != null) out[`${token}-size`] = cssLen(v.fontSize);
    if (v?.lineHeight != null) out[`${token}-line-height`] = cssLineHeight(v.lineHeight, v.fontSize);
    if (v?.fontWeight != null) out[`${token}-weight`] = String(v.fontWeight);
    if (v?.letterSpacing != null) out[`${token}-tracking`] = cssLen(v.letterSpacing);
  }
  return out;
}

/** Rescale the M3 corner family by the MUI radius ratio (MUI default borderRadius is 4). */
function buildShape(shape?: MuiShape): Record<string, string> {
  if (!shape || shape.borderRadius == null) return {};
  const r = typeof shape.borderRadius === "number" ? shape.borderRadius : parseFloat(shape.borderRadius);
  if (!isFinite(r)) return {};
  const ratio = r / 4;
  const wasm = materialWasm();
  const out: Record<string, string> = {};
  M3_CORNERS.forEach((corner, index) => {
    if (corner === "corner-full") return; // pill: leave untouched
    out[corner] = `${Math.round(wasm.shapeRadius(index) * ratio)}px`;
  });
  return out;
}

function emitColorBlock(selector: string, roles: Record<string, string>): string {
  const lines = Object.entries(roles).map(([t, v]) => `  --md-sys-color-${t}: ${v};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

function emitMiscBlock(selector: string, typescale: Record<string, string>, shape: Record<string, string>): string {
  const lines = [
    ...Object.entries(typescale).map(([t, v]) => `  --md-sys-typescale-${t}: ${v};`),
    ...Object.entries(shape).map(([t, v]) => `  --md-sys-shape-${t}: ${v};`),
  ];
  if (lines.length === 0) return "";
  return `${selector} {\n${lines.join("\n")}\n}`;
}

function indent(block: string): string {
  return block
    .split("\n")
    .map(l => "  " + l)
    .join("\n");
}

/**
 * Convert a MUI theme (palette / typography / shape) into a block of M3
 * `--md-sys-*` token CSS. When a separate dark theme is supplied it feeds the
 * `@media (prefers-color-scheme: dark)` block; otherwise dark is derived from
 * the same source.
 */
export function muiThemeToTokens(lightTheme: MuiTheme, options: ThemeToTokensOptions = {}): ThemeToTokensResult {
  const lightPalette: MuiPalette = { ...lightTheme.palette, mode: "light" };
  const lightSource = normalizeHex(lightPalette.primary?.main) ?? MUI_DEFAULT_THEME.palette!.primary!.main!;
  const lightRoles = buildScheme(lightSource, lightPalette, "light");
  const typescale = buildTypescale(lightTheme.typography);
  const shape = buildShape(lightTheme.shape);

  const darkTheme = options.darkTheme || lightTheme.colorSchemes?.dark || null;
  // Without a dark theme, dark derives from the light source with no explicit colours carried over.
  const darkPalette: MuiPalette = darkTheme ? { ...darkTheme.palette, mode: "dark" } : { mode: "dark" };
  const darkRoles = buildScheme(normalizeHex(darkPalette.primary?.main) ?? lightSource, darkPalette, "dark");

  const parts: string[] = [];
  parts.push(`/* Generated by @aphrody/m3-codemods theme migration */`);
  parts.push(`:root {\n  color-scheme: light dark;\n}`);
  const misc = emitMiscBlock(":root", typescale, shape);
  parts.push(emitColorBlock(":root", lightRoles));
  if (misc) parts.push(misc);
  parts.push(
    `@media (prefers-color-scheme: dark) {\n${indent(emitColorBlock(":root:not([data-theme])", darkRoles))}\n}`,
  );
  parts.push(`:root[data-theme="light"] {\n  color-scheme: light;\n}`);
  parts.push(`:root[data-theme="dark"] {\n  color-scheme: dark;\n}`);
  parts.push(emitColorBlock(':root[data-theme="dark"]', darkRoles));

  return { css: parts.join("\n\n"), lightRoles, darkRoles, typescale, shape };
}
