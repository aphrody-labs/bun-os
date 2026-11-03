// SPDX-License-Identifier: MIT
// Every fork CLI command has a bin, a front-door entry and a real route.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FORK_COMMANDS, binTable, resolveArgv } from "../src/commands/index.ts";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");

test("each fork command is a bunos-<name> bin of the package", () => {
  for (const [bin, script] of Object.entries(binTable())) {
    expect((pkg.bin as Record<string, string>)[bin]).toBe(script);
    expect(existsSync(join(root, script))).toBe(true);
  }
});

test("script routes point at files of this checkout", () => {
  for (const [name, command] of Object.entries(FORK_COMMANDS)) {
    if (command.route.kind !== "script") continue;
    const resolved = resolveArgv(name, ["--x"]);
    expect("argv" in resolved).toBe(true);
    if ("argv" in resolved) {
      expect(resolved.argv[0]).toBe(process.execPath);
      expect(existsSync(resolved.argv[1]!)).toBe(true);
      expect(resolved.argv.at(-1)).toBe("--x");
    }
  }
});

test("a missing native owner is an error naming how to build it, never a fallback", () => {
  const resolved = resolveArgv("env", [], join(root, "does-not-exist"));
  if ("error" in resolved) expect(resolved.error).toContain("cargo build -p bun_env_cookie");
  else expect("argv" in resolved).toBe(true);
  expect(resolveArgv("not-a-fork-command", [])).toEqual({ error: "unknown fork command 'not-a-fork-command'" });
});

test("the registry inventory lists the bins", async () => {
  const { inventory } = await import("../src/index.ts");
  const bins = inventory()
    .filter(r => r.kind === "bin")
    .map(r => r.name);
  for (const name of Object.keys(FORK_COMMANDS)) expect(bins).toContain(`bunos-${name}`);
});
