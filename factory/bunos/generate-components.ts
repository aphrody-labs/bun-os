#!/usr/bin/env bun
/**
 * Regenerates every derived pin of factory/bunos/components.json from the repository, so nobody edits them by hand:
 *   bun factory/bunos/generate-components.ts          rewrite the manifest
 *   bun factory/bunos/generate-components.ts --check  exit 1 if the manifest is stale (no write)
 * Sources of truth: package.json (runtime pin), sources.lock.json (runtime gitHead), the index gitlinks (submodule
 * pins), packages/apps package.json (workspace name/version) and Cargo.lock (crates.io locked versions).
 * Descriptive fields (registration, aot, edges, notes) and the set of components stay hand-curated;
 * check-components.ts reports components missing from the manifest.
 */
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const file = join(root, "factory/bunos/components.json");
const checkOnly = process.argv.includes("--check");

const run = async (cmd: string[]) => {
  const proc = Bun.spawn(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code) throw new Error(`${cmd.join(" ")}: ${err.trim()}`);
  return out.replace(/\r/g, "");
};
const json = (path: string) => Bun.file(join(root, path)).json();

const manifest = await json("factory/bunos/components.json");

const gitlinks = new Map<string, string>();
for (const line of (await run(["git", "ls-files", "-s"])).split("\n")) {
  const m = line.match(/^160000 (\w+) \d\t(.*)$/);
  if (m) gitlinks.set(m[2], m[1]);
}
const locked = new Map<string, string[]>();
for (const m of (await Bun.file(join(root, "Cargo.lock")).text()).matchAll(
  /\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\nsource = "registry\+/g,
))
  locked.set(m[1], [...(locked.get(m[1]) ?? []), m[2]]);

const changes: string[] = [];
const set = (id: string, target: any, key: string, value: unknown) => {
  if (value === undefined || JSON.stringify(target[key]) === JSON.stringify(value)) return;
  changes.push(`${id}: ${key} ${JSON.stringify(target[key])} -> ${JSON.stringify(value)}`);
  target[key] = value;
};

const pkg = await json("package.json");
const sources = await json("sources.lock.json");
const runtime = manifest.runtime.source;
set("runtime", runtime, "version", pkg.devDependencies?.bun ?? pkg.dependencies?.bun);
set("runtime", runtime, "gitHead", sources.repositories?.find((r: any) => r.id === "bun")?.revision);

for (const mod of manifest.modules ?? []) {
  const source = mod.source ?? {};
  if (source.type === "submodule") set(mod.id, source, "pin", gitlinks.get(mod.path));
  else if (source.type === "workspace") {
    const p = await json(`${mod.path}/package.json`).catch(() => undefined);
    set(mod.id, source, "name", p?.name);
    set(mod.id, source, "version", p?.version);
  } else if (source.type === "crates.io") set(mod.id, source, "locked", locked.get(source.name));
}

if (checkOnly) {
  for (const line of changes) console.error(`stale: ${line}`);
  console.log(`components.json: ${changes.length} stale pin(s)`);
  process.exit(changes.length ? 1 : 0);
}
if (changes.length) {
  await Bun.write(file, JSON.stringify(manifest, null, 2) + "\n");
  await run(["bun", "fmt", "--config", "bun-format.json", "factory/bunos/components.json"]);
}
for (const line of changes) console.log(`updated: ${line}`);
console.log(`components.json: ${changes.length} pin(s) updated`);
