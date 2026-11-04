// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { generateHyprland, hyprlandColors, waybarCss, fuzzelIni } from "../src/hyprland.ts";
import { rolesFor } from "../src/color.ts";
import { themed } from "./fixtures.ts";

const input = themed("BunOS", "#6750a4");

describe("hyprland target", () => {
  it("emits hyprland.conf, waybar.css, and fuzzel.ini for both light and dark modes", () => {
    const files = generateHyprland(input);
    expect(files.length).toBe(6); // 3 files * 2 modes

    const paths = files.map(f => f.path);
    expect(paths).toContain("hypr/themes/BunOS-light.conf");
    expect(paths).toContain("hypr/themes/BunOS-dark.conf");
    expect(paths).toContain("waybar/themes/BunOS-light.css");
    expect(paths).toContain("waybar/themes/BunOS-dark.css");
    expect(paths).toContain("fuzzel/themes/BunOS-light.ini");
    expect(paths).toContain("fuzzel/themes/BunOS-dark.ini");

    for (const f of files) {
      expect(f.target).toBe("hyprland");
      expect(typeof f.content).toBe("string");
      expect((f.content as string).length).toBeGreaterThan(100);
    }
  });

  it("produces valid color declarations and window rules", () => {
    const roles = rolesFor(input, "dark").roles;
    const conf = hyprlandColors(roles, "dark");
    expect(conf).toContain("col.active_border =");
    expect(conf).toContain("col.inactive_border =");
    expect(conf).toContain("rounding = 14");
    expect(conf).toContain("class:^(com.aphrody.glowbar)$");

    const css = waybarCss(roles, "dark");
    expect(css).toContain("#waybar > box");
    expect(css).toContain("border-radius: 28px");
    expect(css).toContain("#custom-gemini");

    const ini = fuzzelIni(roles, "dark");
    expect(ini).toContain("[main]");
    expect(ini).toContain("[colors]");
    expect(ini).toContain("radius=24");
  });
});
