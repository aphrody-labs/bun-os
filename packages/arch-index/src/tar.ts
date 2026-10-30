// SPDX-License-Identifier: MIT
// Minimal tar reader for pacman databases: ustar, GNU long names (L) and pax (x/g) headers.

export interface TarEntry {
  name: string;
  size: number;
  type: string;
  data: Uint8Array;
}

const decoder = new TextDecoder();

function cstring(buf: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = start + length;
  while (end < limit && buf[end] !== 0) end++;
  return decoder.decode(buf.subarray(start, end));
}

function octal(buf: Uint8Array, start: number, length: number): number {
  // GNU base-256 encoding for sizes that do not fit in octal.
  if ((buf[start]! & 0x80) !== 0) {
    let n = buf[start]! & 0x7f;
    for (let i = 1; i < length; i++) n = n * 256 + buf[start + i]!;
    return n;
  }
  const text = cstring(buf, start, length).trim();
  if (text === "") return 0;
  const n = Number.parseInt(text, 8);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Corrupt tar header: bad number "${text}".`);
  return n;
}

function paxPath(data: Uint8Array): string | undefined {
  const text = decoder.decode(data);
  let pos = 0;
  while (pos < text.length) {
    const space = text.indexOf(" ", pos);
    if (space < 0) break;
    const len = Number.parseInt(text.slice(pos, space), 10);
    if (!(len > 0)) break;
    const record = text.slice(space + 1, pos + len - 1);
    const eq = record.indexOf("=");
    if (eq > 0 && record.slice(0, eq) === "path") return record.slice(eq + 1);
    pos += len;
  }
  return undefined;
}

/** Iterate regular-file and directory entries of an uncompressed tar archive. */
export function* readTar(buf: Uint8Array): Generator<TarEntry> {
  let offset = 0;
  let longName: string | undefined;
  let paxName: string | undefined;
  while (offset + 512 <= buf.length) {
    // A zero block marks the end of the archive.
    if (buf[offset] === 0 && buf[offset + 1] === 0) return;
    const size = octal(buf, offset + 124, 12);
    const type = String.fromCharCode(buf[offset + 156] || 48);
    let name = cstring(buf, offset, 100);
    if (cstring(buf, offset + 257, 5) === "ustar") {
      const prefix = cstring(buf, offset + 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const start = offset + 512;
    const end = start + size;
    if (end > buf.length) throw new Error("Corrupt tar: entry runs past the end of the archive.");
    const data = buf.subarray(start, end);
    offset = start + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = cstring(data, 0, data.length);
      continue;
    }
    if (type === "x") {
      paxName = paxPath(data);
      continue;
    }
    if (type === "g") continue;
    yield { name: paxName ?? longName ?? name, size, type, data };
    longName = undefined;
    paxName = undefined;
  }
}

/** Decompress by magic bytes: gzip, zstd, or already a plain tar. */
export function decompress(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return Bun.gunzipSync(bytes);
  if (bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd)
    return Bun.zstdDecompressSync(bytes);
  if (bytes.length >= 262 && decoder.decode(bytes.subarray(257, 262)) === "ustar") return bytes;
  throw new Error("Unsupported or corrupt archive: expected gzip, zstd or tar data.");
}
