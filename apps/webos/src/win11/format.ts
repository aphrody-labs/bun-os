// SPDX-License-Identifier: Apache-2.0
// Columnar chunk container of the Windows 11 template (factory/win11-template writes it, the browser reads it).
//
//   "W11C" | u32 header bytes | header JSON | pad to 8 | column 0 | pad to 8 | column 1 | ...
//
// Every column is a little-endian typed array; a string table is two columns, `<name>.o` (u32 offsets, n + 1)
// and `<name>.b` (UTF-8 bytes). Each chunk is one zstd frame of the pack file, fetched with an HTTP range.

export type ColumnType = "u8" | "u16" | "u32" | "i32" | "f64";
export type Column = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float64Array;

export interface ChunkHeader {
  kind: "tree" | "pe" | "symbols" | "wine";
  id: string;
  /** Tree chunks: volume-relative path of node 0 ("" for the volume root). */
  prefix?: string;
  meta?: Record<string, unknown>;
  columns: { name: string; type: ColumnType; length: number }[];
}

export const NONE = 0xffff_ffff;
const MAGIC = [0x57, 0x31, 0x31, 0x43]; // "W11C"
const enc = new TextEncoder();
const dec = new TextDecoder();
const SIZE: Record<ColumnType, number> = { u8: 1, u16: 2, u32: 4, i32: 4, f64: 8 };
const typeOf = (c: Column): ColumnType =>
  c instanceof Uint8Array ? "u8" : c instanceof Uint16Array ? "u16" : c instanceof Uint32Array ? "u32" : c instanceof Int32Array ? "i32" : "f64";
const pad8 = (n: number) => (n + 7) & ~7;

/** Interns strings in first-seen order; `id("")` is a valid id. */
export class StringBuilder {
  readonly ids = new Map<string, number>();
  readonly list: string[] = [];
  id(s: string): number {
    let id = this.ids.get(s);
    if (id === undefined) {
      id = this.list.length;
      this.ids.set(s, id);
      this.list.push(s);
    }
    return id;
  }
  /** `<name>.o` and `<name>.b` columns. */
  columns(name: string): Record<string, Column> {
    const bytes = this.list.map(s => enc.encode(s));
    const offsets = new Uint32Array(bytes.length + 1);
    let total = 0;
    bytes.forEach((b, i) => {
      offsets[i] = total;
      total += b.length;
    });
    offsets[bytes.length] = total;
    const blob = new Uint8Array(total);
    bytes.forEach((b, i) => blob.set(b, offsets[i]!));
    return { [`${name}.o`]: offsets, [`${name}.b`]: blob };
  }
}

/** Read side of a string table; strings are decoded on first use. */
export class StringTable {
  private cache: (string | undefined)[];
  constructor(
    private readonly offsets: Uint32Array,
    private readonly bytes: Uint8Array,
  ) {
    this.cache = Array.from<string | undefined>({ length: Math.max(0, offsets.length - 1) });
  }
  get length(): number {
    return this.cache.length;
  }
  get(id: number): string {
    if (id === NONE || id >= this.cache.length) return "";
    return (this.cache[id] ??= dec.decode(this.bytes.subarray(this.offsets[id]!, this.offsets[id + 1]!)));
  }
  /** Every string (decodes the whole table). */
  all(): string[] {
    const out = Array.from<string>({ length: this.cache.length });
    for (let i = 0; i < out.length; i++) out[i] = this.get(i);
    return out;
  }
}

export function encodeChunk(header: Omit<ChunkHeader, "columns">, columns: Record<string, Column>): Uint8Array {
  const list = Object.entries(columns);
  const full: ChunkHeader = { ...header, columns: list.map(([name, c]) => ({ name, type: typeOf(c), length: c.length })) };
  const head = enc.encode(JSON.stringify(full));
  let size = pad8(8 + head.length);
  for (const [, c] of list) size += pad8(c.byteLength);
  const out = new Uint8Array(size);
  out.set(MAGIC);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  let at = pad8(8 + head.length);
  for (const [, c] of list) {
    out.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), at);
    at += pad8(c.byteLength);
  }
  return out;
}

export interface Chunk {
  header: ChunkHeader;
  column<T extends Column = Column>(name: string): T;
  has(name: string): boolean;
  strings(name: string): StringTable;
}

export function decodeChunk(bytes: Uint8Array): Chunk {
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error("not a W11C chunk");
  // Typed arrays need aligned offsets: copy when the input is not 8-aligned.
  const buf = bytes.byteOffset % 8 === 0 ? bytes : bytes.slice();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headLength = view.getUint32(4, true);
  const header = JSON.parse(dec.decode(buf.subarray(8, 8 + headLength))) as ChunkHeader;
  const cols = new Map<string, Column>();
  let at = pad8(8 + headLength);
  for (const c of header.columns) {
    const byteLength = c.length * SIZE[c.type];
    if (at + byteLength > buf.length) throw new Error(`truncated column ${c.name}`);
    const off = buf.byteOffset + at;
    const b = buf.buffer;
    cols.set(
      c.name,
      c.type === "u8"
        ? new Uint8Array(b, off, c.length)
        : c.type === "u16"
          ? new Uint16Array(b, off, c.length)
          : c.type === "u32"
            ? new Uint32Array(b, off, c.length)
            : c.type === "i32"
              ? new Int32Array(b, off, c.length)
              : new Float64Array(b, off, c.length),
    );
    at += pad8(byteLength);
  }
  const tables = new Map<string, StringTable>();
  return {
    header,
    has: name => cols.has(name),
    column<T extends Column>(name: string): T {
      const c = cols.get(name);
      if (!c) throw new Error(`chunk ${header.id} has no column ${name}`);
      return c as T;
    },
    strings(name) {
      let t = tables.get(name);
      if (!t) {
        t = new StringTable(this.column<Uint32Array>(`${name}.o`), this.column<Uint8Array>(`${name}.b`));
        tables.set(name, t);
      }
      return t;
    },
  };
}

// ---- template model shared by the writer and the loader ---------------------------------------------

/** Tree node flags. */
export const FLAG_SKELETON = 1;
/** The node's children live in another tree chunk (`ChunkRef.prefix` equals the node's path). */
export const FLAG_MOUNT = 2;

/** PE flags. */
export const PE_DOTNET = 1;
export const PE_EMBEDDED_SIGNATURE = 2;
export const PE_CATALOG = 4;

export const PE_KINDS = ["exe", "dll", "sys", "efi", "mui"] as const;
export const PE_MACHINES = ["unknown", "x86", "x64", "arm64", "arm", "armnt", "arm64ec", "arm64x", "ia64", "ebc"] as const;
export const PE_SUBSYSTEMS = [
  "unknown", "native", "windows_gui", "windows_cui", "os2_cui", "posix_cui", "native_windows", "windows_ce_gui",
  "efi_application", "efi_boot_service_driver", "efi_runtime_driver", "efi_rom", "xbox", "windows_boot_application",
] as const;
/** Version resource strings kept per PE, in column order (`v.<key>`). */
export const VERSION_KEYS = ["CompanyName", "FileDescription", "FileVersion", "ProductVersion", "OriginalFilename", "InternalName", "ProductName"] as const;

export interface ChunkRef {
  id: string;
  kind: ChunkHeader["kind"];
  prefix?: string;
  offset: number;
  length: number;
  rawLength: number;
  sha256: string;
  nodes?: number;
}

export interface Manifest {
  format: "aphrody-win11-template";
  version: 1;
  generated: string;
  source: Record<string, string | number | null>;
  pack: string;
  packBytes: number;
  chunks: ChunkRef[];
  stats: Record<string, number | string>;
  wine?: { version: string; commit: string };
  privacy: string[];
}

export const MANIFEST_FORMAT = "aphrody-win11-template";
