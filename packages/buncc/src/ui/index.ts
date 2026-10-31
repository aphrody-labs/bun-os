/**
 * `buncc build <recipe>`: compile an app for the browser and write a bun-ui bundle (crates/bun-ui-web: bun-ui.json,
 * index.html, the glue and the .wasm) into the bun-ui store, from where release.sh stages it under /ui.
 * `buncc toolchain list|install <emsdk|wasi-sdk|qt-wasm>`: the pinned toolchains of buncc.toolchain.json "wasm".
 *
 * Rust (cargo-wasm) builds two variants by default: `max` (SIMD, relaxed SIMD, tail calls, multivalue, reference types)
 * and `baseline`; the generated boot script picks one with WebAssembly.validate. wasm-opt runs at -O4 --all-features.
 * Cargo goes through scripts/aphrody/build/rust/cargo-serial.sh (factory lock, four jobs, sccache) unless
 * BUNCC_UI_DIRECT=1 (scoped diagnostics: plain cargo, nice, four jobs). C/C++ builds use four jobs and sccache.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { run } from "../process.ts";
import { findRecipe, recipes, type Recipe, type CargoWasmRecipe } from "./recipes.ts";

type Profile = "max" | "baseline";

interface WasmPins {
  emsdk: { version: string; latest?: string; repo: string };
  "wasi-sdk": { version: string; repo: string; asset: string };
  "qt-wasm": { qtbase: string; repo: string; emsdk: string; configure: string[]; prefix: string };
  rust: { profiles: Record<string, string>; wasmOpt: string };
}

const JOBS = String(Math.min(4, Number(Bun.env.BUNCC_UI_JOBS ?? 4) || 4));

function pins(root: string): WasmPins {
  return JSON.parse(readFileSync(join(root, "buncc.toolchain.json"), "utf8")).wasm as WasmPins;
}

export function toolchainsDir(): string {
  return Bun.env.BUNCC_TOOLCHAINS ?? join(homedir(), "build", "toolchains");
}

export function storeDir(): string {
  return Bun.env.BUN_UI_STORE ?? join(homedir(), "build", "storage", "artifacts", "bun-ui", "ui");
}

function qtWasmPrefix(root: string): string {
  return Bun.env.QT_WASM_PREFIX ?? join(homedir(), "build", pins(root)["qt-wasm"].prefix);
}

/** `$VAR`, `${VAR}` and `~` from the environment; relative paths from the repository root. */
function expand(path: string, root: string): string {
  const defaults: Record<string, string> = {
    BUN_UI_SRC: join(root, "vendor", "bun-ui"),
    QT_WASM_SRC: join(homedir(), "build", "src", "qtbase-" + pins(root)["qt-wasm"].qtbase.replace(/^v/, "")),
    SERVO_SRC: join(root, "vendor", "servo"),
  };
  const out = path
    .replace(/^~(?=\/|$)/, homedir())
    .replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, name: string) => Bun.env[name] ?? defaults[name] ?? "");
  return resolve(root, out);
}

async function sh(argv: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<void> {
  console.error(`buncc: ${argv.join(" ")}`);
  const result = await run(argv, { cwd, env: { ...Bun.env, ...env }, output: "inherit", timeoutMs: 6 * 3600_000 });
  if (result.code !== 0) throw new Error(`${argv[0]} exited with ${result.code}`);
}

/** Run a command with the pinned emsdk activated. */
async function emsh(root: string, command: string, cwd: string, version = pins(root).emsdk.version): Promise<void> {
  const emsdk = join(toolchainsDir(), "emsdk");
  if (!existsSync(join(emsdk, "emsdk_env.sh"))) throw new Error(`emsdk missing: buncc toolchain install emsdk --run`);
  await sh(
    [
      "bash",
      "-c",
      `set -e; cd '${emsdk}' && ./emsdk activate ${version} --embedded >/dev/null && source ./emsdk_env.sh >/dev/null && cd '${cwd}' && ${command}`,
    ],
    cwd,
    {
      EM_COMPILER_WRAPPER: Bun.which("sccache") ?? undefined,
    },
  );
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path, base));
    else out.push(relative(base, path).replaceAll("\\", "/"));
  }
  return out.sort();
}

async function gitCommit(dir: string): Promise<string> {
  const result = await run(["git", "-C", dir, "rev-parse", "HEAD"], { output: "capture" });
  return result.code === 0 ? result.stdout.trim() : "";
}

async function writeManifest(
  bundle: string,
  recipe: Recipe,
  kind: "wasm-bindgen" | "emscripten",
  entry: string,
  source: string,
  scriptSrc: string[] = [],
): Promise<void> {
  const files = listFiles(bundle)
    .filter(path => path !== "bun-ui.json")
    .map(path => ({ path, bytes: statSync(join(bundle, path)).size, sha256: sha256(join(bundle, path)) }));
  const manifest = {
    schemaVersion: 1,
    id: recipe.id,
    toolkit: recipe.toolkit,
    title: recipe.title,
    kind,
    entry,
    ...(scriptSrc.length ? { scriptSrc } : {}),
    ...(recipe.size ? { size: recipe.size } : {}),
    source: { repo: source, commit: await gitCommit(source), recipe: recipe.id },
    files,
    builtAt: new Date().toISOString(),
    notes: recipe.notes ?? "",
  };
  writeFileSync(join(bundle, "bun-ui.json"), JSON.stringify(manifest, null, 2) + "\n");
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  console.log(
    `bun-ui bundle ${recipe.toolkit}/${recipe.id}: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB -> ${bundle}`,
  );
}

/** Feature probes from wasm-feature-detect (Apache-2.0): a SIMD and a relaxed-SIMD module. */
const BOOT = (
  title: string,
  variants: Profile[],
) => `// Generated by buncc (packages/buncc/src/ui): picks the best WebAssembly build this browser validates.
const simd = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
const relaxed = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11]));
const built = ${JSON.stringify(variants)};
const variant = built.includes("max") && (simd && relaxed || !built.includes("baseline")) ? "max" : "baseline";
document.documentElement.dataset.wasm = variant;
const { default: init } = await import(new URL(\`./\${variant}/app.js\`, import.meta.url));
await init({ module_or_path: new URL(\`./\${variant}/app_bg.wasm\`, import.meta.url) });
console.info(${JSON.stringify(title)} + " running the " + variant + " WebAssembly build");
`;

const INDEX = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>${title.replaceAll("<", "&lt;")}</title>
    <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#1b1b1b}canvas{display:block;width:100%!important;height:100%!important;outline:none}</style>
  </head>
  <body>
    <script type="module" src="./boot.js"></script>
  </body>
</html>
`;

async function cargoWasm(root: string, recipe: CargoWasmRecipe, profiles: Profile[]): Promise<void> {
  const dir = expand(recipe.dir, root);
  if (!existsSync(join(dir, "Cargo.toml"))) throw new Error(`${dir}/Cargo.toml not found (set the recipe's source)`);
  const pin = pins(root).rust;
  const bundle = join(storeDir(), recipe.toolkit, recipe.id);
  const staging = `${bundle}.staging`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const profile of profiles) {
    const target = join(Bun.env.BUN_UI_TARGET ?? join(homedir(), "build", "target"), `bun-ui-${profile}`);
    const args = ["build", "--release", "--target", "wasm32-unknown-unknown", "-j", JOBS];
    if (recipe.package) args.push("-p", recipe.package);
    if (recipe.example) args.push("--example", recipe.example);
    if (recipe.lib) args.push("--lib");
    if (recipe.features?.length) args.push("--features", recipe.features.join(","));
    if (recipe.noDefaultFeatures) args.push("--no-default-features");
    const env = {
      CARGO_TARGET_DIR: target,
      CARGO_BUILD_JOBS: JOBS,
      RUSTC_WRAPPER: Bun.which("sccache") ?? undefined,
      CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: `-C target-feature=${pin.profiles[profile]} --cfg getrandom_backend="wasm_js"`,
      APHRODY_BUILD_HOST: Bun.env.APHRODY_BUILD_HOST ?? "vps",
    };
    const toolchain = recipe.toolchain ? [`+${recipe.toolchain}`] : [];
    const cargo =
      Bun.env.BUNCC_UI_DIRECT === "1"
        ? ["nice", "-n", "15", "cargo", ...toolchain]
        : ["bash", join(root, "scripts", "aphrody", "build", "rust", "cargo-serial.sh"), ...toolchain];
    await sh([...cargo, ...args], dir, env);
    const name = recipe.example
      ? join("examples", recipe.example.replaceAll("-", "_"))
      : (
          readFileSync(join(dir, "Cargo.toml"), "utf8").match(/^\[package\][^[]*?^name\s*=\s*"([^"]+)"/ms)?.[1] ?? ""
        ).replaceAll("-", "_");
    const artifact = join(target, "wasm32-unknown-unknown", "release", `${name}.wasm`);
    if (!existsSync(artifact)) throw new Error(`cargo did not produce ${artifact}`);
    const out = join(staging, profile);
    await sh(
      ["wasm-bindgen", "--target", "web", "--no-typescript", "--out-dir", out, "--out-name", "app", artifact],
      dir,
    );
    await sh(["wasm-opt", ...pin.wasmOpt.split(" "), join(out, "app_bg.wasm"), "-o", join(out, "app_bg.wasm")], dir);
  }
  writeFileSync(join(staging, "boot.js"), BOOT(recipe.title, profiles));
  writeFileSync(join(staging, "index.html"), INDEX(recipe.title));
  await writeManifest(staging, recipe, "wasm-bindgen", "index.html", dir);
  rmSync(bundle, { recursive: true, force: true });
  await sh(["mv", staging, bundle], root);
}

/** Copy an Emscripten/Qt output (html, js, wasm, workers, loader, assets) into a bundle. */
async function emscriptenBundle(
  root: string,
  recipe: Recipe,
  build: string,
  target: string,
  source: string,
  scriptSrc: string[],
) {
  const bundle = join(storeDir(), recipe.toolkit, recipe.id);
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(bundle, { recursive: true });
  const keep = /\.(html|js|mjs|wasm|data|svg|png|ico|worker\.js)$/;
  for (const file of readdirSync(build)) {
    if (keep.test(file) && statSync(join(build, file)).isFile()) copyFileSync(join(build, file), join(bundle, file));
  }
  const entry = `${target}.html`;
  if (!existsSync(join(bundle, entry))) throw new Error(`no ${entry} in ${build}`);
  const optimizable = readdirSync(bundle).filter(file => file.endsWith(".wasm"));
  for (const file of optimizable)
    await sh(["wasm-opt", "-O3", "--all-features", join(bundle, file), "-o", join(bundle, file)], root).catch(error =>
      console.error(`buncc: wasm-opt skipped for ${file}: ${error.message}`),
    );
  await writeManifest(bundle, recipe, "emscripten", entry, source, scriptSrc);
}

export async function buildRecipe(root: string, recipe: Recipe, options: { profiles: Profile[] }): Promise<void> {
  const work = join(homedir(), "build", "bun-ui", "work", recipe.id);
  switch (recipe.kind) {
    case "cargo-wasm":
      return cargoWasm(root, recipe, options.profiles);
    case "qt-wasm": {
      const source = expand(recipe.source, root);
      const qtCmake = join(qtWasmPrefix(root), "bin", "qt-cmake");
      if (!existsSync(qtCmake)) throw new Error(`${qtCmake} missing: buncc toolchain install qt-wasm --run`);
      mkdirSync(work, { recursive: true });
      const extra = [
        "-DCMAKE_BUILD_TYPE=Release",
        "-DCMAKE_C_COMPILER_LAUNCHER=sccache",
        "-DCMAKE_CXX_COMPILER_LAUNCHER=sccache",
        ...(recipe.cmakeArgs ?? []),
      ];
      await emsh(
        root,
        `'${qtCmake}' -S '${source}' -B '${work}' -G Ninja ${extra.join(" ")} && cmake --build '${work}' --parallel ${JOBS}`,
        work,
        pins(root)["qt-wasm"].emsdk,
      );
      // Qt's wasm shell page uses an inline script and onload handler; embind needs eval.
      return emscriptenBundle(root, recipe, work, recipe.target, source, ["'unsafe-inline'", "'unsafe-eval'"]);
    }
    case "emscripten-cmake": {
      const source = expand(recipe.source, root);
      mkdirSync(work, { recursive: true });
      await emsh(
        root,
        `emcmake cmake -S '${source}' -B '${work}' -G Ninja -DCMAKE_BUILD_TYPE=Release ${(recipe.cmakeArgs ?? []).join(" ")} && cmake --build '${work}' --parallel ${JOBS}`,
        work,
        pins(root).emsdk.latest,
      );
      return emscriptenBundle(root, recipe, work, recipe.target, source, []);
    }
    case "emscripten-meson": {
      const source = expand(recipe.source, root);
      mkdirSync(work, { recursive: true });
      const cross = join(work, "emscripten.cross");
      writeFileSync(
        cross,
        `[binaries]\nc = 'emcc'\ncpp = 'em++'\nar = 'emar'\nranlib = 'emranlib'\npkg-config = ['emmake', 'env', 'pkg-config']\n\n[built-in options]\nc_args = ['-pthread', '-msimd128']\ncpp_args = ['-pthread', '-msimd128']\nc_link_args = ['-pthread', '-sALLOW_MEMORY_GROWTH=1']\ncpp_link_args = ['-pthread', '-sALLOW_MEMORY_GROWTH=1']\ndefault_library = 'static'\n\n[host_machine]\nsystem = 'emscripten'\ncpu_family = 'wasm32'\ncpu = 'wasm32'\nendian = 'little'\n`,
      );
      await emsh(
        root,
        `meson setup --reconfigure --cross-file '${cross}' --buildtype release '${join(work, "build")}' '${source}' ${(recipe.mesonArgs ?? []).join(" ")} && meson compile -C '${join(work, "build")}' -j ${JOBS}`,
        work,
        pins(root).emsdk.latest,
      );
      return emscriptenBundle(root, recipe, join(work, "build"), recipe.target, source, []);
    }
    case "broadway":
      return sh(["bash", join(root, "crates", "bun-ui-web", "broadway", "install.sh"), storeDir()], root);
    case "servo": {
      const dir = expand(recipe.dir, root);
      if (!existsSync(join(dir, "mach")))
        throw new Error(`${dir}/mach not found: git submodule update --init vendor/servo`);
      return sh(["nice", "-n", "15", "./mach", "build", "--release", "--jobs", JOBS], dir, {
        RUSTC_WRAPPER: Bun.which("sccache") ?? undefined,
        CARGO_TARGET_DIR: join(homedir(), "build", "target", "servo"),
      });
    }
    case "cef": {
      const dir = expand(recipe.dir, root);
      const out = Bun.env.CEF_PATH ?? join(toolchainsDir(), "cef");
      return sh(
        ["nice", "-n", "15", "cargo", "run", "--release", "-j", JOBS, "-p", "export-cef-dir", "--", "--force", out],
        dir,
        {
          RUSTC_WRAPPER: Bun.which("sccache") ?? undefined,
        },
      );
    }
  }
}

/** Plans for `buncc toolchain install <id>`; printed, run with --run. */
export function toolchainPlan(root: string, id: string): string[] {
  const pin = pins(root);
  const dir = toolchainsDir();
  switch (id) {
    case "emsdk":
      return [
        `test -d '${dir}/emsdk' || git clone --depth 1 ${pin.emsdk.repo} '${dir}/emsdk'`,
        `cd '${dir}/emsdk' && git pull --ff-only && ./emsdk install ${pin.emsdk.version}${pin.emsdk.latest ? ` && ./emsdk install ${pin.emsdk.latest}` : ""} && ./emsdk activate ${pin.emsdk.version} --embedded`,
      ];
    case "wasi-sdk": {
      const arch = process.arch === "arm64" ? "arm64" : "x86_64";
      const asset = pin["wasi-sdk"].asset.replace("{version}", pin["wasi-sdk"].version).replace("{arch}", arch);
      return [
        `mkdir -p '${dir}' && cd '${dir}' && curl -fsSLO ${pin["wasi-sdk"].repo}/releases/download/wasi-sdk-${pin["wasi-sdk"].version}/${asset}`,
        `cd '${dir}' && tar xf ${asset} && rm ${asset} && ln -sfn ${asset.replace(/\.tar\.gz$/, "")} wasi-sdk`,
      ];
    }
    case "qt-wasm": {
      const qt = pin["qt-wasm"];
      const version = qt.qtbase.replace(/^v/, "");
      const src = join(homedir(), "build", "src", `qtbase-${version}`);
      const build = join(homedir(), "build", "qt-wasm", `build-${version}`);
      const prefix = qtWasmPrefix(root);
      return [
        `test -d '${src}' || git clone --depth 1 -b ${qt.qtbase} ${qt.repo} '${src}'`,
        `mkdir -p '${build}' && cd '${dir}/emsdk' && ./emsdk activate ${qt.emsdk} --embedded >/dev/null && source ./emsdk_env.sh >/dev/null && cd '${build}' && '${src}/configure' ${qt.configure.join(" ")} -qt-host-path /usr -prefix '${prefix}' -no-warnings-are-errors -- -DQT_HOST_PATH_CMAKE_DIR=/usr/lib/x86_64-linux-gnu/cmake -DCMAKE_C_COMPILER_LAUNCHER=sccache -DCMAKE_CXX_COMPILER_LAUNCHER=sccache && nice -n 10 cmake --build . --parallel ${JOBS} && cmake --install .`,
      ];
    }
    default:
      throw new Error(`unknown toolchain ${id} (emsdk, wasi-sdk, qt-wasm)`);
  }
}

export async function toolchainCommand(root: string, args: string[]): Promise<number> {
  const [sub = "list", id] = args;
  if (sub === "list") {
    const pin = pins(root);
    const dir = toolchainsDir();
    const rows: [string, string, boolean][] = [
      [
        "emsdk",
        `${pin.emsdk.version} (latest ${pin.emsdk.latest ?? "-"})`,
        existsSync(join(dir, "emsdk", "emsdk_env.sh")),
      ],
      ["wasi-sdk", pin["wasi-sdk"].version, existsSync(join(dir, "wasi-sdk", "bin", "clang"))],
      [
        "qt-wasm",
        `qtbase ${pin["qt-wasm"].qtbase} / emsdk ${pin["qt-wasm"].emsdk}`,
        existsSync(join(qtWasmPrefix(root), "bin", "qt-cmake")),
      ],
    ];
    for (const [name, version, ok] of rows) console.log(`${ok ? "ok " : "-- "} ${name.padEnd(10)} ${version}`);
    return 0;
  }
  if (sub !== "install" || !id) {
    console.error("usage: buncc toolchain list | install <emsdk|wasi-sdk|qt-wasm> [--run]");
    return 2;
  }
  const plan = toolchainPlan(root, id);
  for (const line of plan) console.log(line);
  if (!args.includes("--run")) return 0;
  for (const line of plan) await sh(["bash", "-c", line], root);
  return 0;
}

/** `buncc build <recipe|ui|ui:<toolkit>> [--baseline-only] [--max-only]`. Returns undefined when `target` is not a bun-ui target. */
export async function uiBuild(root: string, target: string, args: string[]): Promise<number | undefined> {
  let selected: Recipe[];
  if (target === "ui") selected = recipes.filter(recipe => recipe.kind !== "servo" && recipe.kind !== "cef");
  else if (target.startsWith("ui:")) selected = recipes.filter(recipe => recipe.toolkit === target.slice(3));
  else {
    const recipe = findRecipe(target);
    if (!recipe) return undefined;
    selected = [recipe];
  }
  const profiles: Profile[] = args.includes("--max-only")
    ? ["max"]
    : args.includes("--baseline-only")
      ? ["baseline"]
      : ["max", "baseline"];
  let failures = 0;
  for (const recipe of selected) {
    try {
      await buildRecipe(root, recipe, { profiles });
    } catch (error) {
      failures++;
      console.error(`buncc: ${recipe.id} failed: ${(error as Error).message}`);
    }
  }
  return failures ? 1 : 0;
}

export function uiTargets(): string {
  return recipes.map(recipe => `${recipe.id} (${recipe.toolkit}, ${recipe.kind})`).join(", ");
}
