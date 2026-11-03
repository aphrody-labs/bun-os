// SPDX-License-Identifier: MIT
// Ported from aphrody-labs/bun src/js/internal/pe.ts (commit 62fcdb38ec9, MIT, Copyright Oven and contributors) to upstream Bun
// for the Bun OS bun:* modules of @aphrody/windows (src/bun-plugin.ts).

// Portable Executable reader (PE32/PE32+): headers, sections, imports (normal and delay-load), exports (with
// forwarders), VS_VERSIONINFO, the Authenticode certificate table and the CLR header. Pure TypeScript over a
// random-access byte source, bounded against malformed input; it never executes or maps the image (no
// `LoadLibrary`, no WinRT activation).
import authenticode from "./authenticode";
const { parseAuthenticode } = authenticode;
import type { Authenticode } from "./authenticode";

/** Random-access bytes: an in-memory image or positional reads on a file descriptor. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Uint8Array;
}

function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    read: (offset, length) =>
      bytes.subarray(Math.max(0, offset), Math.min(bytes.byteLength, offset + Math.max(0, length))),
  };
}

export type PeKind = "exe" | "dll" | "sys" | "efi" | "mui";

export type PeImport = { module: string; delay: boolean; functions: string[] };
export type PeExport = { ordinal: number; name: string | null; forwarder: string | null };
export type Section = {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
  characteristics: number;
};

export type VersionInfo = {
  fileVersion?: string;
  productVersion?: string;
  strings: Record<string, string>;
};

export type PeInfo = {
  kind: PeKind;
  machine: string;
  bits: 32 | 64;
  subsystem: string;
  characteristics: number;
  dllCharacteristics: number;
  timestamp: number;
  imageBase: bigint;
  imageSize: number;
  entryRva: number;
  checksum: number;
  isDotnet: boolean;
  sections: Section[];
  imports: PeImport[];
  exports: PeExport[];
  exportName: string | null;
  version: VersionInfo | null;
  /** Embedded Authenticode signature (certificate table), when present. */
  authenticode: Authenticode | null;
  /** Non-fatal decoding problems (truncated tables, out-of-range RVAs). */
  warnings: string[];
};

const MACHINES: Record<number, string> = {
  0x14c: "x86",
  0x8664: "x64",
  0xaa64: "arm64",
  0x1c0: "arm",
  0x1c4: "armnt",
  0xa641: "arm64ec",
  0xa64e: "arm64x",
  0x200: "ia64",
  0xebc: "ebc",
  0: "unknown",
};

const SUBSYSTEMS: Record<number, string> = {
  0: "unknown",
  1: "native",
  2: "windows_gui",
  3: "windows_cui",
  5: "os2_cui",
  7: "posix_cui",
  8: "native_windows",
  9: "windows_ce_gui",
  10: "efi_application",
  11: "efi_boot_service_driver",
  12: "efi_runtime_driver",
  13: "efi_rom",
  14: "xbox",
  16: "windows_boot_application",
};

const IMAGE_FILE_DLL = 0x2000;
const MAX_IMPORT_DESCRIPTORS = 4096;
const MAX_THUNKS = 65_536;
const MAX_EXPORTS = 131_072;

/** True when the first bytes carry the `MZ` signature. */
function looksLikePe(head: Uint8Array): boolean {
  return head.byteLength >= 2 && head[0] === 0x4d && head[1] === 0x5a;
}

class Reader {
  private headerCache: Uint8Array;
  constructor(
    readonly src: ByteSource,
    headerBytes = 4096,
  ) {
    this.headerCache = src.read(0, Math.min(src.size, headerBytes));
  }

  bytes(offset: number, length: number): Uint8Array {
    if (offset < 0 || length < 0 || offset >= this.src.size) return new Uint8Array(0);
    if (offset + length <= this.headerCache.byteLength) {
      return this.headerCache.subarray(offset, offset + length);
    }
    return this.src.read(offset, Math.min(length, this.src.size - offset));
  }

  view(offset: number, length: number): DataView | null {
    const b = this.bytes(offset, length);
    if (b.byteLength < length) return null;
    return new DataView(b.buffer, b.byteOffset, b.byteLength);
  }

  /** NUL-terminated ASCII string (import/export names), at most `max` bytes. */
  cstr(offset: number, max = 512): string | null {
    const b = this.bytes(offset, max);
    const end = b.indexOf(0);
    if (end < 0 && b.byteLength < max) return null;
    return new TextDecoder("latin1").decode(b.subarray(0, end < 0 ? b.byteLength : end));
  }
}

function sectionName(b: Uint8Array): string {
  const end = b.indexOf(0);
  return new TextDecoder("latin1").decode(b.subarray(0, end < 0 ? 8 : end));
}

/** Parses a PE image; returns null when the source is not a PE (no MZ/PE signatures). */
function parsePe(src: ByteSource, fileName = ""): PeInfo | null {
  if (src.size < 0x40) return null;
  const r = new Reader(src);
  const dos = r.view(0, 0x40);
  if (!dos || dos.getUint16(0, true) !== 0x5a4d) return null;
  const peOff = dos.getUint32(0x3c, true);
  const nt = r.view(peOff, 24);
  if (!nt || nt.getUint32(0, true) !== 0x0000_4550) return null;
  const warnings: string[] = [];
  const machineId = nt.getUint16(4, true);
  const nSections = nt.getUint16(6, true);
  const timestamp = nt.getUint32(8, true);
  const optSize = nt.getUint16(20, true);
  const characteristics = nt.getUint16(22, true);
  const optOff = peOff + 24;
  const opt = r.view(optOff, Math.max(optSize, 2));
  if (!opt) return null;
  const magic = opt.getUint16(0, true);
  const is64 = magic === 0x20b;
  if (magic !== 0x10b && magic !== 0x20b) return null;
  if (optSize < (is64 ? 112 : 96)) return null;
  const entryRva = opt.getUint32(16, true);
  const imageBase = is64 ? opt.getBigUint64(24, true) : BigInt(opt.getUint32(28, true));
  const imageSize = opt.getUint32(56, true);
  const headersSize = opt.getUint32(60, true);
  const checksum = opt.getUint32(64, true);
  const subsystemId = opt.getUint16(68, true);
  const dllCharacteristics = opt.getUint16(70, true);
  const nDirs = Math.min(16, opt.getUint32(is64 ? 108 : 92, true));
  const dirBase = is64 ? 112 : 96;
  const dirs: { rva: number; size: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const at = dirBase + i * 8;
    dirs.push(
      i < nDirs && at + 8 <= optSize
        ? { rva: opt.getUint32(at, true), size: opt.getUint32(at + 4, true) }
        : { rva: 0, size: 0 },
    );
  }
  const sections: Section[] = [];
  const secOff = optOff + optSize;
  for (let i = 0; i < Math.min(nSections, 96); i++) {
    const s = r.view(secOff + i * 40, 40);
    if (!s) {
      warnings.push("truncated section table");
      break;
    }
    sections.push({
      name: sectionName(r.bytes(secOff + i * 40, 8)),
      virtualSize: s.getUint32(8, true),
      virtualAddress: s.getUint32(12, true),
      rawSize: s.getUint32(16, true),
      rawOffset: s.getUint32(20, true),
      characteristics: s.getUint32(36, true),
    });
  }
  const rvaToOff = (rva: number): number => {
    if (rva < headersSize) return rva;
    for (const s of sections) {
      const span = Math.max(s.virtualSize, s.rawSize);
      const { virtualAddress } = s;
      if (rva >= virtualAddress && rva < virtualAddress + span) {
        const delta = rva - virtualAddress;
        return delta < s.rawSize ? s.rawOffset + delta : -1;
      }
    }
    return -1;
  };

  const imports = readImports(r, dirs[1]!, dirs[13]!, is64, imageBase, rvaToOff, warnings);
  const { exports, exportName } = readExports(r, dirs[0]!, rvaToOff, warnings);
  let version: VersionInfo | null = null;
  try {
    version = readVersion(r, dirs[2]!, rvaToOff);
  } catch (e) {
    warnings.push(`version: ${(e as Error).message}`);
  }
  let authenticode: Authenticode | null = null;
  const { rva: certificateOffset, size: certificateSize } = dirs[4]!;
  if (certificateOffset && certificateSize >= 8 && certificateOffset + certificateSize <= src.size) {
    // The certificate table entry holds a file offset, not an RVA.
    const certs = r.bytes(certificateOffset, Math.min(certificateSize, 1 << 20));
    try {
      authenticode = parseAuthenticode(certs);
    } catch (e) {
      warnings.push(`authenticode: ${(e as Error).message}`);
    }
  }
  const isDotnet = dirs[14]!.rva !== 0 && dirs[14]!.size !== 0;
  const subsystem = SUBSYSTEMS[subsystemId] ?? `subsystem_${subsystemId}`;
  return {
    kind: classify(fileName, characteristics, subsystemId, imports),
    machine: MACHINES[machineId] ?? `0x${machineId.toString(16)}`,
    bits: is64 ? 64 : 32,
    subsystem,
    characteristics,
    dllCharacteristics,
    timestamp,
    imageBase,
    imageSize,
    entryRva,
    checksum,
    isDotnet,
    sections,
    imports,
    exports,
    exportName,
    version,
    authenticode,
    warnings,
  };
}

function classify(fileName: string, characteristics: number, subsystem: number, imports: PeImport[]): PeKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "mui") return "mui";
  if (subsystem >= 10 && subsystem <= 13) return "efi";
  const kernelImport = imports.some(i =>
    /^(ntoskrnl\.exe|hal\.dll|ntkrnlpa\.exe|wdfldr\.sys|fltmgr\.sys|ndis\.sys)$/.test(i.module),
  );
  if (ext === "sys" || (subsystem === 1 && kernelImport)) return "sys";
  if (characteristics & IMAGE_FILE_DLL) return "dll";
  return "exe";
}

function readThunks(r: Reader, off: number, is64: boolean, rvaToOff: (rva: number) => number): string[] {
  const out: string[] = [];
  const width = is64 ? 8 : 4;
  for (let i = 0; i < MAX_THUNKS; i++) {
    const v = r.view(off + i * width, width);
    if (!v) break;
    const thunk = is64 ? v.getBigUint64(0, true) : BigInt(v.getUint32(0, true));
    if (thunk === 0n) break;
    const ordinalFlag = is64 ? 1n << 63n : 1n << 31n;
    if (thunk & ordinalFlag) {
      out.push(`#${Number(thunk & 0xffffn)}`);
      continue;
    }
    const nameOff = rvaToOff(Number(thunk & 0x7fff_ffffn));
    const name = nameOff >= 0 ? r.cstr(nameOff + 2) : null;
    out.push(name ?? `?${thunk.toString(16)}`);
  }
  return out;
}

function readImports(
  r: Reader,
  dir: { rva: number; size: number },
  delayDir: { rva: number; size: number },
  is64: boolean,
  imageBase: bigint,
  rvaToOff: (rva: number) => number,
  warnings: string[],
): PeImport[] {
  const out: PeImport[] = [];
  const { rva: importRva } = dir;
  if (importRva) {
    const base = rvaToOff(importRva);
    if (base < 0) warnings.push("import directory outside sections");
    for (let i = 0; base >= 0 && i < MAX_IMPORT_DESCRIPTORS; i++) {
      const d = r.view(base + i * 20, 20);
      if (!d) break;
      const oft = d.getUint32(0, true);
      const nameRva = d.getUint32(12, true);
      const ft = d.getUint32(16, true);
      if (nameRva === 0 && ft === 0 && oft === 0) break;
      const nameOff = rvaToOff(nameRva);
      const module = nameOff >= 0 ? r.cstr(nameOff, 256) : null;
      if (!module) continue;
      const thunkOff = rvaToOff(oft || ft);
      out.push({
        module: module.toLowerCase(),
        delay: false,
        functions: thunkOff >= 0 ? readThunks(r, thunkOff, is64, rvaToOff) : [],
      });
    }
  }
  const { rva: delayImportRva } = delayDir;
  if (delayImportRva) {
    const base = rvaToOff(delayImportRva);
    for (let i = 0; base >= 0 && i < MAX_IMPORT_DESCRIPTORS; i++) {
      const d = r.view(base + i * 32, 32);
      if (!d) break;
      const attrs = d.getUint32(0, true);
      let nameRva = d.getUint32(4, true);
      let intRva = d.getUint32(16, true);
      if (nameRva === 0 && intRva === 0) break;
      // Attributes bit 0 clear: the old (VC6) layout stores virtual addresses instead of RVAs.
      if ((attrs & 1) === 0) {
        nameRva = Number(BigInt(nameRva) - imageBase);
        intRva = Number(BigInt(intRva) - imageBase);
      }
      const nameOff = rvaToOff(nameRva);
      const module = nameOff >= 0 ? r.cstr(nameOff, 256) : null;
      if (!module) continue;
      const thunkOff = rvaToOff(intRva);
      out.push({
        module: module.toLowerCase(),
        delay: true,
        functions: thunkOff >= 0 ? readThunks(r, thunkOff, is64, rvaToOff) : [],
      });
    }
  }
  return out;
}

function readExports(
  r: Reader,
  dir: { rva: number; size: number },
  rvaToOff: (rva: number) => number,
  warnings: string[],
): { exports: PeExport[]; exportName: string | null } {
  if (!dir.rva) return { exports: [], exportName: null };
  const off = rvaToOff(dir.rva);
  const d = off >= 0 ? r.view(off, 40) : null;
  if (!d) {
    warnings.push("unreadable export directory");
    return { exports: [], exportName: null };
  }
  const nameOff = rvaToOff(d.getUint32(12, true));
  const exportName = nameOff >= 0 ? r.cstr(nameOff, 256) : null;
  const base = d.getUint32(16, true);
  const nFunctions = Math.min(d.getUint32(20, true), MAX_EXPORTS);
  const nNames = Math.min(d.getUint32(24, true), MAX_EXPORTS);
  const funcsOff = rvaToOff(d.getUint32(28, true));
  const namesOff = rvaToOff(d.getUint32(32, true));
  const ordsOff = rvaToOff(d.getUint32(36, true));
  if (funcsOff < 0) return { exports: [], exportName };
  const funcs = r.view(funcsOff, nFunctions * 4);
  if (!funcs) {
    warnings.push("truncated exported-function table");
    return { exports: [], exportName };
  }
  const names = new Map<number, string>();
  const nameTable = namesOff >= 0 ? r.view(namesOff, nNames * 4) : null;
  const ordTable = ordsOff >= 0 ? r.view(ordsOff, nNames * 2) : null;
  if (nameTable && ordTable) {
    for (let i = 0; i < nNames; i++) {
      const o = rvaToOff(nameTable.getUint32(i * 4, true));
      const name = o >= 0 ? r.cstr(o, 512) : null;
      if (name !== null) names.set(ordTable.getUint16(i * 2, true), name);
    }
  }
  const exports: PeExport[] = [];
  for (let i = 0; i < nFunctions; i++) {
    const rva = funcs.getUint32(i * 4, true);
    if (rva === 0) continue;
    let forwarder: string | null = null;
    if (rva >= dir.rva && rva < dir.rva + dir.size) {
      const fo = rvaToOff(rva);
      forwarder = fo >= 0 ? r.cstr(fo, 512) : null;
    }
    exports.push({ ordinal: base + i, name: names.get(i) ?? null, forwarder });
  }
  return { exports, exportName };
}

const RT_VERSION = 16;

function resourceEntries(
  r: Reader,
  rsrcOff: number,
  dirRel: number,
): { id: number | null; dataRel: number; isDir: boolean }[] {
  const d = r.view(rsrcOff + dirRel, 16);
  if (!d) return [];
  const n = Math.min(d.getUint16(12, true) + d.getUint16(14, true), 4096);
  const out: { id: number | null; dataRel: number; isDir: boolean }[] = [];
  const entries = r.view(rsrcOff + dirRel + 16, n * 8);
  if (!entries) return [];
  for (let i = 0; i < n; i++) {
    const nameField = entries.getUint32(i * 8, true);
    const data = entries.getUint32(i * 8 + 4, true);
    out.push({
      id: nameField & 0x8000_0000 ? null : nameField,
      dataRel: data & 0x7fff_ffff,
      isDir: (data & 0x8000_0000) !== 0,
    });
  }
  return out;
}

function readVersion(
  r: Reader,
  dir: { rva: number; size: number },
  rvaToOff: (rva: number) => number,
): VersionInfo | null {
  if (!dir.rva) return null;
  const rsrc = rvaToOff(dir.rva);
  if (rsrc < 0) return null;
  const type = resourceEntries(r, rsrc, 0).find(e => e.id === RT_VERSION && e.isDir);
  if (!type) return null;
  const name = resourceEntries(r, rsrc, type.dataRel).find(e => e.isDir);
  if (!name) return null;
  const langs = resourceEntries(r, rsrc, name.dataRel).filter(e => !e.isDir);
  const lang = langs[0];
  if (!lang) return null;
  const entry = r.view(rsrc + lang.dataRel, 16);
  if (!entry) return null;
  const dataOff = rvaToOff(entry.getUint32(0, true));
  const size = Math.min(entry.getUint32(4, true), 1 << 20);
  if (dataOff < 0 || size < 6) return null;
  return parseVersionInfo(r.bytes(dataOff, size));
}

type Block = {
  key: string;
  valueOff: number;
  valueBytes: number;
  type: number;
  end: number;
  childrenOff: number;
};

function readBlock(b: Uint8Array, v: DataView, off: number): Block | null {
  if (off + 6 > b.byteLength) return null;
  const length = v.getUint16(off, true);
  const valueLength = v.getUint16(off + 2, true);
  const type = v.getUint16(off + 4, true);
  if (length < 6 || off + length > b.byteLength) return null;
  let p = off + 6;
  const keyStart = p;
  while (p + 1 < off + length && v.getUint16(p, true) !== 0) p += 2;
  const key = Buffer.from(b.buffer, b.byteOffset + keyStart, p - keyStart).toString("utf16le");
  p += 2;
  const valueOff = (p + 3) & ~3;
  const valueBytes = type === 1 ? valueLength * 2 : valueLength;
  const childrenOff = (valueOff + valueBytes + 3) & ~3;
  return { key, valueOff, valueBytes, type, end: off + length, childrenOff };
}

function children(b: Uint8Array, v: DataView, parent: Block): Block[] {
  const out: Block[] = [];
  let off = parent.childrenOff;
  for (let i = 0; off < parent.end && i < 4096; i++) {
    const c = readBlock(b, v, off);
    if (!c) break;
    out.push(c);
    off = (c.end + 3) & ~3;
  }
  return out;
}

const verString = (ms: number, ls: number) => `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;

/** Parses a VS_VERSIONINFO blob (fixed file info and the first StringTable). */
function parseVersionInfo(b: Uint8Array): VersionInfo | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const root = readBlock(b, v, 0);
  if (!root || root.key !== "VS_VERSION_INFO") return null;
  const info: VersionInfo = { strings: {} };
  const { valueOff } = root;
  if (root.valueBytes >= 52 && v.getUint32(valueOff, true) === 0xfeef04bd) {
    info.fileVersion = verString(v.getUint32(valueOff + 8, true), v.getUint32(valueOff + 12, true));
    info.productVersion = verString(v.getUint32(valueOff + 16, true), v.getUint32(valueOff + 20, true));
  }
  for (const c of children(b, v, root)) {
    if (c.key !== "StringFileInfo") continue;
    for (const table of children(b, v, c)) {
      for (const s of children(b, v, table)) {
        if (s.valueBytes <= 0) continue;
        const raw = Buffer.from(b.buffer, b.byteOffset + s.valueOff, Math.min(s.valueBytes, b.byteLength - s.valueOff));
        const value = raw.toString("utf16le").replace(/\0+$/, "").trim();
        const { key } = s;
        const { strings } = info;
        if (value && !(key in strings)) strings[key] = value;
      }
      break;
    }
  }
  return info;
}

/**
 * ApiSet schema v6 (Windows 10+), from the `.apiset` section of apisetschema.dll: contract name (without its
 * trailing `-N` revision) -> host modules (default host first).
 */
function parseApiSetSchema(b: Uint8Array): Map<string, string[]> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map<string, string[]>();
  if (b.byteLength < 28 || v.getUint32(0, true) !== 6) return out;
  const count = v.getUint32(12, true);
  const entryOff = v.getUint32(16, true);
  const str = (off: number, len: number) =>
    off + len <= b.byteLength ? Buffer.from(b.buffer, b.byteOffset + off, len).toString("utf16le") : "";
  for (let i = 0; i < Math.min(count, 65_536); i++) {
    const e = entryOff + i * 24;
    if (e + 24 > b.byteLength) break;
    const nameOff = v.getUint32(e + 4, true);
    const hashedLen = v.getUint32(e + 12, true);
    const valueOff = v.getUint32(e + 16, true);
    const valueCount = v.getUint32(e + 20, true);
    const contract = str(nameOff, hashedLen).toLowerCase();
    const hosts: string[] = [];
    let fallback: string | null = null;
    for (let j = 0; j < Math.min(valueCount, 64); j++) {
      const ve = valueOff + j * 20;
      if (ve + 20 > b.byteLength) break;
      const importerLen = v.getUint32(ve + 8, true);
      const host = str(v.getUint32(ve + 12, true), v.getUint32(ve + 16, true)).toLowerCase();
      if (!host) continue;
      if (importerLen === 0) fallback = host;
      else hosts.push(host);
    }
    if (fallback) hosts.unshift(fallback);
    if (contract && hosts.length) out.set(contract, hosts);
  }
  return out;
}

/** Contract key of an imported module: `api-ms-win-core-file-l1-2-4.dll` -> `api-ms-win-core-file-l1-2`. */
function apiSetKey(module: string): string | null {
  const m = module.toLowerCase().replace(/\.dll$/, "");
  if (!/^(api|ext)-/.test(m)) return null;
  const cut = m.lastIndexOf("-");
  return cut > 0 ? m.slice(0, cut) : m;
}

export default {
  memorySource,
  looksLikePe,
  parsePe,
  parseVersionInfo,
  parseApiSetSchema,
  apiSetKey,
};
