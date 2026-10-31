#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Shared Android toolchain at Googlebook-equivalent levels (Android 17, API 37.x), pinned in sdk.json.
//   bun factory/android/sdk.ts install [--profile build|full] [--root DIR]   sdkmanager + JDK + Gradle + Kotlin + Rust targets
//   bun factory/android/sdk.ts verify  [--profile build|full] [--root DIR]   compares `sdkmanager --list_installed` to the pins
//   bun factory/android/sdk.ts packages [--profile build|full]               prints the sdkmanager ids (used by the image)
//   bun factory/android/sdk.ts image                                         builds the private bunos-android-sdk Docker image
// Linux only (the VPS and build containers). Licences are accepted non-interactively: the owner accepted them all.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface Pkg {
  id: string;
  revision: string;
  /** sdkmanager channel: 0 stable (default), 3 canary. */
  channel?: number;
}
interface Recipe {
  root: string;
  tools: string;
  cmdlineToolsBootstrap: string;
  jdk: { package: string; major: number };
  gradle: { version: string };
  kotlin: { version: string; url: string };
  rust: { targets: string[]; cargoNdk: string };
  packages: { build: Pkg[]; emulator: Pkg[] };
}

const recipe: Recipe = await Bun.file(join(import.meta.dir, "sdk.json")).json();
const [command = "verify", ...args] = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const profile = flag("--profile", "full");
const root = flag("--root", process.env.ANDROID_HOME ?? recipe.root);
const pins = profile === "build" ? recipe.packages.build : [...recipe.packages.build, ...recipe.packages.emulator];
const sdkmanager = join(root, "cmdline-tools", "latest", "bin", "sdkmanager");

async function sh(cmd: string[], input?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "inherit" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
  return out;
}

async function installed(): Promise<Map<string, string>> {
  const out = await sh([sdkmanager, `--sdk_root=${root}`, "--list_installed"]);
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    // Legacy sdkmanager: "id | revision | ..."; Android CLI shim: "path  revision  description", path uses "/".
    const cols = line.includes("|") ? line.split("|").map(c => c.trim()) : line.trim().split(/\s{2,}/);
    // Preview packages carry their channel before the revision ("beta   1.0.0").
    const channelWord = /^(alpha|beta|canary|dev|rc)$/;
    const id = cols[0];
    const revision = (channelWord.test(cols[1] ?? "") ? cols[2] : cols[1])?.replace(/^(alpha|beta|canary|dev|rc)\s+/, "");
    if (!id || !revision || /^(Path|---|Installed)/.test(id) || id.startsWith("Installed")) continue;
    map.set(id.replaceAll("/", ";"), revision);
  }
  return map;
}

/** "2" matches "2.0.0", "23.0" matches "23.0.0". */
const sameRevision = (a: string, b: string) => {
  const norm = (r: string) => r.split(" ")[0]!.replace(/(\.0)+$/, "");
  return norm(a) === norm(b);
};

async function verify(): Promise<boolean> {
  const have = await installed();
  let ok = true;
  for (const pin of pins) {
    const got = have.get(pin.id);
    const good = got !== undefined && sameRevision(got, pin.revision);
    if (!good) ok = false;
    console.log(`${good ? "ok  " : "BAD "} ${pin.id} want ${pin.revision} have ${got ?? "-"}`);
  }
  return ok;
}

async function bootstrap() {
  mkdirSync(join(root, "cmdline-tools"), { recursive: true });
  if (!existsSync(sdkmanager)) {
    // dl.google.com answers 404 over IPv6 from the VPS: force IPv4.
    await sh(["curl", "-4", "-fsSL", recipe.cmdlineToolsBootstrap, "-o", "/tmp/bunos-clt.zip"]);
    await sh(["rm", "-rf", "/tmp/bunos-clt"]);
    await sh(["unzip", "-q", "/tmp/bunos-clt.zip", "-d", "/tmp/bunos-clt"]);
    await sh(["mv", "/tmp/bunos-clt/cmdline-tools", join(root, "cmdline-tools", "latest")]);
  }
  // cmdline-tools 23 turned sdkmanager into a shim over the Android CLI, which its launcher fetches into
  // $ANDROID_USER_HOME/bin over the default route; that 404s over IPv6, so prefetch it over IPv4.
  const cliHome = join(process.env.ANDROID_USER_HOME ?? join(process.env.HOME ?? "/root", ".android"), "bin");
  if (!existsSync(join(cliHome, "android-cli"))) {
    mkdirSync(cliHome, { recursive: true });
    await sh(["curl", "-4", "-fsSL", "https://dl.google.com/android/cli/latest/linux_x86_64/android-cli", "-o", join(cliHome, "android-cli.tmp")]);
    await sh(["chmod", "+x", join(cliHome, "android-cli.tmp")]);
    await sh(["mv", join(cliHome, "android-cli.tmp"), join(cliHome, "android-cli")]);
  }
  await sh([sdkmanager, `--sdk_root=${root}`, "--licenses"], "y\n".repeat(64));
}

async function installHostExtras() {
  const opt = recipe.tools;
  if (!existsSync(join(opt, `gradle-${recipe.gradle.version}`))) {
    const zip = `/tmp/gradle-${recipe.gradle.version}.zip`;
    await sh(["curl", "-4", "-fsSL", `https://services.gradle.org/distributions/gradle-${recipe.gradle.version}-bin.zip`, "-o", zip]);
    await sh(["unzip", "-q", "-o", zip, "-d", opt]);
    await sh(["ln", "-sfn", join(opt, `gradle-${recipe.gradle.version}`), join(opt, "gradle")]);
  }
  if (!existsSync(join(opt, `kotlinc-${recipe.kotlin.version}`))) {
    const zip = `/tmp/kotlin-${recipe.kotlin.version}.zip`;
    await sh(["curl", "-4", "-fsSL", recipe.kotlin.url, "-o", zip]);
    await sh(["rm", "-rf", "/tmp/kotlinc"]);
    await sh(["unzip", "-q", "-o", zip, "-d", "/tmp"]);
    await sh(["mv", "/tmp/kotlinc", join(opt, `kotlinc-${recipe.kotlin.version}`)]);
    await sh(["ln", "-sfn", join(opt, `kotlinc-${recipe.kotlin.version}`), join(opt, "kotlinc")]);
  }
  if (Bun.which("rustup")) {
    await sh(["rustup", "target", "add", ...recipe.rust.targets]);
    await sh(["cargo", "install", "--locked", "cargo-ndk", "--version", recipe.rust.cargoNdk]);
  }
}

switch (command) {
  case "packages":
    console.log(pins.map(p => p.id).join("\n"));
    break;
  case "install": {
    await bootstrap();
    // Stable-channel packages first; the desktop (Googlebook) images are only published on the canary channel.
    for (const channel of [...new Set(pins.map(p => p.channel ?? 0))].sort()) {
      const ids = pins.filter(p => (p.channel ?? 0) === channel).map(p => p.id);
      await sh([sdkmanager, `--sdk_root=${root}`, `--channel=${channel}`, "--install", ...ids], "y\n".repeat(64));
    }
    if (profile !== "build" || args.includes("--host")) await installHostExtras();
    if (!(await verify())) process.exit(1);
    break;
  }
  case "verify":
    if (!(await verify())) process.exit(1);
    break;
  case "image": {
    const ctx = join(import.meta.dir, "image");
    await Bun.write(join(ctx, "packages.txt"), recipe.packages.build.map(p => p.id).join("\n") + "\n");
    const build = Bun.spawn(
      [
        "docker", "build", "-t", "bunos-android-sdk:37", "-f", join(ctx, "Containerfile"),
        "--build-arg", `CMDLINE_TOOLS=${recipe.cmdlineToolsBootstrap}`,
        "--build-arg", `GRADLE_VERSION=${recipe.gradle.version}`,
        "--build-arg", `KOTLIN_URL=${recipe.kotlin.url}`,
        "--build-arg", `RUST_TARGETS=${recipe.rust.targets.join(" ")}`,
        "--build-arg", `CARGO_NDK=${recipe.rust.cargoNdk}`,
        ctx,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    process.exit(await build.exited);
  }
  default:
    console.error(`unknown command ${command}`);
    process.exit(2);
}
