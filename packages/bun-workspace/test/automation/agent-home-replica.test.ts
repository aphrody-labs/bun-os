// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { copyFile, mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replicateHome, snapshotFiles } from "../../src/automation/agent-home-replica.ts";

test("replica snapshots contracted documents and evidence, excludes authentication and unrelated files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-replica-"));
  try {
    const home = join(dir, "home"),
      incoming = join(dir, "incoming");
    await mkdir(home);
    await mkdir(incoming);
    await Bun.write(join(home, "USER.md"), "Owner profile");
    await Bun.write(join(home, ".env"), "TOKEN=private");
    const staged = join(incoming, "USER.md-" + "a".repeat(16) + "-" + "b".repeat(16));
    await mkdir(staged);
    await Bun.write(join(staged, "remote.candidate.md"), "Remote owner profile");
    await Bun.write(join(staged, "credentials.json"), "private");
    const files = await snapshotFiles(home, incoming, ["USER.md"], join(dir, "out"));
    expect(files.map(file => file.relative)).toEqual([
      "active/USER.md",
      "incoming/USER.md-" + "a".repeat(16) + "-" + "b".repeat(16) + "/remote.candidate.md",
    ]);
    expect(files.every(file => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("replica verifies every upload before indexing and repairs corrupted snapshots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-replica-"));
  try {
    const home = join(dir, "home");
    await mkdir(home);
    await Bun.write(join(home, "USER.md"), "Owner profile");
    await Bun.write(join(home, "SOUL.md"), "Agent profile");
    await Bun.write(join(home, "MEMORY.md"), "Domain memory");
    const contract = join(dir, "contract.json");
    await Bun.write(contract, JSON.stringify(["USER.md", "SOUL.md"]));
    let uploads = 0,
      indexes = 0,
      corrupt = true;
    const run = async (argv: string[]) => {
      if (argv.includes("sftp")) {
        const target = argv[argv.indexOf("--path") + 1]!;
        await copyFile(argv[argv.indexOf("--put") + 1]!, target);
        if (corrupt && target.endsWith("SOUL.md")) await Bun.write(target, "corrupted");
        uploads++;
        return "";
      }
      const command = argv[argv.indexOf("--cmd") + 1]!;
      if (!command.startsWith("/home/ubuntu/.bun/bin/bun -e ")) {
        indexes++;
        return '{"errors":[],"indexed":3}';
      }
      const nativeCommand = command.replace(
        "/home/ubuntu/.bun/bin/bun",
        "'" + process.execPath.replaceAll("'", "'\\''") + "'",
      );
      const child = Bun.spawn(["sh", "-c", nativeCommand], {
        windowsHide: true,
        stdout: "pipe",
        stderr: "ignore",
      });
      const result = await new Response(child.stdout).text();
      if ((await child.exited) !== 0) throw Error("Remote verification failed");
      return result;
    };
    const config = {
      incoming: join(dir, "incoming"),
      contract,
      homeDocuments: ["MEMORY.md"],
      directory: join(dir, "remote"),
      stateRoot: dir,
      extraStateRoot: dir,
      intervalSeconds: 300,
    };
    await expect(replicateHome(config, home, join(dir, "receipts"), "aphrody", run)).rejects.toThrow();
    expect(indexes).toBe(0);
    corrupt = false;
    expect(await replicateHome(config, home, join(dir, "receipts"), "aphrody", run)).toEqual({
      files_copied: 3,
      homes_indexed: 2,
      indexed: 6,
    });
    expect(await replicateHome(config, home, join(dir, "receipts"), "aphrody", run)).toEqual({
      files_copied: 0,
      homes_indexed: 2,
      indexed: 6,
    });
    expect(uploads).toBe(6);
    const folders = await import("node:fs/promises").then(({ readdir }) => readdir(config.directory));
    await Bun.write(join(config.directory, folders[0]!, "active/USER.md"), "corrupted later");
    expect((await replicateHome(config, home, join(dir, "receipts"), "aphrody", run)).files_copied).toBe(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("replica refuses symlinked documents and path traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-replica-"));
  try {
    await Bun.write(join(dir, "private.env"), "secret");
    await symlink(join(dir, "private.env"), join(dir, "USER.md"));
    await expect(snapshotFiles(dir, join(dir, "none"), ["USER.md"], join(dir, "out"))).rejects.toThrow(
      "Unsafe snapshot source",
    );
    await expect(snapshotFiles(dir, join(dir, "none"), ["../private.env"], join(dir, "out"))).rejects.toThrow(
      "Unsafe home document name",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
