// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isUsableAppIcon, pngInfo, TAURI_3 } from "@aphrody/scaffold";
import { generateProject, GenerateError } from "../src/generate.ts";
import { planConversion } from "../src/plan.ts";
import { probeDirectory, probeUrl } from "../src/probe.ts";
import type { WrapConfig } from "../src/types.ts";
import { startSite, tempDir, writeTree, type Site } from "./fixtures.ts";

const read = (dir: string, path: string) => Bun.file(join(dir, path)).text();

describe("generateProject: remote", () => {
  let site: Site;
  const dirs: string[] = [];
  beforeAll(() => {
    site = startSite();
  });
  afterAll(async () => {
    site.stop();
    await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function generate(
    options: Parameters<typeof planConversion>[1] = {},
    extra: Parameters<typeof generateProject>[2] = {},
  ) {
    const out = join(await tempDir("w2t-gen-"), "app");
    dirs.push(join(out, ".."));
    const plan = planConversion(await probeUrl(`${site.a}/home`), options);
    const result = await generateProject(plan, out, {
      copyLock: false,
      ...extra,
    });
    return { out, plan, result };
  }

  it("writes a configuration-only Tauri 3 project around the runtime plugin", async () => {
    const { out, plan } = await generate();
    for (const path of [
      "src-tauri/wrap.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
      "src-tauri/build.rs",
      "src-tauri/src/main.rs",
      "src-tauri/capabilities/default.json",
      "src-tauri/icons/icon.png",
      "dist/index.html",
      "package.json",
      "wrap-plan.json",
      "README.md",
    ]) {
      expect(await Bun.file(join(out, path)).exists()).toBe(true);
    }
    expect(JSON.parse(await read(out, "src-tauri/wrap.json"))).toEqual(JSON.parse(JSON.stringify(plan.config)));
    const conf = JSON.parse(await read(out, "src-tauri/tauri.conf.json"));
    expect(conf.app.windows).toEqual([]);
    expect(conf.identifier).toBe(plan.config.identifier);
    expect(conf.bundle.externalBin).toBeUndefined();
    expect(JSON.parse(await read(out, "src-tauri/capabilities/default.json")).permissions).toEqual([]);
    const main = await read(out, "src-tauri/src/main.rs");
    expect(main).toContain('.plugin(tauri_plugin_aphrody::wrap::init(include_str!("../wrap.json")))');
    expect(main).toContain(".runtime(Wry::default())");
  });

  it("pins the Tauri line of the single scaffolder and points at the runtime crate", async () => {
    const { out } = await generate();
    const cargo = await read(out, "src-tauri/Cargo.toml");
    expect(cargo).toContain(`tauri = { version = "=${TAURI_3.tauri}"`);
    expect(cargo).toContain(`tauri-runtime-wry = { version = "=${TAURI_3.runtimeWry}"`);
    // A remote app loads the deployed origin: no bundle server, so no HTTP stack in the build.
    expect(cargo).toMatch(
      /tauri-plugin-aphrody = \{ path = "[^"]*crates\/tauri-plugin-aphrody", default-features = false, features = \["wrap"\] \}/,
    );
    expect(cargo).toContain('debug-bridge = ["tauri-plugin-aphrody/wrap-debug-bridge"]');
    expect(cargo).not.toContain("aphrody-tauri-debug");
    expect(cargo).toContain("[workspace]");
    const main = await read(out, "src-tauri/src/main.rs");
    expect(main).toContain('#[cfg(feature = "debug-bridge")]');
    expect(main).toContain("tauri_plugin_aphrody::wrap::debug::init()");
    expect(main).not.toContain("aphrody_tauri_debug");
    expect(await read(out, "README.md")).toContain("without its `wrap-bundle` feature");
  });

  it("uses the icon of the site when it is a usable PNG", async () => {
    const { out, result } = await generate();
    const icon = new Uint8Array(await Bun.file(join(out, "src-tauri/icons/icon.png")).arrayBuffer());
    expect(pngInfo(icon)).toMatchObject({ width: 512, colorType: 6 });
    expect(isUsableAppIcon(icon)).toBe(true);
    expect(result.notes.join(" ")).not.toContain("placeholder");
  });

  it("falls back to a solid icon in the theme colour when the site has none", async () => {
    const out = join(await tempDir("w2t-gen-"), "app");
    dirs.push(join(out, ".."));
    const probe = {
      ...(await probeUrl(`${site.a}/home`)),
      icons: [],
      manifest: null,
    };
    const result = await generateProject(planConversion(probe), out, {
      copyLock: false,
    });
    const icon = new Uint8Array(await Bun.file(join(out, "src-tauri/icons/icon.png")).arrayBuffer());
    expect(isUsableAppIcon(icon)).toBe(true);
    expect(Array.from(icon.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(result.notes.join(" ")).toContain("placeholder");
  });

  it("copies the repository lock file so versions match the pins", async () => {
    const out = join(await tempDir("w2t-gen-"), "app");
    dirs.push(join(out, ".."));
    const result = await generateProject(planConversion(await probeUrl(`${site.a}/home`)), out);
    expect(await Bun.file(join(out, "src-tauri/Cargo.lock")).exists()).toBe(true);
    expect(result.notes.join(" ")).toContain("Cargo.lock");
  });

  it("generates the Chromium variant with a debug-only DevTools port", async () => {
    const { out } = await generate({ engine: "cef" });
    const cargo = await read(out, "src-tauri/Cargo.toml");
    expect(cargo).toContain("tauri-runtime-cef");
    expect(cargo).not.toContain("tauri-runtime-wry");
    const main = await read(out, "src-tauri/src/main.rs");
    expect(main).toContain("#[tauri_runtime_cef::cef_entry_point]");
    expect(main).toContain("APHRODY_WRAP_CDP_PORT");
  });

  it("refuses a non-empty directory and never overwrites a file, even with force", async () => {
    const out = join(await tempDir("w2t-gen-"), "app");
    dirs.push(join(out, ".."));
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "keep.txt"), "mine");
    const plan = planConversion(await probeUrl(`${site.a}/home`));
    await expect(generateProject(plan, out, { copyLock: false })).rejects.toThrow("not empty");
    await generateProject(plan, out, { copyLock: false, force: true });
    expect(await read(out, "keep.txt")).toBe("mine");
    await expect(generateProject(plan, out, { copyLock: false, force: true })).rejects.toThrow("refusing to overwrite");
  });

  it("fails clearly when the runtime crate cannot be found", async () => {
    const out = join(await tempDir("w2t-gen-"), "app");
    dirs.push(join(out, ".."));
    const plan = planConversion(await probeUrl(`${site.a}/home`));
    await expect(generateProject(plan, out, { wrapCrate: "/nonexistent/tauri-wrap" })).rejects.toBeInstanceOf(
      GenerateError,
    );
  });
});

describe("generateProject: directories", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function fixture(files: Record<string, string>) {
    const src = await tempDir("w2t-src-");
    const out = join(await tempDir("w2t-out-"), "app");
    dirs.push(src, join(out, ".."));
    await writeTree(src, files);
    return { src, out, probe: await probeDirectory(src) };
  }

  it("embeds a static bundle and proxies its API", async () => {
    const { out, probe } = await fixture({
      "dist/index.html": "<html>shop</html>",
      "dist/assets/app.js": `fetch("/api/items")`,
      ".env": "API_URL=https://api.acme.test",
    });
    const plan = planConversion(probe);
    await generateProject(plan, out, { copyLock: false });
    expect(await read(out, "dist/index.html")).toBe("<html>shop</html>");
    expect(await read(out, "dist/assets/app.js")).toContain("/api/items");
    const wrap = JSON.parse(await read(out, "src-tauri/wrap.json")) as WrapConfig;
    expect(wrap.mode).toBe("bundle");
    expect(wrap.bundle).toMatchObject({
      backend: "https://api.acme.test",
      proxy: ["/api"],
    });
    expect(await Bun.file(join(out, "scripts/build-sidecar.ts")).exists()).toBe(false);
    // The bundle mode keeps the crate's default features: the loopback server.
    const cargo = await read(out, "src-tauri/Cargo.toml");
    expect(cargo).toMatch(
      /tauri-plugin-aphrody = \{ path = "[^"]*crates\/tauri-plugin-aphrody", default-features = false, features = \["wrap-bundle"\] \}/,
    );
    expect(await read(out, "README.md")).not.toContain("without its `wrap-bundle` feature");
  });

  it("builds a sidecar binary script and bundles it as an external binary", async () => {
    const { src, out, probe } = await fixture({
      "server.ts": "Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('ok') })",
      "app/api/x/route.ts": "export const GET = () => new Response('x')",
    });
    const plan = planConversion(probe, { port: 4317 });
    await generateProject(plan, out, { copyLock: false });
    const script = await read(out, "scripts/build-sidecar.ts");
    expect(script).toContain(JSON.stringify(src));
    expect(script).toContain('"server.ts"');
    expect(JSON.parse(await read(out, "package.json")).scripts["build:sidecar"]).toBe("bun scripts/build-sidecar.ts");
    expect(JSON.parse(await read(out, "src-tauri/tauri.conf.json")).bundle.externalBin).toEqual(["binaries/server"]);
    expect((JSON.parse(await read(out, "src-tauri/wrap.json")) as WrapConfig).sidecar?.port).toBe(4317);
    // The sidecar is std only: no bundle server in the build.
    expect(await read(out, "src-tauri/Cargo.toml")).toMatch(
      /tauri-plugin-aphrody = \{ path = "[^"]*crates\/tauri-plugin-aphrody", default-features = false, features = \["wrap"\] \}/,
    );
  });

  it("uses the icon of the project when it has a usable PNG", async () => {
    const { solidIconPng } = await import("@aphrody/scaffold");
    const src = await tempDir("w2t-src-");
    const out = join(await tempDir("w2t-out-"), "app");
    dirs.push(src, join(out, ".."));
    await writeTree(src, { "dist/index.html": "<html></html>" });
    await mkdir(join(src, "public"), { recursive: true });
    await writeFile(join(src, "public/icon.png"), solidIconPng(256, [1, 2, 3, 255]));
    await generateProject(planConversion(await probeDirectory(src)), out, {
      copyLock: false,
    });
    const icon = new Uint8Array(await Bun.file(join(out, "src-tauri/icons/icon.png")).arrayBuffer());
    expect(Array.from(icon)).toEqual(Array.from(solidIconPng(256, [1, 2, 3, 255])));
  });
});
