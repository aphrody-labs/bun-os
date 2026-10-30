// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { capture, rewrite } from "../src/pins.ts";
import { wslDrift } from "../src/systemd.ts";
import { lockDiff, lockMap } from "../src/cargo.ts";

describe("pins", () => {
  const t = { file: "x", re: '"packageManager": "bun@(\\d+\\.\\d+\\.\\d+)"' };
  test("capture and rewrite one group", () => {
    const text = '{ "packageManager": "bun@1.4.2", "other": "1.4.2" }';
    expect(capture(text, t)).toEqual(["1.4.2"]);
    expect(rewrite(text, t, "1.5.0")).toBe('{ "packageManager": "bun@1.5.0", "other": "1.4.2" }');
  });
  test("multiline rewrites every match", () => {
    const m = {
      file: "Cargo.toml",
      re: '^nu-[a-z-]+ = \\{ version = "(\\d+\\.\\d+\\.\\d+)"',
      multiline: true,
    };
    const text = 'nu-a = { version = "0.115.1" }\nnu-b = { version = "0.115.1", x = 1 }\n';
    expect(rewrite(text, m, "0.116.0")).toBe('nu-a = { version = "0.116.0" }\nnu-b = { version = "0.116.0", x = 1 }\n');
  });
});

describe("wslDrift", () => {
  test("reports missing and different keys only", () => {
    const tpl = "[boot]\nsystemd=true\n[interop]\nenabled=true\n";
    expect(wslDrift(tpl, "[boot]\nsystemd=true\n")).toEqual(["interop.enabled: want true, have (unset)"]);
    expect(wslDrift(tpl, "[boot]\nsystemd=false\n[interop]\nenabled=true\n")).toEqual([
      "boot.systemd: want true, have false",
    ]);
  });
});

describe("lockDiff", () => {
  test("added, changed and removed packages", () => {
    const a = lockMap('[[package]]\nname = "a"\nversion = "1.0.0"\n[[package]]\nname = "gone"\nversion = "1.0.0"\n');
    const b = lockMap('[[package]]\nname = "a"\nversion = "1.1.0"\n[[package]]\nname = "new"\nversion = "2.0.0"\n');
    expect(
      lockDiff(a, b)
        .map(c => `${c.name}:${c.from}>${c.to}`)
        .toSorted(),
    ).toEqual(["a:1.0.0>1.1.0", "gone:1.0.0>(removed)", "new:(new)>2.0.0"]);
  });
});

describe("tools.install bun", () => {
  test("runs the upstream Bun installer for the pinned base version", async () => {
    const { install, BUN_INSTALLER } = await import("../src/tools.ts");
    const calls: string[][] = [];
    const ctx = {
      run: (cmd: string, args: string[]) => (calls.push([cmd, ...args]), { status: 0, stdout: "", stderr: "" }),
    };
    expect(install(ctx as never, "bun", "1.4.3")).toBe(true);
    expect(BUN_INSTALLER).toBe("https://bun.com/install");
    const line = calls[0].join(" ");
    expect(line).toContain(BUN_INSTALLER);
    expect(line).toContain("1.4.3");
    expect(line).not.toContain("aphrody");
  });
});
