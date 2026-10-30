import { statSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { compileArgs } from "./bun.ts";
import { run } from "../process.ts";

export interface BenchRow {
  name: string;
  buildMs: number;
  sizeBytes: number;
  startMs: number[];
  startMedianMs: number;
  ok: boolean;
  note?: string;
}

export function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
}

/** Build one executable with the given compile options and measure build time, size and median start-up (runs the exe `runs` times). */
export async function benchCompile(
  name: string,
  entry: string,
  outfile: string,
  extra: { aot?: boolean; minify?: boolean; bytecode?: boolean; trim?: boolean },
  runs = 7,
): Promise<BenchRow> {
  rmSync(outfile, { force: true });
  const [build, buildMs] = await timed(() =>
    run([process.execPath, ...compileArgs({ entry, outfile, ...extra })], { output: "capture", timeoutMs: 600_000 }),
  );
  if (build.code !== 0)
    return {
      name,
      buildMs,
      sizeBytes: 0,
      startMs: [],
      startMedianMs: Number.NaN,
      ok: false,
      note: build.stderr.trim().split("\n").slice(-3).join(" "),
    };
  const exe = resolve(process.platform === "win32" && !outfile.endsWith(".exe") ? `${outfile}.exe` : outfile);
  const sizeBytes = statSync(exe).size;
  const startMs: number[] = [];
  for (let i = 0; i < runs; i++) {
    const [result, ms] = await timed(() => run([exe], { output: "capture", timeoutMs: 60_000 }));
    if (result.code !== 0)
      return {
        name,
        buildMs,
        sizeBytes,
        startMs,
        startMedianMs: Number.NaN,
        ok: false,
        note: `exit ${result.code}: ${result.stderr.trim().slice(0, 160)}`,
      };
    startMs.push(ms);
  }
  return { name, buildMs, sizeBytes, startMs, startMedianMs: median(startMs), ok: true };
}

export function formatBench(rows: BenchRow[]): string {
  const lines = ["profile          build ms     size MiB   start median ms"];
  for (const row of rows)
    lines.push(
      `${row.name.padEnd(16)} ${row.buildMs.toFixed(0).padStart(8)} ${(row.sizeBytes / 1048576).toFixed(1).padStart(12)} ${Number.isNaN(row.startMedianMs) ? "n/a".padStart(16) : row.startMedianMs.toFixed(1).padStart(16)}${row.ok ? "" : "  FAILED: " + row.note}`,
    );
  return lines.join("\n");
}
