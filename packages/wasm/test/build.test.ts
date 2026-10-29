// Real compilations: rustc builds the fixture crates for wasm32 and the results are run with Bun.
// Each describe skips itself when its tool is missing. `APHRODY_WASM_TEST_NETWORK=1` also allows the
// tests that install wasm-bindgen-cli / fetch binaryen and jco through the network.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { build, canBuildFor, inspect, optimize, pinnedBindgen, runCommand, TRIPLES, validate } from "../src/index.ts";
import { cargoEnv, standaloneCrate, tempDir } from "./helpers.ts";

cargoEnv();
const network = process.env.APHRODY_WASM_TEST_NETWORK === "1";
const raw = await canBuildFor(TRIPLES.unknown);
const p1 = await canBuildFor(TRIPLES.p1);
const p2 = await canBuildFor(TRIPLES.p2);
// `rustup target add` runs inside build(): with a rustup the target need not be installed up front.
const rustup = !!Bun.which("rustup");
const canRaw = raw || (rustup && network);
const canP1 = p1 || (rustup && network);
const canP2 = p2 || (rustup && network);

describe.skipIf(!canRaw)("raw wasm32-unknown-unknown (no wasm-bindgen)", () => {
  test("builds aphrody-wasm-raw into a package that loads and runs", async () => {
    const outdir = join(tempDir(), "pkg");
    const result = await build({
      crate: standaloneCrate("aphrody-wasm-raw"),
      outdir,
      optimize: false,
      quiet: true,
      locked: false,
    });
    expect(result.cached).toBe(false);
    expect(existsSync(result.wasm)).toBe(true);
    expect(result.dts && existsSync(result.dts)).toBeTruthy();
    expect(validate(readFileSync(result.wasm))).toBe(true);

    const info = inspect(readFileSync(result.wasm));
    expect(info.imports).toEqual([]);
    expect(info.exports.map(e => e.name)).toEqual(expect.arrayContaining(["add", "fib", "memory"]));
    expect(info.bindgen).toBe(false);

    const pkg = JSON.parse(readFileSync(join(outdir, "package.json"), "utf8"));
    expect(pkg).toMatchObject({ name: "aphrody-wasm-raw", type: "module", main: "aphrody_wasm_raw.js" });

    // The generated ES module is a plain upstream-Bun import: no plugin, no fork module.
    const { default: init } = await import(result.js);
    const exports = (await init()) as { add(a: number, b: number): number; fib(n: number): bigint };
    expect(exports.add(40, 2)).toBe(42);
    expect(exports.fib(10)).toBe(55n);
  }, 240_000);

  test("reuses a cached package, and a failed size ratchet keeps the last usable package", async () => {
    const crate = standaloneCrate("aphrody-wasm-raw");
    const outdir = join(tempDir(), "pkg");
    const first = await build({ crate, outdir, optimize: false, quiet: true, cache: true });
    const stamp = statSync(first.wasm).mtimeMs;
    const second = await build({ crate, outdir, optimize: false, quiet: true, cache: true });
    expect(second.cached).toBe(true);
    expect(statSync(second.wasm).mtimeMs).toBe(stamp);

    await expect(build({ crate, outdir, optimize: false, quiet: true, maxBytes: 1 })).rejects.toThrow("maxBytes");
    expect(existsSync(first.wasm)).toBe(true);
    expect(validate(readFileSync(first.wasm))).toBe(true);
  }, 240_000);

  test("packages a prebuilt artifact without running cargo", async () => {
    const crate = standaloneCrate("aphrody-wasm-raw");
    const built = await build({ crate, outdir: join(tempDir(), "a"), optimize: false, quiet: true });
    const packaged = await build({
      crate,
      outdir: join(tempDir(), "b"),
      artifact: built.wasm,
      cargo: false,
      optimize: false,
      quiet: true,
    });
    expect(packaged.bytes).toBe(built.bytes);
  }, 240_000);

  test.skipIf(!Bun.which("wasm-opt") && !network)(
    "wasm-opt shrinks the module and never grows it",
    async () => {
      const crate = standaloneCrate("aphrody-wasm-raw");
      const outdir = join(tempDir(), "pkg");
      const unoptimized = await build({ crate, outdir: join(tempDir(), "u"), optimize: false, quiet: true });
      const optimized = await build({ crate, outdir, optimize: "Oz", quiet: true });
      expect(optimized.bytes).toBeLessThanOrEqual(unoptimized.bytes);
      const copy = join(tempDir(), "copy.wasm");
      await Bun.write(copy, Bun.file(unoptimized.wasm));
      const { before, after } = await optimize(copy, { level: "O3" });
      expect(after).toBeLessThanOrEqual(before);
      expect(validate(readFileSync(copy))).toBe(true);
    },
    300_000,
  );
});

describe.skipIf(!canP1)("wasm32-wasip1 command run by upstream Bun", () => {
  test("builds a WASI command and `bun ./x.wasm` passes args, env and the exit code", async () => {
    const result = await build({
      crate: standaloneCrate("aphrody-wasm-wasi-hello"),
      outdir: join(tempDir(), "pkg"),
      wasi: "p1",
      optimize: false,
      quiet: true,
    });
    const info = inspect(readFileSync(result.wasm));
    expect(info.wasi).toBe("command");
    expect(info.imports.every(i => i.module === "wasi_snapshot_preview1")).toBe(true);

    const ok = await runCommand(result.wasm, { args: ["a", "b"], env: { HELLO: "wasi" } });
    expect(ok.stdout.replace(/\r\n/g, "\n")).toBe("arg:a\narg:b\nenv:wasi\n");
    expect(ok.exitCode).toBe(0);

    const failing = await runCommand(result.wasm, { args: ["1", "2", "3", "4"] });
    expect(failing.exitCode).toBe(4);
  }, 300_000);
});

describe.skipIf(!canP2 || !network)("wasm32-wasip2 component", () => {
  test("builds a component and transpiles it with jco", async () => {
    const result = await build({
      crate: standaloneCrate("aphrody-wasm-wasi-hello"),
      outdir: join(tempDir(), "pkg"),
      wasi: "p2",
      quiet: true,
    });
    expect(result.wasm.endsWith(".component.wasm")).toBe(true);
    expect(inspect(readFileSync(result.wasm)).format).toBe("component");
    expect(existsSync(result.js)).toBe(true);
  }, 600_000);
});

describe.skipIf(!canRaw || !network)("wasm-bindgen (version pinned by Cargo.lock)", () => {
  test("builds the web target and runs greet and add", async () => {
    const crate = standaloneCrate("aphrody-wasm-bindgen-hello");
    const outdir = join(tempDir(), "pkg");
    // No Cargo.lock in the standalone copy yet: cargo resolves it during the build, then bindgen reads the pin.
    const result = await build({ crate, outdir, optimize: false, quiet: true });
    expect(pinnedBindgen(crate)).toMatch(/^0\.2\.\d+$/);
    expect(inspect(readFileSync(result.wasm)).bindgen).toBe(true);
    const mod = await import(result.js);
    await mod.default({ module_or_path: readFileSync(result.wasm) });
    expect(mod.greet("Bun")).toBe("Hello, Bun!");
    expect(mod.add(40, 2)).toBe(42);
  }, 900_000);
});
