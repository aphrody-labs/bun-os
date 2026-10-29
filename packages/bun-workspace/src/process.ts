export type ProcessErrorCode =
  "INVALID_OPTIONS" | "INTERRUPTED" | "TIMEOUT" | "OUTPUT_LIMIT" | "START_FAILED" | "FAILED";

export class ProcessError extends Error {
  constructor(
    readonly code: ProcessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

export interface ProcessLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface ProcessOptions extends ProcessLimits {
  input?: Uint8Array;
  stdin?: "ignore" | "inherit";
  stdout?: "capture" | "discard" | "inherit";
  stderr?: "capture" | "discard" | "inherit";
  env?: Record<string, string | undefined>;
  /** Forward terminal interrupts to interactive children and await their exit. */
  forwardSignals?: boolean;
  /** Record the owned child without implementing another process manager. */
  onStart?: (pid: number) => void | Promise<void>;
  /** Receive bounded raw output from captured or discarded streams. */
  onOutput?: (channel: "stdout" | "stderr", bytes: Uint8Array) => void | Promise<void>;
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface OwnedJob {
  assign(process: { pid: number }): void;
  terminate(code?: number): void;
  close(): void;
}

async function reap(child: Bun.Subprocess): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      child.exited.catch(() => {}),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, 5_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function createJob(): Promise<OwnedJob | undefined> {
  if (process.platform !== "win32") return;
  try {
    const { WindowsJob } = await import("./windows-job");
    return new WindowsJob({ killOnClose: true });
  } catch {
    // The native host can instead own this process tree through taskkill.
  }
}

/** One child lifetime owner. Captured and discarded streams share the same output cap. */
export async function runProcess(argv: string[], cwd: string, options: ProcessOptions): Promise<ProcessResult> {
  if (
    !argv.length ||
    argv.some(arg => typeof arg !== "string" || arg.includes("\0")) ||
    !cwd ||
    cwd.includes("\0") ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 43_200_000 ||
    !Number.isSafeInteger(options.maxOutputBytes) ||
    options.maxOutputBytes < 1 ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
    (options.onStart !== undefined && typeof options.onStart !== "function") ||
    (options.onOutput !== undefined && typeof options.onOutput !== "function") ||
    (options.forwardSignals !== undefined && typeof options.forwardSignals !== "boolean")
  ) {
    throw new ProcessError("INVALID_OPTIONS", "Invalid native process options.");
  }
  if (options.signal?.aborted) throw new ProcessError("INTERRUPTED", "The native process was interrupted.");
  let job = await createJob();
  if (options.signal?.aborted) {
    job?.close();
    throw new ProcessError("INTERRUPTED", "The native process was interrupted.");
  }
  const taskkill = process.platform === "win32" ? Bun.which("taskkill") : null;
  if (process.platform === "win32" && !job && !taskkill) {
    throw new ProcessError("START_FAILED", "Native process tree cancellation is unavailable.");
  }
  const controller = new AbortController();
  const reads = new AbortController();
  const captureStdout = options.stdout !== "inherit";
  const captureStderr = options.stderr !== "inherit";
  let child: Bun.Subprocess;
  try {
    child = Bun.spawn(argv, {
      cwd,
      env: options.env ?? Bun.env,
      stdin: options.input ?? options.stdin ?? "ignore",
      stdout: captureStdout ? "pipe" : "inherit",
      stderr: captureStderr ? "pipe" : "inherit",
      signal: controller.signal,
      killSignal: "SIGKILL",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
  } catch {
    job?.close();
    throw new ProcessError("START_FAILED", "The native process could not start.");
  }
  if (job) {
    try {
      job.assign(child);
    } catch {
      job.close();
      job = undefined;
      if (!taskkill) {
        controller.abort();
        await Promise.allSettled([
          reap(child),
          child.stdout instanceof ReadableStream ? child.stdout.cancel() : Promise.resolve(),
          child.stderr instanceof ReadableStream ? child.stderr.cancel() : Promise.resolve(),
        ]);
        throw new ProcessError("START_FAILED", "The native process could not be isolated.");
      }
    }
  }

  let failure: ProcessError | undefined;
  let stopping: Promise<void> | undefined;
  let outputBytes = 0;
  const stopTree = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      reads.abort();
      try {
        if (job) job.terminate();
        else if (process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            /* The owned process group may already be gone. */
          }
        } else if (taskkill && child.exitCode === null) {
          const killer = Bun.spawn([taskkill, "/PID", String(child.pid), "/T", "/F"], {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            windowsHide: true,
            signal: AbortSignal.timeout(5_000),
            killSignal: "SIGKILL",
          });
          await killer.exited;
        }
      } catch {
        // Abort still terminates the direct child if the host tree operation fails.
      } finally {
        controller.abort();
        await reap(child);
      }
    })();
    return stopping;
  };
  const fail = (code: ProcessErrorCode, message: string) => {
    failure ??= new ProcessError(code, message);
    void stopTree();
  };
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    if (options.forwardSignals && child.exitCode === null) {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
        return;
      } catch {
        // If forwarding fails, tear down the owned tree below.
      }
    }
    fail("INTERRUPTED", "The native process was interrupted.");
  };
  const sigint = () => interrupt("SIGINT");
  const sigterm = () => interrupt("SIGTERM");
  const abort = () => fail("INTERRUPTED", "The native process was interrupted.");
  const timer = setTimeout(() => fail("TIMEOUT", "The native process exceeded its deadline."), options.timeoutMs);
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  const stage = async <T>(task: () => T | Promise<T>): Promise<T> => {
    if (reads.signal.aborted) throw failure;
    let interrupted: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      interrupted = () => reject(failure);
      reads.signal.addEventListener("abort", interrupted, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(task), cancelled]);
    } finally {
      if (interrupted) reads.signal.removeEventListener("abort", interrupted);
    }
  };
  const collect = async (
    stream: ReadableStream<Uint8Array>,
    retain: boolean,
    channel: "stdout" | "stderr",
  ): Promise<string> => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let retainedBytes = 0;
    try {
      for (;;) {
        const chunk = await stage(() => reader.read());
        if (chunk.done) break;
        outputBytes += chunk.value.byteLength;
        if (outputBytes > options.maxOutputBytes) {
          fail("OUTPUT_LIMIT", "The native process exceeded its output limit.");
          throw failure;
        }
        if (options.onOutput) await stage(() => options.onOutput!(channel, chunk.value));
        if (retain) {
          chunks.push(chunk.value);
          retainedBytes += chunk.value.byteLength;
        }
      }
      if (!retain) return "";
      const bytes = new Uint8Array(retainedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      if (reads.signal.aborted) void reader.cancel().catch(() => {});
      try {
        reader.releaseLock();
      } catch {
        /* A cancelled pending read can finish after its consumer has stopped. */
      }
    }
  };

  try {
    if (options.onStart) await stage(() => options.onStart!(child.pid));
    const [code, stdout, stderr] = await Promise.all([
      child.exited.then(code => {
        // Close pipes inherited by remaining Windows children after the direct child exits.
        job?.close();
        job = undefined;
        if (process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            // A completed owner may have no remaining process group.
          }
        }
        return code;
      }),
      child.stdout instanceof ReadableStream
        ? collect(child.stdout, options.stdout !== "discard", "stdout")
        : Promise.resolve(""),
      child.stderr instanceof ReadableStream
        ? collect(child.stderr, options.stderr !== "discard", "stderr")
        : Promise.resolve(""),
    ]);
    if (failure) throw failure;
    return { code, stdout, stderr };
  } catch (error) {
    failure ??= new ProcessError("FAILED", "The native process failed.");
    await stopTree();
    if (error instanceof ProcessError) throw error;
    throw failure;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", sigint);
    process.removeListener("SIGTERM", sigterm);
    options.signal?.removeEventListener("abort", abort);
    job?.close();
  }
}
