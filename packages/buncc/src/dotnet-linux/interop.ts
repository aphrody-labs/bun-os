/**
 * Bun <-> .NET and Bun <-> PowerShell interop through real mechanisms only:
 *   - process + JSON on stdio: pwshJson() runs `pwsh -Command ... | ConvertTo-Json` and parses the result
 *   - bun:ffi dlopen of a NativeAOT shared library (`PublishAot` + `NativeLib=Shared` + [UnmanagedCallersOnly(EntryPoint=...)])
 * The sample library and its ABI live in factory/dotnet-linux/sample/native.
 */
import { run } from "../process.ts";

export interface PwshOptions {
  pwsh?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
}

/** Run a PowerShell script, return its object output as JSON (ConvertTo-Json -Depth 8). */
export async function pwshJson<T = unknown>(script: string, options: PwshOptions = {}): Promise<T> {
  const wrapped = `$ErrorActionPreference='Stop'; & { ${script} } | ConvertTo-Json -Compress -Depth 8`;
  const result = await run([options.pwsh ?? "pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", wrapped], {
    output: "capture",
    env: options.env,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 120_000,
  });
  if (result.code !== 0) throw new Error(`pwsh exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`);
  return JSON.parse(result.stdout) as T;
}

/** Run a `.ps1` with `pwsh -File`; stdout is returned. */
export async function pwshFile(file: string, args: string[] = [], options: PwshOptions = {}) {
  return run([options.pwsh ?? "pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", file, ...args], {
    output: "capture",
    env: options.env,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 300_000,
  });
}

import { dlopen, FFIType } from "bun:ffi";

/** Symbols exported by factory/dotnet-linux/sample/native (NativeAOT shared library). */
export const SAMPLE_SYMBOLS = {
  bunos_add: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  bunos_utf16_length: { args: [FFIType.cstring], returns: FFIType.i32 },
  bunos_runtime_description: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
} as const;

/** Load the sample NativeAOT library with bun:ffi. */
export function loadSampleNative(path: string) {
  return dlopen(path, SAMPLE_SYMBOLS);
}
