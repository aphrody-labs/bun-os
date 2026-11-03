// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSyncLock } from "../src/drive-sync.ts";

test("simultaneous syncs cannot take the same lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "drive-lock-"));
  try {
    const lock = join(root, "lock");
    const attempts = await Promise.allSettled([acquireSyncLock(lock), acquireSyncLock(lock)]);
    const acquired = attempts.filter(result => result.status === "fulfilled");
    expect(acquired).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    await (acquired[0] as PromiseFulfilledResult<() => Promise<void>>).value();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("abandoned and replaced locks are preserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "drive-lock-"));
  try {
    const lock = join(root, "lock");
    await mkdir(lock);
    await expect(acquireSyncLock(lock)).rejects.toThrow("preserve");
    await rm(lock, { recursive: true });
    const release = await acquireSyncLock(lock);
    await rename(lock, join(root, "original"));
    await mkdir(lock);
    await expect(release()).rejects.toThrow("ownership changed");
    await expect(acquireSyncLock(lock)).rejects.toThrow("preserve");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
