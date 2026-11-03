// SPDX-License-Identifier: MIT
/**
 * bun:ffi binding of bunos_windows.dll (C# Native AOT) and bunos_win_cpp.dll (C++): the C ABI of
 * include/bunos_windows.h. `call` is synchronous; `callAsync` runs on a library thread and resolves through a
 * thread-safe JSCallback, so long COM work (winget install) never blocks the event loop.
 */
import { CString, dlopen, FFIType, JSCallback, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { BUILD_HINT, layout } from "./paths.ts";

export class WindowsCallError extends Error {
  readonly code: string;
  readonly method: string;
  constructor(method: string, error: { code?: string; message?: string; type?: string }) {
    super(`${method}: ${error.message ?? "failed"} (${error.code ?? "?"})`);
    this.name = "WindowsCallError";
    this.code = error.code ?? "EFAIL";
    this.method = method;
  }
}

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; type?: string } };

const encoder = new TextEncoder();
function cstr(text: string): Uint8Array {
  return encoder.encode(`${text}\0`);
}

function open<const S extends Record<string, { args: FFIType[]; returns: FFIType }>>(path: string, symbols: S) {
  if (process.platform !== "win32") throw new Error("@aphrody/bun-dotnet-windows: Windows only");
  if (!existsSync(path)) throw new Error(`${path} is missing: ${BUILD_HINT}`);
  return dlopen(path, symbols);
}

let nativeLib: ReturnType<typeof openNative> | undefined;
function openNative() {
  return open(layout().native, {
    bunos_abi: { args: [], returns: FFIType.i32 },
    bunos_ping: { args: [FFIType.i64], returns: FFIType.i64 },
    bunos_version: { args: [], returns: FFIType.ptr },
    bunos_methods: { args: [], returns: FFIType.ptr },
    bunos_call: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    bunos_call_async: { args: [FFIType.ptr, FFIType.ptr, FFIType.function, FFIType.i64], returns: FFIType.i64 },
    bunos_free: { args: [FFIType.ptr], returns: FFIType.void },
  });
}

/** The raw symbols of bunos_windows.dll. */
export function nativeSymbols() {
  return (nativeLib ??= openNative()).symbols;
}

function take(pointer: Pointer | null, free: (p: Pointer) => void): string {
  if (pointer === null) throw new Error("bunos_windows: null result");
  try {
    return new CString(pointer).toString();
  } finally {
    free(pointer);
  }
}

function unwrap<T>(method: string, json: string): T {
  const envelope = JSON.parse(json) as Envelope<T>;
  if (!envelope.ok) throw new WindowsCallError(method, envelope.error);
  return envelope.value;
}

export const ABI = 1;

export function abi(): number {
  return nativeSymbols().bunos_abi();
}

/** Round trip through the AOT export (latency probe). */
export function ping(value: bigint | number = 0): bigint {
  return BigInt(nativeSymbols().bunos_ping(value));
}

export interface NativeVersion {
  library: string;
  abi: number;
  version: string;
  runtime: string;
  nativeAot: boolean;
  arch: string;
}

export function version(): NativeVersion {
  const s = nativeSymbols();
  return JSON.parse(take(s.bunos_version(), p => s.bunos_free(p)));
}

export function methods(): string[] {
  const s = nativeSymbols();
  return JSON.parse(take(s.bunos_methods(), p => s.bunos_free(p)));
}

/** Synchronous call of a bunos_windows method (`system.info`, `winget.search`, ...). */
export function call<T = unknown>(method: string, args: unknown = {}): T {
  const s = nativeSymbols();
  return unwrap<T>(
    method,
    take(s.bunos_call(cstr(method), cstr(JSON.stringify(args ?? {}))), p => s.bunos_free(p)),
  );
}

/** Asynchronous call; `onProgress` receives the progress records of long operations (winget install/upgrade). */
export function callAsync<T = unknown>(
  method: string,
  args: unknown = {},
  onProgress?: (progress: unknown) => void,
): Promise<T> {
  const s = nativeSymbols();
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  // A thread-safe JSCallback does not hold the event loop open: a ref'd timer does until completion.
  const keepAlive = setInterval(() => {}, 1 << 30);
  const callback = new JSCallback(
    (_user: bigint, kind: number, json: Pointer) => {
      const text = new CString(json).toString();
      if (kind === 0) {
        if (onProgress) {
          try {
            onProgress(JSON.parse(text));
          } catch {}
        }
        return;
      }
      callback.close();
      clearInterval(keepAlive);
      try {
        resolve(unwrap<T>(method, text));
      } catch (error) {
        reject(error);
      }
    },
    { args: [FFIType.i64, FFIType.i32, FFIType.ptr], returns: FFIType.void, threadsafe: true },
  );
  s.bunos_call_async(cstr(method), cstr(JSON.stringify(args ?? {})), callback.ptr, 0n);
  return promise;
}

// ─── bunos_win_cpp.dll ──────────────────────────────────────────────────────────────────────────────────────────────

let cppLib: ReturnType<typeof openCpp> | undefined;
function openCpp() {
  return open(layout().cpp, {
    bunos_cpp_abi: { args: [], returns: FFIType.i32 },
    bunos_cpp_ping: { args: [FFIType.i64], returns: FFIType.i64 },
    bunos_cpp_call: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    bunos_cpp_free: { args: [FFIType.ptr], returns: FFIType.void },
  });
}

export function cppSymbols() {
  return (cppLib ??= openCpp()).symbols;
}

/** Synchronous call of a bunos_win_cpp method (`graphics.adapters`, `system.profile`). */
export function cppCall<T = unknown>(method: string, args: unknown = {}): T {
  const s = cppSymbols();
  return unwrap<T>(
    method,
    take(s.bunos_cpp_call(cstr(method), cstr(JSON.stringify(args ?? {}))), p => s.bunos_cpp_free(p)),
  );
}

export function cppPing(value: bigint | number = 0): bigint {
  return BigInt(cppSymbols().bunos_cpp_ping(value));
}
