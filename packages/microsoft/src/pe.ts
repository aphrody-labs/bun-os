// PE/COFF import table reader (PE32 and PE32+), regular and delay-load imports.
// Format: https://learn.microsoft.com/windows/win32/debug/pe-format
export interface PeImports {
  machine: number;
  isDotnet: boolean;
  /** DLL name (lower case) to imported function names ("#ordinal" for ordinal imports). */
  imports: Map<string, string[]>;
  delayImports: Map<string, string[]>;
}

export function parsePe(buf: Uint8Array): PeImports {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint16(0, true) !== 0x5a4d) throw new Error("not a PE file (no MZ)");
  const nt = v.getUint32(0x3c, true);
  if (v.getUint32(nt, true) !== 0x4550) throw new Error("not a PE file (no PE signature)");
  const machine = v.getUint16(nt + 4, true);
  const nsec = v.getUint16(nt + 6, true);
  const optSize = v.getUint16(nt + 20, true);
  const opt = nt + 24;
  const magic = v.getUint16(opt, true);
  const plus = magic === 0x20b;
  if (!plus && magic !== 0x10b) throw new Error(`unknown optional header magic 0x${magic.toString(16)}`);
  const ddBase = opt + (plus ? 112 : 96);
  const dd = (i: number) => ({ rva: v.getUint32(ddBase + i * 8, true), size: v.getUint32(ddBase + i * 8 + 4, true) });
  const secs = Array.from({ length: nsec }, (_, i) => {
    const o = opt + optSize + i * 40;
    return {
      va: v.getUint32(o + 12, true),
      vsize: v.getUint32(o + 8, true),
      raw: v.getUint32(o + 20, true),
      rawSize: v.getUint32(o + 16, true),
    };
  });
  const off = (rva: number) => {
    for (const s of secs) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return rva - s.va + s.raw;
    throw new Error(`RVA 0x${rva.toString(16)} is in no section`);
  };
  const cstr = (o: number) => {
    let e = o;
    while (buf[e]) e++;
    return new TextDecoder().decode(buf.subarray(o, e));
  };
  const thunks = (rva: number): string[] => {
    const out: string[] = [];
    const step = plus ? 8 : 4;
    for (let o = off(rva); ; o += step) {
      const lo = v.getUint32(o, true);
      const hi = plus ? v.getUint32(o + 4, true) : 0;
      if (!lo && !hi) break;
      const ordinal = plus ? (hi & 0x80000000) !== 0 : (lo & 0x80000000) !== 0;
      out.push(ordinal ? `#${lo & 0xffff}` : cstr(off(lo & 0x7fffffff) + 2));
    }
    return out;
  };
  const imports = new Map<string, string[]>();
  const delayImports = new Map<string, string[]>();
  const imp = dd(1);
  if (imp.rva)
    for (let o = off(imp.rva); v.getUint32(o + 12, true); o += 20) {
      const name = cstr(off(v.getUint32(o + 12, true))).toLowerCase();
      const first = v.getUint32(o, true) || v.getUint32(o + 16, true);
      imports.set(name, [...(imports.get(name) ?? []), ...thunks(first)]);
    }
  const del = dd(13);
  if (del.rva)
    // delay-load descriptors use RVAs when attribute bit 0 is set, which every modern linker does
    for (let o = off(del.rva); v.getUint32(o + 4, true); o += 32) {
      const name = cstr(off(v.getUint32(o + 4, true))).toLowerCase();
      delayImports.set(name, [...(delayImports.get(name) ?? []), ...thunks(v.getUint32(o + 16, true))]);
    }
  return { machine, isDotnet: dd(14).rva !== 0, imports, delayImports };
}
