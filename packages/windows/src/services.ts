// SPDX-License-Identifier: Apache-2.0
// Windows services, read-only: Service Control Manager enumeration and status through advapi32.
// Starting, stopping and installing services are deliberately not exposed here.
import { dlopen, FFIType, ptr, read } from "bun:ffi";
import { assertWindows, WindowsError } from "./errors";
import { readWide, wide } from "./ffi";
import { lastError } from "./win32";

export type ServiceState =
  "stopped" | "start-pending" | "stop-pending" | "running" | "continue-pending" | "pause-pending" | "paused";

export interface ServiceInfo {
  name: string;
  displayName: string;
  state: ServiceState;
  pid: number;
}

// SERVICE_STOPPED is 1; index 0 is unused.
const STATES: ServiceState[] = [
  "stopped",
  "stopped",
  "start-pending",
  "stop-pending",
  "running",
  "continue-pending",
  "pause-pending",
  "paused",
];

const load = () =>
  dlopen("advapi32.dll", {
    OpenSCManagerW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u64 },
    OpenServiceW: { args: [FFIType.u64, FFIType.ptr, FFIType.u32], returns: FFIType.u64 },
    CloseServiceHandle: { args: [FFIType.u64], returns: FFIType.bool },
    EnumServicesStatusExW: {
      args: [
        FFIType.u64,
        FFIType.i32,
        FFIType.u32,
        FFIType.u32,
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.bool,
    },
    QueryServiceStatusEx: {
      args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.bool,
    },
  }).symbols;

let api: ReturnType<typeof load> | undefined;

const stateOf = (code: number): ServiceState => STATES[code] ?? "stopped";

/** All Win32 services (SERVICE_WIN32, any state). */
export function list(): ServiceInfo[] {
  assertWindows();
  api ??= load();
  const scm = api.OpenSCManagerW(null, null, 0x4);
  if (!scm) throw lastError("OpenSCManager");
  try {
    let size = 1 << 17;
    for (;;) {
      const buffer = Buffer.alloc(size);
      const needed = new Uint32Array(1);
      const returned = new Uint32Array(1);
      const resume = new Uint32Array(1);
      const ok = api.EnumServicesStatusExW(
        scm,
        0,
        0x30,
        3,
        ptr(buffer),
        size,
        ptr(needed),
        ptr(returned),
        ptr(resume),
        null,
      );
      if (!ok && returned[0] === 0 && needed[0]! > 0) {
        size = needed[0]! + 4096;
        continue;
      }
      if (!ok && resume[0] === 0) throw lastError("EnumServicesStatusEx");
      if (!ok) throw new WindowsError("ERR_WINDOWS_WIN32", "service list exceeds one enumeration batch");
      const base = ptr(buffer);
      const out: ServiceInfo[] = [];
      for (let i = 0; i < returned[0]!; i++) {
        const at = i * 56;
        out.push({
          name: readWide(read.ptr(base, at)),
          displayName: readWide(read.ptr(base, at + 8)),
          state: stateOf(buffer.readUInt32LE(at + 20)),
          pid: buffer.readUInt32LE(at + 44),
        });
      }
      return out;
    }
  } finally {
    api.CloseServiceHandle(scm);
  }
}

/** Status of one service, or null when it does not exist. */
export function get(name: string): ServiceInfo | null {
  assertWindows();
  api ??= load();
  const scm = api.OpenSCManagerW(null, null, 0x1);
  if (!scm) throw lastError("OpenSCManager");
  try {
    const service = api.OpenServiceW(scm, ptr(wide(name)), 0x4);
    if (!service) return null;
    try {
      const status = Buffer.alloc(36);
      const needed = new Uint32Array(1);
      if (!api.QueryServiceStatusEx(service, 0, ptr(status), 36, ptr(needed))) throw lastError("QueryServiceStatusEx");
      return { name, displayName: name, state: stateOf(status.readUInt32LE(4)), pid: status.readUInt32LE(28) };
    } finally {
      api.CloseServiceHandle(service);
    }
  } finally {
    api.CloseServiceHandle(scm);
  }
}
