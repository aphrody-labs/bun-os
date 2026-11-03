// SPDX-License-Identifier: Apache-2.0
// bun:ffi client of bunos.sys (crates/bunos-nt-driver): CreateFileW + DeviceIoControl on \\.\BunOS. Same contract
// as the windows-rs client crates/bunos-nt-client; the control codes are pinned by test/nt-driver.test.ts.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { assertWindows, WindowsError } from "./errors";
import { wide } from "./ffi";

export const DEVICE_PATH = "\\\\.\\BunOS";
const FILE_DEVICE_UNKNOWN = 0x22;
/** `CTL_CODE(FILE_DEVICE_UNKNOWN, fn, METHOD_BUFFERED, FILE_ANY_ACCESS)`. */
export const ctlCode = (fn: number): number => ((FILE_DEVICE_UNKNOWN << 16) | (fn << 2)) >>> 0;
export const IOCTL_BUNOS_VERSION = ctlCode(0x800);
export const IOCTL_BUNOS_PING = ctlCode(0x801);

const GENERIC_READ_WRITE = 0xc000_0000;
const OPEN_EXISTING = 3;
const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn;
const ERROR_FILE_NOT_FOUND = 2;

const load = () =>
  dlopen("kernel32.dll", {
    CreateFileW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u64],
      returns: FFIType.u64,
    },
    DeviceIoControl: {
      args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.bool,
    },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.bool },
    GetLastError: { args: [], returns: FFIType.u32 },
  }).symbols;

let kernel: ReturnType<typeof load> | undefined;
const k32 = () => (assertWindows(), (kernel ??= load()));

const fail = (what: string, code: number) =>
  new WindowsError("ERR_WINDOWS_WIN32", `${what} failed with Win32 error ${code}`, code);

/** An open handle on `\\.\BunOS`; `using` or `close()` releases it. */
export class BunOsDevice {
  #handle: bigint;

  private constructor(handle: bigint) {
    this.#handle = handle;
  }

  /** Opens the device; `null` when the driver is not loaded (ERROR_FILE_NOT_FOUND). */
  static open(): BunOsDevice | null {
    const k = k32();
    const path = wide(DEVICE_PATH);
    const handle = BigInt(k.CreateFileW(ptr(path), GENERIC_READ_WRITE, 0, null, OPEN_EXISTING, 0, 0n));
    if (handle === INVALID_HANDLE_VALUE) {
      const code = k.GetLastError();
      if (code === ERROR_FILE_NOT_FOUND) return null;
      throw fail(`CreateFileW(${DEVICE_PATH})`, code);
    }
    return new BunOsDevice(handle);
  }

  /** One METHOD_BUFFERED round trip; returns the bytes the driver wrote. */
  ioctl(code: number, input: Uint8Array, outputLength: number): Uint8Array {
    const k = k32();
    const output = new Uint8Array(Math.max(outputLength, 0));
    const returned = new Uint32Array(1);
    const ok = k.DeviceIoControl(
      this.#handle,
      code,
      input.length ? ptr(input) : null,
      input.length,
      output.length ? ptr(output) : null,
      output.length,
      ptr(returned),
      null,
    );
    if (!ok) throw fail(`DeviceIoControl(${code.toString(16)})`, k.GetLastError());
    return output.subarray(0, returned[0]!);
  }

  /** "bunos.sys <version>". */
  version(): string {
    const bytes = this.ioctl(IOCTL_BUNOS_VERSION, new Uint8Array(0), 128);
    const end = bytes.indexOf(0);
    return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
  }

  /** Echoes `data` through the kernel. */
  ping(data: Uint8Array): Uint8Array {
    return this.ioctl(IOCTL_BUNOS_PING, data, data.length);
  }

  close(): void {
    if (this.#handle) k32().CloseHandle(this.#handle);
    this.#handle = 0n;
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/** True when bunos.sys is loaded and `\\.\BunOS` opens. Always false off Windows. */
export function available(): boolean {
  if (process.platform !== "win32") return false;
  const device = BunOsDevice.open();
  device?.close();
  return device !== null;
}
