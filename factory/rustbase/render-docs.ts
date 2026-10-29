#!/usr/bin/env bun
/**
 * Rewrites the generated regions of docs/RUSTBASE.md from catalog.json (markers rustbase:table, rustbase:gaps,
 * rustbase:licenses). Prose outside the markers is hand-written.
 *   bun factory/rustbase/render-docs.ts [--check]
 */
import { join, resolve } from "node:path";

const dir = import.meta.dir;
const file = resolve(dir, "../../docs/RUSTBASE.md");
const catalog = await Bun.file(join(dir, "catalog.json")).json();
const checkOnly = process.argv.includes("--check");

const num = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const chosen = (d: any) => d.candidates.find((c: any) => c.repo === d.pick);
const archCell = (c: any) =>
  c.arch.official ? `${c.arch.official.repo}/${c.arch.official.pkgname} ${c.arch.official.version}` : c.arch.cachyosRecipe ? `cachyos:${c.arch.cachyosRecipe}` : c.arch.aur ? `aur/${c.arch.aur.pkgname} ${c.arch.aur.version}` : "none";

const rows: string[] = [
  "| Domain | Replaces | Pick | Status | Stars | Release (date) | License | Arch | Score | Runners-up (score) |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
for (const d of catalog.domains) {
  const c = chosen(d);
  if (!c) continue;
  const ru = d.candidates.filter((x: any) => x.repo !== d.pick).slice(0, 3).map((x: any) => `${x.repo.split("/")[1]} (${x.score.total})`).join(", ") || "-";
  const rel = c.release ? `${c.release.tag} (${c.release.date ?? "?"})` : "none";
  const note = d.status === "directive" && d.dataRank1 !== d.pick ? ` (data rank 1: ${d.dataRank1})` : "";
  rows.push(`| ${d.id} | ${d.replaces} | ${c.repo} | ${d.status}${note} | ${num(c.stars)} | ${rel} | ${c.license ?? "?"} | ${archCell(c)} | ${c.score.total} | ${ru} |`);
}
const table = rows.join("\n");

const gaps = catalog.domains
  .filter((d: any) => d.status === "gap")
  .map((d: any) => {
    const b = d.candidates.find((c: any) => c.repo === d.bestAvailable);
    const why = b ? b.notCredibleReasons.join("; ") : "no repository resolved";
    return `- **${d.id}** (${d.title}, replaces ${d.replaces}): best available ${d.bestAvailable ?? "none"} (${b ? `${num(b.stars)} stars, score ${b.score.total}` : "n/a"}); not credible: ${why}.`;
  })
  .join("\n");

const copyleft = (l: string | null) => !l || /GPL|MPL|EUPL|CC-BY-SA|NOASSERTION|OTHER/i.test(l);
const lic = catalog.domains
  .map((d: any) => ({ d, c: chosen(d) }))
  .filter(({ c }: any) => c && copyleft(c.license))
  .map(({ d, c }: any) => `- ${d.id}: ${c.repo} is ${c.license ?? "unlabelled on GitHub (check LICENSE)"}.`)
  .join("\n");

const replace = (text: string, name: string, body: string) => {
  const re = new RegExp(`(<!-- rustbase:${name}:start -->)[\\s\\S]*?(<!-- rustbase:${name}:end -->)`);
  if (!re.test(text)) throw new Error(`marker rustbase:${name} missing in docs/RUSTBASE.md`);
  return text.replace(re, (_m, a, b) => `${a}\n${body}\n${b}`);
};
const cur = await Bun.file(file).text();
let next = replace(cur, "table", table);
next = replace(next, "gaps", gaps);
next = replace(next, "licenses", lic);
if (checkOnly) {
  if (next !== cur) {
    console.error("docs/RUSTBASE.md generated regions are stale");
    process.exit(1);
  }
} else await Bun.write(file, next);
console.log(`render-docs: ${checkOnly ? "checked" : "written"}`);
