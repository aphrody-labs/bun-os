#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ABIS, build, devices, ensureNdk, exec, install, launch, logcat, resolveToolchain } from "./index.ts";
import { docsCommand } from "./docs/index.ts";
import { assemble, bundle, describe, gradle, lint, type GradleReport } from "./gradle.ts";
import { Jvm } from "./jvm.ts";
import { parseManifest } from "./plugin.ts";
import type { AndroidAbi, BuildVariant } from "./types.ts";

const usage = `bun android <command> [options]

  build    [--project dir] [--release] [--abi arm64-v8a|x86_64] [--libbun abi=path]   (Rust .so: Gradle cargoNdk task)
  install  [--project dir] [--release] [apk]     install the built APK
  run      [--project dir] [--release]           build, install and launch
  exec     <binary> [args...]                    push and run a bun-android-* executable
  logcat   [adb logcat args...]
  devices
  doctor
  docs     <fetch|repos|search|stats>            local Android/AOSP documentation
  ndk      [version]                             install the NDK through sdkmanager
  gradle   <tasks...> [--project dir] [--json]   run the Gradle wrapper (shared factory toolchain), parsed report
  assemble [--project dir] [--release] [--json]  :app:assemble<Variant> (Gradle only, Rust via the cargoNdk task)
  bundle   [--project dir] [--json]              :app:bundleRelease (AAB)
  lint     [--project dir] [--release] [--json]  :app:lint<Variant>
  deploy   [--project dir] [--release]           assemble, adb install, launch
  jvm      [--classpath a.jar:b] <class> <method> [arg]   call static String method(String) through the bun:ffi JNI bridge

  --serial <id>  target device`;

function workspaceRoot(): string {
  let directory = process.cwd();
  while (true) {
    if (existsSync(join(directory, "apps", "bun-android", "settings.gradle"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(import.meta.dir, "..", "..", "..");
    directory = parent;
  }
}

if (Bun.argv[2] === "docs") process.exit(await docsCommand(Bun.argv.slice(3)));

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    project: { type: "string" },
    release: { type: "boolean" },
    abi: { type: "string", multiple: true },
    libbun: { type: "string", multiple: true },
    "no-native": { type: "boolean" },
    serial: { type: "string" },
    json: { type: "boolean" },
    classpath: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const [command, ...rest] = positionals;
const workspace = workspaceRoot();
const project = resolve(typeof values.project === "string" ? values.project : join(workspace, "apps", "bun-android"));
const variant: BuildVariant = values.release ? "release" : "debug";
const serial = typeof values.serial === "string" ? values.serial : undefined;
const abis = (values.abi as string[] | undefined)?.map(abi => {
  if (!ABIS.includes(abi as AndroidAbi)) throw new Error(`Unsupported ABI ${abi}`);
  return abi as AndroidAbi;
});
const libbun = Object.fromEntries(
  ((values.libbun as string[] | undefined) ?? []).map(entry => {
    const [abi, path] = entry.split("=", 2);
    return [abi, resolve(path ?? "")];
  }),
);
const apkPath = () => join(project, "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);

async function packageName(): Promise<string> {
  const gradle = await Bun.file(join(project, "app", "build.gradle")).text();
  const id = /applicationId\s*=?\s*['"]([^'"]+)['"]/.exec(gradle)?.[1];
  if (id) return id;
  const manifest = parseManifest(await Bun.file(join(project, "app", "src", "main", "AndroidManifest.xml")).text());
  if (!manifest.package) throw new Error("applicationId not found");
  return manifest.package;
}

const doBuild = () =>
  build({
    workspace,
    project,
    variant,
    abis,
    libbun,
    // The Gradle cargoNdk task builds crates/android-native for every ABI; copying it here too would duplicate the .so.
    native: false,
  });

function report(result: GradleReport): void {
  if (values.json) {
    const { output: _output, ...rest } = result;
    console.log(JSON.stringify(rest, null, 2));
  } else console.log(describe(result));
  if (!result.ok) process.exitCode = 1;
}

switch (command) {
  case "gradle": {
    // Everything after `gradle` goes to Gradle verbatim (tasks and flags such as --write-locks), minus our own options.
    const raw = Bun.argv.slice(Bun.argv.indexOf("gradle") + 1);
    const tasks = raw.filter((arg, i) => arg !== "--json" && arg !== "--project" && raw[i - 1] !== "--project");
    report(await gradle({ project, tasks, echo: !values.json }));
    break;
  }
  case "assemble":
    report(await assemble(project, variant, { echo: !values.json }));
    break;
  case "bundle":
    report(await bundle(project, "release", { echo: !values.json }));
    break;
  case "lint":
    report(await lint(project, variant, { echo: !values.json }));
    break;
  case "deploy": {
    const result = await assemble(project, variant, { echo: true });
    report(result);
    if (!result.ok) break;
    process.exitCode = (await install(apkPath(), serial)) || (await launch(await packageName(), serial));
    break;
  }
  case "jvm": {
    const [className, method, input = ""] = rest;
    if (!className || !method) throw new Error("Usage: bun android jvm [--classpath a.jar:b] <class> <method> [arg]");
    const classPath = typeof values.classpath === "string" ? values.classpath.split(":") : [];
    console.log(Jvm.open().start({ classPath }).callStaticString(className, method, input));
    break;
  }
  case "build":
    console.log(await doBuild());
    break;
  case "install":
    process.exitCode = await install(rest[0] ? resolve(rest[0]) : apkPath(), serial);
    break;
  case "run": {
    const apk = await doBuild();
    process.exitCode = (await install(apk, serial)) || (await launch(await packageName(), serial));
    break;
  }
  case "exec":
    if (!rest[0]) throw new Error("Usage: bun android exec <binary> [args...]");
    process.exitCode = await exec(resolve(rest[0]), rest.slice(1), serial);
    break;
  case "logcat":
    process.exitCode = await logcat(rest, serial);
    break;
  case "devices":
    console.log(JSON.stringify(await devices(), null, 2));
    break;
  case "doctor": {
    const toolchain = resolveToolchain(project);
    const present = (path: string | undefined) => !!path && existsSync(path);
    console.log(
      JSON.stringify(
        {
          bun: Bun.version,
          project,
          toolchain,
          found: {
            sdk: present(toolchain.sdk),
            ndk: present(toolchain.ndk),
            adb: present(toolchain.adb),
            sdkmanager: present(toolchain.sdkmanager),
            gradle: present(toolchain.gradle),
            java: present(toolchain.javaHome),
          },
        },
        null,
        2,
      ),
    );
    break;
  }
  case "ndk":
    console.log(await ensureNdk(resolveToolchain(project), rest[0]));
    break;
  default:
    console.log(usage);
    if (command && !values.help) process.exitCode = 1;
}
