// SPDX-License-Identifier: Apache-2.0
// Reference fixture for the Rust colour science in crates/ui/aphrody-m3-tokens: HCT conversions,
// the HCT solver, tonal palettes, dynamic schemes (2021 spec, every provided variant, four
// contrast levels), the SpaceUI schemes and custom colours, all computed by
// @material/material-color-utilities. `cargo test -p aphrody-m3-tokens` compares against it.
//
//   bun run fixture:mcu

import {
  customColor,
  DynamicScheme,
  Hct,
  MaterialDynamicColors,
  SchemeExpressive,
  SchemeFruitSalad,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
  TonalPalette,
  Variant,
  ViewingConditions,
  type DynamicColor,
} from "@material/material-color-utilities";
import { join } from "node:path";

const OUT = join(import.meta.dir, "../../../../crates/aphrody-m3-tokens/tests/fixtures/mcu.json");

/** Deterministic colours: xorshift32 plus the usual suspects. */
function sampleColors(count: number): number[] {
  let state = 0x9e3779b9;
  const out = [0xff000000, 0xffffffff, 0xff808080, 0xffff0000, 0xff00ff00, 0xff0000ff, 0xff6750a4, 0xff1a73e8];
  while (out.length < count) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out.push((0xff000000 | ((state >>> 0) & 0xffffff)) >>> 0);
  }
  return out;
}

const SEEDS = [0xff6750a4, 0xff1a73e8, 0xff2499ff, 0xffce422b, 0xff16a34a, 0xfff59e0b, 0xffe91e63, 0xff795548];
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
const roles = (scheme: DynamicScheme) => Object.fromEntries(ROLES.map(r => [r, colors[r]!.getArgb(scheme)]));

const VARIANTS: [string, new (h: Hct, dark: boolean, level: number) => DynamicScheme][] = [
  ["monochrome", SchemeMonochrome],
  ["neutral", SchemeNeutral],
  ["tonal-spot", SchemeTonalSpot],
  ["vibrant", SchemeVibrant],
  ["expressive", SchemeExpressive],
  ["rainbow", SchemeRainbow],
  ["fruit-salad", SchemeFruitSalad],
];

const schemes = [];
for (const seed of SEEDS) {
  for (const [variant, Scheme] of VARIANTS) {
    const levels = variant === "tonal-spot" ? [-1, 0, 0.5, 1] : [0];
    for (const contrast of levels) {
      for (const dark of [false, true]) {
        schemes.push({
          seed,
          variant,
          dark,
          contrast,
          roles: roles(new Scheme(Hct.fromInt(seed), dark, contrast)),
        });
      }
    }
  }
}

// SpaceUI themes (crates/aphrody-m3-tokens/src/spaceui.rs): accent palette from the accent itself,
// neutrals from the theme surface, tonal-spot relationships.
const SPACEUI = [
  [0xff2499ff, 0xff1c1d26, true],
  [0xff2499ff, 0xfff2f2f4, false],
  [0xff2499ff, 0xff0f0f1a, true],
  [0xff2499ff, 0xff080808, true],
  [0xff2499ff, 0xff151619, true],
  [0xff2499ff, 0xff191d24, true],
  [0xff2499ff, 0xff1e1915, true],
] as const;
const spaceui = SPACEUI.map(([accentArgb, neutralArgb, dark]) => {
  const accent = Hct.fromInt(accentArgb);
  const neutral = Hct.fromInt(neutralArgb);
  const base = new SchemeTonalSpot(accent, dark, 0);
  const neutralChroma = neutral.chroma < 1 ? 0 : Math.min(neutral.chroma, 12);
  const scheme = new DynamicScheme({
    sourceColorHct: accent,
    variant: Variant.TONAL_SPOT,
    contrastLevel: 0,
    isDark: dark,
    primaryPalette: TonalPalette.fromHct(accent),
    secondaryPalette: base.secondaryPalette,
    tertiaryPalette: base.tertiaryPalette,
    neutralPalette: TonalPalette.fromHueAndChroma(neutral.hue, neutralChroma),
    neutralVariantPalette: TonalPalette.fromHueAndChroma(neutral.hue, neutralChroma === 0 ? 0 : neutralChroma + 4),
    errorPalette: base.errorPalette,
  });
  return {
    accent: accentArgb,
    neutral: neutralArgb,
    dark,
    roles: roles(scheme),
  };
});

const solve = [];
for (let hue = 0; hue < 360; hue += 37) {
  for (const chroma of [0, 8, 16, 24, 36, 48, 84, 120, 200]) {
    for (const tone of [0, 1, 5, 10, 25, 40, 49.6, 50, 60, 80, 90, 95, 98, 99, 100]) {
      solve.push([hue, chroma, tone, Hct.from(hue, chroma, tone).toInt()]);
    }
  }
}

const palettes = [
  [282.0, 36.0],
  [110.0, 60.0],
  [25.0, 84.0],
  [210.0, 16.0],
  [0.0, 0.0],
  [340.0, 48.0],
].map(([hue, chroma]) => {
  const palette = TonalPalette.fromHueAndChroma(hue!, chroma!);
  return {
    hue,
    chroma,
    key: palette.keyColor.toInt(),
    tones: Array.from({ length: 101 }, (_, tone) => palette.tone(tone)),
  };
});

const custom = SEEDS.flatMap(source =>
  [0xff16a34a, 0xfff59e0b].flatMap(value =>
    [true, false].map(blend => {
      const group = customColor(source, { name: "x", value, blend });
      return {
        source,
        value,
        blend,
        harmonized: group.value,
        light: [group.light.color, group.light.onColor, group.light.colorContainer, group.light.onColorContainer],
        dark: [group.dark.color, group.dark.onColor, group.dark.colorContainer, group.dark.onColorContainer],
      };
    }),
  ),
);

const vc = ViewingConditions.DEFAULT;
const fixture = {
  source: "@material/material-color-utilities 0.4.0",
  viewing_conditions: {
    n: vc.n,
    aw: vc.aw,
    nbb: vc.nbb,
    c: vc.c,
    nc: vc.nc,
    fl: vc.fl,
    z: vc.z,
    rgb_d: vc.rgbD,
  },
  hct: sampleColors(256).map(argb => {
    const hct = Hct.fromInt(argb);
    return [argb, hct.hue, hct.chroma, hct.tone];
  }),
  solve,
  palettes,
  schemes,
  spaceui,
  custom,
};

await Bun.write(OUT, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${OUT}: ${schemes.length} schemes, ${solve.length} solver points, ${fixture.hct.length} colours`);
