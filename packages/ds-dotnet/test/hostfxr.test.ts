import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { findHostfxr } from "../src/hostfxr";

test.skipIf(Bun.which("dotnet") === null)("findHostfxr resolves the newest installed hostfxr library", () => {
  const path = findHostfxr();
  expect(existsSync(path)).toBe(true);
  expect(path).toMatch(/hostfxr\.(dll|dylib|so)$/);
});
