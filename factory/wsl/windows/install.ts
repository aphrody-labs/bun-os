#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Bun OS for Windows installer: our WSL2 kernel + modules VHD, the bunos-wsl distro, WSLg settings and (opt-in)
// the bunos.sys driver package. Runs on the target Windows 11 machine with Bun; no PowerShell needed.
//
//   bun install.ts [--bundle <dir>] [--dest <dir>] [--name bunos] [--dry-run] [--driver]
//
// --dry-run prints every action and the resulting .wslconfig/.wslgconfig without touching anything (safe anywhere).
// Without it: copies the artifacts to <dest> (default %LOCALAPPDATA%\BunOS\wsl), merges .wslconfig/.wslgconfig in
// %USERPROFILE% (backups *.bunos-backup), `wsl --shutdown` so the kernel applies, installs the distro and checks
// `uname -r`. --driver adds `pnputil /add-driver bunos.inf /install` (admin + test signing: Windows 11 test VM only).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Ini = Map<string, Map<string, string>>;

/** Keys of `template` win; every other section/key of `current` is kept, comments of `current` are kept in place. */
export function mergeIni(current: string, template: string): string {
  const wanted = parseIni(template);
  const lines = current.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const done = new Set<string>();
  const out: string[] = [];
  let section = "";
  const flush = () => {
    const keys = wanted.get(section);
    if (!keys) return;
    for (const [k, v] of keys) if (!done.has(`${section}\0${k.toLowerCase()}`)) out.push(`${k}=${v}`);
    done.add(`${section}\0`);
  };
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      flush();
      section = header[1]!.trim().toLowerCase();
      out.push(line);
      continue;
    }
    const kv = /^\s*([^#;=\s][^=]*?)\s*=/.exec(line);
    const keys = wanted.get(section);
    if (kv && keys) {
      const key = [...keys.keys()].find(k => k.toLowerCase() === kv[1]!.toLowerCase());
      if (key !== undefined) {
        out.push(`${key}=${keys.get(key)}`);
        done.add(`${section}\0${key.toLowerCase()}`);
        continue;
      }
    }
    out.push(line);
  }
  flush();
  for (const [name, keys] of wanted) {
    if (done.has(`${name}\0`)) continue;
    if (out.length && out.at(-1) !== "") out.push("");
    out.push(`[${name}]`, ...[...keys].map(([k, v]) => `${k}=${v}`));
  }
  return `${out.join("\r\n")}\r\n`;
}

export function parseIni(text: string): Ini {
  const ini: Ini = new Map();
  let section = "";
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1]!.trim().toLowerCase();
      if (!ini.has(section)) ini.set(section, new Map());
      continue;
    }
    const eq = line.indexOf("=");
    if (eq > 0) ini.get(section)?.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return ini;
}

/** .wslconfig wants Windows paths with escaped backslashes. */
export const wslPath = (path: string) => path.replace(/\//g, "\\").replace(/\\/g, "\\\\");

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function args(argv: string[]) {
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const here = dirname(Bun.main === import.meta.path ? import.meta.path : process.argv[1]!);
  return {
    bundle: resolve(value("--bundle") ?? here),
    dest: resolve(value("--dest") ?? join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? ".", "AppData", "Local"), "BunOS", "wsl")),
    name: value("--name") ?? "bunos",
    dryRun: flag("--dry-run"),
    driver: flag("--driver"),
    profile: process.env.USERPROFILE ?? process.env.HOME ?? ".",
  };
}

function run(cmd: string[], dryRun: boolean): string {
  console.log(`$ ${cmd.join(" ")}`);
  if (dryRun) return "";
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  // wsl.exe writes UTF-16LE when not attached to a console.
  const decode = (b: Uint8Array) => (b.length > 1 && b[1] === 0 ? Buffer.from(b).toString("utf16le") : Buffer.from(b).toString());
  const out = decode(p.stdout) + decode(p.stderr);
  if (p.exitCode !== 0) throw new Error(`${cmd[0]} exited ${p.exitCode}: ${out.trim()}`);
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const o = args(argv);
  if (process.platform !== "win32" && !o.dryRun) throw new Error("install.ts installs on Windows; use --dry-run elsewhere");
  const files = { kernel: "bzImage", modules: "modules.vhdx", distro: "bunos-wsl.wsl" } as const;
  // SHA256SUMS (sha256sum format) is written by bundle.sh; every listed file must match.
  const sums = join(o.bundle, "SHA256SUMS");
  if (existsSync(sums)) {
    for (const line of readFileSync(sums, "utf8").split("\n").filter(Boolean)) {
      const [hash, name] = line.split(/\s+\*?/);
      const file = join(o.bundle, name!);
      if (!existsSync(file)) continue;
      if (sha256(file) !== hash) throw new Error(`checksum mismatch: ${name}`);
      console.log(`ok ${name}`);
    }
  }
  for (const f of Object.values(files)) if (!existsSync(join(o.bundle, f)) && !o.dryRun) throw new Error(`missing ${f} in ${o.bundle}`);

  const kernel = join(o.dest, files.kernel);
  const modules = join(o.dest, files.modules);
  const fill = (t: string) => t.replaceAll("{{KERNEL}}", wslPath(kernel)).replaceAll("{{MODULES}}", wslPath(modules));
  const template = (n: string) => readFileSync(join(import.meta.dir, n), "utf8");
  const configs = [
    [join(o.profile, ".wslconfig"), fill(template("wslconfig.template"))],
    [join(o.profile, ".wslgconfig"), template("wslgconfig.template")],
  ] as const;

  console.log(`${o.dryRun ? "[dry-run] " : ""}Bun OS for Windows -> ${o.dest} (distro ${o.name})`);
  if (!o.dryRun) mkdirSync(o.dest, { recursive: true });
  for (const f of Object.values(files)) {
    console.log(`copy ${join(o.bundle, f)} -> ${join(o.dest, f)}`);
    if (!o.dryRun) copyFileSync(join(o.bundle, f), join(o.dest, f));
  }
  for (const [path, tpl] of configs) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    const merged = mergeIni(current, tpl);
    console.log(`--- ${path}\n${merged}`);
    if (o.dryRun) continue;
    if (current) writeFileSync(`${path}.bunos-backup`, current);
    writeFileSync(path, merged);
  }

  const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  const wsl = join(system32, "wsl.exe");
  if (!o.dryRun && !existsSync(wsl)) {
    run([wsl, "--install", "--no-distribution"], false);
    console.log("WSL installed: reboot, then run this installer again.");
    return;
  }
  run([wsl, "--shutdown"], o.dryRun);
  // --from-file honours /etc/wsl-distribution.conf (Start-menu shortcut, Terminal profile; WSL >= 2.4.4);
  // `--import` of the same gzip tar is the fallback for older WSL.
  const location = join(o.dest, o.name);
  try {
    run([wsl, "--install", "--from-file", join(o.dest, files.distro), "--name", o.name, "--location", location, "--no-launch"], o.dryRun);
  } catch (e) {
    console.log(`--from-file failed (${(e as Error).message}); falling back to --import`);
    run([wsl, "--import", o.name, location, join(o.dest, files.distro), "--version", "2"], false);
  }
  const release = run([wsl, "-d", o.name, "--", "uname", "-r"], o.dryRun).trim();
  if (!o.dryRun) {
    if (!release.includes("microsoft-standard-WSL2") || !release.startsWith("7.")) throw new Error(`unexpected kernel: ${release}`);
    console.log(`kernel ${release}`);
    run([wsl, "-d", o.name, "--", "sh", "-c", "test -S /mnt/wslg/runtime-dir/wayland-0 && test -e /dev/dxg && echo wslg+dxg ok"], false);
  }
  if (o.driver) {
    const inf = join(o.bundle, "driver", "bunos.inf");
    run([join(system32, "pnputil.exe"), "/add-driver", inf, "/install"], o.dryRun);
    run([join(system32, "sc.exe"), "start", "BunOS"], o.dryRun);
  }
}

if (import.meta.main) main();
