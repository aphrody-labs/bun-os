// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, nearestGnomeAccent, registryValues, themeManifest } from "../src/index.ts";
import { installCommand, run } from "../src/cli.ts";
import { encodePng } from "../src/png.ts";
import { inflateSync } from "node:zlib";

const input = { name: "Test", seed: "#6750a4", mode: "auto" as const };
const text = (path: string): string => {
  const f = generate(input).find(x => x.path === path);
  if (!f) throw new Error(`missing ${path}`);
  return typeof f.content === "string" ? f.content : new TextDecoder().decode(f.content);
};

describe("generate", () => {
  it("is deterministic and covers every target", () => {
    const a = generate(input);
    expect(a).toEqual(generate(input));
    expect(new Set(a.map(f => f.target))).toEqual(new Set(["windows", "gnome", "cosmic", "chromium"]));
  });
  it("rejects bad seeds and names", () => {
    expect(() => generate({ ...input, seed: "nope" })).toThrow();
    expect(() => generate({ ...input, name: "a b" })).toThrow();
  });
  it("carries contrast into each OS format and rejects invalid levels", () => {
    const high = generate({ ...input, contrastLevel: 1 });
    for (const target of ["windows", "gnome", "cosmic", "chromium"] as const) {
      const standard = generate(input, [target]);
      expect(high.filter(file => file.target === target)).not.toEqual(standard);
    }
    expect(run(["generate", "--contrast", "NaN", "--dry-run"]).code).toBe(2);
    expect(run(["generate", "--contrast", "2", "--dry-run"]).code).toBe(2);
    expect(run(["generate", "--contrast", "-0.5", "--dry-run"]).code).toBe(0);
  });
  it("uses the canonical pet seed for an unspecified CLI seed", () => {
    const dir = mkdtempSync(join(tmpdir(), "m3-pet-theme-"));
    try {
      expect(run(["generate", "--target", "chromium", "--out", dir]).code).toBe(0);
      const actual = JSON.parse(readFileSync(join(dir, "chromium/dark/manifest.json"), "utf8"));
      expect(actual).toEqual(themeManifest({ name: "Aphrody", seed: "#6750a4", mode: "auto" }, "dark"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("windows", () => {
  it("derives Personalize and DWM values from the roles", () => {
    const light = registryValues(input, "light");
    const dark = registryValues(input, "dark");
    expect(light.find(v => v.name === "AppsUseLightTheme")?.value).toBe(1);
    expect(dark.find(v => v.name === "SystemUsesLightTheme")?.value).toBe(0);
    const accent = light.find(v => v.name === "AccentColor")!.value as number;
    expect(accent >>> 24).toBe(255);
    const pal = light.find(v => v.name === "AccentPalette")!.value as number[];
    expect(pal).toHaveLength(32);
  });
  it("emits theme files and a reversible idempotent script", () => {
    expect(text("windows/M3-Test-dark.theme")).toContain("[VisualStyles]");
    const ps = text("windows/install-windows.ps1");
    expect(ps).toContain("Themes\\Personalize");
    expect(ps).toContain("AccentColor");
    expect(ps).toContain("-Uninstall");
    expect(ps).toContain("SupportsShouldProcess");
    expect(ps).toContain("if (-not (Test-Path $Backup))");
  });
});

describe("gnome", () => {
  it("writes shell, gtk-3.0 and gtk-4.0 css plus the gsettings installer", () => {
    const paths = generate(input, ["gnome"]).map(f => f.path);
    for (const p of [
      "gnome-shell/gnome-shell.css",
      "gtk-3.0/gtk.css",
      "gtk-4.0/gtk.css",
      "gtk-4.0/gtk-dark.css",
      "index.theme",
    ]) {
      expect(paths).toContain(`gnome/themes/M3-Test/${p}`);
    }
    const sh = text("gnome/install-gnome.sh");
    expect(sh).toContain("gsettings set");
    expect(sh).toContain("--uninstall");
    expect(text("gnome/themes/M3-Test/gtk-4.0/gtk.css")).toContain("@define-color accent_bg_color");
  });
  it("maps a seed to the nearest GNOME accent", () => {
    expect(nearestGnomeAccent("#3584e4")).toBe("blue");
    expect(nearestGnomeAccent("#e62d42")).toBe("red");
  });
});

describe("windows installer script", () => {
  it("never reuses $Values for the snapshot (PowerShell variable names are case-insensitive)", () => {
    const ps = text("windows/install-windows.ps1");
    expect(ps.match(/^\s*\$values\s*=/gim)).toHaveLength(1);
    expect(ps).toContain("$snapValues = foreach");
    expect(ps).toContain("@($snapValues)");
  });
});

describe("cosmic", () => {
  it("writes RON builder keys for both modes", () => {
    expect(text("cosmic/config/com.system76.CosmicTheme.Dark.Builder/v2/accent")).toMatch(
      /^Some\(\(red: 0\.\d+, green: 0\.\d+, blue: 0\.\d+\)\)$/,
    );
    expect(text("cosmic/config/com.system76.CosmicTheme.Light.Builder/v2/bg_color")).toContain("alpha: 1.000000");
    expect(text("cosmic/M3-Test-dark.ron")).toContain("accent: Some(");
    expect(text("cosmic/install-cosmic.sh")).toContain("--uninstall");
  });
});

describe("chromium", () => {
  it("builds a valid MV3 theme manifest with colors, tints and images", () => {
    const m = themeManifest(input, "dark");
    expect(m.manifest_version).toBe(3);
    expect(m.theme.colors["frame"]).toHaveLength(3);
    expect(m.theme.tints["buttons"]).toEqual([-1, -1, -1]);
    expect(m.theme.images["theme_ntp_background"]).toBe("images/ntp.png");
    expect(JSON.parse(text("chromium/light/manifest.json")).theme.colors.toolbar).toHaveLength(3);
  });
  it("emits a PNG and BrowserThemeColor policies", () => {
    const png = generate(input, ["chromium"]).find(f => f.path === "chromium/dark/images/ntp.png")!
      .content as Uint8Array;
    expect(Array.from(png.slice(0, 4))).toEqual([137, 80, 78, 71]);
    expect(JSON.parse(text("chromium/policies/managed/m3-theme-dark.json")).BrowserThemeColor).toMatch(
      /^#[0-9a-f]{6}$/,
    );
    expect(text("chromium/policies/windows/m3-theme-light.reg")).toContain("BraveSoftware\\Brave");
  });
  it("stores IDAT in the zlib format", () => {
    const png = encodePng(3, 2, (x, y) => [x, y, 7]);
    const view = new DataView(png.buffer, png.byteOffset);
    const ihdr = 8 + 12 + view.getUint32(8);
    const idat = png.subarray(ihdr + 8, ihdr + 8 + view.getUint32(ihdr));
    expect(new TextDecoder().decode(png.subarray(ihdr + 4, ihdr + 8))).toBe("IDAT");
    expect(idat[0]! & 0x0f).toBe(8);
    expect(((idat[0]! << 8) | idat[1]!) % 31).toBe(0);
    expect(Array.from(inflateSync(idat))).toEqual([0, 0, 0, 7, 1, 0, 7, 2, 0, 7, 0, 0, 1, 7, 1, 1, 7, 2, 1, 7]);
  });
});

describe("cli", () => {
  it("install is dry-run by default and never executes", () => {
    const calls: string[][] = [];
    const r = run(["install", "--target", "all", "--seed", "#336699", "--mode", "dark"], c => (calls.push(c), 0));
    expect(r.code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(r.out.join("\n")).toContain("dry-run");
  });
  it("generate writes only into --out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m3os-"));
    try {
      const r = run(["generate", "--target", "chromium", "--seed", "#336699", "--out", dir]);
      expect(r.code).toBe(0);
      expect(await Bun.file(join(dir, "chromium/dark/manifest.json")).exists()).toBe(true);
      expect(readdirSync(dir)).toEqual(["chromium"]);
      expect(await Bun.file(join(dir, "chromium/install-chromium.md")).text()).toContain("Load unpacked");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("rejects bad input", () => {
    expect(run(["generate", "--target", "mac"]).code).toBe(2);
    expect(run(["generate", "--seed", "zz"]).code).toBe(2);
  });
});

describe("icon theme", () => {
  it("passes --icons to the GNOME and COSMIC installers on install only", () => {
    for (const t of ["gnome", "cosmic"] as const) {
      const on = installCommand(t, "/o", "dark", false, "linux", "/i/Aphrody-M3").cmd;
      expect(on.slice(-2)).toEqual(["--icons", "/i/Aphrody-M3"]);
      expect(installCommand(t, "/o", "dark", true, "linux", "/i/Aphrody-M3").cmd).not.toContain("--icons");
    }
  });
  it.skipIf(process.platform === "win32")(
    "installs and restores the icon theme in a sandbox home (GNOME and COSMIC)",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "m3os-icons-"));
      try {
        const out = join(root, "out");
        expect(run(["generate", "--target", "gnome", "--out", out]).code).toBe(0);
        expect(run(["generate", "--target", "cosmic", "--out", out]).code).toBe(0);
        const icons = join(root, "Fixture-Icons");
        mkdirSync(join(icons, "scalable/material"), { recursive: true });
        await Bun.write(join(icons, "index.theme"), "[Icon Theme]\nName=Fixture-Icons\n");
        await Bun.write(join(icons, "scalable/material/home.svg"), "<svg/>");
        const data = join(root, "data");
        const conf = join(root, "conf");
        const key = join(conf, "cosmic/com.system76.CosmicTk/v1/icon_theme");
        mkdirSync(join(conf, "cosmic/com.system76.CosmicTk/v1"), {
          recursive: true,
        });
        await Bun.write(key, '"Cosmic"');
        const sh = (script: string, ...a: string[]) =>
          Bun.spawnSync(["bash", join(out, script), ...a], {
            windowsHide: true,
            env: { ...process.env, XDG_DATA_HOME: data, XDG_CONFIG_HOME: conf },
            stdout: "pipe",
            stderr: "pipe",
          });

        expect(sh("gnome/install-gnome.sh", "--mode", "dark", "--icons", icons).exitCode).toBe(0);
        expect(await Bun.file(join(data, "icons/Fixture-Icons/scalable/material/home.svg")).exists()).toBe(true);
        expect(sh("cosmic/install-cosmic.sh", "--mode", "dark", "--icons", icons).exitCode).toBe(0);
        expect(await Bun.file(key).text()).toBe('"Fixture-Icons"');

        expect(sh("cosmic/install-cosmic.sh", "--uninstall").exitCode).toBe(0);
        expect(await Bun.file(key).text()).toBe('"Cosmic"');
        expect(sh("gnome/install-gnome.sh", "--uninstall").exitCode).toBe(0);
        expect(existsSync(join(data, "icons/Fixture-Icons"))).toBe(false);

        const bad = sh("gnome/install-gnome.sh", "--icons", join(root, "missing"));
        expect(bad.exitCode).toBe(2);
        expect(bad.stderr.toString()).toContain("has no index.theme");
      } finally {
        rmSync(root, { recursive: true });
      }
    },
  );
});
