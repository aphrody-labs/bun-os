// SPDX-License-Identifier: Apache-2.0
/// <reference lib="es2023.array" />
// Reference fixture for crates/aphrody-m3-tokens's image quantization port (quantize_wu,
// quantize_wsmeans, quantize, score, image): computed by @material/material-color-utilities so
// `cargo test -p aphrody-m3-tokens` can assert bit-exact results.
//
// The reference's QuantizerWsmeans seeds its K-Means initial cluster assignment (and, when
// startingClusters is short, extra L*a*b* clusters) from `Math.random()`, which has no fixed
// seed and would make both this fixture and the Rust port it drives non-reproducible. This
// script overrides `Math.random` with `mulberry32`, seeded, before calling into MCU; the Rust
// port (crates/aphrody-m3-tokens/src/quantize_wsmeans.rs `Rng`) implements the exact same
// generator so both sides draw an identical float sequence from an identical seed. See that
// module's doc comment for the full rationale.
//
//   bun run packages/m3-theme/scripts/mcu-image-fixture.ts

import { QuantizerCelebi, Score } from "@material/material-color-utilities";
import { join } from "node:path";

const OUT_JSON = join(import.meta.dir, "../../../../crates/aphrody-m3-tokens/tests/fixtures/mcu-image.json");
const OUT_IMAGES_DIR = join(import.meta.dir, "../../../../crates/aphrody-m3-tokens/tests/fixtures/images");

/** The default seed `quantize::DEFAULT_SEED` in the Rust port uses. */
const DEFAULT_SEED = 0x6750a4b1;

/** Same 32-bit generator as `quantize_wsmeans::Rng`; see the module doc for why. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

// ── Minimal PNG encoder (no external deps): 8-bit RGBA, filter type 0, zlib via Bun.deflateSync.

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, false);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, Bun.hash.crc32(body), false);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(len, 0);
  out.set(body, 4);
  out.set(crc, 4 + body.length);
  return out;
}

/** RFC 1950 Adler-32, the checksum a zlib stream trails with. */
function adler32(data: Uint8Array): number {
  const MOD_ADLER = 65521;
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wraps a raw DEFLATE stream (what `Bun.deflateSync` produces) in the RFC 1950 zlib container
 *  PNG's IDAT chunk requires: a 2-byte header plus a trailing Adler-32 of the uncompressed data. */
function toZlibStream(rawDeflate: Uint8Array, uncompressed: Uint8Array): Uint8Array {
  const header = new Uint8Array([0x78, 0x9c]); // CMF/FLG: deflate, 32K window, default level
  const checksum = new Uint8Array(4);
  new DataView(checksum.buffer).setUint32(0, adler32(uncompressed), false);
  const out = new Uint8Array(header.length + rawDeflate.length + checksum.length);
  out.set(header, 0);
  out.set(rawDeflate, header.length);
  out.set(checksum, header.length + rawDeflate.length);
  return out;
}

/** Encodes tightly packed RGBA8 pixels (row-major, no padding) as a real PNG file. */
function encodePng(width: number, height: number, rgba8: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba8.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idatData = toZlibStream(Bun.deflateSync(raw), raw);

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", idatData), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ── Synthetic RGBA8 pixel generators.

function solid(width: number, height: number, r: number, g: number, b: number, a = 255): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set([r, g, b, a], i * 4);
  return out;
}

function checkerboard(
  width: number,
  height: number,
  c1: [number, number, number],
  c2: [number, number, number],
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? c1 : c2;
      const i = (y * width + x) * 4;
      out.set([c[0], c[1], c[2], 255], i);
    }
  }
  return out;
}

function gradient(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.floor((x / (width - 1)) * 255);
      const g = Math.floor((y / (height - 1)) * 255);
      const b = 128;
      const i = (y * width + x) * 4;
      out.set([r, g, b, 255], i);
    }
  }
  return out;
}

function brandPalette(width: number, height: number): Uint8Array {
  // Four quadrants, each a distinct brand-ish hue with some opaque and some transparent pixels.
  const colors: Array<[number, number, number, number]> = [
    [0x67, 0x50, 0xa4, 255], // M3 seed purple
    [0x1a, 0x73, 0xe8, 255], // Google blue
    [0xce, 0x42, 0x2b, 128], // half-transparent brick red (dropped by alpha<255)
    [0x16, 0xa3, 0x4a, 255], // green
  ];
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const qx = x < width / 2 ? 0 : 1;
      const qy = y < height / 2 ? 0 : 1;
      const c = colors[qy * 2 + qx]!;
      const i = (y * width + x) * 4;
      out.set(c, i);
    }
  }
  return out;
}

interface FixtureImage {
  name: string;
  width: number;
  height: number;
  seed: number;
  /** Pixels quantized to at most this many colors before scoring (matches `sourceColorFromImageBytes`). */
  maxColors: number;
  /** `QuantizerCelebi.quantize(pixels, maxColors)` result, as sorted `[argb, population]` pairs
   *  (sorted for a diff-stable fixture; the Rust test re-sorts its own result the same way). */
  quantized: Array<[number, number]>;
  /** `Score.score(quantized)` with defaults (desired 4, Google Blue fallback, filter on). */
  scoreDefault: number[];
  /** The reference's `sourceColorFromImageBytes` result: `Score.score(quantized)[0]`. */
  sourceColor: number;
  /** Relative path (from this fixture file) to the committed PNG encoding the same pixels. */
  pngPath: string;
}

function rgbaToArgbPixels(rgba8: Uint8Array): number[] {
  const pixels: number[] = [];
  for (let i = 0; i < rgba8.length; i += 4) {
    const r = rgba8[i]!;
    const g = rgba8[i + 1]!;
    const b = rgba8[i + 2]!;
    const a = rgba8[i + 3]!;
    if (a < 255) continue;
    pixels.push(((255 << 24) | (r << 16) | (g << 8) | b) >>> 0);
  }
  return pixels;
}

async function main() {
  await Bun.$`mkdir -p ${OUT_IMAGES_DIR}`.quiet();

  const cases: Array<{
    name: string;
    width: number;
    height: number;
    rgba8: Uint8Array;
  }> = [
    {
      name: "solid_red_8x8",
      width: 8,
      height: 8,
      rgba8: solid(8, 8, 255, 0, 0),
    },
    {
      name: "solid_seed_purple_16x16",
      width: 16,
      height: 16,
      rgba8: solid(16, 16, 0x67, 0x50, 0xa4),
    },
    {
      name: "checkerboard_32x32",
      width: 32,
      height: 32,
      rgba8: checkerboard(32, 32, [0x1a, 0x73, 0xe8], [0xff, 0xff, 0xff]),
    },
    { name: "gradient_48x48", width: 48, height: 48, rgba8: gradient(48, 48) },
    {
      name: "brand_palette_40x40",
      width: 40,
      height: 40,
      rgba8: brandPalette(40, 40),
    },
  ];

  const images: FixtureImage[] = await Promise.all(
    cases.map(async ({ name, width, height, rgba8 }) => {
      const png = encodePng(width, height, rgba8);
      const pngRelPath = `images/${name}.png`;
      await Bun.write(join(OUT_IMAGES_DIR, `${name}.png`), png);
      if (png.length > 200 * 1024) {
        throw new Error(`${name}.png is ${png.length} bytes, over the 200KB budget`);
      }

      const pixels = rgbaToArgbPixels(rgba8);
      const maxColors = 128;
      const { quantized, sourceColor, scoreDefault } = withSeededRandom(DEFAULT_SEED, () => {
        const result = QuantizerCelebi.quantize(pixels, maxColors);
        const scores = Score.score(result);
        return {
          quantized: [...result.entries()].toSorted((a, b) => a[0] - b[0]) as Array<[number, number]>,
          scoreDefault: scores,
          sourceColor: scores[0]!,
        };
      });

      return {
        name,
        width,
        height,
        seed: DEFAULT_SEED,
        maxColors,
        quantized,
        scoreDefault,
        sourceColor,
        pngPath: pngRelPath,
      };
    }),
  );

  await Bun.write(OUT_JSON, `${JSON.stringify({ images }, null, 2)}\n`);
  console.log(`Wrote ${images.length} image fixtures to ${OUT_JSON}`);
}

await main();
