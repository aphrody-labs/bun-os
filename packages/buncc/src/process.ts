import { readFileSync, readdirSync } from "node:fs";
import type { Env } from "./env.ts";

export interface RunOptions {
  cwd?: string;
  env?: Env;
  /** Kill the whole process tree after this long. */
  timeoutMs?: number;
  /** Kill the whole process tree when `progress(pid)` has not increased for this long (a hung build or test). */
  stallMs?: number;
  /** Monotonic progress measure of the process tree (CPU ticks); undefined disables the stall check. */
  progress?: (pid: number) => number | undefined;
  /** "inherit" streams to the terminal; "capture" collects the text. */
  output?: "inherit" | "capture";
  stdin?: "inherit" | "ignore";
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function clean(env: Env | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value;
  return out;
}

/** Kill a process and its children. Bun.spawn `timeout` only signals the direct child, which orphans cargo's rustc tree on Windows. */
export async function killTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    const killer = Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
    await killer.exited;
  } else {
    // The child is not a process-group leader, so walk /proc for its descendants (rustc, test binaries) first.
    for (const child of descendants(pid).reverse()) {
      try {
        process.kill(child, "SIGKILL");
      } catch {}
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
}

function descendants(pid: number): number[] {
  if (process.platform !== "linux") return [];
  const children = new Map<number, number[]>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      children.set(ppid, [...(children.get(ppid) ?? []), Number(entry)]);
    } catch {}
  }
  const found: number[] = [];
  const stack = [pid];
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      found.push(child);
      stack.push(child);
    }
  }
  return found;
}

export async function run(argv: string[], options: RunOptions = {}): Promise<RunResult> {
  const capture = options.output === "capture";
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, {
      cwd: options.cwd,
      env: clean(options.env),
      stdin: options.stdin ?? "ignore",
      stdout: capture ? "pipe" : "inherit",
      stderr: capture ? "pipe" : "inherit",
    });
  } catch (error) {
    return {
      code: 127,
      stdout: "",
      stderr: `Failed to start ${argv[0]}: ${(error as Error).message}`,
      timedOut: false,
    };
  }
  let timedOut = false;
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        void killTree(proc.pid);
      }, options.timeoutMs)
    : undefined;
  let stalled = false;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  if (options.stallMs && options.progress && options.progress(proc.pid) !== undefined) {
    let last = options.progress(proc.pid) ?? 0;
    let lastChange = Date.now();
    watchdog = setInterval(
      () => {
        const now = options.progress!(proc.pid) ?? last;
        if (now > last) {
          last = now;
          lastChange = Date.now();
        } else if (Date.now() - lastChange >= options.stallMs!) {
          stalled = timedOut = true;
          process.stderr.write(`buncc: no CPU progress for ${Math.round(options.stallMs! / 60_000)} min; killing ${argv[0]}\n`);
          void killTree(proc.pid);
        }
      },
      Math.min(60_000, Math.max(1000, Math.floor(options.stallMs / 10))),
    );
  }
  const [stdout, stderr, code] = await Promise.all([
    capture ? new Response(proc.stdout as ReadableStream).text() : "",
    capture ? new Response(proc.stderr as ReadableStream).text() : "",
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  if (watchdog) clearInterval(watchdog);
  return { code: timedOut ? 124 : code, stdout, stderr, timedOut: timedOut || stalled };
}

/** First line a program prints (stdout, else stderr), trimmed to `max` characters; undefined when it cannot start. */
export async function firstLine(argv: string[], max = 100, timeoutMs = 15_000): Promise<string | undefined> {
  const r = await run(argv, { output: "capture", timeoutMs });
  if (r.code === 127) return undefined;
  return ((r.stdout || r.stderr).split(/\r?\n/)[0] ?? "").trim().slice(0, max);
}
