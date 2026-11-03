// @ts-nocheck: verbatim fork source (aphrody-labs/bun src/js, 62fcdb38ec9), written for the engine's loose builtin typing.
// Fallback module "erlpack"
// API-compatible with https://github.com/discord/erlpack 1.x (pack, unpack): Erlang External Term Format 131 as
// used by the Discord gateway "etf" encoding. Same wire format and same JavaScript mapping as the native addon
// (null/undefined -> nil atom, strings -> binaries, maps <-> objects, big integers above 32 bits -> decimal strings).
// MIT License, Copyright (c) 2016 Discord

const FORMAT_VERSION = 131;
const NEW_FLOAT_EXT = 70;
const COMPRESSED = 80;
const SMALL_INTEGER_EXT = 97;
const INTEGER_EXT = 98;
const FLOAT_EXT = 99;
const ATOM_EXT = 100;
const REFERENCE_EXT = 101;
const PORT_EXT = 102;
const PID_EXT = 103;
const SMALL_TUPLE_EXT = 104;
const LARGE_TUPLE_EXT = 105;
const NIL_EXT = 106;
const STRING_EXT = 107;
const LIST_EXT = 108;
const BINARY_EXT = 109;
const SMALL_BIG_EXT = 110;
const LARGE_BIG_EXT = 111;
const EXPORT_EXT = 113;
const NEW_REFERENCE_EXT = 114;
const SMALL_ATOM_EXT = 115;
const MAP_EXT = 116;
const ATOM_UTF8_EXT = 118;
const SMALL_ATOM_UTF8_EXT = 119;

const RECURSE_LIMIT = 256;
const textEncoder = new TextEncoder();

class Writer {
  buf = Buffer.allocUnsafe(1024);
  length = 0;

  reserve(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = Buffer.allocUnsafe(size);
    this.buf.copy(next, 0, 0, this.length);
    this.buf = next;
  }

  u8(v: number) {
    this.reserve(1);
    this.buf[this.length++] = v;
  }

  u16(v: number) {
    this.reserve(2);
    this.buf.writeUInt16BE(v, this.length);
    this.length += 2;
  }

  u32(v: number) {
    this.reserve(4);
    this.buf.writeUInt32BE(v >>> 0, this.length);
    this.length += 4;
  }

  bytes(b: Uint8Array) {
    this.reserve(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  atom(name: string) {
    this.u8(SMALL_ATOM_EXT);
    this.u8(name.length);
    this.bytes(textEncoder.encode(name));
  }

  big(magnitude: bigint, negative: boolean) {
    const digits: number[] = [];
    while (magnitude > 0n) {
      digits.push(Number(magnitude & 0xffn));
      magnitude >>= 8n;
    }
    this.u8(SMALL_BIG_EXT);
    this.u8(digits.length);
    this.u8(negative ? 1 : 0);
    for (const d of digits) this.u8(d);
  }

  binary(s: string) {
    const encoded = textEncoder.encode(s);
    this.u8(BINARY_EXT);
    this.u32(encoded.length);
    this.bytes(encoded);
  }

  value(v: unknown, depth: number) {
    if (depth < 0) throw new Error("Reached recursion limit");
    switch (typeof v) {
      case "number": {
        if (Number.isInteger(v) && v >= -2147483648 && v <= 4294967295 && !Object.is(v, -0)) {
          if (v >= 0 && v <= 255) {
            this.u8(SMALL_INTEGER_EXT);
            this.u8(v);
          } else if (v <= 2147483647) {
            this.u8(INTEGER_EXT);
            this.u32(v);
          } else {
            this.big(BigInt(v), false);
          }
          return;
        }
        this.u8(NEW_FLOAT_EXT);
        this.reserve(8);
        this.buf.writeDoubleBE(v, this.length);
        this.length += 8;
        return;
      }
      case "bigint":
        this.big(v < 0n ? -v : v, v < 0n);
        return;
      case "undefined":
        this.atom("nil");
        return;
      case "boolean":
        this.atom(v ? "true" : "false");
        return;
      case "string":
        this.binary(v);
        return;
      case "object": {
        if (v === null) {
          this.atom("nil");
          return;
        }
        if (Array.isArray(v)) {
          if (v.length === 0) {
            this.u8(NIL_EXT);
            return;
          }
          this.u8(LIST_EXT);
          this.u32(v.length);
          for (let i = 0; i < v.length; i++) this.value(v[i], depth - 1);
          this.u8(NIL_EXT);
          return;
        }
        const keys = Object.keys(v);
        this.u8(MAP_EXT);
        this.u32(keys.length);
        for (const key of keys) {
          this.binary(key);
          this.value(v[key], depth - 1);
        }
        return;
      }
    }
  }
}

function pack(value: unknown): Buffer {
  const w = new Writer();
  w.u8(FORMAT_VERSION);
  w.value(value, RECURSE_LIMIT);
  return w.buf.subarray(0, w.length);
}

class Reader {
  offset = 0;
  data: Uint8Array;
  view: DataView;

  constructor(data: Uint8Array, skipVersion = false) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (!skipVersion && this.u8() !== FORMAT_VERSION) throw new Error("Bad version number.");
  }

  need(n: number, what: string) {
    if (this.offset + n > this.data.length) throw new Error(what);
  }

  u8() {
    this.need(1, "Reading a byte passes the end of the buffer.");
    return this.data[this.offset++];
  }

  u16() {
    this.need(2, "Reading two bytes passes the end of the buffer.");
    const v = this.view.getUint16(this.offset);
    this.offset += 2;
    return v;
  }

  u32() {
    this.need(4, "Reading three bytes passes the end of the buffer.");
    const v = this.view.getUint32(this.offset);
    this.offset += 4;
    return v;
  }

  text(length: number) {
    this.need(length, "Reading sequence past the end of the buffer.");
    const s = Buffer.from(this.data.buffer, this.data.byteOffset + this.offset, length).toString("utf8");
    this.offset += length;
    return s;
  }

  atom(length: number) {
    const s = this.text(length);
    if (length >= 3 && length <= 5) {
      if (s === "nil" || s === "null") return null;
      if (s === "true") return true;
      if (s === "false") return false;
    }
    return s;
  }

  array(length: number) {
    const out: unknown[] = [];
    for (let i = 0; i < length; i++) out.push(this.term());
    return out;
  }

  big(digits: number) {
    const sign = this.u8();
    if (digits > 8) throw new Error("Unable to decode big ints larger than 8 bytes");
    let value = 0n;
    let b = 1n;
    for (let i = 0; i < digits; i++) {
      value += BigInt(this.u8()) * b;
      b <<= 8n;
    }
    if (digits <= 4) {
      if (sign === 0) return Number(value);
      if ((value & (1n << 31n)) === 0n) return -Number(value);
    }
    return (sign === 0 ? "" : "-") + value.toString();
  }

  term(): unknown {
    if (this.offset >= this.data.length) throw new Error("Unpacking beyond the end of the buffer");
    const type = this.u8();
    switch (type) {
      case SMALL_INTEGER_EXT:
        return this.u8();
      case INTEGER_EXT:
        return this.u32() | 0;
      case FLOAT_EXT: {
        const n = parseFloat(this.text(31));
        if (Number.isNaN(n)) throw new Error("Invalid float encoded.");
        return n;
      }
      case NEW_FLOAT_EXT: {
        this.need(8, "Reading four bytes passes the end of the buffer.");
        const v = this.view.getFloat64(this.offset);
        this.offset += 8;
        return v;
      }
      case ATOM_EXT:
      case ATOM_UTF8_EXT:
        return this.atom(this.u16());
      case SMALL_ATOM_EXT:
      case SMALL_ATOM_UTF8_EXT:
        return this.atom(this.u8());
      case SMALL_TUPLE_EXT:
        return this.array(this.u8());
      case LARGE_TUPLE_EXT:
        return this.array(this.u32());
      case NIL_EXT:
        return [];
      case STRING_EXT: {
        const length = this.u16();
        this.need(length, "Reading sequence past the end of the buffer.");
        const out: number[] = [];
        for (let i = 0; i < length; i++) out.push(this.u8());
        return out;
      }
      case LIST_EXT: {
        const list = this.array(this.u32());
        if (this.u8() !== NIL_EXT) throw new Error("List doesn't end with a tail marker, but it must!");
        return list;
      }
      case MAP_EXT: {
        const length = this.u32();
        const map = {};
        for (let i = 0; i < length; i++) {
          const key = this.term() as string;
          map[key] = this.term();
        }
        return map;
      }
      case BINARY_EXT:
        return this.text(this.u32());
      case SMALL_BIG_EXT:
        return this.big(this.u8());
      case LARGE_BIG_EXT:
        return this.big(this.u32());
      case REFERENCE_EXT: {
        const node = this.term();
        const id = [this.u32()];
        return { node, id, creation: this.u8() };
      }
      case NEW_REFERENCE_EXT: {
        const length = this.u16();
        const node = this.term();
        const creation = this.u8();
        const id: number[] = [];
        for (let i = 0; i < length; i++) id.push(this.u32());
        return { node, creation, id };
      }
      case PORT_EXT: {
        const node = this.term();
        return { node, id: this.u32(), creation: this.u8() };
      }
      case PID_EXT: {
        const node = this.term();
        return { node, id: this.u32(), serial: this.u32(), creation: this.u8() };
      }
      case EXPORT_EXT:
        return { mod: this.term(), fun: this.term(), arity: this.term() };
      case COMPRESSED: {
        const size = this.u32();
        const inflateSync = require("node:zlib").inflateSync as typeof import("node:zlib").inflateSync;
        const inflated = inflateSync(this.data.subarray(this.offset));
        this.offset = this.data.length;
        if (inflated.length !== size) throw new Error("Failed to uncompresss compressed item");
        return new Reader(inflated, true).term();
      }
      default:
        throw new Error("Unsupported erlang term type identifier found");
    }
  }
}

function unpack(data: unknown) {
  if (data === null || typeof data !== "object") throw new Error("Attempting to unpack a non-object.");
  let bytes: Uint8Array;
  if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) bytes = new Uint8Array(data);
  else bytes = new Uint8Array(0);
  if (bytes.length === 0) throw new Error("Zero length buffer.");
  return new Reader(bytes).term();
}

export default { pack, unpack };

export { pack, unpack };
