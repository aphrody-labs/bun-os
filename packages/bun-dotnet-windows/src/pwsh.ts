// SPDX-License-Identifier: MIT
/**
 * `bun:pwsh`: PowerShell 7 (built from vendor/powershell) hosted in the Bun process. bun:dotnet starts the CLR
 * through hostfxr and loads BunOs.Pwsh.dll into the default load context; pipelines run in one persistent runspace
 * and come back as JSON objects with every stream. `spawn` runs pwsh.exe instead (no shared CLR, slower).
 *
 * The CLR is one per process: bun:pwsh needs it on .NET 11 (the PowerShell build's framework). If another owner
 * started it first on an older runtime, `evaluate` throws and `spawn` remains.
 */
import { CString, FFIType, JSCallback, type Pointer } from "bun:ffi";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BUILD_HINT, layout } from "./paths.ts";

export interface PwshResult {
  /** Pipeline output objects (depth-limited JSON of the PowerShell objects). */
  output: unknown[];
  errors: string[];
  warnings: string[];
  verbose: string[];
  debug: string[];
  information: string[];
  hadErrors: boolean;
  durationMs: number;
}

export interface EvalOptions {
  /** Object graph depth of the output (default 2). */
  depth?: number;
  /** A fresh runspace instead of the persistent one. */
  fresh?: boolean;
  /** Variables set in the runspace before the script runs. */
  variables?: Record<string, unknown>;
  cwd?: string;
}

export class PwshError extends Error {
  readonly code: string;
  constructor(error: { code?: string; message?: string; cause?: string }) {
    super(`bun:pwsh: ${error.message ?? "failed"}${error.cause ? ` (${error.cause})` : ""}`);
    this.name = "PwshError";
    this.code = error.code ?? "EFAIL";
  }
}

const TYPE = "BunOs.Pwsh.Exports, BunOs.Pwsh";
const encoder = new TextEncoder();
const cstr = (text: string) => encoder.encode(`${text}\0`);

/** A .NET root with a Microsoft.NETCore.App 11 runtime: DOTNET_ROOT, the user-local install, Program Files. */
function dotnet11Root(): string | undefined {
  const roots = [
    process.env.DOTNET_ROOT,
    join(process.env.LOCALAPPDATA ?? "", "Microsoft", "dotnet"),
    join(process.env.ProgramFiles ?? "C:\\Program Files", "dotnet"),
  ];
  for (const root of roots) {
    if (!root) continue;
    const shared = join(root, "shared", "Microsoft.NETCore.App");
    if (existsSync(shared) && readdirSync(shared).some(v => v.startsWith("11."))) return root;
  }
  return undefined;
}

interface Host {
  eval: (script: Uint8Array, options: Uint8Array) => Pointer;
  evalAsync: (script: Uint8Array, options: Uint8Array, callback: Pointer, user: bigint) => void;
  free: (pointer: Pointer) => void;
  version: () => Pointer;
  ping: (value: bigint) => bigint;
}

let host: Host | undefined;

async function load(): Promise<Host> {
  if (host) return host;
  const { pwshHost } = layout();
  const config = pwshHost.replace(/\.dll$/i, ".runtimeconfig.json");
  if (!existsSync(pwshHost) || !existsSync(config))
    throw new PwshError({ message: `${pwshHost} is missing: ${BUILD_HINT}` });
  // The bun:dotnet module itself, imported by path so a `bun build --compile` bin carries it without the preload.
  const dotnet = await import("@aphrody/bun-os-plugins/dotnet");
  if (!dotnet.runtimeConfig()) {
    const root = dotnet11Root();
    if (root) process.env.DOTNET_ROOT = root;
    dotnet.initialize(config);
  }
  dotnet.loadAssembly(pwshHost);
  const fn = (method: string, args: FFIType[], returns: FFIType) =>
    dotnet.unmanaged({ type: TYPE, method }, { args, returns }) as (...a: unknown[]) => never;
  host = {
    eval: fn("Eval", [FFIType.ptr, FFIType.ptr], FFIType.ptr),
    evalAsync: fn("EvalAsync", [FFIType.ptr, FFIType.ptr, FFIType.function, FFIType.i64], FFIType.void),
    free: fn("Free", [FFIType.ptr], FFIType.void),
    version: fn("Version", [], FFIType.ptr),
    ping: fn("Ping", [FFIType.i64], FFIType.i64),
  };
  return host;
}

function unwrap(json: string): PwshResult {
  const envelope = JSON.parse(json) as {
    ok: boolean;
    value?: PwshResult;
    error?: { code: string; message: string; cause?: string };
  };
  if (!envelope.ok || !envelope.value) throw new PwshError(envelope.error ?? {});
  return envelope.value;
}

function take(h: Host, pointer: Pointer): string {
  try {
    return new CString(pointer).toString();
  } finally {
    h.free(pointer);
  }
}

/** Starts the in-process host (CLR + runspace assemblies); later calls are cheap. */
export async function start(): Promise<{ library: string; powershell: string; pshome: string; runtime: string }> {
  const h = await load();
  return JSON.parse(take(h, h.version()));
}

/** Runs a pipeline in process on a .NET thread-pool thread; the event loop keeps running. */
export async function evaluate(script: string, options: EvalOptions = {}): Promise<PwshResult> {
  const h = await load();
  const { promise, resolve, reject } = Promise.withResolvers<PwshResult>();
  // A thread-safe JSCallback does not hold the event loop open: a ref'd timer does until completion.
  const keepAlive = setInterval(() => {}, 1 << 30);
  const callback = new JSCallback(
    (_user: bigint, _kind: number, json: Pointer) => {
      callback.close();
      clearInterval(keepAlive);
      try {
        resolve(unwrap(new CString(json).toString()));
      } catch (error) {
        reject(error);
      }
    },
    { args: [FFIType.i64, FFIType.i32, FFIType.ptr], returns: FFIType.void, threadsafe: true },
  );
  h.evalAsync(cstr(script), cstr(JSON.stringify(options)), callback.ptr!, 0n);
  return promise;
}

/** Synchronous in-process pipeline (blocks the JS thread until it completes). */
export async function evaluateSync(script: string, options: EvalOptions = {}): Promise<PwshResult> {
  const h = await load();
  return unwrap(take(h, h.eval(cstr(script), cstr(JSON.stringify(options)))));
}

/** Round trip into the managed host (latency probe). */
export async function ping(value = 0n): Promise<bigint> {
  return BigInt((await load()).ping(value));
}

/** The pwsh executable: the source build (PSHOME), else pwsh on PATH. */
export function executable(): string | null {
  const { pshome } = layout();
  const built = join(pshome, "pwsh.exe");
  return existsSync(built) ? built : Bun.which("pwsh");
}

/**
 * Environment for the source-built pwsh.exe: it is framework-dependent on .NET 11, which the apphost only finds
 * through DOTNET_ROOT when it is installed per user.
 */
export function executableEnv(): Record<string, string | undefined> {
  const root = dotnet11Root();
  return root ? { ...process.env, DOTNET_ROOT: root } : { ...process.env };
}

/** Out-of-process route: pwsh.exe -NoProfile, output as JSON (ConvertTo-Json). */
export async function spawn(
  script: string,
  options: { depth?: number; cwd?: string } = {},
): Promise<{ output: unknown; stderr: string; exitCode: number }> {
  const exe = executable();
  if (!exe) throw new PwshError({ message: "no pwsh executable (build vendor/powershell or install PowerShell 7)" });
  const wrapped = `$ProgressPreference='SilentlyContinue'; & { ${script} } | ConvertTo-Json -Depth ${options.depth ?? 2} -Compress`;
  const proc = Bun.spawn([exe, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", wrapped], {
    cwd: options.cwd,
    env: executableEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const text = stdout.trim();
  return { output: text ? JSON.parse(text) : null, stderr, exitCode };
}

export default { start, evaluate, evaluateSync, spawn, ping, executable };
