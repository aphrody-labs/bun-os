import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findEngine } from "../src/nds/engine-path";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("findEngine", () => {
  test("finds binaries produced in isolated BunCC worker slots", () => {
    const root = mkdtempSync(join(tmpdir(), "bun-engine-path-"));
    tempDirs.push(root);
    writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
    writeFileSync(join(root, "package.json"), "{}\n");
    writeFileSync(join(root, "rust-toolchain.toml"), "[toolchain]\nchannel = 'stable'\n");
    const binary = join(root, "target", "slot-7", "release", `bun-engine${process.platform === "win32" ? ".exe" : ""}`);
    mkdirSync(join(root, "target", "slot-7", "release"), { recursive: true });
    writeFileSync(binary, "native executable placeholder");

    expect(
      findEngine(root, {
        BUN_ENGINE_NATIVE: undefined,
        CARGO_TARGET_DIR: undefined,
        LOCALAPPDATA: undefined,
        PATH: "",
      }),
    ).toBe(binary);
  });
});
