// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bunDataDir, fetchForkDocs, resolveBunDocs } from "../../src/automation/bun-upstream-docs.ts";

function scratch(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "bun-docs-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return proc.stdout.toString().trim();
}

describe("bun-upstream-docs", () => {
  test("user data directory follows APPDATA, XDG_DATA_HOME, then HOME", () => {
    expect(bunDataDir({ APPDATA: "C:/Users/a/AppData/Roaming" }, "win32")).toBe(
      join("C:/Users/a/AppData/Roaming", "aphrody", "bun"),
    );
    expect(bunDataDir({}, "win32")).toBeUndefined();
    expect(bunDataDir({ XDG_DATA_HOME: "/data", HOME: "/home/a" }, "linux")).toBe(join("/data", "aphrody", "bun"));
    expect(bunDataDir({ XDG_DATA_HOME: "relative", HOME: "/home/a" }, "linux")).toBe(
      join("/home/a", ".local", "share", "aphrody", "bun"),
    );
  });

  test("resolution order: override, checkout, installed, previous download, then explicit failure", async () => {
    const dir = scratch({
      "bun/docs/docs.json": "{}",
      "data/aphrody/bun/docs/index.mdx": "# Installed",
      "data/aphrody/bun/docs-0123456789ab/docs/docs.json": "{}",
      "pin.json": JSON.stringify({
        commit: "0123456789abcdef0123456789abcdef01234567",
      }),
    });
    try {
      const pinFile = join(dir, "pin.json");
      const base = { APPDATA: join(dir, "data") };
      const opts = (env: Record<string, string>) => ({
        env,
        platform: "win32",
        pinFile,
        download: false,
      });
      expect(await resolveBunDocs(opts({ ...base, APHRODY_BUN_DOCS: join(dir, "bun/docs") }))).toEqual({
        dir: join(dir, "bun/docs"),
        source: "override",
      });
      await expect(resolveBunDocs(opts({ ...base, APHRODY_BUN_DOCS: join(dir, "absent") }))).rejects.toThrow(
        "APHRODY_BUN_DOCS",
      );
      expect(await resolveBunDocs(opts({ ...base, APHRODY_BUN_CHECKOUT: join(dir, "bun") }))).toEqual({
        dir: join(dir, "bun", "docs"),
        source: "checkout",
      });
      expect(await resolveBunDocs(opts({ ...base, APHRODY_BUN_CHECKOUT: join(dir, "absent") }))).toEqual({
        dir: join(dir, "data", "aphrody", "bun", "docs"),
        source: "installed",
      });
      rmSync(join(dir, "data/aphrody/bun/docs"), { recursive: true });
      expect(await resolveBunDocs(opts({ ...base, APHRODY_BUN_CHECKOUT: join(dir, "absent") }))).toEqual({
        dir: join(dir, "data", "aphrody", "bun", "docs-0123456789ab", "docs"),
        source: "download",
      });
      await expect(
        resolveBunDocs(
          opts({
            ...base,
            APHRODY_BUN_CHECKOUT: join(dir, "absent"),
            APHRODY_BUN_DOCS_REF: "other",
          }),
        ),
      ).rejects.toThrow(/Bun docs not found .*APHRODY_BUN_CHECKOUT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the versioned download fetches only docs/ and the licence of the requested commit", async () => {
    const dir = scratch({
      "fork/docs/docs.json": "{}",
      "fork/docs/runtime/file-io.mdx": "# File I/O",
      "fork/docs/images/logo.png": "png",
      "fork/LICENSE.md": "MIT",
      "fork/src/main.rs": "fn main() {}",
    });
    try {
      const fork = join(dir, "fork");
      git(fork, "init", "--quiet");
      git(fork, "config", "uploadpack.allowFilter", "true");
      git(fork, "config", "uploadpack.allowAnySHA1InWant", "true");
      git(fork, "add", ".");
      git(
        fork,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "docs",
      );
      const head = git(fork, "rev-parse", "HEAD");
      const path = fork.replaceAll("\\", "/");
      const url = path.startsWith("/") ? `file://${path}` : `file:///${path}`;
      const dest = join(dir, "data", `docs-${head.slice(0, 12)}`);
      expect(await fetchForkDocs(head, dest, url)).toBe(dest);
      expect(existsSync(join(dest, "docs/runtime/file-io.mdx"))).toBe(true);
      expect(existsSync(join(dest, "LICENSE.md"))).toBe(true);
      expect(existsSync(join(dest, "docs/images"))).toBe(false);
      expect(existsSync(join(dest, "src"))).toBe(false);
      await expect(fetchForkDocs("main", join(dir, "other", "docs-x"), "file:///absent-fork")).rejects.toThrow(
        "git clone",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
