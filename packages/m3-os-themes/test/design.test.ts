// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { BUTTONS, chromeSpec, contrast, harmonize, trafficLightSvg, win11Chrome } from "../src/chrome.ts";
import { ICONS, compose } from "../src/icons.ts";
import { FONTS, fontconfigConf } from "../src/desktops.ts";
import { BUNOS_THEME } from "../src/apps.ts";

const input = BUNOS_THEME;

describe("window chrome spec", () => {
  const spec = chromeSpec(input);
  test("every accessibility check passes in both modes", () => {
    for (const m of [spec.light, spec.dark])
      for (const c of m.checks) expect({ name: c.name, pass: c.pass }).toEqual({ name: c.name, pass: true });
  });
  test("harmonize rotates at most 15 degrees and keeps the signal hues apart", () => {
    const fills = BUTTONS.map(b => spec.dark.buttons[b].fill);
    expect(new Set(fills).size).toBe(3);
    expect(harmonize("#ff5f57", "#ff5f57")).toBe("#ff5f57");
  });
  test("caption buttons carry accessible names and glyphs only on hover/focus", () => {
    expect(trafficLightSvg(spec.light, "close", "normal")).toContain("<title>Close</title>");
    expect(trafficLightSvg(spec.light, "close", "normal")).not.toContain("<path");
    expect(trafficLightSvg(spec.light, "close", "focus")).toContain("<path");
  });
  test("Windows chrome JSON matches the bunos-win11-chrome describe shape", () => {
    const w = win11Chrome(spec, "dark") as { chrome: Record<string, unknown>; traffic: Record<string, unknown> };
    expect(Object.keys(w.chrome).sort()).toEqual(["border", "caption", "dark", "mica", "rounded"]);
    expect(typeof w.traffic["close"]).toBe("number");
  });
  test("contrast is symmetric and bounded", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });
});

describe("icon theme", () => {
  test("ids are unique", () => {
    expect(new Set(ICONS.map(i => i.id)).size).toBe(ICONS.length);
  });
  test("compose produces sized SVGs", () => {
    const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>`;
    const c = compose(
      ICONS.find(i => i.kind === "folder" && i.id === "folder-music")!,
      glyph,
      { primary: "#cbbeff", secondary: "#c9c3dc", tertiary: "#edb8cd", neutral: "#938f99" },
      false,
    );
    expect(c.svg).toContain('viewBox="0 0 256 256"');
    expect(c.small).not.toEqual(c.svg);
  });
});

describe("fonts", () => {
  test("Google Sans Flex is the brand face and every font has a license", () => {
    expect(FONTS.find(f => f.role === "brand")?.family).toBe("Google Sans Flex");
    for (const f of FONTS) expect(["OFL-1.1", "Apache-2.0"]).toContain(f.license);
    expect(fontconfigConf()).toContain("<family>Google Sans Flex</family>");
  });
});
