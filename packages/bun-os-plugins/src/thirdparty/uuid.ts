// @ts-nocheck: verbatim fork source (aphrody-labs/bun src/js, 62fcdb38ec9), written for the engine's loose builtin typing.
// Fallback module "uuid"
// API- and byte-compatible with https://github.com/uuidjs/uuid 11.x: v1, v3, v4, v5, v6, v7, v1ToV6, v6ToV1,
// parse, stringify, validate, version, NIL, MAX. Randomness comes from crypto.getRandomValues, v4 without
// arguments from crypto.randomUUID, MD5/SHA-1 from Bun.CryptoHasher.
// MIT License, Copyright (c) 2010-2020 Robert Kieffer and other contributors

type Bytes = Uint8Array | number[];
type Buf = Uint8Array | number[] | undefined;

interface RandomOptions {
  random?: Bytes;
  rng?: () => Bytes;
}
interface V1Options extends RandomOptions {
  node?: Bytes;
  clockseq?: number;
  msecs?: number;
  nsecs?: number;
  _v6?: boolean;
}
interface V7Options extends RandomOptions {
  msecs?: number;
  seq?: number;
}

const NIL = "00000000-0000-0000-0000-000000000000";
const MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const REGEX =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const byteToHex: string[] = [];
for (let i = 0; i < 256; ++i) byteToHex.push((i + 0x100).toString(16).slice(1));

const pool = new Uint8Array(256);
let poolPtr = pool.length;
function rng(): Uint8Array {
  if (poolPtr > pool.length - 16) {
    crypto.getRandomValues(pool);
    poolPtr = 0;
  }
  return pool.slice(poolPtr, (poolPtr += 16));
}

function validate(uuid: unknown): boolean {
  return typeof uuid === "string" && REGEX.test(uuid);
}

function version(uuid: string): number {
  if (!validate(uuid)) throw TypeError("Invalid UUID");
  return parseInt(uuid.slice(14, 15), 16);
}

function unsafeStringify(arr: Bytes, offset = 0): string {
  return (
    byteToHex[arr[offset]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    "-" +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    "-" +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    "-" +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    "-" +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase();
}

function stringify(arr: Bytes, offset = 0): string {
  const uuid = unsafeStringify(arr, offset);
  if (!validate(uuid)) throw TypeError("Stringified UUID is invalid");
  return uuid;
}

function parse(uuid: string): Uint8Array {
  if (!validate(uuid)) throw TypeError("Invalid UUID");
  let v: number;
  return Uint8Array.of(
    (v = parseInt(uuid.slice(0, 8), 16)) >>> 24,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
    (v = parseInt(uuid.slice(9, 13), 16)) >>> 8,
    v & 0xff,
    (v = parseInt(uuid.slice(14, 18), 16)) >>> 8,
    v & 0xff,
    (v = parseInt(uuid.slice(19, 23), 16)) >>> 8,
    v & 0xff,
    ((v = parseInt(uuid.slice(24, 36), 16)) / 0x10000000000) & 0xff,
    (v / 0x100000000) & 0xff,
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  );
}

function checkRange(buf: Bytes, offset: number) {
  if (offset < 0 || offset + 16 > buf.length) {
    throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
  }
}

function checkRandom(rnds: Bytes) {
  if (rnds.length < 16) throw new Error("Random bytes length must be >= 16");
}

function copyInto(bytes: Bytes, buf: Bytes, offset: number) {
  checkRange(buf, offset);
  for (let i = 0; i < 16; ++i) buf[offset + i] = bytes[i];
  return buf;
}

const v1State: { msecs?: number; nsecs?: number; node?: Bytes; clockseq?: number } = {};

function updateV1State(state: typeof v1State, now: number, rnds: Uint8Array) {
  state.msecs ??= -Infinity;
  state.nsecs ??= 0;
  if (now === state.msecs) {
    state.nsecs++;
    if (state.nsecs >= 10000) {
      state.node = undefined;
      state.nsecs = 0;
    }
  } else if (now > state.msecs) {
    state.nsecs = 0;
  } else if (now < state.msecs) {
    state.node = undefined;
  }
  if (!state.node) {
    state.node = rnds.slice(10, 16);
    state.node[0] |= 0x01;
    state.clockseq = ((rnds[8] << 8) | rnds[9]) & 0x3fff;
  }
  state.msecs = now;
  return state;
}

function v1Bytes(
  rnds: Bytes,
  msecs: number | undefined,
  nsecs: number | undefined,
  clockseq: number | undefined,
  node: Bytes | undefined,
  buf: Buf,
  offset = 0,
): Bytes {
  checkRandom(rnds);
  if (!buf) {
    buf = new Uint8Array(16);
    offset = 0;
  } else {
    checkRange(buf, offset);
  }
  msecs ??= Date.now();
  nsecs ??= 0;
  clockseq ??= ((rnds[8] << 8) | rnds[9]) & 0x3fff;
  node ??= rnds.slice(10, 16);
  msecs += 12219292800000;
  const tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
  buf[offset++] = (tl >>> 24) & 0xff;
  buf[offset++] = (tl >>> 16) & 0xff;
  buf[offset++] = (tl >>> 8) & 0xff;
  buf[offset++] = tl & 0xff;
  const tmh = ((msecs / 0x100000000) * 10000) & 0xfffffff;
  buf[offset++] = (tmh >>> 8) & 0xff;
  buf[offset++] = tmh & 0xff;
  buf[offset++] = ((tmh >>> 24) & 0xf) | 0x10;
  buf[offset++] = (tmh >>> 16) & 0xff;
  buf[offset++] = (clockseq >>> 8) | 0x80;
  buf[offset++] = clockseq & 0xff;
  for (let n = 0; n < 6; ++n) buf[offset++] = node[n];
  return buf;
}

function v1(options?: V1Options, buf?: Buf, offset?: number): any {
  let bytes: Bytes;
  const isV6 = options?._v6 ?? false;
  if (options) {
    const keys = Object.keys(options);
    if (keys.length === 1 && keys[0] === "_v6") options = undefined;
  }
  if (options) {
    bytes = v1Bytes(
      options.random ?? options.rng?.() ?? rng(),
      options.msecs,
      options.nsecs,
      options.clockseq,
      options.node,
      buf,
      offset,
    );
  } else {
    const now = Date.now();
    const rnds = rng();
    updateV1State(v1State, now, rnds);
    bytes = v1Bytes(
      rnds,
      v1State.msecs,
      v1State.nsecs,
      isV6 ? undefined : v1State.clockseq,
      isV6 ? undefined : v1State.node,
      buf,
      offset,
    );
  }
  return buf ?? unsafeStringify(bytes);
}

function v1ToV6Bytes(b: Bytes): Uint8Array {
  return Uint8Array.of(
    ((b[6] & 0x0f) << 4) | ((b[7] >> 4) & 0x0f),
    ((b[7] & 0x0f) << 4) | ((b[4] & 0xf0) >> 4),
    ((b[4] & 0x0f) << 4) | ((b[5] & 0xf0) >> 4),
    ((b[5] & 0x0f) << 4) | ((b[0] & 0xf0) >> 4),
    ((b[0] & 0x0f) << 4) | ((b[1] & 0xf0) >> 4),
    ((b[1] & 0x0f) << 4) | ((b[2] & 0xf0) >> 4),
    0x60 | (b[2] & 0x0f),
    b[3],
    b[8],
    b[9],
    b[10],
    b[11],
    b[12],
    b[13],
    b[14],
    b[15],
  );
}

function v6ToV1Bytes(b: Bytes): Uint8Array {
  return Uint8Array.of(
    ((b[3] & 0x0f) << 4) | ((b[4] >> 4) & 0x0f),
    ((b[4] & 0x0f) << 4) | ((b[5] & 0xf0) >> 4),
    ((b[5] & 0x0f) << 4) | (b[6] & 0x0f),
    b[7],
    ((b[1] & 0x0f) << 4) | ((b[2] & 0xf0) >> 4),
    ((b[2] & 0x0f) << 4) | ((b[3] & 0xf0) >> 4),
    0x10 | ((b[0] & 0xf0) >> 4),
    ((b[0] & 0x0f) << 4) | ((b[1] & 0xf0) >> 4),
    b[8],
    b[9],
    b[10],
    b[11],
    b[12],
    b[13],
    b[14],
    b[15],
  );
}

function v1ToV6(uuid: string | Bytes): any {
  const bytes = v1ToV6Bytes(typeof uuid === "string" ? parse(uuid) : uuid);
  return typeof uuid === "string" ? unsafeStringify(bytes) : bytes;
}

function v6ToV1(uuid: string | Bytes): any {
  const bytes = v6ToV1Bytes(typeof uuid === "string" ? parse(uuid) : uuid);
  return typeof uuid === "string" ? unsafeStringify(bytes) : bytes;
}

function v6(options?: V1Options, buf?: Buf, offset?: number): any {
  options ??= {};
  offset ??= 0;
  const bytes = v1ToV6Bytes(v1({ ...options, _v6: true }, new Uint8Array(16)));
  if (buf) return copyInto(bytes, buf, offset);
  return unsafeStringify(bytes);
}

function v4(options?: RandomOptions, buf?: Buf, offset?: number): any {
  if (!buf && !options) return crypto.randomUUID();
  options = options || {};
  const rnds = options.random ?? options.rng?.() ?? rng();
  checkRandom(rnds);
  rnds[6] = (rnds[6] & 0x0f) | 0x40;
  rnds[8] = (rnds[8] & 0x3f) | 0x80;
  if (buf) return copyInto(rnds, buf, offset || 0);
  return unsafeStringify(rnds);
}

const v7State: { msecs?: number; seq?: number } = {};

function updateV7State(state: typeof v7State, now: number, rnds: Uint8Array) {
  state.msecs ??= -Infinity;
  state.seq ??= 0;
  if (now > state.msecs) {
    state.seq = (rnds[6] << 23) | (rnds[7] << 16) | (rnds[8] << 8) | rnds[9];
    state.msecs = now;
  } else {
    state.seq = (state.seq + 1) | 0;
    if (state.seq === 0) state.msecs++;
  }
  return state;
}

function v7Bytes(rnds: Bytes, msecs: number | undefined, seq: number | undefined, buf: Buf, offset = 0): Bytes {
  checkRandom(rnds);
  if (!buf) {
    buf = new Uint8Array(16);
    offset = 0;
  } else {
    checkRange(buf, offset);
  }
  msecs ??= Date.now();
  seq ??= ((rnds[6] * 0x7f) << 24) | (rnds[7] << 16) | (rnds[8] << 8) | rnds[9];
  buf[offset++] = (msecs / 0x10000000000) & 0xff;
  buf[offset++] = (msecs / 0x100000000) & 0xff;
  buf[offset++] = (msecs / 0x1000000) & 0xff;
  buf[offset++] = (msecs / 0x10000) & 0xff;
  buf[offset++] = (msecs / 0x100) & 0xff;
  buf[offset++] = msecs & 0xff;
  buf[offset++] = 0x70 | ((seq >>> 28) & 0x0f);
  buf[offset++] = (seq >>> 20) & 0xff;
  buf[offset++] = 0x80 | ((seq >>> 14) & 0x3f);
  buf[offset++] = (seq >>> 6) & 0xff;
  buf[offset++] = ((seq << 2) & 0xff) | (rnds[10] & 0x03);
  buf[offset++] = rnds[11];
  buf[offset++] = rnds[12];
  buf[offset++] = rnds[13];
  buf[offset++] = rnds[14];
  buf[offset++] = rnds[15];
  return buf;
}

function v7(options?: V7Options, buf?: Buf, offset?: number): any {
  let bytes: Bytes;
  if (options) {
    bytes = v7Bytes(options.random ?? options.rng?.() ?? rng(), options.msecs, options.seq, buf, offset);
  } else {
    const now = Date.now();
    const rnds = rng();
    updateV7State(v7State, now, rnds);
    bytes = v7Bytes(rnds, v7State.msecs, v7State.seq, buf, offset);
  }
  return buf ?? unsafeStringify(bytes);
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function v35(
  versionBits: number,
  algorithm: "md5" | "sha1",
  value: string | Bytes,
  namespace: string | Bytes,
  buf?: Buf,
  offset?: number,
): any {
  const valueBytes = typeof value === "string" ? stringToBytes(value) : value;
  if (typeof namespace === "string") namespace = parse(namespace);
  if (namespace?.length !== 16) {
    throw TypeError("Namespace must be array-like (16 iterable integer values, 0-255)");
  }
  const input = new Uint8Array(16 + valueBytes.length);
  input.set(namespace);
  input.set(valueBytes, 16);
  const bytes = Uint8Array.from(new Bun.CryptoHasher(algorithm).update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | versionBits;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  if (buf) return copyInto(bytes, buf, offset || 0);
  return unsafeStringify(bytes);
}

function v3(value: string | Bytes, namespace: string | Bytes, buf?: Buf, offset?: number): any {
  return v35(0x30, "md5", value, namespace, buf, offset);
}
v3.DNS = DNS;
v3.URL = URL;

function v5(value: string | Bytes, namespace: string | Bytes, buf?: Buf, offset?: number): any {
  return v35(0x50, "sha1", value, namespace, buf, offset);
}
v5.DNS = DNS;
v5.URL = URL;

export default {
  MAX,
  NIL,
  parse,
  stringify,
  v1,
  v1ToV6,
  v3,
  v4,
  v5,
  v6,
  v6ToV1,
  v7,
  validate,
  version,
};

export { MAX, NIL, parse, stringify, v1, v1ToV6, v3, v4, v5, v6, v6ToV1, v7, validate, version };
