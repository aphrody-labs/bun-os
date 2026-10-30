// SPDX-License-Identifier: Apache-2.0
// WebAssembly modules of the Bun OS crates: the wasm-bindgen cdylib crates the inventory marks as modules are built on the
// VPS factory into build/webos-wasm/<crate>/ (bun apps/webos/build-wasm.ts), and build.ts stages whatever was built into
// dist/wasm/modules/<crate>/ and records it in dist/wasm/modules.json (crate -> served .wasm URL).
import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export const modulesDir = (root: string) => join(root, "build/webos-wasm");

/** Copy the built modules into dist and return crate -> URL of its .wasm file. */
export async function stageWasmModules(dist: string, root: string): Promise<Map<string, string>> {
  const modules = new Map<string, string>([["aphrody-webos-wasm", "/wasm/aphrody_webos_wasm_bg.wasm"]]);
  const source = modulesDir(root);
  const entries = await readdir(source, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(join(source, entry.name)).catch(() => []);
    const wasm = files.find((f) => f.endsWith("_bg.wasm")) ?? files.find((f) => f.endsWith(".wasm"));
    if (!wasm) continue;
    await mkdir(join(dist, "wasm/modules", entry.name), { recursive: true });
    await cp(join(source, entry.name), join(dist, "wasm/modules", entry.name), { recursive: true });
    modules.set(entry.name, `/wasm/modules/${entry.name}/${wasm}`);
  }
  await Bun.write(join(dist, "wasm/modules.json"), JSON.stringify(Object.fromEntries(modules)));
  return modules;
}

/** The modules.json that build.ts wrote into a dist directory. */
export async function readWasmModules(dist: string): Promise<Map<string, string>> {
  const file = Bun.file(join(dist, "wasm/modules.json"));
  return new Map(Object.entries(((await file.exists()) ? await file.json() : {}) as Record<string, string>));
}
