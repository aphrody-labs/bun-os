#!/usr/bin/env bun
/** Inspect immutable Git manifests before migrating flat crate ownership. */
import { dirname, resolve } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";

type Manifest = {
  package?: { name?: string; version?: string | { workspace: boolean } };
  workspace?: {
    dependencies?: Record<string, unknown>;
    members?: string[];
    exclude?: string[];
  };
  dependencies?: Record<string, unknown>;
  "dev-dependencies"?: Record<string, unknown>;
  "build-dependencies"?: Record<string, unknown>;
  target?: Record<string, Manifest>;
};
const root = resolve(import.meta.dir, "..");
if (process.argv.slice(2).some(value => value === "--help" || value === "-h")) {
  console.log(
    "Usage: bun scripts/crate-inventory.ts [owner=checkout ...]\nInspect pinned crate manifests; write .local/crate-inventory.json without changing sources.",
  );
  process.exit(0);
}
const extraSources = process.argv.slice(2).map(value => {
  const separator = value.indexOf("=");
  if (separator < 1) throw new Error("Source argument must be owner=checkout");
  return {
    owner: value.slice(0, separator),
    path: resolve(root, value.slice(separator + 1)),
  };
});
async function git(path: string, args: string[]) {
  const result = await runProcess(["git", ...args], path, {
    timeoutMs: 30_000,
    maxOutputBytes: 8 * 1024 * 1024,
  });
  if (result.code !== 0) throw new Error(`Git source inventory failed: ${args[0]}`);
  return result.stdout.trim();
}
const gitlinks = (await git(root, ["ls-files", "--stage", "-z"]))
  .split("\0")
  .filter(line => line.startsWith("160000 "))
  .map(line => line.slice(line.indexOf("\t") + 1))
  .filter(path => path.startsWith("crates/"))
  .map(path => ({ owner: path, path: resolve(root, path) }));
const sources = [...gitlinks, ...extraSources];
if (new Set(sources.map(source => source.owner)).size !== sources.length) throw new Error("Duplicate source owner");
const crates: {
  owner: string;
  revision: string;
  manifest: string;
  name: string;
  destination: string;
  dependencies: string[];
  migrated: boolean;
  declaredWorkspaceMember: boolean;
}[] = [];
const unavailable: string[] = [];
const sourcePins: { owner: string; revision: string; manifests: number }[] = [];
for (const source of sources) {
  if (
    !(await Bun.file(resolve(source.path, ".git")).exists()) &&
    !(await Bun.file(resolve(source.path, ".git/HEAD")).exists())
  ) {
    unavailable.push(source.owner);
    continue;
  }
  const revision = await git(source.path, ["rev-parse", "HEAD"]);
  const paths = (await git(source.path, ["ls-tree", "-r", "--name-only", revision]))
    .split("\n")
    .filter(path => path === "Cargo.toml" || path.endsWith("/Cargo.toml"));
  const manifests = new Map<string, Manifest>();
  const objects = await runProcess(["git", "cat-file", "--batch"], source.path, {
    timeoutMs: 30_000,
    maxOutputBytes: 8 * 1024 * 1024,
    input: new TextEncoder().encode(paths.map(path => `${revision}:${path}\n`).join("")),
  });
  if (objects.code !== 0) throw new Error("Immutable manifest batch failed");
  const bytes = new TextEncoder().encode(objects.stdout);
  let offset = 0;
  for (const path of paths) {
    const end = bytes.indexOf(10, offset);
    const header = new TextDecoder().decode(bytes.subarray(offset, end));
    const match = /^[a-f0-9]+ blob (\d+)$/.exec(header);
    if (!match) throw new Error("Invalid Git manifest object");
    const size = Number(match[1]);
    offset = end + 1;
    manifests.set(path, Bun.TOML.parse(new TextDecoder().decode(bytes.subarray(offset, offset + size))) as Manifest);
    offset += size + 1;
  }
  const workspace = manifests.get("Cargo.toml")?.workspace;
  sourcePins.push({ owner: source.owner, revision, manifests: paths.length });
  for (const [path, manifest] of manifests) {
    const name = manifest.package?.name;
    if (!name) continue;
    let directory = dirname(path).replaceAll("\\", "/");
    let inherited: Record<string, unknown> = {};
    while (true) {
      const parent = manifests.get(directory === "." ? "Cargo.toml" : `${directory}/Cargo.toml`);
      if (parent?.workspace) {
        inherited = parent.workspace.dependencies ?? {};
        break;
      }
      if (directory === ".") break;
      directory = dirname(directory).replaceAll("\\", "/");
    }
    const names = new Set<string>();
    for (const table of [manifest, ...Object.values(manifest.target ?? {})]) {
      for (const kind of ["dependencies", "dev-dependencies", "build-dependencies"] as const) {
        for (const [alias, value] of Object.entries(table[kind] ?? {})) {
          let dependency = value;
          if (typeof value === "object" && value !== null && "workspace" in value)
            dependency = inherited[alias] ?? value;
          const packageName =
            typeof dependency === "object" && dependency !== null && "package" in dependency
              ? String(dependency.package)
              : alias;
          names.add(packageName);
        }
      }
    }
    crates.push({
      owner: source.owner,
      revision,
      manifest: path,
      name,
      destination: `crates/${name}`,
      dependencies: [...names].sort(),
      migrated: source.owner === `crates/${name}` && path === "Cargo.toml",
      declaredWorkspaceMember:
        path === "Cargo.toml" ||
        Boolean(
          workspace?.members?.some(pattern =>
            new Bun.Glob(pattern.replace(/\/$/, "")).match(dirname(path).replaceAll("\\", "/")),
          ) &&
          !workspace.exclude?.some(pattern =>
            new Bun.Glob(pattern.replace(/\/$/, "")).match(dirname(path).replaceAll("\\", "/")),
          ),
        ),
    });
  }
}
const ownersByName = new Map<string, string[]>();
for (const crate of crates) ownersByName.set(crate.name, [...(ownersByName.get(crate.name) ?? []), crate.owner]);
const collisions = [...ownersByName]
  .filter(([, owners]) => owners.length > 1)
  .map(([name, owners]) => ({ name, owners }));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  rootRevision: await git(root, ["rev-parse", "HEAD"]),
  sourcePins,
  counts: {
    sources: sourcePins.length,
    crates: crates.length,
    migrated: crates.filter(crate => crate.migrated).length,
    declaredWorkspaceCrates: crates.filter(crate => crate.declaredWorkspaceMember).length,
    remainingDeclared: crates.filter(crate => crate.declaredWorkspaceMember && !crate.migrated).length,
  },
  unavailable,
  collisions,
  crates,
};
const output = resolve(root, ".local/crate-inventory.json");
await Bun.write(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      ...report.counts,
      collisions: collisions.length,
      unavailable,
      report: output,
    },
    null,
    2,
  ),
);
