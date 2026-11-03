#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// bunos apk <detect|install|path> <file.apk>: run Android APKs on Windows as native windows.
//
// Primary path: the Bun OS WSL bundle (another member owns the kernel/WSLg bundle; this talks to it only through
// the documented interface) runs Waydroid; WSLg projects each Android activity as a native Windows window.
// Fallback: WSABuilds (community Windows Subsystem for Android) reached over ADB.
//
// This front end never starts WSL on the workstation. When no Android target is reachable it prints the plan it
// would run (a dry run) and exits 0, so it is safe to invoke here. See docs/WINDOWS-DESKTOP.md and docs/ANDROID.md.
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const DISTRO = process.env.BUNOS_WSL_DISTRO ?? "BunOS";

export interface ApkInfo {
  file: string;
  bytes: number;
  isZip: boolean;
  hasManifest: boolean;
  /** package name from the binary AndroidManifest.xml string pool, when it can be read cheaply */
  packageName?: string;
}

// Minimal zip central-directory scan: enough to confirm an APK and find AndroidManifest.xml, without a zip lib.
export function inspectApk(file: string): ApkInfo {
  const buf = readFileSync(file);
  const info: ApkInfo = { file, bytes: buf.length, isZip: buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b, hasManifest: false };
  if (!info.isZip) return info;
  // Find the End Of Central Directory record (signature 0x06054b50) scanning back from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0x10000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return info;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    names.push(buf.toString("utf8", off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
  }
  info.hasManifest = names.includes("AndroidManifest.xml");
  // Heuristic package name: the first "com.*"/"xxx.yyy" readable UTF-16 run in the manifest-bearing APK; cheap and
  // best-effort only. A real parse belongs in the jadx-headless MCP / aapt in the guest.
  const m = buf.toString("latin1").match(/package["']?\s*[:=]\s*["']([a-zA-Z][\w.]+\.[\w.]+)["']/);
  if (m) info.packageName = m[1];
  return info;
}

function wslAvailable(): boolean {
  if (process.platform !== "win32") return false;
  const which = Bun.spawnSync(["where", "wsl.exe"]);
  if (which.exitCode !== 0) return false;
  const status = Bun.spawnSync(["wsl.exe", "-d", DISTRO, "--", "true"], { stdout: "ignore", stderr: "ignore" });
  return status.exitCode === 0;
}

export function plan(info: ApkInfo): string[][] {
  // Native windows via Waydroid under WSLg in the Bun OS distro.
  const name = info.packageName ?? basename(info.file);
  return [
    ["wsl.exe", "-d", DISTRO, "--", "waydroid", "status"],
    ["wsl.exe", "-d", DISTRO, "--", "waydroid", "session", "start"],
    ["wsl.exe", "-d", DISTRO, "--", "waydroid", "app", "install", toWslPath(info.file)],
    ["wsl.exe", "-d", DISTRO, "--", "waydroid", "app", "launch", name],
  ];
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
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

function runPlan(steps: string[][]): number {
  for (const step of steps) {
    process.stderr.write(`+ ${step.join(" ")}\n`);
    const proc = Bun.spawnSync(step, { stdio: ["inherit", "inherit", "inherit"] });
    if (proc.exitCode !== 0) return proc.exitCode ?? 1;
  }
  return 0;
}

function printDryRun(info: ApkInfo, steps: string[][], reason: string): void {
  console.log(`apk: ${basename(info.file)} (${(info.bytes / 1048576).toFixed(1)} MiB)`);
  console.log(`  valid APK: ${info.isZip && info.hasManifest ? "yes" : "no"}${info.packageName ? `  package: ${info.packageName}` : ""}`);
  console.log(`  ${reason}; dry run — the plan that would run:`);
  for (const step of steps) console.log(`    ${step.join(" ")}`);
  console.log(`  fallback (WSABuilds over ADB):`);
  for (const step of fallbackPlan(info)) console.log(`    ${step.join(" ")}`);
}

function main(): number {
  const [cmd, fileArg] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log("usage: bunos apk <detect|path|install> <file.apk>");
    console.log("  detect   inspect the APK (zip, AndroidManifest, package name)");
    console.log("  path     print the install plan (Waydroid on the Bun OS WSL bundle via WSLg; WSABuilds fallback)");
    console.log("  install  install and launch via Waydroid; dry-run when no Android target is reachable");
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
      printDryRun(info, steps, process.platform === "win32" ? `Bun OS WSL distro '${DISTRO}' not reachable` : "not on Windows");
      return 0;
    }
    return runPlan(steps);
  }
  console.error(`bunos apk: unknown subcommand '${cmd}'`);
  return 2;
}

if (import.meta.main) process.exit(main());
