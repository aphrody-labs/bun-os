// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { CONFIG_PATH, loadConfig, syncConfigFile, type ConfigFs } from "./configfile";
import { prefs } from "./prefs";

class MemFs implements ConfigFs {
  files = new Map<string, Uint8Array>();
  read(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error("ENOENT");
    return f;
  }
  write(path: string, data: Uint8Array) {
    this.files.set(path, data);
  }
  async flush() {}
  text() {
    return new TextDecoder().decode(this.files.get(CONFIG_PATH));
  }
  put(text: string) {
    this.files.set(CONFIG_PATH, new TextEncoder().encode(text));
  }
}

afterEach(() => prefs.reset());

describe("settings file", () => {
  test("a missing file changes nothing", () => {
    expect(loadConfig(new MemFs(), prefs)).toEqual({ applied: 0, skipped: [] });
  });

  test("keys present in the file are applied and validated; unknown or invalid ones are reported", () => {
    const fs = new MemFs();
    fs.put(
      JSON.stringify({
        "windows.gap": 20,
        "windows.tiling": "master",
        "dock.size": "huge",
        "not.a.key": 1,
        "keys.bindings": { "launch.calculator": ["Super+C"] },
      }),
    );
    const report = loadConfig(fs, prefs);
    expect(prefs.get("windows.gap")).toBe(20);
    expect(prefs.get("windows.tiling")).toBe("master");
    expect(prefs.get("keys.bindings")["launch.calculator"]).toEqual(["Super+C"]);
    expect(report.skipped.sort()).toEqual(["dock.size", "not.a.key"]);
    expect(report.applied).toBe(3);
  });

  test("the exported format is accepted too", () => {
    const fs = new MemFs();
    fs.put(JSON.stringify({ format: prefs.export().format, version: 1, prefs: { "windows.border": 4 } }));
    loadConfig(fs, prefs);
    expect(prefs.get("windows.border")).toBe(4);
  });

  test("a malformed file is reported and leaves the preferences alone", () => {
    prefs.set("windows.gap", 12);
    const fs = new MemFs();
    fs.put("{ not json");
    const report = loadConfig(fs, prefs);
    expect(report.error).toBeDefined();
    expect(prefs.get("windows.gap")).toBe(12);
  });

  test("changes in Settings are written to the file", async () => {
    const fs = new MemFs();
    const stop = syncConfigFile(fs, prefs);
    prefs.set("windows.gap", 16);
    await Bun.sleep(5);
    expect(JSON.parse(fs.text())["windows.gap"]).toBe(16);
    stop();
  });

  test("editing the file changes the preferences (polling)", async () => {
    const fs = new MemFs();
    const stop = syncConfigFile(fs, prefs, { poll: 10 });
    fs.put(JSON.stringify({ "windows.gap": 28 }));
    const deadline = Date.now() + 2000;
    while (prefs.get("windows.gap") !== 28 && Date.now() < deadline) await Bun.sleep(10);
    expect(prefs.get("windows.gap")).toBe(28);
    stop();
  });
});
