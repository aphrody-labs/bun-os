// SPDX-License-Identifier: Apache-2.0
// bun:ffi client of bunos.sys (crates/bunos-nt-driver): CreateFileW + DeviceIoControl on \\.\BunOS. Same contract
// as the windows-rs client crates/bunos-nt-client; the control codes are pinned by test/nt-driver.test.ts.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { assertWindows, WindowsError } from "./errors";
import { wide } from "./ffi";

export const DEVICE_PATH = "\\\\.\\BunOS";
const FILE_DEVICE_UNKNOWN = 0x22;
const FILE_READ_ACCESS = 1;
const FILE_WRITE_ACCESS = 2;
/** `CTL_CODE(FILE_DEVICE_UNKNOWN, fn, METHOD_BUFFERED, access)`. */
export const ctlCode = (fn: number, access = 0): number =>
  ((FILE_DEVICE_UNKNOWN << 16) | (access << 14) | (fn << 2)) >>> 0;
export const IOCTL_BUNOS_VERSION = ctlCode(0x800);
export const IOCTL_BUNOS_PING = ctlCode(0x801);
export const IOCTL_BUNOS_CAPS = ctlCode(0x802, FILE_READ_ACCESS);
export const IOCTL_BUNOS_EVENTS_CONFIG = ctlCode(0x810, FILE_READ_ACCESS | FILE_WRITE_ACCESS);
export const IOCTL_BUNOS_EVENTS_READ = ctlCode(0x811, FILE_READ_ACCESS);

/** Layout version of every request and reply (bunos-nt-proto `ABI`). */
export const ABI = 1;
export const SOURCES = { process: 1, thread: 2, image: 4, registry: 8 } as const;
export type Source = keyof typeof SOURCES;
export const SOURCES_ALL = 0xf;
export const RECORD_SIZE = 256;
const HEADER_SIZE = 16;
const CAPS_SIZE = 32;
const NAME_MAX = 104;
export const KINDS = [
  "",
  "process_create",
  "process_exit",
  "thread_create",
  "thread_exit",
  "image_load",
  "registry_set_value",
  "registry_delete_value",
  "registry_delete_key",
] as const;

export interface Caps {
  abi: number;
  sourcesSupported: Source[];
  sourcesActive: Source[];
  ringCapacity: number;
  eventsTotal: bigint;
  droppedTotal: number;
}

export interface NtEvent {
  kind: (typeof KINDS)[number];
  /** FILETIME (100 ns since 1601 UTC). */
  time: bigint;
  pid: bigint;
  a0: bigint;
  a1: bigint;
  name: string;
  truncated: boolean;
  kernelImage: boolean;
}

export interface EventBatch {
  events: NtEvent[];
  dropped: number;
  pending: number;
}

const sourceNames = (mask: number): Source[] =>
  (Object.keys(SOURCES) as Source[]).filter(name => (mask & SOURCES[name]) !== 0);

/** Parses "process,image" / "all" / "none" into a mask; throws on an unknown name. */
export function parseSources(text: string): number {
  let mask = 0;
  for (const part of text.split(",").map(s => s.trim()).filter(Boolean)) {
    if (part === "all") mask |= SOURCES_ALL;
    else if (part === "none") continue;
    else if (part in SOURCES) mask |= SOURCES[part as Source];
    else throw new WindowsError("ERR_WINDOWS_ARGUMENT", `unknown event source ${part}`);
  }
  return mask;
}

/** Strict decode of an IOCTL_BUNOS_CAPS reply (same checks as bunos-nt-proto `Caps::parse`). */
export function decodeCaps(bytes: Uint8Array): Caps {
  if (bytes.length !== CAPS_SIZE) throw new WindowsError("ERR_WINDOWS_PROTOCOL", `caps reply is ${bytes.length} bytes`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const abi = v.getUint32(0, true);
  if (abi !== ABI) throw new WindowsError("ERR_WINDOWS_PROTOCOL", `driver ABI ${abi}, client ABI ${ABI}`);
  if (v.getUint32(16, true) !== RECORD_SIZE) throw new WindowsError("ERR_WINDOWS_PROTOCOL", "record size mismatch");
  return {
    abi,
    sourcesSupported: sourceNames(v.getUint32(4, true)),
    sourcesActive: sourceNames(v.getUint32(8, true)),
    ringCapacity: v.getUint32(12, true),
    droppedTotal: v.getUint32(20, true),
    eventsTotal: v.getBigUint64(24, true),
  };
}

/** Strict decode of an IOCTL_BUNOS_EVENTS_READ reply (same checks as bunos-nt-proto `parse_events`). */
export function decodeEvents(bytes: Uint8Array): EventBatch {
  if (bytes.length < HEADER_SIZE) throw new WindowsError("ERR_WINDOWS_PROTOCOL", "short events reply");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== ABI) throw new WindowsError("ERR_WINDOWS_PROTOCOL", "events ABI mismatch");
  const count = v.getUint32(4, true);
  if (count * RECORD_SIZE > bytes.length - HEADER_SIZE)
    throw new WindowsError("ERR_WINDOWS_PROTOCOL", `${count} records do not fit`);
  const events: NtEvent[] = [];
  for (let i = 0; i < count; i++) {
    const o = HEADER_SIZE + i * RECORD_SIZE;
    const kind = v.getUint16(o, true);
    const flags = v.getUint16(o + 2, true);
    const nameLen = v.getUint16(o + 4, true);
    if (kind < 1 || kind >= KINDS.length || flags & ~3 || nameLen > NAME_MAX || v.getUint16(o + 6, true))
      throw new WindowsError("ERR_WINDOWS_PROTOCOL", `malformed record ${i}`);
    const units = new Uint16Array(nameLen);
    for (let j = 0; j < nameLen; j++) units[j] = v.getUint16(o + 48 + 2 * j, true);
    events.push({
      kind: KINDS[kind]!,
      time: v.getBigInt64(o + 8, true),
      pid: v.getBigUint64(o + 16, true),
      a0: v.getBigUint64(o + 24, true),
      a1: v.getBigUint64(o + 32, true),
      name: String.fromCharCode(...units),
      truncated: (flags & 1) !== 0,
      kernelImage: (flags & 2) !== 0,
    });
  }
  return { events, dropped: v.getUint32(8, true), pending: v.getUint32(12, true) };
}

const GENERIC_READ_WRITE = 0xc000_0000;
const OPEN_EXISTING = 3;
const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn;
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_ACCESS_DENIED = 5;

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

  /** Opens the device; `null` when the driver is not loaded (ERROR_FILE_NOT_FOUND). Throws ERR_WINDOWS_ACCESS
   * when it is loaded but this process is not elevated. */
  static open(): BunOsDevice | null {
    const k = k32();
    const path = wide(DEVICE_PATH);
    const handle = BigInt(k.CreateFileW(ptr(path), GENERIC_READ_WRITE, 0, null, OPEN_EXISTING, 0, 0n));
    if (handle === INVALID_HANDLE_VALUE) {
      const code = k.GetLastError();
      if (code === ERROR_FILE_NOT_FOUND) return null;
      if (code === ERROR_ACCESS_DENIED)
        throw new WindowsError("ERR_WINDOWS_ACCESS", `${DEVICE_PATH} is restricted to SYSTEM and Administrators`, code);
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

  caps(): Caps {
    return decodeCaps(this.ioctl(IOCTL_BUNOS_CAPS, new Uint8Array(0), CAPS_SIZE));
  }

  /** Enables exactly `sources` (mask or list such as "process,image"); 0 / "none" disables all. */
  configure(sources: number | string): Caps {
    const mask = typeof sources === "string" ? parseSources(sources) : sources;
    const input = new Uint8Array(8);
    const v = new DataView(input.buffer);
    v.setUint32(0, ABI, true);
    v.setUint32(4, mask, true);
    return decodeCaps(this.ioctl(IOCTL_BUNOS_EVENTS_CONFIG, input, CAPS_SIZE));
  }

  /** Drains up to `max` queued kernel events, oldest first. */
  readEvents(max = 256): EventBatch {
    const n = Math.min(Math.max(1, max), 512);
    return decodeEvents(this.ioctl(IOCTL_BUNOS_EVENTS_READ, new Uint8Array(0), HEADER_SIZE + n * RECORD_SIZE));
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
  try {
    const device = BunOsDevice.open();
    device?.close();
    return device !== null;
  } catch {
    return false;
  }
}
