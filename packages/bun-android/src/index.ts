import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AndroidAbi,
  AndroidDevice,
  AndroidToolchain,
  AndroidTriple,
  BuildOptions,
  BunAndroidCompileTarget,
} from "./types.ts";

export type * from "./types.ts";

const windows = process.platform === "win32";
const exe = windows ? ".exe" : "";
const script = windows ? ".bat" : "";

export const ABIS: readonly AndroidAbi[] = ["arm64-v8a", "x86_64"];

export const TRIPLES: Record<AndroidAbi, AndroidTriple> = {
  "arm64-v8a": "aarch64-linux-android",
  x86_64: "x86_64-linux-android",
};

export const COMPILE_TARGETS: Record<AndroidAbi, BunAndroidCompileTarget> = {
  "arm64-v8a": "bun-android-arm64",
  x86_64: "bun-android-x64",
};

export const MIN_SDK = 24;

function newestChild(directory: string): string | undefined {
  if (!existsSync(directory)) return undefined;
  const names = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const name = names.at(-1);
  return name ? join(directory, name) : undefined;
}

function firstExisting(candidates: readonly (string | undefined)[]): string | undefined {
  return candidates.find((candidate): candidate is string => !!candidate && existsSync(candidate));
}

/** Locate the Android SDK, NDK, adb, sdkmanager, Gradle and JDK on this host. */
export function resolveToolchain(project?: string): AndroidToolchain {
  const local = process.env.LOCALAPPDATA;
  const sdk =
    firstExisting([
      process.env.ANDROID_HOME,
      process.env.ANDROID_SDK_ROOT,
      local && join(local, "Android", "Sdk"),
      join(homedir(), "Android", "Sdk"),
      join(homedir(), "Library", "Android", "sdk"),
      // Shared Bun OS install (factory/android/sdk.ts) on Linux hosts and build containers.
      "/opt/android-sdk",
    ]) ??
    process.env.ANDROID_HOME ??
    join(homedir(), "Android", "Sdk");
  const ndk =
    firstExisting([process.env.ANDROID_NDK_HOME, process.env.ANDROID_NDK_ROOT]) ?? newestChild(join(sdk, "ndk"));
  const cmdline = firstExisting([join(sdk, "cmdline-tools", "latest"), newestChild(join(sdk, "cmdline-tools"))]);
  const wrapper = project && existsSync(join(project, "gradle", "wrapper", "gradle-wrapper.jar"));
  const gradleDists = join(process.env.GRADLE_USER_HOME ?? join(homedir(), ".gradle"), "wrapper", "dists");
  const distGradle = existsSync(gradleDists)
    ? readdirSync(gradleDists)
        .filter(name => name.startsWith("gradle-"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .reverse()
        .flatMap(dist => {
          const hash = newestChild(join(gradleDists, dist));
          const home = hash && newestChild(hash);
          return home ? [join(home, "bin", `gradle${script}`)] : [];
        })
    : [];
  const gradle = firstExisting([
    wrapper ? join(project, `gradlew${script}`) : undefined,
    process.env.GRADLE_HOME && join(process.env.GRADLE_HOME, "bin", `gradle${script}`),
    Bun.which("gradle") ?? undefined,
    ...distGradle,
  ]);
  const javaHome =
    firstExisting([process.env.JAVA_HOME]) ??
    (() => {
      const java = Bun.which("java");
      return java ? resolve(java, "..", "..") : undefined;
    })();
  return {
    sdk,
    ndk,
    adb: Bun.which("adb") ?? join(sdk, "platform-tools", `adb${exe}`),
    sdkmanager: cmdline
      ? join(cmdline, "bin", `sdkmanager${script}`)
      : join(sdk, "cmdline-tools", "latest", "bin", `sdkmanager${script}`),
    gradle,
    javaHome,
  };
}

/** Environment with ANDROID_HOME, ANDROID_NDK_HOME and JAVA_HOME pointing at the resolved toolchain. */
export function toolchainEnv(toolchain: AndroidToolchain): Record<string, string | undefined> {
  return {
    ...process.env,
    ANDROID_HOME: toolchain.sdk,
    ANDROID_SDK_ROOT: toolchain.sdk,
    ANDROID_NDK_HOME: toolchain.ndk,
    JAVA_HOME: toolchain.javaHome,
  };
}

/** Run a command with inherited stdio and return its exit code. */
export async function run(
  command: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<number> {
  const child = Bun.spawn(command, {
    ...options,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

async function capture(command: string[], env?: Record<string, string | undefined>): Promise<string> {
  const child = Bun.spawn(command, { env, stdout: "pipe", stderr: "inherit" });
  const [text, code] = await Promise.all([child.stdout.text(), child.exited]);
  if (code !== 0) throw new Error(`${command[0]} exited with ${code}`);
  return text;
}

/** Install the NDK through sdkmanager when it is missing. */
export async function ensureNdk(toolchain: AndroidToolchain, version?: string): Promise<string> {
  if (toolchain.ndk && !version) return toolchain.ndk;
  const wanted = version ?? (await latestNdk(toolchain));
  const target = join(toolchain.sdk, "ndk", wanted);
  if (existsSync(target)) return target;
  const code = await run([toolchain.sdkmanager, `--sdk_root=${toolchain.sdk}`, `ndk;${wanted}`], {
    env: toolchainEnv(toolchain),
  });
  if (code !== 0) throw new Error(`sdkmanager failed to install ndk;${wanted}`);
  return target;
}

async function latestNdk(toolchain: AndroidToolchain): Promise<string> {
  const listing = await capture(
    [toolchain.sdkmanager, `--sdk_root=${toolchain.sdk}`, "--list"],
    toolchainEnv(toolchain),
  );
  const versions = [...listing.matchAll(/^\s*ndk;(\d+\.\d+\.\d+)\s/gm)].map(match => match[1]!);
  const latest = versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  if (!latest) throw new Error("sdkmanager listed no NDK package");
  return latest;
}

/** NDK clang wrapper used as the Cargo linker for a Rust Android triple. */
export function ndkLinker(ndk: string, triple: AndroidTriple, api = MIN_SDK): string {
  const host = windows ? "windows-x86_64" : process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  return join(ndk, "toolchains", "llvm", "prebuilt", host, "bin", `${triple}${api}-clang${windows ? ".cmd" : ""}`);
}

/** Cargo environment that links `triple` with the NDK. */
export function cargoAndroidEnv(ndk: string, triple: AndroidTriple): Record<string, string> {
  const key = triple.toUpperCase().replaceAll("-", "_");
  const linker = ndkLinker(ndk, triple);
  return {
    [`CARGO_TARGET_${key}_LINKER`]: linker,
    [`CC_${triple.replaceAll("-", "_")}`]: linker,
    [`AR_${triple.replaceAll("-", "_")}`]: join(linker, "..", `llvm-ar${exe}`),
  };
}

/**
 * Build a cdylib crate for each ABI and copy `lib*.so` into `jniLibs/<abi>`.
 * Cargo runs through the workspace native admission owner (Windows mutex or
 * flock), which serializes native builds across agents and pins the target
 * directory to `<workspace>/target`.
 */
export async function buildNative(options: {
  workspace: string;
  crate: string;
  library: string;
  abis: readonly AndroidAbi[];
  jniLibs: string;
  toolchain: AndroidToolchain;
  profile?: "release" | "debug";
}): Promise<void> {
  const ndk = await ensureNdk(options.toolchain);
  const profile = options.profile ?? "release";
  const { loadConfig, runNative } = await import("@aphrody/bun-workspace");
  const config = await loadConfig(options.workspace);
  for (const abi of options.abis) {
    const triple = TRIPLES[abi];
    const code = await runNative(
      config,
      [
        "cargo",
        "build",
        "--locked",
        "-p",
        options.crate,
        "--target",
        triple,
        ...(profile === "release" ? ["--release"] : []),
      ],
      {
        root: options.workspace,
        cwd: options.workspace,
        timeoutMs: 1_800_000,
        runtimePolicy: "development",
        env: cargoAndroidEnv(ndk, triple),
      },
    );
    if (code !== 0) throw new Error(`cargo build ${options.crate} for ${triple} failed (${code})`);
    const built = join(options.workspace, "target", triple, profile, `lib${options.library}.so`);
    await Bun.write(join(options.jniLibs, abi, `lib${options.library}.so`), Bun.file(built));
  }
}

/** Build an Android Gradle project, optionally embedding prebuilt `libbun.so` files. */
export async function build(options: BuildOptions & { workspace: string }): Promise<string> {
  const toolchain = resolveToolchain(options.project);
  const abis = options.abis ?? ABIS;
  const jniLibs = options.jniLibs ?? join(options.workspace, "target", "android", "jniLibs");
  if (options.native !== false) {
    await buildNative({
      workspace: options.workspace,
      crate: "android-native",
      library: "android_native",
      abis,
      jniLibs,
      toolchain,
    });
  }
  for (const [abi, path] of Object.entries(options.libbun ?? {})) {
    if (path) await Bun.write(join(jniLibs, abi, "libbun.so"), Bun.file(path));
  }
  if (!toolchain.gradle) throw new Error("Gradle not found: set GRADLE_HOME or add a Gradle wrapper");
  const variant = options.variant ?? "debug";
  const task = `assemble${variant[0]!.toUpperCase()}${variant.slice(1)}`;
  const code = await run([toolchain.gradle, task, "--console=plain"], {
    cwd: options.project,
    env: toolchainEnv(toolchain),
  });
  if (code !== 0) throw new Error(`gradle ${task} failed (${code})`);
  return join(options.project, "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);
}

/** Connected devices and emulators reported by `adb devices -l`. */
export async function devices(toolchain = resolveToolchain()): Promise<AndroidDevice[]> {
  const output = await capture([toolchain.adb, "devices", "-l"]);
  return output
    .split(/\r?\n/)
    .slice(1)
    .filter(line => line.trim())
    .map(line => {
      const [serial = "", state = "", ...rest] = line.trim().split(/\s+/);
      const properties = Object.fromEntries(rest.map(item => item.split(":", 2) as [string, string]));
      return { serial, state, properties };
    });
}

function adbArgs(toolchain: AndroidToolchain, serial?: string): string[] {
  return serial ? [toolchain.adb, "-s", serial] : [toolchain.adb];
}

export async function install(apk: string, serial?: string, toolchain = resolveToolchain()): Promise<number> {
  return await run([...adbArgs(toolchain, serial), "install", "-r", apk]);
}

/** Launch the application's launcher activity through the monkey launcher intent. */
export async function launch(packageName: string, serial?: string, toolchain = resolveToolchain()): Promise<number> {
  return await run([
    ...adbArgs(toolchain, serial),
    "shell",
    "monkey",
    "-p",
    packageName,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ]);
}

export async function logcat(
  args: readonly string[] = [],
  serial?: string,
  toolchain = resolveToolchain(),
): Promise<number> {
  return await run([...adbArgs(toolchain, serial), "logcat", ...args]);
}

/** Push and execute a `bun build --compile --target=bun-android-*` executable over adb. */
export async function exec(
  binary: string,
  args: readonly string[] = [],
  serial?: string,
  toolchain = resolveToolchain(),
): Promise<number> {
  const remote = `/data/local/tmp/${binary.split(/[\\/]/).at(-1)}`;
  const adb = adbArgs(toolchain, serial);
  const pushed = await run([...adb, "push", binary, remote]);
  if (pushed !== 0) return pushed;
  return await run([
    ...adb,
    "shell",
    `chmod 755 ${remote} && ${remote} ${args.map(arg => `'${arg.replaceAll("'", "'\\''")}'`).join(" ")}`,
  ]);
}
