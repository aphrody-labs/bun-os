// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildArgs, gitToken, imageTag, readPins, runArgs } from "./aphrody-build.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const PINS = `${ROOT}/docs/aphrody`;

test("pins come from the repository manifests", async () => {
  const pins = readPins(
    await Bun.file(`${PINS}/rust-toolchain.toml`).text(),
    await Bun.file(`${PINS}/package.json`).text(),
    await Bun.file(`${ROOT}/Cargo.lock`).text(),
  );
  expect(pins.rustChannel).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pins.bun).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pins.bunRelease).toBe(`bun-v${pins.bun}`);
  expect(pins.wasmBindgen).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pins.rustTargets).toContain("x86_64-pc-windows-msvc");
  expect(pins.rustTargets).toContain("wasm32-unknown-unknown");
  expect(pins.rustComponents).toContain("clippy");
});

test("image build is tagged versioned and latest, from the small build context", () => {
  const pins = {
    rustChannel: "1.98.1",
    rustTargets: ["x86_64-unknown-linux-gnu", "wasm32-unknown-unknown"],
    rustComponents: ["rustfmt", "clippy"],
    bun: "1.4.2",
    bunRelease: "bun-v1.4.2",
    wasmBindgen: "0.2.129",
  };
  const args = buildArgs(pins, "0123456789abcdef");
  expect(imageTag(pins, "0123456789abcdef")).toBe("aphrody-build:1.98.1-bun1.4.2-012345678");
  expect(args).toContain("aphrody-build:latest");
  expect(args).toContain("RUST_TARGETS=x86_64-unknown-linux-gnu wasm32-unknown-unknown");
  expect(args).toContain("BUN_RELEASE_VERSION=bun-v1.4.2");
  expect(args.at(-1)).toBe("tools/aphrody/config/container/build");
});

test("run is bounded, non-root, cache-backed and passes secrets by name only", () => {
  const args = runArgs({
    repo: "/home/u/shenron",
    command: ["cargo", "build"],
    uid: 1002,
    gid: 1002,
    targetVolume: "shenron",
    env: ["SITE_BUILD_DATABASE_URL"],
    lock: false,
  });
  expect(args.slice(0, 2)).toEqual(["docker", "run"]);
  expect(args).toContain("1002:1002");
  expect(args).toContain("--memory-swap");
  expect(args).toContain("/home/u/shenron:/home/u/shenron");
  expect(args).toContain("aphrody-build-sccache:/cache/sccache");
  expect(args).toContain("aphrody-build-target-shenron:/cache/target");
  expect(args).toContain("SITE_BUILD_DATABASE_URL");
  expect(args.join(" ")).not.toContain("SITE_BUILD_DATABASE_URL=");
  expect(args.slice(-3)).toEqual(["aphrody-build:latest", "cargo", "build"]);
});

test("run refuses unbounded or unsafe inputs", () => {
  const base = { repo: "/r", command: ["true"], uid: 1, gid: 1, lock: false };
  expect(() => runArgs({ ...base, cpus: "12" })).toThrow();
  expect(() => runArgs({ ...base, repo: "relative" })).toThrow();
  expect(() => runArgs({ ...base, env: ["A=b"] })).toThrow();
  expect(() => runArgs({ ...base, targetVolume: "../x" })).toThrow();
  expect(() => runArgs({ ...base, command: [] })).toThrow();
});

test("git token: caller environment first, gh last, never required", () => {
  expect(gitToken({ APHRODY_GIT_TOKEN: "a", GH_TOKEN: "b" }, () => "c")).toBe("a");
  expect(gitToken({ GITHUB_TOKEN: "d" }, () => "c")).toBe("d");
  expect(gitToken({}, () => "c")).toBe("c");
  expect(gitToken({}, () => undefined)).toBeUndefined();
});
