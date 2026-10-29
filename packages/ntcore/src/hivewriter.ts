/**
 * Minimal `regf` hive writer (format 1.3, fast leaves, one security cell). It exists so that the NT registry code
 * compiled from ReactOS (cmlib, run in wasm) can be tested against an independently written producer, and so Bun OS
 * can ship small default hives. Read-side logic lives in the wasm module, never here.
 */

export const REG_NONE = 0;
export const REG_SZ = 1;
export const REG_EXPAND_SZ = 2;
export const REG_BINARY = 3;
export const REG_DWORD = 4;
export const REG_MULTI_SZ = 7;
export const REG_QWORD = 11;

export interface RegValueDef {
  name: string;
  type: number;
  data: Uint8Array;
}
export interface RegKeyDef {
  name: string;
  values?: RegValueDef[];
  subkeys?: RegKeyDef[];
}

export const sz = (s: string): RegValueDef["data"] => utf16(s + "\0");
export const dword = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
};
export const qword = (n: bigint): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};
export const multiSz = (items: string[]): Uint8Array => utf16(items.join("\0") + "\0\0");
function utf16(s: string): Uint8Array {
  const b = new Uint8Array(s.length * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) v.setUint16(i * 2, s.charCodeAt(i), true);
  return b;
}

const NIL = 0xffffffff;
const BASE = 0x1000;
const KEY_HIVE_ENTRY = 0x04;
const KEY_NO_DELETE = 0x08;
const KEY_COMP_NAME = 0x20;
const VALUE_COMP_NAME = 0x01;
const isAscii = (s: string) => /^[\x01-\x7f]*$/.test(s);
const upper = (c: number) => (c >= 0x61 && c <= 0x7a ? c - 32 : c);
const cmpCi = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = upper(a.charCodeAt(i));
    const y = upper(b.charCodeAt(i));
    if (x !== y) return x - y;
  }
  return a.length - b.length;
};

/** FILETIME of 2026-10-29T00:00:00Z, so fixtures are deterministic. */
export const FIXTURE_FILETIME = (BigInt(Date.UTC(2026, 9, 29)) + 11644473600000n) * 10000n;

export function buildHive(root: RegKeyDef, hiveName = "NTCORE"): Uint8Array {
  const cells: { idx: number; bytes: Uint8Array }[] = [];
  let cursor = 0x20; // after the 32-byte hbin header
  let keyCount = 0;

  const alloc = (payload: number) => {
    const size = Math.max(8, (payload + 4 + 7) & ~7);
    const bytes = new Uint8Array(size);
    new DataView(bytes.buffer).setInt32(0, -size, true); // negative = allocated
    const cell = { idx: cursor, bytes };
    cursor += size;
    cells.push(cell);
    return { idx: cell.idx, v: new DataView(bytes.buffer), bytes, put: (off: number, src: Uint8Array) => bytes.set(src, 4 + off) };
  };

  // security cell: self-relative SD with an empty DACL, shared by every key
  const sd = new Uint8Array(28);
  const sdv = new DataView(sd.buffer);
  sdv.setUint8(0, 1);
  sdv.setUint16(2, 0x8004, true); // SE_SELF_RELATIVE | SE_DACL_PRESENT
  sdv.setUint32(16, 20, true); // Dacl offset
  sdv.setUint8(20, 2); // ACL revision
  sdv.setUint16(22, 8, true); // AclSize
  const sk = alloc(20 + sd.length);
  sk.v.setUint16(4, 0x6b73, true); // "sk"
  sk.v.setUint32(8, sk.idx, true); // Flink
  sk.v.setUint32(12, sk.idx, true); // Blink
  sk.v.setUint32(20, sd.length, true);
  sk.put(20, sd);

  const writeKey = (def: RegKeyDef, parent: number, isRoot: boolean): number => {
    keyCount++;
    const comp = isAscii(def.name);
    const nameBytes = comp ? Uint8Array.from(def.name, (c) => c.charCodeAt(0)) : utf16(def.name);
    const nk = alloc(0x4c + nameBytes.length);
    const subs = [...(def.subkeys ?? [])].sort((a, b) => cmpCi(a.name, b.name));
    const subCells = subs.map((s) => ({ def: s, idx: writeKey(s, nk.idx, false) }));

    const vals = def.values ?? [];
    const valCells = vals.map((val) => {
      const vcomp = isAscii(val.name);
      const vname = vcomp ? Uint8Array.from(val.name, (c) => c.charCodeAt(0)) : utf16(val.name);
      const vk = alloc(0x14 + vname.length);
      vk.v.setUint16(4, 0x6b76, true); // "vk"
      vk.v.setUint16(6, vname.length, true);
      if (val.data.length <= 4 && val.data.length > 0) {
        vk.v.setUint32(8, (val.data.length | 0x80000000) >>> 0, true);
        vk.put(8, val.data);
      } else if (val.data.length === 0) {
        vk.v.setUint32(8, 0x80000000, true);
      } else {
        const d = alloc(val.data.length);
        d.put(0, val.data);
        vk.v.setUint32(8, val.data.length, true);
        vk.v.setUint32(12, d.idx, true);
      }
      vk.v.setUint32(16, val.type, true);
      vk.v.setUint16(20, vcomp ? VALUE_COMP_NAME : 0, true);
      vk.put(0x14, vname);
      return vk.idx;
    });
    let valueList = NIL;
    if (valCells.length) {
      const list = alloc(valCells.length * 4);
      valCells.forEach((c, i) => list.v.setUint32(4 + i * 4, c, true));
      valueList = list.idx;
    }
    let subList = NIL;
    if (subCells.length) {
      const lf = alloc(4 + subCells.length * 8);
      lf.v.setUint16(4, 0x666c, true); // "lf"
      lf.v.setUint16(6, subCells.length, true);
      subCells.forEach((s, i) => {
        lf.v.setUint32(8 + i * 8, s.idx, true);
        const hint = new Uint8Array(4);
        for (let j = 0; j < 4 && j < s.def.name.length; j++) hint[j] = s.def.name.charCodeAt(j) & 0xff;
        lf.put(8 + i * 8, hint);
      });
      subList = lf.idx;
    }
    const v = nk.v;
    v.setUint16(4, 0x6b6e, true); // "nk"
    v.setUint16(6, (isRoot ? KEY_HIVE_ENTRY | KEY_NO_DELETE : 0) | (comp ? KEY_COMP_NAME : 0), true);
    v.setBigUint64(8, FIXTURE_FILETIME, true);
    v.setUint32(20, isRoot ? NIL : parent, true);
    v.setUint32(24, subCells.length, true);
    v.setUint32(28, 0, true);
    v.setUint32(32, subList, true);
    v.setUint32(36, NIL, true);
    v.setUint32(40, valCells.length, true);
    v.setUint32(44, valueList, true);
    v.setUint32(48, sk.idx, true);
    v.setUint32(52, NIL, true); // class
    v.setUint32(56, Math.max(0, ...subs.map((s) => s.name.length * 2)), true);
    v.setUint32(60, 0, true);
    v.setUint32(64, Math.max(0, ...vals.map((x) => x.name.length * 2)), true);
    v.setUint32(68, Math.max(0, ...vals.map((x) => x.data.length)), true);
    v.setUint32(72, 0, true);
    v.setUint16(76, nameBytes.length, true);
    v.setUint16(78, 0, true);
    nk.bytes.set(nameBytes, 4 + 0x4c);
    return nk.idx;
  };

  const rootIdx = writeKey(root, NIL, true);
  sk.v.setUint32(16, keyCount, true); // reference count

  const binSize = Math.max(0x1000, Math.ceil(cursor / 0x1000) * 0x1000);
  const out = new Uint8Array(BASE + binSize);
  const ov = new DataView(out.buffer);
  // hbin header
  ov.setUint32(BASE, 0x6e696268, true); // "hbin"
  ov.setUint32(BASE + 4, 0, true);
  ov.setUint32(BASE + 8, binSize, true);
  // leftover space becomes one free cell (positive size)
  for (const c of cells) out.set(c.bytes, BASE + c.idx);
  if (cursor < binSize) ov.setInt32(BASE + cursor, binSize - cursor, true);
  // base block
  ov.setUint32(0, 0x66676572, true); // "regf"
  ov.setUint32(4, 1, true);
  ov.setUint32(8, 1, true);
  ov.setBigUint64(12, FIXTURE_FILETIME, true);
  ov.setUint32(20, 1, true); // major
  ov.setUint32(24, 3, true); // minor
  ov.setUint32(28, 0, true); // type: primary
  ov.setUint32(32, 1, true); // format
  ov.setUint32(36, rootIdx, true);
  ov.setUint32(40, binSize, true);
  ov.setUint32(44, 1, true); // cluster
  for (let i = 0; i < Math.min(31, hiveName.length); i++) ov.setUint16(48 + i * 2, hiveName.charCodeAt(i), true);
  let sum = 0;
  for (let i = 0; i < 127; i++) sum ^= ov.getUint32(i * 4, true);
  if (sum === 0xffffffff) sum = 0xfffffffe;
  else if (sum === 0) sum = 1;
  ov.setUint32(0x1fc, sum >>> 0, true);
  return out;
}
