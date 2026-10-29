import { expect, test } from "bun:test";
import { inspectBinary, loadCatalog, planBuild } from "../src/c/index.ts";

test("catalog: every msvc target is opt-in and every target has a verifier", () => {
  const cat = loadCatalog();
  for (const t of cat.targets) {
    expect(["pe", "elf"]).toContain(t.verify);
    if (t.abi === "msvc") expect(t.optIn).toBe("ms-license");
  }
  expect(cat.targets.some(t => t.os === "reactos")).toBe(true);
});

test("buncc has no Microsoft licence acceptance path", async () => {
  expect(await import("../src/c/index.ts")).not.toHaveProperty("msLicenseAccepted");
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
