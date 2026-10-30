// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from "node:path";

export const crateDir = resolve(import.meta.dir, "../compositor");
export const compositorWasm = join(crateDir, "target/wasm32-unknown-unknown/release/wasmos_compositor.wasm");

/** cargo build of the compositor for wasm32-unknown-unknown into the crate's own target dir. */
export async function buildCompositor(): Promise<string> {
  const p = Bun.spawn(["cargo", "build", "--release", "--target", "wasm32-unknown-unknown", "--locked"], {
    cwd: crateDir,
    env: { ...process.env, CARGO_TARGET_DIR: join(crateDir, "target") },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await p.exited) !== 0) throw new Error("cargo build failed");
  return compositorWasm;
}
