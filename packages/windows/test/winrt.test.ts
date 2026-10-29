import { beforeAll, describe, expect, test } from "bun:test";
import { buildAddon, isAddonBuilt, loadAddon } from "../src/provider";
import * as winrt from "../src/winrt";

// The addon is built on demand (cargo, about 10 s warm) unless APHRODY_WINDOWS_SKIP_BUILD=1.
const enabled = process.platform === "win32";

describe.skipIf(!enabled)("winrt (windows-rs N-API addon)", () => {
  beforeAll(async () => {
    if (!isAddonBuilt() && process.env.APHRODY_WINDOWS_SKIP_BUILD !== "1") await buildAddon();
  }, 600_000);

  test("Uri parses through Windows.Foundation", () => {
    const uri = winrt.parseUri("https://example.com:8443/a/b?x=1#frag");
    expect(uri).toMatchObject({
      scheme: "https",
      host: "example.com",
      port: 8443,
      path: "/a/b",
      query: "?x=1",
      fragment: "#frag",
    });
  });

  test("an invalid Uri surfaces the HRESULT", () => {
    expect(() => winrt.parseUri("not a uri")).toThrow(/ERR_WINDOWS_HRESULT/);
  });

  test("StorageFolder reads a real folder", () => {
    const info = winrt.folderInfo(process.env.SystemRoot!);
    expect(info.path.toLowerCase()).toBe(process.env.SystemRoot!.toLowerCase());
    expect(info.name.toLowerCase()).toBe("windows");
    expect(info.created.getFullYear()).toBeGreaterThan(2000);
  });

  test("device family and provider version", () => {
    expect(winrt.deviceFamily()).toBe("Windows.Desktop");
    expect(loadAddon().providerVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
