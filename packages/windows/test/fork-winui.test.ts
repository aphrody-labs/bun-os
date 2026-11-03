// SPDX-License-Identifier: Apache-2.0
// bun:winui on upstream Bun (src/fork/winui.ts), ported from the fork's test/js/bun/winui/winui.test.ts.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const isWindows = process.platform === "win32";
const module = join(import.meta.dir, "..", "src", "fork", "winui.ts").replaceAll("\\", "/");

async function run(args: string[]) {
  await using proc = Bun.spawn({ cmd: [process.execPath, ...args], stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function hasWindowsAppRuntime() {
  if (!isWindows) return false;
  const probe = Bun.spawnSync({
    cmd: [process.execPath, "-e", `import w from ${JSON.stringify(module)}; process.exit(w.isSupported() ? 0 : 1)`],
    stdout: "ignore",
    stderr: "ignore",
  });
  return probe.exitCode === 0;
}

describe("bun:winui", () => {
  test("exports", async () => {
    const winui = (await import("../src/fork/winui")).default;
    expect(Object.keys(winui).sort()).toEqual([
      "Application",
      "Element",
      "Window",
      "app",
      "isSupported",
      "runtime",
      "start",
    ]);
    expect(winui.app).toBeNull();
  });

  test.skipIf(isWindows)("is unsupported off Windows", async () => {
    const winui = (await import("../src/fork/winui")).default;
    expect(winui.isSupported()).toBe(false);
    expect(() => winui.start()).toThrow(expect.objectContaining({ code: "ERR_WINUI_UNSUPPORTED" }));
  });

  test.skipIf(!isWindows)("reports a missing Windows App Runtime", async () => {
    const { stdout, exitCode } = await run([
      "-e",
      `import winui from ${JSON.stringify(module)};
       console.log(winui.isSupported({ version: "0.1" }));
       try { winui.runtime({ version: "0.1" }); } catch (e) { console.log(e.code); }
       try { winui.start({ version: "x" }); } catch (e) { console.log(e.name); }`,
    ]);
    expect(stdout).toBe("false\nERR_WINUI_RUNTIME_NOT_FOUND\nTypeError\n");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!hasWindowsAppRuntime())(
    "opens a WinUI 3 window, checks its XAML tree and closes itself",
    async () => {
      const { stdout, stderr, exitCode } = await run([join(import.meta.dir, "fork-winui-window.fixture.ts")]);
      const [json, last] = stdout.split(/\n(?=closed )/);
      let result;
      try {
        result = JSON.parse(json!);
      } catch {
        result = { stdout, stderr };
      }
      expect(result).toMatchObject({
        runtime: true,
        hwnd: true,
        title: "bun:winui fixture",
        loaded: true,
        label: "Au revoir",
        password: "secret",
        combo: "Deux",
        toggle: true,
        menu: "MenuFlyout",
        events: ["Click Button", "TextChanged modifié"],
        resources: 2,
      });
      expect(result.tree.children).toHaveLength(12);
      expect(last).toBe("closed true true\n");
      expect(exitCode).toBe(0);
    },
    60_000,
  );
});
