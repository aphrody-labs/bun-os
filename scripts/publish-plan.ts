#!/usr/bin/env bun
// Publication plan for first-party crates (crates.io) and packages (npm), docs/ops/RELEASES.md.
//   bun scripts/publish-plan.ts          write docs/generated/publish-plan.json and print the summary
// A crate is publishable when it is a first-party workspace member, not `publish = false`, has a license, and every
// normal/build dependency is a registry crate or another publishable first-party crate (crates.io rejects git and
// unpublished path dependencies). Order is topological so `cargo publish` can run in sequence.
import { join, relative } from "node:path";
import { readdir } from "node:fs/promises";

const root = join(import.meta.dir, "..");
const firstParty = /^(crates|cloud|apps|packages)[\\/]/;

type Dep = { name: string; source: string | null; kind: string | null; path?: string };
type Pkg = {
  name: string;
  version: string;
  id: string;
  manifest_path: string;
  publish: string[] | null;
  license: string | null;
  license_file: string | null;
  description: string | null;
  dependencies: Dep[];
};

const meta = Bun.spawnSync(["cargo", "metadata", "--format-version", "1", "--no-deps", "--locked"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});
if (meta.exitCode !== 0) {
  console.error(meta.stderr.toString());
  process.exit(1);
}
const { packages } = JSON.parse(meta.stdout.toString()) as { packages: Pkg[] };
const members = packages.filter(p => firstParty.test(relative(root, p.manifest_path)));
const byName = new Map(members.map(p => [p.name, p]));

type Verdict = { name: string; version: string; path: string; publishable: boolean; reasons: string[]; deps: string[] };
const verdicts = new Map<string, Verdict>();
function judge(p: Pkg, stack = new Set<string>()): Verdict {
  const done = verdicts.get(p.name);
  if (done) return done;
  if (stack.has(p.name))
    return { name: p.name, version: p.version, path: "", publishable: true, reasons: [], deps: [] };
  stack.add(p.name);
  const reasons: string[] = [];
  if (p.publish && p.publish.length === 0) reasons.push("publish = false");
  if (!p.license && !p.license_file) reasons.push("no license");
  if (!p.description) reasons.push("no description");
  const deps: string[] = [];
  for (const d of p.dependencies) {
    if (d.kind === "dev") continue;
    if (d.source?.startsWith("git+")) reasons.push(`git dependency ${d.name}`);
    else if (d.source === null) {
      const local = byName.get(d.name);
      if (!local) reasons.push(`path dependency ${d.name} outside first-party members`);
      else {
        deps.push(d.name);
        if (!judge(local, stack).publishable) reasons.push(`depends on unpublishable ${d.name}`);
      }
    }
  }
  const v = {
    name: p.name,
    version: p.version,
    path: relative(root, join(p.manifest_path, "..")).replaceAll("\\", "/"),
    publishable: reasons.length === 0,
    reasons: [...new Set(reasons)].slice(0, 6),
    deps,
  };
  verdicts.set(p.name, v);
  return v;
}
for (const p of members) judge(p);

const order: string[] = [];
const seen = new Set<string>();
const visit = (n: string) => {
  if (seen.has(n)) return;
  seen.add(n);
  for (const d of verdicts.get(n)?.deps ?? []) visit(d);
  if (verdicts.get(n)?.publishable) order.push(n);
};
for (const n of [...verdicts.keys()].sort()) visit(n);

// npm: direct children of packages/ with a name, not private.
const npm: { name: string; version: string; path: string; publishable: boolean; reasons: string[] }[] = [];
for (const e of await readdir(join(root, "packages"), { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  const file = Bun.file(join(root, "packages", e.name, "package.json"));
  if (!(await file.exists())) continue;
  const j = (await file.json()) as {
    name?: string;
    version?: string;
    private?: boolean;
    license?: string;
    dependencies?: Record<string, string>;
  };
  const reasons: string[] = [];
  if (!j.name) reasons.push("unnamed");
  if (j.private) reasons.push("private");
  if (!j.license) reasons.push("no license");
  for (const [d, v] of Object.entries(j.dependencies ?? {}))
    if (/^(file:|link:|git|github:|https?:)/.test(v)) reasons.push(`non-registry dependency ${d}`);
  npm.push({
    name: j.name ?? e.name,
    version: j.version ?? "",
    path: `packages/${e.name}`,
    publishable: reasons.length === 0,
    reasons,
  });
}

const blockers = new Map<string, number>();
for (const v of verdicts.values())
  for (const r of v.reasons) {
    const key = r.replace(/ [\w-]+$/, m => (r.startsWith("git dependency") ? m : ""));
    blockers.set(key, (blockers.get(key) ?? 0) + 1);
  }
const plan = {
  schema: 1,
  generator: "scripts/publish-plan.ts",
  crates: { total: verdicts.size, publishable: order.length, order, members: [...verdicts.values()] },
  npm: { total: npm.length, publishable: npm.filter(n => n.publishable).length, members: npm },
  topBlockers: [...blockers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
};
await Bun.write(join(root, "docs", "generated", "publish-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
console.log(
  `crates ${order.length}/${verdicts.size} publishable, npm ${plan.npm.publishable}/${npm.length}; top blockers:`,
);
for (const [b, n] of plan.topBlockers.slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${b}`);
