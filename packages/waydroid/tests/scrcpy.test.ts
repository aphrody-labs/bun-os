import { describe, expect, test } from "bun:test";
import {
  ACTION,
  ByteQueue,
  CODEC,
  avcCodecString,
  encodeKeycode,
  encodeMediaPacket,
  encodeScroll,
  encodeSessionPacket,
  encodeSetClipboard,
  encodeText,
  encodeTouch,
  readStreamHeader,
  readVideoPacket,
  serverArgs,
  socketName,
} from "../src/scrcpy.ts";

describe("scrcpy protocol", () => {
  test("stream header: dummy byte, 64-byte name, codec id", async () => {
    const q = new ByteQueue();
    const name = new Uint8Array(64);
    name.set(new TextEncoder().encode("Waydroid x86_64"));
    const codec = new Uint8Array(4);
    new DataView(codec.buffer).setUint32(0, CODEC.h264);
    // deliver in awkward chunks to exercise reassembly
    const all = Uint8Array.from([0, ...name, ...codec]);
    for (let i = 0; i < all.length; i += 7) q.push(all.slice(i, i + 7));
    expect(await readStreamHeader(q, { dummyByte: true })).toEqual({ deviceName: "Waydroid x86_64", codec: "h264" });
  });

  test("session and media packets round trip with flags and 61-bit pts", async () => {
    const q = new ByteQueue();
    q.push(encodeSessionPacket(720, 1280, true));
    const pts = (1n << 40n) + 12345n;
    q.push(encodeMediaPacket({ config: true, key: false, pts, data: Uint8Array.of(1, 2, 3) }));
    q.push(encodeMediaPacket({ key: true, pts: 7n, data: new Uint8Array(100_000).fill(9) }));
    expect(await readVideoPacket(q)).toEqual({ kind: "session", width: 720, height: 1280, resized: true });
    const cfg = await readVideoPacket(q);
    expect(cfg).toMatchObject({ kind: "media", config: true, key: false, pts });
    const key = await readVideoPacket(q);
    expect(key.kind === "media" && key.key && key.data.byteLength).toBe(100_000);
  });

  test("a stream that ends mid packet fails instead of hanging", async () => {
    const q = new ByteQueue();
    q.push(encodeMediaPacket({ pts: 0n, data: new Uint8Array(10) }).subarray(0, 15));
    q.end();
    await expect(readVideoPacket(q)).rejects.toThrow("stream ended");
  });

  test("control messages have the layout of ControlMessageReader", () => {
    const t = encodeTouch({ action: ACTION.down, x: 100, y: 200, width: 720, height: 1280, pointerId: 5n });
    expect(t.byteLength).toBe(32);
    const v = new DataView(t.buffer);
    expect([
      t[0],
      t[1],
      Number(v.getBigUint64(2)),
      v.getInt32(10),
      v.getInt32(14),
      v.getUint16(18),
      v.getUint16(20),
    ]).toEqual([2, 0, 5, 100, 200, 720, 1280]);
    expect(v.getUint16(22)).toBe(0xffff); // full pressure
    expect(new DataView(encodeTouch({ action: ACTION.up, x: 0, y: 0, width: 1, height: 1 }).buffer).getUint16(22)).toBe(
      0,
    );

    const k = encodeKeycode(0, 66);
    expect([k.byteLength, k[0], new DataView(k.buffer).getInt32(2)]).toEqual([14, 0, 66]);

    const txt = encodeText("héllo");
    expect(new DataView(txt.buffer).getUint32(1)).toBe(6);
    const clip = encodeSetClipboard("abc", true, 3n);
    expect([clip[0], clip[9], new DataView(clip.buffer).getUint32(10), clip.byteLength]).toEqual([
      9,
      1,
      3,
      1 + 8 + 1 + 4 + 3,
    ]);

    const s = encodeScroll({ x: 1, y: 2, width: 3, height: 4, dx: 0, dy: -16 });
    expect(new DataView(s.buffer).getInt16(15)).toBe(-0x7fff);
  });

  test("server args and socket name use the 8-digit hex scid", () => {
    expect(socketName(255)).toBe("scrcpy_000000ff");
    const a = serverArgs({ scid: 255, maxSize: 1280, maxFps: 30 });
    expect(a).toContain("scid=000000ff");
    expect(a).toContain("tunnel_forward=true");
    expect(a).toContain("max_size=1280");
  });

  test("avc codec string comes from the SPS", () => {
    const cfg = Uint8Array.from([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0xac, 0, 0, 0, 1, 0x68, 0xee]);
    expect(avcCodecString(cfg)).toBe("avc1.64001f");
    expect(avcCodecString(Uint8Array.from([0, 0, 1, 0x65, 1, 2, 3, 4]))).toBeUndefined();
  });
});
