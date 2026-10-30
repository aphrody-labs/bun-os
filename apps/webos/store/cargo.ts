// SPDX-License-Identifier: Apache-2.0
// Cargo sparse registry of Bun OS: index/config.json, one index file per crate and the .crate downloads, generated
// from the crates of the workspace. Every manifest is normalised the way `cargo package` does it (workspace
// inheritance resolved, path dependencies become registry dependencies of this registry); crates that cannot be
// published as a registry crate (git dependencies, files outside the crate, unresolvable inheritance) are
// listed with the reason. Served by nginx under /cargo/.
//   ~/.cargo/config.toml  [registries.aphrody] index = "sparse+https://aphrody.com/cargo/index/"
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { docker, run, sha256, step, tail, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

type Toml = Record<string, any>;
const CRATES_IO = "https://github.com/rust-lang/crates.io-index";
const MAX_CRATE_BYTES = 40 * 1024 * 1024;
const EXCLUDE_DIRS = [".git", "target", "node_modules", "tests", "benches", "examples", "fuzz", ".github"];

// ---------------------------------------------------------------------------------------------------------
// TOML writer (the subset a normalised manifest needs).

const key = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
function value(v: any): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(value).join(", ")}]`;
  if (v && typeof v === "object")
    return `{ ${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${key(k)} = ${value(x)}`)
      .join(", ")} }`;
  throw new Error(`Unsupported TOML value ${String(v)}`);
}
const isTable = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const isTableArray = (v: any) => Array.isArray(v) && v.length > 0 && v.every(isTable);
export function stringify(obj: Toml, path: string[] = []): string {
  let head = "";
  let rest = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (isTableArray(v)) {
      for (const item of v) rest += `\n[[${[...path, k].map(key).join(".")}]]\n${stringify(item, [...path, k])}`;
    } else if (isTable(v)) {
      rest += `\n[${[...path, k].map(key).join(".")}]\n${stringify(v, [...path, k])}`;
    } else head += `${key(k)} = ${value(v)}\n`;
  }
  return head + rest;
}

// ---------------------------------------------------------------------------------------------------------
// Workspace resolution

interface Member {
  dir: string;
  rel: string;
  name: string;
  raw: Toml;
}
const readToml = async (path: string): Promise<Toml | undefined> => {
  try {
    return Bun.TOML.parse(await Bun.file(path).text()) as Toml;
  } catch {
    return undefined;
  }
};

async function workspaceOf(dir: string, root: string, cache: Map<string, Toml | null>): Promise<{ dir: string; ws: Toml } | undefined> {
  for (let d = dir; ; d = dirname(d)) {
    if (!cache.has(d)) {
      const t = await readToml(join(d, "Cargo.toml"));
      cache.set(d, t?.workspace ? t : null);
    }
    const t = cache.get(d);
    if (t) return { dir: d, ws: t.workspace };
    if (d === root || d === dirname(d)) return undefined;
  }
}

class Skip extends Error {}

function inheritPackage(pkg: Toml, wsPkg: Toml, wsDir: string, dir: string): Toml {
  const out: Toml = {};
  for (const [k, v] of Object.entries(pkg)) {
    if (isTable(v) && v.workspace === true) {
      if (!(k in wsPkg)) throw new Skip(`package.${k} inherits a missing workspace value`);
      let inherited = wsPkg[k];
      if ((k === "readme" || k === "license-file") && typeof inherited === "string") {
        // Path relative to the workspace root: keep it only when the file sits inside this crate.
        const abs = resolve(wsDir, inherited);
        if (!abs.startsWith(dir + "/")) continue;
        inherited = relative(dir, abs);
      }
      out[k] = inherited;
    } else out[k] = v;
  }
  if (typeof out.version !== "string") throw new Skip("package has no version");
  delete out.publish;
  delete out.workspace;
  delete out["default-run"];
  out.autotests = false;
  out.autoexamples = false;
  out.autobenches = false;
  return out;
}

interface IndexDep {
  name: string;
  req: string;
  features: string[];
  optional: boolean;
  default_features: boolean;
  target: string | null;
  kind: "normal" | "build";
  registry: string | null;
  package: string | null;
}

export async function build(ctx: Ctx) {
  const root = ctx.root;
  const out = join(ctx.store, "cargo");
  const stage = join(ctx.store, ".cargo-staging");
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  // Members: every crates/* with a manifest plus the members of the root workspace that live elsewhere.
  const dirs = new Set<string>();
  for (const name of await readdir(join(root, "crates"))) dirs.add(join(root, "crates", name));
  const rootToml = await readToml(join(root, "Cargo.toml"));
  for (const pattern of (rootToml?.workspace?.members ?? []) as string[])
    for await (const file of new Bun.Glob(`${pattern}/Cargo.toml`).scan({ cwd: root, onlyFiles: true })) dirs.add(join(root, dirname(file)));
  const wsCache = new Map<string, Toml | null>();
  const members = new Map<string, Member>();
  const skipped: { name: string; reason: string }[] = [];
  for (const dir of [...dirs].sort()) {
    const raw = await readToml(join(dir, "Cargo.toml"));
    const rel = relative(root, dir);
    if (!raw?.package?.name) continue; // virtual workspace or unreadable
    const name = raw.package.name as string;
    if (members.has(name)) {
      skipped.push({ name: `${name} (${rel})`, reason: `duplicate of ${members.get(name)!.rel}` });
      continue;
    }
    members.set(name, { dir, rel, name, raw });
  }

  interface Built {
    manifest: Toml;
    deps: IndexDep[];
    features: Record<string, string[]>;
    features2: Record<string, string[]>;
    version: string;
    pkg: Toml;
  }
  let built = new Map<string, Built>();
  const failed = new Map<string, string>();

  const versionOf = async (m: Member): Promise<string> => {
    const v = m.raw.package.version;
    if (typeof v === "string") return v;
    const w = await workspaceOf(m.dir, root, wsCache);
    const inherited = w?.ws.package?.version;
    if (typeof inherited === "string") return inherited;
    throw new Skip("no version");
  };

  async function normalise(m: Member): Promise<Built> {
    const w = await workspaceOf(m.dir, root, wsCache);
    const wsDeps: Toml = w?.ws.dependencies ?? {};
    const pkg = inheritPackage(m.raw.package, w?.ws.package ?? {}, w?.dir ?? m.dir, m.dir);
    const manifest: Toml = { package: pkg };
    const deps: IndexDep[] = [];
    const resolveDeps = async (table: Toml | undefined, kind: "normal" | "build", target: string | null, into: Toml) => {
      for (const [alias, spec0] of Object.entries(table ?? {})) {
        let spec: Toml = typeof spec0 === "string" ? { version: spec0 } : { ...(spec0 as Toml) };
        if (spec.workspace === true) {
          const base0 = wsDeps[alias];
          if (base0 === undefined) throw new Skip(`dependency ${alias} inherits a missing workspace dependency`);
          const base: Toml = typeof base0 === "string" ? { version: base0 } : { ...base0 };
          // Relative workspace paths are relative to the workspace root.
          if (base.path) base.path = resolve(w!.dir, base.path);
          spec = { ...base, features: [...new Set([...(base.features ?? []), ...(spec.features ?? [])])], optional: spec.optional ?? base.optional };
          if (!spec.features.length) delete spec.features;
          if (spec.optional === undefined) delete spec.optional;
        } else if (spec.path) spec.path = resolve(m.dir, spec.path);
        if (spec.git) throw new Skip(`git dependency ${alias}`);
        const realName: string = spec.package ?? alias;
        let registry: string | null = CRATES_IO;
        let req = spec.version as string | undefined;
        const outSpec: Toml = {};
        if (spec.path) {
          const owner = members.get(realName) ?? [...members.values()].find((x) => x.dir === spec.path);
          if (!owner) throw new Skip(`path dependency ${alias} is outside the published set`);
          if (failed.has(owner.name)) throw new Skip(`depends on unpublishable ${owner.name}`);
          req ??= `^${await versionOf(owner)}`;
          registry = null;
          outSpec["registry-index"] = `sparse+${ctx.origin}/cargo/index/`;
        } else if (spec.registry || spec["registry-index"]) throw new Skip(`dependency ${alias} uses another registry`);
        if (!req) throw new Skip(`dependency ${alias} has no version`);
        outSpec.version = req;
        if (spec.package) outSpec.package = spec.package;
        if (spec.features?.length) outSpec.features = spec.features;
        if (spec.optional) outSpec.optional = true;
        const df = spec["default-features"] ?? spec.default_features;
        if (df === false) outSpec["default-features"] = false;
        into[alias] = outSpec;
        deps.push({
          name: alias,
          req,
          features: [...(spec.features ?? [])].sort(),
          optional: Boolean(spec.optional),
          default_features: df !== false,
          target,
          kind,
          registry,
          package: spec.package ?? null,
        });
      }
    };
    const dep: Toml = {};
    const bdep: Toml = {};
    await resolveDeps(m.raw.dependencies, "normal", null, dep);
    await resolveDeps(m.raw["build-dependencies"], "build", null, bdep);
    if (Object.keys(dep).length) manifest.dependencies = dep;
    if (Object.keys(bdep).length) manifest["build-dependencies"] = bdep;
    const targets: Toml = {};
    for (const [cfg, t] of Object.entries((m.raw.target ?? {}) as Toml)) {
      const tdep: Toml = {};
      const tbdep: Toml = {};
      await resolveDeps((t as Toml).dependencies, "normal", cfg, tdep);
      await resolveDeps((t as Toml)["build-dependencies"], "build", cfg, tbdep);
      const entry: Toml = {};
      if (Object.keys(tdep).length) entry.dependencies = tdep;
      if (Object.keys(tbdep).length) entry["build-dependencies"] = tbdep;
      if (Object.keys(entry).length) targets[cfg] = entry;
    }
    if (Object.keys(targets).length) manifest.target = targets;
    if (m.raw.features) manifest.features = m.raw.features;
    if (m.raw.lib) manifest.lib = m.raw.lib;
    if (m.raw.bin) manifest.bin = m.raw.bin;
    // Target paths must stay inside the crate and exist.
    for (const t of [manifest.lib, ...(manifest.bin ?? [])].filter(Boolean) as Toml[]) {
      if (t.path) {
        const abs = resolve(m.dir, t.path);
        if (!abs.startsWith(m.dir + "/")) throw new Skip(`target path ${t.path} is outside the crate`);
        if (!(await Bun.file(abs).exists())) throw new Skip(`target path ${t.path} does not exist`);
      }
    }
    if (typeof pkg.build === "string" && !(await Bun.file(join(m.dir, pkg.build)).exists())) throw new Skip(`build script ${pkg.build} is missing`);
    // Index features: `dep:` and `?/` syntax goes to features2 (v = 2).
    const features: Record<string, string[]> = {};
    const features2: Record<string, string[]> = {};
    for (const [f, list] of Object.entries((m.raw.features ?? {}) as Record<string, string[]>))
      (list.some((x) => x.startsWith("dep:") || x.includes("?/")) ? features2 : features)[f] = list;
    return { manifest, deps, features, features2, version: pkg.version, pkg };
  }

  // Fixpoint: a crate depending on an unpublishable crate is itself unpublishable.
  for (let pass = 0; pass < 8; pass++) {
    const before = failed.size;
    built = new Map();
    for (const m of members.values()) {
      if (failed.has(m.name)) continue;
      try {
        built.set(m.name, await normalise(m));
      } catch (error) {
        failed.set(m.name, error instanceof Skip ? error.message : `manifest error: ${String((error as Error).message ?? error)}`);
      }
    }
    if (failed.size === before) break;
  }
  for (const [name, reason] of failed) skipped.push({ name, reason });

  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "index"), { recursive: true });
  await Bun.write(join(out, "index/config.json"), JSON.stringify({ dl: `${ctx.origin}/cargo/dl` }));
  const entries: IndexEntry[] = [];
  const queue = [...built];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [name, b] = item;
      const m = members.get(name)!;
      const sdir = join(stage, `${name}-${b.version}`);
      await mkdir(sdir, { recursive: true });
      const excludes = EXCLUDE_DIRS.flatMap((d) => ["--exclude", `./${d}`]);
      const copy = await run(
        ["sh", "-c", 'tar -C "$1" "${@:3}" --exclude=Cargo.lock --exclude=*.log -cf - . | tar -C "$2" -xf -', "_", m.dir, sdir, ...excludes],
      );
      if (copy.code !== 0) {
        // POSIX sh has no ${@:3}; fall back to bash.
        const again = await run(["bash", "-c", 'tar -C "$1" "${@:3}" --exclude=Cargo.lock --exclude=*.log -cf - . | tar -C "$2" -xf -', "_", m.dir, sdir, ...excludes]);
        if (again.code !== 0) {
          skipped.push({ name, reason: `copy failed: ${tail(again.out, 2)}` });
          continue;
        }
      }
      await Bun.write(join(sdir, "Cargo.toml.orig"), Bun.file(join(m.dir, "Cargo.toml")));
      await Bun.write(join(sdir, "Cargo.toml"), stringify(b.manifest));
      const crateDir = join(out, "dl", name, b.version);
      await mkdir(crateDir, { recursive: true });
      const file = join(crateDir, "download");
      const tar = await run(["tar", "-C", stage, "-czf", file, `${name}-${b.version}`]);
      await rm(sdir, { recursive: true, force: true });
      const size = tar.code === 0 ? (await stat(file)).size : 0;
      if (tar.code !== 0 || size > MAX_CRATE_BYTES) {
        await rm(crateDir, { recursive: true, force: true });
        skipped.push({ name, reason: tar.code ? "tar failed" : `crate is ${(size / 1048576).toFixed(0)} MB, above the ${MAX_CRATE_BYTES / 1048576} MB limit` });
        continue;
      }
      const cksum = await sha256(file);
      const line: Record<string, unknown> = {
        name,
        vers: b.version,
        deps: b.deps,
        cksum,
        features: b.features,
        yanked: false,
        links: b.pkg.links ?? null,
        v: 2,
      };
      if (Object.keys(b.features2).length) line.features2 = b.features2;
      if (b.pkg["rust-version"]) line.rust_version = b.pkg["rust-version"];
      const lower = name.toLowerCase();
      const ipath =
        lower.length === 1 ? `1/${lower}` : lower.length === 2 ? `2/${lower}` : lower.length === 3 ? `3/${lower[0]}/${lower}` : `${lower.slice(0, 2)}/${lower.slice(2, 4)}/${lower}`;
      await mkdir(dirname(join(out, "index", ipath)), { recursive: true });
      await Bun.write(join(out, "index", ipath), JSON.stringify(line) + "\n");
      entries.push({
        name,
        version: b.version,
        desc: String(b.pkg.description ?? ""),
        license: b.pkg.license,
        size,
        sha256: cksum,
        file: `/cargo/dl/${name}/${b.version}/download`,
        homepage: b.pkg.homepage ?? b.pkg.repository,
        member: m.rel,
        meta: { deps: b.deps.length, bins: (b.manifest.bin ?? []).length, index: ipath },
      });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await rm(stage, { recursive: true, force: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  await writeIndex(ctx, { format: "cargo", generated: new Date().toISOString(), url: `sparse+${ctx.origin}/cargo/index/`, entries, skipped });
  console.log(`cargo: ${entries.length} crates, ${skipped.length} skipped`);
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const index = JSON.parse(await Bun.file(join(ctx.store, "index/cargo.json")).text()) as { entries: IndexEntry[] };
  // Prefer a crate without dependencies so the check is about this registry, not about crates.io.
  const pick = index.entries.filter((e) => !(e.meta?.deps as number)).sort((a, b) => (a.size ?? 0) - (b.size ?? 0))[0] ?? index.entries[0]!;
  const image = "rust:1-slim";
  const script = `set -e
export CARGO_HOME=/tmp/cargo-home CARGO_REGISTRIES_APHRODY_INDEX=sparse+${ctx.origin}/cargo/index/
cargo new --lib qual && cd qual
cargo add ${pick.name}@=${pick.version} --registry aphrody
cargo fetch
ls /tmp/cargo-home/registry/src/*/ | grep '^${pick.name}-${pick.version}$'
cargo metadata --format-version 1 --offline >/dev/null`;
  await step(steps, `index entry ${pick.name}`, () =>
    run(["sh", "-c", `curl -fsS ${ctx.origin}/cargo/index/config.json && curl -fsS ${ctx.origin}/cargo/index/${(pick.meta as { index: string }).index}`]),
  );
  await step(steps, `cargo add + fetch ${pick.name} (container ${image})`, () => docker(image, script, { timeout: 600_000 }));
  return { format: "cargo", ok: steps.every((s) => s.ok), at: new Date().toISOString(), image, steps };
}
