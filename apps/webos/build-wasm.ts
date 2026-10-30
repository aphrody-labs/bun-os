#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Builds every wasm-bindgen cdylib crate of the inventory into a WebAssembly module on the VPS factory, one crate at a time
// (the build queue is serialized and each cargo run uses at most four jobs). Output: build/webos-wasm/<crate>/ plus
// build/webos-wasm/status.json. build.ts stages the result into the site (wasm-modules.ts).
//
//   bun apps/webos/build-wasm.ts [--force] [crate ...]
import { join, resolve } from "node:path";
import { buildInventory } from "./inventory";
import { modulesDir } from "./wasm-modules";

if (process.platform !== "linux") throw new Error("Build WebAssembly modules on the VPS factory");
const root = resolve(import.meta.dir, "../..");
const args = Bun.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));
const out = modulesDir(root);
const statusFile = join(out, "status.json");
const status = ((await Bun.file(statusFile).json().catch(() => ({}))) as Record<string, { ok: boolean; bytes?: number; error?: string; at: string }>);

const inventory = await buildInventory();
// aphrody-webos-wasm has its own package (packages/webos-wasm); every other module crate is built here.
const crates = inventory.members
  .filter((m) => m.kind === "crates" && m.meta?.wasm && m.id !== "aphrody-webos-wasm" && (!only.length || only.includes(m.id)))
  .map((m) => String(m.meta?.crateName ?? m.id));
console.log(`wasm modules to build: ${crates.join(", ")}`);
for (const crate of crates) {
  const dir = join(out, crate);
  if (!force && status[crate]?.ok && (await Bun.file(join(dir, `${crate.replaceAll("-", "_")}_bg.wasm`)).exists())) {
    console.log(`${crate}: up to date`);
    continue;
  }
  const started = Date.now();
  const child = Bun.spawn(
    [process.execPath, join(root, "scripts/aphrody/build/rust/wasm-package.ts"), "--crate", crate, "--out", dir],
    { cwd: root, env: { ...Bun.env, CARGO_BUILD_JOBS: "4", APHRODY_BUILD_HOST: "", APHRODY_LOCAL_CARGO: "1" }, stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => child.kill(), 45 * 60_000);
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timer);
  const files = await Array.fromAsync(new Bun.Glob("*.wasm").scan({ cwd: dir })).catch(() => [] as string[]);
  const wasm = files.find((f) => f.endsWith("_bg.wasm")) ?? files[0];
  if (code === 0 && wasm) {
    status[crate] = { ok: true, bytes: Bun.file(join(dir, wasm)).size, at: new Date().toISOString() };
    console.log(`${crate}: ok ${status[crate]!.bytes} bytes in ${Math.round((Date.now() - started) / 1000)}s`);
  } else {
    const error = (stderr || stdout).trim().split("\n").slice(-6).join(" | ").slice(0, 600);
    status[crate] = { ok: false, error, at: new Date().toISOString() };
    console.log(`${crate}: failed: ${error}`);
  }
  await Bun.write(statusFile, JSON.stringify(status, null, 2));
}
console.log(`built ${Object.values(status).filter((s) => s.ok).length} of ${crates.length} modules`);
