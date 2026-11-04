// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  GEMINI_THEME,
  emitGeminiTheme,
  rolesFor,
  type Target,
} from "../src/index.ts";

describe("Gemini Light Blue Theme", () => {
  it("defines canonical colors: #8ab4f8 primary, #c2e7ff secondary, #7cd8e8 tertiary", () => {
    const darkRoles = rolesFor(GEMINI_THEME, "dark").roles;
    expect(darkRoles["primary"]).toBe("#8ab4f8");
    expect(darkRoles["secondary"]).toBe("#c2e7ff");
    expect(darkRoles["tertiary"]).toBe("#7cd8e8");
  });

  it("is emitted and accessible for all native targets: hyprland, cosmic, iced, gtk, chromium", () => {
    const targets: Target[] = ["hyprland", "cosmic", "iced", "gtk", "chromium"];
    const files = emitGeminiTheme(targets);

    expect(files.length).toBeGreaterThan(0);
    const targetSet = new Set(files.map(f => f.target));

    expect(targetSet.has("hyprland")).toBe(true);
    expect(targetSet.has("cosmic")).toBe(true);
    expect(targetSet.has("iced")).toBe(true);
    expect(targetSet.has("gtk")).toBe(true);
    expect(targetSet.has("chromium")).toBe(true);

    // Verify Hyprland files
    const hyprConf = files.find(f => f.path.includes("hypr/themes/Gemini-dark.conf"));
    expect(hyprConf).toBeDefined();
    expect(hyprConf!.content as string).toContain("rgba(8ab4f8ff)");

    // Verify Cosmic files
    const cosmicRon = files.find(f => f.path.includes("cosmic/M3-Gemini-dark.ron"));
    expect(cosmicRon).toBeDefined();

    // Verify Iced files
    const icedRon = files.find(f => f.path.includes("iced/themes/Gemini-dark.ron"));
    expect(icedRon).toBeDefined();
    expect(icedRon!.content as string).toContain("primary:");

    // Verify GTK files
    const gtkCss = files.find(f => f.path.includes("gnome/themes/M3-Gemini/gtk-4.0/gtk.css"));
    expect(gtkCss).toBeDefined();
    expect(gtkCss!.content as string).toContain("#8ab4f8");

    // Verify Chromium files
    const chromiumManifest = files.find(f => f.path.includes("chromium/dark/manifest.json"));
    expect(chromiumManifest).toBeDefined();
  });
});
