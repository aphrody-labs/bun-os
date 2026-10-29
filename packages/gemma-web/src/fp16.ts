// SPDX-License-Identifier: Apache-2.0
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function halfToFloat(h: number): number {
  const s = (h & 0x8000) << 16;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  let bits: number;
  if (e === 0) {
    if (m === 0) bits = s;
    else {
      let mm = m;
      let ee = 113;
      while (!(mm & 0x400)) {
        mm <<= 1;
        ee--;
      }
      bits = s | (ee << 23) | ((mm & 0x3ff) << 13);
    }
  } else if (e === 31) bits = s | 0x7f800000 | (m << 13);
  else bits = s | ((e + 112) << 23) | (m << 13);
  u32[0] = bits >>> 0;
  return f32[0]!;
}

export function floatToHalf(v: number): number {
  f32[0] = v;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 112;
  let man = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    man = (man | 0x800000) >> (1 - exp);
    return sign | ((man + 0x1000) >> 13);
  }
  if (exp >= 31) return sign | 0x7c00 | (((x >>> 23) & 0xff) === 0xff && man ? 0x200 : 0);
  const r = sign | (exp << 10) | (man >> 13);
  return man & 0x1000 ? r + 1 : r;
}

/** Widen a half-precision buffer (Uint16Array bits or Float16Array) to Float32Array. */
export function toFloat32(data: ArrayLike<number>): Float32Array {
  if (data instanceof Float32Array) return data;
  const out = new Float32Array(data.length);
  const isBits = data instanceof Uint16Array;
  for (let i = 0; i < out.length; i++) out[i] = isBits ? halfToFloat(data[i]!) : data[i]!;
  return out;
}
