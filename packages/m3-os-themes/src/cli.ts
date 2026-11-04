#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// m3-os-themes <install|generate|uninstall> --target windows|gnome|cosmic|chromium|all
//   --seed <hex> --mode light|dark|auto [--name N] [--out DIR] [--variant V] [--dry-run|--apply]
// In the Aphrody checkout: `yolo m3 os-themes ...` (runOsThemes, in-process).
// `generate` writes only into --out. `install`/`uninstall` are dry-run unless --apply (then they run the generated scripts).
import { mkdirSync, writeFileSync, chmodSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { nativeThemeVariant, parseNativeThemeExport, type NativeSchemeVariant } from "@aphrody/m3-tokens/native-theme";
import {
  APP_TARGETS,
  BUNOS_THEME,
  DEFAULT_APP_TARGETS,
  PRODUCT_THEME_PATH,
  generateApps,
  type AppTarget,
} from "./apps.ts";
import { productSeed, rustThemeExport, rustThemeExportJson, validate } from "./color.ts";
import { publishDesign, runDesign, verifyDesign } from "./design.ts";
import { generate } from "./generate.ts";
import { TARGETS, type ActiveMode, type GeneratedFile, type Target } from "./types.ts";

export type Exec = (cmd: string[]) => number;

export interface CliResult {
  code: number;
  out: string[];
}

const USAGE = `m3-os-themes <install|generate|uninstall> --target windows|gnome|cosmic|chromium|all [--seed <hex>] --mode light|dark|auto
  [--name <name>] [--variant tonalSpot|content|fidelity|expressive|vibrant|neutral|monochrome|rainbow|fruitSalad] [--contrast <-1..1>]
  [--out <dir>] [--native-theme <Rust-theme.json>] [--bin <bunos-design>] [--icons <freedesktop theme dir>] [--dry-run] [--apply]
install/uninstall only print the plan unless --apply is given. generate writes into --out (default ./m3-os-themes-out).
Colours are the Rust ThemeExport: --native-theme, else \`bunos-design theme\` for --seed/--variant/--contrast, else the
committed product export (generated/theme/bunos-m3.json).
m3-os-themes generate --check | --update   checks (or rewrites) the product OS bundle in packages/m3-os-themes/generated/os.
m3-os-themes native-theme [--bin <bunos-design>] [--check]   refreshes (or checks) generated/theme/bunos-m3.json from the
  product seed (aphrody_identity::design::pet_seed_hex) through bunos-design.
m3-os-themes apps [--target css|compose|flutter|cosmic|desktop|all] [--seed <hex>] [--bin <bunos-design>] [--root <checkout>] [--check]
  writes the web CSS, Jetpack Compose + Android resources, Flutter and COSMIC themes from one token source into their
  consumers (all = every target but desktop, whose factory/ copy has its own owner).
m3-os-themes design --out <dir> [--wallpaper <svg|png>] [--seed <hex>] [--bin <bunos-design>] [--no-dll] [--no-catalogue]
  the full design artifact (themes, window chrome, icons, fonts, receipt); m3-os-themes verify --dir <dir> checks its receipt; m3-os-themes publish --dir <dir> [--root ~/apps/cdn/design] serves it at cdn.aphrody.com/s/design/.`;

/** `design`: the end-to-end design artifact (design.ts). */
function designCommand(flags: Record<string, string | boolean>): CliResult {
  try {
    const out = runDesign({
      out: resolve(String(flags["out"] ?? "bunos-design-out")),
      wallpaper: typeof flags["wallpaper"] === "string" ? flags["wallpaper"] : undefined,
      seed: typeof flags["seed"] === "string" ? flags["seed"] : undefined,
      bin: String(flags["bin"] ?? "bunos-design"),
      dll: flags["no-dll"] !== true,
      catalogue: flags["no-catalogue"] !== true,
    });
    return { code: out.some(l => l.startsWith("CHECK FAILED")) ? 1 : 0, out };
  } catch (e) {
    return { code: 1, out: [(e as Error).message] };
  }
}

const PACKAGE_ROOT = join(import.meta.dir, "..");
/** The committed OS bundle of the product theme (`generate --check` / `--update`). */
export const PRODUCT_OS_DIR = join(PACKAGE_ROOT, "generated", "os");

/**
 * The theme input for a command: the committed product export unless the flags ask for another seed, variant or
 * contrast, which the Rust owner then computes (`--native-theme` file, else `bunos-design theme`).
 */
export function themeInput(flags: Record<string, string | boolean>, name: string, mode: ActiveMode = "auto") {
  if (typeof flags["native-theme"] === "string") {
    const nativeTheme = parseNativeThemeExport(JSON.parse(readFileSync(flags["native-theme"], "utf8")));
    return {
      name,
      seed: String(flags["seed"] ?? nativeTheme.seed),
      variant: (flags["variant"] ?? nativeThemeVariant(nativeTheme)) as NativeSchemeVariant,
      contrastLevel: flags["contrast"] === undefined ? nativeTheme.contrast_level : Number(flags["contrast"]),
      nativeTheme,
      mode,
    };
  }
  if (flags["seed"] === undefined && flags["variant"] === undefined && flags["contrast"] === undefined)
    return { ...BUNOS_THEME, name, mode };
  const seed = String(flags["seed"] ?? BUNOS_THEME.seed);
  const variant = String(flags["variant"] ?? "tonalSpot") as NativeSchemeVariant;
  const contrastLevel = flags["contrast"] === undefined ? 0 : Number(flags["contrast"]);
  const input = { name, seed, variant, contrastLevel, mode };
  const normalized = validate(input);
  const bin = typeof flags["bin"] === "string" ? flags["bin"] : undefined;
  return { ...input, seed: normalized, nativeTheme: rustThemeExport(normalized, variant, contrastLevel, bin) };
}

/** Every file under `dir`, relative and `/`-separated (its own .gitattributes excluded). */
function listFiles(dir: string, base = dir): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap(e =>
    e.isDirectory()
      ? listFiles(join(dir, e.name), base)
      : e.name === ".gitattributes"
        ? []
        : [relative(base, join(dir, e.name)).split(sep).join("/")],
  );
}

const same = (a: string | Uint8Array, b: Uint8Array): boolean =>
  Buffer.compare(Buffer.from(typeof a === "string" ? new TextEncoder().encode(a) : a), Buffer.from(b)) === 0;

/** `generate --check` / `--update`: the product OS bundle (all targets, mode auto) against generated/os. */
function productBundleCommand(flags: Record<string, string | boolean>): CliResult {
  const dir = resolve(String(flags["out"] ?? PRODUCT_OS_DIR));
  let files: GeneratedFile[];
  try {
    files = generate(themeInput(flags, String(flags["name"] ?? BUNOS_THEME.name)));
  } catch (e) {
    return { code: 2, out: [(e as Error).message] };
  }
  if (flags["update"] === true) {
    writeFiles(files, dir);
    const keep = new Set(files.map(f => f.path));
    const stale = listFiles(dir).filter(f => !keep.has(f));
    for (const f of stale) rmSync(join(dir, f));
    return { code: 0, out: [`wrote ${files.length} files to ${dir}`, ...stale.map(f => `removed ${f}`)] };
  }
  const out: string[] = [];
  let code = 0;
  const expected = new Set<string>();
  for (const f of files) {
    expected.add(f.path);
    let current: Uint8Array | undefined;
    try {
      current = readFileSync(join(dir, f.path));
    } catch {}
    if (current === undefined || !same(f.content, current)) {
      code = 1;
      out.push(`stale ${f.path}`);
    }
  }
  for (const f of listFiles(dir))
    if (!expected.has(f)) {
      code = 1;
      out.push(`extra ${f}`);
    }
  out.push(
    code === 0
      ? `ok    ${files.length} files in ${relative(process.cwd(), dir) || "."}`
      : "run: bun packages/m3-os-themes/src/cli.ts generate --update",
  );
  return { code, out };
}

/** `native-theme`: refresh (or --check) the committed Rust ThemeExport of the product seed. */
function nativeThemeCommand(flags: Record<string, string | boolean>): CliResult {
  try {
    const json = rustThemeExportJson(
      productSeed(),
      "tonalSpot",
      0,
      typeof flags["bin"] === "string" ? flags["bin"] : undefined,
    );
    parseNativeThemeExport(JSON.parse(json));
    let current: string | undefined;
    try {
      current = readFileSync(PRODUCT_THEME_PATH, "utf8");
    } catch {}
    if (flags["check"] === true)
      return current === json
        ? { code: 0, out: [`ok    ${PRODUCT_THEME_PATH}`] }
        : { code: 1, out: [`stale ${PRODUCT_THEME_PATH}`] };
    mkdirSync(dirname(PRODUCT_THEME_PATH), { recursive: true });
    writeFileSync(PRODUCT_THEME_PATH, json);
    return { code: 0, out: [`${current === json ? "same " : "wrote"} ${PRODUCT_THEME_PATH}`] };
  } catch (e) {
    return { code: 1, out: [(e as Error).message] };
  }
}

/** `apps`: regenerate (or --check) the app themes in the checkout. */
function appsCommand(flags: Record<string, string | boolean>): CliResult {
  const root = resolve(String(flags["root"] ?? join(import.meta.dir, "..", "..", "..")));
  const t = String(flags["target"] ?? "all");
  if (t !== "all" && !(APP_TARGETS as readonly string[]).includes(t))
    return { code: 2, out: [`unknown app target ${t}`, USAGE] };
  let files;
  try {
    files = generateApps(themeInput(flags, BUNOS_THEME.name), t === "all" ? DEFAULT_APP_TARGETS : [t as AppTarget]);
  } catch (e) {
    return { code: 2, out: [(e as Error).message] };
  }
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
    if (["dry-run", "apply", "help", "check", "update", "no-dll", "no-catalogue"].includes(key)) flags[key] = true;
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
    case "hyprland":
      if (platform !== "linux")
        return {
          cmd: [],
          reason: "needs a Linux host running Hyprland compositor",
        };
      return {
        cmd: [
          "bash",
          "-c",
          `mkdir -p ~/.config/hypr/themes ~/.config/waybar/themes ~/.config/fuzzel/themes && cp -r "${dir}"/* ~/.config/`,
        ],
      };
    case "gtk":
      if (platform !== "linux") return { cmd: [], reason: "needs a Linux GTK session" };
      return {
        cmd: [
          "bash",
          join(dir, "install-gnome.sh"),
          "--mode",
          mode,
          ...(icons && !uninstall ? ["--icons", icons] : []),
          ...(uninstall ? ["--uninstall"] : []),
        ],
      };
    case "iced":
      return {
        cmd: [],
        reason: "copy iced/themes/*.ron into your Iced application directory or COSMIC config",
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
  if (cmd === "native-theme") return nativeThemeCommand(flags);
  if (cmd === "generate" && (flags["check"] === true || flags["update"] === true)) return productBundleCommand(flags);
  if (cmd === "design") return designCommand(flags);
  if (cmd === "publish") {
    try {
      const dir = resolve(String(flags["dir"] ?? "."));
      return {
        code: 0,
        out: [publishDesign(dir, resolve(String(flags["root"] ?? join(process.env["HOME"] ?? "", "apps/cdn/design"))))],
      };
    } catch (e) {
      return { code: 1, out: [(e as Error).message] };
    }
  }
  if (cmd === "verify") {
    const dir = resolve(String(flags["dir"] ?? flags["out"] ?? "."));
    const bad = verifyDesign(dir);
    return { code: bad.length ? 1 : 0, out: bad.length ? bad.map(p => `mismatch ${p}`) : [`receipt ok: ${dir}`] };
  }
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
    files = generate(themeInput(flags, String(flags["name"] ?? "Aphrody"), mode), targets);
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
