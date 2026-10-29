#!/usr/bin/env bun
/**
 * Consistency check of the single component manifest (factory/bunos/components.json), no build:
 *   bun factory/bunos/check-components.ts
 * Verifies that the runtime pin matches package.json and sources.lock.json, that every `modules` entry exists
 * (submodule in .gitmodules with its gitlink pin, workspace package, path crate, locked crates.io crate), that the
 * manifest lists every such component, that no entry is pending or missing, and that nothing references the removed
 * `toolchains/bun` fork path or imports a fork-only `bun:*` module (upstream: bun:test, bun:sqlite, bun:ffi, bun:jsc,
 * bun:bundle).
 */
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const errors: string[] = [];
const fail = (message: string) => errors.push(message);

const git = async (...args: string[]) => {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { out: out.replace(/\r/g, ""), code };
};
const read = (path: string) => Bun.file(join(root, path)).text();

const manifest = await Bun.file(join(root, "factory/bunos/components.json")).json();
const modes = new Set(Object.keys(manifest.registrationModes ?? {}));
const kinds = new Set(["submodule", "npm-package", "app", "crate", "crate-dependency"]);
const AOT_BLOCKERS = ["bunfig-preload", "bun-plugin"];
const UPSTREAM_BUN_MODULES = new Set(["test", "sqlite", "ffi", "jsc", "bundle"]);

// ---- runtime: npm bun pinned exactly ---------------------------------------------------------------------------
const runtime = manifest.runtime;
if (runtime?.source?.type !== "npm" || runtime.source.name !== "bun") fail("runtime: source must be npm bun");
else {
  const { version, gitHead } = runtime.source;
  if (!/^\d+\.\d+\.\d+(-canary\.\d{8}\.\d+)?$/.test(version ?? "")) fail(`runtime: version ${version} is not exact`);
  if (!/^[a-f0-9]{40}$/.test(gitHead ?? "")) fail("runtime: gitHead must be a 40-hex commit");
  const pkg = await Bun.file(join(root, "package.json")).json();
  const pinned = [pkg.dependencies?.bun, pkg.devDependencies?.bun, pkg.catalog?.bun, pkg.overrides?.bun].filter(
    Boolean,
  );
  if (!pinned.length) fail("runtime: package.json does not pin bun");
  for (const spec of pinned) if (spec !== version) fail(`runtime: package.json pins bun@${spec}, manifest ${version}`);
  const sources = await Bun.file(join(root, "sources.lock.json")).json();
  const bun = sources.repositories?.find((r: any) => r.id === "bun");
  if (bun?.revision !== gitHead) fail(`runtime: sources.lock.json bun revision ${bun?.revision} != ${gitHead}`);
}

// ---- repository facts ---------------------------------------------------------------------------------------------
const gitmodules = new Map<string, string>();
for (const block of (await read(".gitmodules")).split(/\[submodule /).slice(1)) {
  const path = block.match(/path\s*=\s*(.*)/)?.[1].trim();
  const url = block.match(/url\s*=\s*(.*)/)?.[1].trim();
  if (path && url) gitmodules.set(path, url);
}
const staged = (await git("ls-files", "-s")).out.split("\n").filter(Boolean);
const gitlinks = new Map<string, string>();
const tracked = new Set<string>();
for (const line of staged) {
  const match = line.match(/^(\d+) (\w+) \d\t(.*)$/);
  if (!match) continue;
  if (match[1] === "160000") gitlinks.set(match[3], match[2]);
  else tracked.add(match[3]);
}
const lock = await read("Cargo.lock");
const locked = new Map<string, string[]>();
const pathCrates = new Set<string>();
for (const m of lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\n(source = "([^"]+)")?/g)) {
  if (!m[3]) pathCrates.add(m[1]);
  else if (m[4].startsWith("registry+")) locked.set(m[1], [...(locked.get(m[1]) ?? []), m[2]]);
}
const rootCargo = await read("Cargo.toml");
const workspaceVersion = rootCargo.match(/^\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/ms)?.[1];

// ---- modules ------------------------------------------------------------------------------------------------------
const ids = new Set<string>();
const seen = { submodule: new Set<string>(), workspace: new Set<string>(), crate: new Set<string>() };
for (const mod of manifest.modules ?? []) {
  const id = mod.id;
  if (!id || ids.has(id)) fail(`${id}: missing or duplicate id`);
  ids.add(id);
  if (!kinds.has(mod.kind)) fail(`${id}: unknown kind ${mod.kind}`);
  if (mod.status !== "present") fail(`${id}: status ${mod.status} (only "present" is allowed)`);
  if (typeof mod.aot !== "boolean") fail(`${id}: aot must be a boolean`);
  if (!Array.isArray(mod.registration) || !mod.registration.length) fail(`${id}: registration required`);
  for (const mode of mod.registration ?? []) if (!modes.has(mode)) fail(`${id}: unknown registration ${mode}`);
  const blocked = (mod.registration ?? []).some((mode: string) => AOT_BLOCKERS.includes(mode));
  if (blocked && mod.aot) fail(`${id}: ${mod.registration} cannot be aot without --aot-allow-code-from-disk`);
  if (!blocked && !mod.aot) fail(`${id}: aot=false needs a run-time registration (${AOT_BLOCKERS.join(", ")})`);
  const source = mod.source ?? {};
  if (source.type === "submodule") {
    seen.submodule.add(mod.path);
    if (gitmodules.get(mod.path) !== source.url)
      fail(`${id}: .gitmodules url ${gitmodules.get(mod.path)} != ${source.url}`);
    if (gitlinks.get(mod.path) !== source.pin) fail(`${id}: gitlink ${gitlinks.get(mod.path)} != pin ${source.pin}`);
  } else if (source.type === "workspace") {
    seen.workspace.add(mod.path);
    const pkg = await Bun.file(join(root, mod.path, "package.json"))
      .json()
      .catch(() => undefined);
    if (!pkg) fail(`${id}: ${mod.path}/package.json missing`);
    else if (pkg.name !== source.name || pkg.version !== source.version)
      fail(`${id}: package.json is ${pkg.name}@${pkg.version}, manifest ${source.name}@${source.version}`);
  } else if (source.type === "path-crate") {
    seen.crate.add(mod.path);
    const text = await read(`${mod.path}/Cargo.toml`).catch(() => "");
    const name = text.match(/^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m)?.[1];
    if (name !== source.name) fail(`${id}: Cargo.toml package ${name} != ${source.name}`);
    if (!pathCrates.has(source.name)) fail(`${id}: ${source.name} is not in Cargo.lock`);
  } else if (source.type === "crates.io") {
    const versions = locked.get(source.name);
    if (!versions) fail(`${id}: ${source.name} not locked in Cargo.lock`);
    else if (versions.join() !== (source.locked ?? []).join()) fail(`${id}: locked ${versions} != ${source.locked}`);
    if (
      !new RegExp(`^${(source.key ?? source.name).replace(/[.+]/g, "\\$&")}\\s*=`, "m").test(
        rootCargo.split("[workspace.dependencies]")[1] ?? "",
      )
    )
      fail(`${id}: not in [workspace.dependencies] of Cargo.toml`);
  } else fail(`${id}: unknown source type ${source.type}`);
}

// Every repository component must be listed (the manifest is the single list).
for (const path of gitmodules.keys()) if (!seen.submodule.has(path)) fail(`submodule ${path}: not in the manifest`);
for (const file of tracked) {
  if (/^(packages|apps)\/[^/]+\/package\.json$/.test(file)) {
    const dir = dirname(file).replace(/\\/g, "/");
    const pkg = await Bun.file(join(root, file)).json();
    if (pkg.name && !seen.workspace.has(dir) && !ids.has(`npm:${pkg.name}`))
      fail(`workspace ${dir}: not in the manifest`);
  }
  if (file.endsWith("/Cargo.toml")) {
    const text = await read(file);
    const name = text.match(/^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m)?.[1];
    const dir = dirname(file).replace(/\\/g, "/");
    if (name && pathCrates.has(name) && !seen.crate.has(dir)) fail(`crate ${dir}: not in the manifest`);
  }
}
void workspaceVersion;

// ---- no fork path, no fork-only bun:* ----------------------------------------------------------------------------
const fork = await git(
  "grep",
  "-l",
  "toolchains/bun",
  "--",
  ".gitmodules",
  "Cargo.toml",
  "*/Cargo.toml",
  "package.json",
  "*/package.json",
  "factory/bunos/components.json",
  "sources.lock.json",
);
for (const file of fork.out.split("\n").filter(Boolean)) fail(`${file}: references the removed toolchains/bun path`);
for (const mod of manifest.modules ?? [])
  if (JSON.stringify(mod).includes("toolchains/bun")) fail(`${mod.id}: toolchains/bun`);

const imports = await git(
  "grep",
  "-nIE",
  String.raw`(from|import\(|require\()\s*["']bun:[a-z_-]+["']`,
  "--",
  "*.ts",
  "*.tsx",
  "*.js",
  "*.mjs",
  "*.cts",
  "*.mts",
);
for (const line of imports.out.split("\n").filter(Boolean)) {
  for (const m of line.matchAll(/["']bun:([a-z_-]+)["']/g))
    if (!UPSTREAM_BUN_MODULES.has(m[1])) fail(`${line.split(":").slice(0, 2).join(":")}: fork-only module bun:${m[1]}`);
}

for (const line of errors.slice(0, 200)) console.error(`error: ${line}`);
if (errors.length > 200) console.error(`... ${errors.length - 200} more`);
const count = (kind: string) => (manifest.modules ?? []).filter((m: any) => m.kind === kind).length;
console.log(
  `runtime bun@${runtime?.source?.version}; ${manifest.modules?.length ?? 0} modules ` +
    `(${[...kinds].map(k => `${count(k)} ${k}`).join(", ")}); ` +
    `${(manifest.modules ?? []).filter((m: any) => !m.aot).length} not AOT-safe; ${errors.length} errors`,
);
process.exit(errors.length ? 1 : 0);
