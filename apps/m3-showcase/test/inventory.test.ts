// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect } from "../scripts/inventory.ts";

test("inventory requires declared membership for every physical app and package", () => {
  const root = mkdtempSync(join(tmpdir(), "showcase-inventory-"));
  try {
    const admitted = ["apps/declared", "packages/declared"];
    const unadmitted = ["apps/m3-showcase", "packages/excluded", "packages/orphan"];
    for (const path of [...admitted, ...unadmitted]) {
      mkdirSync(join(root, path), { recursive: true });
      writeFileSync(join(root, path, "package.json"), JSON.stringify({ name: path }));
    }
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: admitted }));
    for (const entry of collect(root)) expect(entry.workspace).toBe(admitted.includes(entry.dir));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ workspaces: { packages: ["apps/*", "packages/*", "!packages/excluded"] } }),
    );
    for (const entry of collect(root)) expect(entry.workspace).toBe(entry.dir !== "packages/excluded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
