// SPDX-License-Identifier: Apache-2.0
// The compiler's theme is the canonical engine's ThemeExport: compare it with the Rust goldens that
// crates/aphrody-m3-tokens pins bit-for-bit (tests/fixtures).
import { describe, expect, test } from "bun:test";
import { ROLES } from "@aphrody/m3-tokens/native-theme";
import type { SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";
import { generateTheme } from "./theme.ts";

const fixtures = new URL("../../../crates/aphrody-m3-tokens/tests/fixtures/", import.meta.url);

interface GoldenScheme {
  seed: number;
  variant: string;
  dark: boolean;
  contrast: number;
  roles: Record<string, number>;
}

const mcu = (await Bun.file(new URL("mcu.json", fixtures)).json()) as { schemes: GoldenScheme[] };
const pet = (await Bun.file(new URL("mcu-pet.json", fixtures)).json()) as {
  seed: string;
  variant: string;
  schemes: { contrast_level: number; light: Record<string, string>; dark: Record<string, string> }[];
};

const hex = (argb: number): string => `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
const camel = (name: string): SchemeVariant =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) as SchemeVariant;

describe("generateTheme", () => {
  test.each(pet.schemes.map(scheme => [scheme.contrast_level, scheme] as const))(
    "identity seed ThemeExport at contrast %d equals the Rust golden",
    (contrastLevel, golden) => {
      const theme = generateTheme(pet.seed, { contrastLevel });
      expect(theme.themeExport.seed).toBe(pet.seed);
      expect<string>(theme.themeExport.variant).toBe(pet.variant);
      expect(theme.themeExport.contrast_level).toBe(contrastLevel);
      expect<Record<string, string>>({ ...theme.themeExport.light }).toEqual(golden.light);
      expect<Record<string, string>>({ ...theme.themeExport.dark }).toEqual(golden.dark);
    },
  );

  test("every golden scheme variant, seed, mode and contrast level", () => {
    expect(mcu.schemes.length).toBeGreaterThan(0);
    for (const golden of mcu.schemes) {
      const theme = generateTheme(hex(golden.seed), { variant: camel(golden.variant), contrastLevel: golden.contrast });
      const roles = golden.dark ? theme.themeExport.dark : theme.themeExport.light;
      for (const role of ROLES)
        expect(`${golden.variant} ${role}: ${roles[role]}`).toBe(
          `${golden.variant} ${role}: ${hex(golden.roles[role]!)}`,
        );
    }
  });

  test("the stylesheet declares the ThemeExport roles for both modes", () => {
    const theme = generateTheme("#6750A4");
    const [light, dark] = theme.cssCustomProperties.split("@media (prefers-color-scheme: dark)");
    for (const [block, roles] of [
      [light!, theme.themeExport.light],
      [dark!, theme.themeExport.dark],
    ] as const) {
      for (const role of ROLES) {
        const name = role.replace(/([A-Z])/g, "-$1").toLowerCase();
        expect(block).toContain(`--md-sys-color-${name}: ${roles[role]};`);
      }
    }
  });

  test("normalizes short and unprefixed hex seeds", () => {
    expect(generateTheme("abc").seed).toBe("#aabbcc");
    expect(generateTheme("6750A4").seed).toBe("#6750a4");
  });

  test("rejects malformed seed colors", () => {
    expect(() => generateTheme("purple")).toThrow("Invalid M3 seed color: purple");
  });
});
