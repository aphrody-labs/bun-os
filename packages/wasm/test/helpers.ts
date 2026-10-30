import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll } from "bun:test";

export const repoRoot = resolve(import.meta.dir, "../../..");

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = "aphrody-wasm-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** One cargo target directory for every fixture build of the test run, so each crate compiles once. */
export const sharedTarget = join(tmpdir(), "aphrody-wasm-test-target");

/**
 * Copy `crates/<name>` into a temporary standalone Cargo package: the workspace inheritance is
 * replaced by explicit values (the repository workspace needs all its submodules checked out) and the
 * pinned toolchain file is copied so rustup installs the same nightly and wasm targets as CI.
 */
export function standaloneCrate(name: string): string {
  const root = tempDir();
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  cpSync(join(repoRoot, "crates", name), dir, { recursive: true });
  const manifestPath = join(dir, "Cargo.toml");
  let manifest = readFileSync(manifestPath, "utf8").replace(/\r\n/g, "\n");
  manifest = manifest
    .replace(/^(authors|homepage|repository|rust-version)\.workspace\s*=\s*true\n/gm, "")
    .replace(/^version\.workspace\s*=\s*true$/m, 'version = "1.4.7"')
    .replace(/^edition\.workspace\s*=\s*true$/m, 'edition = "2024"')
    .replace(/\[lints\]\nworkspace = true\n?/, "")
    .replace(/\{ workspace = true, features = \["std"\] \}/, '{ version = "0.2.129", features = ["std"] }');
  manifest += "\n[workspace]\n";
  writeFileSync(manifestPath, manifest);
  cpSync(join(repoRoot, "rust-toolchain.toml"), join(dir, "rust-toolchain.toml"));
  return dir;
}

export function cargoEnv(): void {
  process.env.CARGO_TARGET_DIR = sharedTarget;
}

/** LEB128 unsigned. */
function u32(value: number): number[] {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
}

const utf8 = (text: string) => [...new TextEncoder().encode(text)];
const name = (text: string) => [...u32(text.length), ...utf8(text)];
const section = (id: number, body: number[]) => [id, ...u32(body.length), ...body];

/**
 * A hand-assembled module:
 *   import "env" "log" (func (param i32))
 *   (func $add (param i32 i32) (result i32)), exported as "add"
 *   (func $twice (param i32)) calls env.log with the argument doubled, exported as "twice"
 *   (memory 1) exported as "memory"; custom sections "target_features" (+bulk-memory) and "producers".
 */
export function tinyModule(): Uint8Array {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const types = section(1, [2, 0x60, 2, 0x7f, 0x7f, 1, 0x7f, 0x60, 1, 0x7f, 0]);
  const imports = section(2, [1, ...name("env"), ...name("log"), 0x00, 1]);
  const funcs = section(3, [2, 0, 1]);
  const memory = section(5, [1, 0x00, 1]);
  const exports = section(7, [3, ...name("add"), 0x00, 1, ...name("twice"), 0x00, 2, ...name("memory"), 0x02, 0]);
  const add = [0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b];
  const twice = [0x00, 0x20, 0x00, 0x41, 0x02, 0x6c, 0x10, 0x00, 0x0b];
  const code = section(10, [2, ...u32(add.length), ...add, ...u32(twice.length), ...twice]);
  const features = section(0, [...name("target_features"), 1, 0x2b, ...name("bulk-memory")]);
  const producers = section(0, [...name("producers"), 0]);
  return new Uint8Array([
    ...header,
    ...types,
    ...imports,
    ...funcs,
    ...memory,
    ...exports,
    ...code,
    ...features,
    ...producers,
  ]);
}
