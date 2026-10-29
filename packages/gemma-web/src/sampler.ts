// SPDX-License-Identifier: Apache-2.0
export interface SamplerOptions {
  temperature?: number;
  topK?: number;
  topP?: number;
  seed?: number;
}

/** Small deterministic PRNG so tests and benchmarks are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function argmax(logits: Float32Array): number {
  let best = 0;
  let bv = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i]!;
    if (v > bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}

/** temperature -> top-k -> top-p -> multinomial. temperature <= 0 is greedy. */
export function sampleToken(logits: Float32Array, o: SamplerOptions, rnd: () => number = Math.random): number {
  const t = o.temperature ?? 1;
  if (t <= 0) return argmax(logits);
  const k = Math.max(1, Math.min(o.topK && o.topK > 0 ? o.topK : logits.length, logits.length));
  const ids = new Int32Array(k);
  const vals = new Float32Array(k).fill(-Infinity);
  let n = 0;
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i]!;
    if (n === k && v <= vals[k - 1]!) continue;
    let j = n < k ? n++ : k - 1;
    while (j > 0 && vals[j - 1]! < v) {
      vals[j] = vals[j - 1]!;
      ids[j] = ids[j - 1]!;
      j--;
    }
    vals[j] = v;
    ids[j] = i;
  }
  const max = vals[0]!;
  const probs = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += probs[i] = Math.exp((vals[i]! - max) / t);
  const topP = o.topP && o.topP > 0 && o.topP < 1 ? o.topP : 1;
  let cut = n;
  if (topP < 1) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += probs[i]! / sum;
      if (acc >= topP) {
        cut = i + 1;
        break;
      }
    }
  }
  let total = 0;
  for (let i = 0; i < cut; i++) total += probs[i]!;
  let r = rnd() * total;
  for (let i = 0; i < cut; i++) {
    r -= probs[i]!;
    if (r <= 0) return ids[i]!;
  }
  return ids[cut - 1]!;
}
