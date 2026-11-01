// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAphrodyBinaries } from "../../src/automation/binaries.ts";

test("binary catalogue excludes sibling builds and normalizes Windows executable names", async () => {
  const parent = await mkdtemp(join(tmpdir(), "binary-roots-"));
  const root = join(parent, "relocated");
  try {
    const files = {
      "relocated/docs/ecosystem/ecosystem.json": JSON.stringify({
        cli: [
          { binary: "aphrody-fixture-owned" },
          { binary: "aphrody-fixture-windows" },
          { binary: "aphrody-mcp" },
        ],
      }),
      "relocated/target/debug/aphrody-fixture-owned": "debug",
      "relocated/target/release/aphrody-fixture-owned": "release",
      "relocated/target/debug/aphrody-fixture-windows.exe": "windows",
      "relocated/target/release/aphrody-mcp.exe": "mcp",
      "relocated/target/debug/aphrody-fixture-owned.pdb": "symbols",
      "relocated/target/debug/unrelated": "unrelated",
      "aphrody-ai/target/release/aphrody-fixture-sibling": "legacy",
      "aphrody-ui/target/debug/aphrody-fixture-ui": "ui",
    };
    await Promise.all(
      Object.entries(files).map(async ([file, content]) => {
        const path = join(parent, file);
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, content);
      }),
    );
    const found = (await discoverAphrodyBinaries(root)).filter(
      (entry) =>
        entry.name.startsWith("aphrody-fixture-") ||
        entry.name === "aphrody-mcp",
    );
    expect(found.map((entry) => entry.name)).toEqual([
      "aphrody-fixture-owned",
      "aphrody-fixture-windows",
      "aphrody-mcp",
    ]);
    expect(found[0]?.source).toBe("release");
    expect(found[0]?.path).toBe(
      join(root, "target/release/aphrody-fixture-owned"),
    );
    expect(found[1]?.catalogued).toBe(true);
    expect(found[1]?.path).toBe(
      join(root, "target/debug/aphrody-fixture-windows.exe"),
    );
    expect(found[2]?.path).toBe(join(root, "target/release/aphrody-mcp.exe"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
