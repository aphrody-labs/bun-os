#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
/**
 * Benchmarks of @aphrody/bun-dotnet-windows (numbers recorded in docs/DOTNET-WINDOWS.md):
 *   in-process  bun:ffi -> export round trips (C# Native AOT, C++, hostfxr-hosted managed), pwsh pipelines in
 *               process, winget search through COM, D3D12 adapter enumeration
 *   hyperfine   cold starts: bun + AOT dlopen, pwsh.exe vs in-process, winget.exe vs bunos-winget (COM)
 *
 *   bun packages/bun-dotnet-windows/scripts/bench.ts [--quick] [--no-hyperfine]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const pkg = resolve(import.meta.dir, "..");
const root = resolve(pkg, "..", "..");
const out = join(root, "target", "bun-dotnet-windows");
const quick = process.argv.includes("--quick");
const results: Record<string, unknown> = { date: new Date().toISOString(), host: process.env.COMPUTERNAME };

function perCall(name: string, iterations: number, body: () => unknown): number {
  for (let i = 0; i < Math.min(10_000, iterations); i++) body();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) body();
  const ns = (Bun.nanoseconds() - start) / iterations;
  console.log(`${name.padEnd(44)} ${ns.toFixed(1).padStart(10)} ns/call`);
  results[name] = { nsPerCall: Number(ns.toFixed(1)), iterations };
  return ns;
}

async function timed(name: string, runs: number, body: () => Promise<unknown> | unknown): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await body();
    samples.push(performance.now() - start);
  }
  const sorted = samples.toSorted((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const first = samples[0]!;
  console.log(
    `${name.padEnd(44)} first ${first.toFixed(1)} ms, mean ${mean.toFixed(1)} ms, median ${sorted[sorted.length >> 1]!.toFixed(1)} ms (${runs} runs)`,
  );
  results[name] = {
    firstMs: Number(first.toFixed(2)),
    meanMs: Number(mean.toFixed(2)),
    medianMs: Number(sorted[sorted.length >> 1]!.toFixed(2)),
    runs,
  };
}

const native = await import("../src/native.ts");
const d3d12 = await import("../src/d3d12.ts");
const winget = await import("../src/winget.ts");
const pwsh = await import("../src/pwsh.ts");

const n = quick ? 200_000 : 2_000_000;
perCall("ffi -> C# Native AOT bunos_ping", n, () => native.ping(1));
perCall("ffi -> C++ bunos_cpp_ping", n, () => native.cppPing(1));
perCall("ffi -> C# AOT bunos_call(winget.status)", quick ? 2_000 : 20_000, () => native.call("winget.status"));
await pwsh.start();
const managedPing = (await import("@aphrody/bun-os-plugins/dotnet")).unmanaged(
  { type: "BunOs.Pwsh.Exports, BunOs.Pwsh", method: "Ping" },
  { args: ["i64"], returns: "i64" },
) as (v: number) => bigint;
perCall("ffi -> hostfxr managed (JIT) Ping", n, () => managedPing(1));

await timed("d3d12.adapters (C#, device per adapter)", 5, () => d3d12.adapters());
await timed("d3d12.adapters (C++, device per adapter)", 5, () => d3d12.adapters({ via: "cpp" }));
await timed("system.info (CsWinRT + CsWin32)", 20, () => d3d12.systemInfo());

await timed("pwsh in-process: Get-Date", quick ? 10 : 50, () => pwsh.evaluate("Get-Date"));
await timed("pwsh in-process: Get-Process | Select -First 5", quick ? 5 : 20, () =>
  pwsh.evaluate("Get-Process | Select-Object -First 5 Name,Id,WS"),
);
await timed("pwsh spawn (source build): Get-Date", quick ? 3 : 10, () => pwsh.spawn("Get-Date"));

await timed("winget COM: search ripgrep (source winget)", quick ? 3 : 10, () =>
  winget.search("ripgrep", { source: "winget", limit: 10 }),
);
await timed("winget COM: list --upgradable", quick ? 2 : 5, () => winget.list({ upgradable: true }));

if (!process.argv.includes("--no-hyperfine") && Bun.which("hyperfine")) {
  const bun = process.execPath;
  const bins = join(out, "bin");
  const exe = pwsh.executable();
  const commands: [string, string][] = [
    ["bun baseline", `"${bun}" -e 0`],
    [
      "bun + AOT dlopen + ping",
      `"${bun}" -e "require('${join(pkg, "src", "native.ts").replaceAll("\\", "/")}').ping(1)"`,
    ],
    ["pwsh.exe (source build) -c Get-Date", `"${exe}" -NoLogo -NoProfile -Command Get-Date`],
    ["bunos-pwsh -c Get-Date (in-process host)", `"${bun}" "${join(pkg, "src", "cli", "bunos-pwsh.ts")}" -c Get-Date`],
    [
      "winget.exe search ripgrep -s winget",
      `winget search ripgrep --source winget --accept-source-agreements --disable-interactivity`,
    ],
    [
      "bunos-winget search ripgrep -s winget",
      `"${bun}" "${join(pkg, "src", "cli", "bunos-winget.ts")}" search ripgrep --source winget`,
    ],
  ];
  if (existsSync(join(bins, "bunos-winget.exe")))
    commands.push([
      "bunos-winget.exe (bun --compile --bytecode)",
      `"${join(bins, "bunos-winget.exe")}" search ripgrep --source winget`,
    ]);
  if (existsSync(join(bins, "bunos-pwsh.exe")))
    commands.push(["bunos-pwsh.exe (bun --compile --bytecode)", `"${join(bins, "bunos-pwsh.exe")}" -c Get-Date`]);
  mkdirSync(out, { recursive: true });
  const exportJson = join(out, "hyperfine.json");
  const args = ["hyperfine", "-N", "--warmup", "1", "--runs", quick ? "3" : "10", "--export-json", exportJson];
  for (const [name, command] of commands) args.push("-n", name, command);
  Bun.spawnSync(args, { stdio: ["ignore", "inherit", "inherit"] });
  if (existsSync(exportJson)) {
    const report = (await Bun.file(exportJson).json()) as {
      results: { command: string; mean: number; stddev: number; min: number }[];
    };
    results.hyperfine = report.results.map(r => ({
      command: r.command,
      meanMs: +(r.mean * 1000).toFixed(1),
      stddevMs: +(r.stddev * 1000).toFixed(1),
      minMs: +(r.min * 1000).toFixed(1),
    }));
  }
}

await Bun.write(join(out, "bench.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(`\nwrote ${join(out, "bench.json")}`);
process.exit(0);
