import { describe, expect, test } from "bun:test";
import { DIRECTIONAL_SHAPES, EMPHASIZED_STYLES, EXPRESSIVE_SPRINGS, expressiveCss } from "../src/expressive.js";

const file = await Bun.file(new URL("../src/expressive.css", import.meta.url)).text();
const tokens = await Bun.file(new URL("../src/m3-tokens.css", import.meta.url)).text();

describe("emphasized typescale", () => {
  test("15 styles with the Compose weights", () => {
    expect(EMPHASIZED_STYLES).toHaveLength(15);
    const w = Object.fromEntries(EMPHASIZED_STYLES.map(s => [s.name, s.weight]));
    for (const n of [
      "display-large",
      "display-medium",
      "display-small",
      "headline-large",
      "headline-medium",
      "headline-small",
      "title-large",
      "body-large",
      "body-medium",
      "body-small",
    ]) {
      expect(w[n]).toBe(500);
    }
    for (const n of ["title-medium", "title-small", "label-large", "label-medium", "label-small"]) {
      expect(w[n]).toBe(700);
    }
  });
  test("display-large emphasized tracking is 0, base keeps -0.25dp", () => {
    expect(file).toContain("--md-sys-typescale-display-large-emphasized-tracking: 0rem;");
    expect(tokens).toContain("--md-sys-typescale-display-large-tracking: -0.015625rem;");
    expect(file).toContain("--md-sys-typescale-body-large-emphasized-tracking: 0.009375rem;");
  });
  test("size and line height equal the base style", () => {
    for (const s of EMPHASIZED_STYLES) {
      expect(tokens).toContain(`--md-sys-typescale-${s.name}-size: ${s.size};`);
      expect(tokens).toContain(`--md-sys-typescale-${s.name}-line-height: ${s.lineHeight};`);
    }
  });
});

describe("expressive springs", () => {
  test("values and custom properties", () => {
    expect(EXPRESSIVE_SPRINGS).toEqual({
      fast: { damping: 0.6, stiffness: 800 },
      default: { damping: 0.8, stiffness: 380 },
      slow: { damping: 0.8, stiffness: 200 },
    });
    expect(file).toContain("--md-sys-motion-spring-expressive-fast-spatial-damping: 0.6;");
    expect(file).toContain("--md-sys-motion-spring-expressive-default-spatial-stiffness: 380;");
    expect(file).toContain("--md-sys-motion-spring-expressive-slow-spatial-stiffness: 200;");
  });
});

describe("directional shapes", () => {
  test("five tokens built on the corner scale", () => {
    expect(Object.keys(DIRECTIONAL_SHAPES)).toEqual([
      "extra-small-top",
      "large-top",
      "large-start",
      "large-end",
      "extra-large-top",
    ]);
    expect(file.replace(/\s+/g, "")).toContain(
      "--md-sys-shape-corner-large-start:var(--md-sys-shape-corner-large)var(--md-sys-shape-corner-none)var(--md-sys-shape-corner-none)var(--md-sys-shape-corner-large);",
    );
    expect(file).toContain(":root:dir(rtl)");
  });
});

test("expressive.css is up to date with expressive.ts", () => {
  // The committed file is run through the repo formatter, which re-wraps long declarations.
  const flat = (css: string) => css.replace(/\s+/g, "").trim();
  expect(flat(file)).toBe(flat(expressiveCss()));
});
