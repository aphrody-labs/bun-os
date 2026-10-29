import type { Env } from "./env.ts";

export interface RunOptions {
  cwd?: string;
  env?: Env;
  /** Kill the whole process tree after this long. */
  timeoutMs?: number;
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
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
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
  const [stdout, stderr, code] = await Promise.all([
    capture ? new Response(proc.stdout as ReadableStream).text() : "",
    capture ? new Response(proc.stderr as ReadableStream).text() : "",
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  return { code: timedOut ? 124 : code, stdout, stderr, timedOut };
}
