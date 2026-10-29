// Render the console support matrix from MEASURED ROM-suite results only.
// Usage: bun scripts/emulation/matrix.ts <results.json> [--write] [--check]
//   --write  update docs/emulation-results.json (timings stripped) and the matrix block of docs/EMULATION.md
//   --check  fail when the measured statuses/hashes differ from the committed docs/emulation-results.json
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const resultsPath = args.find(a => !a.startsWith("--"));
if (!resultsPath) throw new Error("usage: matrix.ts <results.json> [--write] [--check]");
const consoles = JSON.parse(readFileSync(join(import.meta.dir, "consoles.json"), "utf8")).consoles as Array<
  Record<string, string>
>;
const manifest = JSON.parse(readFileSync(join(root, "crates/bun-engine-core/tests/rom-suite.json"), "utf8"))
  .cases as Array<Record<string, string>>;
const raw = JSON.parse(readFileSync(resultsPath, "utf8")).cases as Array<Record<string, any>>;
const verdictOf = new Map(manifest.map(c => [c.id, c.verdict ?? ""]));

// Stable, timing-free record of what was measured.
const stable = raw.map(c => ({
  id: c.id,
  console: c.console,
  core: c.core,
  status: c.status,
  verdict: verdictOf.get(c.id) ?? "",
  frames: c.frames,
  screens: c.screens ?? null,
  distinct_colors: c.distinct_colors ?? null,
  frame_hash: c.frame_hash ?? null,
  audio_hash: c.audio_hash ?? null,
  deterministic: c.deterministic ?? null,
  savestate_roundtrip: c.savestate_roundtrip ?? null,
  rom_sha256: c.rom_sha256 ?? null,
}));
const committedPath = join(root, "docs/emulation-results.json");

if (args.includes("--check")) {
  const old = JSON.parse(readFileSync(committedPath, "utf8")).cases as typeof stable;
  const diffs: string[] = [];
  for (const c of stable) {
    // A case whose ROM or BIOS is not available in this run is not a measurement; skip it.
    if (["rom-missing", "bios-missing", "core-missing", "not-built"].includes(c.status)) continue;
    const o = old.find(x => x.id === c.id);
    if (!o) diffs.push(`${c.id}: not in committed results`);
    else if (o.status !== c.status || (c.status !== "volatile" && o.frame_hash !== c.frame_hash)) {
      diffs.push(`${c.id}: ${o.status}/${o.frame_hash?.slice(0, 8)} -> ${c.status}/${c.frame_hash?.slice(0, 8)}`);
    }
  }
  if (diffs.length) {
    console.error("measured results differ from docs/emulation-results.json:\n" + diffs.join("\n"));
    process.exit(1);
  }
  console.log(`check ok (${stable.length} cases)`);
}

const rows: string[] = [
  "| Console | Route | Core | Status (measured) | Cases | Needs |",
  "| --- | --- | --- | --- | --- | --- |",
];
const summary: Array<Record<string, unknown>> = [];
for (const k of consoles) {
  const cs = stable.filter(c => c.console === k.id);
  const absent = new Set(["rom-missing", "bios-missing", "core-missing", "not-built"]);
  const ran = cs.filter(c => !absent.has(c.status));
  const good = new Set(["ok", "volatile"]);
  const ok = ran.filter(c => good.has(c.status));
  const pass = ok.filter(c => c.verdict.startsWith("pass"));
  const broken = ran.filter(c => !good.has(c.status));
  let status: string;
  if (k.route === "none") status = "not available";
  else if (cs.length === 0)
    status = k.route === "in-tree" ? "in tree, not measured" : `packaged route (${k.route}), not measured in CI`;
  else if (ran.length === 0) status = "not measured (inputs absent in the recorded run)";
  else if (pass.length === ran.length) status = `boots homebrew (${pass.length}/${ran.length} test ROMs pass)`;
  else if (pass.length > 0) status = `boots homebrew, ${pass.length}/${ran.length} test ROMs pass`;
  else status = `runs, no case passes (${ran.length} measured)`;
  if (broken.length) status += `; REGRESSION: ${broken.map(c => c.id + " " + c.status).join(", ")}`;
  const detail = cs.length
    ? cs
        .map(c => `${c.id.replace(/^[a-z0-9]+-/, "")}: ${absent.has(c.status) || !c.verdict ? c.status : c.verdict}`)
        .join("<br>")
    : "";
  rows.push(`| ${k.name} | ${k.route} | ${k.core} | ${status} | ${detail} | ${k.needs} |`);
  summary.push({ console: k.id, route: k.route, status, cases: cs.length, ok: ok.length });
}
const block = rows.join("\n");

if (args.includes("--write")) {
  writeFileSync(
    committedPath,
    JSON.stringify(
      {
        note: "Measured by crates/bun-engine-core/tests/rom_suite.rs; timings omitted on purpose.",
        cases: stable,
        summary,
      },
      null,
      2,
    ) + "\n",
  );
  const doc = join(root, "docs/EMULATION.md");
  const text = readFileSync(doc, "utf8");
  const re = /<!-- matrix:start -->[\s\S]*<!-- matrix:end -->/;
  if (!re.test(text)) throw new Error("docs/EMULATION.md has no matrix markers");
  writeFileSync(
    doc,
    text.replace(re, () => `<!-- matrix:start -->\n${block}\n<!-- matrix:end -->`),
  );
  console.log("wrote docs/emulation-results.json and the matrix block");
} else console.log(block);
