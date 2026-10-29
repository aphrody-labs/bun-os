#!/usr/bin/env bun
/**
 * Builds and runs every implementation of the matrix and records the outcome in manifest/results.json.
 *   bun packages/windows-samples-tests/scripts/run-matrix.ts [--only=id,id] [--no-build]
 * The .NET template rows are produced by scripts/generate-dotnet-templates.ts (examples/windows/dotnet10 and dotnet11, results.json).
 */
import { join, resolve } from "node:path";
import { IMPLS, implById, writeXamlList } from "../src/suites.ts";
import { repoRoot } from "../src/dotnet.ts";

const only = Bun.argv.find(a => a.startsWith("--only="))?.slice(7).split(",");
const build = !Bun.argv.includes("--no-build");
const manifest = await Bun.file(join(import.meta.dir, "../manifest/coverage.json")).json();
const resultsPath = join(import.meta.dir, "../manifest/results.json");
const prev = (await Bun.file(resultsPath).exists()) ? await Bun.file(resultsPath).json() : { impls: {} };

const pages = manifest.rows
  .filter((r: any) => r.category === "winui-gallery")
  .map((r: any) => resolve(repoRoot, "vendor/microsoft/WinUI-Gallery", r.source.path))
  .sort();
writeXamlList(pages);

const used = new Set<string>();
for (const r of manifest.rows) for (const c of Object.values(r.cells) as any[]) if (c.impl) used.add(c.impl);
const ids = IMPLS.map(i => i.id).filter(id => used.has(id) && (!only || only.includes(id)));
const results = { ...prev.impls };
let reference = "";
for (const id of ["xaml-static-bun", ...ids.filter(i => i !== "xaml-static-bun")]) {
  if (!ids.includes(id)) continue;
  const impl = implById(id)!;
  const rec: Record<string, unknown> = { lang: impl.lang, dir: impl.dir, scope: impl.scope, at: new Date().toISOString() };
  const b = build ? await impl.build() : { ok: results[id]?.build ?? false, log: "" };
  rec.build = b.ok;
  if (!b.ok) rec.log = b.log;
  if (b.ok && impl.run) {
    const r = await impl.run();
    let ok = r.ok;
    if (id.startsWith("xaml-static")) {
      if (id === "xaml-static-bun") reference = r.output;
      const lines = r.output.split("\n").filter(Boolean);
      const wrong = lines.filter(l => !/^(pages:ItemsPageBase|Page)$/.test(l.split("\t")[1] ?? "") || Number(l.split("\t")[2]) < 1);
      ok = ok && lines.length === pages.length && wrong.length === 0 && (id === "xaml-static-bun" || r.output === reference);
      rec.pages = lines.length;
    }
    rec.run = ok;
    if (!ok) rec.output = r.output.slice(0, 400);
  }
  results[id] = rec;
  console.log(id, "build", rec.build, "run", rec.run ?? "-");
}
await Bun.write(resultsPath, JSON.stringify({ observedAt: new Date().toISOString(), host: process.platform, bun: Bun.version, impls: results }, null, 1) + "\n");
