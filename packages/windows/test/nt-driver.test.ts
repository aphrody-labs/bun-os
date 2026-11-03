import { describe, expect, test } from "bun:test";
import { available, BunOsDevice, IOCTL_BUNOS_PING, IOCTL_BUNOS_VERSION } from "../src/nt-driver";

describe("bunos.sys contract", () => {
  test("control codes match the driver (CTL_CODE 0x22, 0x800/0x801, METHOD_BUFFERED)", () => {
    expect(IOCTL_BUNOS_VERSION).toBe(0x0022_2000);
    expect(IOCTL_BUNOS_PING).toBe(0x0022_2004);
  });

  test.skipIf(process.platform !== "win32")("open reports an absent driver as null, not an error", () => {
    const device = BunOsDevice.open();
    expect(device === null).toBe(!available());
    device?.close();
  });
});

// Runs only where bunos.sys is loaded (the Windows 11 test VM, docs/NTCORE.md); skipped everywhere else.
describe.skipIf(process.platform !== "win32" || !available())("bunos.sys round trip", () => {
  test("version and ping", () => {
    using device = BunOsDevice.open()!;
    expect(device.version()).toStartWith("bunos.sys ");
    const payload = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(device.ping(payload)).toEqual(payload);
  });
});
