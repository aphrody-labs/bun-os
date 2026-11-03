// SPDX-License-Identifier: MIT
/**
 * .NET hosted in the Bun process through the official native hosting API (hostfxr) and bun:ffi, on upstream Bun.
 * This replaces the fork's `src/runtime/dotnet/host.rs` + `bun-dotnet-host` crate: install discovery, SDK and
 * framework resolution, starting the CLR from a `.runtimeconfig.json` and the CLR delegates
 * (`load_assembly_and_get_function_pointer`, `get_function_pointer`, `load_assembly`).
 * https://github.com/dotnet/runtime/blob/main/docs/design/features/native-hosting.md
 */
import { CFunction, dlopen, FFIType, JSCallback, ptr, read, type Pointer } from "bun:ffi";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";

const wide = process.platform === "win32";
const LIBRARY = wide ? "hostfxr.dll" : process.platform === "darwin" ? "libhostfxr.dylib" : "libhostfxr.so";
const MUXER = wide ? "dotnet.exe" : "dotnet";

const HDT_LOAD_ASSEMBLY_AND_GET_FUNCTION_POINTER = 5;
const HDT_GET_FUNCTION_POINTER = 6;
const HDT_LOAD_ASSEMBLY = 7;
/** `UNMANAGEDCALLERSONLY_METHOD`: selects an `[UnmanagedCallersOnly]` method instead of a delegate type. */
const UNMANAGEDCALLERSONLY_METHOD = 0xffffffffffffffffn;

/** hostfxr status codes (`src/native/corehost/error_codes.h`). */
export const status = {
  SUCCESS: 0,
  SUCCESS_HOST_ALREADY_INITIALIZED: 1,
  SUCCESS_DIFFERENT_RUNTIME_PROPERTIES: 2,
} as const;

export class DotnetError extends Error {
  readonly code = "ERR_BUN_DOTNET";
  readonly hresult?: number;
  constructor(message: string, hresult?: number) {
    super(message);
    this.name = "DotnetError";
    if (hresult !== undefined) this.hresult = hresult >>> 0;
  }
}

// ─── char_t strings ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A NUL-terminated `char_t` string: UTF-16 on Windows, UTF-8 elsewhere. */
export function nativeString(value: string): Uint8Array {
  if (value.includes("\0")) throw new DotnetError(".NET host input contains NUL");
  if (wide) {
    const bytes = new Uint8Array((value.length + 1) * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
    return bytes;
  }
  return new TextEncoder().encode(`${value}\0`);
}

function readNative(address: Pointer | null): string {
  if (!address) return "";
  if (!wide) {
    const bytes: number[] = [];
    for (let i = 0; ; i++) {
      const byte = read.u8(address, i);
      if (byte === 0) break;
      bytes.push(byte);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
  let text = "";
  for (let i = 0; ; i += 2) {
    const unit = read.u16(address, i);
    if (unit === 0) return text;
    text += String.fromCharCode(unit);
  }
}

// ─── versions ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: string;
  text: string;
}

function parseVersion(text: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(text);
  if (!match) return null;
  return { major: +match[1]!, minor: +match[2]!, patch: +match[3]!, pre: match[4] ?? "", text };
}

function comparePre(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l) ? Number(l) : NaN;
    const rn = /^\d+$/.test(r) ? Number(r) : NaN;
    if (!Number.isNaN(ln) && !Number.isNaN(rn)) {
      if (ln !== rn) return ln - rn;
    } else if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return a < b ? -1 : a > b ? 1 : 0;
  return (
    left.major - right.major || left.minor - right.minor || left.patch - right.patch || comparePre(left.pre, right.pre)
  );
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function versionsIn(dir: string, marker?: (path: string) => boolean): string[] {
  if (!isDirectory(dir)) return [];
  return readdirSync(dir)
    .filter(name => parseVersion(name) !== null && (!marker || marker(join(dir, name))))
    .sort(compareVersions);
}

// ─── install discovery ──────────────────────────────────────────────────────────────────────────────────────────────

export interface DotnetLocation {
  dotnetRoot: string;
  hostfxr: string;
  source: "argument" | "DOTNET_ROOT" | "PATH" | "registered" | "default";
  muxer: string | null;
  /** Installed SDK versions, oldest first. */
  sdks: string[];
  /** Installed Microsoft.NETCore.App versions, oldest first. */
  runtimes: string[];
}

function hostfxrIn(root: string): string | null {
  const fxr = join(root, "host", "fxr");
  const newest = versionsIn(fxr, dir => existsSync(join(dir, LIBRARY))).at(-1);
  return newest === undefined ? null : join(fxr, newest, LIBRARY);
}

function archSuffix(): string {
  return process.arch === "arm64" ? "ARM64" : process.arch === "ia32" ? "X86" : "X64";
}

function candidateRoots(): { root: string; source: DotnetLocation["source"] }[] {
  const roots: { root: string; source: DotnetLocation["source"] }[] = [];
  const archRoot = process.env[`DOTNET_ROOT_${archSuffix()}`];
  for (const value of [archRoot, process.env.DOTNET_ROOT])
    if (value) roots.push({ root: value, source: "DOTNET_ROOT" });
  const onPath = Bun.which("dotnet");
  if (onPath) {
    let real = onPath;
    try {
      real = realpathSync(onPath);
    } catch {}
    roots.push({ root: dirname(real), source: "PATH" });
  }
  if (!wide) {
    for (const file of [`/etc/dotnet/install_location_${process.arch}`, "/etc/dotnet/install_location"]) {
      try {
        const line = readFileSync(file, "utf8").split(/\r?\n/)[0]?.trim();
        if (line) roots.push({ root: line, source: "registered" });
      } catch {}
    }
  }
  const defaults = wide
    ? [join(process.env.ProgramFiles ?? "C:\\Program Files", "dotnet")]
    : process.platform === "darwin"
      ? ["/usr/local/share/dotnet", join(homedir(), ".dotnet")]
      : [
          "/usr/share/dotnet",
          "/usr/lib/dotnet",
          "/usr/lib64/dotnet",
          "/usr/local/share/dotnet",
          join(homedir(), ".dotnet"),
        ];
  for (const root of defaults) roots.push({ root, source: "default" });
  return roots;
}

function describe(root: string, source: DotnetLocation["source"]): DotnetLocation | null {
  const hostfxr = hostfxrIn(root);
  if (hostfxr === null) return null;
  const muxer = join(root, MUXER);
  return {
    dotnetRoot: root,
    hostfxr,
    source,
    muxer: existsSync(muxer) ? muxer : null,
    sdks: versionsIn(join(root, "sdk"), dir => existsSync(join(dir, "dotnet.dll"))),
    runtimes: frameworkVersions(root, "Microsoft.NETCore.App"),
  };
}

function frameworkVersions(root: string, name: string): string[] {
  return versionsIn(join(root, "shared", name));
}

/** The .NET install to host: `dotnetRoot` when given, else DOTNET_ROOT, the dotnet on PATH, registered, default. */
export function locate(dotnetRoot?: string): DotnetLocation {
  if (dotnetRoot !== undefined) {
    const location = describe(resolvePath(dotnetRoot), "argument");
    if (!location) throw new DotnetError(`${dotnetRoot} holds no hostfxr (host/fxr/<version>/${LIBRARY})`);
    return location;
  }
  for (const { root, source } of candidateRoots()) {
    const location = describe(root, source);
    if (location) return location;
  }
  throw new DotnetError("no .NET install found: install the .NET runtime or set DOTNET_ROOT");
}

/** Every distinct install the discovery order can see. */
export function installs(): DotnetLocation[] {
  const seen = new Set<string>();
  const found: DotnetLocation[] = [];
  for (const { root, source } of candidateRoots()) {
    let key = root;
    try {
      key = realpathSync(root).toLowerCase();
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const location = describe(root, source);
    if (location) found.push(location);
  }
  return found;
}

// ─── hostfxr ────────────────────────────────────────────────────────────────────────────────────────────────────────

const HOSTFXR = {
  hostfxr_initialize_for_runtime_config: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  hostfxr_get_runtime_delegate: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  hostfxr_close: { args: [FFIType.ptr], returns: FFIType.i32 },
  hostfxr_set_error_writer: { args: [FFIType.ptr], returns: FFIType.ptr },
  hostfxr_resolve_sdk2: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
} as const;

type Hostfxr = ReturnType<typeof dlopen<typeof HOSTFXR>>["symbols"];

let fxr: { location: DotnetLocation; symbols: Hostfxr } | undefined;

function hostfxr(): { location: DotnetLocation; symbols: Hostfxr } {
  if (fxr) return fxr;
  const location = locate();
  fxr = { location, symbols: dlopen(location.hostfxr, HOSTFXR).symbols };
  return fxr;
}

/** Runs `body` with hostfxr's error writer collecting the diagnostics it prints. */
function capture<T>(symbols: Hostfxr, body: () => T): [T, string] {
  const lines: string[] = [];
  const writer = new JSCallback((message: Pointer) => void lines.push(readNative(message)), {
    args: [FFIType.ptr],
    returns: FFIType.void,
  });
  const previous = symbols.hostfxr_set_error_writer(writer.ptr);
  try {
    return [body(), lines.join("\n")];
  } finally {
    symbols.hostfxr_set_error_writer(previous);
    writer.close();
  }
}

function failure(what: string, code: number, detail: string): DotnetError {
  const hex = `0x${(code >>> 0).toString(16)}`;
  return new DotnetError(`${what} failed: ${hex}${detail ? `\n${detail}` : ""}`, code);
}

// ─── SDK resolution ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface SdkResolution {
  dotnetRoot: string;
  globalJson: string | null;
  sdk: { version: string; path: string } | null;
  error: string | null;
}

/** The SDK `cwd` selects (global.json rules applied by hostfxr_resolve_sdk2). */
export function resolveSdk(cwd = process.cwd()): SdkResolution {
  const { location, symbols } = hostfxr();
  let sdkDir: string | null = null;
  let globalJson: string | null = null;
  const result = new JSCallback(
    (key: number, value: Pointer) => {
      if (key === 0) sdkDir = readNative(value);
      else if (key === 1) globalJson = readNative(value);
    },
    { args: [FFIType.i32, FFIType.ptr], returns: FFIType.void },
  );
  try {
    const [code, detail] = capture(symbols, () =>
      symbols.hostfxr_resolve_sdk2(
        ptr(nativeString(location.dotnetRoot)),
        ptr(nativeString(resolvePath(cwd))),
        0,
        result.ptr,
      ),
    );
    const dir = sdkDir as string | null;
    const sdk =
      code === 0 && dir
        ? {
            version: dir
              .replace(/[\\/]+$/, "")
              .split(/[\\/]/)
              .at(-1)!,
            path: dir,
          }
        : null;
    return {
      dotnetRoot: location.dotnetRoot,
      globalJson,
      sdk,
      error: sdk ? null : detail.trim() || `hostfxr_resolve_sdk2 failed: 0x${(code >>> 0).toString(16)}`,
    };
  } finally {
    result.close();
  }
}

// ─── framework resolution (runtimeconfig.json roll-forward) ─────────────────────────────────────────────────────────

const ROLL_FORWARD = ["Disable", "LatestPatch", "Minor", "LatestMinor", "Major", "LatestMajor"] as const;
type RollForward = (typeof ROLL_FORWARD)[number];

function rollForwardOf(value: unknown): RollForward | undefined {
  if (typeof value !== "string") return undefined;
  return ROLL_FORWARD.find(name => name.toLowerCase() === value.toLowerCase());
}

function rollForwardOnNoCandidate(value: unknown): RollForward | undefined {
  return value === 0 ? "LatestPatch" : value === 1 ? "Minor" : value === 2 ? "Major" : undefined;
}

/** The framework version `policy` picks for `requested` among `installed` (the muxer's documented rules). */
export function pickFramework(
  requested: string,
  installed: readonly string[],
  policy: RollForward = "Minor",
  applyPatches = true,
  allowPrerelease = false,
): string | null {
  const want = parseVersion(requested);
  if (!want) return null;
  const preOk = allowPrerelease || want.pre !== "";
  const all = installed
    .map(parseVersion)
    .filter((v): v is Version => v !== null && (preOk || v.pre === "") && compareVersions(v.text, requested) >= 0)
    .sort((a, b) => compareVersions(a.text, b.text));
  if (policy === "Disable") return all.find(v => v.text === requested)?.text ?? null;
  const patchOf = (major: number, minor: number) => {
    const line = all.filter(v => v.major === major && v.minor === minor);
    return (applyPatches ? line.at(-1) : line[0])?.text ?? null;
  };
  const sameLine = patchOf(want.major, want.minor);
  if (policy === "LatestPatch") return sameLine;
  const sameMajor = all.filter(v => v.major === want.major);
  if (policy === "LatestMinor") {
    const top = sameMajor.at(-1);
    return top ? patchOf(top.major, top.minor) : null;
  }
  if (policy === "LatestMajor") {
    const top = all.at(-1);
    return top ? patchOf(top.major, top.minor) : null;
  }
  if (sameLine) return sameLine;
  const nextMinor = sameMajor.find(v => v.minor > want.minor);
  if (nextMinor) return patchOf(nextMinor.major, nextMinor.minor);
  if (policy === "Minor") return null;
  const nextMajor = all.find(v => v.major > want.major);
  return nextMajor ? patchOf(nextMajor.major, nextMajor.minor) : null;
}

export interface FrameworkResolution {
  runtimeConfig: string;
  dotnetRoot: string;
  frameworks: {
    name: string;
    requested: string;
    rollForward: RollForward;
    applyPatches: boolean;
    resolved: { version: string; path: string } | null;
  }[];
}

/** The frameworks an app's `.runtimeconfig.json` binds to on the located install. */
export function resolveFrameworks(runtimeConfig: string): FrameworkResolution {
  const location = locate();
  const text = readFileSync(runtimeConfig, "utf8").replace(/^\uFEFF/, "");
  let options: Record<string, any>;
  try {
    options = (JSON.parse(text) as { runtimeOptions?: Record<string, any> }).runtimeOptions ?? {};
  } catch (error) {
    throw new DotnetError(`${runtimeConfig}: ${(error as Error).message}`);
  }
  const envPolicy = rollForwardOf(process.env.DOTNET_ROLL_FORWARD);
  const prerelease = process.env.DOTNET_ROLL_FORWARD_TO_PRERELEASE === "1";
  const appPolicy =
    rollForwardOf(options.rollForward) ?? rollForwardOnNoCandidate(options.rollForwardOnNoCandidateFx) ?? "Minor";
  const references: Record<string, any>[] = [
    ...(options.framework ? [options.framework] : []),
    ...(Array.isArray(options.frameworks) ? options.frameworks : []),
  ];
  const included: Record<string, any>[] = Array.isArray(options.includedFrameworks) ? options.includedFrameworks : [];
  const frameworks = [
    ...references.map(reference => {
      const name = String(reference.name);
      const requested = String(reference.version);
      const policy =
        envPolicy ??
        rollForwardOf(reference.rollForward) ??
        rollForwardOnNoCandidate(reference.rollForwardOnNoCandidateFx) ??
        appPolicy;
      const applyPatches = (reference.applyPatches ?? options.applyPatches) !== false;
      const version = pickFramework(
        requested,
        frameworkVersions(location.dotnetRoot, name),
        policy,
        applyPatches,
        prerelease,
      );
      return {
        name,
        requested,
        rollForward: policy,
        applyPatches,
        resolved: version ? { version, path: join(location.dotnetRoot, "shared", name, version) } : null,
      };
    }),
    ...included.map(framework => ({
      name: String(framework.name),
      requested: String(framework.version),
      rollForward: "Disable" as RollForward,
      applyPatches: false,
      resolved: { version: String(framework.version), path: dirname(resolvePath(runtimeConfig)) },
    })),
  ];
  return { runtimeConfig: resolvePath(runtimeConfig), dotnetRoot: location.dotnetRoot, frameworks };
}

// ─── the CLR ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Runtime {
  loadAssemblyAndGetFunctionPointer: (...args: unknown[]) => number;
  getFunctionPointer: (...args: unknown[]) => number;
  loadAssembly: ((...args: unknown[]) => number) | null;
  initStatus: number;
  runtimeConfig: string;
}

let runtime: Runtime | undefined;

/** A runtimeconfig for the newest Microsoft.NETCore.App of the install (LatestMinor), written once to the temp dir. */
function generatedRuntimeConfig(location: DotnetLocation): string {
  const version = location.runtimes.at(-1);
  if (!version) throw new DotnetError(`no Microsoft.NETCore.App runtime under ${location.dotnetRoot}`);
  const major = version.split(".")[0];
  const text = `{\n  "runtimeOptions": {\n    "tfm": "net${major}.0",\n    "rollForward": "LatestMinor",\n    "framework": { "name": "Microsoft.NETCore.App", "version": "${major}.0.0" }\n  }\n}\n`;
  const dir = join(tmpdir(), "bun-dotnet");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `net${major}.runtimeconfig.json`);
  let current: string | undefined;
  try {
    current = readFileSync(path, "utf8");
  } catch {}
  if (current !== text) {
    const partial = join(dir, `net${major}.${process.pid}.tmp`);
    writeFileSync(partial, text);
    renameSync(partial, path);
  }
  return path;
}

function start(runtimeConfig?: string): Runtime {
  if (runtime) return runtime;
  const { location, symbols } = hostfxr();
  const config = resolvePath(
    runtimeConfig ?? process.env.BUN_DOTNET_RUNTIME_CONFIG ?? generatedRuntimeConfig(location),
  );
  if (!existsSync(config)) throw new DotnetError(`runtime configuration not found: ${config}`);
  const root = nativeString(location.dotnetRoot);
  const parameters = new BigUint64Array([24n, 0n, BigInt(ptr(root))]);
  const handle = new BigUint64Array(1);
  const [code, detail] = capture(symbols, () =>
    symbols.hostfxr_initialize_for_runtime_config(ptr(nativeString(config)), ptr(parameters), ptr(handle)),
  );
  const context = Number(handle[0]) as Pointer;
  if (code < status.SUCCESS || code > status.SUCCESS_DIFFERENT_RUNTIME_PROPERTIES) {
    if (context) symbols.hostfxr_close(context);
    throw failure(`hostfxr_initialize_for_runtime_config(${config})`, code, detail);
  }
  const delegate = (kind: number, name: string, required: boolean): Pointer | null => {
    const out = new BigUint64Array(1);
    const [result, message] = capture(symbols, () => symbols.hostfxr_get_runtime_delegate(context, kind, ptr(out)));
    if (result !== status.SUCCESS || out[0] === 0n) {
      if (!required) return null;
      throw failure(`hostfxr_get_runtime_delegate(${name})`, result, message);
    }
    return Number(out[0]) as Pointer;
  };
  try {
    const six = { args: Array(6).fill(FFIType.ptr), returns: FFIType.i32 };
    const loadAndGet = delegate(
      HDT_LOAD_ASSEMBLY_AND_GET_FUNCTION_POINTER,
      "load_assembly_and_get_function_pointer",
      true,
    )!;
    const get = delegate(HDT_GET_FUNCTION_POINTER, "get_function_pointer", true)!;
    // load_assembly arrived with .NET 8; earlier runtimes keep the other two delegates.
    const load = delegate(HDT_LOAD_ASSEMBLY, "load_assembly", false);
    runtime = {
      loadAssemblyAndGetFunctionPointer: CFunction({ ...six, ptr: loadAndGet }) as never,
      getFunctionPointer: CFunction({ ...six, ptr: get }) as never,
      loadAssembly: load
        ? (CFunction({ args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32, ptr: load }) as never)
        : null,
      initStatus: code,
      runtimeConfig: config,
    };
    return runtime;
  } finally {
    // The delegates stay valid after the context closes; the runtime stays loaded.
    symbols.hostfxr_close(context);
  }
}

/** Starts the CLR (once per process): 0 started here, 1 or 2 when it was already running. */
export function initialize(runtimeConfig?: string): number {
  const running = runtime !== undefined;
  const started = start(runtimeConfig);
  return running ? status.SUCCESS_HOST_ALREADY_INITIALIZED : started.initStatus;
}

/** The `.runtimeconfig.json` the CLR started with, or null before it started. */
export function runtimeConfig(): string | null {
  return runtime?.runtimeConfig ?? null;
}

export interface FunctionPointerOptions {
  /** Loads this assembly in its own load context first; without it the type resolves in the default context. */
  assembly?: string;
  /** Assembly-qualified type name, e.g. `Demo.Exports, Demo`. */
  type: string;
  method: string;
  /** Assembly-qualified delegate type; omitted for an `[UnmanagedCallersOnly]` method. */
  delegateType?: string;
}

/** The native address of a managed static method. The first call starts the CLR (see {@link initialize}). */
export function functionPointer(options: FunctionPointerOptions): number {
  const clr = start();
  const { symbols } = hostfxr();
  const typeName = nativeString(options.type);
  const method = nativeString(options.method);
  const delegateType = options.delegateType === undefined ? null : nativeString(options.delegateType);
  const delegateArg = delegateType ? ptr(delegateType) : UNMANAGEDCALLERSONLY_METHOD;
  const out = new BigUint64Array(1);
  const assembly = options.assembly === undefined ? null : nativeString(resolvePath(options.assembly));
  const [code, detail] = capture(symbols, () =>
    assembly
      ? clr.loadAssemblyAndGetFunctionPointer(ptr(assembly), ptr(typeName), ptr(method), delegateArg, null, ptr(out))
      : clr.getFunctionPointer(ptr(typeName), ptr(method), delegateArg, null, null, ptr(out)),
  );
  if (code !== 0 || out[0] === 0n) {
    const which = assembly ? "load_assembly_and_get_function_pointer" : "get_function_pointer";
    throw failure(`${which}(${options.type}.${options.method})`, code, detail);
  }
  return Number(out[0]);
}

/** Loads an assembly into the default load context (.NET 8+), so `functionPointer` finds its types without `assembly`. */
export function loadAssembly(assemblyPath: string): void {
  const clr = start();
  if (!clr.loadAssembly) throw new DotnetError("load_assembly needs .NET 8 or newer");
  const { symbols } = hostfxr();
  const path = nativeString(resolvePath(assemblyPath));
  const [code, detail] = capture(symbols, () => clr.loadAssembly!(ptr(path), null, null));
  if (code !== 0) throw failure(`load_assembly(${assemblyPath})`, code, detail);
}

// ─── info and environment snapshots ─────────────────────────────────────────────────────────────────────────────────

function installJson(location: DotnetLocation) {
  const shared = join(location.dotnetRoot, "shared");
  const frameworks = isDirectory(shared)
    ? readdirSync(shared).flatMap(name =>
        frameworkVersions(location.dotnetRoot, name).map(version => ({
          name,
          version,
          path: join(shared, name, version),
        })),
      )
    : [];
  return {
    root: location.dotnetRoot,
    source: location.source,
    muxer: location.muxer,
    hostfxr: versionsIn(join(location.dotnetRoot, "host", "fxr"), dir => existsSync(join(dir, LIBRARY))).map(
      version => ({ version, path: join(location.dotnetRoot, "host", "fxr", version, LIBRARY) }),
    ),
    sdks: location.sdks.map(version => ({ version, path: join(location.dotnetRoot, "sdk", version) })),
    frameworks,
  };
}

/** .NET Framework 4.x from the registry (Windows only). */
function netFramework(): { version: string; release: number | null }[] {
  if (!wide) return [];
  const result = Bun.spawnSync(["reg", "query", "HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full"], {
    stdout: "pipe",
    stderr: "ignore",
    windowsHide: true,
  });
  if (result.exitCode !== 0) return [];
  const text = result.stdout.toString();
  const version = /^\s*Version\s+REG_SZ\s+(\S+)/m.exec(text)?.[1];
  const release = /^\s*Release\s+REG_DWORD\s+0x([0-9a-f]+)/im.exec(text)?.[1];
  return version ? [{ version, release: release ? Number.parseInt(release, 16) : null }] : [];
}

const ENV_SHOWN = [
  "DOTNET_ROOT",
  `DOTNET_ROOT_${archSuffix()}`,
  "DOTNET_HOST_PATH",
  "DOTNET_ROLL_FORWARD",
  "DOTNET_ROLL_FORWARD_TO_PRERELEASE",
  "DOTNET_MULTILEVEL_LOOKUP",
  "BUN_DOTNET_RUNTIME_CONFIG",
];

/** Every install, the primary one, the SDK `cwd` selects, .NET Framework and the .NET environment variables. */
export function info(cwd = process.cwd()) {
  const all = installs();
  const primary = (() => {
    try {
      return locate();
    } catch {
      return null;
    }
  })();
  return {
    hostArch: process.arch,
    primary: primary?.dotnetRoot ?? null,
    primarySource: primary?.source ?? null,
    sdk: primary ? resolveSdk(cwd) : null,
    installs: all.map(installJson),
    netFramework: netFramework(),
    environment: Object.fromEntries(ENV_SHOWN.map(name => [name, process.env[name] ?? null])),
  };
}

export interface EnvSnapshot {
  dotnetRoot: string;
  source: string;
  hostfxr: string;
  muxer: string | null;
  arch: string;
  globalJson: string | null;
  sdk: { version: string; path: string } | null;
  sdkError: string | null;
  fingerprint: string;
  env: Record<string, string>;
  pathPrepend: string;
}

const snapshots = new Map<string, EnvSnapshot>();

function fingerprint(cwd: string): string {
  const hash = createHash("sha256");
  for (const name of [...ENV_SHOWN, "PATH"]) hash.update(`${name}=${process.env[name] ?? ""}\n`);
  for (const { root } of candidateRoots()) {
    for (const sub of ["sdk", join("shared", "Microsoft.NETCore.App"), join("host", "fxr")]) {
      const dir = join(root, sub);
      hash.update(`${dir}:${existsSync(dir) ? readdirSync(dir).sort().join(",") : "-"}\n`);
    }
  }
  for (let dir = resolvePath(cwd); ; dir = dirname(dir)) {
    const file = join(dir, "global.json");
    if (existsSync(file)) {
      hash.update(`${file}:${statSync(file).mtimeMs}:${readFileSync(file)}`);
      break;
    }
    if (dirname(dir) === dir) break;
  }
  return hash.digest("hex").slice(0, 32);
}

/** The resolved .NET environment for `cwd` (`DOTNET_ROOT`, `DOTNET_HOST_PATH`, `PATH`, SDK), cached by fingerprint. */
export function env(cwd = process.cwd(), refresh = false): EnvSnapshot {
  const key = resolvePath(cwd);
  const print = fingerprint(key);
  const cached = snapshots.get(key);
  if (!refresh && cached?.fingerprint === print) return cached;
  const location = locate();
  const sdk = resolveSdk(key);
  const vars: Record<string, string> = { DOTNET_ROOT: location.dotnetRoot };
  if (location.muxer) vars.DOTNET_HOST_PATH = location.muxer;
  const snapshot: EnvSnapshot = {
    dotnetRoot: location.dotnetRoot,
    source: location.source,
    hostfxr: location.hostfxr,
    muxer: location.muxer,
    arch: process.arch,
    globalJson: sdk.globalJson,
    sdk: sdk.sdk,
    sdkError: sdk.error,
    fingerprint: print,
    env: vars,
    pathPrepend: location.dotnetRoot,
  };
  snapshots.set(key, snapshot);
  return snapshot;
}
