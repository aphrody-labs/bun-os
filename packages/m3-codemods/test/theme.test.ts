// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { schemeFromSeed } from "@aphrody/m3-tokens/dynamic-color";
import { MUI_DEFAULT_THEME, muiThemeToTokens, normalizeHex } from "../lib/theme";

describe("normalizeHex", () => {
  test("expands #rgb, lowercases, rejects junk", () => {
    expect(normalizeHex("#FFF")).toBe("#ffffff");
    expect(normalizeHex("6750A4")).toBe("#6750a4");
    expect(normalizeHex("#6750A4")).toBe("#6750a4");
    expect(normalizeHex("rgb(0,0,0)")).toBeNull();
    expect(normalizeHex(42)).toBeNull();
  });
});

describe("muiThemeToTokens", () => {
  const theme = {
    palette: {
      mode: "light" as const,
      primary: { main: "#1976d2", contrastText: "#ffffff" },
      secondary: { main: "#9c27b0" },
      error: { main: "#d32f2f" },
      background: { default: "#fafafa", paper: "#ffffff" },
      text: { primary: "#212121", secondary: "#757575" },
      divider: "#e0e0e0",
    },
    typography: {
      fontFamily: '"Roboto", sans-serif',
      h1: { fontSize: 96, fontWeight: 300, lineHeight: 1.167 },
      body1: { fontSize: 16, lineHeight: 1.5 },
    },
    shape: { borderRadius: 8 },
  };

  test("emits :root light + prefers-color-scheme dark blocks", () => {
    const { css } = muiThemeToTokens(theme);
    expect(css).toContain(":root {");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(":root:not([data-theme])");
    expect(css).toContain(':root[data-theme="light"]');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("--md-sys-color-primary:");
  });

  test("derives the roles MUI lacks from the canonical engine, seeded by primary.main", () => {
    const { lightRoles } = muiThemeToTokens(theme);
    const engine = schemeFromSeed(theme.palette.primary.main);
    for (const role of ["tertiary", "primary-container", "surface-variant", "inverse-surface"])
      expect(lightRoles[role]).toBe(engine[`--md-sys-color-${role}`]!);
    expect(lightRoles["tertiary"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(lightRoles["primary-container"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(lightRoles["surface-variant"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("honours the explicit MUI primary and contrastText", () => {
    const { lightRoles } = muiThemeToTokens(theme);
    expect(lightRoles["primary"]).toBe("#1976d2");
    expect(lightRoles["on-primary"]).toBe("#ffffff");
  });

  test("maps MUI typography variants to M3 typescale", () => {
    const { typescale } = muiThemeToTokens(theme);
    expect(typescale["display-large-size"]).toBe("96px");
    expect(typescale["body-large-size"]).toBe("16px");
    expect(typescale["display-large-font"]).toContain("Roboto");
  });

  test("rescales the whole M3 corner family by borderRadius / 4", () => {
    const { shape } = muiThemeToTokens(theme);
    // borderRadius 8 -> ratio 2 -> medium (base 12) = 24px, small (8) = 16px.
    expect(shape["corner-medium"]).toBe("24px");
    expect(shape["corner-small"]).toBe("16px");
    expect(shape["corner-full"]).toBeUndefined();
  });

  test("uses a separate dark theme when provided", () => {
    const dark = {
      palette: { mode: "dark" as const, primary: { main: "#90caf9" } },
    };
    const { darkRoles } = muiThemeToTokens(theme, { darkTheme: dark });
    expect(darkRoles["primary"]).toBe("#90caf9");
  });

  test("derives dark from the light source without carrying light colours over", () => {
    const { darkRoles } = muiThemeToTokens(theme);
    const engine = schemeFromSeed(theme.palette.primary.main, { dark: true });
    expect(darkRoles["background"]).toBe(engine["--md-sys-color-background"]!);
    expect(darkRoles["primary"]).toBe(engine["--md-sys-color-primary"]!);
  });

  test("migrates the reference theme and the command prints it", async () => {
    expect(muiThemeToTokens(MUI_DEFAULT_THEME).lightRoles["primary"]).toBe("#1976d2");
    const child = Bun.spawn(["bun", `${import.meta.dir}/../scripts/theme.ts`, "--seed", "#0b57d0"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(code).toBe(0);
    expect(stdout).toContain("--md-sys-color-primary: #0b57d0;");
    expect(stdout).toContain("@media (prefers-color-scheme: dark)");
  });
});
