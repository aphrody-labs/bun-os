// SPDX-License-Identifier: Apache-2.0
// Bun -> .NET through bun:ffi: dlopen of the NativeAOT shared library built from sample/native.
// BUNOS_NATIVE_LIB=<path to libbunos_native.so>; CI builds it with `buncc dotnet publish --aot --native-lib`. Skipped without it.
import { expect, test } from "bun:test";
import { loadSampleNative } from "../../packages/buncc/src/dotnet-linux/interop.ts";

const lib = Bun.env.BUNOS_NATIVE_LIB;

test.skipIf(!lib)("NativeAOT shared library answers through bun:ffi", async () => {
  const { symbols, close } = loadSampleNative(lib!);
  try {
    expect(symbols.bunos_add(40, 2)).toBe(42);
    expect(symbols.bunos_add(-5, 3)).toBe(-2);
    // UTF-16 length of a UTF-8 string: "héllo, 世界" is 9 code units (and 14 UTF-8 bytes)
    expect(symbols.bunos_utf16_length(Buffer.from("héllo, 世界\0"))).toBe(9);
    const buf = new Uint8Array(64);
    const n = symbols.bunos_runtime_description(buf, buf.length);
    expect(n).toBeGreaterThan(0);
    const text = new TextDecoder().decode(buf.subarray(0, n));
    console.log(`runtime description from NativeAOT: ${text}`);
    expect(text).toMatch(/^\.NET /);
    expect(symbols.bunos_runtime_description(buf, 2)).toBe(-1);
  } finally {
    close();
  }
});
