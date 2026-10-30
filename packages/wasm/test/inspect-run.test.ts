import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { init, inspect, instantiate, PINS, validate } from "../src/index.ts";
import { tempDir, tinyModule } from "./helpers.ts";

describe("inspect", () => {
  test("reads imports, exports, features and custom sections of a hand-assembled module", () => {
    const info = inspect(tinyModule());
    expect(info.format).toBe("core");
    expect(info.imports).toEqual([{ module: "env", name: "log", kind: "function" }]);
    expect(info.exports).toEqual([
      { name: "add", kind: "function" },
      { name: "twice", kind: "function" },
      { name: "memory", kind: "memory" },
    ]);
    expect(info.features).toEqual(["bulk-memory"]);
    expect(info.customSections).toEqual(["target_features", "producers"]);
    expect(info.wasi).toBeUndefined();
    expect(info.bindgen).toBe(false);
  });

  test("identifies the component-model header and rejects non-wasm and truncated input", () => {
    const component = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00]);
    expect(inspect(component).format).toBe("component");
    expect(validate(component)).toBe(false);
    expect(() => inspect(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow("bad magic");
    expect(() => inspect(tinyModule().subarray(0, 20))).toThrow(RangeError);
    expect(validate(new Uint8Array([0, 0x61, 0x73, 0x6d]))).toBe(false);
  });

  test("validate rejects a truncated module", () => {
    expect(validate(tinyModule())).toBe(true);
    expect(validate(tinyModule().subarray(0, 30))).toBe(false);
  });
});

describe("instantiate", () => {
  test("compiles from bytes and runs exports with the global WebAssembly", async () => {
    const logged: number[] = [];
    const { instance, info } = await instantiate(tinyModule(), { env: { log: (n: number) => logged.push(n) } });
    const exports = instance.exports as { add(a: number, b: number): number; twice(n: number): void };
    expect(exports.add(40, 2)).toBe(42);
    expect(exports.add(2 ** 31 - 1, 1)).toBe(-(2 ** 31));
    exports.twice(21);
    expect(logged).toEqual([42]);
    expect(info.exports.map(e => e.name)).toContain("memory");
  });

  test("compiles from a file path", async () => {
    const file = join(tempDir(), "tiny.wasm");
    writeFileSync(file, tinyModule());
    const { instance } = await instantiate(file, { env: { log() {} } });
    expect((instance.exports as { add(a: number, b: number): number }).add(1, 2)).toBe(3);
  });

  test("rejects a component with a pointer to jco", async () => {
    const component = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00]);
    await expect(instantiate(component)).rejects.toThrow("jco");
  });

  test("the bundler's wasm loader runs the same module (upstream import x from './a.wasm')", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "tiny.wasm"), tinyModule());
    writeFileSync(
      join(dir, "entry.ts"),
      `import wasmPath from "./tiny.wasm";
const bytes = await Bun.file(wasmPath).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, { env: { log() {} } });
console.log((instance.exports as any).add(20, 22));
`,
    );
    const proc = Bun.spawn([process.execPath, join(dir, "entry.ts")], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect({ stdout: stdout.trim(), stderr, code }).toEqual({ stdout: "42", stderr: "", code: 0 });
  });
});

describe("init", () => {
  test("scaffolds a wasm-bindgen crate pinned to the newest wasm-bindgen and refuses to overwrite", () => {
    const dir = join(tempDir(), "hello-wasm");
    const files = init(dir);
    expect(files.map(f => f.slice(dir.length + 1).replaceAll("\\", "/"))).toEqual([
      "Cargo.toml",
      "src/lib.rs",
      "index.ts",
      ".gitignore",
    ]);
    const manifest = readFileSync(join(dir, "Cargo.toml"), "utf8");
    expect(manifest).toContain('name = "hello-wasm"');
    expect(manifest).toContain(`wasm-bindgen = "${PINS.wasmBindgen}"`);
    expect(() => init(dir)).toThrow("exists");
    expect(() => init(join(dir, "Bad Name"))).toThrow("Invalid crate name");
  });
});
