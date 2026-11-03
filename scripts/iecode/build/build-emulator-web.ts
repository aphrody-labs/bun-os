#!/usr/bin/env bun
/** Build canonical DS/Wii browser adapters using the root Cargo lockfile. */
import { resolve, join } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const cargoFactory = join(root, "scripts/aphrody/build/rust/cargo-serial.ts");
const ds = process.argv.includes("--ds");
const packageName = ds ? "aphrody-dust-web" : "aphrody-wii-web";
const outputName = ds ? "aphrody_dust_web" : "gecko_web";
const outputDir = join(root, ds ? "apps/iecode-web/pkg" : "apps/iecode-web/wii/pkg");
const profile = process.argv.includes("--dev") ? "debug" : "release";
async function run(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...(ds ? { RUSTC_BOOTSTRAP: "1" } : {}) },
  });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}
const lock = await Bun.file(join(root, "Cargo.lock")).text();
const expected = lock.match(/^name = "wasm-bindgen"\r?\nversion = "([^"]+)"/m)?.[1];
if (!expected) throw new Error("Could not find the wasm-bindgen version in Cargo.lock.");
const bindgen = Bun.which("wasm-bindgen");
if (!bindgen) throw new Error(`Install wasm-bindgen-cli ${expected} and add it to PATH before building.`);
const version = Bun.spawnSync([bindgen, "--version"], { cwd: root });
if (version.exitCode !== 0 || version.stdout.toString().trim() !== `wasm-bindgen ${expected}`) {
  throw new Error(`wasm-bindgen-cli must match Cargo.lock (${expected}); found ${version.stdout.toString().trim() || "an unusable executable"}.`);
}
await run([
  process.execPath,
  cargoFactory,
  ...(process.platform === "win32" ? ["--msvc"] : []),
  "build",
  "--target-dir",
  resolve(root, process.env.CARGO_TARGET_DIR ?? "target"),
  "--locked",
  "-p",
  packageName,
  "--target",
  "wasm32-unknown-unknown",
  ...(profile === "release" ? ["--release"] : []),
]);
const target = resolve(root, process.env.CARGO_TARGET_DIR ?? "target");
await run([
  bindgen,
  join(target, "wasm32-unknown-unknown", profile, `${outputName}.wasm`),
  "--target",
  "web",
  "--out-name",
  outputName,
  "--out-dir",
  outputDir,
]);

if (ds) {
  await Bun.write(
    join(outputDir, "index.js"),
    `export { default } from './${outputName}.js';\nexport * from './${outputName}.js';\n`,
  );
  await Bun.write(
    join(outputDir, "index.d.ts"),
    `export { default } from './${outputName}';\nexport * from './${outputName}';\n`,
  );
}
