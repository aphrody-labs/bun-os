// SPDX-License-Identifier: Apache-2.0
// Lit-pixel check of a PNG screenshot (Chrome CDP captures, gamescope screenshots) without an image library.
import { inflateSync } from "node:zlib";

/** Decode a bounded non-interlaced 8-bit Chrome screenshot to RGBA8. */
export function decodeScreenshotPng(png: Uint8Array): { width: number; height: number; data: Uint8Array } {
  if (png.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => png[index] === byte))
    throw new Error("invalid PNG signature");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Uint8Array[] = [];
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error("truncated PNG chunk");
    const length = view.getUint32(offset);
    if (length > png.length - offset - 12) throw new Error("truncated PNG chunk");
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (length !== 13 || channels) throw new Error("invalid PNG header");
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("unsupported PNG (need 8-bit, non-interlaced)");
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : body[9] === 0 ? 1 : 0;
      if (!channels) throw new Error("unsupported PNG color type");
    } else if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  if (!width || !height || !channels || width * height > 16_777_216 || !data.length)
    throw new Error("invalid or oversized PNG dimensions");
  const stride = width * channels;
  const expected = (stride + 1) * height;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error("invalid PNG scanline size");
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    if (filter > 4) throw new Error("unsupported PNG filter");
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      const predictor =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, upLeft)
                : 0;
      line[x] = (line[x]! + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const p = x * channels;
      const target = (y * width + x) * 4;
      rgba[target] = line[p]!;
      rgba[target + 1] = line[p + (channels > 2 ? 1 : 0)]!;
      rgba[target + 2] = line[p + (channels > 2 ? 2 : 0)]!;
      rgba[target + 3] = channels === 4 ? line[p + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, data: rgba };
}

/** Report whether any decoded RGB channel exceeds 16. */
export function pngHasLitPixel(png: Uint8Array): boolean {
  const { data } = decodeScreenshotPng(png);
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 16 || data[i + 1]! > 16 || data[i + 2]! > 16) return true;
  return false;
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
