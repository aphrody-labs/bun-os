import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { decodeScreenshotPng, pngHasLitPixel } from "../web-emulation/png";

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 4, "ascii");
  out.set(body, 8);
  return out;
}

function screenshot(filter: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  // Two RGBA pixels, using the PNG Sub filter when requested.
  const row = filter === 1 ? [1, 20, 2, 3, 255, 10, 3, 4, 0] : [filter, 20, 2, 3, 255, 30, 5, 7, 255];
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Uint8Array.from(row))),
    chunk("IEND", new Uint8Array()),
  ]);
}

test("screenshot PNG decoding preserves RGBA pixels and detects lit content", () => {
  for (const filter of [0, 1]) {
    const png = screenshot(filter);
    const image = decodeScreenshotPng(png);
    expect([image.width, image.height]).toEqual([2, 1]);
    expect([...image.data]).toEqual([20, 2, 3, 255, 30, 5, 7, 255]);
    expect(pngHasLitPixel(png)).toBe(true);
  }
});

test("screenshot PNG decoding rejects malformed or unsupported input", () => {
  expect(() => decodeScreenshotPng(new Uint8Array(8))).toThrow("signature");
  expect(() => decodeScreenshotPng(screenshot(5))).toThrow("filter");
  expect(() => decodeScreenshotPng(screenshot(0).subarray(0, 30))).toThrow("truncated");
});
