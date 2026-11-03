// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolveArgv } from "@aphrody/bun-os-plugins/commands";

test("LSP resolves to a stdio TypeScript language server, not a fork-only `bun lsp`", () => {
  const resolved = resolveArgv("lsp", ["--x"]);
  if ("error" in resolved) {
    expect(resolved.error).toContain("tsgo");
    return;
  }
  expect("argv" in resolved).toBe(true);
  if (!("argv" in resolved)) return;
  expect(resolved.argv[0]).not.toBe(process.execPath);
  expect(resolved.argv).toContain("--stdio");
  expect(resolved.argv.at(-1)).toBe("--x");
});
