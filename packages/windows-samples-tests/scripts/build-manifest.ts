#!/usr/bin/env bun
/**
 * Builds manifest/coverage.json: one row per sample or feature of the pinned Microsoft references (vendor/microsoft/PINS.json),
 * with the implementation id of each language where we have one. Rows are derived from the pinned trees (gh api), never typed.
 *   bun packages/windows-samples-tests/scripts/build-manifest.ts
 */
import { join, resolve } from "node:path";
import { TEMPLATES } from "./generate-dotnet-templates.ts";

const root = resolve(import.meta.dir, "../../..");
const pins = (await Bun.file(join(root, "vendor/microsoft/PINS.json")).json()).pins as Record<
  string,
  { repo: string; sha: string; ref: string }
>;

const tree = async (name: string) => {
  const p = pins[name]!;
  const proc = Bun.spawn(
    ["gh", "api", `repos/${p.repo}/git/trees/${p.sha}?recursive=1`, "--jq", ".tree[]|[.type,.path]|@tsv"],
    { stdout: "pipe" },
  );
  const text = await proc.stdout.text();
  if (await proc.exited) throw new Error(`tree ${name}`);
  return text
    .split("\n")
    .filter(Boolean)
    .map(l => l.split("\t") as [string, string]);
};

type Cell = { impl?: string; dotnet?: string };
interface Row {
  id: string;
  category: string;
  title: string;
  source: { repo: string; pin: string; path: string };
  /** The official sample needs a window or user interaction. */
  interactive: boolean;
  cells: { cpp: Cell; cs: Cell; rust: Cell; bun: Cell };
}
const rows: Row[] = [];
const empty = (): Row["cells"] => ({ cpp: {}, cs: {}, rust: {}, bun: {} });
const LANGS = ["cpp", "cs", "rust", "bun"] as const;
const add = (r: Omit<Row, "cells"> & { cells?: Partial<Row["cells"]> }) =>
  rows.push({ ...r, cells: { ...empty(), ...r.cells } });
const all = (suite: string): Row["cells"] =>
  Object.fromEntries(LANGS.map(l => [l, { impl: `${suite}-${l}` }])) as Row["cells"];

// 1. WinUI Gallery control pages
const gallery = await tree("WinUI-Gallery");
for (const [type, path] of gallery) {
  const m = /^WinUIGallery\/Samples\/([^/]+)\/\1Page\.xaml$/.exec(path);
  if (type !== "blob" || !m) continue;
  add({
    id: `winui-gallery:${m[1]}`,
    category: "winui-gallery",
    title: `${m[1]} page`,
    source: { repo: pins["WinUI-Gallery"]!.repo, pin: pins["WinUI-Gallery"]!.sha, path },
    interactive: true,
    cells: all("xaml-static"),
  });
}

// 2. Direct3D 12 samples
const dx = await tree("DirectX-Graphics-Samples");
const dxSrc = (path: string) => ({
  repo: pins["DirectX-Graphics-Samples"]!.repo,
  pin: pins["DirectX-Graphics-Samples"]!.sha,
  path,
});
for (const [type, path] of dx) {
  if (type !== "tree") continue;
  let m = /^Samples\/Desktop\/(D3D12[^/]+)$/.exec(path);
  if (m && m[1] !== "D3D12HelloWorld")
    add({ id: `d3d12:${m[1]}`, category: "d3d12", title: m[1]!, source: dxSrc(path), interactive: true });
  m = /^Samples\/Desktop\/D3D12HelloWorld\/src\/([^/]+)$/.exec(path);
  if (m)
    add({
      id: `d3d12:HelloWorld/${m[1]}`,
      category: "d3d12",
      title: `D3D12HelloWorld ${m[1]}`,
      source: dxSrc(path),
      interactive: true,
      cells: m[1] === "HelloWindow" ? all("d3d12-headless") : {},
    });
}

// 3. Windows App SDK feature samples
const was = await tree("WindowsAppSDK-Samples");
for (const [type, path] of was) {
  const m = /^Samples\/([^/]+)$/.exec(path);
  if (type !== "tree" || !m || m[1] === "localpackages") continue;
  add({
    id: `windowsappsdk:${m[1]}`,
    category: "windowsappsdk",
    title: m[1]!,
    source: { repo: pins["WindowsAppSDK-Samples"]!.repo, pin: pins["WindowsAppSDK-Samples"]!.sha, path },
    interactive: true,
  });
}

// 4. .NET 10 and .NET 11 SDK templates (official `dotnet new`), analogs for the other languages where one exists
const analog: Record<string, string> = { console: "hello", "console-aot": "hello-aot", classlib: "libadd" };
for (const ch of ["10", "11"]) {
  for (const t of TEMPLATES) {
    const suite = analog[t.name];
    add({
      id: `dotnet${ch}:${t.name}`,
      category: `dotnet${ch}`,
      title: `dotnet new ${t.short}${t.args ? " " + t.args.join(" ") : ""} (net${ch}.0)`,
      source: {
        repo: "dotnet/sdk",
        pin: `sdk ${ch === "10" ? "10.0.403" : "11.0.100-rc.3.26522.148"}`,
        path: `examples/windows/dotnet${ch}/${t.name}`,
      },
      interactive: !!t.interactive,
      cells: {
        cs: { dotnet: `dotnet${ch}/${t.name}` },
        ...(suite
          ? Object.fromEntries((["cpp", "rust", "bun"] as const).map(l => [l, { impl: `${suite}-${l}` }]))
          : {}),
      },
    });
  }
}

rows.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
const out = {
  schemaVersion: 1,
  pins: Object.fromEntries(Object.entries(pins).map(([k, v]) => [k, { repo: v.repo, ref: v.ref, sha: v.sha }])),
  rows,
};
await Bun.write(join(import.meta.dir, "../manifest/coverage.json"), JSON.stringify(out, null, 1) + "\n");
const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.category] = (a[r.category] ?? 0) + 1), a), {});
console.log(rows.length, "rows", counts);
