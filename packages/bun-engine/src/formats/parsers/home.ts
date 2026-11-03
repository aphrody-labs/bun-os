// Nintendo 64 cartridges, GameCube/Wii DOL executables and discs (ISO/GCM, WBFS, WIA, RVZ).
// Disc, DOL and FST layouts mirror crates/aphrody-wii-image (dvd.rs, dol.rs, rvz.rs), whose
// decompressing reader is the canonical owner for supported RVZ payloads.
import { BinaryView, hex, hex32, type BinarySource } from "../stream.js";
import { parsed, type FileEntry, type ParseContext, type Section } from "../types.js";

export type N64Order = "z64" | "v64" | "n64";

export function n64Order(word: number): N64Order | undefined {
  if (word === 0x80371240) return "z64";
  if (word === 0x37804012) return "v64";
  if (word === 0x40123780) return "n64";
  return undefined;
}

/** Converts a v64 (16-bit swapped) or n64 (32-bit little-endian) window to native z64 order. */
export function toZ64(bytes: Uint8Array, order: N64Order): Uint8Array {
  if (order === "z64") return bytes;
  const out = new Uint8Array(bytes.byteLength & ~3);
  for (let at = 0; at < out.byteLength; at += 4) {
    if (order === "v64") out.set([bytes[at + 1]!, bytes[at]!, bytes[at + 3]!, bytes[at + 2]!], at);
    else out.set([bytes[at + 3]!, bytes[at + 2]!, bytes[at + 1]!, bytes[at]!], at);
  }
  return out;
}

const cicByIpl3Crc: Record<number, string> = {
  0x6170a4a1: "6101",
  0x90bb6cb5: "6102",
  0x0b050ee0: "6103",
  0x98bc2c86: "6105",
  0xacc8580a: "6106",
};

const cicSeed: Record<string, number> = {
  "6101": 0xf8ca4ddc,
  "6102": 0xf8ca4ddc,
  "6103": 0xa3886759,
  "6105": 0xdf26f436,
  "6106": 0x1fea617a,
};

/** Header CRC1/CRC2 over the first MiB after IPL3 (the n64crc algorithm). */
function n64Checksum(rom: BinaryView, ipl3: BinaryView, cic: string): [number, number] | undefined {
  const seed = cicSeed[cic];
  if (seed === undefined || rom.length < 0x100000) return undefined;
  let [t1, t2, t3, t4, t5, t6] = [seed, seed, seed, seed, seed, seed];
  for (let at = 0; at < 0x100000; at += 4) {
    const d = rom.u32(at, "be");
    if ((t6 + d) >>> 0 < t6) t4 = (t4 + 1) >>> 0;
    t6 = (t6 + d) >>> 0;
    t3 = (t3 ^ d) >>> 0;
    const shift = d & 0x1f;
    const r = ((d << shift) | (d >>> (32 - shift))) >>> 0;
    t5 = (t5 + r) >>> 0;
    t2 = (t2 > d ? t2 ^ r : t2 ^ t6 ^ d) >>> 0;
    t1 = (cic === "6105" ? t1 + (ipl3.u32(0x710 + ((0x1000 + at) & 0xff), "be") ^ d) : t1 + (t5 ^ d)) >>> 0;
  }
  if (cic === "6103") return [((t6 ^ t4) + t3) >>> 0, ((t5 ^ t2) + t1) >>> 0];
  if (cic === "6106") return [(Math.imul(t6, t4) + t3) >>> 0, (Math.imul(t5, t2) + t1) >>> 0];
  return [(t6 ^ t4 ^ t3) >>> 0, (t5 ^ t2 ^ t1) >>> 0];
}

/** Nintendo 64 cartridge in any of the three dump byte orders; checksums are verified. */
export async function parseN64({ source, head }: ParseContext) {
  const order = n64Order(new BinaryView(head, "be").u32(0)) ?? "z64";
  const view = new BinaryView(toZ64(head.subarray(0, 0x1000), order), "be");
  const ipl3 = new BinaryView(view.slice(0x40, 0xfc0), "be");
  const cic = cicByIpl3Crc[Bun.hash.crc32(ipl3.bytes) >>> 0];
  const swap = order === "v64" ? "16" : order === "n64" ? "32" : undefined;
  let checksum: [number, number] | undefined;
  if (cic && source.size >= 0x101000) {
    checksum = n64Checksum(new BinaryView(toZ64(await source.read(0x1000, 0x100000), order), "be"), ipl3, cic);
  }
  const entry = view.u32(0x08);
  return parsed({
    header: {
      byteOrder: order,
      title: view.ascii(0x20, 20),
      category: String.fromCharCode(view.u8(0x3b)),
      gameId: view.ascii(0x3c, 2),
      gameCode: view.ascii(0x3b, 4),
      region: String.fromCharCode(view.u8(0x3e)),
      version: view.u8(0x3f),
      clockRate: hex32(view.u32(0x04)),
      bootAddress: hex32(entry),
      libultra: hex32(view.u32(0x0c)),
      crc1: hex32(view.u32(0x10)),
      crc2: hex32(view.u32(0x14)),
      cic: cic ?? "unknown",
      checksumValid: checksum ? checksum[0] === view.u32(0x10) && checksum[1] === view.u32(0x14) : undefined,
      romBytes: source.size,
    },
    sections: [
      { name: "header", offset: 0, size: 0x40, kind: "header", swap },
      {
        name: "ipl3",
        offset: 0x40,
        size: 0xfc0,
        address: 0xa4000040,
        arch: "mips-be",
        kind: "code",
        swap,
      },
      {
        name: "boot",
        offset: 0x1000,
        size: Math.max(0, Math.min(0x100000, source.size - 0x1000)),
        address: entry,
        arch: "mips-be",
        kind: "code",
        swap,
      },
    ],
    arch: "mips-be",
    entry,
  });
}

export interface DolLayout {
  sections: Section[];
  entry: number;
  bss: { address: number; size: number };
}

/** DOL section table (7 text + 11 data) shifted by `base` when the DOL lives inside a disc. */
export function dolLayout(view: BinaryView, base = 0): DolLayout {
  const sections: Section[] = [];
  for (let index = 0; index < 18; index++) {
    const text = index < 7;
    const slot = text ? index : index - 7;
    const at = (table: number) => view.u32(table + index * 4, "be");
    const size = at(0x90);
    if (!size) continue;
    sections.push({
      name: text ? `.text${slot}` : `.data${slot}`,
      offset: base + at(0x00),
      size,
      address: at(0x48),
      arch: text ? "ppc" : undefined,
      kind: text ? "code" : "data",
    });
  }
  return {
    sections,
    entry: view.u32(0xe0, "be"),
    bss: { address: view.u32(0xd8, "be"), size: view.u32(0xdc, "be") },
  };
}

/** Structural DOL validation: every section inside the file and mapped to GameCube/Wii RAM. */
export function looksLikeDol(view: BinaryView, size: number): boolean {
  if (size < 0x100 || !view.has(0, 0x100)) return false;
  const { sections, entry } = dolLayout(view);
  const ram = (address: number) =>
    (address >= 0x80000000 && address < 0x81800000) || (address >= 0x90000000 && address < 0x94000000);
  return (
    sections.some(section => section.kind === "code") &&
    sections.every(
      section => section.offset >= 0x100 && section.offset + section.size <= size && ram(section.address ?? 0),
    ) &&
    sections.some(
      section =>
        section.kind === "code" && entry >= (section.address ?? 0) && entry < (section.address ?? 0) + section.size,
    )
  );
}

export async function parseDol({ head, source }: ParseContext) {
  const layout = dolLayout(new BinaryView(head, "be"));
  return parsed({
    header: {
      entry: hex32(layout.entry),
      bss: { address: hex32(layout.bss.address), size: layout.bss.size },
      textSections: layout.sections.filter(section => section.kind === "code").length,
      dataSections: layout.sections.filter(section => section.kind === "data").length,
      bytes: source.size,
    },
    sections: [{ name: "header", offset: 0, size: 0x100, kind: "header" }, ...layout.sections],
    arch: "ppc",
    entry: layout.entry,
  });
}

/** GameCube/Wii disc header fields shared by ISO, WBFS, WIA and RVZ (first 0x80 bytes). */
export function discHeader(view: BinaryView, at = 0) {
  const wii = view.u32(at + 0x18, "be") === 0x5d1c9ea3;
  return {
    console: wii ? "Wii" : "GameCube",
    gameId: view.ascii(at, 6),
    gameCode: view.ascii(at, 4),
    makerCode: view.ascii(at + 4, 2),
    discNumber: view.u8(at + 6),
    version: view.u8(at + 7),
    audioStreaming: view.u8(at + 8) !== 0,
    title: view.ascii(at + 0x20, 0x40),
  };
}

const gcCountries = ["Japan", "USA", "Europe", "Korea"];

/** Uncompressed GameCube (GCM/ISO) or Wii (ISO) disc. */
export async function parseDisc({ source, head }: ParseContext) {
  const view = new BinaryView(head, "be");
  const header = discHeader(view);
  const sections: Section[] = [{ name: "boot.bin", offset: 0, size: 0x440, kind: "header" }];
  if (header.console === "Wii") {
    const table = await source.view(0x40000, 0x20, "be");
    const region = await source.view(0x4e000, 4, "be");
    const partitions: Array<{ group: number; offset: number; type: number }> = [];
    for (let group = 0; group < 4 && table.length >= 0x20; group++) {
      const count = table.u32(group * 8);
      const entries = await source.view(table.u32(group * 8 + 4) * 4, Math.min(count, 64) * 8, "be");
      for (let index = 0; index + 8 <= entries.length; index += 8) {
        partitions.push({
          group,
          offset: entries.u32(index) * 4,
          type: entries.u32(index + 4),
        });
      }
    }
    partitions.sort((a, b) => a.offset - b.offset);
    partitions.forEach((partition, index) => {
      const end = partitions[index + 1]?.offset ?? source.size;
      sections.push({
        name: `partition[${partition.group}.${index}] type ${partition.type}`,
        offset: partition.offset,
        size: end - partition.offset,
        kind: "partition",
      });
    });
    return parsed({
      header: {
        ...header,
        region: region.length ? region.u32(0) : undefined,
        partitions: partitions.length,
        encrypted: true,
      },
      sections,
      arch: "ppc",
    });
  }
  const info = await source.view(0x420, 0x40, "be");
  const loader = await source.view(0x2440, 0x20, "be");
  const dolOffset = info.u32(0);
  const fst = { offset: info.u32(4), size: info.u32(8) };
  const dol = await source.view(dolOffset, 0x100, "be");
  const layout = dolLayout(dol, dolOffset);
  const dolEnd = Math.max(dolOffset + 0x100, ...layout.sections.map(section => section.offset + section.size));
  sections.push(
    { name: "bi2.bin", offset: 0x440, size: 0x2000, kind: "metadata" },
    {
      name: "apploader",
      offset: 0x2440,
      size: 0x20 + loader.u32(0x14) + loader.u32(0x18),
      address: 0x81200000,
      arch: "ppc",
      kind: "code",
    },
    {
      name: "main.dol",
      offset: dolOffset,
      size: dolEnd - dolOffset,
      kind: "code",
    },
    ...layout.sections.map(section => ({
      ...section,
      name: `main.dol${section.name}`,
    })),
    { name: "fst.bin", offset: fst.offset, size: fst.size, kind: "filesystem" },
  );
  return parsed({
    header: {
      ...header,
      region: gcCountries[info.u32(0x20 + 0x18)] ?? hex(info.u32(0x20 + 0x18)),
      apploader: {
        date: loader.ascii(0, 10),
        entry: hex32(loader.u32(0x10)),
        bytes: loader.u32(0x14),
        trailer: loader.u32(0x18),
      },
      mainDol: { offset: dolOffset, entry: hex32(layout.entry) },
      fst,
    },
    sections,
    arch: "ppc",
    entry: layout.entry,
  });
}

/** Files of a GameCube FST (aphrody-wii-image FstNode::parse with offset shift 0). */
export async function gameCubeFiles(source: BinarySource, sections: Section[]): Promise<FileEntry[]> {
  const fst = sections.find(section => section.name === "fst.bin");
  if (!fst?.size) return [];
  const view = await source.view(fst.offset, fst.size, "be");
  const total = view.u32(8);
  const strings = total * 12;
  const files: FileEntry[] = [];
  const walk = (start: number, end: number, prefix: string): number => {
    let index = start;
    while (index < end && index < total) {
      const base = index * 12;
      const name = view.ascii(strings + (view.u32(base) & 0xffffff), 256);
      if (view.u8(base) === 0) {
        files.push({
          path: `${prefix}${name}`,
          offset: view.u32(base + 4),
          size: view.u32(base + 8),
        });
        index++;
      } else index = walk(index + 1, view.u32(base + 8), `${prefix}${name}/`);
    }
    return index;
  };
  walk(1, total, "");
  return files;
}

/** WBFS container: header plus the disc header copy of its first slot. */
export async function parseWbfs({ source, head }: ParseContext) {
  const view = new BinaryView(head, "be");
  const hdSector = 1 << view.u8(8);
  const disc = await source.view(hdSector, 0x80, "be");
  return parsed({
    header: {
      ...discHeader(disc),
      hdSectors: view.u32(4),
      hdSectorBytes: hdSector,
      wbfsSectorBytes: 1 << view.u8(9),
    },
    sections: [
      { name: "wbfs-header", offset: 0, size: hdSector, kind: "header" },
      { name: "disc-header", offset: hdSector, size: 0x100, kind: "header" },
    ],
    arch: "ppc",
  });
}

const wiaCompression = ["none", "purge", "bzip2", "lzma", "lzma2", "zstd"];

/** WIA / RVZ (Dolphin) compressed disc: both headers, tables and the embedded disc header. */
export async function parseWia({ source, head }: ParseContext) {
  const view = new BinaryView(head, "be");
  const h2 = 0x48;
  const version = view.u32(4);
  const container = view.ascii(0, 3);
  const discType = view.u32(h2);
  const compression = view.u32(h2 + 4);
  const table = (name: string, offset: number, size: number): Section => ({
    name,
    offset,
    size,
    kind: "metadata",
  });
  return parsed({
    header: {
      ...discHeader(view, h2 + 0x10),
      container,
      version: `${version >>> 24}.${(version >>> 16) & 0xff}.${(version >>> 8) & 0xff}`,
      discType: discType === 2 ? "Wii" : discType === 1 ? "GameCube" : `unknown (${discType})`,
      compression: wiaCompression[compression] ?? `type ${compression}`,
      compressionLevel: view.i32(h2 + 8),
      chunkBytes: view.u32(h2 + 0x0c),
      isoBytes: view.u64(0x24),
      fileBytes: view.u64(0x2c),
      partitions: view.u32(h2 + 0x90),
      rawDataEntries: view.u32(h2 + 0xb4),
      groups: view.u32(h2 + 0xc4),
      decompressor:
        container === "RVZ" && (discType === 1 || discType === 2) && (compression === 0 || compression === 5)
          ? "crates/aphrody-wii-image (Rvz::parse; rvz feature)"
          : "not supported by the Bun OS RVZ reader",
    },
    sections: [
      table("header1", 0, h2),
      table("header2", h2, view.u32(0x0c)),
      table("partitions", view.u64(h2 + 0x98), view.u32(h2 + 0x90) * view.u32(h2 + 0x94)),
      table("raw-data", view.u64(h2 + 0xb8), view.u32(h2 + 0xc0)),
      table("groups", view.u64(h2 + 0xc8), view.u32(h2 + 0xd0)),
    ].filter(section => section.size > 0 && section.offset < source.size),
    arch: "ppc",
  });
}
