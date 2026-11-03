// SPDX-License-Identifier: Apache-2.0
//! Seed-to-theme step of the design compiler. The colours come from the canonical engine
//! (crates/aphrody-m3-tokens) through @aphrody/m3-tokens; this module computes no colour itself.

import { cssFromSeed, normalizeSeedHex, schemeFromSeed, type SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";
import { ROLES, parseNativeThemeExport, type NativeThemeExport } from "@aphrody/m3-tokens/native-theme";
import type { M3Theme } from "./types.ts";

/** Options of {@link generateTheme}: the scheme variant and contrast level of the ThemeExport. */
export interface ThemeOptions {
  /** Scheme variant (default `tonalSpot`). */
  variant?: SchemeVariant;
  /** Contrast level in `[-1, 1]` (default 0). */
  contrastLevel?: number;
  /** Dark-first stylesheet: the dark roles apply to `:root`, `:root[data-theme="light"]` opts back into light. */
  darkFirst?: boolean;
}

/** `tonalSpot` -> `tonal-spot`, the ThemeExport variant spelling. */
const kebab = (name: string): string => name.replace(/([A-Z])/g, "-$1").toLowerCase();

/** Resolve the ThemeExport of a seed colour and its light/dark stylesheet. */
export function generateTheme(seedHex: string, options: ThemeOptions = {}): M3Theme {
  const seed = normalizeSeedHex(seedHex);
  const variant = options.variant ?? "tonalSpot";
  const contrastLevel = options.contrastLevel ?? 0;
  const scheme = { variant, contrastLevel };
  const roles = (dark: boolean) => {
    const css = schemeFromSeed(seed, { ...scheme, dark });
    return Object.fromEntries(ROLES.map(role => [role, css[`--md-sys-color-${kebab(role)}`]]));
  };
  const themeExport: NativeThemeExport = parseNativeThemeExport({
    schema_version: 1,
    spec_version: "2021",
    seed,
    variant: kebab(variant),
    contrast_level: contrastLevel,
    light: roles(false),
    dark: roles(true),
  });
  const css = options.darkFirst
    ? cssFromSeed(seed, { ...scheme, lightSelector: ':root[data-theme="light"]', darkSelector: ":root" })
    : cssFromSeed(seed, scheme);
  return { seed, themeExport, cssCustomProperties: css };
}
