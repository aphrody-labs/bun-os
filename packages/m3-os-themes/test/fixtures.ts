// SPDX-License-Identifier: Apache-2.0
// Rust ThemeExports (`bunos-design theme --seed S --variant V --contrast C`) recorded as test fixtures, so the tests
// exercise the emitters on real Rust colours without a native build.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nativeThemeVariant, parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";
import type { ActiveMode, ThemeInput } from "../src/types.ts";

/** Path of the recorded export for `seed` (`#rrggbb`), kebab-case `variant` and `contrast`. */
export function fixturePath(seed: string, variant = "tonal-spot", contrast = 0): string {
  return join(import.meta.dir, "fixtures", `theme-${seed.slice(1).toLowerCase()}-${variant}-${contrast}.json`);
}

/** A ThemeInput carrying the recorded Rust export. */
export function themed(
  name: string,
  seed: string,
  variant = "tonal-spot",
  contrast = 0,
  mode: ActiveMode = "auto",
): ThemeInput {
  const nativeTheme = parseNativeThemeExport(JSON.parse(readFileSync(fixturePath(seed, variant, contrast), "utf8")));
  return { name, seed, variant: nativeThemeVariant(nativeTheme), contrastLevel: contrast, nativeTheme, mode };
}
