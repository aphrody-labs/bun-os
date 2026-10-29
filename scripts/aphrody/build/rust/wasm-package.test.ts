// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWasmPackage, repositoryRoot, type PackOptions, type Packer, type ToolRunner } from "./wasm-package";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

type Mode = "success" | "fetch-failure" | "pack-failure" | "larger";
async function fixture(mode: Mode = "success") {
  const root = await mkdtemp(join(tmpdir(), "aphrody-wasm-test-"));
  directories.push(root);
  const out = join(root, "pkg");
  await mkdir(out);
  await Bun.write(join(out, "command_wasm_bg.wasm"), new Uint8Array(10));
  const calls: string[][] = [];
  const packed: PackOptions[] = [];
  const artifacts: boolean[] = [];
  const run: ToolRunner = async command => {
    calls.push(command);
    const value = (flag: string) => command[command.indexOf(flag) + 1]!;
    if (command.includes("fetch")) {
      if (mode === "fetch-failure") return { exitCode: 1, stdout: "checksum mismatch" };
      await Bun.write(join(value("--dest"), value("--bin")), new Uint8Array(12));
      return {
        exitCode: 3,
        stdout: "checksum verified, module cannot execute here",
      };
    }
    return { exitCode: 0, stdout: "" };
  };
  const pack: Packer = async options => {
    packed.push(options);
    artifacts.push(await Bun.file(options.artifact).exists());
    if (mode === "pack-failure") throw new Error("wasm-opt produced an invalid module");
    return {
      wasm: join(options.outdir, `${options.name}_bg.wasm`),
      rawBytes: 12,
      bytes: options.optimize === false || mode === "larger" ? 12 : 8,
    };
  };
  return { root, out, calls, packed, artifacts, run, pack };
}

describe("WASM release package", () => {
  test("cloud sessions use the canonical serialized owner before wasm-bindgen packaging", async () => {
    const f = await fixture();
    const result = await buildWasmPackage({ crate: "command-wasm", out: f.out }, { ...f, env: { APHRODY_CLOUD: "1" } });
    const cargo = f.calls.find(command => command.includes("build"))!;
    expect(cargo.slice(0, 4)).toEqual([process.execPath, join(repositoryRoot, "scripts/cargo.ts"), "exec", "--"]);
    expect(await Bun.file(cargo[1]!).exists()).toBe(true);
    expect(await Bun.file(join(repositoryRoot, "aphrody.config.json")).exists()).toBe(true);
    expect(cargo).toContain("--locked");
    expect(cargo).toContain("--release");
    expect(f.packed).toEqual([
      {
        crate: join(f.root, "Cargo.toml"),
        package: "command-wasm",
        artifact: join(f.root, "target", "wasm32-unknown-unknown", "release", "command_wasm.wasm"),
        outdir: f.out,
        name: "command_wasm",
        target: "web",
        optimize: "Oz",
        maxBytes: undefined,
        packageJson: false,
        quiet: true,
      },
    ]);
    expect(result).toEqual({
      wasm: join(f.out, "command_wasm_bg.wasm"),
      rawBytes: 12,
      bytes: 8,
      previousBytes: 10,
      delta: -2,
      optimization: "optimized (-Oz converged; saved 4 bytes)",
    });
  });

  test("the factory build is locked, its checksum-verified fetch (exit 3) is packaged, then removed", async () => {
    const f = await fixture();
    await buildWasmPackage({ crate: "command-wasm", out: f.out }, { ...f, env: {}, platform: "linux" });
    const cargo = f.calls.find(command => command.includes("run"))!;
    expect(cargo[0]).toBe("bun");
    expect(cargo).toContain("--locked");
    expect(f.artifacts).toEqual([true]);
    expect(await Bun.file(f.packed[0]!.artifact).exists()).toBe(false);
  });

  test("a failed fetch stops before packaging", async () => {
    const f = await fixture("fetch-failure");
    await expect(
      buildWasmPackage({ crate: "command-wasm", out: f.out }, { ...f, env: {}, platform: "linux" }),
    ).rejects.toThrow("fetching the wasm artifact failed (1)");
    expect(f.packed).toEqual([]);
  });

  test("Windows hosts run locked Cargo through the native build wrapper", async () => {
    const f = await fixture();
    await buildWasmPackage({ crate: "command-wasm", out: f.out }, { ...f, env: {}, platform: "win32" });
    const cargo = f.calls.find(command =>
      command.some(arg => arg.endsWith("scripts/cargo.ts") || arg.endsWith("scripts\\cargo.ts")),
    )!;
    expect(cargo).toContain("--locked");
    expect(cargo).toContain("--release");
    expect(f.calls.some(command => command.includes("fetch"))).toBe(false);
  });

  test("--manifest-path builds a crate outside the root workspace into the repository target", async () => {
    const f = await fixture();
    const manifest = "crates/web/dragon-pixel-wasm/Cargo.toml";
    await buildWasmPackage(
      { crate: "dragon-pixel-wasm", out: f.out, manifestPath: manifest },
      { ...f, env: {}, platform: "win32" },
    );
    const cargo = f.calls.find(command =>
      command.some(arg => arg.endsWith("scripts/cargo.ts") || arg.endsWith("scripts\\cargo.ts")),
    )!;
    expect(cargo.slice(cargo.indexOf("--manifest-path"), cargo.indexOf("--manifest-path") + 2)).toEqual([
      "--manifest-path",
      manifest,
    ]);
    expect(cargo.slice(-2)).toEqual(["--target-dir", join(f.root, "target")]);
    expect(f.packed[0]!.crate).toBe(join(f.root, manifest));
    expect(f.packed[0]!.artifact).toBe(
      join(f.root, "target", "wasm32-unknown-unknown", "release", "dragon_pixel_wasm.wasm"),
    );
  });

  test("--manifest-path through the VPS keeps the remote target directory", async () => {
    const f = await fixture();
    await buildWasmPackage(
      {
        crate: "dragon-pixel-wasm",
        out: f.out,
        manifestPath: "crates/web/dragon-pixel-wasm/Cargo.toml",
      },
      { ...f, env: {}, platform: "linux" },
    );
    const cargo = f.calls.find(command => command.includes("build"))!;
    expect(cargo).toContain("--manifest-path");
    expect(cargo).not.toContain("--target-dir");
  });

  test("--manifest-path outside the repository is rejected", async () => {
    const f = await fixture();
    await expect(buildWasmPackage({ crate: "x", out: f.out, manifestPath: "../other/Cargo.toml" }, f)).rejects.toThrow(
      "inside the repository",
    );
  });

  test("--no-opt and --skip-cargo package the existing artifact without wasm-opt", async () => {
    const f = await fixture();
    const result = await buildWasmPackage(
      {
        crate: "command-wasm",
        out: f.out,
        noOpt: true,
        skipCargo: true,
        maxBytes: 64,
      },
      { ...f, env: { APHRODY_CLOUD: "1" } },
    );
    expect(f.calls).toEqual([]);
    expect(f.packed[0]).toMatchObject({ optimize: false, maxBytes: 64 });
    expect(result.optimization).toBe("skipped (--no-opt)");
  });

  test("reports a module wasm-opt could not shrink", async () => {
    const f = await fixture("larger");
    const result = await buildWasmPackage(
      { crate: "command-wasm", out: f.out, skipCargo: true },
      { ...f, env: { APHRODY_CLOUD: "1" } },
    );
    expect(result.bytes).toBe(12);
    expect(result.optimization).toContain("original size retained");
  });

  test("packaging errors propagate", async () => {
    const f = await fixture("pack-failure");
    await expect(
      buildWasmPackage({ crate: "command-wasm", out: f.out, skipCargo: true }, { ...f, env: { APHRODY_CLOUD: "1" } }),
    ).rejects.toThrow("wasm-opt produced an invalid module");
  });

  test("rejects names that are not package names and outputs that are not package directories", async () => {
    const f = await fixture();
    await expect(buildWasmPackage({ crate: "../x", out: f.out }, f)).rejects.toThrow("only letters");
    await expect(buildWasmPackage({ crate: "command-wasm", out: f.root }, f)).rejects.toThrow(
      "output must be a package directory",
    );
  });
});
