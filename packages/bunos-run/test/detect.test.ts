import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect, parsePe, plan } from "../src/bunos.ts";

const dir = mkdtempSync(join(tmpdir(), "bunos-"));
const put = (name: string, bytes: number[] | string) => {
  const p = join(dir, name);
  writeFileSync(p, typeof bytes === "string" ? bytes : Uint8Array.from(bytes));
  return p;
};

test("wasm core vs component", () => {
  expect(detect(put("a.wasm", [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])).kind).toBe("wasm-core");
  expect(detect(put("b.wasm", [0, 0x61, 0x73, 0x6d, 0x0d, 0, 1, 0])).kind).toBe("wasm-component");
});

test("ELF machine and libc", () => {
  const elf = new Uint8Array(64);
  elf.set([0x7f, 0x45, 0x4c, 0x46]);
  elf[18] = 0xb7; // aarch64
  const d = detect(put("a.elf", [...elf]));
  expect(d.kind).toBe("elf");
  expect(d.detail.machine).toBe("aarch64");
});

test("AppImage type 2 magic", () => {
  const b = new Uint8Array(64);
  b.set([0x7f, 0x45, 0x4c, 0x46]);
  b.set([0x41, 0x49, 0x02], 8);
  expect(detect(put("a.AppImage", [...b])).kind).toBe("appimage");
});

test("scripts and unknown", () => {
  expect(detect(put("a.ts", "console.log(1)")).kind).toBe("script-js");
  expect(detect(put("run", "#!/bin/sh\necho\n")).kind).toBe("script-shebang");
  expect(plan(put("z.bin", "zzz"), []).unsupported).toContain("unknown file type");
});

// Minimal PE32+ with one import (kernel32.dll) built by hand: the parser must list it.
test("PE import table", () => {
  const b = new Uint8Array(0x800);
  const dv = new DataView(b.buffer);
  b[0] = 0x4d; b[1] = 0x5a;
  dv.setUint32(0x3c, 0x80, true);
  const nt = 0x80;
  dv.setUint32(nt, 0x4550, true);
  dv.setUint16(nt + 4, 0x8664, true); // machine
  dv.setUint16(nt + 6, 1, true); // sections
  dv.setUint16(nt + 20, 240, true); // optional header size
  dv.setUint16(nt + 22, 0x22, true);
  const opt = nt + 24;
  dv.setUint16(opt, 0x20b, true);
  dv.setUint16(opt + 68, 3, true); // console
  dv.setUint32(opt + 112 + 8, 0x1000, true); // import directory rva
  dv.setUint32(opt + 112 + 12, 40, true);
  const sec = opt + 240;
  dv.setUint32(sec + 8, 0x400, true);
  dv.setUint32(sec + 12, 0x1000, true);
  dv.setUint32(sec + 16, 0x400, true);
  dv.setUint32(sec + 20, 0x400, true); // raw at 0x400
  dv.setUint32(0x400 + 12, 0x1100, true); // name rva
  new TextEncoder().encodeInto("KERNEL32.dll", b.subarray(0x400 + 0x100));
  const r = parsePe(b, dir, [])!;
  expect(r.machine).toBe("x86_64");
  expect(r.gui).toBe(false);
  expect(r.imports).toEqual(["KERNEL32.dll"]);
  expect(r.missing).toEqual(["KERNEL32.dll"]); // not present in the (empty) search dirs
});
