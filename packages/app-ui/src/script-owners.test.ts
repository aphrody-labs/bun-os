// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import manifest from "../package.json";

const root = resolve(import.meta.dir, "..");

test("dev uses the native M3 owner and the showcase scripts live only in apps/m3-showcase", async () => {
  expect(manifest.scripts.dev).toBe("bun ../m3/bin/m3.ts dev");
  expect(await Bun.file(resolve(root, "../m3/bin/m3.ts")).exists()).toBe(true);
  expect(Object.keys(manifest.scripts).filter(name => name.startsWith("showcase:"))).toEqual([]);
  expect(await Bun.file(resolve(root, "../../apps/m3-showcase/package.json")).exists()).toBe(true);
});

test("the source CLI executes help without starting a server or native build", async () => {
  const child = Bun.spawn([process.execPath, "../m3/bin/m3.ts", "help"], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    timeout: 10_000,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain("m3 dev");
});
