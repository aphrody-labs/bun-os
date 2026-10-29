import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import bunccWasm, { buildWasm, optimizeWasm, toolchain } from "../src/buncc.ts";
import { canBuildFor, PINS, TRIPLES, wasmPlugin } from "../src/index.ts";
import { cargoEnv, standaloneCrate, tempDir, tinyModule } from "./helpers.ts";

cargoEnv();
const raw = await canBuildFor(TRIPLES.unknown);

describe("buncc wasm backend hooks", () => {
  test("registers as `wasm` and exposes build, optimize, inspect and toolchain", () => {
    expect(bunccWasm.id).toBe("wasm");
    expect(Object.values(bunccWasm.triples)).toEqual(["wasm32-unknown-unknown", "wasm32-wasip1", "wasm32-wasip2"]);
    for (const hook of [bunccWasm.build, bunccWasm.optimize, bunccWasm.inspect, bunccWasm.toolchain]) {
      expect(typeof hook).toBe("function");
    }
  });

  test("toolchain reports plain JSON with the verified pins", async () => {
    const report = await toolchain();
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(Object.keys(report.targets)).toEqual(Object.values(TRIPLES));
    expect(report.pins.wasmBindgen).toBe(PINS.wasmBindgen);
  });

  test("inspect reads a file", () => {
    const file = join(tempDir(), "tiny.wasm");
    writeFileSync(file, tinyModule());
    expect(bunccWasm.inspect(file).exports.map(e => e.name)).toEqual(["add", "twice", "memory"]);
  });

  test("optimize rejects an unknown level before running any tool", async () => {
    const file = join(tempDir(), "tiny.wasm");
    writeFileSync(file, tinyModule());
    await expect(optimizeWasm(file, { level: "Ox" as never })).rejects.toThrow("Unknown wasm-opt level");
  });

  test.skipIf(!raw)(
    "buildWasm compiles the raw fixture and returns a JSON result",
    async () => {
      const result = await buildWasm({
        crate: standaloneCrate("aphrody-wasm-raw"),
        outdir: join(tempDir(), "pkg"),
        mode: "raw",
        optimize: false,
      });
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      expect(result).toMatchObject({ ok: true, triple: "wasm32-unknown-unknown", mode: "raw" });
      expect(result.info).toMatchObject({ format: "core", bindgen: false, imports: 0 });
      expect(result.bytes).toBeGreaterThan(8);
    },
    240_000,
  );
});

describe.skipIf(!raw)("wasmPlugin", () => {
  test("imports a .rs file as a built module through Bun.plugin", async () => {
    const crate = standaloneCrate("aphrody-wasm-raw");
    Bun.plugin(wasmPlugin({ optimize: false }));
    const mod = await import(join(crate, "src", "lib.rs"));
    const exports = (await mod.default()) as { add(a: number, b: number): number };
    expect(exports.add(20, 22)).toBe(42);
  }, 240_000);
});
