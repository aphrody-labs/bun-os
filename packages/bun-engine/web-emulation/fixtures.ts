// SPDX-License-Identifier: Apache-2.0
// Free test content for the WebOS emulator qualification: source-licensed homebrew and test ROMs only,
// never commercial images. The DS and 3DS fixtures come from the bep ROM cache (pinned in
// web-emulation.lock.json); the NES and GBA ones are the MIT/zlib test ROMs bundled by the pinned emulator
// sources; the PlayStation one is a PS-EXE generated here (it draws two filled rectangles through GP0).
import { join, resolve } from "node:path";
import { EMULATORS, SESSION, type EmulatorFixture } from "./emulators";

const root = resolve(import.meta.dir, "../../..");

const word = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
const lui = (rt: number, imm: number) => 0x3c000000 | (rt << 16) | (imm & 0xffff);
const ori = (rt: number, rs: number, imm: number) => 0x34000000 | (rs << 21) | (rt << 16) | (imm & 0xffff);
const sw = (rt: number, offset: number, rs: number) => 0xac000000 | (rs << 21) | (rt << 16) | (offset & 0xffff);

/** PS-EXE that configures a 320x240 display and fills two rectangles with GP0 command 0x02. */
export function psxGp0FillExe(): Uint8Array {
  const T0 = 8;
  const T1 = 9;
  const base = 0x80010000;
  const code: number[] = [lui(T0, 0x1f80)];
  const gp1 = (value: number) => {
    code.push(lui(T1, value >>> 16), ori(T1, T1, value & 0xffff), sw(T1, 0x1814, T0));
  };
  const gp0 = (value: number) => {
    code.push(lui(T1, value >>> 16), ori(T1, T1, value & 0xffff), sw(T1, 0x1810, T0));
  };
  gp1(0x00000000); // reset GPU
  gp1(0x03000000); // display on
  gp1(0x08000001); // 320x240 NTSC 15-bit
  gp1(0x05000000); // display area at 0,0
  gp1(0x06c60260); // horizontal range
  gp1(0x07040010); // vertical range
  gp0(0x02ff0000); // fill: blue
  gp0(0x00000000); // at 0,0
  gp0(0x00f00140); // 320x240
  gp0(0x0200ff00); // fill: green
  gp0(0x00500060); // at x=96,y=80
  gp0(0x00800080); // 128x128
  const loop = base + code.length * 4;
  code.push(0x08000000 | ((loop >>> 2) & 0x03ffffff), 0);
  const body = new Uint8Array(0x800);
  code.forEach((instruction, index) => body.set(word(instruction), index * 4));
  const header = new Uint8Array(0x800);
  header.set(new TextEncoder().encode("PS-X EXE"), 0);
  header.set(word(base), 0x10); // pc
  header.set(word(0), 0x14); // gp
  header.set(word(base), 0x18); // load address
  header.set(word(body.length), 0x1c); // size
  header.set(word(0x801fff00), 0x30); // stack
  header.set(new TextEncoder().encode("Sony Computer Entertainment Inc. for North America area"), 0x4c);
  const out = new Uint8Array(header.length + body.length);
  out.set(header);
  out.set(body, header.length);
  return out;
}

async function sourceOf(fixture: EmulatorFixture): Promise<Uint8Array> {
  if (fixture.pack === "psx-gp0-fill") return psxGp0FillExe();
  const path =
    fixture.pack === "tetanes-test-roms"
      ? join(root, "vendor/tetanes/tetanes-core/test_roms", fixture.file)
      : fixture.pack === "gba-tests"
        ? join(root, "vendor/rustboyadvance-ng/external/gba-tests/ppu", fixture.file)
        : join(root, "usr/var/cache/bep/roms", fixture.pack, fixture.file);
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Test ROM missing: ${path}`);
  return new Uint8Array(await file.arrayBuffer());
}

const hex = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Writes every fixture of the catalog under <objects>/emulation/fixtures/<pack>/<file>; returns sha256 per emulator. */
export async function stageFixtures(objects: string): Promise<Record<string, { sha256: string; error?: string }>> {
  const out: Record<string, { sha256: string; error?: string }> = {};
  const lock = await Bun.file(join(import.meta.dir, "web-emulation.lock.json")).json();
  for (const emulator of EMULATORS) {
    const fixture = emulator.fixture;
    if (!fixture) continue;
    try {
      const bytes = await sourceOf(fixture);
      const sha256 = hex(bytes);
      const pin = lock.testContent?.[fixture.pack]?.sha256;
      if (pin && pin !== sha256)
        throw new Error(`${fixture.pack}: digest ${sha256} does not match the lock pin ${pin}`);
      await Bun.write(join(objects, "emulation/fixtures", fixture.pack, fixture.file), bytes);
      out[emulator.id] = { sha256 };
    } catch (error) {
      out[emulator.id] = { sha256: "", error: String((error as Error).message ?? error) };
    }
  }
  return out;
}

/** Writes <objects>/emulators/emulators.json: the catalog the WebOS server merges with qualification.json. */
export async function writeCatalog(objects: string) {
  await Bun.write(
    join(objects, "emulators/emulators.json"),
    `${JSON.stringify(EMULATORS.map((e) => ({ ...e, ...(SESSION[e.id] ? { session: SESSION[e.id] } : {}) })), null, 2)}
`,
  );
}

/**
 * Extra free test content of the Gamescope session qualification (SESSION in emulators.ts), fetched once into the bep
 * ROM cache and verified by sha256: GPL-2.0 Swiss (GameCube homebrew DOL), a public-domain (Unlicense) N64 demo by
 * Peter Lemon, and a MAME ROM released by its rights holders for free non-commercial use (mamedev.org/roms).
 */
export const SESSION_FIXTURES: Record<string, { file: string; url: string; sha256: string; license: string; member?: string; memberSha256?: string }> = {
  "swiss-gc": {
    file: "swiss_r2119.dol",
    url: "https://github.com/emukidid/swiss-gc/releases/download/v0.6r2119/swiss_r2119.tar.xz",
    sha256: "97825799dfbe44cca08d1e49f95d15cc996bd15a052f48827b48162005cbe916",
    member: "swiss_r2119/DOL/swiss_r2119.dol",
    memberSha256: "3a19ea4b814ed7d43d7dbc81c49f981c215698cfaae6ed7bca471517a74aa1d1",
    license: "GPL-2.0 (emukidid/swiss-gc)",
  },
  "peterlemon-n64": {
    file: "Mandelbrot32BPP320X240.N64",
    url: "https://raw.githubusercontent.com/PeterLemon/N64/7085543e4a19d8c539fc9e0a4d2869e788b4ed4b/CP1/Fractal/32BPP/320X240/Mandelbrot/Single/Mandelbrot32BPP320X240.N64",
    sha256: "f15ff93f1467abf8b2dcdb69adbdeff23ee58e067ddf4c6ab0b6b0f8d97239db",
    license: "Unlicense (PeterLemon/N64)",
  },
  "mamedev-gridlee": {
    file: "gridlee.zip",
    url: "https://www.mamedev.org/roms/gridlee/gridlee.zip",
    sha256: "df977ceba0ae1c8d0ecf489ae8423390ff5c7c76ce95f5ee6ba9bc892b18056e",
    license: "Free for non-commercial use, released by the rights holders through mamedev.org",
  },
};

/** Stages SESSION_FIXTURES under <objects>/emulation/fixtures/<pack>/<file>, downloading into the bep cache once. */
export async function stageSessionFixtures(objects: string) {
  for (const [pack, f] of Object.entries(SESSION_FIXTURES)) {
    const cache = join(root, "usr/var/cache/bep/roms", pack);
    const archive = join(cache, f.url.split("/").pop()!);
    if (!(await Bun.file(archive).exists()) || hex(new Uint8Array(await Bun.file(archive).arrayBuffer())) !== f.sha256) {
      const response = await fetch(f.url);
      if (!response.ok) throw new Error(`${pack}: ${f.url} ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (hex(bytes) !== f.sha256) throw new Error(`${pack}: digest mismatch for ${f.url}`);
      await Bun.write(archive, bytes);
    }
    let bytes = new Uint8Array(await Bun.file(archive).arrayBuffer());
    if (f.member) {
      const out = Bun.spawnSync(["tar", "-xJOf", archive, f.member]);
      if (out.exitCode) throw new Error(`${pack}: cannot extract ${f.member}`);
      bytes = new Uint8Array(out.stdout);
      if (hex(bytes) !== f.memberSha256) throw new Error(`${pack}: ${f.member} digest mismatch`);
    }
    await Bun.write(join(objects, "emulation/fixtures", pack, f.file), bytes);
  }
}
