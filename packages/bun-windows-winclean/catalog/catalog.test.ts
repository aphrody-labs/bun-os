// SPDX-License-Identifier: Apache-2.0
// Fast gate for the shipped tweak catalog (the Rust test embedded_catalog_parses_and_is_guarded needs a Windows
// cargo build): it must be valid TOML, every tweak must name a declared module, and ids must be unique.
import { expect, test } from "bun:test";

const catalog = Bun.TOML.parse(await Bun.file(new URL("./tweaks.toml", import.meta.url)).text()) as {
  module: { id: string }[];
  tweak: { id: string; module: string; level: string; registry?: { hive: string; type?: string; value?: unknown }[] }[];
};

test("tweaks.toml parses, modules and ids are consistent", () => {
  const modules = new Set(catalog.module.map(m => m.id));
  const ids = new Set<string>();
  for (const t of catalog.tweak) {
    expect(modules.has(t.module)).toBe(true);
    expect(ids.has(t.id)).toBe(false);
    ids.add(t.id);
    expect(["conservative", "standard", "aggressive"]).toContain(t.level);
  }
});

test("look module is per-user registry only (no resident process, no machine-wide change)", () => {
  const look = catalog.tweak.filter(t => t.module === "look");
  expect(look.length).toBeGreaterThanOrEqual(5);
  for (const t of look) for (const r of t.registry ?? []) expect(r.hive).toBe("user");
  const palette = look.flatMap(t => t.registry ?? []).find(r => r.type === "binary");
  expect(String(palette?.value)).toMatch(/^[0-9a-f]{64}$/);
});
