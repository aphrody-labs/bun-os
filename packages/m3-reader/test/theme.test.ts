// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("optional Dragon Ball stylesheet resolves and ships the generated seed scheme", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
  const path = Bun.resolveSync("@aphrody/m3-reader/dragon-ball.css", import.meta.dir);
  expect(path).toBe(resolve(import.meta.dir, "../dragon-ball.css"));
  expect(manifest.files).toContain("dragon-ball.css");
  expect(manifest.sideEffects).toContain("*.css");
  const css = await Bun.file(path).text();
  expect(css).toContain("SPDX-License-Identifier: Apache-2.0");
  expect(css).toContain('@import "./dragon-ball.scheme.css";');
  expect(css).not.toMatch(/#[0-9a-f]{3,8}|--reader-/i);
  expect(manifest.files).toContain("dragon-ball.scheme.css");
  const scheme = await Bun.file(resolve(import.meta.dir, "../dragon-ball.scheme.css")).text();
  expect(scheme).toContain("GENERATED - do not hand-edit");
  expect(scheme).toContain("seed #e78220");
  expect(scheme).toContain(".m3-reader--dragon-ball .m3-reader {");
  expect(scheme).toContain("--md-sys-color-primary:");
  expect(css).toContain("skewX(-12.3deg)");
  expect(css).toContain(".m3-reader--dragon-ball .m3-reader-scroll");
});

test("the Dragon Ball scheme sheet matches the canonical engine output", () => {
  const run = Bun.spawnSync([process.execPath, "scripts/generate-scheme.ts", "--check"], {
    cwd: resolve(import.meta.dir, ".."),
  });
  expect(run.stderr.toString()).toBe("");
  expect(run.exitCode).toBe(0);
});
