// Portable Executable metadata for the Steam index: headers, imports, exports, the version resource, the CLR flag
// and the Authenticode certificate count. Pure TypeScript, no native module. The signer and issuer need PKCS#7
// parsing and stay unset.

export interface PeInfo {
  kind: "exe" | "dll" | "sys";
  machine: string;
  bits: 32 | 64;
  subsystem: string;
  timestamp: number;
  imageSize: number;
  entryRva: number;
  isDotnet: boolean;
  imports: { module: string; functions: string[] }[];
  exports: string[];
  version: { fileVersion?: string; productVersion?: string; strings: Record<string, string> } | null;
  authenticode: { signer?: string; issuer?: string; certificates: number } | null;
  warnings: string[];
}

const MACHINES: Record<number, string> = {
  0x14c: "x86",
  0x8664: "x64",
  0x1c0: "arm",
  0x1c4: "armnt",
  0xaa64: "arm64",
  0x200: "ia64",
};

const SUBSYSTEMS: Record<number, string> = {
  1: "native",
  2: "windows-gui",
  3: "windows-cui",
  5: "os2-cui",
  7: "posix-cui",
  9: "windows-ce-gui",
  10: "efi-application",
  11: "efi-boot-service-driver",
  12: "efi-runtime-driver",
  14: "xbox",
  16: "windows-boot-application",
};

interface Section {
  virtualAddress: number;
  virtualSize: number;
  rawPointer: number;
  rawSize: number;
}

/** Parses a PE image; null when the bytes are not one. Malformed tables are skipped and noted in `warnings`. */
export function parsePe(bytes: Uint8Array): PeInfo | null {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const peOffset = view.getUint32(0x3c, true);
  if (peOffset + 24 > bytes.length || view.getUint32(peOffset, true) !== 0x00004550) return null;

  const warnings: string[] = [];
  const machineId = view.getUint16(peOffset + 4, true);
  const sectionCount = view.getUint16(peOffset + 6, true);
  const timestamp = view.getUint32(peOffset + 8, true);
  const optionalSize = view.getUint16(peOffset + 20, true);
  const characteristics = view.getUint16(peOffset + 22, true);
  const optional = peOffset + 24;
  if (optional + optionalSize > bytes.length) return null;
  const magic = view.getUint16(optional, true);
  const bits = magic === 0x20b ? 64 : 32;
  const entryRva = view.getUint32(optional + 16, true);
  const imageSize = view.getUint32(optional + 56, true);
  const subsystemId = view.getUint16(optional + 68, true);
  const dirBase = optional + (bits === 64 ? 112 : 96);
  const dirCount = Math.min(view.getUint32(dirBase - 4, true), 16);
  const directory = (index: number) =>
    index < dirCount && dirBase + index * 8 + 8 <= bytes.length
      ? { rva: view.getUint32(dirBase + index * 8, true), size: view.getUint32(dirBase + index * 8 + 4, true) }
      : { rva: 0, size: 0 };

  const sections: Section[] = [];
  const sectionTable = optional + optionalSize;
  for (let i = 0; i < sectionCount; i++) {
    const at = sectionTable + i * 40;
    if (at + 40 > bytes.length) break;
    sections.push({
      virtualSize: view.getUint32(at + 8, true),
      virtualAddress: view.getUint32(at + 12, true),
      rawSize: view.getUint32(at + 16, true),
      rawPointer: view.getUint32(at + 20, true),
    });
  }
  const offsetOf = (rva: number): number => {
    for (const s of sections) {
      const span = Math.max(s.virtualSize, s.rawSize);
      if (rva >= s.virtualAddress && rva < s.virtualAddress + span) return s.rawPointer + (rva - s.virtualAddress);
    }
    return rva < (sections[0]?.virtualAddress ?? 0) ? rva : -1;
  };
  const cString = (offset: number): string => {
    if (offset < 0 || offset >= bytes.length) return "";
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0 && end - offset < 512) end++;
    return new TextDecoder("latin1").decode(bytes.subarray(offset, end));
  };
  const guard = <T>(label: string, fallback: T, read: () => T): T => {
    try {
      return read();
    } catch {
      warnings.push(`${label} table is malformed`);
      return fallback;
    }
  };

  const exports = guard("export", [] as string[], () => {
    const dir = directory(0);
    const at = dir.rva ? offsetOf(dir.rva) : -1;
    if (at < 0) return [];
    const count = Math.min(view.getUint32(at + 24, true), 65536);
    const names = offsetOf(view.getUint32(at + 32, true));
    const found: string[] = [];
    for (let i = 0; i < count && names >= 0; i++) found.push(cString(offsetOf(view.getUint32(names + i * 4, true))));
    return found;
  });

  const imports = guard("import", [] as PeInfo["imports"], () => {
    const dir = directory(1);
    let at = dir.rva ? offsetOf(dir.rva) : -1;
    const found: PeInfo["imports"] = [];
    const slot = bits === 64 ? 8 : 4;
    while (at >= 0 && at + 20 <= bytes.length && found.length < 1024) {
      const nameRva = view.getUint32(at + 12, true);
      if (!nameRva) break;
      const thunkRva = view.getUint32(at, true) || view.getUint32(at + 16, true);
      const functions: string[] = [];
      let thunk = thunkRva ? offsetOf(thunkRva) : -1;
      while (thunk >= 0 && thunk + slot <= bytes.length && functions.length < 65536) {
        const entry = bits === 64 ? view.getBigUint64(thunk, true) : BigInt(view.getUint32(thunk, true));
        if (entry === 0n) break;
        const ordinal = entry >> BigInt(bits - 1);
        if (ordinal) functions.push(`#${Number(entry & 0xffffn)}`);
        else functions.push(cString(offsetOf(Number(entry & 0x7fffffffn)) + 2));
        thunk += slot;
      }
      found.push({ module: cString(offsetOf(nameRva)), functions });
      at += 20;
    }
    return found;
  });

  const version = guard("version resource", null as PeInfo["version"], () => readVersion());

  function readVersion(): PeInfo["version"] {
    const dir = directory(2);
    const base = dir.rva ? offsetOf(dir.rva) : -1;
    if (base < 0) return null;
    const entries = (at: number) => {
      const count = view.getUint16(at + 12, true) + view.getUint16(at + 14, true);
      return Array.from({ length: Math.min(count, 4096) }, (_, i) => {
        const id = view.getUint32(at + 16 + i * 8, true);
        const target = view.getUint32(at + 20 + i * 8, true);
        return { id, directory: (target & 0x80000000) !== 0, offset: base + (target & 0x7fffffff) };
      });
    };
    const type = entries(base).find(entry => entry.id === 16 && entry.directory);
    const name = type && entries(type.offset)[0];
    const language = name?.directory ? entries(name.offset)[0] : undefined;
    if (!language || language.directory) return null;
    const dataRva = view.getUint32(language.offset, true);
    const dataSize = view.getUint32(language.offset + 4, true);
    const start = offsetOf(dataRva);
    if (start < 0 || start + dataSize > bytes.length) return null;
    const block = bytes.subarray(start, start + dataSize);
    // The resource is UTF-16; the strings sit under StringFileInfo as `key\0value\0` pairs.
    const text = new TextDecoder("utf-16le").decode(block.subarray(0, block.length - (block.length % 2)));
    const strings: Record<string, string> = {};
    const names = [
      "CompanyName",
      "FileDescription",
      "FileVersion",
      "InternalName",
      "LegalCopyright",
      "OriginalFilename",
      "ProductName",
      "ProductVersion",
    ];
    for (const key of names) {
      const at = text.indexOf(`${key}\0`);
      if (at < 0) continue;
      let valueStart = at + key.length + 1;
      while (text[valueStart] === "\0") valueStart++;
      const valueEnd = text.indexOf("\0", valueStart);
      if (valueEnd > valueStart) strings[key] = text.slice(valueStart, valueEnd);
    }
    // VS_FIXEDFILEINFO follows the 0xFEEF04BD signature.
    let fileVersion = strings.FileVersion;
    let productVersion = strings.ProductVersion;
    for (let i = 0; i + 24 <= block.length; i += 4) {
      const local = new DataView(block.buffer, block.byteOffset, block.byteLength);
      if (local.getUint32(i, true) !== 0xfeef04bd) continue;
      const pair = (offset: number) => `${local.getUint16(i + offset + 2, true)}.${local.getUint16(i + offset, true)}`;
      const quad = (high: number, low: number) => `${pair(high)}.${pair(low)}`;
      fileVersion ??= quad(8, 12);
      productVersion ??= quad(16, 20);
      break;
    }
    if (!fileVersion && !productVersion && Object.keys(strings).length === 0) return null;
    return { fileVersion, productVersion, strings };
  }

  const security = directory(4);
  const authenticode = guard("certificate", null as PeInfo["authenticode"], () => {
    if (!security.rva || !security.size) return null;
    // The security directory holds a file offset, not an RVA: a list of 8-byte-aligned WIN_CERTIFICATE records.
    let certificates = 0;
    for (let at = security.rva; at + 8 <= bytes.length && at < security.rva + security.size; ) {
      const length = view.getUint32(at, true);
      if (length < 8) break;
      certificates++;
      at += (length + 7) & ~7;
    }
    return { certificates };
  });

  const clr = directory(14);
  return {
    kind: subsystemId === 1 && (characteristics & 0x2000) === 0 ? "sys" : characteristics & 0x2000 ? "dll" : "exe",
    machine: MACHINES[machineId] ?? `0x${machineId.toString(16)}`,
    bits,
    subsystem: SUBSYSTEMS[subsystemId] ?? `${subsystemId}`,
    timestamp,
    imageSize,
    entryRva,
    isDotnet: clr.rva !== 0 && clr.size !== 0,
    imports,
    exports,
    version,
    authenticode,
    warnings,
  };
}
