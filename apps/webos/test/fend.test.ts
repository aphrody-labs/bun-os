// SPDX-License-Identifier: Apache-2.0
// Integration: the Calculator's engine is the real fend wasm, not a facade.
import { beforeAll, describe, expect, test } from "bun:test";
import { fend, initFend } from "../src/apps/fend";

beforeAll(async () => {
  await initFend(Bun.file(require.resolve("fend-wasm/fend_wasm_bg.wasm")).arrayBuffer());
});

describe("fend (WebAssembly)", () => {
  test("arbitrary precision arithmetic", async () => {
    expect(await fend("0.1 + 0.2")).toBe("0.3");
    expect(await fend("2^100")).toBe("1267650600228229401496703205376");
  });

  test("units", async () => {
    expect(await fend("1 km to m")).toBe("1000 m");
    expect(await fend("100 cm to inches")).toContain("39.37");
  });

  test("functions and exact fractions", async () => {
    expect(await fend("sqrt(16)")).toBe("4");
    expect(await fend("1/3 + 1/6")).toBe("0.5");
  });

  test("malformed input reports fend's error", async () => {
    expect(await fend("1 +")).toStartWith("Error:");
  });
});
