// SPDX-License-Identifier: Apache-2.0
//! Ratchet on the products that left for aphrody-labs/shenron on 2026-10-05.
//!
//!   bun scripts/audit/workspace/product-residue.ts [--json] [--write-baseline]
//!
//! Counts, per tracked file, the lines that name Shenron, Koharu, Dragon Ball or the databooks.
//! `tools/config/product-residue.baseline.json` holds what Aphrody keeps on purpose: the Infra host
//! plane and dated records. A file missing from the baseline
//! or above its count fails; `--write-baseline` records the current counts, which may only go down.

import { lstatSync } from "node:fs";
import { resolve } from "node:path";

export const PRODUCT = /shenron|koharu|dragon[ _-]?ball|databook/i;

/** Evidence trees and generated catalogues that record history or are rebuilt by their owner. */
const EXCLUDED = [
  /^docs\/migration\//,
  /^py\/docs\/migration\//,
  /^docs\/llms\.txt$/,
  /^docs\/reference\/workspace\/documentation\.json$/,
  /(^|\/)CHANGELOG\.md$/,
  /\.lock$/,
  /^tools\/config\/product-residue\.baseline\.json$/,
  // The audit names the products it looks for.
  /^scripts\/audit\/workspace\/product-residue(\.test)?\.ts$/,
];

export interface Finding {
  kind: "new-file" | "regression";
  file: string;
  count: number;
  baseline: number;
}

export interface Report {
  schema: "aphrody.product-residue/1";
  ok: boolean;
  files: number;
  lines: number;
  findings: Finding[];
  /** Files now below their baseline: run --write-baseline to lock the gain in. */
  shrunk: string[];
}

/** Number of lines of `text` that name a departed product. */
export function residueLines(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) if (PRODUCT.test(line)) count++;
  return count;
}

export function excluded(path: string): boolean {
  return EXCLUDED.some(pattern => pattern.test(path));
}

export function evaluate(counts: Record<string, number>, baseline: Record<string, number>): Report {
  const findings: Finding[] = [];
  const shrunk: string[] = [];
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline[file];
    if (allowed === undefined) findings.push({ kind: "new-file", file, count, baseline: 0 });
    else if (count > allowed) findings.push({ kind: "regression", file, count, baseline: allowed });
  }
  for (const [file, allowed] of Object.entries(baseline)) if ((counts[file] ?? 0) < allowed) shrunk.push(file);
  return {
    schema: "aphrody.product-residue/1",
    ok: findings.length === 0,
    files: Object.keys(counts).length,
    lines: Object.values(counts).reduce((sum, count) => sum + count, 0),
    findings,
    shrunk,
  };
}

/** Residue line counts of every tracked text file, keyed by repository path. */
export async function countResidue(root: string): Promise<Record<string, number>> {
  const listing = await Bun.$`git ls-files -z`.cwd(root).quiet().text();
  const counts: Record<string, number> = {};
  for (const path of listing.split("\0")) {
    if (!path || excluded(path)) continue;
    const absolute = resolve(root, path);
    // Deleted-but-unstaged paths, submodule entries and symbolic links (counted at their target).
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > 8_000_000) continue;
    // oxlint-disable-next-line no-await-in-loop -- One file in memory at a time across the whole checkout.
    const bytes = new Uint8Array(await Bun.file(absolute).arrayBuffer());
    if (bytes.subarray(0, 8000).includes(0)) continue;
    const count = residueLines(new TextDecoder().decode(bytes));
    if (count > 0) counts[path] = count;
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)));
}

if (import.meta.main) {
  const args = new Set(Bun.argv.slice(2));
  const root = resolve(import.meta.dir, "../../../../");
  const baselinePath = resolve(root, "tools/config/product-residue.baseline.json");
  const counts = await countResidue(root);
  if (args.has("--write-baseline"))
    await Bun.write(baselinePath, `${JSON.stringify({ schemaVersion: 1, files: counts }, null, 2)}\n`);
  const baselineFile = Bun.file(baselinePath);
  const baseline: Record<string, number> = (await baselineFile.exists()) ? (await baselineFile.json()).files : {};
  const report = evaluate(counts, baseline);
  if (args.has("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    for (const finding of report.findings)
      console.log(`error ${finding.kind} ${finding.file}: ${finding.count} line(s), baseline ${finding.baseline}`);
    if (report.shrunk.length) console.log(`info ${report.shrunk.length} file(s) below baseline: run --write-baseline`);
    console.log(`product-residue: ${report.ok ? "ok" : "FAILED"} (${report.lines} line(s) in ${report.files} file(s))`);
  }
  process.exit(report.ok ? 0 : 1);
}
