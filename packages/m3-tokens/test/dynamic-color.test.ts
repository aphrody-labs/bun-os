// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  Hct,
  ROLES,
  applyDynamicColor,
  clearDynamicColor,
  cssFromSeed,
  dynamicColorProperties,
  schemeFromSeed,
  themeFromImage,
} from "../src/dynamic-color.ts";
import { GOLDEN_HCT, GOLDEN_IMAGES, GOLDEN_SCHEMES, GOLDEN_SOLVE, camelVariant, hex } from "./golden.ts";

const HEX = /^#[0-9a-f]{6}$/;
const kebab = (role: string) => role.replace(/([A-Z])/g, "-$1").toLowerCase();

describe("schemeFromSeed matches the Rust golden output", () => {
  test(`all ${GOLDEN_SCHEMES.length} golden schemes, every role`, () => {
    expect(GOLDEN_SCHEMES.length).toBe(304);
    for (const golden of GOLDEN_SCHEMES) {
      const scheme = schemeFromSeed(hex(golden.seed), {
        variant: camelVariant(golden.variant),
        dark: golden.dark,
        contrastLevel: golden.contrast,
      });
      expect(Object.keys(scheme)).toHaveLength(ROLES.length);
      for (const role of ROLES) {
        const label = `${hex(golden.seed)} ${golden.variant} ${golden.dark ? "dark" : "light"} ${golden.contrast} ${role}`;
        expect(scheme[`--md-sys-color-${kebab(role)}`], label).toBe(hex(golden.roles[role]!));
      }
    }
  });

  test("every variant name of the engine is reachable", () => {
    for (const variant of new Set(GOLDEN_SCHEMES.map(golden => golden.variant))) {
      expect(Object.values(schemeFromSeed("#6750a4", { variant: camelVariant(variant) }))).toSatisfy(values =>
        values.every(value => HEX.test(value)),
      );
    }
  });
});

describe("Hct and themeFromImage match the Rust golden output", () => {
  test("Hct.fromInt reproduces hue, chroma and tone", () => {
    for (const [argb, hue, chroma, tone] of GOLDEN_HCT) {
      const hct = Hct.fromInt(argb!);
      expect(hct.hue).toBeCloseTo(hue!, 9);
      expect(hct.chroma).toBeCloseTo(chroma!, 9);
      expect(hct.tone).toBeCloseTo(tone!, 9);
      expect(hct.toInt()).toBe(argb!);
    }
  });

  test("Hct.from solves to the golden ARGB", () => {
    for (const [hue, chroma, tone, argb] of GOLDEN_SOLVE) expect(Hct.from(hue!, chroma!, tone!).toInt()).toBe(argb!);
  });

  test("themeFromImage picks the golden source colour", () => {
    const flat = GOLDEN_IMAGES.filter(image => image.quantized.length <= 3);
    expect(flat.length).toBeGreaterThanOrEqual(3);
    for (const image of flat) {
      const pixels = image.quantized.flatMap(([argb, count]) =>
        Array.from({ length: count }, () => [(argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff, 0xff]),
      );
      expect(themeFromImage(Uint8Array.from(pixels.flat())), image.name).toBe(hex(image.sourceColor));
    }
    expect(() => themeFromImage(new Uint8Array(3))).toThrow(RangeError);
  });
});

describe("applyDynamicColor", () => {
  test("sets the golden roles and the extended roles, and clears them", () => {
    const golden = GOLDEN_SCHEMES.find(
      scheme => scheme.variant === "tonal-spot" && scheme.dark && scheme.contrast === 0,
    )!;
    const properties = new Map<string, string>();
    const target = {
      style: Object.assign([] as string[], {
        setProperty(name: string, value: string) {
          if (!properties.has(name)) this.push(name);
          properties.set(name, value);
        },
        removeProperty(name: string) {
          properties.delete(name);
          this.splice(this.indexOf(name), 1);
        },
      }),
    } as unknown as HTMLElement;
    applyDynamicColor(hex(golden.seed), { dark: true, target });
    for (const role of ROLES) expect(properties.get(`--md-sys-color-${kebab(role)}`)).toBe(hex(golden.roles[role]!));
    for (const name of ["success", "on-success", "success-container", "warning", "on-warning-container"])
      expect(properties.get(`--md-ext-color-${name}`)).toMatch(HEX);
    expect(properties.size).toBe(Object.keys(dynamicColorProperties(hex(golden.seed), { dark: true })).length);
    clearDynamicColor(target);
    expect(properties.size).toBe(0);
  });
});

describe("cssFromSeed", () => {
  test("follows the system theme until an explicit theme is selected", () => {
    const css = cssFromSeed("#6750A4");
    expect(css).toContain(":root {");
    expect(css).toContain("color-scheme: light dark");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(":root:not([data-theme])");
    expect(css).toContain(':root[data-theme="light"]');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("--md-sys-color-primary:");
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("color-scheme: dark");
  });

  test("custom selectors carry the same roles as the defaults", () => {
    const css = cssFromSeed("#17335C", {
      lightSelector: ".light",
      darkSelector: ":root,\n.dark",
    });
    expect(css.startsWith(".light {\n  color-scheme: light;")).toBe(true);
    expect(css).toContain(":root,\n.dark {\n  color-scheme: dark;");
    expect(css).not.toContain("data-theme");
    const dark = schemeFromSeed("#17335C", { dark: true });
    expect(css).toContain(`--md-sys-color-primary: ${dark["--md-sys-color-primary"]};`);
  });
});
