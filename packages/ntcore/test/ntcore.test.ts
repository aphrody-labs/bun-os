import { beforeAll, describe, expect, test } from "bun:test";
import {
  HandleTable,
  NtCore,
  NtError,
  REG_BINARY,
  REG_DWORD,
  REG_MULTI_SZ,
  REG_QWORD,
  REG_SZ,
  buildHive,
  dword,
  multiSz,
  qword,
  sz,
  type RegKeyDef,
} from "../src/index.ts";

let nt: NtCore;
beforeAll(async () => {
  nt = await NtCore.load();
});

const text = (b: Uint8Array) => new TextDecoder("utf-16le").decode(b);

const fixture: RegKeyDef = {
  name: "ROOT",
  values: [{ name: "", type: REG_SZ, data: sz("default") }],
  subkeys: [
    {
      name: "Software",
      subkeys: [
        {
          name: "Bun OS",
          values: [
            { name: "Version", type: REG_SZ, data: sz("1.4.7") },
            { name: "Build", type: REG_DWORD, data: dword(0xdeadbeef) },
            { name: "Epoch", type: REG_QWORD, data: qword(134377056000000000n) },
            { name: "Blob", type: REG_BINARY, data: Uint8Array.from({ length: 300 }, (_, i) => i & 0xff) },
            { name: "Path", type: REG_MULTI_SZ, data: multiSz(["C:\\bun", "D:\\apps"]) },
            { name: "Tiny", type: REG_BINARY, data: Uint8Array.of(9) },
            { name: "Empty", type: REG_BINARY, data: new Uint8Array(0) },
          ],
          subkeys: [{ name: "Modules" }, { name: "Drivers" }, { name: "cache" }],
        },
        { name: "Zeta" },
      ],
    },
    { name: "Ünïcode ключ", values: [{ name: "значение", type: REG_SZ, data: sz("ok") }] },
    { name: "System" },
  ],
};

describe("registry hive (ReactOS cmlib in wasm)", () => {
  test("loads a regf image and the kernel consistency checker accepts it", () => {
    const h = nt.openHive(buildHive(fixture));
    expect(h.version).toBe(3);
    expect(h.check()).toBe(0);
    expect(h.info(h.root).name).toBe("ROOT");
    expect(h.info(h.root).lastWrite).toBe(134377056000000000n);
    h.close();
  });

  test("resolves paths case-insensitively, including non-ASCII names", () => {
    const h = nt.openHive(buildHive(fixture));
    const bun = h.open("software\\BUN OS");
    expect(bun).toBeDefined();
    expect(h.info(bun!).name).toBe("Bun OS");
    expect(h.open("\\Software\\Bun OS\\")).toBe(bun);
    expect(h.open("ünïcode КЛЮЧ")).toBeDefined();
    expect(h.open("Software\\Nope")).toBeUndefined();
    expect(h.open("Nope\\Bun OS")).toBeUndefined();
    expect(h.parent(bun!)).toBe(h.open("Software"));
    expect(h.parent(h.root)).toBeUndefined();
    h.close();
  });

  test("enumerates subkeys in the order the kernel indexes them", () => {
    const h = nt.openHive(buildHive(fixture));
    expect(h.subKeys(h.root)).toEqual(["Software", "System", "Ünïcode ключ"]);
    expect(h.subKeys(h.open("Software\\Bun OS")!)).toEqual(["cache", "Drivers", "Modules"]);
    h.close();
  });

  test("reads every value type, inline and out-of-line", () => {
    const h = nt.openHive(buildHive(fixture));
    const k = h.open("Software\\Bun OS")!;
    expect(h.info(k).values).toBe(7);
    expect(text(h.value(k, "version")!.data)).toBe("1.4.7\0");
    expect(new DataView(h.value(k, "BUILD")!.data.buffer).getUint32(0, true)).toBe(0xdeadbeef);
    expect(new DataView(h.value(k, "Epoch")!.data.buffer).getBigUint64(0, true)).toBe(134377056000000000n);
    const blob = h.value(k, "Blob")!;
    expect(blob.type).toBe(REG_BINARY);
    expect(blob.data.length).toBe(300);
    expect(blob.data[299]).toBe(299 & 0xff);
    expect(text(h.value(k, "Path")!.data)).toBe("C:\\bun\0D:\\apps\0\0");
    expect([...h.value(k, "Tiny")!.data]).toEqual([9]);
    expect(h.value(k, "Empty")!.data.length).toBe(0);
    expect(h.value(k, "Missing")).toBeUndefined();
    expect(h.values(k).map((v) => v.name)).toEqual(["Version", "Build", "Epoch", "Blob", "Path", "Tiny", "Empty"]);
    expect(text(h.value(h.root, "")!.data)).toBe("default\0");
    expect(text(h.value(h.open("Ünïcode ключ")!, "ЗНАЧЕНИЕ")!.data)).toBe("ok\0");
    h.close();
  });

  test("rejects images that are not valid hives, with the NTSTATUS from cmlib", () => {
    const good = buildHive(fixture);
    const bad = good.slice();
    bad[0] = 0x58; // signature
    expect(() => nt.openHive(bad)).toThrow(NtError);
    const badSum = good.slice();
    badSum[0x1fc]! ^= 0xff;
    expect(() => nt.openHive(badSum)).toThrow(/NTSTATUS 0xc/);
    expect(() => nt.openHive(good.slice(0, 0x800))).toThrow(NtError);
    expect(() => nt.openHive(new Uint8Array(0))).toThrow(NtError);
  });

  test("the consistency checker flags a corrupted key node", () => {
    const img = buildHive(fixture);
    const dv = new DataView(img.buffer);
    const rootCell = dv.getUint32(36, true);
    dv.setUint16(0x1000 + rootCell + 4, 0x4141, true); // nk signature of the root
    let rejected = false;
    try {
      const h = nt.openHive(img);
      rejected = h.check() !== 0;
      h.close();
    } catch (e) {
      rejected = e instanceof NtError;
    }
    expect(rejected).toBe(true);
  });

  test("hive ids are recycled after close and memory is reclaimed", () => {
    const img = buildHive(fixture);
    const a = nt.openHive(img);
    const id = a.id;
    a.close();
    const before = nt.memoryBytes;
    for (let i = 0; i < 40; i++) {
      const h = nt.openHive(img);
      expect(h.id).toBe(id);
      h.close();
    }
    expect(nt.memoryBytes).toBe(before);
  });

  test("a large hive with 2000 keys indexes and finds all of them", () => {
    const subkeys = Array.from({ length: 2000 }, (_, i) => ({ name: `key${String(i).padStart(4, "0")}` }));
    const h = nt.openHive(buildHive({ name: "BIG", subkeys }));
    expect(h.check()).toBe(0);
    expect(h.info(h.root).subKeys).toBe(2000);
    for (const i of [0, 1, 999, 1999]) expect(h.open(`KEY${String(i).padStart(4, "0")}`)).toBeDefined();
    expect(h.open("key2000")).toBeUndefined();
    h.close();
  });
});

describe("handle table (ReactOS ntoskrnl/ex/handle.c in wasm)", () => {
  test("hands out multiples of four starting at 4, tracks the access mask", () => {
    const t = nt.createHandleTable();
    const o1 = HandleTable.token();
    const o2 = HandleTable.token();
    const h1 = t.create(o1, 0x1f0003);
    const h2 = t.create(o2, 0x2);
    expect(h1).toBe(4);
    expect(h2).toBe(8);
    expect(t.lookup(h1)).toEqual({ object: o1, access: 0x1f0003 });
    expect(t.lookup(h2)).toEqual({ object: o2, access: 2 });
    t.destroy();
  });

  test("invalid, closed and zero handles do not resolve; double close fails", () => {
    const t = nt.createHandleTable();
    const h = t.create(HandleTable.token());
    expect(t.lookup(0)).toBeUndefined();
    expect(t.lookup(h + 4)).toBeUndefined();
    expect(t.lookup(0x12345678)).toBeUndefined();
    expect(t.close(h)).toBe(true);
    expect(t.lookup(h)).toBeUndefined();
    expect(t.close(h)).toBe(false);
    expect(t.close(0xfffc)).toBe(false);
    t.destroy();
  });

  test("freed slots are reused and the table grows across levels (5000 live handles)", () => {
    const t = nt.createHandleTable();
    const tokens = new Map<number, number>();
    for (let i = 0; i < 5000; i++) {
      const o = HandleTable.token();
      const h = t.create(o, i);
      expect(h % 4).toBe(0);
      expect(tokens.has(h)).toBe(false);
      tokens.set(h, o);
    }
    for (const [h, o] of tokens) expect(t.lookup(h)?.object).toBe(o);
    const maxOld = Math.max(...tokens.keys());
    for (const h of tokens.keys()) expect(t.close(h)).toBe(true);
    for (const h of tokens.keys()) expect(t.lookup(h)).toBeUndefined();
    // NT recycles freed slots (via the free list) before it grows the table again
    const again = new Set<number>();
    for (let i = 0; i < 5000; i++) again.add(t.create(HandleTable.token()));
    expect(again.size).toBe(5000);
    // the table was grown in 512-entry low-level pages (511 usable + 1 reserved) to hold 5000 handles: no growth now
    expect(Math.max(...again)).toBeLessThanOrEqual(Math.max(maxOld, 4 * 512 * Math.ceil(5000 / 511)));
    t.destroy();
  });

  test("tables are independent", () => {
    const a = nt.createHandleTable();
    const b = nt.createHandleTable();
    const ha = a.create(HandleTable.token());
    expect(b.lookup(ha)).toBeUndefined();
    expect(b.create(HandleTable.token())).toBe(ha);
    a.destroy();
    b.destroy();
  });

  test("rejects unaligned object tokens", () => {
    const t = nt.createHandleTable();
    expect(() => t.create(0x1001)).toThrow(RangeError);
    expect(() => t.create(0)).toThrow(RangeError);
    t.destroy();
  });
});

// ---- PE ---------------------------------------------------------------------------------------------------------
function buildPe(plus: boolean, opts: { machine?: number; entry?: number; base?: bigint } = {}): Uint8Array {
  const optSize = plus ? 240 : 224;
  const lfanew = 0x80;
  const secOff = lfanew + 24 + optSize;
  const img = new Uint8Array(0x600);
  const v = new DataView(img.buffer);
  img.set([0x4d, 0x5a]);
  v.setUint32(0x3c, lfanew, true);
  v.setUint32(lfanew, 0x4550, true);
  v.setUint16(lfanew + 4, opts.machine ?? (plus ? 0x8664 : 0x14c), true);
  v.setUint16(lfanew + 6, 2, true);
  v.setUint16(lfanew + 20, optSize, true);
  v.setUint16(lfanew + 22, plus ? 0x22 : 0x102, true);
  const oh = lfanew + 24;
  v.setUint16(oh, plus ? 0x20b : 0x10b, true);
  v.setUint32(oh + 16, opts.entry ?? 0x1010, true);
  if (plus) v.setBigUint64(oh + 24, opts.base ?? 0x140000000n, true);
  else v.setUint32(oh + 28, Number(opts.base ?? 0x400000n), true);
  v.setUint32(oh + 32, 0x1000, true); // SectionAlignment
  v.setUint32(oh + 36, 0x200, true); // FileAlignment
  v.setUint32(oh + 56, 0x4000, true); // SizeOfImage
  v.setUint32(oh + 60, 0x200, true); // SizeOfHeaders
  v.setUint16(oh + 68, 3, true); // CUI
  v.setUint16(oh + 70, 0x8160, true);
  const dd = oh + (plus ? 112 : 96);
  v.setUint32(dd - 4, 16, true);
  v.setUint32(dd + 8, 0x2000, true); // IMPORT rva
  v.setUint32(dd + 12, 40, true);
  const sec = (i: number, name: string, vsize: number, va: number, raw: number, ptr: number) => {
    const o = secOff + i * 40;
    for (let j = 0; j < name.length; j++) img[o + j] = name.charCodeAt(j);
    v.setUint32(o + 8, vsize, true);
    v.setUint32(o + 12, va, true);
    v.setUint32(o + 16, raw, true);
    v.setUint32(o + 20, ptr, true);
  };
  sec(0, ".text", 0x300, 0x1000, 0x200, 0x200);
  sec(1, ".idata", 0x100, 0x2000, 0x200, 0x400);
  return img;
}

describe("PE images (ReactOS rtl/image.c in wasm)", () => {
  test("PE32 (x86) headers", () => {
    const p = nt.inspectPe(buildPe(false));
    expect(p).toMatchObject({ machine: 0x14c, sections: 2, entryPointRva: 0x1010, sizeOfImage: 0x4000, subsystem: 3, magic: 0x10b, imageBase: 0x400000n, ntHeadersOffset: 0x80 });
    expect(p.characteristics).toBe(0x102);
    expect(p.dllCharacteristics).toBe(0x8160);
  });

  test("PE32+ (x64) headers keep the 64-bit image base", () => {
    const p = nt.inspectPe(buildPe(true));
    expect(p).toMatchObject({ machine: 0x8664, magic: 0x20b, imageBase: 0x140000000n, sections: 2 });
  });

  test("ARM64 machine type is reported as is", () => {
    expect(nt.inspectPe(buildPe(true, { machine: 0xaa64 })).machine).toBe(0xaa64);
  });

  test("RVAs map to file offsets through the section table", () => {
    for (const plus of [false, true]) {
      const img = buildPe(plus);
      expect(nt.rvaToOffset(img, 0x1010)).toBe(0x210);
      expect(nt.rvaToOffset(img, 0x2004)).toBe(0x404);
      expect(nt.rvaToOffset(img, 0x9000)).toBeUndefined();
    }
  });

  test("data directories", () => {
    for (const plus of [false, true]) {
      const img = buildPe(plus);
      expect(nt.peDirectory(img, 1)).toEqual({ rva: 0x2000, size: 40 });
      expect(nt.peDirectory(img, 0)).toEqual({ rva: 0, size: 0 });
      expect(nt.peDirectory(img, 16)).toBeUndefined();
    }
  });

  test("rejects non-PE data, bad e_lfanew and truncated files", () => {
    expect(() => nt.inspectPe(new Uint8Array(64))).toThrow(NtError);
    expect(() => nt.inspectPe(new TextEncoder().encode("MZ not really a PE file, just text"))).toThrow(NtError);
    const img = buildPe(false);
    new DataView(img.buffer).setUint32(0x3c, 0x7fffffff, true);
    expect(() => nt.inspectPe(img)).toThrow(NtError);
    expect(() => nt.inspectPe(buildPe(false).slice(0, 0x90))).toThrow(NtError);
    expect(() => nt.inspectPe(new Uint8Array(0))).toThrow(NtError);
  });
});
