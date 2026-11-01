// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { migrateProject, scanNextDirectory } from "@aphrody/m3-next-migrate/source";

test("the packaged source entry exposes the real migrator without replacing distribution outputs", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
  expect(manifest.files).toContain("src");
  expect(manifest.exports["./source"]).toEqual({ types: "./src/index.ts", default: "./src/index.ts" });
  expect(await Bun.file(new URL(`../${manifest.exports["./source"].types}`, import.meta.url)).exists()).toBe(true);
  expect(manifest.exports["."].types).toBe("./src/index.ts");
  expect(manifest.exports["."].default).toBe("./dist/index.js");
  expect(typeof migrateProject).toBe("function");
  expect(typeof scanNextDirectory).toBe("function");
});
