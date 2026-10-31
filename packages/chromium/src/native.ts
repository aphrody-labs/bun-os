// SPDX-License-Identifier: MIT
/**
 * bun:ffi loader for crates/aphrody-chromium-ffi (adblock-rust and the Brave privacy crates), which
 * replaces the fork's `$newRustFunction` host functions. The library is found through
 * `APHRODY_CHROMIUM_FFI` (a file path), then the Cargo target directories of this checkout
 * (`CARGO_TARGET_DIR`, `<root>/target`), release before debug.
 */
import { dlopen, FFIType, ptr, read, toArrayBuffer, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const libraryName =
  process.platform === "win32"
    ? "aphrody_chromium_ffi.dll"
    : process.platform === "darwin"
      ? "libaphrody_chromium_ffi.dylib"
      : "libaphrody_chromium_ffi.so";

export function libraryCandidates(): string[] {
  const root = resolve(import.meta.dir, "../../..");
  const targets = [process.env.CARGO_TARGET_DIR, join(root, "target")].filter((dir): dir is string => !!dir);
  const out: string[] = [];
  if (process.env.APHRODY_CHROMIUM_FFI) out.push(process.env.APHRODY_CHROMIUM_FFI);
  for (const dir of targets) for (const profile of ["release", "debug"]) out.push(join(dir, profile, libraryName));
  return out;
}

const symbols = {
  aphrody_chromium_buf_free: { args: [FFIType.ptr], returns: FFIType.void },
  aphrody_adblock_new: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
  aphrody_adblock_deserialize: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
  aphrody_adblock_free: { args: [FFIType.ptr], returns: FFIType.void },
  aphrody_adblock_check: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  aphrody_adblock_url_cosmetic_resources: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  aphrody_adblock_hidden_class_id_selectors: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  aphrody_adblock_serialize: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_privacy_call: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.ptr,
  },
} as const;

type Library = ReturnType<typeof dlopen<typeof symbols>>["symbols"];
let library: Library | undefined;

export function native(): Library {
  if (library) return library;
  const path = libraryCandidates().find(candidate => existsSync(candidate));
  if (!path)
    throw new Error(
      `${libraryName} not found; build crates/aphrody-chromium-ffi (cargo-serial build -p aphrody-chromium-ffi --release) or set APHRODY_CHROMIUM_FFI`,
    );
  library = dlopen(path, symbols).symbols;
  return library;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EMPTY = new Uint8Array(1);

/** Pointer to bytes, valid while `bytes` is reachable; empty input gets a dummy one-byte buffer. */
export function pointer(bytes: Uint8Array): Pointer {
  return ptr(bytes.byteLength ? bytes : EMPTY);
}

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

/** Consume a buffer returned by the library: copies its payload, frees it, throws on error status. */
export function take(result: Pointer | null): Uint8Array {
  if (!result) throw new Error("aphrody-chromium-ffi returned no buffer");
  const length = Number(read.u64(result, 0));
  const status = read.u8(result, 8);
  const payload = length ? new Uint8Array(toArrayBuffer(result, 9, length)).slice() : new Uint8Array(0);
  native().aphrody_chromium_buf_free(result);
  if (status !== 0) throw new Error(decoder.decode(payload));
  return payload;
}

export function takeJSON<T>(result: Pointer | null): T {
  return JSON.parse(decoder.decode(take(result))) as T;
}

/** Out-pointer cell for an error buffer. */
export function errorCell(): { cell: BigUint64Array; pointer: Pointer; check(): void } {
  const cell = new BigUint64Array(1);
  const cellPointer = ptr(cell);
  return {
    cell,
    pointer: cellPointer,
    check() {
      const value = read.ptr(cellPointer, 0) as Pointer;
      if (value) take(value);
    },
  };
}
