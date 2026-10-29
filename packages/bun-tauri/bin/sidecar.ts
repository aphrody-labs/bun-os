#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0 OR MIT
// bun-tauri-sidecar <entry> <name> [--triple <rust-triple>] [--tauri-dir src-tauri] [--minify] [--bytecode]
import { buildSidecar } from "../js/sidecar";

const { positionals, values } = (await import("node:util")).parseArgs({
  allowPositionals: true,
  options: {
    triple: { type: "string" },
    "tauri-dir": { type: "string" },
    minify: { type: "boolean" },
    bytecode: { type: "boolean" },
  },
});
const [entry, name] = positionals;
if (!entry || !name) {
  console.error("usage: bun-tauri-sidecar <entry> <name> [--triple T] [--tauri-dir DIR] [--minify] [--bytecode]");
  process.exit(2);
}
const path = await buildSidecar({
  entry,
  name,
  triple: values.triple,
  tauriDir: values["tauri-dir"],
  build: { minify: values.minify, bytecode: values.bytecode },
});
console.log(path);
