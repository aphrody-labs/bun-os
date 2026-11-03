// @ts-nocheck: verbatim fork source (aphrody-labs/bun src/js, 62fcdb38ec9), written for the engine's loose builtin typing.
// Fallback module "zlib-sync"
// API-compatible with https://github.com/abalabahaha/zlib-sync 0.1.x (Inflate only, as in the npm package): a
// synchronous streaming inflate that keeps its window between push() calls. Used by @discordjs/ws for the
// gateway "zlib-stream" compression. MIT License, Copyright (c) 2018 abalabahaha
import zlib from "node:zlib";

const constants = zlib.constants;

const messages = {
  [constants.Z_STREAM_END]: "stream end",
  [constants.Z_NEED_DICT]: "need dictionary",
  [constants.Z_ERRNO]: "file error",
  [constants.Z_STREAM_ERROR]: "stream error",
  [constants.Z_DATA_ERROR]: "data error",
  [constants.Z_MEM_ERROR]: "insufficient memory",
  [constants.Z_BUF_ERROR]: "buffer error",
  [constants.Z_VERSION_ERROR]: "incompatible version",
};

class Inflate {
  #stream;
  #handle;
  #state;
  #chunkSize;
  #toString;
  #windowBits;
  #err = 0;
  // As in zlib-sync, `result` is all the output since the last Z_SYNC_FLUSH or Z_FINISH push, concatenated on read.
  #result: Buffer | null = Buffer.alloc(0);
  #resultChunks: Buffer[] = [];
  #resultBytes = 0;
  #pending: Buffer[] = [];
  #pendingBytes = 0;

  constructor(options?) {
    let chunkSize = 16 * 1024;
    let toString = false;
    let windowBits = 15;
    if (options !== null && typeof options === "object") {
      const { chunkSize: chunkSizeOption, to, windowBits: windowBitsOption } = options;
      if (typeof chunkSizeOption === "number") chunkSize = chunkSizeOption >>> 0;
      if (to === "string") toString = true;
      if (typeof windowBitsOption === "number") windowBits = windowBitsOption | 0;
    }
    this.#chunkSize = chunkSize < 64 ? 64 : chunkSize;
    this.#toString = toString;
    this.#windowBits = windowBits;
    this.#stream = new zlib.Inflate({ windowBits, chunkSize: this.#chunkSize });
    this.#handle = this.#stream._handle;
    this.#state = this.#stream._writeState;
    // The stream would destroy itself on the first error; zlib-sync reports it through err/msg instead.
    this.#handle.onerror = (_message, errno) => {
      this.#err = errno;
    };
    this.#stream.on("error", () => {});
  }

  get chunkSize() {
    return this.#chunkSize;
  }

  get windowBits() {
    return this.#windowBits;
  }

  get err() {
    return this.#err;
  }

  get msg() {
    return this.#err === 0 ? null : (messages[this.#err] ?? "unknown zlib error");
  }

  get result() {
    if (this.#err < 0) return null;
    let result = this.#result;
    if (result === null) {
      const chunks = this.#resultChunks;
      const total = this.#resultBytes;
      result = total === 0 ? Buffer.alloc(0) : chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
      this.#result = result;
    }
    return this.#toString ? result.toString() : Buffer.from(result);
  }

  push(buffer, flush?) {
    if (!ArrayBuffer.isView(buffer)) throw new TypeError("zlib-sync: push() expects a Buffer");
    let flushFlag = constants.Z_NO_FLUSH;
    if (typeof flush === "boolean") {
      if (flush) flushFlag = constants.Z_FINISH;
    } else if (typeof flush === "number") {
      flushFlag = flush | 0;
    }

    const handle = this.#handle;
    const state = this.#state;
    const chunkSize = this.#chunkSize;
    const input = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const chunks = this.#pending;
    let total = this.#pendingBytes;
    let inOff = 0;
    let availIn = input.byteLength;
    this.#err = 0;

    while (true) {
      const out = Buffer.allocUnsafe(chunkSize);
      handle.writeSync(flushFlag, input, inOff, availIn, out, 0, chunkSize);
      if (this.#err !== 0) break;
      const availOut = state[0];
      const availInAfter = state[1];
      const have = chunkSize - availOut;
      if (have > 0) {
        chunks.push(have === chunkSize ? out : out.subarray(0, have));
        total += have;
      }
      inOff += availIn - availInAfter;
      availIn = availInAfter;
      if (availOut !== 0) break;
    }
    this.#result = null;
    this.#resultChunks = chunks;
    this.#resultBytes = total;
    if (flushFlag === constants.Z_SYNC_FLUSH || flushFlag === constants.Z_FINISH) {
      this.#pending = [];
      this.#pendingBytes = 0;
    } else {
      this.#pendingBytes = total;
    }
  }
}

// zlib.h values node:zlib does not export.
const fallback = { Z_TREES: 6, Z_BINARY: 0, Z_TEXT: 1, Z_ASCII: 1, Z_UNKNOWN: 2, Z_DEFLATED: 8 };

const exports = {
  Inflate,
  ZLIB_VERSION: process.versions.zlib,
  Z_NULL: 0,
};
for (const name of [
  "Z_NO_FLUSH",
  "Z_PARTIAL_FLUSH",
  "Z_SYNC_FLUSH",
  "Z_FULL_FLUSH",
  "Z_FINISH",
  "Z_BLOCK",
  "Z_TREES",
  "Z_OK",
  "Z_STREAM_END",
  "Z_NEED_DICT",
  "Z_ERRNO",
  "Z_STREAM_ERROR",
  "Z_DATA_ERROR",
  "Z_MEM_ERROR",
  "Z_BUF_ERROR",
  "Z_VERSION_ERROR",
  "Z_NO_COMPRESSION",
  "Z_BEST_SPEED",
  "Z_BEST_COMPRESSION",
  "Z_DEFAULT_COMPRESSION",
  "Z_FILTERED",
  "Z_HUFFMAN_ONLY",
  "Z_RLE",
  "Z_FIXED",
  "Z_DEFAULT_STRATEGY",
  "Z_BINARY",
  "Z_TEXT",
  "Z_ASCII",
  "Z_UNKNOWN",
  "Z_DEFLATED",
]) {
  exports[name] = constants[name] ?? fallback[name];
}

export default exports;

export { Inflate };
export const {
  ZLIB_VERSION,
  Z_NULL,
  Z_NO_FLUSH,
  Z_PARTIAL_FLUSH,
  Z_SYNC_FLUSH,
  Z_FULL_FLUSH,
  Z_FINISH,
  Z_BLOCK,
  Z_TREES,
  Z_OK,
  Z_STREAM_END,
  Z_NEED_DICT,
  Z_ERRNO,
  Z_STREAM_ERROR,
  Z_DATA_ERROR,
  Z_MEM_ERROR,
  Z_BUF_ERROR,
  Z_VERSION_ERROR,
  Z_NO_COMPRESSION,
  Z_BEST_SPEED,
  Z_BEST_COMPRESSION,
  Z_DEFAULT_COMPRESSION,
  Z_FILTERED,
  Z_HUFFMAN_ONLY,
  Z_RLE,
  Z_FIXED,
  Z_DEFAULT_STRATEGY,
  Z_BINARY,
  Z_TEXT,
  Z_ASCII,
  Z_UNKNOWN,
  Z_DEFLATED,
} = exports as Record<string, any>;
