// SPDX-License-Identifier: MIT
/**
 * Process-group ownership for Chromium launches, replacing the fork's `require("bun:linux")` and
 * `require("bun:windows").Job`:
 *
 * - Linux: `pidfd_open(2)` and `pidfd_send_signal(2)` with `PIDFD_SIGNAL_PROCESS_GROUP` (Linux 6.9)
 *   through libc `syscall()` and bun:ffi. A retained pidfd names the group even after its leader
 *   is reaped, so PID reuse cannot redirect the kill.
 * - Windows: the `bun:windows` `Job` (kill-on-close job object) when the @aphrody/windows plugin
 *   provides it; otherwise the launcher falls back to `Bun.spawn` and `proc.kill()`.
 */
import { dlopen, FFIType } from "bun:ffi";
import { constants as osConstants } from "node:os";

const SYS = {
  x64: { pidfd_open: 434, pidfd_send_signal: 424 },
  arm64: { pidfd_open: 434, pidfd_send_signal: 424 },
  riscv64: { pidfd_open: 434, pidfd_send_signal: 424 },
} as Record<string, { pidfd_open: number; pidfd_send_signal: number } | undefined>;

const constants = Object.freeze({
  PIDFD_SIGNAL_THREAD: 1,
  PIDFD_SIGNAL_THREAD_GROUP: 2,
  PIDFD_SIGNAL_PROCESS_GROUP: 4,
});

const ERRNO: Record<number, string> = { 1: "EPERM", 3: "ESRCH", 9: "EBADF", 22: "EINVAL", 38: "ENOSYS" };

export interface LinuxProcessGroup {
  constants: typeof constants;
  pidfdOpen(pid: number): number;
  pidfdForProcess(proc: { pid: number }): number | null;
  pidfdSendSignal(pidfd: number, signal: number | string, flags?: number): void;
}

let cached: LinuxProcessGroup | undefined;

export function linuxProcessGroup(): LinuxProcessGroup {
  if (cached) return cached;
  const numbers = SYS[process.arch];
  if (!numbers) throw new Error(`pidfd syscalls are not mapped for ${process.arch}`);
  const libc = dlopen("libc.so.6", {
    syscall: { args: [FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64], returns: FFIType.i64 },
    __errno_location: { args: [], returns: FFIType.ptr },
  }).symbols;
  const { read } = require("bun:ffi") as typeof import("bun:ffi");
  const fail = (call: string): never => {
    const errno = read.i32(libc.__errno_location()!, 0);
    const code = ERRNO[errno] ?? `E${errno}`;
    throw Object.assign(new Error(`${call} failed: ${code}`), { code, errno });
  };
  const signalNumber = (signal: number | string): number => {
    if (typeof signal === "number") return signal;
    const value = (osConstants.signals as Record<string, number>)[signal];
    if (value === undefined) throw new TypeError(`unknown signal ${signal}`);
    return value;
  };
  cached = {
    constants,
    pidfdOpen(pid) {
      const fd = Number(libc.syscall(numbers.pidfd_open, pid, 0, 0, 0));
      return fd < 0 ? fail("pidfd_open") : fd;
    },
    pidfdForProcess(proc) {
      return Number.isSafeInteger(proc?.pid) ? cached!.pidfdOpen(proc.pid) : null;
    },
    pidfdSendSignal(pidfd, signal, flags = 0) {
      const rc = Number(libc.syscall(numbers.pidfd_send_signal, pidfd, signalNumber(signal), 0, flags));
      if (rc < 0) fail("pidfd_send_signal");
    },
  };
  return cached;
}

interface WindowsJob {
  setLimits(limits: { killOnClose: boolean }): void;
  spawn(args: string[], options: object): Bun.Subprocess<"ignore", "ignore", "pipe">;
  terminate(): void;
  close(): void;
}

export function windowsJob(): WindowsJob | undefined {
  try {
    const windows = require("bun:windows") as {
      Job?: new (name?: string) => WindowsJob;
      default?: { Job?: new (name?: string) => WindowsJob };
    };
    const Job = windows.Job ?? windows.default?.Job;
    return Job ? new Job(undefined) : undefined;
  } catch {
    return undefined;
  }
}
