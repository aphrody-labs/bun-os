// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { compile } from "@tailwindcss/node";
import { ROLES } from "@aphrody/m3-tokens/dynamic-color";
import { BREAKPOINTS } from "@aphrody/m3-tokens/breakpoints";
import { EMPHASIZED_STYLES, TYPE_BASE } from "@aphrody/m3-tokens/expressive";
import {
  DIRECTIONAL_SHAPE_NAMES,
  DURATIONS,
  EASINGS,
  ELEVATIONS,
  SHAPES,
  STATE_LAYERS,
  presetCss,
  springDefs,
  springPosition,
  springToCss,
  themeCss,
} from "../src/index.ts";

const kebab = (s: string): string => s.replace(/([A-Z])/g, "-$1").toLowerCase();
const file = (url: string): Promise<string> => Bun.file(new URL(url, import.meta.url)).text();
const tokenSheets =
  (await file("../../m3-tokens/src/m3-tokens.css")) + (await file("../../m3-tokens/src/expressive.css"));

/** Compile the generated preset (without `@import "tailwindcss"`, which would add the base layers) and build `classes`. */
async function build(classes: string[], css: string = presetCss()): Promise<string> {
  const compiler = await compile(`@tailwind utilities;\n${css}`, {
    base: process.cwd(),
    onDependency: () => {},
  });
  return compiler.build(classes);
}

describe("preset.css", () => {
  test("is up to date with the generator", async () => {
    // The committed file is run through the repo formatter, which re-wraps declarations.
    const flat = (css: string) => css.replace(/\s+/g, "").trim();
    expect(flat(await file("../preset.css"))).toBe(flat(presetCss()));
  });

  test("themeCss is `inline` by default and `static` on request", () => {
    expect(themeCss().startsWith("@theme inline {")).toBe(true);
    expect(themeCss({ keepUnused: true }).startsWith("@theme static {")).toBe(true);
  });
});

describe("token coverage", () => {
  const css = themeCss();

  test("every colour role maps to a --color-* theme key", () => {
    for (const role of ROLES) {
      const k = kebab(role);
      expect(css).toContain(`--color-${k}: var(--md-sys-color-${k});`);
    }
  });

  test("the whole corner scale, directional shapes, durations, easings and elevations are mapped", () => {
    expect(SHAPES).toContain("extra-large-increased");
    expect(DIRECTIONAL_SHAPE_NAMES).toContain("large-start");
    expect(DURATIONS).toHaveLength(16);
    expect(EASINGS).toContain("emphasized-decelerate");
    expect(ELEVATIONS).toEqual(["0", "1", "2", "3", "4", "5"]);
    for (const s of SHAPES) expect(css).toContain(`--radius-${s}: var(--md-sys-shape-corner-${s});`);
    for (const s of [...SHAPES, ...DIRECTIONAL_SHAPE_NAMES])
      expect(css).toContain(`--shape-${s}: var(--md-sys-shape-corner-${s});`);
    for (const d of DURATIONS) expect(css).toContain(`--transition-duration-${d}: var(--md-sys-motion-duration-${d});`);
    for (const e of EASINGS) expect(css).toContain(`--ease-${e}: var(--md-sys-motion-easing-${e});`);
    for (const n of ELEVATIONS) expect(css).toContain(`--shadow-elevation-${n}: var(--md-sys-elevation-level${n});`);
  });

  test("15 base and 15 emphasized type styles carry size, line height, tracking and weight", () => {
    expect(Object.keys(TYPE_BASE)).toHaveLength(15);
    expect(EMPHASIZED_STYLES).toHaveLength(15);
    for (const name of Object.keys(TYPE_BASE)) {
      for (const key of ["", "--line-height", "--letter-spacing", "--font-weight"])
        expect(css).toContain(`--text-${name}${key}:`);
    }
    expect(css).toContain(
      "--text-label-small-emphasized--font-weight: var(--md-sys-typescale-label-small-emphasized-weight);",
    );
  });

  test("window size classes become breakpoints", () => {
    expect(css).toContain(`--breakpoint-medium: ${BREAKPOINTS.medium / 16}rem;`);
    expect(css).toContain(`--breakpoint-extra-large: ${BREAKPOINTS["extra-large"] / 16}rem;`);
  });

  test("the four state layers are read from the token sheet", () => {
    expect(new Set(STATE_LAYERS)).toEqual(new Set(["dragged", "focus", "hover", "pressed"]));
  });

  test("every --md-sys/--md-ref custom property the preset reads exists in the token sheets or is a colour role", () => {
    const defined = new Set([...tokenSheets.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]!));
    const colours = new Set(ROLES.map(r => `--md-sys-color-${kebab(r)}`));
    const missing = [...presetCss().matchAll(/var\((--md-[\w-]+)/g)]
      .map(m => m[1]!)
      .filter(name => !defined.has(name) && !colours.has(name));
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe("Tailwind v4 compiles the preset", () => {
  test("a utility for every colour role", async () => {
    const out = await build(ROLES.flatMap(r => [`bg-${kebab(r)}`, `text-${kebab(r)}`]));
    for (const role of ROLES) {
      expect(out).toContain(`.bg-${kebab(role)} {`);
      expect(out).toContain(`var(--md-sys-color-${kebab(role)})`);
    }
  });

  test("shape: rounded-* for the scale, shape-* for scale and directional corners", async () => {
    const out = await build([
      "rounded-large",
      "rounded-full",
      "shape-extra-large-top",
      "shape-large-start",
      "shape-none",
    ]);
    expect(out).toContain("var(--md-sys-shape-corner-large)");
    expect(out).toContain(".shape-extra-large-top {\n  border-radius: var(--md-sys-shape-corner-extra-large-top);");
    expect(out).toContain("border-radius: var(--md-sys-shape-corner-large-start);");
  });

  test("type: text-* sets size, line height, tracking and weight; typescale-* adds the family", async () => {
    const out = await build([
      "text-body-large",
      "text-title-small-emphasized",
      "typescale-label-large",
      "typescale-display-large-emphasized",
      "font-brand",
    ]);
    expect(out).toContain("var(--md-sys-typescale-body-large-size)");
    expect(out).toContain("var(--md-sys-typescale-body-large-line-height)");
    expect(out).toContain("var(--md-sys-typescale-title-small-emphasized-weight)");
    expect(out).toContain("font-family: var(--md-sys-typescale-label-large-font);");
    expect(out).toContain("font-family: var(--md-sys-typescale-display-large-emphasized-font);");
    expect(out).toContain("var(--md-ref-typeface-brand)");
  });

  test("elevation 0 to 5", async () => {
    const out = await build(ELEVATIONS.map(n => `shadow-elevation-${n}`));
    for (const n of ELEVATIONS) expect(out).toContain(`var(--md-sys-elevation-level${n})`);
  });

  test("motion: durations, easings and springs", async () => {
    const out = await build([
      "duration-short1",
      "duration-extra-long4",
      "ease-emphasized-decelerate",
      "ease-legacy",
      "ease-spring-expressive-fast-spatial",
      "duration-spring-default-effects",
      "motion-expressive-default-spatial",
      "motion-slow-effects",
    ]);
    expect(out).toContain("transition-duration: var(--md-sys-motion-duration-short1);");
    expect(out).toContain("var(--md-sys-motion-duration-extra-long4)");
    expect(out).toContain("var(--md-sys-motion-easing-emphasized-decelerate)");
    expect(out).toContain("var(--md-sys-motion-easing-legacy)");
    expect(out).toMatch(/\.ease-spring-expressive-fast-spatial \{[^}]*linear\(0, /);
    expect(out).toMatch(/\.duration-spring-default-effects \{[^}]*transition-duration: \d+ms;/);
    expect(out).toMatch(
      /\.motion-expressive-default-spatial \{[^}]*--tw-ease: linear\(0, [^}]*transition-duration: \d+ms;/,
    );
    expect(out).toMatch(/\.motion-slow-effects \{/);
  });

  test("state layer: hover, focus, pressed, dragged and the role colour", async () => {
    const out = await build(["state-layer", "state-layer-primary", "state-layer-on-surface-variant"]);
    expect(out).toContain(".state-layer {");
    expect(out).toContain("var(--md-sys-state-hover-state-layer-opacity)");
    expect(out).toContain("var(--md-sys-state-focus-state-layer-opacity)");
    expect(out).toContain("var(--md-sys-state-pressed-state-layer-opacity)");
    expect(out).toContain("var(--md-sys-state-dragged-state-layer-opacity)");
    expect(out).toContain("[data-highlighted]");
    expect(out).toContain(".state-layer-primary {\n  --m3-state-layer-color: var(--md-sys-color-primary);");
    expect(out).toContain("--m3-state-layer-color: var(--md-sys-color-on-surface-variant);");
    // Pressed is declared after hover: with equal specificity it wins while the pointer is down.
    expect(out.indexOf("hover-state-layer-opacity")).toBeLessThan(out.indexOf("pressed-state-layer-opacity"));
  });

  test("state layers as opacity modifiers on the content role", async () => {
    const out = await build(["hover:bg-on-surface/8", "active:bg-on-primary/10"]);
    expect(out).toContain("color-mix(in oklab, var(--md-sys-color-on-surface)");
  });

  test("adaptive variants: window width and height classes", async () => {
    const out = await build([
      "compact:hidden",
      "medium:flex",
      "expanded:grid",
      "large:block",
      "extra-large:flex",
      "h-compact:hidden",
      "h-medium:flex",
      "h-expanded:grid",
    ]);
    expect(out).toContain("@media (width < 37.5rem)");
    expect(out).toContain("@media (width >= 37.5rem)");
    expect(out).toContain("@media (width >= 52.5rem)");
    expect(out).toContain("@media (width >= 75rem)");
    expect(out).toContain("@media (width >= 100rem)");
    expect(out).toContain("@media (height < 30rem)");
    expect(out).toContain("@media (height >= 30rem)");
    expect(out).toContain("@media (height >= 56.25rem)");
  });

  test("dark follows .dark, or the OS unless .light forces light", async () => {
    const out = await build(["dark:bg-surface"]);
    expect(out).toContain(".dark\\:bg-surface:where(.dark, .dark *)");
    expect(out).toContain("@media (prefers-color-scheme: dark)");
    expect(out).toContain(":where(:not(.light, .light *))");
  });

  test("Base UI state variants", async () => {
    const out = await build([
      "m3-open:bg-surface",
      "m3-on:bg-primary",
      "m3-highlighted:bg-surface-variant",
      "m3-disabled:opacity-40",
      "m3-invalid:text-error",
      "m3-enter:opacity-0",
      "m3-exit:opacity-0",
      "m3-vertical:flex-col",
      "m3-horizontal:flex-row",
      "group-m3-open:rotate-180",
    ]);
    expect(out).toContain('[data-open], [data-popup-open], [open], [aria-expanded="true"]');
    expect(out).toContain("[data-checked], [data-selected], [data-pressed]");
    expect(out).toContain("[data-starting-style]");
    expect(out).toContain("[data-ending-style]");
    expect(out).toContain('[data-orientation="vertical"]');
  });

  test("an app on the preset (theme + utilities + preset) builds without errors", async () => {
    const compiler = await compile(
      '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n@import "@aphrody/m3-tailwind/preset.css";',
      {
        base: Bun.fileURLToPath(new URL("..", import.meta.url)),
        onDependency: () => {},
      },
    );
    const out = compiler.build(["bg-primary", "p-4", "md:grid", "medium:flex", "dark:bg-surface"]);
    expect(out).toContain("var(--md-sys-color-primary)");
    expect(out).toContain("padding");
  });
});

const peak = (damping: number, stiffness: number): number =>
  Math.max(...Array.from({ length: 400 }, (_, i) => springPosition(damping, stiffness, i / 200)));

describe("springs as CSS linear()", () => {
  test("a spring starts at 0 and settles at 1", () => {
    for (const s of springDefs()) {
      expect(springPosition(s.damping, s.stiffness, 0)).toBeCloseTo(0, 6);
      expect(springPosition(s.damping, s.stiffness, 5)).toBeCloseTo(1, 3);
    }
  });

  test("Expressive spatial springs overshoot; effects springs (damping ratio 1) never do", () => {
    const defs = Object.fromEntries(springDefs().map(s => [s.name, s]));
    expect(peak(defs["expressive-fast-spatial"]!.damping, defs["expressive-fast-spatial"]!.stiffness)).toBeGreaterThan(
      1.05,
    );
    expect(peak(defs["default-effects"]!.damping, defs["default-effects"]!.stiffness)).toBeLessThanOrEqual(1.0000001);
  });

  test("the linear() easing has 33 stops, begins at 0, ends at 1 and keeps the overshoot", () => {
    const { easing, durationMs } = springToCss(0.6, 800);
    const stops = easing.slice("linear(".length, -1).split(", ").map(Number);
    expect(stops).toHaveLength(33);
    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(1);
    expect(Math.max(...stops)).toBeGreaterThan(1);
    expect(durationMs % 10).toBe(0);
    expect(durationMs).toBeGreaterThan(100);
  });

  test("an over-damped spring is monotone", () => {
    const samples = Array.from({ length: 50 }, (_, i) => springPosition(1.5, 400, i / 25));
    for (let i = 1; i < samples.length; i += 1) expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
  });
});
