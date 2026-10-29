// SPDX-License-Identifier: Apache-2.0
// Child process of boot(): runs a WASI command module (a container2wasm image) on upstream Bun's node:wasi.
// argv: <wasm> [guest args...]. stdout/stderr are the serial console; stdin is the parent's (ignored = EOF).
import { WASI } from "node:wasi";
import { readFileSync } from "node:fs";
import { makePollOneoff } from "./poll.ts";

const [wasmPath, ...guest] = process.argv.slice(2);
if (!wasmPath) throw new Error("usage: boot-worker.ts <wasm> [args...]");
const wasi = new WASI({
  version: "preview1",
  args: ["wasmos", ...guest],
  env: { ...(process.env.WASMOS_GUEST_ENV ? JSON.parse(process.env.WASMOS_GUEST_ENV) : {}) },
  returnOnExit: true,
});
const module = new WebAssembly.Module(readFileSync(wasmPath));
// Bun's node:wasi has no sock_accept (verified on 1.4.4); the image imports it for optional networking. ENOSYS = 52.
const imp: Record<string, unknown> = { ...wasi.wasiImport };
for (const i of WebAssembly.Module.imports(module))
  if (i.kind === "function" && typeof imp[i.name] !== "function") imp[i.name] = () => 52;
let memory: WebAssembly.Memory;
imp.poll_oneoff = makePollOneoff(() => memory);
const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: imp });
memory = instance.exports.memory as WebAssembly.Memory;
const code = wasi.start(instance);
process.exit(code ?? 0);
