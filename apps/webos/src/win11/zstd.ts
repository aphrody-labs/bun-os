// SPDX-License-Identifier: Apache-2.0
// Zstandard frame decoder (RFC 8878) for the browser: `DecompressionStream` has no "zstd" format.
// Decodes every frame of `src` (skippable frames ignored, dictionaries unsupported, checksums skipped:
// the template manifest carries a SHA-256 per chunk).

const LL_BASE = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024,
  2048, 4096, 8192, 16384, 32768, 65536,
];
const LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ML_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
  35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539,
];
const ML_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4,
  4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];
const LL_DEFAULT = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1];
const ML_DEFAULT = [
  1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
];
const OF_DEFAULT = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1];

class ZstdError extends Error {
  override name = "ZstdError";
}
const fail = (message: string): never => {
  throw new ZstdError(message);
};
const highBit = (v: number) => 31 - Math.clz32(v);

/** Little-endian bit field of `n` bits (n <= 32) starting at absolute bit `pos`; bits before 0 read as zero. */
function bitsAt(src: Uint8Array, pos: number, n: number): number {
  if (n === 0) return 0;
  if (pos < 0) return n + pos <= 0 ? 0 : bitsAt(src, 0, n + pos) * 2 ** -pos;
  const i = pos >>> 3;
  const v = (src[i] ?? 0) + (src[i + 1] ?? 0) * 256 + (src[i + 2] ?? 0) * 65536 + (src[i + 3] ?? 0) * 16777216 + (src[i + 4] ?? 0) * 4294967296;
  return Math.floor(v / 2 ** (pos & 7)) % 2 ** n;
}

/** Reads a bitstream backwards from its end marker, as every zstd entropy stream is written. */
class BackwardBits {
  pos: number;
  constructor(
    readonly src: Uint8Array,
    readonly start: number,
    end: number,
  ) {
    if (end <= start) fail("empty bitstream");
    const last = src[end - 1]!;
    if (last === 0) fail("bitstream without end marker");
    this.pos = (end - 1) * 8 + highBit(last);
  }
  read(n: number): number {
    this.pos -= n;
    return bitsAt(this.src, this.pos, n) ;
  }
  peek(n: number): number {
    return bitsAt(this.src, this.pos - n, n);
  }
  /** True once more bits were consumed than the stream holds. */
  get overflow(): boolean {
    return this.pos < this.start * 8;
  }
}

/** Bits are addressed absolutely, so a stream that starts mid-buffer reads zeros below its start. */
function readBackward(bits: BackwardBits, n: number): number {
  bits.pos -= n;
  const floor = bits.start * 8;
  if (bits.pos >= floor) return bitsAt(bits.src, bits.pos, n);
  const have = bits.pos + n - floor;
  return have <= 0 ? 0 : bitsAt(bits.src, floor, have) * 2 ** (n - have);
}

interface FseTable {
  log: number;
  symbol: Uint8Array;
  bits: Uint8Array;
  base: Uint16Array;
}

function buildFse(norm: number[], log: number): FseTable {
  const size = 1 << log;
  const symbol = new Uint8Array(size);
  const bits = new Uint8Array(size);
  const base = new Uint16Array(size);
  const next = Array.from<number>({ length: norm.length });
  let high = size - 1;
  for (let s = 0; s < norm.length; s++) {
    if (norm[s] === -1) {
      symbol[high--] = s;
      next[s] = 1;
    } else next[s] = norm[s]!;
  }
  const step = (size >> 1) + (size >> 3) + 3;
  const mask = size - 1;
  let pos = 0;
  for (let s = 0; s < norm.length; s++) {
    for (let i = 0; i < norm[s]!; i++) {
      symbol[pos] = s;
      do pos = (pos + step) & mask;
      while (pos > high);
    }
  }
  if (pos !== 0) fail("corrupt FSE distribution");
  for (let u = 0; u < size; u++) {
    const s = symbol[u]!;
    const n = next[s]!++;
    const nb = log - highBit(n);
    bits[u] = nb;
    base[u] = (n << nb) - size;
  }
  return { log, symbol, bits, base };
}

function rleFse(symbol: number): FseTable {
  return { log: 0, symbol: Uint8Array.of(symbol), bits: Uint8Array.of(0), base: Uint16Array.of(0) };
}

/** FSE table description (normalized counts) at `src[at]`; returns the table and the bytes consumed. */
function readFseTable(src: Uint8Array, at: number, end: number, maxSymbol: number, maxLog: number): [FseTable, number] {
  let bit = at * 8;
  const take = (n: number) => {
    const v = bitsAt(src, bit, n);
    bit += n;
    return v;
  };
  const log = take(4) + 5;
  if (log > maxLog) fail("FSE accuracy log too large");
  let remaining = (1 << log) + 1;
  let threshold = 1 << log;
  let nbBits = log + 1;
  const norm: number[] = [];
  let previousZero = false;
  while (remaining > 1 && norm.length <= maxSymbol) {
    if (previousZero) {
      let repeat = take(2);
      let zeros = repeat;
      while (repeat === 3) {
        repeat = take(2);
        zeros += repeat;
      }
      for (let i = 0; i < zeros; i++) norm.push(0);
      if (norm.length > maxSymbol) break;
    }
    const max = 2 * threshold - 1 - remaining;
    let count: number;
    const low = bitsAt(src, bit, nbBits - 1);
    if (low < max) {
      count = low;
      bit += nbBits - 1;
    } else {
      count = bitsAt(src, bit, nbBits);
      if (count >= threshold) count -= max;
      bit += nbBits;
    }
    count--;
    remaining -= Math.abs(count);
    norm.push(count);
    previousZero = count === 0;
    while (remaining < threshold) {
      nbBits--;
      threshold >>= 1;
    }
  }
  if (remaining !== 1 || norm.length > maxSymbol + 1) fail("corrupt FSE table description");
  const used = Math.ceil((bit - at * 8) / 8);
  if (at + used > end) fail("FSE table description overruns the block");
  return [buildFse(norm, log), used];
}

interface Huffman {
  maxBits: number;
  symbol: Uint8Array;
  bits: Uint8Array;
}

/** Huffman tree description at `src[at]`; returns the table and the bytes consumed. */
function readHuffman(src: Uint8Array, at: number, end: number): [Huffman, number] {
  const header = src[at]!;
  const weights: number[] = [];
  let used: number;
  if (header >= 128) {
    const count = header - 127;
    used = 1 + Math.ceil(count / 2);
    if (at + used > end) fail("Huffman weights overrun the block");
    for (let i = 0; i < count; i++) {
      const b = src[at + 1 + (i >> 1)]!;
      weights.push(i & 1 ? b & 15 : b >> 4);
    }
  } else {
    used = 1 + header;
    if (at + used > end) fail("Huffman weights overrun the block");
    const [table, tableBytes] = readFseTable(src, at + 1, at + used, 255, 6);
    const stream = new BackwardBits(src, at + 1 + tableBytes, at + used);
    let s1 = readBackward(stream, table.log);
    let s2 = readBackward(stream, table.log);
    for (;;) {
      weights.push(table.symbol[s1]!);
      s1 = table.base[s1]! + readBackward(stream, table.bits[s1]!);
      if (stream.overflow) {
        weights.push(table.symbol[s2]!);
        break;
      }
      weights.push(table.symbol[s2]!);
      s2 = table.base[s2]! + readBackward(stream, table.bits[s2]!);
      if (stream.overflow) {
        weights.push(table.symbol[s1]!);
        break;
      }
      if (weights.length > 255) fail("too many Huffman weights");
    }
  }
  let sum = 0;
  for (const w of weights) if (w > 0) sum += 1 << (w - 1);
  if (sum === 0) fail("empty Huffman tree");
  const maxBits = highBit(sum) + 1;
  const rest = (1 << maxBits) - sum;
  if (rest & (rest - 1)) fail("corrupt Huffman weights");
  weights.push(highBit(rest) + 1);
  if (maxBits > 11) fail("Huffman code too long");
  const size = 1 << maxBits;
  const symbol = new Uint8Array(size);
  const bits = new Uint8Array(size);
  const rankStart = Array.from<number>({ length: maxBits + 2 }).fill(0);
  const rankCount = Array.from<number>({ length: maxBits + 2 }).fill(0);
  for (const w of weights) rankCount[w]!++;
  let next = 0;
  for (let w = 1; w <= maxBits; w++) {
    rankStart[w] = next;
    next += rankCount[w]! << (w - 1);
  }
  for (let s = 0; s < weights.length; s++) {
    const w = weights[s]!;
    if (w === 0) continue;
    const length = 1 << (w - 1);
    const from = rankStart[w]!;
    symbol.fill(s, from, from + length);
    bits.fill(maxBits + 1 - w, from, from + length);
    rankStart[w] = from + length;
  }
  return [{ maxBits, symbol, bits }, used];
}

function decodeHuffmanStream(h: Huffman, src: Uint8Array, start: number, end: number, out: Uint8Array, at: number, count: number) {
  const stream = new BackwardBits(src, start, end);
  for (let i = 0; i < count; i++) {
    const v = stream.peek(h.maxBits);
    out[at + i] = h.symbol[v]!;
    stream.pos -= h.bits[v]!;
  }
  if (stream.pos !== start * 8) fail("Huffman stream not fully consumed");
}

class Output {
  buf: Uint8Array;
  len = 0;
  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(capacity, 1024));
  }
  reserve(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  push(bytes: Uint8Array) {
    this.reserve(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }
  fill(byte: number, n: number) {
    this.reserve(n);
    this.buf.fill(byte, this.len, this.len + n);
    this.len += n;
  }
  copyMatch(offset: number, length: number, frameStart: number) {
    if (offset > this.len - frameStart || offset === 0) fail("match offset before frame start");
    this.reserve(length);
    const b = this.buf;
    let from = this.len - offset;
    if (offset >= length) b.copyWithin(this.len, from, from + length);
    else for (let i = 0; i < length; i++) b[this.len + i] = b[from++]!;
    this.len += length;
  }
}

interface FrameState {
  huffman?: Huffman;
  ll?: FseTable;
  of?: FseTable;
  ml?: FseTable;
  reps: [number, number, number];
}

const DEFAULTS = {
  ll: () => buildFse(LL_DEFAULT, 6),
  ml: () => buildFse(ML_DEFAULT, 6),
  of: () => buildFse(OF_DEFAULT, 5),
};
let defaultTables: { ll: FseTable; ml: FseTable; of: FseTable } | undefined;

function decodeLiterals(src: Uint8Array, at: number, end: number, st: FrameState): [Uint8Array, number] {
  const b0 = src[at]!;
  const type = b0 & 3;
  const format = (b0 >> 2) & 3;
  if (type < 2) {
    let size: number;
    let header: number;
    if ((format & 1) === 0) {
      size = b0 >> 3;
      header = 1;
    } else if (format === 1) {
      size = (b0 >> 4) | (src[at + 1]! << 4);
      header = 2;
    } else {
      size = (b0 >> 4) | (src[at + 1]! << 4) | (src[at + 2]! << 12);
      header = 3;
    }
    if (type === 0) {
      if (at + header + size > end) fail("raw literals overrun the block");
      return [src.subarray(at + header, at + header + size), header + size];
    }
    return [new Uint8Array(size).fill(src[at + header]!), header + 1];
  }
  let regen: number;
  let comp: number;
  let header: number;
  const b1 = src[at + 1]!;
  const b2 = src[at + 2]!;
  if (format < 2) {
    regen = (b0 >> 4) | ((b1 & 0x3f) << 4);
    comp = (b1 >> 6) | (b2 << 2);
    header = 3;
  } else if (format === 2) {
    const b3 = src[at + 3]!;
    regen = (b0 >> 4) | (b1 << 4) | ((b2 & 3) << 12);
    comp = (b2 >> 2) | (b3 << 6);
    header = 4;
  } else {
    const b3 = src[at + 3]!;
    const b4 = src[at + 4]!;
    regen = (b0 >> 4) | (b1 << 4) | ((b2 & 0x3f) << 12);
    comp = (b2 >> 6) | (b3 << 2) | (b4 << 10);
    header = 5;
  }
  let p = at + header;
  const stop = p + comp;
  if (stop > end) fail("compressed literals overrun the block");
  if (type === 2) {
    const [h, used] = readHuffman(src, p, stop);
    st.huffman = h;
    p += used;
  } else if (!st.huffman) fail("treeless literals without a previous Huffman table");
  const h = st.huffman!;
  const out = new Uint8Array(regen);
  if (format === 0) decodeHuffmanStream(h, src, p, stop, out, 0, regen);
  else {
    const s1 = src[p]! | (src[p + 1]! << 8);
    const s2 = src[p + 2]! | (src[p + 3]! << 8);
    const s3 = src[p + 4]! | (src[p + 5]! << 8);
    p += 6;
    const seg = Math.ceil(regen / 4);
    const starts = [p, p + s1, p + s1 + s2, p + s1 + s2 + s3, stop];
    if (starts[3]! > stop) fail("corrupt literal jump table");
    for (let i = 0; i < 4; i++) {
      const count = i < 3 ? seg : regen - 3 * seg;
      decodeHuffmanStream(h, src, starts[i]!, starts[i + 1]!, out, i * seg, count);
    }
  }
  return [out, header + comp];
}

function sequenceTable(
  mode: number,
  src: Uint8Array,
  at: number,
  end: number,
  previous: FseTable | undefined,
  fallback: FseTable,
  maxSymbol: number,
  maxLog: number,
): [FseTable, number] {
  if (mode === 0) return [fallback, 0];
  if (mode === 1) return [rleFse(src[at]!), 1];
  if (mode === 2) return readFseTable(src, at, end, maxSymbol, maxLog);
  if (!previous) fail("repeat mode without a previous table");
  return [previous!, 0];
}

function decodeBlock(src: Uint8Array, at: number, end: number, out: Output, frameStart: number, st: FrameState) {
  const [literals, litBytes] = decodeLiterals(src, at, end, st);
  let p = at + litBytes;
  let count = src[p++]!;
  if (count >= 128) {
    if (count === 255) {
      count = src[p]! + (src[p + 1]! << 8) + 0x7f00;
      p += 2;
    } else count = ((count - 128) << 8) + src[p++]!;
  }
  if (count === 0) {
    out.push(literals);
    return;
  }
  const modes = src[p++]!;
  defaultTables ??= { ll: DEFAULTS.ll(), ml: DEFAULTS.ml(), of: DEFAULTS.of() };
  let used: number;
  [st.ll, used] = sequenceTable(modes >> 6, src, p, end, st.ll, defaultTables.ll, 35, 9);
  p += used;
  [st.of, used] = sequenceTable((modes >> 4) & 3, src, p, end, st.of, defaultTables.of, 31, 8);
  p += used;
  [st.ml, used] = sequenceTable((modes >> 2) & 3, src, p, end, st.ml, defaultTables.ml, 52, 9);
  p += used;
  const ll = st.ll;
  const of = st.of;
  const ml = st.ml;
  const bits = new BackwardBits(src, p, end);
  let sLL = readBackward(bits, ll.log);
  let sOF = readBackward(bits, of.log);
  let sML = readBackward(bits, ml.log);
  const reps = st.reps;
  let lit = 0;
  for (let i = 0; i < count; i++) {
    const ofCode = of.symbol[sOF]!;
    const mlCode = ml.symbol[sML]!;
    const llCode = ll.symbol[sLL]!;
    if (llCode > 35 || mlCode > 52 || ofCode > 31) fail("corrupt sequence code");
    let offsetValue = 2 ** ofCode + readBackward(bits, ofCode);
    const matchLength = ML_BASE[mlCode]! + readBackward(bits, ML_BITS[mlCode]!);
    const literalLength = LL_BASE[llCode]! + readBackward(bits, LL_BITS[llCode]!);
    let offset: number;
    if (offsetValue > 3) {
      offset = offsetValue - 3;
      reps[2] = reps[1];
      reps[1] = reps[0];
      reps[0] = offset;
    } else {
      if (literalLength === 0) offsetValue++;
      if (offsetValue === 1) offset = reps[0];
      else {
        offset = offsetValue === 4 ? reps[0] - 1 : reps[offsetValue - 1]!;
        if (offsetValue !== 2) reps[2] = reps[1];
        reps[1] = reps[0];
        reps[0] = offset;
      }
    }
    if (lit + literalLength > literals.length) fail("literal length overruns the literals");
    out.push(literals.subarray(lit, lit + literalLength));
    lit += literalLength;
    out.copyMatch(offset, matchLength, frameStart);
    if (i + 1 < count) {
      sLL = ll.base[sLL]! + readBackward(bits, ll.bits[sLL]!);
      sML = ml.base[sML]! + readBackward(bits, ml.bits[sML]!);
      sOF = of.base[sOF]! + readBackward(bits, of.bits[sOF]!);
    }
  }
  if (bits.pos !== p * 8) fail("sequence bitstream not fully consumed");
  out.push(literals.subarray(lit));
}

/** Decompress every zstd frame in `src`. */
export function zstdDecompress(src: Uint8Array): Uint8Array {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let p = 0;
  let out: Output | undefined;
  while (p < src.length) {
    if (p + 4 > src.length) fail("truncated frame header");
    const magic = view.getUint32(p, true);
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      p += 8 + view.getUint32(p + 4, true);
      continue;
    }
    if (magic !== 0xfd2fb528) fail("not a zstd frame");
    p += 4;
    const fhd = src[p++]!;
    const fcsFlag = fhd >> 6;
    const single = (fhd >> 5) & 1;
    const checksum = (fhd >> 2) & 1;
    const dictFlag = fhd & 3;
    if (fhd & 8) fail("reserved frame header bit set");
    if (!single) p++;
    const dictBytes = [0, 1, 2, 4][dictFlag]!;
    let dictId = 0;
    for (let i = 0; i < dictBytes; i++) dictId += src[p + i]! * 256 ** i;
    if (dictId !== 0) fail("zstd dictionaries are not supported");
    p += dictBytes;
    const fcsBytes = fcsFlag === 0 ? single : [0, 2, 4, 8][fcsFlag]!;
    let contentSize = 0;
    for (let i = 0; i < fcsBytes; i++) contentSize += src[p + i]! * 256 ** i;
    if (fcsBytes === 2) contentSize += 256;
    p += fcsBytes;
    out ??= new Output(fcsBytes ? contentSize : src.length * 4);
    const frameStart = out.len;
    const st: FrameState = { reps: [1, 4, 8] };
    for (;;) {
      if (p + 3 > src.length) fail("truncated block header");
      const header = src[p]! | (src[p + 1]! << 8) | (src[p + 2]! << 16);
      p += 3;
      const last = header & 1;
      const type = (header >> 1) & 3;
      const size = header >>> 3;
      if (type === 0) {
        if (p + size > src.length) fail("truncated raw block");
        out.push(src.subarray(p, p + size));
        p += size;
      } else if (type === 1) {
        out.fill(src[p]!, size);
        p += 1;
      } else if (type === 2) {
        if (p + size > src.length) fail("truncated compressed block");
        decodeBlock(src, p, p + size, out, frameStart, st);
        p += size;
      } else fail("reserved block type");
      if (last) break;
    }
    if (fcsBytes && out.len - frameStart !== contentSize) fail("frame content size mismatch");
    if (checksum) p += 4;
  }
  return out ? out.buf.slice(0, out.len) : new Uint8Array();
}

export { ZstdError };
