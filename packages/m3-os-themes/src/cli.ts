#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// m3-os-themes <install|generate|uninstall> --target windows|gnome|cosmic|chromium|all
//   --seed <hex> --mode light|dark|auto [--name N] [--out DIR] [--variant V] [--dry-run|--apply]
// In the Aphrody checkout: `yolo m3 os-themes ...` (runOsThemes, in-process).
// `generate` writes only into --out. `install`/`uninstall` are dry-run unless --apply (then they run the generated scripts).
import { mkdirSync, writeFileSync, chmodSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { nativeThemeVariant, parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";
import { APP_TARGETS, BUNOS_THEME, generateApps, type AppTarget } from "./apps.ts";
import { generate } from "./generate.ts";
import { TARGETS, type ActiveMode, type GeneratedFile, type Target } from "./types.ts";

export type Exec = (cmd: string[]) => number;

export interface CliResult {
  code: number;
  out: string[];
}

const USAGE = `m3-os-themes <install|generate|uninstall> --target windows|gnome|cosmic|chromium|all --seed <hex> --mode light|dark|auto
  [--name <name>] [--variant tonalSpot|content|fidelity|expressive|vibrant|neutral|monochrome] [--contrast <-1..1>] [--out <dir>]
  [--native-theme <Rust-theme.json>] [--icons <freedesktop theme dir>] [--dry-run] [--apply]
install/uninstall only print the plan unless --apply is given. generate writes into --out (default ./m3-os-themes-out).
m3-os-themes apps [--target css|compose|flutter|cosmic|all] [--seed <hex>] [--root <checkout>] [--check]
  writes the web CSS, Jetpack Compose, Flutter and COSMIC themes from one token source into their consumers.`;

/** `apps`: regenerate (or --check) the app themes in the checkout. */
function appsCommand(flags: Record<string, string | boolean>): CliResult {
  const root = resolve(String(flags["root"] ?? join(import.meta.dir, "..", "..", "..")));
  const t = String(flags["target"] ?? "all");
  if (t !== "all" && !(APP_TARGETS as readonly string[]).includes(t))
    return { code: 2, out: [`unknown app target ${t}`, USAGE] };
  const input = {
    ...BUNOS_THEME,
    ...(typeof flags["seed"] === "string" ? { seed: flags["seed"] } : {}),
    ...(typeof flags["variant"] === "string" ? { variant: flags["variant"] as never } : {}),
    ...(flags["contrast"] !== undefined ? { contrastLevel: Number(flags["contrast"]) } : {}),
  };
  const files = generateApps(input, t === "all" ? APP_TARGETS : [t as AppTarget]);
  const out: string[] = [];
  let code = 0;
  for (const f of files) {
    const p = join(root, f.path);
    let current: string | undefined;
    try {
      current = readFileSync(p, "utf8");
    } catch {}
    if (flags["check"] === true) {
      if (current !== f.content) {
        code = 1;
        out.push(`stale ${f.path}`);
      } else out.push(`ok    ${f.path}`);
      continue;
    }
    if (current === f.content) {
      out.push(`same  ${f.path}`);
      continue;
    }
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
    out.push(`wrote ${f.path}`);
  }
  return { code, out };
}

const defaultExec: Exec = cmd =>
  Bun.spawnSync(cmd, {
    windowsHide: true,
    stdio: ["inherit", "inherit", "inherit"],
  }).exitCode ?? 1;

function parse(argv: string[]): {
  cmd: string;
  flags: Record<string, string | boolean>;
} {
  const [cmd = "", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    if (key === "dry-run" || key === "apply" || key === "help" || key === "check") flags[key] = true;
    else {
      const v = rest[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`--${key} needs a value`);
      flags[key] = v;
    }
  }
  return { cmd, flags };
}

/** The command that applies (or reverts) one target, or null if it has none for this host. */
export function installCommand(
  target: Target,
  outDir: string,
  mode: ActiveMode,
  uninstall: boolean,
  platform = process.platform,
  icons?: string,
): { cmd: string[]; reason?: string } {
  const dir = join(outDir, target);
  switch (target) {
    case "windows":
      if (platform !== "win32")
        return {
          cmd: [],
          reason: "needs a Windows host (run install-windows.ps1 there)",
        };
      return {
        cmd: [
          "powershell.exe",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(dir, "install-windows.ps1"),
          "-Mode",
          mode,
          ...(uninstall ? ["-Uninstall"] : []),
        ],
      };
    case "gnome":
    case "cosmic":
      if (platform !== "linux") return { cmd: [], reason: `needs a Linux ${target} session` };
      return {
        cmd: [
          "bash",
          join(dir, `install-${target}.sh`),
          "--mode",
          mode,
          ...(icons && !uninstall ? ["--icons", icons] : []),
          ...(uninstall ? ["--uninstall"] : []),
        ],
      };
    case "chromium":
      if (platform === "win32")
        return {
          cmd: [],
          reason: "import policies/windows/*.reg as administrator (see install-chromium.md)",
        };
      return {
        cmd: [
          "bash",
          join(dir, "install-chromium.sh"),
          ...(mode === "auto" ? [] : ["--mode", mode]),
          ...(uninstall ? ["--uninstall"] : []),
        ],
      };
  }
}

export function writeFiles(files: GeneratedFile[], outDir: string): void {
  for (const f of files) {
    const p = join(outDir, f.path);
    const inside = relative(resolve(outDir), resolve(p));
    if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new Error(`m3-os-themes: generated path escapes its directory: ${f.path}`);
    let ancestor = resolve(outDir);
    for (const part of inside.split(sep)) {
      ancestor = join(ancestor, part);
      try {
        if (lstatSync(ancestor).isSymbolicLink())
          throw new Error(`m3-os-themes: generated path contains a symlink: ${f.path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
    if (f.executable) chmodSync(p, 0o755);
  }
}

export function run(argv: string[], exec: Exec = defaultExec): CliResult {
  const out: string[] = [];
  const log = (s: string): void => void out.push(s);
  let parsed;
  try {
    parsed = parse(argv);
  } catch (e) {
    return { code: 2, out: [(e as Error).message, USAGE] };
  }
  const { cmd, flags } = parsed;
  if (cmd === "apps") return appsCommand(flags);
  if (!["install", "generate", "uninstall"].includes(cmd) || flags["help"]) return { code: cmd ? 2 : 0, out: [USAGE] };
  const targetFlag = String(flags["target"] ?? "all");
  if (targetFlag !== "all" && !(TARGETS as readonly string[]).includes(targetFlag))
    return { code: 2, out: [`unknown target ${targetFlag}`, USAGE] };
  const targets = targetFlag === "all" ? TARGETS : [targetFlag as Target];
  const mode = String(flags["mode"] ?? "auto") as ActiveMode;
  if (!["light", "dark", "auto"].includes(mode)) return { code: 2, out: [`unknown mode ${mode}`, USAGE] };
  const outDir = resolve(String(flags["out"] ?? "m3-os-themes-out"));
  const apply = flags["apply"] === true && flags["dry-run"] !== true;
  const icons = typeof flags["icons"] === "string" ? resolve(flags["icons"]) : undefined;
  let files: GeneratedFile[];
  try {
    const nativeTheme =
      typeof flags["native-theme"] === "string"
        ? parseNativeThemeExport(JSON.parse(readFileSync(flags["native-theme"], "utf8")))
        : undefined;
    files = generate(
      {
        name: String(flags["name"] ?? "Aphrody"),
        seed: String(flags["seed"] ?? nativeTheme?.seed ?? "#6750a4"),
        variant: (flags["variant"] ?? (nativeTheme && nativeThemeVariant(nativeTheme))) as never,
        contrastLevel: flags["contrast"] === undefined ? (nativeTheme?.contrast_level ?? 0) : Number(flags["contrast"]),
        nativeTheme,
        mode,
      },
      targets,
    );
  } catch (e) {
    return { code: 2, out: [(e as Error).message] };
  }

  if (cmd === "generate") {
    if (flags["dry-run"] === true) {
      for (const f of files) log(`[dry-run] ${join(outDir, f.path)}`);
      return { code: 0, out };
    }
    writeFiles(files, outDir);
    log(`wrote ${files.length} files to ${outDir}`);
    return { code: 0, out };
  }

  const uninstall = cmd === "uninstall";
  let code = 0;
  if (!uninstall && apply) writeFiles(files, outDir);
  else if (!uninstall) log(`[dry-run] would generate ${files.length} files into ${outDir}`);
  else if (apply) writeFiles(files, outDir);
  for (const t of targets) {
    const { cmd: c, reason } = installCommand(t, outDir, mode, uninstall, process.platform, icons);
    if (c.length === 0) {
      log(`${t}: skipped, ${reason}`);
      continue;
    }
    if (!apply) {
      log(`[dry-run] ${t}: ${c.join(" ")}`);
      continue;
    }
    log(`${t}: ${c.join(" ")}`);
    if (exec(c) !== 0) code = 1;
  }
  if (!apply) log("dry-run: nothing was written to the system. Pass --apply to run.");
  return { code, out };
}

/** `m3-os-themes <argv>` (`yolo m3 os-themes <argv>`): prints the report and returns the exit status. */
export function runOsThemes(argv: string[]): number {
  const r = run(argv);
  console.log(r.out.join("\n"));
  return r.code;
}

if (import.meta.main) process.exit(runOsThemes(process.argv.slice(2)));
