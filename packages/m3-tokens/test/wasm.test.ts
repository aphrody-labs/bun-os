// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { LIBM3_WASM_BASE64, LIBM3_WASM_SHA256 } from "../src/libm3-wasm.ts";
import { MATERIAL_WASM_ABI, loadMaterialWasm, materialWasm } from "../src/wasm.ts";

describe("@aphrody/m3-tokens/wasm", () => {
  const bytes = Buffer.from(LIBM3_WASM_BASE64, "base64");

  test("embeds the module its header names, with no host imports", () => {
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(LIBM3_WASM_SHA256);
    expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([]);
  });

  test("async and embedded loaders expose the same engine", async () => {
    const loaded = await loadMaterialWasm(bytes);
    const embedded = materialWasm();
    expect(loaded.exports.m3_abi_version()).toBe(MATERIAL_WASM_ABI);
    expect(loaded.roleNames).toEqual(embedded.roleNames);
    expect(loaded.variantNames).toContain("tonal-spot");
    const tonalSpot = embedded.variantNames.indexOf("tonal-spot");
    expect([...loaded.schemeFromSeed(0xff8c6c88, tonalSpot, 0, "dark")]).toEqual([
      ...embedded.schemeFromSeed(0xff8c6c88, tonalSpot, 0, "dark"),
    ]);
    expect(loaded.typeSize(0)).toBe(57);
    expect(loaded.shapeRadius(4)).toBe(16);
  });

  test("rejects invalid requests before they reach the engine", () => {
    const wasm = materialWasm();
    expect(() => wasm.schemeFromSeed(0x008c6c88, 0, 0, "light")).toThrow(RangeError);
    expect(() => wasm.schemeFromSeed(0xff8c6c88, 9, 0, "light")).toThrow(RangeError);
    expect(() => wasm.schemeFromSeed(0xff8c6c88, 0, 2, "light")).toThrow(RangeError);
    expect(() => wasm.applyDynamicColor(0xff8c6c88, 0, Number.NaN, "dark")).toThrow(RangeError);
    expect(() => wasm.hctToArgb(Number.POSITIVE_INFINITY, 0, 0)).toThrow(RangeError);
  });
});
