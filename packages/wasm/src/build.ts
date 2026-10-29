// Rust crate -> WebAssembly package: the job of wasm-pack on upstream Bun.
// cargo build for a wasm32 target, wasm-bindgen (the version Cargo.lock pins), wasm-opt, then a
// package with .js and .d.ts. Tools come from PATH, else wasm-bindgen is installed once with cargo
// into the tools directory and wasm-opt / jco run through `bun x`.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { inspect, validate } from "./inspect.ts";
import { optimize, type OptimizeLevel } from "./optimize.ts";
import {
  BINDGEN_TARGETS,
  checked,
  exe,
  jcoCommand,
  run,
  toolsDir,
  TRIPLES,
  versionOf,
  type BindgenTarget,
} from "./tools.ts";

export interface BuildOptions {
  /** A crate directory, its `Cargo.toml`, or a `.rs` file in it. Defaults to the working directory. */
  crate?: string;
  /** A package of the Cargo workspace of {@link crate}, like `cargo build -p`. */
  package?: string;
  /** A `.wasm` cargo already built (for example on another machine): packaged as is, without running cargo. */
  artifact?: string;
  /** Output package directory. Defaults to `pkg` in the crate. Replaced only when the build succeeds. */
  outdir?: string;
  /** `wasm-bindgen --target`. Defaults to `"web"`. */
  target?: BindgenTarget;
  /** `"p1"` is `wasm32-wasip1` (loaded with `node:wasi`), `"p2"` is `wasm32-wasip2` (a component transpiled by jco). */
  wasi?: "p1" | "p2";
  /** Any Rust target triple. Overrides {@link wasi}. Defaults to `wasm32-unknown-unknown`. */
  triple?: string;
  /** Cargo profile: `"release"` (default), `"dev"` or a custom profile name. */
  profile?: string;
  /** Base name of the generated files. Defaults to the crate's lib or bin name. */
  name?: string;
  /** wasm-opt level, or `false`. Defaults to `"Oz"`, except for `profile: "dev"`. */
  optimize?: boolean | OptimizeLevel;
  typescript?: boolean;
  /** Run `wasm-bindgen` when the crate depends on it. Defaults to `true`. */
  bindgen?: boolean;
  /** Write a `package.json` in {@link outdir}. Defaults to `true`. */
  packageJson?: boolean;
  /** `name` in the generated `package.json`. Defaults to the crate name. */
  packageName?: string;
  features?: string[];
  noDefaultFeatures?: boolean;
  locked?: boolean;
  /** Extra arguments passed to `cargo build`. */
  cargoArgs?: string[];
  /** `false` skips cargo (use with {@link artifact}); a string or array replaces the `cargo` command (cross, a wrapper). */
  cargo?: boolean | string | string[];
  /** Fail when the optimized `.wasm` is larger than this many bytes. */
  maxBytes?: number;
  /** Reuse {@link outdir} when the artifact and options are unchanged. */
  cache?: boolean;
  quiet?: boolean;
}

export interface BuildResult {
  outdir: string;
  wasm: string;
  js: string;
  dts: string | undefined;
  cached: boolean;
  bytes: number;
  rawBytes?: number;
}

interface CrateMeta {
  name: string;
  manifestPath: string;
  version: string;
  description?: string;
  license?: string;
  /** Name of the produced artifact file (without `.wasm`). */
  artifactName: string;
  /** `lib` builds `--lib`, `bin` builds `--bin <name>`. */
  kind: "lib" | "bin";
  binName?: string;
  usesBindgen: boolean;
  workspaceRoot: string;
  targetDirectory: string;
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" ? Reflect.get(error, "code") : undefined;
}

/** The `Cargo.toml` for a crate directory, a `Cargo.toml` or a `.rs` file in the crate. */
export function findManifest(input: string): string {
  let at = resolve(input);
  if (basename(at) === "Cargo.toml") {
    if (!existsSync(at)) throw new Error(`${at} does not exist`);
    return at;
  }
  let stat;
  try {
    stat = statSync(at);
  } catch {
    throw new Error(`${at} does not exist`);
  }
  if (!stat.isDirectory()) at = dirname(at);
  for (;;) {
    const manifest = join(at, "Cargo.toml");
    if (existsSync(manifest)) return manifest;
    const parent = dirname(at);
    if (parent === at) throw new Error(`No Cargo.toml in ${resolve(input)} or above it`);
    at = parent;
  }
}

/** `cargo` option: a string is the executable run instead of `cargo`, an array is the command and leading arguments. */
export function cargoCommand(cargo: BuildOptions["cargo"]): string[] {
  if (cargo === undefined || cargo === true || cargo === false) return ["cargo"];
  const command = typeof cargo === "string" ? [cargo] : cargo;
  if (!Array.isArray(command) || command.length === 0 || command.some(part => typeof part !== "string" || !part)) {
    throw new TypeError("options.cargo must be a boolean, a string or a non-empty string[]");
  }
  const [bin, ...args] = command as [string, ...string[]];
  return [/[\\/]/.test(bin) ? resolve(bin) : bin, ...args];
}

async function metadata(manifest: string, name: string | undefined, cargo: string[]): Promise<CrateMeta> {
  const { stdout } = await checked([
    ...cargo,
    "metadata",
    "--format-version",
    "1",
    "--no-deps",
    "--manifest-path",
    manifest,
  ]);
  const meta = JSON.parse(stdout);
  const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
  const pkg = name
    ? meta.packages.find((p: any) => p.name === name)
    : meta.packages.find((p: any) => same(p.manifest_path, manifest));
  if (!pkg && name) throw new Error(`${name} is not a package of the workspace ${meta.workspace_root}`);
  if (!pkg) throw new Error(`${manifest} is a virtual workspace manifest: point at a member crate or pass package`);
  const lib = pkg.targets.find((t: any) => t.kind.includes("cdylib"));
  const bin = pkg.targets.find((t: any) => t.kind.includes("bin"));
  if (!lib && !bin) {
    throw new Error(`${pkg.name} has no cdylib or bin target: add [lib] crate-type = ["cdylib"] to ${manifest}`);
  }
  return {
    name: pkg.name,
    manifestPath: pkg.manifest_path,
    version: pkg.version,
    description: pkg.description ?? undefined,
    license: pkg.license ?? undefined,
    // cargo names a cdylib file with underscores and a binary file after the binary target as is.
    artifactName: lib ? lib.name.replaceAll("-", "_") : bin.name,
    kind: lib ? "lib" : "bin",
    binName: lib ? undefined : bin.name,
    usesBindgen: pkg.dependencies.some((d: any) => d.name === "wasm-bindgen" && d.kind !== "dev"),
    workspaceRoot: meta.workspace_root,
    targetDirectory: meta.target_directory,
  };
}

/** The wasm-bindgen version a `Cargo.lock` pins. */
export function pinnedBindgen(workspaceRoot: string): string | undefined {
  let lock: string;
  try {
    lock = readFileSync(join(workspaceRoot, "Cargo.lock"), "utf8");
  } catch {
    return undefined;
  }
  return /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(lock)?.[1];
}

async function ensureTarget(triple: string): Promise<void> {
  const installed = await run(["rustup", "target", "list", "--installed"]).catch(() => undefined);
  if (!installed || installed.exitCode !== 0) return;
  if (installed.stdout.split(/\r?\n/).includes(triple)) return;
  await checked(["rustup", "target", "add", triple], { inherit: true });
}

/** wasm-bindgen must be the exact version of the crate's wasm-bindgen dependency. */
export async function resolveBindgen(version: string): Promise<string> {
  const wanted = `wasm-bindgen ${version}`;
  const override = process.env.APHRODY_WASM_BINDGEN;
  if (override) {
    if ((await versionOf(override)) !== wanted) throw new Error(`APHRODY_WASM_BINDGEN is not ${wanted}`);
    return override;
  }
  const onPath = Bun.which("wasm-bindgen");
  if (onPath && (await versionOf(onPath)) === wanted) return onPath;
  const root = join(toolsDir(), `wasm-bindgen-${version}`);
  const cached = join(root, "bin", exe("wasm-bindgen"));
  if ((await versionOf(cached)) === wanted) return cached;
  if (Bun.which("cargo-binstall")) {
    await checked(
      [
        "cargo",
        "binstall",
        "--no-confirm",
        "--locked",
        "--version",
        version,
        "--install-path",
        join(root, "bin"),
        "wasm-bindgen-cli",
      ],
      { inherit: true },
    );
  } else {
    await checked(["cargo", "install", "--locked", "--version", `=${version}`, "--root", root, "wasm-bindgen-cli"], {
      inherit: true,
    });
  }
  if ((await versionOf(cached)) !== wanted) throw new Error(`${wanted} (Cargo.lock) could not be installed`);
  return cached;
}

/**
 * Loader for a module without wasm-bindgen. WASI preview 1 uses `node:wasi` as upstream Bun
 * implements it: `wasiImport` (there is no `getImportObject()` or `initialize()`), `start()` for a
 * command, and `_initialize()` called by hand for a reactor.
 */
export function rawLoader(name: string, wasi: boolean): { js: string; dts: string } {
  if (wasi) {
    return {
      js: `import { WASI } from "node:wasi";

const url = new URL("./${name}.wasm", import.meta.url);

/**
 * Instantiates the WASI preview 1 module. A reactor's \`_initialize\` has run on return;
 * a command is started with \`start()\`, which returns the exit code.
 */
export default async function init(options = {}) {
  const wasi = new WASI({ version: "preview1", args: options.args ?? [], env: options.env ?? {}, preopens: options.preopens ?? {} });
  const bytes = await (await fetch(url)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {
    ...options.imports,
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  if (typeof instance.exports._initialize === "function") instance.exports._initialize();
  return { instance, exports: instance.exports, wasi, start: () => wasi.start(instance) };
}
`,
      dts: `export interface InitOptions {
  args?: string[];
  env?: Record<string, string>;
  preopens?: Record<string, string>;
  imports?: WebAssembly.Imports;
}
export default function init(options?: InitOptions): Promise<{
  instance: WebAssembly.Instance;
  exports: WebAssembly.Exports;
  wasi: import("node:wasi").WASI;
  start(): number;
}>;
`,
    };
  }
  return {
    js: `const url = new URL("./${name}.wasm", import.meta.url);

/** Instantiates the module and returns its exports. */
export default async function init(imports = {}) {
  const bytes = await (await fetch(url)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  return instance.exports;
}
`,
    dts: `export default function init(imports?: WebAssembly.Imports): Promise<WebAssembly.Exports>;
`,
  };
}

function hashFile(file: string, extra: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(readFileSync(file));
  hasher.update(extra);
  return hasher.digest("hex");
}

function result(outdir: string, name: string, bindgen: boolean, component: boolean, cached: boolean): BuildResult {
  const wasm = join(outdir, bindgen ? `${name}_bg.wasm` : component ? `${name}.component.wasm` : `${name}.wasm`);
  const js = join(outdir, `${name}.js`);
  const dts = join(outdir, `${name}.d.ts`);
  return { outdir, wasm, js, dts: existsSync(dts) ? dts : undefined, cached, bytes: statSync(wasm).size };
}

/**
 * Build the crate at `options.crate` (a directory, Cargo.toml or .rs file) into `options.outdir`.
 * The package is staged next to `outdir` and renamed into place only once it is complete and valid.
 */
export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  if (typeof options !== "object" || options === null) throw new TypeError("options must be an object");
  const cargoBin = cargoCommand(options.cargo);
  const meta = await metadata(findManifest(options.crate ?? process.cwd()), options.package, cargoBin);
  const manifest = meta.manifestPath;
  const crateDir = dirname(manifest);
  const wasi = options.wasi;
  if (wasi !== undefined && wasi !== "p1" && wasi !== "p2") throw new Error(`wasi must be "p1" or "p2", got ${wasi}`);
  const triple = options.triple ?? TRIPLES[wasi ?? "unknown"];
  const profile = options.profile ?? "release";
  const profileDir = profile === "dev" ? "debug" : profile;
  const name = options.name ?? meta.artifactName.replaceAll("-", "_");
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid output name ${name}`);
  const target = options.target ?? "web";
  if (!BINDGEN_TARGETS.includes(target)) throw new Error(`target must be one of ${BINDGEN_TARGETS.join(", ")}`);
  const outdir = resolve(options.outdir ?? join(crateDir, "pkg"));
  if (outdir === parse(outdir).root || crateDir.startsWith(outdir + sep) || outdir === crateDir) {
    throw new Error(`outdir ${outdir} must be a package directory, not the crate or one of its parents`);
  }
  const log = options.quiet ? () => {} : (message: string) => process.stderr.write(`${message}\n`);

  if (options.cargo !== false && !options.artifact) {
    // A custom cargo may build elsewhere (a build server, a container): its toolchain is its own.
    if (cargoBin.length === 1 && cargoBin[0] === "cargo") await ensureTarget(triple);
    const cargo = [...cargoBin, "build", "--manifest-path", manifest, "--target", triple];
    if (meta.kind === "lib") cargo.push("--lib");
    else cargo.push("--bin", meta.binName!);
    if (options.package) cargo.push("--package", options.package);
    if (profile === "release") cargo.push("--release");
    else if (profile !== "dev") cargo.push("--profile", profile);
    if (options.features?.length) cargo.push("--features", options.features.join(","));
    if (options.noDefaultFeatures) cargo.push("--no-default-features");
    if (options.locked) cargo.push("--locked");
    if (options.cargoArgs?.length) cargo.push(...options.cargoArgs);
    await checked(cargo, { cwd: crateDir, inherit: !options.quiet });
  }
  const artifact = options.artifact
    ? resolve(options.artifact)
    : join(meta.targetDirectory, triple, profileDir, `${meta.artifactName}.wasm`);
  if (!existsSync(artifact)) throw new Error(`cargo did not produce ${artifact}`);

  const component = triple === TRIPLES.p2 || inspect(readFileSync(artifact)).format === "component";
  const bindgen = triple === TRIPLES.unknown && meta.usesBindgen && options.bindgen !== false && !component;
  // wasm-opt does not read components.
  let optimizeLevel: OptimizeLevel | undefined = typeof options.optimize === "string" ? options.optimize : "Oz";
  if (options.optimize === false || component || (options.optimize === undefined && profile === "dev")) {
    optimizeLevel = undefined;
  }
  const typescript = options.typescript !== false;
  const key = hashFile(
    artifact,
    JSON.stringify([name, target, triple, optimizeLevel, typescript, bindgen, Bun.version]),
  );
  const keyFile = join(outdir, ".aphrody-wasm");
  if (options.cache && existsSync(keyFile) && readFileSync(keyFile, "utf8") === key) {
    return result(outdir, name, bindgen, component, true);
  }

  mkdirSync(dirname(outdir), { recursive: true });
  const stage = mkdtempSync(join(dirname(outdir), `.${basename(outdir)}-stage-`));
  try {
    let wasmFile: string;
    if (bindgen) {
      const version = pinnedBindgen(meta.workspaceRoot);
      if (!version) throw new Error(`wasm-bindgen is not in ${join(meta.workspaceRoot, "Cargo.lock")}`);
      const tool = await resolveBindgen(version);
      const args = [tool, "--target", target, "--out-dir", stage, "--out-name", name];
      if (!typescript) args.push("--no-typescript");
      if (profile === "dev") args.push("--debug", "--keep-debug");
      args.push(artifact);
      await checked(args);
      wasmFile = join(stage, `${name}_bg.wasm`);
    } else if (component) {
      wasmFile = join(stage, `${name}.component.wasm`);
      copyFileSync(artifact, wasmFile);
    } else {
      wasmFile = join(stage, `${name}.wasm`);
      copyFileSync(artifact, wasmFile);
      const loader = rawLoader(name, wasi === "p1" || triple === TRIPLES.p1);
      writeFileSync(join(stage, `${name}.js`), loader.js);
      if (typescript) writeFileSync(join(stage, `${name}.d.ts`), loader.dts);
    }
    const rawBytes = statSync(wasmFile).size;
    if (optimizeLevel) {
      const { after } = await optimize(wasmFile, { level: optimizeLevel });
      log(`wasm-opt -${optimizeLevel}: ${rawBytes} -> ${after} bytes`);
    }
    if (component) {
      await checked([...jcoCommand(), "transpile", wasmFile, "--name", name, "--out-dir", stage]);
    } else if (!validate(readFileSync(wasmFile))) {
      throw new Error(`${wasmFile} is not a valid WebAssembly module`);
    }
    const bytes = statSync(wasmFile).size;
    if (options.maxBytes && bytes > options.maxBytes) {
      throw new Error(`${name}: ${bytes} bytes is over maxBytes ${options.maxBytes}`);
    }
    if (options.packageJson !== false) {
      const files = readdirSync(stage).filter(f => f !== "package.json");
      const pkg = {
        name: options.packageName ?? meta.name,
        version: meta.version,
        description: meta.description,
        license: meta.license,
        type: "module",
        main: `${name}.js`,
        types: typescript ? `${name}.d.ts` : undefined,
        files,
        sideEffects: target === "bundler" ? [`./${name}.js`, "./snippets/*"] : undefined,
      };
      writeFileSync(join(stage, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    }
    writeFileSync(join(stage, ".aphrody-wasm"), key);

    const previous = `${stage}-previous`;
    let backedUp = false;
    try {
      renameSync(outdir, previous);
      backedUp = true;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    try {
      renameSync(stage, outdir);
    } catch (error) {
      if (backedUp) renameSync(previous, outdir);
      throw error;
    }
    if (backedUp) rmSync(previous, { recursive: true, force: true });
    return { ...result(outdir, name, bindgen, component, false), rawBytes, bytes };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export { findManifest as manifestFor, metadata as crateMetadata };
