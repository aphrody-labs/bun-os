// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES, parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";
import { BUNOS_THEME } from "../src/apps.ts";
import { productSeed, rolesFor } from "../src/color.ts";
import { generate } from "../src/index.ts";
import { themed } from "./fixtures.ts";

const input = themed("Cache", "#6750a4");

describe("rolesFor", () => {
  it("returns the same frozen object for the same export and mode", () => {
    const a = rolesFor(input, "light");
    expect(rolesFor({ ...input, name: "Other" }, "light")).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.roles)).toBe(true);
  });

  it("keys on the export and mode", () => {
    const light = rolesFor(input, "light");
    expect(rolesFor(input, "dark")).not.toBe(light);
    expect(rolesFor(themed("Cache", "#00ff88"), "light").roles["primary"]).not.toBe(light.roles["primary"]);
    expect(rolesFor(themed("Cache", "#6750a4", "vibrant"), "light").roles["primary"]).not.toBe(light.roles["primary"]);
    expect(rolesFor({ ...input, seed: "#6750A4" }, "light")).toBe(light);
  });

  it("validates the seed and contrast before anything else", () => {
    expect(() => rolesFor({ ...input, seed: "nope" }, "light")).toThrow("invalid seed colour");
    for (const contrastLevel of [NaN, Infinity, -1.1, 1.1])
      expect(() => rolesFor({ ...input, contrastLevel }, "light")).toThrow("M3 contrast");
  });

  it("refuses to run without the Rust ThemeExport", () => {
    expect(() => rolesFor({ name: "Bare", seed: "#6750a4", mode: "auto" }, "light")).toThrow("Rust ThemeExport");
  });

  it("keeps contrast levels distinct", () => {
    const high = rolesFor(themed("Cache", "#6750a4", "tonal-spot", 1), "light");
    expect(high.roles["primary"]).not.toBe(rolesFor(input, "light").roles["primary"]);
  });

  it("generates identical files on repeated calls", () => {
    const first = generate(input);
    const again = generate(input);
    expect(again.map(f => [f.path, f.content])).toEqual(first.map(f => [f.path, f.content]));
  });

  it("consumes native roles unchanged and refuses metadata drift", () => {
    const source = {
      schema_version: 1,
      spec_version: "2021",
      seed: "#6750a4",
      variant: "tonal-spot",
      contrast_level: 0,
      light: Object.fromEntries(ROLES.map(role => [role, "#aabbcc"])),
      dark: Object.fromEntries(ROLES.map(role => [role, "#112233"])),
    };
    const nativeTheme = parseNativeThemeExport(source);
    expect(rolesFor({ ...input, nativeTheme }, "light").roles["primary"]).toBe("#aabbcc");
    expect(rolesFor({ ...input, nativeTheme }, "dark").roles["onSurface"]).toBe("#112233");
    expect(() => rolesFor({ ...input, seed: "#123456", nativeTheme }, "light")).toThrow("does not match");
    source.light["primary"] = "#ff0000";
    const changed = parseNativeThemeExport(source);
    expect(rolesFor({ ...input, nativeTheme: changed }, "light").roles["primary"]).toBe("#ff0000");
  });
});

describe("product theme", () => {
  it("is the Rust export of aphrody_identity's pet seed", () => {
    const committed = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "generated", "theme", "bunos-m3.json"), "utf8"),
    );
    expect(committed.seed).toBe(productSeed());
    expect(BUNOS_THEME.seed).toBe(productSeed());
    expect(BUNOS_THEME.nativeTheme?.seed).toBe(productSeed());
    expect(rolesFor(BUNOS_THEME, "light").roles["primary"]).toBe(committed.light.primary);
  });
});
