/**
 * Theme Type Definitions
 *
 * A theme is a seed for the canonical Material 3 engine (crates/aphrody-m3-tokens, loaded in the
 * browser through @aphrody/m3-tokens/wasm), never a hand-written palette: the engine derives every
 * light and dark role from the seed, the scheme variant and the contrast level.
 */

/** Scheme variants of the engine, by their native names (`MaterialWasm.variantNames`). */
export type SchemeVariant =
  | "tonal-spot"
  | "vibrant"
  | "expressive"
  | "neutral"
  | "monochrome"
  | "content"
  | "fidelity"
  | "rainbow"
  | "fruit-salad";

/** What the engine needs to derive a scheme. */
export interface SchemeSeed {
  /** Seed colour, `#rrggbb`. */
  seed: string;
  variant: SchemeVariant;
  /** M3 contrast level: 0 standard, 0.5 medium, 1 high. */
  contrastLevel: number;
}

export type BuiltInThemeId =
  | "bun-os"
  | "mission-control"
  | "obsidian"
  | "cobalt"
  | "slate-dusk"
  | "forest-mist"
  | "rose-quartz"
  | "ocean-fog"
  | "high-contrast";

export type ThemeId = BuiltInThemeId | "custom";

export interface Theme extends SchemeSeed {
  id: ThemeId;
  name: string;
  description: string;
}

/** Light or dark scheme; `system` follows `prefers-color-scheme`. */
export type ThemeMode = "system" | "light" | "dark";

/** The colour custom properties of one resolved scheme (`--md-sys-color-*`, `--md-ext-color-*`). */
export type SchemeProperties = Record<string, string>;

export const THEME_STORAGE_KEY = "bunos-wsl-theme";
export const CUSTOM_THEME_STORAGE_KEY = "bunos-wsl-custom-theme";
export const THEME_MODE_STORAGE_KEY = "bunos-wsl-theme-mode";
export const SCHEME_CACHE_STORAGE_KEY = "bunos-wsl-scheme";
