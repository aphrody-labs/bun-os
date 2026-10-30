// SPDX-License-Identifier: Apache-2.0
// Boot a container2wasm image (Bochs x86_64 + Linux + the container rootfs, one wasm file) on upstream Bun.
// The guest command runs inside the emulated machine; its serial console is captured to a log file.
import { createWriteStream } from "node:fs";
import { join } from "node:path";

export interface BootOptions {
  wasm: string;
  args: string[];
  timeoutMs?: number;
  logPath?: string;
}
export interface BootResult {
  exitCode: number;
  timedOut: boolean;
  ms: number;
  output: string;
  stderr: string;
}

export async function boot(o: BootOptions): Promise<BootResult> {
  const t0 = performance.now();
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "boot-worker.ts"), o.wasm, ...o.args], {
    stdin: "pipe", // kept open and silent: EOF on stdin makes the emulator exit
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => ((timedOut = true), proc.kill()), o.timeoutMs ?? 600_000);
  const log = o.logPath ? createWriteStream(o.logPath) : undefined;
  const read = async (s: ReadableStream<Uint8Array>) => {
    let text = "";
    const dec = new TextDecoder();
    for await (const chunk of s) {
      log?.write(chunk);
      text += dec.decode(chunk, { stream: true });
    }
    return text;
  };
  const [output, stderr, exitCode] = await Promise.all([read(proc.stdout), read(proc.stderr), proc.exited]);
  clearTimeout(timer);
  log?.end();
  return { exitCode, timedOut, ms: Math.round(performance.now() - t0), output, stderr };
}
