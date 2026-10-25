// SPDX-License-Identifier: Apache-2.0
// Reference fixture for the Content and Fidelity variants of crates/aphrody-m3-tokens (temperature
// and dislike analyses), computed by @material/material-color-utilities: every role, both
// modes, contrast -1, 0, 0.5 and 1. `cargo test -p aphrody-m3-tokens --test mcu_fidelity`
// compares against it.
//
//   bun run fixture:mcu-fidelity

import {
  DynamicScheme,
  Hct,
  MaterialDynamicColors,
  SchemeContent,
  SchemeFidelity,
  type DynamicColor,
} from "@material/material-color-utilities";
import { join } from "node:path";

const OUT = join(import.meta.dir, "../../../../crates/aphrody-m3-tokens/tests/fixtures/mcu-fidelity.json");

// Creator site, pet, plus seeds covering the dislike branch (dark yellow-green), warm, cool,
// near-grey and very light colours.
const SEEDS = [
  0xff951ae2, 0xff8c6c88, 0xff6b8e23, 0xff556b2f, 0xffce422b, 0xff1a73e8, 0xfff59e0b, 0xff808080, 0xffe6e6c8,
];
const ROLES = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "inversePrimary",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "surfaceTint",
  "outline",
  "outlineVariant",
  "inverseSurface",
  "inverseOnSurface",
  "shadow",
  "scrim",
  "primaryFixed",
  "primaryFixedDim",
  "onPrimaryFixed",
  "onPrimaryFixedVariant",
  "secondaryFixed",
  "secondaryFixedDim",
  "onSecondaryFixed",
  "onSecondaryFixedVariant",
  "tertiaryFixed",
  "tertiaryFixedDim",
  "onTertiaryFixed",
  "onTertiaryFixedVariant",
  "primaryPaletteKeyColor",
  "secondaryPaletteKeyColor",
  "tertiaryPaletteKeyColor",
  "neutralPaletteKeyColor",
  "neutralVariantPaletteKeyColor",
] as const;
const colors = MaterialDynamicColors as unknown as Record<string, DynamicColor>;
const VARIANTS: [string, new (h: Hct, dark: boolean, level: number) => DynamicScheme][] = [
  ["fidelity", SchemeFidelity],
  ["content", SchemeContent],
];

const schemes = [];
for (const seed of SEEDS) {
  for (const [variant, Scheme] of VARIANTS) {
    for (const contrast of [-1, 0, 0.5, 1]) {
      for (const dark of [false, true]) {
        const scheme = new Scheme(Hct.fromInt(seed), dark, contrast);
        const roles = Object.fromEntries(ROLES.map(r => [r, colors[r]!.getArgb(scheme)]));
        schemes.push({ seed, variant, dark, contrast, roles });
      }
    }
  }
}

await Bun.write(OUT, `${JSON.stringify({ source: "@material/material-color-utilities 0.4.0", schemes })}\n`);
console.log(`wrote ${OUT}: ${schemes.length} schemes`);
