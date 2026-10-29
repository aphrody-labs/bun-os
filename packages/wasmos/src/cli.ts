#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
//   bun packages/wasmos/src/cli.ts build-compositor
//   bun packages/wasmos/src/cli.ts boot <alpine.wasm> [--timeout 600] [--log serial.log] -- <cmd...>
import { buildCompositor } from "./build-compositor.ts";

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "build-compositor") {
  console.log(await buildCompositor());
} else if (cmd === "boot") {
  const { boot } = await import("./boot.ts");
  const dash = rest.indexOf("--");
  const opts = dash < 0 ? rest : rest.slice(0, dash);
  const guest = dash < 0 ? ["uname", "-a"] : rest.slice(dash + 1);
  const arg = (k: string, d: string) => (opts.includes(k) ? opts[opts.indexOf(k) + 1]! : d);
  const r = await boot({ wasm: opts[0]!, args: guest, timeoutMs: Number(arg("--timeout", "600")) * 1000, logPath: arg("--log", "serial.log") });
  console.log(JSON.stringify({ exitCode: r.exitCode, ms: r.ms, timedOut: r.timedOut, bytes: r.output.length }));
  process.exit(r.timedOut ? 124 : r.exitCode);
} else {
  console.error("usage: cli.ts build-compositor | boot <wasm> [--timeout s] [--log file] -- <cmd...>");
  process.exit(2);
}
