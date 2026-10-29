// SPDX-License-Identifier: MIT
/**
 * scrcpy wire protocol, server v5.0.1 (Apache-2.0, Genymobile/scrcpy, doc/develop.md "Protocol").
 * The protocol is internal to scrcpy and changes between versions, so the server jar is pinned
 * and its SHA-256 verified before it is pushed to a device.
 */

export const SCRCPY_VERSION = "5.0.1";
export const SCRCPY_SERVER_SHA256 = "764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536";
export const SCRCPY_SERVER_URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}`;

export const DEVICE_NAME_LENGTH = 64;

export const CODEC = { h264: 0x68323634, h265: 0x68323635, av1: 0x00617631, vp8: 0x00767038, vp9: 0x00767039 } as const;
export type CodecName = keyof typeof CODEC;

export function codecName(id: number): CodecName | undefined {
  return (Object.keys(CODEC) as CodecName[]).find(k => CODEC[k] === id);
}

export type VideoPacket =
  | { kind: "session"; width: number; height: number; resized: boolean }
  | { kind: "media"; config: boolean; key: boolean; pts: bigint; data: Uint8Array };

/** Incremental reader over a TCP byte stream. */
export class ByteQueue {
  #chunks: Uint8Array[] = [];
  #length = 0;
  #waiters: Array<() => void> = [];
  #ended = false;

  get length(): number {
    return this.#length;
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.#chunks.push(chunk);
    this.#length += chunk.byteLength;
    this.#wake();
  }

  end(): void {
    this.#ended = true;
    this.#wake();
  }

  #wake(): void {
    const w = this.#waiters;
    this.#waiters = [];
    for (const f of w) f();
  }

  /** Wait until `n` bytes are buffered without consuming them. Throws when the stream ends first. */
  async peek(n: number): Promise<void> {
    while (this.#length < n) {
      if (this.#ended) throw new Error(`stream ended with ${this.#length} of ${n} bytes`);
      await new Promise<void>(r => this.#waiters.push(r));
    }
  }

  /** Remove and return exactly `n` bytes, or throw when the stream ends first. */
  async read(n: number): Promise<Uint8Array> {
    while (this.#length < n) {
      if (this.#ended) throw new Error(`stream ended with ${this.#length} of ${n} bytes`);
      await new Promise<void>(r => this.#waiters.push(r));
    }
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const head = this.#chunks[0]!;
      const take = Math.min(head.byteLength, n - off);
      out.set(head.subarray(0, take), off);
      off += take;
      if (take === head.byteLength) this.#chunks.shift();
      else this.#chunks[0] = head.subarray(take);
    }
    this.#length -= n;
    return out;
  }
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export interface StreamHeader {
  deviceName: string;
  codec: CodecName | number;
}

/** After the dummy byte (forward tunnels): 64-byte device name, then the u32 codec id. */
export async function readStreamHeader(q: ByteQueue, opts: { dummyByte: boolean }): Promise<StreamHeader> {
  if (opts.dummyByte) await q.read(1);
  const name = await q.read(DEVICE_NAME_LENGTH);
  const end = name.indexOf(0);
  const deviceName = new TextDecoder().decode(name.subarray(0, end < 0 ? name.length : end));
  const id = view(await q.read(4)).getUint32(0);
  return { deviceName, codec: codecName(id) ?? id };
}

/** One 12-byte header (+ payload for media packets). */
export async function readVideoPacket(q: ByteQueue): Promise<VideoPacket> {
  const head = await q.read(12);
  const v = view(head);
  if (head[0]! & 0x80) {
    return { kind: "session", width: v.getUint32(4), height: v.getUint32(8), resized: (v.getUint32(0) & 1) === 1 };
  }
  const hi = v.getUint32(0);
  const lo = v.getUint32(4);
  const config = (hi & 0x4000_0000) !== 0;
  const key = (hi & 0x2000_0000) !== 0;
  const pts = (BigInt(hi & 0x1fff_ffff) << 32n) | BigInt(lo);
  const size = v.getUint32(8);
  return { kind: "media", config, key, pts, data: await q.read(size) };
}

/** Encode a media packet exactly as the device does (used by the fake server in tests). */
export function encodeMediaPacket(p: { config?: boolean; key?: boolean; pts: bigint; data: Uint8Array }): Uint8Array {
  const out = new Uint8Array(12 + p.data.byteLength);
  const v = view(out);
  let hi = Number((p.pts >> 32n) & 0x1fff_ffffn);
  if (p.config) hi |= 0x4000_0000;
  if (p.key) hi |= 0x2000_0000;
  v.setUint32(0, hi >>> 0);
  v.setUint32(4, Number(p.pts & 0xffff_ffffn));
  v.setUint32(8, p.data.byteLength);
  out.set(p.data, 12);
  return out;
}

export function encodeSessionPacket(width: number, height: number, resized = false): Uint8Array {
  const out = new Uint8Array(12);
  const v = view(out);
  v.setUint32(0, (0x8000_0000 | (resized ? 1 : 0)) >>> 0);
  v.setUint32(4, width);
  v.setUint32(8, height);
  return out;
}

// ---- control messages (client -> device) -------------------------------------------------------------------------

export const CTRL = {
  keycode: 0,
  text: 1,
  touch: 2,
  scroll: 3,
  backOrScreenOn: 4,
  expandNotifications: 5,
  collapsePanels: 7,
  getClipboard: 8,
  setClipboard: 9,
  rotate: 11,
  resetVideo: 17,
} as const;

export const ACTION = { down: 0, up: 1, move: 2 } as const;
export const KEY_ACTION = { down: 0, up: 1 } as const;
/** Pointer id scrcpy reserves for a generic finger. */
export const POINTER_GENERIC_FINGER = 0xffff_ffff_ffff_fffen;

/** u16 fixed point 0..1, as `Binary.u16FixedPointToFloat`. */
function fixed16(p: number): number {
  return Math.min(0xffff, Math.max(0, Math.round(p * 0x10000)));
}

export function encodeTouch(a: {
  action: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pressure?: number;
  pointerId?: bigint;
  actionButton?: number;
  buttons?: number;
}): Uint8Array {
  const out = new Uint8Array(32);
  const v = view(out);
  out[0] = CTRL.touch;
  out[1] = a.action;
  v.setBigUint64(2, a.pointerId ?? POINTER_GENERIC_FINGER);
  v.setInt32(10, Math.round(a.x));
  v.setInt32(14, Math.round(a.y));
  v.setUint16(18, a.width);
  v.setUint16(20, a.height);
  v.setUint16(22, fixed16(a.pressure ?? (a.action === ACTION.up ? 0 : 1)));
  v.setInt32(24, a.actionButton ?? 0);
  v.setInt32(28, a.buttons ?? 0);
  return out;
}

export function encodeKeycode(action: number, keycode: number, repeat = 0, metaState = 0): Uint8Array {
  const out = new Uint8Array(14);
  const v = view(out);
  out[0] = CTRL.keycode;
  out[1] = action;
  v.setInt32(2, keycode);
  v.setInt32(6, repeat);
  v.setInt32(10, metaState);
  return out;
}

function withString(type: number, prefix: Uint8Array, text: string): Uint8Array {
  const s = new TextEncoder().encode(text);
  const out = new Uint8Array(1 + prefix.byteLength + 4 + s.byteLength);
  out[0] = type;
  out.set(prefix, 1);
  view(out).setUint32(1 + prefix.byteLength, s.byteLength);
  out.set(s, 1 + prefix.byteLength + 4);
  return out;
}

export function encodeText(text: string): Uint8Array {
  return withString(CTRL.text, new Uint8Array(0), text);
}

export function encodeSetClipboard(text: string, paste = false, sequence = 0n): Uint8Array {
  const prefix = new Uint8Array(9);
  view(prefix).setBigUint64(0, sequence);
  prefix[8] = paste ? 1 : 0;
  return withString(CTRL.setClipboard, prefix, text);
}

export function encodeScroll(a: { x: number; y: number; width: number; height: number; dx: number; dy: number }): Uint8Array {
  // position(12) + hscroll i16 + vscroll i16 + buttons i32; the i16 is fixed point over [-1,1] and the
  // server multiplies it by 16, so dx/dy are scroll ticks in [-16,16].
  const out = new Uint8Array(1 + 12 + 2 + 2 + 4);
  const v = view(out);
  out[0] = CTRL.scroll;
  v.setInt32(1, Math.round(a.x));
  v.setInt32(5, Math.round(a.y));
  v.setUint16(9, a.width);
  v.setUint16(11, a.height);
  const f = (n: number) => Math.round((Math.max(-16, Math.min(16, n)) / 16) * 0x7fff);
  v.setInt16(13, f(a.dx));
  v.setInt16(15, f(a.dy));
  return out;
}

export const encodeEmpty = (type: number): Uint8Array => Uint8Array.of(type);

/** Server command line pieces for `adb shell`. */
export function serverArgs(o: {
  scid: number;
  codec?: CodecName;
  maxSize?: number;
  maxFps?: number;
  bitRate?: number;
  control?: boolean;
}): string[] {
  const args = [
    `scid=${o.scid.toString(16).padStart(8, "0")}`,
    "tunnel_forward=true",
    "audio=false",
    `control=${o.control ?? true}`,
    `video_codec=${o.codec ?? "h264"}`,
    "cleanup=false",
    "log_level=info",
  ];
  if (o.maxSize) args.push(`max_size=${o.maxSize}`);
  if (o.maxFps) args.push(`max_fps=${o.maxFps}`);
  if (o.bitRate) args.push(`video_bit_rate=${o.bitRate}`);
  return args;
}

export const socketName = (scid: number): string => `scrcpy_${scid.toString(16).padStart(8, "0")}`;

/** H.264 codec string (avc1.PPCCLL) from the SPS inside an Annex B config packet. */
export function avcCodecString(annexB: Uint8Array): string | undefined {
  for (let i = 0; i + 4 < annexB.length; i++) {
    const sc3 = annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 1;
    const sc4 = annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 0 && annexB[i + 3] === 1;
    if (!sc3 && !sc4) continue;
    const n = i + (sc4 ? 4 : 3);
    if ((annexB[n]! & 0x1f) === 7 && n + 3 < annexB.length) {
      const h = (b: number) => b.toString(16).padStart(2, "0");
      return `avc1.${h(annexB[n + 1]!)}${h(annexB[n + 2]!)}${h(annexB[n + 3]!)}`;
    }
  }
  return undefined;
}
