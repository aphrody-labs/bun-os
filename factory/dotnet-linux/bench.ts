#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Measures a command: start-to-exit wall time over N runs (ms: min, median, max) and the peak RSS of the child
// (Subprocess.resourceUsage().maxRSS), plus the size of a file or directory. One JSON line on stdout.
//   bun factory/dotnet-linux/bench.ts --name hello-aot --size ./out/hello --runs 10 -- ./out/hello
import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function treeBytes(path: string): number {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isSymbolicLink() ? 0 : treeBytes(join(path, e.name))),
    0,
  );
}

export async function measure(cmd: string[], runs: number, env?: Record<string, string | undefined>) {
  const wall: number[] = [];
  const rss: number[] = [];
  let stdout = "";
  for (let i = 0; i < runs + 1; i++) {
    const t0 = performance.now();
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: env as never });
    const [out] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    const dt = performance.now() - t0;
    if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}`);
    if (i === 0) {
      stdout = out; // first run is a warm-up (disk cache, tiered JIT first start) and is not counted
      continue;
    }
    wall.push(dt);
    rss.push(p.resourceUsage()?.maxRSS ?? 0);
  }
  wall.sort((a, b) => a - b);
  rss.sort((a, b) => a - b);
  const med = (a: number[]) => a[Math.floor(a.length / 2)]!;
  return {
    runs,
    wallMs: { min: Math.round(wall[0]!), median: Math.round(med(wall)), max: Math.round(wall.at(-1)!) },
    maxRssMiB: Math.round((med(rss) / 1048576) * 10) / 10,
    stdout: stdout.trim().slice(0, 400),
  };
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const dash = args.indexOf("--");
  const opts = args.slice(0, dash < 0 ? args.length : dash);
  const cmd = dash < 0 ? [] : args.slice(dash + 1);
  const get = (k: string) => opts[opts.indexOf(`--${k}`) + 1];
  const name = get("name") ?? cmd[0] ?? "bench";
  const out: Record<string, unknown> = { name, host: `${process.platform}-${process.arch}` };
  const size = get("size");
  if (size) out.bytes = treeBytes(size);
  if (cmd.length) Object.assign(out, await measure(cmd, Number(get("runs") ?? 10)));
  console.log(JSON.stringify(out));
}
