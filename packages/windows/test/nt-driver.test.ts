import { describe, expect, test } from "bun:test";
import {
  ABI,
  available,
  BunOsDevice,
  decodeCaps,
  decodeEvents,
  IOCTL_BUNOS_CAPS,
  IOCTL_BUNOS_EVENTS_CONFIG,
  IOCTL_BUNOS_EVENTS_READ,
  IOCTL_BUNOS_PING,
  IOCTL_BUNOS_VERSION,
  parseSources,
  RECORD_SIZE,
} from "../src/nt-driver";

describe("bunos.sys contract", () => {
  test("control codes match bunos-nt-proto", () => {
    expect(IOCTL_BUNOS_VERSION).toBe(0x0022_2000);
    expect(IOCTL_BUNOS_PING).toBe(0x0022_2004);
    expect(IOCTL_BUNOS_CAPS).toBe(0x0022_6008);
    expect(IOCTL_BUNOS_EVENTS_CONFIG).toBe(0x0022_e040);
    expect(IOCTL_BUNOS_EVENTS_READ).toBe(0x0022_6044);
  });

  test("sources", () => {
    expect(parseSources("process, image")).toBe(5);
    expect(parseSources("all")).toBe(15);
    expect(() => parseSources("kernel")).toThrow();
  });

  test("decoders are strict", () => {
    const caps = new Uint8Array(32);
    const c = new DataView(caps.buffer);
    c.setUint32(0, ABI, true);
    c.setUint32(4, 15, true);
    c.setUint32(8, 5, true);
    c.setUint32(12, 512, true);
    c.setUint32(16, RECORD_SIZE, true);
    expect(decodeCaps(caps).sourcesActive).toEqual(["process", "image"]);
    expect(() => decodeCaps(caps.subarray(0, 31))).toThrow();

    const reply = new Uint8Array(16 + RECORD_SIZE);
    const v = new DataView(reply.buffer);
    v.setUint32(0, ABI, true);
    v.setUint32(4, 1, true);
    v.setUint16(16, 1, true); // process_create
    const name = "C:\bun.exe";
    v.setUint16(16 + 4, name.length, true);
    v.setBigUint64(16 + 16, 42n, true);
    for (let i = 0; i < name.length; i++) v.setUint16(16 + 48 + 2 * i, name.charCodeAt(i), true);
    const batch = decodeEvents(reply);
    expect(batch.events[0]).toMatchObject({ kind: "process_create", pid: 42n, name });
    v.setUint32(4, 2, true);
    expect(() => decodeEvents(reply)).toThrow();
    v.setUint32(4, 1, true);
    v.setUint16(16, 99, true);
    expect(() => decodeEvents(reply)).toThrow();
  });

  test.skipIf(process.platform !== "win32")("open reports an absent driver as null, not an error", () => {
    let device: BunOsDevice | null = null;
    try {
      device = BunOsDevice.open();
    } catch (e) {
      expect((e as { code: string }).code).toBe("ERR_WINDOWS_ACCESS");
      return;
    }
    expect(device === null).toBe(!available());
    device?.close();
  });
});

// Runs only where bunos.sys is loaded and the test is elevated (the Windows 11 test VM, docs/NTCORE.md).
describe.skipIf(process.platform !== "win32" || !available())("bunos.sys round trip", () => {
  test("version, ping, caps, events", () => {
    using device = BunOsDevice.open()!;
    expect(device.version()).toStartWith("bunos.sys ");
    const payload = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(device.ping(payload)).toEqual(payload);
    expect(device.caps().abi).toBe(ABI);
    expect(device.configure("process,image").sourcesActive).toEqual(["process", "image"]);
    Bun.spawnSync(["cmd.exe", "/c", "exit"]);
    const batch = device.readEvents(512);
    expect(batch.events.some(e => e.kind === "process_create" && e.name.toLowerCase().endsWith("cmd.exe"))).toBe(true);
    expect(device.configure(0).sourcesActive).toEqual([]);
  });
});
