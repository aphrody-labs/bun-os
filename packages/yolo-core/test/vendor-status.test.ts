// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectStatusReport,
  inspectPackages,
  readGitHead,
  readVendorStatus,
  renderStatusMarkdown,
} from "../src/vendor/status";
import { readWorkspaceCargo } from "../src/vendor/cargo";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function git(cwd: string, ...args: string[]) {
  const child = Bun.spawnSync(["git", ...args], {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
  return child.stdout.toString().trim();
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yolo-vendor-refs-"));
  roots.push(root);
  const repository = join(root, "vendor/tauri");
  mkdirSync(repository, { recursive: true });
  git(repository, "init", "--quiet", "--initial-branch=main");
  git(
    repository,
    "-c",
    "user.name=fixture-owner",
    "-c",
    "user.email=fixture@localhost",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  );
  const sha = git(repository, "rev-parse", "HEAD");
  return { root, repository, sha };
}
test("full SHA survives packed refs and vendor comparison rejects a matching short prefix", async () => {
  const value = fixture();
  git(value.repository, "pack-refs", "--all");
  expect(await readGitHead(value.repository)).toBe(value.sha);
  const packages = await inspectPackages(join(value.root, "vendor"));
  expect(packages.find(entry => entry.name === "tauri")?.headCommit).toBe(value.sha);
  writeFileSync(
    join(value.root, "vendor.lock"),
    JSON.stringify({
      sources: [{ name: "tauri", sha: value.sha }],
      crates: [],
    }),
  );
  expect((await readVendorStatus(value.root))?.sources[0]?.inSync).toBe(true);
  writeFileSync(
    join(value.root, "vendor.lock"),
    JSON.stringify({
      sources: [{ name: "tauri", sha: `${value.sha.slice(0, 10)}${"0".repeat(30)}` }],
      crates: [],
    }),
  );
  expect((await readVendorStatus(value.root))?.sources[0]?.inSync).toBe(false);
});
test("the vendor catalog owns discovery and retains declared missing checkouts", async () => {
  const value = fixture();
  mkdirSync(join(value.root, "tools/config"), { recursive: true });
  mkdirSync(join(value.root, "vendor/unlisted"));
  writeFileSync(
    join(value.root, "tools/config/vendor.json"),
    JSON.stringify({ sources: [{ name: "tauri" }, { name: "missing" }] }),
  );
  const packages = await inspectPackages(join(value.root, "vendor"));
  expect(packages.map(entry => entry.name)).toEqual(["tauri", "missing"]);
  expect(packages[0]?.headCommit).toBe(value.sha);
  expect(packages[1]?.exists).toBe(false);
  expect(packages[1]?.path).toBe(join(value.root, "vendor/missing"));
});
test("linked fixture worktree resolves common packed refs and detached HEAD", async () => {
  const value = fixture();
  const linked = join(value.root, "linked-fixture");
  git(value.repository, "worktree", "add", "--quiet", "-b", "linked", linked);
  git(value.repository, "pack-refs", "--all");
  expect(await readGitHead(linked)).toBe(value.sha);
  git(linked, "checkout", "--quiet", "--detach", value.sha);
  expect(await readGitHead(linked)).toBe(value.sha);
});
test("bounded symbolic refs resolve while malformed or cyclic metadata stays unqualified", async () => {
  const value = fixture();
  git(value.repository, "symbolic-ref", "refs/heads/alias", "refs/heads/main");
  git(value.repository, "symbolic-ref", "HEAD", "refs/heads/alias");
  expect(await readGitHead(value.repository)).toBe(value.sha);
  writeFileSync(join(value.repository, ".git/refs/heads/alias"), "ref: refs/heads/alias\n");
  expect(await readGitHead(value.repository)).toBeUndefined();
  writeFileSync(join(value.repository, ".git/HEAD"), "ref: refs/../outside\n");
  expect(await readGitHead(value.repository)).toBeUndefined();
});

test("status distinguishes the core default selection from all workspace members", async () => {
  const root = mkdtempSync(join(tmpdir(), "yolo-cargo-selection-"));
  roots.push(root);
  writeFileSync(
    join(root, "Cargo.toml"),
    '[workspace]\nmembers = ["crates/*"]\ndefault-members = ["crates/engine/yolo-core", "crates/engine/yolo-runtime"]\n',
  );
  const status = await collectStatusReport(root);
  expect(status.cargo?.members).toEqual(["crates/*"]);
  expect(status.cargo?.defaultMembers).toEqual(["crates/engine/yolo-core", "crates/engine/yolo-runtime"]);
  expect(renderStatusMarkdown(status)).toContain(
    "**Default Members:** crates/engine/yolo-core, crates/engine/yolo-runtime",
  );
  writeFileSync(join(root, "Cargo.toml"), '[workspace]\nmembers = ["crates/*"]\n');
  expect((await readWorkspaceCargo(root))?.defaultMembers).toBeNull();
  writeFileSync(join(root, "Cargo.toml"), '[workspace]\nmembers = ["crates/*"]\ndefault-members = []\n');
  expect((await readWorkspaceCargo(root))?.defaultMembers).toEqual([]);
});
