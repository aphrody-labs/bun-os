// SPDX-License-Identifier: Apache-2.0
// Lit-pixel check of a PNG screenshot (Chrome CDP captures, gamescope screenshots) without an image library.
import { inflateSync } from "node:zlib";

/** Decodes a non-interlaced 8-bit PNG (Chrome screenshots) and reports whether any pixel channel exceeds 16. */
export function pngHasLitPixel(png: Uint8Array): boolean {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data: Uint8Array[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("unsupported PNG (need 8-bit, non-interlaced)");
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : body[9] === 0 ? 1 : 0;
      if (!channels) throw new Error("unsupported PNG color type");
    } else if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
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
      if (line[p]! > 16 || line[p + (channels > 2 ? 1 : 0)]! > 16 || line[p + (channels > 2 ? 2 : 0)]! > 16)
        return true;
    }
    previous = line;
  }
  return false;
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
