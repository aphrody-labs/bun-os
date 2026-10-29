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
