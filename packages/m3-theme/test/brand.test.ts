// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { brandDeclarations, brandModule } from "../scripts/brand-module";
import {
  APHRODY_BRAND_COLORS,
  APHRODY_BRAND_CSS,
  APHRODY_BRAND_GRADIENTS,
  APHRODY_BRAND_SHAPES,
} from "../src/index.js";

describe("@aphrody/m3-theme brand tokens (generated from Sheet::Brand)", () => {
  it("carries every --aphrody-* declaration of the brand sheet and nothing else", () => {
    const declared = brandDeclarations(APHRODY_BRAND_CSS).map(([name]) => name);
    expect(declared.every(name => name.startsWith("--aphrody-"))).toBe(true);
    const counted =
      Object.keys(APHRODY_BRAND_COLORS).length +
      Object.keys(APHRODY_BRAND_GRADIENTS).length +
      Object.keys(APHRODY_BRAND_SHAPES).length;
    expect(counted).toBe(declared.length);
  });

  it("groups colours, gradients and corners", () => {
    for (const value of Object.values(APHRODY_BRAND_COLORS)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
    for (const value of Object.values(APHRODY_BRAND_GRADIENTS)) expect(value).toStartWith("linear-gradient(");
    for (const value of Object.values(APHRODY_BRAND_SHAPES)) expect(value).toMatch(/^\d+px$/);
  });

  it("drops the sheet's --m3-* baseline companions", () => {
    const sheet = `:root {\n  --m3-color-primary: #000000;\n  --aphrody-brand-blue: #112233;\n  --aphrody-corner-card: 16px;\n}\n`;
    const module = brandModule(sheet);
    expect(module).toContain('blue: "#112233"');
    expect(module).toContain('card: "16px"');
    expect(module).not.toContain("--m3-color-primary");
  });

  it("refuses a sheet without brand declarations", () => {
    expect(() => brandModule(":root {}\n")).toThrow("no --aphrody-* declarations");
  });
});
