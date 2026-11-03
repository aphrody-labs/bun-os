// SPDX-License-Identifier: Apache-2.0
// `bun:windows` of the aphrody-labs/bun fork (src/js/bun/windows.ts, commit 62fcdb38ec9) on upstream Bun. The fork
// reached Win32 through native Rust (src/runtime/windows/sys/*); here every member is bun:ffi, either through the
// @aphrody/windows owners (registry, services, shell known folders, win32) or directly against the system DLLs, and
// returns the fork's shapes. PE and Authenticode parsing are the fork's own pure TypeScript (./pe.ts,
// ./authenticode.ts).
//
// Fork members not carried here (they needed the fork's native code and have no small bun:ffi equivalent yet):
// theme, eventLog, dll, conpty, gpu, Job, toast/notify, wsl, storage, ntfs, toolchain, family/families/win32
// (embedded windows-rs metadata), pe.catalogFile/catalogSignature/releaseCatalogContexts (CryptCATAdmin context
// cache), services.start/stop (the @aphrody/windows services owner is read-only by design; service control goes
// through WinClean). See docs/bun-engine/FORK-MIGRATION.md.
import { dlopen, FFIType, ptr, read, toArrayBuffer } from "bun:ffi";
import * as registryOwner from "../registry";
import * as servicesOwner from "../services";
import * as shell from "../shell";
import * as win32 from "../win32";
import authenticode from "./authenticode";
import peReader from "./pe";

const MAX_UINT32 = 0xffffffff;
export const isSupported = process.platform === "win32";

function unsupportedError() {
  const error = new Error("bun:windows is only available on Windows") as Error & { code: string };
  error.code = "ERR_BUN_WINDOWS_UNSUPPORTED";
  return error;
}

function ensureSupported(): void {
  if (!isSupported) throw unsupportedError();
}

function invalid(name: string, value: unknown, reason: string): TypeError & { code: string } {
  const error = new TypeError(`The argument '${name}' ${reason}. Received ${String(value)}`) as TypeError & {
    code: string;
  };
  error.code = "ERR_INVALID_ARG_VALUE";
  return error;
}

function invalidType(name: string, expected: string, value: unknown): TypeError & { code: string } {
  return Object.assign(new TypeError(`The "${name}" argument must be ${expected}. Received ${typeof value}`), {
    code: "ERR_INVALID_ARG_TYPE",
  });
}

function validateString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") throw invalidType(name, "of type string", value);
}

function validateInteger(value: unknown, name: string, min: number, max: number): asserts value is number {
  if (typeof value !== "number") throw invalidType(name, "of type number", value);
  if (!Number.isInteger(value) || value < min || value > max)
    throw Object.assign(
      new RangeError(`The value of "${name}" is out of range. It must be >= ${min} and <= ${max}. Received ${value}`),
      { code: "ERR_OUT_OF_RANGE" },
    );
}

function lastError(what: string): Error & { code: number } {
  const status = win32.lastError(what).status ?? 0;
  return Object.assign(new Error(`${what} failed: Win32 error ${status}`), { code: status });
}

let kernelSymbols: ReturnType<typeof loadKernel> | undefined;
function loadKernel() {
  return dlopen("kernel32.dll", {
    GetActiveProcessorCount: { args: [FFIType.u16], returns: FFIType.u32 },
    GetTickCount64: { args: [], returns: FFIType.u64 },
    GetComputerNameW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    GetCurrentProcess: { args: [], returns: FFIType.u64 },
    IsWow64Process2: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    TerminateProcess: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
    SetProcessAffinityMask: { args: [FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    SetPriorityClass: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
    SetProcessInformation: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    SetProcessWorkingSetSize: { args: [FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    GlobalAlloc: { args: [FFIType.u32, FFIType.u64], returns: FFIType.u64 },
    GlobalFree: { args: [FFIType.u64], returns: FFIType.u64 },
    GlobalLock: { args: [FFIType.u64], returns: FFIType.ptr },
    GlobalUnlock: { args: [FFIType.u64], returns: FFIType.i32 },
    GlobalSize: { args: [FFIType.u64], returns: FFIType.u64 },
    Sleep: { args: [FFIType.u32], returns: FFIType.void },
  }).symbols;
}
const kernel = () => (kernelSymbols ??= loadKernel());

let userSymbols: ReturnType<typeof loadUser> | undefined;
function loadUser() {
  return dlopen("user32.dll", {
    OpenClipboard: { args: [FFIType.u64], returns: FFIType.i32 },
    CloseClipboard: { args: [], returns: FFIType.i32 },
    EmptyClipboard: { args: [], returns: FFIType.i32 },
    GetClipboardData: { args: [FFIType.u32], returns: FFIType.u64 },
    SetClipboardData: { args: [FFIType.u32, FFIType.u64], returns: FFIType.u64 },
    IsClipboardFormatAvailable: { args: [FFIType.u32], returns: FFIType.i32 },
  }).symbols;
}
const user = () => (userSymbols ??= loadUser());

let advapiSymbols: ReturnType<typeof loadAdvapi> | undefined;
function loadAdvapi() {
  return dlopen("advapi32.dll", { GetUserNameW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 } }).symbols;
}

function wideName(call: (buffer: Uint8Array, length: Uint32Array) => number): string {
  const buffer = new Uint8Array(257 * 2);
  const length = new Uint32Array([257]);
  if (!call(buffer, length)) return "";
  const text = Buffer.from(buffer).toString("utf16le");
  const nul = text.indexOf("\0");
  return nul < 0 ? text : text.slice(0, nul);
}

// system

const MACHINES: Record<number, string> = { 0x14c: "ia32", 0x8664: "x64", 0xaa64: "arm64", 0x1c4: "arm" };
const CURRENT_VERSION = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
const PERSONALIZE = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

function architectures(): { arch: string; nativeArch: string } {
  const processMachine = new Uint16Array(1);
  const nativeMachine = new Uint16Array(1);
  const k = kernel();
  if (!k.IsWow64Process2(k.GetCurrentProcess(), ptr(processMachine), ptr(nativeMachine)))
    return { arch: process.arch, nativeArch: process.arch };
  const nativeArch = MACHINES[nativeMachine[0]!] ?? process.arch;
  // IMAGE_FILE_MACHINE_UNKNOWN: not a WOW64 process, it runs as the native machine (or under x64 emulation).
  return { arch: processMachine[0] ? (MACHINES[processMachine[0]] ?? process.arch) : process.arch, nativeArch };
}

export interface WindowsVersionInfo {
  major: number;
  minor: number;
  build: number;
  ubr: number;
  version: string;
  displayVersion: string;
  productName: string;
  edition: string;
  installationType: string;
  isWindows11: boolean;
  arch: string;
  nativeArch: string;
}

let cachedVersion: Readonly<WindowsVersionInfo> | undefined;

export function version(): Readonly<WindowsVersionInfo> {
  ensureSupported();
  if (cachedVersion) return cachedVersion;
  const { major, minor, build, isWindows11 } = win32.version();
  const values = new Map(
    (registryOwner.list(CURRENT_VERSION)?.values ?? []).map(entry => [entry.name.toLowerCase(), entry.value]),
  );
  const text = (name: string) => {
    const value = values.get(name.toLowerCase());
    return typeof value === "string" ? value : "";
  };
  const ubrValue = values.get("ubr");
  const ubr = typeof ubrValue === "number" ? ubrValue : 0;
  let productName = text("ProductName");
  // The registry kept "Windows 10" in ProductName on Windows 11.
  if (isWindows11 && productName.startsWith("Windows 10")) productName = `Windows 11${productName.slice(10)}`;
  cachedVersion = Object.freeze({
    major,
    minor,
    build,
    ubr,
    version: `${major}.${minor}.${build}.${ubr}`,
    displayVersion: text("DisplayVersion"),
    productName,
    edition: text("EditionID"),
    installationType: text("InstallationType"),
    isWindows11,
    ...architectures(),
  });
  return cachedVersion;
}

export function isWindows11(): boolean {
  return isSupported && version().isWindows11;
}

export interface SystemInfo {
  computerName: string;
  userName: string;
  processors: number;
  totalMemory: number;
  freeMemory: number;
  memoryLoad: number;
  /** Milliseconds since boot. */
  uptime: number;
  /** The apps theme. */
  theme: "dark" | "light";
}

export function systemInfo(): SystemInfo {
  ensureSupported();
  const k = kernel();
  advapiSymbols ??= loadAdvapi();
  const advapi = advapiSymbols;
  const mem = win32.memory();
  const light = registryOwner.get(PERSONALIZE, "AppsUseLightTheme")?.value;
  return {
    computerName: wideName((buffer, length) => k.GetComputerNameW(ptr(buffer), ptr(length))),
    userName: wideName((buffer, length) => advapi.GetUserNameW(ptr(buffer), ptr(length))),
    // ALL_PROCESSOR_GROUPS
    processors: k.GetActiveProcessorCount(0xffff),
    totalMemory: Number(mem.totalPhys),
    freeMemory: Number(mem.availPhys),
    memoryLoad: mem.loadPercent,
    uptime: Number(k.GetTickCount64()),
    theme: light === 0 ? "dark" : "light",
  };
}

export function isElevated(): boolean {
  ensureSupported();
  return win32.isElevated();
}

function memoryStatus() {
  ensureSupported();
  const mem = win32.memory();
  return {
    memoryLoad: mem.loadPercent,
    totalPhysical: Number(mem.totalPhys),
    availablePhysical: Number(mem.availPhys),
    totalPageFile: Number(mem.totalPageFile),
    availablePageFile: Number(mem.availPageFile),
    totalVirtual: Number(mem.totalVirtual),
    availableVirtual: Number(mem.availVirtual),
  };
}

export const memory = Object.freeze({ status: memoryStatus });

// registry: the @aphrody/windows owner with the fork's argument rules (type inference, Buffer binaries, views).

const registryTypes = {
  REG_NONE: 0,
  REG_SZ: 1,
  REG_EXPAND_SZ: 2,
  REG_BINARY: 3,
  REG_DWORD: 4,
  REG_MULTI_SZ: 7,
  REG_QWORD: 11,
} as const;
const TYPE_NAMES = Object.fromEntries(Object.entries(registryTypes).map(([name, id]) => [id, name]));

type RegistryOptions = registryOwner.RegistryOptions;

function rootOf(path: unknown): string {
  validateString(path, "path");
  let normalized = path.replaceAll("/", "\\");
  if (normalized.startsWith("Registry::")) normalized = normalized.slice(10);
  const sep = normalized.indexOf("\\");
  let root = (sep === -1 ? normalized : normalized.slice(0, sep)).toUpperCase();
  if (root.endsWith(":")) root = root.slice(0, -1);
  if (!/^(HKCR|HKCU|HKLM|HKU|HKCC|HKEY_(CLASSES_ROOT|CURRENT_USER|LOCAL_MACHINE|USERS|CURRENT_CONFIG))$/.test(root))
    throw invalid("path", path, "must start with a registry root such as HKCU or HKLM");
  let subKey = sep === -1 ? "" : normalized.slice(sep + 1);
  while (subKey.endsWith("\\")) subKey = subKey.slice(0, -1);
  return subKey ? `${root}\\${subKey}` : root;
}

function decode<T extends { type: string; value: registryOwner.RegistryData }>(entry: T): T {
  if (entry.value instanceof Uint8Array) entry.value = Buffer.from(entry.value);
  return entry;
}

function registryGet(path: string, name = "", options?: RegistryOptions) {
  ensureSupported();
  validateString(name, "name");
  const found = registryOwner.get(rootOf(path), name, options);
  return found ? decode(found) : null;
}

function registrySet(
  path: string,
  name: string,
  value: registryOwner.RegistryData | ArrayBuffer,
  type?: keyof typeof registryTypes | number,
  options?: RegistryOptions,
) {
  ensureSupported();
  const key = rootOf(path);
  validateString(name, "name");
  if (value instanceof ArrayBuffer) value = new Uint8Array(value);
  else if (ArrayBuffer.isView(value) && !(value instanceof Uint8Array))
    value = new Uint8Array(
      (value as ArrayBufferView).buffer,
      (value as ArrayBufferView).byteOffset,
      (value as ArrayBufferView).byteLength,
    );
  let typeName: string | undefined;
  if (type === undefined) {
    if (typeof value === "string") typeName = "REG_SZ";
    else if (typeof value === "number") typeName = "REG_DWORD";
    else if (typeof value === "bigint") typeName = "REG_QWORD";
    else if (Array.isArray(value)) typeName = "REG_MULTI_SZ";
    else if (value instanceof Uint8Array) typeName = "REG_BINARY";
  } else typeName = typeof type === "number" ? TYPE_NAMES[type] : type in registryTypes ? type : undefined;
  if (typeName === undefined) {
    if (type === undefined) throw invalidType("value", "one of string, number, bigint, string[] or Uint8Array", value);
    throw invalid("type", type, "is not a writable registry type");
  }
  switch (typeName) {
    case "REG_SZ":
    case "REG_EXPAND_SZ":
      validateString(value, "value");
      break;
    case "REG_MULTI_SZ":
      if (!Array.isArray(value)) throw invalidType("value", "a string[]", value);
      value.forEach((item, i) => {
        validateString(item, `value[${i}]`);
        if (item.length === 0 || item.includes("\0"))
          throw invalid(`value[${i}]`, item, "must be non-empty and contain no NUL");
      });
      break;
    case "REG_DWORD":
      validateInteger(value, "value", 0, MAX_UINT32);
      break;
    case "REG_QWORD": {
      const big = typeof value === "bigint" ? value : Number.isInteger(value) ? BigInt(value as number) : undefined;
      if (big === undefined || big < 0n || big > 0xffffffffffffffffn)
        throw Object.assign(new RangeError(`The value of "value" is out of range. It must be >= 0 and <= 2^64 - 1`), {
          code: "ERR_OUT_OF_RANGE",
        });
      value = big;
      break;
    }
    default:
      if (!(value instanceof Uint8Array)) throw invalidType("value", "a Uint8Array or ArrayBuffer", value);
  }
  registryOwner.set(key, name, value, typeName, options);
}

function registryCreateKey(path: string, options?: RegistryOptions) {
  ensureSupported();
  registryOwner.createKey(rootOf(path), options);
}

function registryDeleteValue(path: string, name: string, options?: RegistryOptions) {
  ensureSupported();
  validateString(name, "name");
  return registryOwner.deleteValue(rootOf(path), name, options);
}

function registryDeleteKey(path: string, options?: RegistryOptions & { recursive?: boolean }) {
  ensureSupported();
  const key = rootOf(path);
  if (!key.includes("\\")) throw invalid("path", path, "must not be a registry root");
  const recursive = options?.recursive ?? false;
  if (typeof recursive !== "boolean") throw invalidType("options.recursive", "of type boolean", recursive);
  const listing = registryOwner.list(key, options);
  if (listing === null) return false;
  if (!recursive && listing.keys.length > 0) {
    const error = new Error(`RegDeleteKeyExW(${path}) failed: the key has subkeys`) as Error & { code: number };
    error.code = 5;
    throw error;
  }
  return registryOwner.deleteKey(key, options);
}

function registryList(path: string, options?: RegistryOptions) {
  ensureSupported();
  const listing = registryOwner.list(rootOf(path), options);
  if (listing) for (const value of listing.values) decode(value);
  return listing;
}

export const registry = Object.freeze({
  types: Object.freeze({ ...registryTypes }),
  get: registryGet,
  set: registrySet,
  createKey: registryCreateKey,
  deleteValue: registryDeleteValue,
  deleteKey: registryDeleteKey,
  list: registryList,
});

// services: read-only, the @aphrody/windows owner.

export const services = Object.freeze({
  list(): servicesOwner.ServiceInfo[] {
    ensureSupported();
    return servicesOwner.list();
  },
  get(name: string): servicesOwner.ServiceInfo | null {
    ensureSupported();
    validateString(name, "name");
    return servicesOwner.get(name);
  },
});

// clipboard (CF_UNICODETEXT)

const CF_UNICODETEXT = 13;

function withClipboard<T>(body: () => T): T {
  const u = user();
  let opened = false;
  // Another process may hold the clipboard for a moment.
  for (let attempt = 0; attempt < 20 && !opened; attempt++) {
    opened = u.OpenClipboard(0n) !== 0;
    if (!opened) kernel().Sleep(10);
  }
  if (!opened) throw lastError("OpenClipboard");
  try {
    return body();
  } finally {
    u.CloseClipboard();
  }
}

export const clipboard = Object.freeze({
  /** The clipboard text, or null when it holds no text. */
  readText(): string | null {
    ensureSupported();
    return withClipboard(() => {
      const u = user();
      if (!u.IsClipboardFormatAvailable(CF_UNICODETEXT)) return null;
      const handle = u.GetClipboardData(CF_UNICODETEXT);
      if (!handle) throw lastError("GetClipboardData");
      const k = kernel();
      const data = k.GlobalLock(handle);
      if (!data) throw lastError("GlobalLock");
      try {
        const units = Math.floor(Number(k.GlobalSize(handle)) / 2);
        let length = 0;
        while (length < units && read.u16(data, length * 2) !== 0) length++;
        return length ? Buffer.from(toArrayBuffer(data, 0, length * 2)).toString("utf16le") : "";
      } finally {
        k.GlobalUnlock(handle);
      }
    });
  },
  writeText(text: string): void {
    ensureSupported();
    validateString(text, "text");
    const bytes = Buffer.from(`${text}\0`, "utf16le");
    const k = kernel();
    const GMEM_MOVEABLE = 0x2;
    const handle = k.GlobalAlloc(GMEM_MOVEABLE, BigInt(bytes.length));
    if (!handle) throw lastError("GlobalAlloc");
    let owned = true;
    try {
      const data = k.GlobalLock(handle);
      if (!data) throw lastError("GlobalLock");
      new Uint8Array(toArrayBuffer(data, 0, bytes.length)).set(bytes);
      k.GlobalUnlock(handle);
      withClipboard(() => {
        const u = user();
        u.EmptyClipboard();
        if (!u.SetClipboardData(CF_UNICODETEXT, handle)) throw lastError("SetClipboardData");
        owned = false;
      });
    } finally {
      if (owned) k.GlobalFree(handle);
    }
  },
  clear(): void {
    ensureSupported();
    withClipboard(() => {
      if (!user().EmptyClipboard()) throw lastError("EmptyClipboard");
    });
  },
});

// known folders

export const knownFolders = Object.freeze({
  Desktop: "B4BFCC3A-DB2C-424C-B029-7FE99A87C641",
  Documents: "FDD39AD0-238F-46AF-ADB4-6C85480369C7",
  Downloads: "374DE290-123F-4565-9164-39C4925E467B",
  Music: "4BD8D571-6D19-48D3-BE97-422220080E43",
  Pictures: "33E28130-4E1E-4676-835A-98395C3BC3BB",
  Videos: "18989B1D-99B5-455B-841C-AB7C74E4DDFC",
  Profile: "5E6C858F-0E22-4760-9AFE-EA3317B67173",
  LocalAppData: "F1B32785-6FBA-4FCF-9D55-7B8E7F157091",
  RoamingAppData: "3EB685DB-65F9-4CF6-A03A-E3EF65729F3D",
  LocalAppDataLow: "A520A1A4-1780-4FF6-BD18-167343C5AF16",
  ProgramData: "62AB5D82-FDC1-4DC3-A9DD-070D1D495D97",
  ProgramFiles: "905E63B6-C1BF-494E-B29C-65B732D3D21A",
  ProgramFilesX86: "7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E",
  ProgramFilesCommon: "F7F1ED05-9F6D-47A2-AAAE-29D317C6F066",
  Windows: "F38BF404-1D43-42F2-9305-67DE0B28FC23",
  System: "1AC14E77-02E7-4E5D-B744-2EB1AE5198B7",
  Fonts: "FD228CB7-AE11-4AE3-864C-16F3910AB8FE",
  StartMenu: "625B53C3-AB48-4EC1-BA1F-A1EF4146FC19",
  Startup: "B97D20BB-F46A-4C97-BA10-5E3608430854",
  Templates: "A63293E8-664E-48DB-A079-DF759E0509F7",
  SavedGames: "4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4",
  UserProgramFiles: "5CD7AEE2-2219-4A67-B85D-6C9CE15660CB",
  Public: "DFDF76A2-C82A-4D63-906A-5644AC457385",
});

export function knownFolder(nameOrGuid: keyof typeof knownFolders | (string & {})): string {
  ensureSupported();
  validateString(nameOrGuid, "name");
  const id = Object.hasOwn(knownFolders, nameOrGuid)
    ? knownFolders[nameOrGuid as keyof typeof knownFolders]
    : nameOrGuid;
  return shell.knownFolder(id);
}

// processes

const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_SET_INFORMATION = 0x0200;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function pidOf(target: unknown, name: string): number {
  const pid = typeof target === "object" && target !== null ? (target as { pid: unknown }).pid : target;
  validateInteger(pid, name, 0, MAX_UINT32);
  return pid;
}

function withProcess(pid: number, access: number, what: string, body: (handle: bigint) => number): void {
  const k = kernel();
  const handle = k.OpenProcess(access, 0, pid);
  if (!handle) throw lastError(`OpenProcess(${pid})`);
  try {
    if (!body(handle)) throw lastError(what);
  } finally {
    k.CloseHandle(handle);
  }
}

const PRIORITY_CLASSES = {
  idle: 0x40,
  "below-normal": 0x4000,
  normal: 0x20,
  "above-normal": 0x8000,
  high: 0x80,
  realtime: 0x100,
} as const;

export const processes = Object.freeze({
  list(): { pid: number; ppid: number; name: string; threads: number }[] {
    ensureSupported();
    return win32.processes().map(p => ({ pid: p.pid, ppid: p.parentPid, name: p.name, threads: p.threads }));
  },
  path(pid: number | { pid: number }): string | null {
    ensureSupported();
    return win32.processPath(pidOf(pid, "pid"));
  },
  terminate(pid: number | { pid: number }, exitCode = 1): void {
    ensureSupported();
    validateInteger(exitCode, "exitCode", 0, MAX_UINT32);
    withProcess(pidOf(pid, "pid"), PROCESS_TERMINATE, "TerminateProcess", h => kernel().TerminateProcess(h, exitCode));
  },
  setAffinity(pid: number | { pid: number }, mask: number): void {
    ensureSupported();
    validateInteger(mask, "mask", 1, Number.MAX_SAFE_INTEGER);
    withProcess(
      pidOf(pid, "pid"),
      PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION,
      "SetProcessAffinityMask",
      h => kernel().SetProcessAffinityMask(h, BigInt(mask)),
    );
  },
  setPriority(pid: number | { pid: number }, priority: keyof typeof PRIORITY_CLASSES): void {
    ensureSupported();
    const priorityClass = PRIORITY_CLASSES[priority];
    if (priorityClass === undefined)
      throw invalid("priority", priority, `must be one of ${Object.keys(PRIORITY_CLASSES).join(", ")}`);
    withProcess(pidOf(pid, "pid"), PROCESS_SET_INFORMATION, "SetPriorityClass", h =>
      kernel().SetPriorityClass(h, priorityClass),
    );
  },
  /** EcoQoS: PROCESS_POWER_THROTTLING_EXECUTION_SPEED on or off. */
  setEcoMode(pid: number | { pid: number }, enabled: boolean): void {
    ensureSupported();
    if (typeof enabled !== "boolean") throw invalidType("enabled", "of type boolean", enabled);
    const state = new Uint32Array([1, 1, enabled ? 1 : 0]);
    withProcess(pidOf(pid, "pid"), PROCESS_SET_INFORMATION, "SetProcessInformation", h =>
      kernel().SetProcessInformation(h, 4, ptr(state), state.byteLength),
    );
  },
  trimWorkingSet(pid: number | { pid: number }): void {
    ensureSupported();
    withProcess(
      pidOf(pid, "pid"),
      PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION,
      "SetProcessWorkingSetSize",
      h => kernel().SetProcessWorkingSetSize(h, 0xffffffffffffffffn, 0xffffffffffffffffn),
    );
  },
});

// PE / Authenticode: the fork's pure byte parsers; nothing is mapped or executed.

function bytesOf(bytes: unknown): Uint8Array {
  if (!ArrayBuffer.isView(bytes)) throw invalidType("bytes", "a Uint8Array", bytes);
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export const pe = Object.freeze({
  parse(bytes: ArrayBufferView, fileName = "") {
    validateString(fileName, "fileName");
    return peReader.parsePe(peReader.memorySource(bytesOf(bytes)), fileName);
  },
  looksLikePe: (bytes: ArrayBufferView) => peReader.looksLikePe(bytesOf(bytes)),
  /** ApiSet schema v6 (`.apiset` section of apisetschema.dll): contract -> host modules. */
  parseApiSetSchema: (bytes: ArrayBufferView) => peReader.parseApiSetSchema(bytesOf(bytes)),
  /** `api-ms-win-core-file-l1-2-4.dll` -> `api-ms-win-core-file-l1-2`. */
  apiSetKey(moduleName: string) {
    validateString(moduleName, "moduleName");
    return peReader.apiSetKey(moduleName);
  },
  authenticode: Object.freeze({
    parse: (bytes: ArrayBufferView) => authenticode.parseAuthenticode(bytesOf(bytes)),
    parseSignedData: (bytes: ArrayBufferView) => authenticode.parseSignedData(bytesOf(bytes)),
  }),
});

const windows = {
  isSupported,
  version,
  isWindows11,
  systemInfo,
  isElevated,
  registry,
  services,
  clipboard,
  knownFolders,
  knownFolder,
  processes,
  memory,
  pe,
};

export default windows;
