import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Adb } from "../src/adb.ts";
import { frameToWire, inputToControl, safeRemotePath, startGateway } from "../src/gateway.ts";
import { ScrcpySession, connectTcp } from "../src/session.ts";
import { ACTION, CODEC, CTRL, encodeMediaPacket, encodeSessionPacket, encodeTouch } from "../src/scrcpy.ts";

setDefaultTimeout(15_000);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// Synthetic H.264-shaped payloads: SPS/PPS config, then one key frame and deltas of distinct content.
const CONFIG = Uint8Array.from([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0xac, 0, 0, 0, 1, 0x68, 0xee, 0x3c]);
const frame = (i: number, size: number) => new Uint8Array(size).map((_, j) => (i * 31 + j) & 0xff);

/** A scrcpy server double: dummy byte, device name, codec, session packet, then frames. Records control bytes. */
function fakeScrcpy(frames: number) {
  const control: number[][] = [];
  const sent: string[] = [];
  let accepted = 0;
  const listener = Bun.listen<{ role: "video" | "control" }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        s.data = { role: accepted++ === 0 ? "video" : "control" };
        if (s.data.role !== "video") return;
        const name = new Uint8Array(64);
        name.set(new TextEncoder().encode("fake-android"));
        const codec = new Uint8Array(4);
        new DataView(codec.buffer).setUint32(0, CODEC.h264);
        s.write(Uint8Array.of(0));
        s.write(name);
        s.write(codec);
        s.write(encodeSessionPacket(720, 1280));
        s.write(encodeMediaPacket({ config: true, pts: 0n, data: CONFIG }));
        for (let i = 0; i < frames; i++) {
          const data = frame(i, 2000 + i * 500);
          sent.push(sha(data));
          s.write(encodeMediaPacket({ key: i === 0, pts: BigInt(i * 16_000), data }));
        }
      },
      data(s, d) {
        if (s.data.role === "control") control.push([...new Uint8Array(d)]);
      },
    },
  });
  return { port: listener.port, control, sent, stop: () => listener.stop(true) };
}

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function setup(frames = 5, extra: Parameters<typeof startGateway>[0] = {}) {
  const fake = fakeScrcpy(frames);
  cleanup.push(fake.stop);
  const gw = startGateway({
    token: "secret",
    sessionFor: () =>
      ScrcpySession.start(async () => ({ video: await connectTcp(fake.port), control: await connectTcp(fake.port) })),
    ...extra,
  });
  cleanup.push(() => gw.stop());
  return { fake, gw };
}

describe("gateway", () => {
  test("refuses to start without any authentication", () => {
    expect(() => startGateway({})).toThrow("authorize");
  });

  test("rejects requests without the token and accepts Bearer or ?token", async () => {
    const { gw } = await setup();
    expect((await fetch(`${gw.url}/api/health`)).status).toBe(401);
    expect((await fetch(`${gw.url}/api/health`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await fetch(`${gw.url}/api/health`, { headers: { authorization: "Bearer secret" } })).status).toBe(200);
    expect((await fetch(`${gw.url}/api/health?token=secret`)).status).toBe(200);
  });

  test("streams every frame to the browser byte for byte and forwards touch to the control socket", async () => {
    const { fake, gw } = await setup(5);
    const ws = new WebSocket(`${gw.url.replace("http", "ws")}/stream?token=secret`);
    ws.binaryType = "arraybuffer";
    const texts: string[] = [];
    const binary: Uint8Array[] = [];
    const done = Promise.withResolvers<void>();
    ws.onmessage = e => {
      if (typeof e.data === "string") texts.push(e.data);
      else {
        binary.push(new Uint8Array(e.data));
        if (binary.length === 6) done.resolve(); // config + 5 frames
      }
    };
    await done.promise;

    expect(JSON.parse(texts[0]!)).toEqual({
      type: "meta",
      codec: "h264",
      width: 720,
      height: 1280,
      name: "fake-android",
    });
    expect(binary[0]![0]).toBe(1); // config flag
    expect([...binary[0]!.subarray(9)]).toEqual([...CONFIG]);
    expect(binary.slice(1).map(w => sha(w.subarray(9)))).toEqual(fake.sent);
    expect(binary[1]![0]).toBe(2); // first frame is a key frame
    expect(binary[2]![0]).toBe(0);

    ws.send(JSON.stringify({ t: "touch", action: "down", x: 360, y: 640, w: 720, h: 1280, id: 1 }));
    ws.send("not json");
    ws.send(JSON.stringify({ t: "touch", action: "down", x: "evil", y: 0, w: 1, h: 1 }));
    const expected = [...encodeTouch({ action: ACTION.down, x: 360, y: 640, width: 720, height: 1280, pointerId: 1n })];
    const deadline = Date.now() + 5000;
    while (!fake.control.flat().length || fake.control.flat().length < 1 + expected.length) {
      if (Date.now() > deadline) throw new Error("touch never reached the control socket");
      await Bun.sleep(10);
    }
    const bytes = fake.control.flat();
    expect(bytes[0]).toBe(CTRL.resetVideo); // sent on subscribe so a new client gets a key frame
    expect(bytes.slice(1)).toEqual(expected); // malformed input produced nothing
    ws.close();
  });

  test("a second client shares the same scrcpy session", async () => {
    const { gw } = await setup(1);
    const open = () =>
      new Promise<WebSocket>(res => {
        const w = new WebSocket(`${gw.url.replace("http", "ws")}/stream?token=secret`);
        w.onmessage = () => res(w);
      });
    const a = await open();
    const b = await open();
    expect(gw.sessions.size).toBe(1);
    a.close();
    b.close();
  });

  test("apk upload requires the zip signature and passes bytes to adb", async () => {
    const installed: number[] = [];
    const fakeAdb = {
      installBytes: async (b: Uint8Array) => (installed.push(b.byteLength), "Success"),
    } as unknown as Adb;
    const { gw } = await setup(1, { adb: () => fakeAdb });
    const h = { authorization: "Bearer secret" };
    const bad = await fetch(`${gw.url}/api/install`, { method: "POST", body: "hello", headers: h });
    expect(bad.status).toBe(400);
    const ok = await fetch(`${gw.url}/api/install?name=a.apk`, {
      method: "POST",
      body: Uint8Array.of(0x50, 0x4b, 3, 4, 0),
      headers: h,
    });
    expect(await ok.json()).toEqual({ ok: true, output: "Success" });
    expect(installed).toEqual([5]);
  });

  test("file paths are limited to the sdcard and /data/local/tmp", () => {
    expect(safeRemotePath("/sdcard/Download/a.txt")).toBe("/sdcard/Download/a.txt");
    expect(safeRemotePath("/data/local/tmp/x")).toBe("/data/local/tmp/x");
    expect(safeRemotePath("/sdcard/../data/data/x")).toBeUndefined();
    expect(safeRemotePath("/data/data/app/secret")).toBeUndefined();
    expect(safeRemotePath("/system/build.prop")).toBeUndefined();
    expect(safeRemotePath(null)).toBeUndefined();
  });

  test("input validation", () => {
    expect(inputToControl({ t: "touch", action: "move", x: 1, y: 2, w: 0, h: 5 })).toBeUndefined();
    expect(inputToControl({ t: "touch", action: "move", x: 1, y: 2, w: 70000, h: 5 })).toBeUndefined();
    expect(inputToControl({ t: "back" })?.[0]).toBe(CTRL.backOrScreenOn);
    expect(inputToControl({ t: "text", text: "x".repeat(5000) })).toBeUndefined();
    expect(inputToControl({ t: "nope" } as never)).toBeUndefined();
    const w = frameToWire({ config: false, key: true, pts: 258n, data: Uint8Array.of(7) });
    expect([...w]).toEqual([2, 0, 0, 0, 0, 0, 0, 1, 2, 7]);
  });
});
