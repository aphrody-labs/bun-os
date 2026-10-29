import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanWorkspace, measureArtifact } from "../../src/automation/workspace-clean.ts";
const roots: string[] = [];
test("artifact accounting tolerates a file disappearing during a concurrent Cargo run", async () => {
  const root = await fixture();
  const path = join(root, "rmeta-temporary");
  await writeFile(path, "temporary");
  await rm(path);
  expect(await measureArtifact(path)).toEqual({ bytes: 0, files: 0 });
});
afterEach(async () => {
  // oxlint-disable-next-line no-await-in-loop -- roots are removed one by one at teardown (a failed removal must not hide the others)
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-clean-"));
  roots.push(root);
  Bun.spawnSync(["git", "init", "-q", root], { windowsHide: true });
  await writeFile(join(root, ".gitignore"), "target/\nbuild/\n.cache/\n");
  return root;
}
test("tracked target sources survive cleanup, ignored nested artifacts are removed", async () => {
  const root = await fixture();
  await mkdir(join(root, "src/target"), { recursive: true });
  await writeFile(join(root, "src/target/mod.rs"), "pub struct Target;");
  Bun.spawnSync(["git", "-C", root, "add", "-f", "src/target/mod.rs"], {
    windowsHide: true,
  });
  await mkdir(join(root, "crates/a/target"), { recursive: true });
  await writeFile(join(root, "crates/a/target/object.o"), "generated");
  const preview = await cleanWorkspace(root);
  expect(preview.protected).toContain("src/target");
  expect(preview.removed.map(p => p.path)).toContain("crates/a/target");
  expect(existsSync(join(root, "crates/a/target/object.o"))).toBe(true);
  await cleanWorkspace(root, true);
  expect(existsSync(join(root, "src/target/mod.rs"))).toBe(true);
  expect(existsSync(join(root, "crates/a/target"))).toBe(false);
});
test("unignored source build directory and symlink targets survive", async () => {
  const root = await fixture();
  await writeFile(join(root, ".gitignore"), "target/\n");
  await mkdir(join(root, "scripts/aphrody/build"), { recursive: true });
  await writeFile(join(root, "scripts/aphrody/build/source.ts"), "source");
  const outside = await mkdtemp(join(tmpdir(), "aphrody-clean-outside-"));
  roots.push(outside);
  await writeFile(join(outside, "keep"), "keep");
  await symlink(outside, join(root, "target"));
  await cleanWorkspace(root, true);
  expect(existsSync(join(root, "scripts/aphrody/build/source.ts"))).toBe(true);
  expect(existsSync(join(outside, "keep"))).toBe(true);
});
test("Git metadata and installed dependency trees are pruned", async () => {
  const root = await fixture();
  for (const parent of ["node_modules/a", ".venv/lib"]) {
    // oxlint-disable-next-line no-await-in-loop -- fixture trees are created one at a time in order before the clean run
    await mkdir(join(root, parent, "target"), { recursive: true });
    // oxlint-disable-next-line no-await-in-loop -- fixture trees are created one at a time in order before the clean run
    await writeFile(join(root, parent, "target/keep"), "dependency");
  }
  await cleanWorkspace(root, true);
  expect(existsSync(join(root, ".git/HEAD"))).toBe(true);
  expect(existsSync(join(root, "node_modules/a/target/keep"))).toBe(true);
  expect(existsSync(join(root, ".venv/lib/target/keep"))).toBe(true);
});
