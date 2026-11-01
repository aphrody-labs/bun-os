// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { withM3, generateM3Metadata } from "../src/index";

test("the source contract ships its real typed implementation without replacing distribution entries", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
  expect(manifest.files).toContain("src");
  expect(manifest.exports["./source"]).toEqual({ types: "./src/index.ts", default: "./src/index.ts" });
  expect(await Bun.file(new URL(`../${manifest.exports["./source"].types}`, import.meta.url)).exists()).toBe(true);
  expect(manifest.types).toBe("./src/index.ts");
  expect(manifest.exports["."].types).toBe("./src/index.ts");
  expect(manifest.exports["."].default).toBe("./dist/index.js");
  expect(typeof withM3).toBe("function");
  expect(typeof generateM3Metadata).toBe("function");
});
