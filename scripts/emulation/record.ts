// Pin measured frame hashes into crates/bun-engine-core/tests/rom-suite.json.
// Usage: bun scripts/emulation/record.ts <results.json> [idPrefix] -- only cases that ran (not rom/bios/core missing).
// Verdicts ("pass", "fail: ...", "blank: ...") are human-read from the dumped screens and kept in the manifest.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [resultsPath, prefix = ""] = process.argv.slice(2);
if (!resultsPath) throw new Error("usage: record.ts <results.json> [idPrefix]");
const manifestPath = join(resolve(import.meta.dir, "../.."), "crates/bun-engine-core/tests/rom-suite.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const results = JSON.parse(readFileSync(resultsPath, "utf8")).cases as Array<Record<string, any>>;
let n = 0;
for (const r of results) {
  if (!r.id.startsWith(prefix) || !r.frame_hash || !r.deterministic) continue;
  const c = manifest.cases.find((x: any) => x.id === r.id);
  if (!c) continue;
  c.hash = r.frame_hash;
  n++;
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`pinned ${n} hashes`);
