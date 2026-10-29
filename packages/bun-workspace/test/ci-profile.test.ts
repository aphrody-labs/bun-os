import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { conePaths, gitlinks, selectSubmodules, type ProfileFile } from "../src/git-scale.ts";

const root = resolve(import.meta.dir, "../../..");
const text = (path: string) => Bun.file(resolve(root, path)).text();

/** First two segments of every `vendor/<name>` a source mentions (vendor/uutils/<tool> stay one level deeper). */
const vendorPaths = (source: string) =>
  [...source.matchAll(/(?<![\w/.-])vendor\/([\w.-]+)(?:\/([\w.-]+))?/g)].map(m =>
    m[1] === "uutils" ? `vendor/uutils/${m[2] ?? ""}` : `vendor/${m[1]}`,
  );

/** `../vendor/<name>` references in tracked first-party files (git grep over the tracked tree only). */
async function relativeVendorReferences(): Promise<string> {
  const proc = Bun.spawn(
    [
      "git",
      "grep",
      "-hoE",
      "(\\.\\./)+vendor/[A-Za-z0-9_.-]+",
      "--no-recurse-submodules",
      "--",
      "crates",
      "apps",
      ":!vendor",
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

test("the ci profile mounts every vendor tree that `bun run setup` and the CI jobs read", async () => {
  const file = (await Bun.file(resolve(root, "packages/bun-workspace/config/git-profiles.json")).json()) as ProfileFile;
  const profile = file.profiles.ci!;
  const links = await gitlinks(root);
  const mounted = selectSubmodules(file, profile, links).submodules;
  const cone = conePaths(file, profile, links);
  const covered = (path: string) =>
    mounted.some(m => path === m || path.startsWith(`${m}/`)) || cone.some(c => path === c || path.startsWith(`${c}/`));

  const pkg = JSON.parse(await text("package.json")) as { workspaces: string[] | { packages: string[] } };
  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;
  const required = new Set<string>([
    ...vendorPaths(await text("scripts/setup-submodules.ts")),
    ...vendorPaths(await text("scripts/setup.ts")),
    ...workspaces.flatMap(w => vendorPaths(w)),
    // Cargo workspace members and path dependencies under vendor/.
    ...vendorPaths(await text("Cargo.toml")),
    // Relative includes and path dependencies that climb out of a first-party tree into vendor/ (build scripts, specs).
    ...vendorPaths(await relativeVendorReferences()),
  ]);
  required.delete("vendor/uutils/");
  // Only gitlinks and tracked cone directories can be mounted; a path the repository does not contain is not required.
  const existing = [...required].filter(p => links.some(l => l === p || p.startsWith(`${l}/`)) || cone.includes(p));
  expect(existing.length).toBeGreaterThan(0);
  expect(existing.filter(p => !covered(p)).sort()).toEqual([]);
  expect(required.has("vendor/material-web")).toBe(true);
  expect(covered("vendor/material-web")).toBe(true);
  expect(selectSubmodules(file, profile, links).unmatched).toEqual([]);
});

const repoPath = /(?:packages|factory|scripts|src|infra)\/[\w./-]+\.(?:ts|js|mjs)/g;
const inCone = (cone: string[], path: string) => cone.some(c => path === c || path.startsWith(`${c}/`));

/** Local files a TypeScript entry imports, transitively (relative specifiers only). */
async function importClosure(entry: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await text(file);
    for (const m of source.matchAll(/(?:from|import\()\s*"(\.{1,2}\/[^"]+)"/g)) {
      const base = resolve(root, file, "..", m[1]!).replaceAll("\\", "/");
      const rel = base.slice(root.replaceAll("\\", "/").length + 1);
      for (const candidate of [rel, `${rel}.ts`, `${rel}/index.ts`])
        if (await Bun.file(resolve(root, candidate)).exists()) {
          queue.push(candidate);
          break;
        }
    }
  }
  return [...seen];
}

test("the bootstrap cone holds every repository file the setup-workspace steps run before the profile is applied", async () => {
  const workflow = Bun.YAML.parse(await text(".github/workflows/ci.yml")) as {
    jobs: Record<string, { steps: { with?: Record<string, string>; uses?: string }[] }>;
  };
  const action = Bun.YAML.parse(await text(".github/actions/setup-workspace/action.yml")) as {
    runs: { steps: { name?: string; run?: string; shell?: string }[] };
  };
  // Steps up to and including the one that applies the profile run inside the bootstrap cone only.
  const steps = action.runs.steps;
  const last = steps.findIndex(s => s.name?.startsWith("Sparse checkout and submodule profile"));
  expect(last).toBeGreaterThan(-1);
  const referenced = new Set<string>();
  for (const step of steps.slice(0, last + 1))
    for (const m of `${step.shell ?? ""}\n${step.run ?? ""}`.matchAll(repoPath)) referenced.add(m[0]);
  expect(referenced.size).toBeGreaterThan(0);
  const files = new Set(referenced);
  for (const entry of referenced) for (const f of await importClosure(entry)) files.add(f);

  const jobs = Object.entries(workflow.jobs).filter(([, job]) =>
    job.steps.some(s => s.uses === "./.github/actions/setup-workspace" && s.with?.profile && s.with.profile !== "all"),
  );
  expect(jobs.length).toBeGreaterThan(0);
  for (const [name, job] of jobs) {
    const checkout = job.steps.find(s => s.uses?.startsWith("actions/checkout"));
    const cone = String(checkout?.with?.["sparse-checkout"] ?? "")
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);
    const missing = [...files].filter(f => !inCone(cone, f));
    expect({ job: name, missing }).toEqual({ job: name, missing: [] });
  }
});

test("the ci profile cone holds the tracked files `buncc doctor --repo` reads", async () => {
  const file = (await Bun.file(resolve(root, "packages/bun-workspace/config/git-profiles.json")).json()) as ProfileFile;
  const cone = conePaths(file, file.profiles.ci!, await gitlinks(root));
  for (const path of ["vendor/microsoft/PINS.json", "examples/windows/d3d12-headless/rust/Cargo.toml"])
    expect({ path, covered: inCone(cone, path) }).toEqual({ path, covered: true });
});
