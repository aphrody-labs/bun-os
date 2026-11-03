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

type Dep = { name: string; source: string | null; kind: string | null; req: string; path?: string };
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

// `cargo package` resolves every dependency against crates.io: a [patch.crates-io] entry, a git dependency with a
// version, or a path dependency outside the members is fine only when crates.io has a matching version. A git or
// out-of-tree path dependency without a version cannot be published at all.
const UA = { "User-Agent": "bun-os-release (contact@aphrody.com)" };
const manifest = Bun.TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()) as {
  patch?: Record<string, Record<string, { package?: string; git?: string; rev?: string }>>;
};
const patchEntries = Object.entries(manifest.patch?.["crates-io"] ?? {}).map(([k, v]) => ({
  ...v,
  name: v.package ?? k,
}));
const patched = new Set(patchEntries.map(e => e.name));
// First-party crates that live outside the members (an aphrody-labs fork patched in from git, or a crate in its own
// workspace under crates/): when crates.io lacks them, scripts/publish.ts publishes their workspace first.
type External = { workspace: string; git?: string; rev?: string; path?: string; crates: string[] };
const externals = new Map<string, External>();
function externalFor(d: Dep): External | undefined {
  const e = patchEntries.find(p => p.name === d.name);
  if (e?.git?.includes("github.com/aphrody-labs/")) {
    const ws = e.git.replace(/.git$/, "").split("/").pop()!;
    const x = externals.get(ws) ?? { workspace: ws, git: e.git, rev: e.rev, crates: [] };
    externals.set(ws, x);
    return x;
  }
  if (d.source === null && d.path && firstParty.test(relative(root, d.path))) {
    const ws = relative(root, d.path).replaceAll("\\", "/");
    const x = externals.get(ws) ?? { workspace: ws, path: ws, crates: [] };
    externals.set(ws, x);
    return x;
  }
}
const registryVersions = new Map<string, string[]>();
const lookups = new Set([...patched].filter(n => !byName.has(n)));
for (const p of members)
  for (const d of p.dependencies)
    if (
      d.kind !== "dev" &&
      d.req !== "*" &&
      (d.source?.startsWith("git+") || (d.source === null && !byName.has(d.name)))
    )
      lookups.add(d.name);
for (const name of lookups) {
  const r = await fetch(`https://crates.io/api/v1/crates/${name}`, { headers: UA });
  const body = r.ok ? ((await r.json()) as { versions: { num: string; yanked: boolean }[] }) : { versions: [] };
  registryVersions.set(
    name,
    body.versions.filter(v => !v.yanked).map(v => v.num),
  );
}
const cargoReq = (req: string) =>
  req
    .split(",")
    .map(p => p.trim())
    .map(p => (/^\d/.test(p) ? `^${p}` : p))
    .join(" ");
const onRegistry = (name: string, req: string) =>
  (registryVersions.get(name) ?? []).some(v => req === "*" || Bun.semver.satisfies(v, cargoReq(req)));

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
    const local = d.source === null ? byName.get(d.name) : undefined;
    if (!local && d.source?.startsWith("registry+") !== true && d.req === "*")
      reasons.push(`${d.source ? "git" : "path"} dependency ${d.name} without a version`);
    else if (!local && registryVersions.has(d.name)) {
      if (!onRegistry(d.name, d.req)) {
        const x = externalFor(d);
        if (x) {
          if (!x.crates.includes(d.name)) x.crates.push(d.name);
        } else reasons.push(`dependency ${d.name} ${d.req} not on crates.io`);
      }
    } else if (d.source === null) {
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
    const key = r.startsWith("depends on unpublishable") ? "depends on unpublishable" : r;
    blockers.set(key, (blockers.get(key) ?? 0) + 1);
  }
const plan = {
  schema: 1,
  generator: "scripts/publish-plan.ts",
  crates: {
    total: verdicts.size,
    publishable: order.length,
    external: [...externals.values()],
    order,
    members: [...verdicts.values()],
  },
  npm: { total: npm.length, publishable: npm.filter(n => n.publishable).length, members: npm },
  topBlockers: [...blockers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
};
await Bun.write(join(root, "docs", "generated", "publish-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
console.log(
  `crates ${order.length}/${verdicts.size} publishable, npm ${plan.npm.publishable}/${npm.length}; top blockers:`,
);
for (const [b, n] of plan.topBlockers.slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${b}`);
