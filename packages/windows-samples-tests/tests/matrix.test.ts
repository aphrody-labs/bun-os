import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cellStatus, compute, LANGS, load, root } from "../src/coverage.ts";
import { IMPLS } from "../src/suites.ts";

const inp = await load();
const win = process.platform === "win32";

describe("manifest", () => {
  test("row ids are unique and every row has all four language cells", () => {
    const ids = inp.manifest.rows.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of inp.manifest.rows) expect(Object.keys(r.cells).sort()).toEqual([...LANGS].sort());
  });

  test("covers the complete D3D12 desktop sample list, the Gallery pages, both .NET channels and the WinAppSDK samples", () => {
    const by = (cat: string) => inp.manifest.rows.filter(r => r.category === cat).length;
    expect(by("d3d12")).toBe(40);
    expect(by("winui-gallery")).toBe(126);
    expect(by("windowsappsdk")).toBe(28);
    expect(by("dotnet10")).toBe(by("dotnet11"));
    expect(by("dotnet10")).toBeGreaterThanOrEqual(20);
  });

  test("every referenced implementation is registered, and its sources exist", () => {
    const ids = new Set(IMPLS.map(i => i.id));
    for (const r of inp.manifest.rows)
      for (const c of Object.values(r.cells)) if (c.impl) expect(ids.has(c.impl)).toBe(true);
    for (const i of IMPLS) expect(existsSync(join(root, i.dir))).toBe(true);
  });

  test("pins in the manifest match the committed gitlinks", async () => {
    const proc = Bun.spawn(["git", "ls-files", "-s", "vendor/microsoft"], { cwd: root, stdout: "pipe" });
    const text = await proc.stdout.text();
    for (const [name, p] of Object.entries(inp.manifest.pins)) {
      const line = text.split("\n").find(l => l.endsWith(`vendor/microsoft/${name}`));
      expect(line?.split(/\s+/)[1], name).toBe(p.sha);
    }
  });
});

describe("recorded results", () => {
  test("every implementation used by a row built, and every runnable one ran", () => {
    for (const r of inp.manifest.rows)
      for (const c of Object.values(r.cells))
        if (c.impl) {
          const res = inp.impls[c.impl];
          expect(res?.build, c.impl).toBe(true);
          if (IMPLS.find(i => i.id === c.impl)?.run) expect(res?.run, c.impl).toBe(true);
        }
  });

  test(".NET 10 and 11 template projects generated and built", () => {
    for (const ch of ["dotnet10", "dotnet11"]) {
      const res = inp.dotnet[ch];
      expect(res, ch).toBeDefined();
      for (const [name, t] of Object.entries(res!.templates)) {
        expect(t.generated, `${ch}/${name}`).toBe(true);
        expect(t.build, `${ch}/${name}`).toBe(true);
        if ("aot" in t) expect(t.aot, `${ch}/${name}`).toBe(true);
      }
    }
  });

  test("computed percentages are consistent with the cell statuses", () => {
    const c = compute(inp);
    for (const l of LANGS) {
      const p = c.perLang[l];
      expect(p.total).toBe(inp.manifest.rows.length);
      expect(Object.values(p.counts).reduce((a, b) => a + b, 0)).toBe(p.total);
    }
    expect(cellStatus({}, inp.manifest.rows[0]!, inp)).toBe("not-started");
  });

  test("docs/WINDOWS-SAMPLES.md is up to date", async () => {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/compute-coverage.ts"), "--check"], { stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);
  });
});

describe.skipIf(!win)("live headless runs", () => {
  test("Bun D3D12 HelloWindow subset renders on WARP", async () => {
    const impl = IMPLS.find(i => i.id === "d3d12-headless-bun")!;
    const r = await impl.run!();
    expect(r.output).toBe("OK 0,51,102,255");
  });

  test("Bun XAML scan reads every Gallery page when the submodule is checked out", async () => {
    const gallery = join(root, "vendor/microsoft/WinUI-Gallery/WinUIGallery/Samples/Button/ButtonPage.xaml");
    if (!existsSync(gallery)) return;
    const { writeXamlList } = await import("../src/suites.ts");
    writeXamlList([gallery]);
    const r = await IMPLS.find(i => i.id === "xaml-static-bun")!.run!();
    expect(r.output.split("\t")[1]).toBe("Page");
  });
});
