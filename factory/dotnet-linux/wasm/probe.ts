#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Runs commands inside a container2wasm guest (Bochs x86_64 + Linux 6.1 + Alpine) under upstream Bun and records, for each,
// the outer wall time of a fresh boot+command and its delta over a `true` baseline. One JSON line per command on stdout.
//   bun factory/dotnet-linux/wasm/probe.ts <guest.wasm> [--timeout-s 1200] -- "name=cmd args" ["name2=cmd2"] ...
import { boot } from "../../../packages/wasmos/src/boot.ts";

const args = Bun.argv.slice(2);
const wasm = args[0]!;
const dash = args.indexOf("--");
const tIdx = args.indexOf("--timeout-s");
const timeoutMs = (tIdx > 0 ? Number(args[tIdx + 1]) : 1200) * 1000;
const probes = args.slice(dash + 1);

const sizes = Bun.file(wasm).size;
const base = await boot({ wasm, args: ["sh", "-c", "true"], timeoutMs });
console.log(JSON.stringify({ name: "wasm guest baseline (boot + true)", bytes: sizes, wallMs: { median: base.ms }, note: `exit ${base.exitCode}` }));
for (const p of probes) {
  const eq = p.indexOf("=");
  const name = p.slice(0, eq);
  const cmd = p.slice(eq + 1);
  // one shell, so the guest reports its own memory high-water mark (VmHWM of the shell's children is not available; MemAvailable before/after is)
  const script = `grep -E '^(MemTotal|MemAvailable)' /proc/meminfo; ${cmd}; echo "exit=$?"; grep -E '^MemAvailable' /proc/meminfo`;
  const r = await boot({ wasm, args: ["sh", "-c", script], timeoutMs });
  const out = r.output.trim().split("\n").slice(-8).join(" | ");
  console.log(
    JSON.stringify({
      name: `wasm guest: ${name}`,
      wallMs: { median: r.ms, min: r.ms, max: r.ms },
      deltaOverBaselineMs: r.ms - base.ms,
      timedOut: r.timedOut,
      exitCode: r.exitCode,
      note: out.slice(0, 300),
    }),
  );
}
