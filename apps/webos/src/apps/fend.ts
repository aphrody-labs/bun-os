// SPDX-License-Identifier: Apache-2.0
// fend (https://github.com/printfn/fend, MIT): arbitrary-precision, unit-aware calculator compiled to WebAssembly.
// The wasm-bindgen glue is instantiated by hand so the same code runs in the browser (wasm fetched from /wasm/) and
// under Bun (wasm read from node_modules), without relying on wasm ESM integration.
import * as glue from "fend-wasm/fend_wasm_bg.js";

let ready: Promise<void> | undefined;

/** Instantiate fend once. `bytes` defaults to `/wasm/fend_wasm_bg.wasm` (copied there by build.ts). */
export function initFend(bytes?: BufferSource | Promise<BufferSource>): Promise<void> {
  ready ??= (async () => {
    const source: BufferSource = await (bytes ?? (await fetch("/wasm/fend_wasm_bg.wasm")).arrayBuffer());
    const compiled = (await WebAssembly.instantiate(source, {
      "./fend_wasm_bg.js": glue,
    })) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
    const { instance } = compiled;
    glue.__wbg_set_wasm(instance.exports);
  })();
  return ready;
}

/** Evaluate an expression such as `5 km to miles` or `sqrt(2)^2`; returns fend's `Error: ...` text on a malformed input. */
export async function fend(input: string, timeoutMs = 1000): Promise<string> {
  await initFend();
  return glue.evaluateFendWithTimeout(input, timeoutMs);
}
