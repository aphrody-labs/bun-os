// SPDX-License-Identifier: Apache-2.0
// Desktop and OS targets: tauri (@aphrody/web-to-tauri, @aphrody/scaffold), webos (Bun.WebView,
// @aphrody/bun-webview-page), windows (icon through m3-svg-to-ico, registry inspection), os-themes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadApp } from "../src/config.ts";
import {
  contextFor,
  generateTargets,
  inspectWindows,
  verifyWebView,
  windowsIcon,
  type TargetContext,
} from "../src/targets/index.ts";
import { iconFile, pngSvg } from "../src/targets/windows.ts";
import { cleanup, FIXTURE, tmp } from "./helpers.ts";

afterAll(cleanup);

const onWindows = process.platform === "win32";

let ctx: TargetContext;
let out = "";
const read = (id: string, file: string) => readFileSync(join(out, id, file), "utf8");

beforeAll(async () => {
  out = tmp("m3-bun-desktop-");
  ctx = contextFor(await loadApp(FIXTURE));
  await generateTargets(["tauri", "webos", "windows", "os-themes"], ctx, out);
}, 120_000);

describe("tauri", () => {
  test("web-to-tauri plans a sidecar project on the scaffold pins; the compiled app is the sidecar", async () => {
    const { TAURI_3 } = await import("@aphrody/scaffold/pins");
    const conf = JSON.parse(read("tauri", "src-tauri/tauri.conf.json"));
    expect(conf).toMatchObject({
      productName: "hello-m3",
      identifier: "io.aphrody.app.hello-m3",
      version: "1.2.3",
    });
    expect(conf.bundle.externalBin).toEqual(["binaries/server"]);
    const wrap = JSON.parse(read("tauri", "src-tauri/wrap.json"));
    expect(wrap).toMatchObject({
      mode: "sidecar",
      sidecar: { program: "server", port: 3456, readyPath: "/healthz" },
    });
    const pkg = JSON.parse(read("tauri", "package.json"));
    expect(pkg.devDependencies["@tauri-apps/cli"]).toBe(TAURI_3.jsCli);
    expect(pkg.scripts["build:sidecar"]).toBe("bun scripts/build-sidecar.ts");
    const cargo = read("tauri", "src-tauri/Cargo.toml");
    expect(cargo).toContain(`tauri = { version = "=${TAURI_3.tauri}"`);
    const crate = /tauri-plugin-aphrody = \{ path = "([^"]+)"/.exec(cargo)![1]!;
    expect(existsSync(join(resolve(out, "tauri/src-tauri", crate), "Cargo.toml"))).toBe(true);
    const sidecar = read("tauri", "scripts/build-sidecar.ts");
    expect(sidecar).toContain("/host: (\\S+)/");
    expect(sidecar).toContain('"compile", "--outfile"');
    expect(new Bun.Transpiler({ loader: "ts" }).scan(sidecar).imports.map(i => i.path)).toEqual(["node:path"]);
  });
});

describe("webos", () => {
  test("desktop.ts opens the compiled app in a Bun.WebView window and smoke-checks it with verifyWebView", () => {
    const desktop = read("webos", "desktop.ts");
    expect(desktop).toContain('backend: { type: "chrome", url: false }');
    expect(desktop).toContain("headless: false");
    expect(desktop).toContain('"Target.detachedFromTarget"');
    expect(desktop).toContain('import("@aphrody/m3-bun/targets")');
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(desktop)).not.toThrow();
    expect(read("webos", "README.md")).toContain("no external-app manifest");
  });

  const chrome =
    process.env.BUN_CHROME_PATH ??
    Bun.which("chrome") ??
    Bun.which("chromium") ??
    Bun.which("google-chrome") ??
    [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ].find(existsSync);
  test.skipIf(!chrome || typeof Bun.WebView !== "function")(
    "verifyWebView loads a page through @aphrody/bun-webview-page and reports title, health and console errors",
    async () => {
      await using server = Bun.serve({
        port: 0,
        routes: {
          "/healthz": new Response("ok"),
          "/": new Response('<!doctype html><title>Hello M3</title><script>console.error("boom")</script>', {
            headers: { "Content-Type": "text/html" },
          }),
        },
      });
      const report = await verifyWebView(`http://127.0.0.1:${server.port}/`, {
        screenshot: true,
      });
      expect({
        ...report,
        screenshot: report.screenshot?.slice(0, 4),
      }).toMatchObject({
        title: "Hello M3",
        status: 200,
        healthy: true,
        errors: ["boom"],
        ok: false,
        screenshot: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      });
    },
    60_000,
  );
});

describe("windows", () => {
  test("the default icon is the @aphrody/identity emblem as a square SVG; a configured .ico is taken as is", async () => {
    const svg = read("windows", "icon.svg");
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="192" height="192"');
    const png = Buffer.from(/base64,([^"]+)"/.exec(svg)![1]!, "base64");
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(pngSvg(new Uint8Array([1]), 8)).toContain('viewBox="0 0 8 8"');
    const dir = tmp();
    await Bun.write(join(dir, "app.ico"), new Uint8Array([0, 0, 1, 0]));
    const ico = await iconFile({
      ...ctx,
      appDir: dir,
      windows: { icon: "app.ico" },
    });
    expect(ico).toEqual({
      path: "icons/icon.ico",
      content: new Uint8Array([0, 0, 1, 0]),
    });
    await expect(iconFile({ ...ctx, appDir: dir, windows: { icon: "app.png" } })).rejects.toThrow(/does not exist/);
  });

  const tauriCli = Bun.which("tauri");
  test.skipIf(!tauriCli)(
    "windowsIcon turns the generated icon.svg into icon.ico through m3-svg-to-ico",
    () => {
      const dir = tmp();
      const ico = windowsIcon(join(out, "windows", "icon.svg"), join(dir, "icons"));
      const bytes = readFileSync(ico);
      expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
      expect(bytes.readUInt16LE(4)).toBeGreaterThan(1);
      expect(existsSync(join(dir, "icons", "icon.icns"))).toBe(true);
    },
    60_000,
  );

  test.skipIf(!onWindows)(
    "inspectWindows reads shortcuts, the uninstall entry and the service without writing",
    async () => {
      const report = await inspectWindows({
        name: `m3-bun-absent-${process.pid}`,
        version: "1.2.3",
      });
      expect(report).toMatchObject({
        executable: { exists: false },
        shortcuts: { startMenu: { exists: false }, desktop: { exists: false } },
        uninstall: null,
        service: null,
        upToDate: false,
      });
      expect(report.shortcuts.startMenu.path).toEndWith(join("Programs", `m3-bun-absent-${process.pid}.lnk`));
    },
  );
  test.skipIf(onWindows)("inspectWindows runs on Windows only", async () => {
    await expect(inspectWindows({ name: "x", version: "1" })).rejects.toThrow(/Windows only/);
  });
});

describe("os-themes", () => {
  test("@aphrody/m3-os-themes files for every desktop, installers executable, README lists their commands", () => {
    for (const file of [
      "windows/M3-hello-m3-light.theme",
      "windows/install-windows.ps1",
      "gnome/install-gnome.sh",
      "cosmic/install-cosmic.sh",
      "chromium/install-chromium.sh",
    ])
      expect(existsSync(join(out, "os-themes", file))).toBe(true);
    const wallpaper = readFileSync(join(out, "os-themes", "windows/wallpaper-hello-m3-dark.png"));
    expect([...wallpaper.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    if (process.platform !== "win32")
      expect(statSync(join(out, "os-themes", "gnome/install-gnome.sh")).mode & 0o111).not.toBe(0);
    const readme = read("os-themes", "README.md");
    expect(readme).toContain("seed `#6750a4`");
    expect(readme).toContain("`bash gnome/install-gnome.sh --mode auto`");
    expect(readme).toContain("windows/install-windows.ps1 -Mode auto");
  });
});
