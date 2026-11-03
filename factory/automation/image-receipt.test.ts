// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sessionImageReceipt } from "./nightly.ts";

test("concurrent jobs read only their own image receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunos-image-receipt-"));
  try {
    const first = join(root, "first"),
      second = join(root, "second"),
      missing = join(root, "missing");
    await Promise.all([
      mkdir(join(first, "out"), { recursive: true }),
      mkdir(join(second, "out"), { recursive: true }),
    ]);
    const firstId = `sha256:${"a".repeat(64)}`,
      secondId = `sha256:${"b".repeat(64)}`;
    await Promise.all([
      Bun.write(join(first, "out", "bunos-unified-session.iid"), firstId + "\n"),
      Bun.write(join(second, "out", "bunos-unified-session.iid"), secondId + "\n"),
    ]);
    expect(
      await Promise.all([sessionImageReceipt(first), sessionImageReceipt(second), sessionImageReceipt(missing)]),
    ).toEqual([firstId, secondId, ""]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
