// `aphrody-wasm init`: scaffold a wasm-bindgen crate (the "basic" template of the fork's `n2b wasm init`).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { PINS } from "./tools.ts";

export interface InitOptions {
  /** Crate name. Defaults to the directory name. */
  name?: string;
  /** Overwrite existing files. */
  force?: boolean;
}

/** Create `<dir>/Cargo.toml`, `src/lib.rs` and `index.ts`; returns the written paths. */
export function init(dir: string, options: InitOptions = {}): string[] {
  const root = resolve(dir);
  const name = options.name ?? basename(root);
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`Invalid crate name ${name}`);
  const files: Record<string, string> = {
    "Cargo.toml": `[package]
name = "${name}"
version = "0.1.0"
edition = "2024"
description = "WebAssembly module built with @aphrody/wasm"
license = "MIT"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "${PINS.wasmBindgen}"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
`,
    "src/lib.rs": `use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}!")
}
`,
    "index.ts": `import { build } from "@aphrody/wasm";

const result = await build({ crate: import.meta.dir, outdir: "pkg" });
const mod = await import(result.js);
await mod.default({ module_or_path: await Bun.file(result.wasm).arrayBuffer() });
console.log(mod.greet("Bun"));
`,
    ".gitignore": "target/\npkg/\n",
  };
  const written: string[] = [];
  for (const [relative, content] of Object.entries(files)) {
    const file = join(root, relative);
    if (existsSync(file) && !options.force) throw new Error(`${file} exists: pass force to overwrite`);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
    written.push(file);
  }
  return written;
}
