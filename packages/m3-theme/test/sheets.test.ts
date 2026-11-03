// SPDX-License-Identifier: Apache-2.0
// The sheets come from Rust (crates/aphrody-m3-tokens/src/sheets.rs through @aphrody/bun's m3Css),
// the only colour engine; its own tests hold the colour science. These tests check that the
// committed files are the current Rust output and carry the full role set.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { brandModule } from "../scripts/brand-module";

// The library opens lazily, so the probe loads it: a missing artifact skips the native suite here,
// not mid-suite. Build or link it as described in docs/guides/NATIVE.md.
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
if (skip) console.warn(`[@aphrody/m3-theme] native suite skipped: ${unavailable}`);
const m3Css = (config: Parameters<typeof import("@aphrody/bun").m3Css>[0]) =>
  (native as Exclude<typeof native, Error>).m3Css(config);

const dir = join(import.meta.dir, "..");
const read = (name: string) => Bun.file(join(dir, name)).text();

/** `--md-sys-color-*` names of the block that starts right after `marker`. */
function roles(css: string, marker: string): string[] {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return [...body.matchAll(/(--md-sys-color-[a-z0-9-]+):/g)].map(m => m[1]!);
}

/** oxfmt may rewrap lines: compare token streams, not layout. */
function normalize(css: string): string {
  return css.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/,\)/g, ")").trim();
}

describe("committed sheets", () => {
  test("tokens.css: 49 roles in the light, dark and forced-dark blocks", async () => {
    const css = await read("tokens.css");
    expect(css).toContain("GENERATED - do not hand-edit");
    expect(roles(css, "\n:root {")).toHaveLength(49);
    expect(roles(css, "@media (prefers-color-scheme: dark)")).toHaveLength(49);
    expect(roles(css, ":root.dark,")).toHaveLength(49);
  });

  test("spaceui.css: 49 roles per theme", async () => {
    const css = await read("spaceui.css");
    for (const name of ["dark", "light", "midnight", "noir", "slate", "nord", "mocha"])
      expect(roles(css, `/* SpaceUI ${name} */`)).toHaveLength(49);
  });

  test("tailwind.css: maps roles to var() only", async () => {
    const css = await read("tailwind.css");
    const theme = css.slice(css.indexOf("@theme inline {"), css.indexOf("\n}\n", css.indexOf("@theme inline {")));
    expect(theme).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(theme).toContain("--color-primary: var(--md-sys-color-primary);");
  });
});

describe.skipIf(skip)(
  skip ? `committed files are current [skipped: ${unavailable}]` : "committed files are current",
  () => {
    for (const sheet of ["tokens", "tailwind", "spaceui"] as const) {
      test(`${sheet}.css`, async () => {
        expect(normalize(await read(`${sheet}.css`))).toBe(normalize(m3Css({ sheet })));
      });
    }
    test("src/brand.ts", async () => {
      const formatted = (source: string) => source.replace(/\s+/g, "");
      expect(formatted(await read("src/brand.ts"))).toBe(formatted(brandModule(m3Css({ sheet: "brand" }))));
    });
  },
);
