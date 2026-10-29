// SPDX-License-Identifier: Apache-2.0
// Win32 through bun:ffi: no build step, works in `bun build --compile`. Read-only facts and process queries.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { assertWindows, WindowsError } from "./errors";
import { fixedWide } from "./ffi";

export interface WindowsVersion {
  major: number;
  minor: number;
  build: number;
  /** Windows 11 starts at build 22000. */
  isWindows11: boolean;
}

export interface ProcessEntry {
  pid: number;
  parentPid: number;
  threads: number;
  name: string;
}

export interface MemoryStatus {
  loadPercent: number;
  totalPhys: bigint;
  availPhys: bigint;
  totalPageFile: bigint;
  availPageFile: bigint;
  totalVirtual: bigint;
  availVirtual: bigint;
}

export interface Volume {
  root: string;
  type: "removable" | "fixed" | "remote" | "cdrom" | "ramdisk" | "unknown";
  totalBytes: bigint;
  freeBytes: bigint;
  availableBytes: bigint;
}

const loadKernel = () =>
  dlopen("kernel32.dll", {
    GetLastError: { args: [], returns: FFIType.u32 },
    GetCurrentProcess: { args: [], returns: FFIType.u64 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.bool },
    CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u64 },
    Process32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
    Process32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
    OpenProcess: { args: [FFIType.u32, FFIType.bool, FFIType.u32], returns: FFIType.u64 },
    QueryFullProcessImageNameW: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
    GlobalMemoryStatusEx: { args: [FFIType.ptr], returns: FFIType.bool },
    GetLogicalDrives: { args: [], returns: FFIType.u32 },
    GetTickCount64: { args: [], returns: FFIType.u64 },
    GetDriveTypeW: { args: [FFIType.ptr], returns: FFIType.u32 },
    GetDiskFreeSpaceExW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
  }).symbols;

const loadNt = () => dlopen("ntdll.dll", { RtlGetVersion: { args: [FFIType.ptr], returns: FFIType.i32 } }).symbols;

const loadAdvapi = () =>
  dlopen("advapi32.dll", {
    OpenProcessToken: { args: [FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.bool },
    GetTokenInformation: {
      args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.bool,
    },
  }).symbols;

let kernel: ReturnType<typeof loadKernel> | undefined;
let ntdll: ReturnType<typeof loadNt> | undefined;
let advapi: ReturnType<typeof loadAdvapi> | undefined;

const k32 = () => (assertWindows(), (kernel ??= loadKernel()));

/** Last Win32 error of the calling thread as a typed error. */
export function lastError(what: string): WindowsError {
  const code = k32().GetLastError();
  return new WindowsError("ERR_WINDOWS_WIN32", `${what} failed with Win32 error ${code}`, code);
}

/** Real OS version from RtlGetVersion (GetVersionEx lies without a manifest). */
export function version(): WindowsVersion {
  assertWindows();
  ntdll ??= loadNt();
  const info = Buffer.alloc(284);
  info.writeUInt32LE(284, 0);
  const status = ntdll.RtlGetVersion(ptr(info));
  if (status !== 0) throw new WindowsError("ERR_WINDOWS_HRESULT", `RtlGetVersion returned ${status}`, status);
  const build = info.readUInt32LE(12);
  return { major: info.readUInt32LE(4), minor: info.readUInt32LE(8), build, isWindows11: build >= 22000 };
}

/** True when the current process token is elevated (TokenElevation). */
export function isElevated(): boolean {
  const kernel32 = k32();
  advapi ??= loadAdvapi();
  const token = new BigUint64Array(1);
  if (!advapi.OpenProcessToken(kernel32.GetCurrentProcess(), 0x8, ptr(token))) throw lastError("OpenProcessToken");
  try {
    const out = Buffer.alloc(4);
    const size = Buffer.alloc(4);
    if (!advapi.GetTokenInformation(token[0]!, 20, ptr(out), 4, ptr(size))) throw lastError("GetTokenInformation");
    return out.readUInt32LE(0) !== 0;
  } finally {
    kernel32.CloseHandle(token[0]!);
  }
}

/** Snapshot of running processes (Toolhelp). */
export function processes(): ProcessEntry[] {
  const kernel32 = k32();
  const snapshot = kernel32.CreateToolhelp32Snapshot(0x2, 0);
  if (snapshot === 0xffffffffffffffffn) throw lastError("CreateToolhelp32Snapshot");
  try {
    const entry = Buffer.alloc(568);
    entry.writeUInt32LE(568, 0);
    const out: ProcessEntry[] = [];
    for (
      let ok = kernel32.Process32FirstW(snapshot, ptr(entry));
      ok;
      ok = kernel32.Process32NextW(snapshot, ptr(entry))
    ) {
      out.push({
        pid: entry.readUInt32LE(8),
        threads: entry.readUInt32LE(28),
        parentPid: entry.readUInt32LE(32),
        name: fixedWide(entry, 44, 260),
      });
    }
    return out;
  } finally {
    kernel32.CloseHandle(snapshot);
  }
}

/** Full image path of a process, or null when it cannot be opened (access denied, exited). */
export function processPath(pid: number): string | null {
  const kernel32 = k32();
  const handle = kernel32.OpenProcess(0x1000, false, pid);
  if (!handle) return null;
  try {
    const chars = new Uint32Array([32768]);
    const buffer = Buffer.alloc(32768 * 2);
    if (!kernel32.QueryFullProcessImageNameW(handle, 0, ptr(buffer), ptr(chars))) return null;
    return buffer.subarray(0, chars[0]! * 2).toString("utf16le");
  } finally {
    kernel32.CloseHandle(handle);
  }
}

export function memory(): MemoryStatus {
  const status = Buffer.alloc(64);
  status.writeUInt32LE(64, 0);
  if (!k32().GlobalMemoryStatusEx(ptr(status))) throw lastError("GlobalMemoryStatusEx");
  return {
    loadPercent: status.readUInt32LE(4),
    totalPhys: status.readBigUInt64LE(8),
    availPhys: status.readBigUInt64LE(16),
    totalPageFile: status.readBigUInt64LE(24),
    availPageFile: status.readBigUInt64LE(32),
    totalVirtual: status.readBigUInt64LE(40),
    availVirtual: status.readBigUInt64LE(48),
  };
}

/** Drive letters present, such as ["C:", "D:"]. */
export function drives(): string[] {
  const mask = k32().GetLogicalDrives();
  return Array.from({ length: 26 }, (_, i) => (mask & (1 << i) ? `${String.fromCharCode(65 + i)}:` : "")).filter(
    Boolean,
  );
}

/** Milliseconds since boot. */
export function uptimeMs(): bigint {
  return k32().GetTickCount64();
}

const DRIVE_TYPES: Record<number, Volume["type"]> = { 2: "removable", 3: "fixed", 4: "remote", 5: "cdrom", 6: "ramdisk" };

/** Logical drives with type and capacity. */
export function volumes(): Volume[] {
  const kernel32 = k32();
  return drives().map(letter => {
    const rootPath = `${letter}\\`;
    const root = Buffer.from(`${rootPath}\0`, "utf16le");
    const available = new BigUint64Array(1);
    const total = new BigUint64Array(1);
    const free = new BigUint64Array(1);
    const ok = kernel32.GetDiskFreeSpaceExW(ptr(root), ptr(available), ptr(total), ptr(free));
    return {
      root: rootPath,
      type: DRIVE_TYPES[kernel32.GetDriveTypeW(ptr(root))] ?? "unknown",
      totalBytes: ok ? total[0]! : 0n,
      freeBytes: ok ? free[0]! : 0n,
      availableBytes: ok ? available[0]! : 0n,
    };
  });
}
