#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * One release entry point for every Bun OS product: quality gates, the npm packages and the crates.io crates.
 * Every stage is idempotent and resumable: a version that is already published is skipped, so a failed or
 * rate-limited run is repeated with the same command. Nothing is published without `--apply`.
 *
 *   bun scripts/release.ts verify                     # check, lint, format, docs, manifests
 *   bun scripts/release.ts plan                       # what npm and crates.io still miss
 *   bun scripts/release.ts npm    [--apply] [--only a,b]
 *   bun scripts/release.ts crates [--apply] [--only a,b] [--limit N] [--budget MIN]
 *   bun scripts/release.ts all    [--apply]           # verify, npm, crates
 *
 * Credentials come from the environment only: NPM_CONFIG_TOKEN (or an .npmrc) and CARGO_REGISTRY_TOKEN.
 */
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dir, "..");
const USER_AGENT = "aphrody-release (contact@aphrody.com)";
/** npm scopes the release token can publish to; imported scopes such as @storyteller belong to others. */
const OWNED_SCOPES = new Set((process.env.RELEASE_NPM_SCOPES ?? "@aphrody,@rosegriffon").split(","));

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    apply: { type: "boolean", default: false },
    only: { type: "string" },
    limit: { type: "string" },
    pause: { type: "string", default: "0" },
    budget: { type: "string" },
  },
});
const stage = positionals[0] ?? "plan";
const only = values.only ? new Set(values.only.split(",")) : undefined;
const apply = values.apply === true;

type NpmPackage = {
  name: string;
  version: string;
  dir: string;
  deps: string[];
  specs: Record<string, string>;
};
type Crate = {
  name: string;
  version: string;
  manifest: string;
  deps: string[];
  /** Path dependencies the published crate keeps: normal and build, not dev. */
  needs: string[];
};

async function run(cmd: string[], cwd = ROOT): Promise<number> {
  console.log(`$ ${cmd.join(" ")}`);
  return await Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" }).exited;
}

async function capture(cmd: string[], cwd = ROOT): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "inherit" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
  return out;
}

/** Dependencies first, so every internal dependency is already published when its dependent is. */
export function order<T extends { name: string; deps: string[] }>(items: T[]): T[] {
  const byName = new Map(items.map(item => [item.name, item]));
  const done = new Set<string>();
  const sorted: T[] = [];
  const visit = (item: T, trail: Set<string>) => {
    if (done.has(item.name) || trail.has(item.name)) return;
    trail.add(item.name);
    for (const dep of item.deps) {
      const target = byName.get(dep);
      if (target) visit(target, trail);
    }
    done.add(item.name);
    sorted.push(item);
  };
  for (const item of [...items].sort((a, b) => a.name.localeCompare(b.name))) visit(item, new Set());
  return sorted;
}

export async function npmPackages(): Promise<NpmPackage[]> {
  const found: NpmPackage[] = [];
  for (const file of new Bun.Glob("{packages,apps}/*/package.json").scanSync({
    cwd: ROOT,
  })) {
    const manifest = await Bun.file(join(ROOT, file)).json();
    if (!manifest.name || !manifest.version || manifest.private) continue;
    if (!OWNED_SCOPES.has(manifest.name.split("/")[0])) continue;
    const specs: Record<string, string> = {
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
      ...manifest.dependencies,
    };
    const deps = Object.keys(specs);
    found.push({
      name: manifest.name,
      version: manifest.version,
      dir: dirname(join(ROOT, file)),
      deps,
      specs,
    });
  }
  return order(found);
}

const packuments = new Map<string, Promise<string[]>>();
function npmVersions(name: string): Promise<string[]> {
  let versions = packuments.get(name);
  if (!versions) {
    versions = fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/vnd.npm.install-v1+json",
      },
    }).then(async res => (res.ok ? Object.keys((await res.json()).versions ?? {}) : []));
    packuments.set(name, versions);
  }
  return versions;
}

/**
 * Packages that would install broken: an owned-scope dependency that is private, outside packages/ and apps/,
 * a local file, or a range npm cannot satisfy (and this release does not publish), or a dependency on such a
 * package. They are held back instead of published.
 */
async function heldBack(pkgs: NpmPackage[]): Promise<Map<string, string>> {
  const catalog: Record<string, string> = (await Bun.file(join(ROOT, "package.json")).json()).catalog ?? {};
  const byName = new Map(pkgs.map(pkg => [pkg.name, pkg]));
  // Workspace members outside packages/ and apps/: `bun publish` pins their exact version.
  const lock = Bun.JSONC.parse(await Bun.file(join(ROOT, "bun.lock")).text()) as {
    workspaces: Record<string, { name?: string; version?: string }>;
  };
  const members = new Map(
    Object.values(lock.workspaces).flatMap(ws => (ws.name && ws.version ? [[ws.name, ws.version] as const] : [])),
  );
  const held = new Map<string, string>();
  for (const pkg of pkgs) {
    // Outside the root workspaces, `bun publish` cannot resolve its catalog: and workspace: ranges.
    if (!lock.workspaces[relative(ROOT, pkg.dir).replaceAll("\\", "/")]) {
      held.set(pkg.name, "not a root workspace member");
      continue;
    }
    for (const [dep, raw] of Object.entries(pkg.specs)) {
      if (!OWNED_SCOPES.has(dep.split("/")[0])) continue;
      let [name, spec] = [dep, raw === "catalog:" ? (catalog[dep] ?? raw) : raw];
      if (spec.startsWith("npm:"))
        [name, spec] = [spec.slice(4, spec.lastIndexOf("@")), spec.slice(spec.lastIndexOf("@") + 1)];
      const local = byName.get(name);
      let reason: string | undefined;
      if (spec.startsWith("workspace:") && !local && members.has(name)) spec = members.get(name)!;
      if (spec.startsWith("workspace:")) reason = local ? undefined : `${name} is private or not in packages/ or apps/`;
      else if (/^(file|link|catalog):/.test(spec)) reason = `${name} is ${spec}`;
      else if (local && Bun.semver.satisfies(local.version, spec)) reason = undefined;
      else if (!(await npmVersions(name)).some(version => Bun.semver.satisfies(version, spec)))
        reason = `${name}@${spec} is not on npm`;
      if (reason) {
        held.set(pkg.name, reason);
        break;
      }
    }
  }
  // order() puts dependencies first, so one pass carries a hold to every dependent.
  for (const pkg of pkgs) {
    const blocked = pkg.deps.find(dep => held.has(dep));
    if (!held.has(pkg.name) && blocked) held.set(pkg.name, `depends on held ${blocked}`);
  }
  return held;
}

async function npmPublished(name: string, version: string): Promise<boolean> {
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}/${version}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`npm ${name}@${version}: HTTP ${res.status}`);
  return true;
}

export async function cargoCrates(): Promise<Crate[]> {
  const metadata = JSON.parse(await capture(["cargo", "metadata", "--format-version", "1", "--no-deps", "--locked"]));
  const crates: Crate[] = metadata.packages
    .filter((pkg: any) => !(Array.isArray(pkg.publish) && pkg.publish.length === 0))
    .map((pkg: any) => ({
      name: pkg.name,
      version: pkg.version,
      manifest: pkg.manifest_path,
      deps: pkg.dependencies.filter((dep: any) => dep.path).map((dep: any) => dep.name),
      needs: pkg.dependencies.filter((dep: any) => dep.path && dep.kind !== "dev").map((dep: any) => dep.name),
    }));
  return order(crates);
}

async function cratePublished(name: string, version: string): Promise<boolean> {
  const res = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`crates.io ${name}@${version}: HTTP ${res.status}`);
  return true;
}

async function missing<T extends { name: string; version: string }>(
  items: T[],
  published: (name: string, version: string) => Promise<boolean>,
): Promise<T[]> {
  const out: T[] = [];
  for (const item of items) {
    if (only && !only.has(item.name)) continue;
    if (!(await published(item.name, item.version))) out.push(item);
  }
  return out;
}

async function verify(): Promise<void> {
  for (const script of ["check", "lint", "format:check", "docs:check"]) {
    if ((await run(["bun", "run", script])) !== 0) throw new Error(`quality gate failed: ${script}`);
  }
  if ((await run(["bun", "scripts/workspace-manifests.ts"])) !== 0) throw new Error("workspace manifests differ");
}

async function plan(): Promise<void> {
  const [npm, crates] = await Promise.all([npmPackages(), cargoCrates()]);
  const [npmTodo, cratesTodo] = [await missing(npm, npmPublished), await missing(crates, cratePublished)];
  console.log(`npm: ${npmTodo.length} of ${npm.length} unpublished`);
  for (const [name, reason] of await heldBack(npm)) console.log(`  held: ${name} (${reason})`);
  console.log(`crates.io: ${cratesTodo.length} of ${crates.length} unpublished`);
}

async function publishNpm(): Promise<void> {
  const all = await npmPackages();
  const held = await heldBack(all);
  const todo = (await missing(all, npmPublished)).filter(pkg => {
    if (held.has(pkg.name)) console.log(`held: ${pkg.name}@${pkg.version} (${held.get(pkg.name)})`);
    return !held.has(pkg.name);
  });
  const failed: string[] = [];
  for (const pkg of todo) {
    const cmd = ["bun", "publish", "--access", "public", ...(apply ? [] : ["--dry-run"])];
    if ((await run(cmd, pkg.dir)) !== 0) failed.push(`${pkg.name}@${pkg.version}`);
  }
  console.log(`npm: ${todo.length - failed.length}/${todo.length} ${apply ? "published" : "verified"}`);
  if (failed.length) throw new Error(`npm failed: ${failed.join(", ")}`);
}

/** Runs `cargo publish`, mirroring its stderr; returns the exit code and the stderr tail. */
async function cargoPublish(cmd: string[]): Promise<{ code: number; stderr: string }> {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "inherit", stderr: "pipe" });
  const decoder = new TextDecoder();
  let stderr = "";
  for await (const chunk of proc.stderr) {
    process.stderr.write(chunk);
    stderr = (stderr + decoder.decode(chunk, { stream: true })).slice(-65536);
  }
  return { code: await proc.exited, stderr };
}

/**
 * Publishes the unpublished crates in dependency order. `--limit` counts crates actually published, `--budget`
 * stops starting new crates after that many minutes, a crate whose path dependency is still unpublished is skipped
 * without calling cargo, and a crates.io 429 waits for the time the registry names before retrying.
 */
async function publishCrates(): Promise<void> {
  const limit = values.limit ? Number(values.limit) : Infinity;
  const pause = Number(values.pause) * 1000;
  const deadline = values.budget ? Date.now() + Number(values.budget) * 60_000 : Infinity;
  const all = await cargoCrates();
  const todo = await missing(all, cratePublished);
  const unpublished = new Set(todo.map(crate => crate.name));
  const failed: string[] = [];
  const blocked: string[] = [];
  let published = 0;
  let index = 0;
  for (; index < todo.length && published < limit && Date.now() < deadline; index++) {
    const crate = todo[index];
    const waiting = crate.needs.find(dep => unpublished.has(dep));
    if (waiting) {
      console.log(`skip: ${crate.name}@${crate.version} (depends on unpublished ${waiting})`);
      blocked.push(`${crate.name}@${crate.version} (needs ${waiting})`);
      continue;
    }
    const cmd = [
      "cargo",
      "publish",
      "--allow-dirty",
      "--manifest-path",
      crate.manifest,
      ...(apply ? [] : ["--dry-run"]),
    ];
    let result = await cargoPublish(cmd);
    for (let retry = 0; result.code !== 0 && retry < 3; retry++) {
      const after = /429 Too Many Requests.*?try again after ([^.]+? GMT)/s.exec(result.stderr)?.[1];
      if (!after) break;
      const wait = Math.max(Date.parse(after) - Date.now(), 0) + 15_000;
      console.log(`crates.io rate limit: waiting ${Math.round(wait / 1000)}s for ${crate.name}`);
      await Bun.sleep(wait);
      result = await cargoPublish(cmd);
    }
    // A crate the registry already lists (a retry after a lagging index, or a concurrent run) is published.
    if (result.code !== 0 && !(await cratePublished(crate.name, crate.version))) {
      failed.push(`${crate.name}@${crate.version}`);
      continue;
    }
    unpublished.delete(crate.name);
    published++;
    if (apply && pause > 0) await Bun.sleep(pause);
  }
  const left = todo.length - index;
  console.log(
    `crates.io: ${published} ${apply ? "published" : "verified"}, ${failed.length} failed, ${blocked.length} blocked, ${left} not attempted`,
  );
  if (blocked.length) console.log(`blocked: ${blocked.join(", ")}`);
  if (failed.length) throw new Error(`crates failed: ${failed.join(", ")}`);
}

if (import.meta.main) {
  const stages: Record<string, () => Promise<void>> = {
    verify,
    plan,
    npm: publishNpm,
    crates: publishCrates,
    all: async () => {
      await verify();
      await publishNpm();
      await publishCrates();
    },
  };
  const action = stages[stage];
  if (!action) {
    console.error(`usage: bun scripts/release.ts ${Object.keys(stages).join("|")} [--apply] [--only a,b] [--limit N]`);
    process.exit(2);
  }
  await action();
}
