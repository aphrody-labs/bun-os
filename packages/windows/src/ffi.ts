// SPDX-License-Identifier: Apache-2.0
// Small bun:ffi helpers shared by the Win32 modules: wide strings, GUIDs and pointer reads.
import { read } from "bun:ffi";

export const wide = (text: string): Buffer => Buffer.from(`${text}\0`, "utf16le");

/** Reads a NUL-terminated UTF-16 string at a native pointer. */
export function readWide(pointer: number | bigint, max = 32768): string {
  const base = Number(pointer);
  if (!base) return "";
  let length = 0;
  while (length < max && read.u16(base, length * 2) !== 0) length++;
  const bytes = Buffer.alloc(length * 2);
  for (let i = 0; i < length; i++) bytes.writeUInt16LE(read.u16(base, i * 2), i * 2);
  return bytes.toString("utf16le");
}

/** Decodes a fixed UTF-16 field of a struct up to its first NUL. */
export function fixedWide(buffer: Uint8Array, offset: number, chars: number): string {
  const text = Buffer.from(buffer.buffer, buffer.byteOffset + offset, chars * 2).toString("utf16le");
  const nul = text.indexOf("\0");
  return nul < 0 ? text : text.slice(0, nul);
}

/** "B4BFCC3A-DB2C-424C-B029-7FE99A87C641" to the 16 byte little-endian GUID layout. */
export function guid(text: string): Buffer {
  const m = /^\{?([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\}?$/i.exec(text);
  if (!m) throw new TypeError(`invalid GUID: ${text}`);
  const out = Buffer.alloc(16);
  out.writeUInt32LE(parseInt(m[1]!, 16), 0);
  out.writeUInt16LE(parseInt(m[2]!, 16), 4);
  out.writeUInt16LE(parseInt(m[3]!, 16), 6);
  Buffer.from(m[4]! + m[5]!, "hex").copy(out, 8);
  return out;
}
