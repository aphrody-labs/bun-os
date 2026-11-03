#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// bunos apk <detect|install|path> <file.apk>: run Android APKs on Windows as native windows.
//
// Path: the Bun OS WSL bundle (docs/WSL.md section 8) runs Waydroid from vendor/waydroid in the `bunos` distro, on
// our kernel's binderfs; with persist.waydroid.multi_windows every Android activity is its own Wayland toplevel,
// which WSLg turns into its own Win32 window. Fallback: WSABuilds (community Windows Subsystem for Android) over ADB.
// When no Android target is reachable it prints the plan it would run (a dry run) and exits 0.
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseApk } from "../../bun-loaders/src/apk.ts";

const DISTRO = process.env.BUNOS_WSL_DISTRO ?? "bunos";

export interface ApkInfo {
  file: string;
  bytes: number;
  isZip: boolean;
  hasManifest: boolean;
  /** package name from the binary AndroidManifest.xml (bun-loaders AXML decoder) */
  packageName?: string;
  versionName?: string;
}

export function inspectApk(file: string): ApkInfo {
  const buf = readFileSync(file);
  const info: ApkInfo = {
    file,
    bytes: buf.length,
    isZip: buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b,
    hasManifest: false,
  };
  if (!info.isZip) return info;
  try {
    const apk = parseApk(buf, file);
    info.hasManifest = apk.manifest !== null;
    if (apk.package) info.packageName = apk.package;
    if (apk.versionName) info.versionName = apk.versionName;
  } catch {
    // Not decodable as binary XML (or a broken zip): fall back to "is there a manifest entry at all".
    info.hasManifest = buf.includes("AndroidManifest.xml");
  }
  return info;
}

// Guest side, as root: start the Waydroid session once (as the distro user, on WSLg's Wayland socket) and wait for
// Android to finish booting. The session runs as a transient user unit so it outlives this wsl.exe call.
export const ENSURE_SESSION = [
  "set -e",
  "u=$(id -nu 1000)",
  "if ! waydroid status 2>/dev/null | grep -q 'Session:.*RUNNING'; then",
  "  systemctl start waydroid-container.service",
  "  ln -sf /mnt/wslg/runtime-dir/wayland-0 /run/user/1000/wayland-0 2>/dev/null || true",
  "  systemd-run --machine=$u@ --user --collect --unit=waydroid-session --setenv=WAYLAND_DISPLAY=wayland-0 --setenv=XDG_RUNTIME_DIR=/run/user/1000 waydroid session start >/dev/null",
  "fi",
  'for i in $(seq 240); do [ "$(waydroid shell -- getprop sys.boot_completed 2>/dev/null)" = 1 ] && exit 0; sleep 0.5; done',
  "echo 'waydroid: Android did not finish booting in 120 s' >&2; exit 1",
].join("\n");

export function plan(info: ApkInfo): string[][] {
  const wsl = ["wsl.exe", "-d", DISTRO, "-u", "root", "--"];
  const steps = [
    // wsl.exe re-parses its command line, which mangles quotes in a multi-line script: ship it as one base64 token.
    [...wsl, "sh", "-c", `echo ${Buffer.from(ENSURE_SESSION).toString("base64")} | base64 -d | sh`],
    ["wsl.exe", "-d", DISTRO, "--", "waydroid", "app", "install", toWslPath(info.file)],
  ];
  if (info.packageName) {
    // `waydroid app install` returns before PackageManager has finished (dexopt); launch once the package resolves.
    const wait = `for i in $(seq 120); do waydroid shell -- pm path ${info.packageName} >/dev/null 2>&1 && exit 0; sleep 0.5; done; exit 1`;
    steps.push([...wsl, "sh", "-c", `echo ${Buffer.from(wait).toString("base64")} | base64 -d | sh`]);
    steps.push(["wsl.exe", "-d", DISTRO, "--", "waydroid", "app", "launch", info.packageName]);
  }
  return steps;
}

function fallbackPlan(info: ApkInfo): string[][] {
  // WSABuilds: Windows Subsystem for Android reached over ADB (WSA listens on 127.0.0.1:58526).
  return [
    ["adb", "connect", "127.0.0.1:58526"],
    ["adb", "install", "-r", info.file],
  ];
}

export function toWslPath(winPath: string): string {
  const abs = resolve(winPath);
  const m = abs.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!m) return abs;
  return `/mnt/${m[1]!.toLowerCase()}/${m[2]!.replace(/\\/g, "/")}`;
}

function wslAvailable(): boolean {
  if (process.platform !== "win32" || !Bun.which("wsl.exe")) return false;
  const probe = Bun.spawnSync(
    ["wsl.exe", "-d", DISTRO, "--", "sh", "-c", "command -v waydroid && grep -q binder /proc/filesystems"],
    { stdout: "ignore", stderr: "ignore" },
  );
  return probe.exitCode === 0;
}

function runPlan(steps: string[][]): number {
  for (const step of steps) {
    process.stderr.write(`+ ${step.slice(0, 8).join(" ")}${step.length > 8 ? " ..." : ""}\n`);
    const proc = Bun.spawnSync(step, { stdio: ["inherit", "inherit", "inherit"] });
    if (proc.exitCode !== 0) return proc.exitCode ?? 1;
  }
  return 0;
}

function printDryRun(info: ApkInfo, steps: string[][], reason: string): void {
  console.log(`apk: ${basename(info.file)} (${(info.bytes / 1048576).toFixed(1)} MiB)`);
  console.log(
    `  valid APK: ${info.isZip && info.hasManifest ? "yes" : "no"}${info.packageName ? `  package: ${info.packageName}` : ""}`,
  );
  console.log(`  ${reason}; dry run — the plan that would run:`);
  for (const step of steps) console.log(`    ${step.join(" ")}`);
  console.log(`  fallback (WSABuilds over ADB):`);
  for (const step of fallbackPlan(info)) console.log(`    ${step.join(" ")}`);
}

export function main(argv = process.argv.slice(2)): number {
  const [cmd, fileArg] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log("usage: bunos apk <detect|path|install> <file.apk>");
    console.log("  detect   inspect the APK (zip, AndroidManifest, package name)");
    console.log(
      "  path     print the install plan (Waydroid in the Bun OS WSL distro, WSLg windows; WSABuilds fallback)",
    );
    console.log("  install  install and launch via Waydroid; dry run when no Android target is reachable");
    return cmd ? 0 : 2;
  }
  if (!fileArg) {
    console.error("bunos apk: missing <file.apk>");
    return 2;
  }
  const file = resolve(fileArg);
  if (!existsSync(file) || !statSync(file).isFile()) {
    console.error(`bunos apk: not a file: ${file}`);
    return 2;
  }
  const info = inspectApk(file);
  if (cmd === "detect") {
    console.log(JSON.stringify(info, null, 2));
    return info.isZip && info.hasManifest ? 0 : 1;
  }
  if (!info.isZip || !info.hasManifest) {
    console.error(`bunos apk: ${basename(file)} is not an Android APK (no AndroidManifest.xml)`);
    return 1;
  }
  const steps = plan(info);
  if (cmd === "path") {
    for (const step of steps) console.log(step.join(" "));
    return 0;
  }
  if (cmd === "install") {
    if (!wslAvailable()) {
      printDryRun(
        info,
        steps,
        process.platform === "win32" ? `Bun OS WSL distro '${DISTRO}' with Waydroid not reachable` : "not on Windows",
      );
      return 0;
    }
    return runPlan(steps);
  }
  console.error(`bunos apk: unknown subcommand '${cmd}'`);
  return 2;
}

if (import.meta.main) process.exit(main());
