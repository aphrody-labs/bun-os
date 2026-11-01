// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { runLsp } from "../../src/automation/bun-tools.ts";

test("LSP forwards the upstream Bun stdio mode and exits with its status", async () => {
  const previous = process.env.BUN_EXECUTABLE;
  process.env.BUN_EXECUTABLE = process.execPath;
  try {
    expect(await runLsp(["--help"])).toBe(0);
  } finally {
    if (previous === undefined) delete process.env.BUN_EXECUTABLE;
    else process.env.BUN_EXECUTABLE = previous;
  }
});
