// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test";
import { build, optimize, wasmPlugin } from "../src/index.ts";

test("bun:wasm (the fork builtin) resolves through the Bun OS plugin registry to this package", async () => {
  const { registerAll } = await import("@aphrody/bun-os-plugins");
  registerAll();
  const specifier = "bun:wasm";
  const fork = await import(specifier);
  expect(fork.build).toBe(build);
  expect(fork.optimize).toBe(optimize);
  expect(fork.plugin).toBe(wasmPlugin);
  expect(Object.keys(fork.default).sort()).toEqual(["build", "optimize", "plugin"]);
});
