#!/usr/bin/env bun
/**
 * Offline consistency check of factory/rustbase (no network, no build):
 *   bun factory/rustbase/check.ts
 *   bun factory/rustbase/check.ts --patches   also `git am --3way` every patch on a shallow clone of its pinned tag (network)
 * Verifies: catalog.json counts match its domains, every domain.json candidate is in the catalog (or reported unresolved),
 * every pick has a 40-hex pinned release SHA, pins.json equals the catalog picks, rendered PKGBUILDs are current,
 * and docs/RUSTBASE.md carries the generated table.
 */
import { join, resolve } from "node:path";

const dir = import.meta.dir;
const root = resolve(dir, "../..");
const errors: string[] = [];
const fail = (m: string) => errors.push(m);
const json = (p: string) => Bun.file(join(dir, p)).json();

const catalog = await json("catalog.json");
const spec = await json("domains.json");
const pins = await json("pins.json");

const byStatus = (s: string) => catalog.domains.filter((d: any) => d.status === s).length;
if (catalog.counts.domains !== catalog.domains.length) fail("counts.domains mismatch");
if (catalog.counts.picks !== byStatus("pick")) fail("counts.picks mismatch");
if (catalog.counts.directives !== byStatus("directive")) fail("counts.directives mismatch");
if (catalog.counts.gaps !== byStatus("gap")) fail("counts.gaps mismatch");
if (catalog.counts.unresolvedCandidates !== 0)
  fail(`catalog has ${catalog.counts.unresolvedCandidates} unresolved candidate(s)`);

const specIds = new Set(spec.domains.map((d: any) => d.id));
for (const d of catalog.domains) {
  if (!specIds.has(d.id)) fail(`catalog domain ${d.id} not in domains.json`);
  const ranks = d.candidates.map((c: any) => c.rank);
  if (ranks.join() !== ranks.map((_: number, i: number) => i + 1).join()) fail(`${d.id}: ranks are not 1..n`);
  const scores = d.candidates.map((c: any) => c.score.total);
  for (let i = 1; i < scores.length; i++)
    if (scores[i] > scores[i - 1]) fail(`${d.id}: candidates not sorted by score`);
  if (d.status === "pick") {
    const c = d.candidates.find((x: any) => x.repo === d.pick);
    if (!c?.credible) fail(`${d.id}: pick ${d.pick} is not credible`);
    if (d.candidates.find((x: any) => x.credible)?.repo !== d.pick)
      fail(`${d.id}: pick is not the best credible candidate`);
  }
  if (d.pick) {
    const c = d.candidates.find((x: any) => x.repo === d.pick);
    if (c?.release?.sha && !/^[0-9a-f]{40}$/.test(c.release.sha)) fail(`${d.id}: release sha is not 40-hex`);
  }
}
for (const sd of spec.domains)
  if (!catalog.domains.some((d: any) => d.id === sd.id))
    fail(`domains.json ${sd.id} missing from catalog (rerun rank.ts)`);

const pickRelease = (id: string) => {
  const d = catalog.domains.find((x: any) => x.id === id);
  return d.candidates.find((x: any) => x.repo === d.pick)?.release;
};
for (const [name, id] of [
  ["coreutils", "coreutils"],
  ["findutils", "findutils"],
  ["diffutils", "diffutils"],
  ["sudo-rs", "privilege"],
  ["nushell", "shell"],
] as const) {
  const r = pickRelease(id);
  const p = pins.components[name];
  if (!r || p.sha !== r.sha || p.tag !== r.tag)
    fail(`pins.json ${name} != catalog pick (${p?.tag} vs ${r?.tag}); run gen.ts --refresh`);
}
if (!/^[0-9a-f]{40}$/.test(pins.components["util-linux"].sha)) fail("util-linux fork sha invalid");

const gen = Bun.spawn(["bun", join(dir, "gen.ts"), "--check"], { stdout: "pipe", stderr: "pipe" });
const genErr = await new Response(gen.stderr).text();
if ((await gen.exited) !== 0) fail(`gen.ts --check: ${genErr.trim()}`);

const doc = await Bun.file(join(root, "docs/RUSTBASE.md"))
  .text()
  .catch(() => "");
if (!doc.includes("<!-- rustbase:table:start -->"))
  fail("docs/RUSTBASE.md lacks the generated table (run render-docs.ts)");

if (process.argv.includes("--patches")) {
  const patchRoot = join(dir, "patches");
  const glob = new Bun.Glob("*/*.patch");
  let applied = 0;
  for await (const rel of glob.scan(patchRoot)) {
    const [tool] = rel.split("/");
    const pin = pins.components[tool];
    if (!pin) {
      fail(`patch ${rel}: no pin for ${tool}`);
      continue;
    }
    const tmp = join(root, ".rustbase-patch-check", tool);
    await Bun.$`rm -rf ${tmp} && mkdir -p ${tmp}`.quiet();
    await Bun.$`git init -q ${tmp} && git -C ${tmp} fetch -q --depth 1 https://github.com/${pin.repo} ${pin.sha} && git -C ${tmp} checkout -q FETCH_HEAD`.quiet();
    const am =
      await Bun.$`git -C ${tmp} -c user.name=ci -c user.email=ci@example.invalid am --3way ${join(patchRoot, rel)}`
        .nothrow()
        .quiet();
    if (am.exitCode) fail(`patch ${rel} does not apply to ${pin.tag}`);
    else applied++;
    await Bun.$`rm -rf ${join(root, ".rustbase-patch-check")}`.quiet();
  }
  console.log(`patches applied: ${applied}`);
}

if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}
console.log(
  `rustbase: ok (${catalog.counts.domains} domains, ${catalog.counts.picks} picks, ${catalog.counts.directives} directives, ${catalog.counts.gaps} gaps)`,
);
