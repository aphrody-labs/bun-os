// SPDX-License-Identifier: Apache-2.0
// Windows registry through bun:ffi (advapi32): Unicode-safe and fast, with no reg.exe code-page or process cost.
// The same module is kept in packages/winclean/src/registry.ts; change both together.
import { dlopen, FFIType, ptr } from "bun:ffi";

export type RegistryData = string | string[] | number | bigint | Uint8Array;

export interface RegistryValue {
  name: string;
  /** `REG_SZ`, `REG_DWORD`, ... */
  type: string;
  value: RegistryData;
}

export interface RegistryListing {
  keys: string[];
  values: RegistryValue[];
}

const HIVES: Record<string, bigint> = {
  HKCR: 0x80000000n,
  HKEY_CLASSES_ROOT: 0x80000000n,
  HKCU: 0x80000001n,
  HKEY_CURRENT_USER: 0x80000001n,
  HKLM: 0x80000002n,
  HKEY_LOCAL_MACHINE: 0x80000002n,
  HKU: 0x80000003n,
  HKEY_USERS: 0x80000003n,
};

const KEY_READ = 0x20019;
const KEY_WRITE = 0x20006;
const DELETE = 0x10000;
const ERROR_SUCCESS = 0;
const ERROR_NO_MORE_ITEMS = 259;
const ERROR_MORE_DATA = 234;

const TYPES: Record<number, string> = {
  0: "REG_NONE",
  1: "REG_SZ",
  2: "REG_EXPAND_SZ",
  3: "REG_BINARY",
  4: "REG_DWORD",
  7: "REG_MULTI_SZ",
  11: "REG_QWORD",
};
const TYPE_IDS = Object.fromEntries(Object.entries(TYPES).map(([id, name]) => [name, Number(id)]));

let api: ReturnType<typeof load> | undefined;

function load() {
  return dlopen("advapi32.dll", {
    RegOpenKeyExW: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    RegCreateKeyExW: {
      args: [
        FFIType.u64,
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr,
        FFIType.u32,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.i32,
    },
    RegCloseKey: { args: [FFIType.u64], returns: FFIType.i32 },
    RegQueryInfoKeyW: {
      args: [
        FFIType.u64,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.i32,
    },
    RegEnumKeyExW: {
      args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    RegEnumValueW: {
      args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    RegSetValueExW: {
      args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
    RegDeleteValueW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    RegDeleteTreeW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  }).symbols;
}

const wide = (text: string) => Buffer.from(`${text}\0`, "utf16le");
const utf16 = (bytes: Uint8Array, length: number) => Buffer.from(bytes.subarray(0, length)).toString("utf16le");

/** Splits `HKCU:\Software\X`, `HKCU\Software\X` or `HKEY_CURRENT_USER/Software/X` into a hive handle and subkey. */
export function splitKey(path: string): { hive: bigint; subkey: string } {
  const normalized = path.replace(/\//g, "\\").replace(/^([A-Za-z_]+):/, "$1");
  const [root = "", ...rest] = normalized.split("\\");
  const hive = HIVES[root.toUpperCase()];
  if (hive === undefined) throw new Error(`unknown registry hive: ${root}`);
  return { hive, subkey: rest.filter(Boolean).join("\\") };
}

function open(path: string, access: number): bigint | null {
  const { hive, subkey } = splitKey(path);
  return openAt(hive, subkey, access, path);
}

function openAt(hive: bigint, subkey: string, access: number, path = subkey): bigint | null {
  api ??= load();
  if (subkey === "") return hive;
  const out = new BigUint64Array(1);
  const status = api.RegOpenKeyExW(hive, ptr(wide(subkey)), 0, access, ptr(out));
  if (status === ERROR_SUCCESS) return out[0]!;
  if (status === 2 || status === 3) return null;
  throw new Error(`RegOpenKeyExW(${path}) failed: ${status}`);
}

function close(handle: bigint): void {
  if (handle < 0x80000000n) api!.RegCloseKey(handle);
}

function decode(type: number, data: Uint8Array, length: number): RegistryData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  switch (type) {
    case 1:
    case 2:
      return utf16(data, length).replace(/\0+$/, "");
    case 4:
      return length >= 4 ? view.getUint32(0, true) : 0;
    case 11:
      return length >= 8 ? view.getBigUint64(0, true) : 0n;
    case 7:
      return utf16(data, length).split("\0").filter(Boolean);
    default:
      return Uint8Array.from(data.subarray(0, length));
  }
}

function encode(type: number, value: RegistryData): Uint8Array {
  switch (type) {
    case 1:
    case 2:
      return wide(String(value));
    case 4: {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, Number(value) >>> 0, true);
      return bytes;
    }
    case 11: {
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setBigUint64(0, BigInt(value as bigint | number | string), true);
      return bytes;
    }
    case 7:
      return Buffer.from(`${(Array.isArray(value) ? value : [String(value)]).join("\0")}\0\0`, "utf16le");
    default:
      return value instanceof Uint8Array ? value : new Uint8Array();
  }
}

/** Direct subkeys and values of a key; null when the key does not exist. */
export function list(path: string): RegistryListing | null {
  const handle = open(path, KEY_READ);
  if (handle === null) return null;
  try {
    const info = [0, 0, 0, 0, 0].map(() => new Uint32Array(1));
    const status = api!.RegQueryInfoKeyW(
      handle,
      null,
      null,
      null,
      ptr(info[0]!),
      ptr(info[1]!),
      null,
      ptr(info[2]!),
      ptr(info[3]!),
      ptr(info[4]!),
      null,
      null,
    );
    if (status !== ERROR_SUCCESS) throw new Error(`RegQueryInfoKeyW(${path}) failed: ${status}`);
    const [subKeys, maxSubKey, valueCount, maxName, maxData] = info.map(entry => entry[0]!);
    const keys: string[] = [];
    for (let i = 0; i < subKeys!; i++) {
      const name = new Uint8Array((maxSubKey! + 1) * 2);
      const length = new Uint32Array([maxSubKey! + 1]);
      const result = api!.RegEnumKeyExW(handle, i, ptr(name), ptr(length), null, null, null, null);
      if (result === ERROR_NO_MORE_ITEMS) break;
      if (result === ERROR_SUCCESS) keys.push(utf16(name, length[0]! * 2));
    }
    const values: RegistryValue[] = [];
    for (let i = 0; i < valueCount!; i++) {
      let capacity = maxData! + 2;
      for (;;) {
        const name = new Uint8Array((maxName! + 1) * 2);
        const nameLength = new Uint32Array([maxName! + 1]);
        const type = new Uint32Array(1);
        const data = new Uint8Array(capacity);
        const dataLength = new Uint32Array([capacity]);
        const result = api!.RegEnumValueW(handle, i, ptr(name), ptr(nameLength), null, ptr(type), ptr(data), ptr(dataLength));
        if (result === ERROR_MORE_DATA) {
          capacity = dataLength[0]! + 2;
          continue;
        }
        if (result === ERROR_SUCCESS) {
          values.push({
            name: utf16(name, nameLength[0]! * 2),
            type: TYPES[type[0]!] ?? `REG_${type[0]}`,
            value: decode(type[0]!, data, dataLength[0]!),
          });
        }
        break;
      }
    }
    return { keys, values };
  } finally {
    close(handle);
  }
}

/** One value (`name` "" is the unnamed value); null when the key or value does not exist. */
export function get(path: string, name = ""): { type: string; value: RegistryData } | null {
  const found = list(path)?.values.find(entry => entry.name.toLowerCase() === name.toLowerCase());
  return found ? { type: found.type, value: found.value } : null;
}

/** Creates the key when needed and writes one value. */
export function set(path: string, name: string, value: RegistryData, type = "REG_SZ"): void {
  api ??= load();
  const id = TYPE_IDS[type];
  if (id === undefined) throw new Error(`unsupported registry type: ${type}`);
  const { hive, subkey } = splitKey(path);
  let handle = hive;
  if (subkey !== "") {
    const out = new BigUint64Array(1);
    const status = api.RegCreateKeyExW(hive, ptr(wide(subkey)), 0, null, 0, KEY_WRITE, null, ptr(out), null);
    if (status !== ERROR_SUCCESS) throw new Error(`RegCreateKeyExW(${path}) failed: ${status}`);
    handle = out[0]!;
  }
  try {
    const bytes = encode(id, value);
    const status = api.RegSetValueExW(handle, ptr(wide(name)), 0, id, ptr(bytes), bytes.length);
    if (status !== ERROR_SUCCESS) throw new Error(`RegSetValueExW(${path}, ${name}) failed: ${status}`);
  } finally {
    close(handle);
  }
}

/** Deletes one value; false when it did not exist. */
export function deleteValue(path: string, name: string): boolean {
  const handle = open(path, KEY_WRITE);
  if (handle === null) return false;
  try {
    return api!.RegDeleteValueW(handle, ptr(wide(name))) === ERROR_SUCCESS;
  } finally {
    close(handle);
  }
}

/** Deletes a key with all its subkeys and values; false when it did not exist. */
export function deleteKey(path: string): boolean {
  api ??= load();
  const { hive, subkey } = splitKey(path);
  if (subkey === "") throw new Error("refusing to delete a registry hive");
  const parent = subkey.includes("\\") ? subkey.slice(0, subkey.lastIndexOf("\\")) : "";
  const leaf = subkey.slice(subkey.lastIndexOf("\\") + 1);
  const handle = openAt(hive, parent, DELETE | KEY_WRITE | KEY_READ);
  if (handle === null) return false;
  try {
    return api.RegDeleteTreeW(handle, ptr(wide(leaf))) === ERROR_SUCCESS;
  } finally {
    close(handle);
  }
}
