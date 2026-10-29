// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { PACKAGE_COMMANDS, packageRoot } from "../../../yolo-cli/src/package-commands.ts";

test("workspace operations resolve the absorbed flat package", async () => {
  delete process.env.BUN_OS_ROOT; // a workstation export must not decide where this checkout is
  const root = resolve(import.meta.dir, "../../../..");
  expect(packageRoot(import.meta.dir)).toBe(root);
  for (const command of ["workspace", "ops", "optimize"] as const) {
    const runner = PACKAGE_COMMANDS[command];
    expect(runner.module.startsWith("packages/bun-workspace/src/automation/")).toBe(true);
    expect(await Bun.file(resolve(root, runner.module)).exists()).toBe(true);
    const owner = await import(resolve(root, runner.module));
    expect(typeof owner[runner.run]).toBe("function");
  }
});
