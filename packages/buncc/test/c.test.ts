import { expect, test } from "bun:test";
import { inspectBinary, loadCatalog, msLicenseAccepted, planBuild } from "../src/c/index.ts";

test("catalog: every msvc target is opt-in and every target has a verifier", () => {
  const cat = loadCatalog();
  for (const t of cat.targets) {
    expect(["pe", "elf"]).toContain(t.verify);
    if (t.abi === "msvc") expect(t.optIn).toBe("ms-license");
  }
  expect(cat.targets.some(t => t.os === "reactos")).toBe(true);
});

test("msvc licence needs an explicit flag", () => {
  const saved = process.env.BUNOS_C_ACCEPT_MS_LICENSE;
  delete process.env.BUNOS_C_ACCEPT_MS_LICENSE;
  expect(msLicenseAccepted([])).toBe(false);
  expect(msLicenseAccepted(["--accept-ms-license"])).toBe(true);
  if (saved !== undefined) process.env.BUNOS_C_ACCEPT_MS_LICENSE = saved;
});

test("inspectBinary parses ELF and PE machine fields", () => {
  const elf = new Uint8Array(64);
  elf.set([0x7f, 0x45, 0x4c, 0x46]);
  new DataView(elf.buffer).setUint16(18, 183, true);
  expect(inspectBinary(elf)).toEqual({ format: "elf", arch: "aarch64" });
  const pe = new Uint8Array(256);
  pe.set([0x4d, 0x5a]);
  const dv = new DataView(pe.buffer);
  dv.setUint32(0x3c, 0x80, true);
  dv.setUint32(0x80, 0x4550, true);
  dv.setUint16(0x84, 0x8664, true);
  expect(inspectBinary(pe).arch).toBe("x86_64");
});

test("planBuild refuses the bunos target without its sysroot", () => {
  const t = loadCatalog().targets.find(x => x.os === "bun-os")!;
  delete process.env.BUNOS_C_SYSROOT_BUNOS;
  expect(planBuild(t, "a.c", "out").ok).toBe(false);
});
