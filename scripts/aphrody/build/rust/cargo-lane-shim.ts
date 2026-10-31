#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * `cargo` on the VPS build host (installed as ~/.local/bin/cargo by factory/sync/install.ts, ahead of rustup's proxy).
 * Compilation subcommands (build, check, test, clippy, doc, bench, rustc, nextest) go through a buncc lane: per-lane
 * build directory on the fast disk, at most four jobs, no-progress watchdog (packages/buncc/src/cargo.ts). Everything
 * else (metadata, fmt, update, run, install, ...) and every call made from inside a lane runs the real cargo directly.
 */
import { delimiter, dirname, join, resolve } from "node:path";
import { realpathSync } from "node:fs";

const LANED = new Set(["build", "b", "check", "c", "test", "t", "clippy", "doc", "d", "bench", "rustc", "rustdoc", "nextest"]);
const args = Bun.argv.slice(2);
const self = realpathSync(Bun.argv[1]!);

function realCargo(): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = Bun.which("cargo", { PATH: dir });
    if (!candidate) continue;
    try {
      if (realpathSync(candidate) === self) continue;
    } catch {}
    return candidate;
  }
  throw new Error("cargo-lane-shim: no real cargo on PATH");
}

function subcommand(): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.startsWith("+")) continue;
    if (["--config", "-Z", "-C", "--color", "--explain"].includes(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

const command = subcommand();
const help = args.includes("--help") || args.includes("-h") || args.includes("--version") || args.includes("-V");
if (process.env.BUNCC_IN_LANE === "1" || help || !command || !LANED.has(command)) {
  const proc = Bun.spawn([realCargo(), ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(await proc.exited);
}
const { runCargo } = await import(join(dirname(self), "../../../../packages/buncc/src/cargo.ts"));
const root = resolve(dirname(self), "../../../..");
const result = await runCargo(args, { root, cwd: process.cwd() });
process.exit(result.code);
