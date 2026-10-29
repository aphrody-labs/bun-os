// Loads a managed [UnmanagedCallersOnly] method through the .NET native hosting API (hostfxr) and bun:ffi, so the
// package runs on upstream Bun without a dedicated runtime module.
// https://github.com/dotnet/runtime/blob/main/docs/design/features/native-hosting.md
import { CFunction, dlopen, FFIType, ptr, type FFIFunction } from "bun:ffi";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HDT_LOAD_ASSEMBLY_AND_GET_FUNCTION_POINTER = 5;
/** `UNMANAGEDCALLERSONLY_METHOD`: the delegate type name that selects [UnmanagedCallersOnly] methods. */
const UNMANAGEDCALLERSONLY_METHOD = 0xffffffffffffffffn;

export interface ManagedMethod {
  /** Full path of the managed assembly; `<name>.runtimeconfig.json` must sit beside it. */
  assembly: string;
  /** Assembly-qualified type name, e.g. `Aphrody.Ds.Exports, Aphrody.Ds`. */
  type: string;
  /** Method name; it must carry [UnmanagedCallersOnly]. */
  method: string;
}

const wide = process.platform === "win32";

/** A NUL-terminated `char_t` string: UTF-16 on Windows, UTF-8 elsewhere. */
function nativeString(value: string): Uint8Array {
  if (wide) {
    const bytes = new Uint8Array((value.length + 1) * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
    return bytes;
  }
  const encoded = new TextEncoder().encode(value);
  const bytes = new Uint8Array(encoded.length + 1);
  bytes.set(encoded);
  return bytes;
}

function versionKey(name: string): number[] {
  return name.split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
}

function compareVersions(a: string, b: string): number {
  const left = versionKey(a);
  const right = versionKey(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function dotnetRoots(): string[] {
  const roots: string[] = [];
  if (process.env.DOTNET_ROOT) roots.push(process.env.DOTNET_ROOT);
  const onPath = Bun.which("dotnet");
  if (onPath) roots.push(dirname(onPath));
  if (process.platform === "win32") {
    if (process.env.ProgramFiles) roots.push(join(process.env.ProgramFiles, "dotnet"));
  } else if (process.platform === "darwin") {
    roots.push("/usr/local/share/dotnet", join(homedir(), ".dotnet"));
  } else {
    roots.push("/usr/share/dotnet", "/usr/lib/dotnet", "/usr/lib64/dotnet", "/usr/local/share/dotnet", join(homedir(), ".dotnet"));
  }
  return roots;
}

/** The newest installed hostfxr library, from DOTNET_ROOT, the dotnet on PATH, or the default install location. */
export function findHostfxr(): string {
  const library = wide ? "hostfxr.dll" : process.platform === "darwin" ? "libhostfxr.dylib" : "libhostfxr.so";
  for (const root of dotnetRoots()) {
    const fxr = join(root, "host", "fxr");
    if (!existsSync(fxr)) continue;
    const versions = readdirSync(fxr)
      .filter(name => existsSync(join(fxr, name, library)))
      .sort(compareVersions);
    const newest = versions.at(-1);
    if (newest) return join(fxr, newest, library);
  }
  throw new Error("hostfxr not found: install the .NET runtime or set DOTNET_ROOT");
}

let hostfxr:
  | {
      initialize: (config: Uint8Array, parameters: null, handle: Uint8Array) => number;
      delegate: (context: bigint, type: number, out: Uint8Array) => number;
      close: (context: bigint) => number;
    }
  | undefined;

function loadHostfxr() {
  if (hostfxr) return hostfxr;
  const { symbols } = dlopen(findHostfxr(), {
    hostfxr_initialize_for_runtime_config: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    hostfxr_get_runtime_delegate: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    hostfxr_close: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  hostfxr = {
    initialize: (config, parameters, handle) =>
      symbols.hostfxr_initialize_for_runtime_config(ptr(config), parameters, ptr(handle)),
    delegate: (context, type, out) => symbols.hostfxr_get_runtime_delegate(context, type, ptr(out)),
    close: context => symbols.hostfxr_close(context),
  };
  return hostfxr;
}

function check(code: number, what: string): void {
  // Negative values are failures; positive values are success codes such as HostAlreadyInitialized (1).
  if (code < 0) throw new Error(`${what} failed: 0x${(code >>> 0).toString(16)}`);
}

let loadAssembly: ((...args: unknown[]) => number) | undefined;

function assemblyLoader() {
  if (loadAssembly) return loadAssembly;
  throw new Error("assemblyLoader() called before the runtime was started");
}

function startRuntime(runtimeConfig: string): void {
  const host = loadHostfxr();
  if (!existsSync(runtimeConfig)) throw new Error(`runtime configuration not found: ${runtimeConfig}`);
  const handle = new BigUint64Array(1);
  check(host.initialize(nativeString(runtimeConfig), null, new Uint8Array(handle.buffer)), "hostfxr_initialize_for_runtime_config");
  const context = handle[0];
  const out = new BigUint64Array(1);
  check(
    host.delegate(context, HDT_LOAD_ASSEMBLY_AND_GET_FUNCTION_POINTER, new Uint8Array(out.buffer)),
    "hostfxr_get_runtime_delegate",
  );
  host.close(context);
  const signature: FFIFunction = {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  };
  loadAssembly = CFunction({ ...signature, ptr: out[0] }) as unknown as (...args: unknown[]) => number;
}

/**
 * Resolves an [UnmanagedCallersOnly] static method of a managed assembly to a callable native function. The first
 * call starts the .NET runtime of the process from `<assembly>.runtimeconfig.json`.
 */
export function unmanaged<T extends (...args: never[]) => unknown>(
  method: ManagedMethod,
  signature: Pick<FFIFunction, "args" | "returns">,
): T {
  if (!loadAssembly) startRuntime(method.assembly.replace(/\.dll$/i, ".runtimeconfig.json"));
  const out = new BigUint64Array(1);
  const code = assemblyLoader()(
    nativeString(method.assembly),
    nativeString(method.type),
    nativeString(method.method),
    UNMANAGEDCALLERSONLY_METHOD,
    null,
    ptr(new Uint8Array(out.buffer)),
  );
  check(code, `load_assembly_and_get_function_pointer(${method.type}.${method.method})`);
  return CFunction({ ...signature, ptr: out[0] }) as unknown as T;
}
