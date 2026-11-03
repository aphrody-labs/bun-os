// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { ROLES, schemeFromSeed } from "../src/dynamic-color.ts";
import { nativeThemeColorRoles, nativeThemeCss, parseNativeThemeExport } from "../src/native-theme.ts";
import { GOLDEN_PET } from "./golden.ts";

/** A ThemeExport document built from the Rust golden identity-seed schemes. */
function fixture(index = 1) {
  const golden = GOLDEN_PET.schemes[index]!;
  return {
    schema_version: 1,
    spec_version: "2021",
    seed: GOLDEN_PET.seed,
    variant: GOLDEN_PET.variant,
    contrast_level: golden.contrast_level,
    light: { ...golden.light },
    dark: { ...golden.dark },
  };
}

describe("native theme export adapter", () => {
  test("carries the golden ThemeExport unchanged, identical to the wasm engine", () => {
    for (let index = 0; index < GOLDEN_PET.schemes.length; index++) {
      const input = fixture(index);
      const theme = parseNativeThemeExport(input);
      input.light["primary"] = "#ffffff";
      expect(Object.isFrozen(theme.light)).toBe(true);
      for (const dark of [false, true]) {
        const roles = nativeThemeColorRoles(theme, dark);
        expect(Object.keys(roles)).toHaveLength(ROLES.length);
        const golden = GOLDEN_PET.schemes[index]!;
        expect(Object.values(roles)).toEqual(ROLES.map(role => (dark ? golden.dark : golden.light)[role]!));
        expect(roles).toEqual(schemeFromSeed(GOLDEN_PET.seed, { dark, contrastLevel: theme.contrast_level }));
      }
    }
    const theme = parseNativeThemeExport(fixture());
    const css = nativeThemeCss(theme, {
      lightSelector: ".light",
      darkSelector: ".dark",
    });
    expect(css).toContain(".light {\n  color-scheme: light;");
    expect(css).toContain(".dark {\n  color-scheme: dark;");
    expect(css).toContain(`--md-sys-color-on-primary-container: ${theme.light.onPrimaryContainer};`);
  });

  test("rejects incomplete, injected or unsupported native exports", () => {
    expect(() => parseNativeThemeExport({ ...fixture(), schema_version: 2 })).toThrow("schema");
    expect(() => parseNativeThemeExport({ ...fixture(), spec_version: "2026" })).toThrow("specification");
    expect(() => parseNativeThemeExport({ ...fixture(), variant: "unknown" })).toThrow("variant");
    expect(() => parseNativeThemeExport({ ...fixture(), variant: "cmf" })).toThrow("variant");
    expect(parseNativeThemeExport({ ...fixture(), variant: "fidelity" }).variant).toBe("fidelity");
    expect(parseNativeThemeExport({ ...fixture(), variant: "fruit-salad" }).variant).toBe("fruit-salad");
    expect(() => parseNativeThemeExport({ ...fixture(), contrast_level: NaN })).toThrow("contrast");
    expect(() => parseNativeThemeExport({ ...fixture(), seed: "red; display:none" })).toThrow("hex");
    const missing = fixture();
    delete (missing.light as Record<string, string>)["primary"];
    expect(() => parseNativeThemeExport(missing)).toThrow("49 roles");
    const injected = fixture();
    injected.dark["onSurface"] = "#123456; display:none";
    expect(() => parseNativeThemeExport(injected)).toThrow("hex");
  });
});
