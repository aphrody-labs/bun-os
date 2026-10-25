// SPDX-License-Identifier: Apache-2.0
// The sheets come from Rust (crates/aphrody-m3-tokens/src/sheets.rs through @aphrody/bun's m3Css).
// These tests hold them to the reference implementation, @material/material-color-utilities, and
// check the committed files are current.

import { describe, expect, test } from "bun:test";
import {
  customColor,
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeTonalSpot,
  SchemeVibrant,
  TonalPalette,
  Variant,
  type DynamicColor,
} from "@material/material-color-utilities";
import { join } from "node:path";

// `@aphrody/bun` opens the bun_rs native library when it is imported. Without the library these
// suites are skipped with the loader's reason; build or link it as described in
// docs/guides/NATIVE.md (`bun scripts/native.ts link --apply`).
// The library opens lazily, so the probe loads it: a missing or unaccepted artifact skips here, not mid-suite.
const native = await import("@aphrody/bun")
  .then(module => {
    if (!module.isAphrodyFfiAvailable()) throw new Error("aphrody-ffi native library not found");
    return module;
  })
  .catch((error: unknown) => error as Error);
const unavailable =
  native instanceof Error
    ? `bun_rs native library unavailable (${String(native.message ?? native).split("\n")[0]}); see docs/guides/NATIVE.md`
    : "";
const skip = unavailable !== "";
if (skip) console.warn(`[@aphrody/m3-theme] native suites skipped: ${unavailable}`);
const named = (title: string) => (skip ? `${title} [skipped: ${unavailable}]` : title);
const m3Css = (config: Parameters<typeof import("@aphrody/bun").m3Css>[0]) =>
  (native as Exclude<typeof native, Error>).m3Css(config);

const dir = join(import.meta.dir, "..");
const colors = MaterialDynamicColors as unknown as Record<string, DynamicColor | undefined>;
const camel = (kebab: string) => kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `--name: value` pairs of the block that starts right after `marker`. */
function vars(css: string, marker: string): Map<string, string> {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return new Map([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
}

/** Every `--md-sys-color-*` of a block equals the reference scheme; returns how many were checked. */
function expectScheme(block: Map<string, string>, scheme: DynamicScheme): number {
  let checked = 0;
  for (const [name, value] of block) {
    if (!name.startsWith("--md-sys-color-")) continue;
    const color = colors[camel(name.slice("--md-sys-color-".length))];
    expect(color, name).toBeDefined();
    expect(`${name}: ${value}`).toBe(`${name}: ${hexFromArgb(color!.getArgb(scheme))}`);
    checked++;
  }
  return checked;
}

function expectExtended(block: Map<string, string>, source: number, dark: boolean) {
  for (const [name, seed] of [
    ["success", 0xff16a34a],
    ["warning", 0xfff59e0b],
  ] as const) {
    const group = customColor(source, { name, value: seed, blend: true });
    const tones = dark ? group.dark : group.light;
    expect(block.get(`--md-ext-color-${name}`)).toBe(hexFromArgb(tones.color));
    expect(block.get(`--md-ext-color-on-${name}-container`)).toBe(hexFromArgb(tones.onColorContainer));
  }
}

describe.skipIf(skip)(named("sheets match material-color-utilities"), () => {
  test("tokens.css: tonal spot from the baseline seed, light and dark", () => {
    const css = m3Css({ sheet: "tokens" });
    const source = Hct.fromInt(0xff6750a4);
    expect(expectScheme(vars(css, "\n:root {"), new SchemeTonalSpot(source, false, 0))).toBe(49);
    expect(expectScheme(vars(css, ":root.dark,"), new SchemeTonalSpot(source, true, 0))).toBe(49);
  });

  test("scheme sheet: any seed, variant and contrast", () => {
    for (const [seed, dark, contrast] of [
      ["#1a73e8", false, 0.5],
      ["#ce422b", true, 1],
      ["#16a34a", false, -1],
    ] as const) {
      const css = m3Css({
        sheet: "scheme",
        seed,
        variant: "vibrant",
        dark,
        contrast,
      });
      const argb = Number.parseInt(seed.slice(1), 16) | 0xff000000;
      const block = vars(css, ":root {");
      expect(expectScheme(block, new SchemeVibrant(Hct.fromInt(argb >>> 0), dark, contrast))).toBe(49);
      expectExtended(block, argb >>> 0, dark);
    }
  });

  test("spaceui.css: every theme", () => {
    const css = m3Css({ sheet: "spaceui" });
    const themes = [
      ["dark", "#1c1d26", true],
      ["light", "#f2f2f4", false],
      ["midnight", "#0f0f1a", true],
      ["noir", "#080808", true],
      ["slate", "#151619", true],
      ["nord", "#191d24", true],
      ["mocha", "#1e1915", true],
    ] as const;
    for (const [name, neutralHex, dark] of themes) {
      const accent = Hct.fromInt(0xff2499ff);
      const neutral = Hct.fromInt((Number.parseInt(neutralHex.slice(1), 16) | 0xff000000) >>> 0);
      const base = new SchemeTonalSpot(accent, dark, 0);
      const chroma = neutral.chroma < 1 ? 0 : Math.min(neutral.chroma, 12);
      const scheme = new DynamicScheme({
        sourceColorHct: accent,
        variant: Variant.TONAL_SPOT,
        contrastLevel: 0,
        isDark: dark,
        primaryPalette: TonalPalette.fromHct(accent),
        secondaryPalette: base.secondaryPalette,
        tertiaryPalette: base.tertiaryPalette,
        neutralPalette: TonalPalette.fromHueAndChroma(neutral.hue, chroma),
        neutralVariantPalette: TonalPalette.fromHueAndChroma(neutral.hue, chroma === 0 ? 0 : chroma + 4),
        errorPalette: base.errorPalette,
      });
      const block = vars(css, `/* SpaceUI ${name} */`);
      expect(expectScheme(block, scheme)).toBe(49);
      expectExtended(block, 0xff2499ff, dark);
    }
  });

  test("tailwind.css: baseline extended roles", () => {
    const css = m3Css({ sheet: "tailwind" });
    expectExtended(vars(css, ":where(:root) {"), 0xff6750a4, false);
    expectExtended(vars(css, ":where(:root.dark, .dark) {"), 0xff6750a4, true);
  });
});

describe.skipIf(skip)(named("committed sheets are current (bun run generate)"), () => {
  for (const sheet of ["tokens", "tailwind", "spaceui"] as const) {
    test(`${sheet}.css`, async () => {
      const onDisk = await Bun.file(join(dir, `${sheet}.css`)).text();
      expect(normalize(onDisk)).toBe(normalize(m3Css({ sheet })));
    });
  }
});

/** oxfmt may rewrap lines: compare token streams, not layout. */
function normalize(css: string): string {
  return css.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/,\)/g, ")").trim();
}
