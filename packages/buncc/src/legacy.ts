/**
 * `buncc posix uninstall <msys2|mingw|gnuwin32|cygwin|all>`: remove the old POSIX-on-Windows stacks once the pinned
 * replacements work. DRY RUN by default. Detection is read-only. Execution needs `--yes`, a passing smoke test of the
 * replacements, and a backup written first. Only paths found by detection are ever touched; Git for Windows is protected.
 *
 * The machine is reached through `LegacyHost`, so the tests run on fake directories and a simulated registry.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { run } from "./process.ts";

export type LegacyId = "msys2" | "mingw" | "gnuwin32" | "cygwin";
export const LEGACY_IDS: LegacyId[] = ["msys2", "mingw", "gnuwin32", "cygwin"];
export type InstallMode = "installer" | "winget" | "scoop" | "chocolatey" | "portable";

export interface UninstallEntry {
  /** Registry key path (HKLM\...\Uninstall\<id>). */
  key: string;
  DisplayName?: string;
  DisplayVersion?: string;
  InstallLocation?: string;
  UninstallString?: string;
  Publisher?: string;
}

export interface LegacyHost {
  env: Record<string, string | undefined>;
  exists(path: string): boolean;
  isDir(path: string): boolean;
  list(path: string): string[];
  readText(path: string): string | undefined;
  /** Add/Remove Programs entries (HKLM, HKLM WOW6432Node, HKCU). */
  uninstallEntries(): Promise<UninstallEntry[]>;
  /** Registry values by full key, e.g. HKLM\SOFTWARE\Cygwin\setup -> { rootdir }. */
  regValues(key: string): Promise<Record<string, string> | undefined>;
  /** Persistent (registry) PATH, not the process one. */
  persistentPath(): Promise<{ user: string; machine: string }>;
  /** Run a command (backup and uninstall steps). */
  exec(
    argv: string[],
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  /** Does this registry key exist? (`reg query`; false also when it cannot be read.) */
  regKeyExists(key: string): Promise<boolean>;
  /** Is the process elevated (high integrity token)? buncc never tries to elevate itself. */
  isElevated(): Promise<boolean>;
  removeDir(path: string): void;
  writeFile(path: string, text: string): void;
  /** Absolute paths of the files that may reference an install (editor and terminal settings, cargo config). */
  configFiles(): string[];
}

export interface LegacyInstall {
  id: LegacyId;
  mode: InstallMode;
  root: string;
  version?: string;
  uninstaller?: string[];
  /** One per registered product (GnuWin32 registers one uninstaller per package). */
  uninstallers: string[][];
  /** Registry key of the product each uninstaller belongs to (same index); used to verify removal. */
  uninstallerKeys: (string | undefined)[];
  /** Scoop installs: app name, global (-g, needs admin) or per user. */
  scoop?: { app: string; global: boolean; appDir: string };
  registryKeys: string[];
  pathEntries: { scope: "user" | "machine" | "process"; value: string }[];
  shortcuts: string[];
  /** Things outside the root that point into it. */
  dependents: string[];
  notes: string[];
}

const lower = (s: string) => s.toLowerCase().replace(/\//g, "\\");
const within = (root: string, p: string) => {
  const r = lower(root).replace(/\\+$/, "");
  const q = lower(p).replace(/\\+$/, "");
  return q === r || q.startsWith(r + "\\");
};

/** Install location of Git for Windows and every directory that must never be removed. */
export async function protectedRoots(host: LegacyHost): Promise<string[]> {
  const roots = new Set<string>();
  const reg = await host.regValues("HKLM\\SOFTWARE\\GitForWindows");
  if (reg?.InstallPath) roots.add(reg.InstallPath);
  const pf = [host.env.ProgramFiles, host.env["ProgramFiles(x86)"], host.env.ProgramW6432].filter(Boolean) as string[];
  for (const p of pf) roots.add(join(p, "Git"));
  const local = host.env.LOCALAPPDATA;
  if (local) roots.add(join(local, "Programs", "Git"));
  for (const root of [...roots]) if (!host.exists(root)) roots.delete(root);
  return [...roots];
}

/** Is `candidate` Git for Windows, inside it, or does it contain it? Containing counts: never remove a parent of Git. */
export function touchesProtected(candidate: string, protectedList: string[]): string | undefined {
  return protectedList.find(p => within(p, candidate) || within(candidate, p));
}

interface Finder {
  names: RegExp;
  roots(env: LegacyHost["env"]): string[];
  marker(root: string, host: LegacyHost): boolean;
}

/** winget package ids (winget-pkgs manifests, checked with gh api). Empty: no winget package exists for it. */
export const WINGET_IDS: Record<LegacyId, string[]> = {
  msys2: ["MSYS2.MSYS2"],
  cygwin: ["Cygwin.Cygwin"],
  mingw: ["BrechtSanders.WinLibs.POSIX.UCRT", "BrechtSanders.WinLibs.POSIX.MSVCRT", "BrechtSanders.WinLibs.MCF.UCRT"],
  gnuwin32: [],
};

/** Scoop roots: per user ($env:SCOOP or %USERPROFILE%\scoop) and global ($env:SCOOP_GLOBAL or %ProgramData%\scoop). */
export function scoopBases(env: Record<string, string | undefined>): { dir: string; global: boolean }[] {
  const out: { dir: string; global: boolean }[] = [];
  const add = (dir: string | undefined, global: boolean) => {
    if (dir && !out.some(o => lower(o.dir) === lower(dir))) out.push({ dir, global });
  };
  add(env.SCOOP, false);
  add(join(env.USERPROFILE ?? "", "scoop"), false);
  add(env.SCOOP_GLOBAL, true);
  add(join(env.ProgramData ?? "C:\\ProgramData", "scoop"), true);
  return out;
}
const scoopAppRoots = (env: Record<string, string | undefined>, app: string, ...rest: string[]) =>
  scoopBases(env).map(b => join(b.dir, "apps", app, "current", ...rest));

/** Is `root` inside a Scoop apps directory? Which app, and is it a global install? */
export function scoopInfo(
  root: string,
  env: Record<string, string | undefined>,
): { app: string; global: boolean; appDir: string } | undefined {
  for (const b of scoopBases(env)) {
    const apps = join(b.dir, "apps");
    if (within(apps, root) && lower(root) !== lower(apps)) {
      const app = root.replace(/[\\/]+$/, "").slice(apps.replace(/[\\/]+$/, "").length + 1).split(/[\\/]/)[0]!;
      return { app, global: b.global, appDir: join(apps, app) };
    }
  }
  const m = /^(.*\\scoop\\apps\\([^\\]+))/i.exec(root.replace(/\//g, "\\"));
  return m ? { app: m[2]!, global: false, appDir: m[1]! } : undefined;
}

const finders: Record<LegacyId, Finder> = {
  msys2: {
    names: /^msys2\b/i,
    roots: env => [
      env.MSYS2_ROOT ?? "",
      "C:\\msys64",
      "C:\\msys32",
      ...scoopAppRoots(env, "msys2"),
      join(env.ChocolateyInstall ?? "C:\\ProgramData\\chocolatey", "lib", "msys2", "tools", "msys64"),
      "C:\\tools\\msys64",
    ],
    marker: (r, h) => h.exists(join(r, "usr", "bin", "msys-2.0.dll")) || h.exists(join(r, "usr", "bin", "pacman.exe")),
  },
  mingw: {
    // mingw.org (MinGW/MSYS 1.0, mingw-get) and standalone mingw-w64 distributions; the mingw64/ucrt64 trees inside MSYS2 belong to msys2.
    names: /^(mingw(?!-w64 for msys)|mingw-w64|winlibs|w64devkit)/i,
    roots: env => [
      "C:\\MinGW",
      "C:\\MinGW64",
      "C:\\mingw64",
      "C:\\mingw32",
      "C:\\w64devkit",
      env.W64DEVKIT_HOME ?? "",
      env.WINLIBS_HOME ?? "",
      ...scoopAppRoots(env, "mingw"),
      ...scoopAppRoots(env, "w64devkit"),
      join(env.ChocolateyInstall ?? "C:\\ProgramData\\chocolatey", "lib", "mingw", "tools", "install", "mingw64"),
    ],
    marker: (r, h) =>
      h.exists(join(r, "bin", "gcc.exe")) ||
      h.exists(join(r, "bin", "mingw32-make.exe")) ||
      h.exists(join(r, "bin", "mingw-get.exe")),
  },
  gnuwin32: {
    names: /gnuwin32/i,
    roots: env => [
      join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "GnuWin32"),
      join(env.ProgramFiles ?? "C:\\Program Files", "GnuWin32"),
      "C:\\GnuWin32",
      ...scoopAppRoots(env, "gnuwin32"),
    ],
    marker: (r, h) =>
      h.isDir(join(r, "bin")) &&
      (h.exists(join(r, "bin", "grep.exe")) ||
        h.exists(join(r, "bin", "sed.exe")) ||
        h.exists(join(r, "bin", "ls.exe")) ||
        h.list(join(r, "bin")).length > 0),
  },
  cygwin: {
    names: /^cygwin\b/i,
    roots: env => [
      "C:\\cygwin64",
      "C:\\cygwin",
      ...scoopAppRoots(env, "cygwin", "root"),
    ],
    marker: (r, h) => h.exists(join(r, "bin", "cygwin1.dll")) || h.exists(join(r, "bin", "bash.exe")),
  },
};

function modeOf(
  root: string,
  entry: UninstallEntry | undefined,
  host: LegacyHost,
): { mode: InstallMode; uninstaller?: string[]; note?: string } {
  const r = lower(root);
  if (scoopInfo(root, host.env)) return { mode: "scoop" };
  if (r.includes("\\chocolatey\\") || r.startsWith("c:\\tools\\")) return { mode: "chocolatey" };
  if (entry?.UninstallString) {
    const cmd = entry.UninstallString;
    if (/winget/i.test(cmd) || /Winget/.test(entry.key)) return { mode: "winget" };
    const exe = /^"([^"]+)"/.exec(cmd)?.[1] ?? cmd.split(/\s+(?=\/|-)/)[0]!;
    return {
      mode: "installer",
      uninstaller: [
        exe,
        ...(/\/|-/.test(cmd.slice(exe.length)) ? cmd.slice(exe.length).trim().split(/\s+/).filter(Boolean) : []),
      ],
    };
  }
  const uninstallExe = ["uninstall.exe", "unins000.exe", "uninst.exe"]
    .map(n => join(root, n))
    .find(p => host.exists(p));
  if (uninstallExe) return { mode: "installer", uninstaller: [uninstallExe] };
  return { mode: "portable" };
}

/** Read-only detection of every install of `id`. */
export async function detectLegacy(id: LegacyId, host: LegacyHost): Promise<LegacyInstall[]> {
  const finder = finders[id];
  const entries = await host.uninstallEntries();
  const roots = new Map<string, { root: string; entries: UninstallEntry[] }>();
  const trim = (p: string) => p.replace(/[\\/]+$/, "");
  const norm = (p: string) => lower(trim(p));
  const addRoot = (root: string, entry?: UninstallEntry) => {
    const k = norm(root);
    const have = roots.get(k) ?? { root: trim(root), entries: [] };
    if (entry) have.entries.push(entry);
    roots.set(k, have);
  };
  for (const e of entries) {
    if (e.DisplayName && finder.names.test(e.DisplayName) && !(id === "mingw" && /msys2/i.test(e.DisplayName))) {
      const loc =
        e.InstallLocation || (e.UninstallString ? dirname(/^"?([^"]+?\.exe)/i.exec(e.UninstallString)?.[1] ?? "") : "");
      if (loc && host.exists(loc)) addRoot(loc, e);
    }
  }
  for (const candidate of finder.roots(host.env))
    if (candidate && host.exists(candidate) && finder.marker(candidate, host)) addRoot(candidate);
  if (id === "cygwin") {
    const reg = await host.regValues("HKLM\\SOFTWARE\\Cygwin\\setup");
    if (reg?.rootdir && host.exists(reg.rootdir)) addRoot(reg.rootdir);
  }
  const persistent = await host.persistentPath();
  const out: LegacyInstall[] = [];
  const protectedList = await protectedRoots(host);
  const configs = host.configFiles();
  for (const { root, entries: found } of roots.values()) {
    const entry = found.find(e => e.UninstallString) ?? found[0];
    const m = modeOf(root, entry, host);
    const uninstallers: string[][] = [];
    const uninstallerKeys: (string | undefined)[] = [];
    for (const e of found) {
      const u = e.UninstallString ? modeOf(root, e, host).uninstaller : undefined;
      if (u && !uninstallers.some(x => x.join(" ") === u.join(" "))) {
        uninstallers.push(u);
        uninstallerKeys.push(e.key);
      }
    }
    if (!uninstallers.length && m.uninstaller) {
      uninstallers.push(m.uninstaller);
      uninstallerKeys.push(undefined);
    }
    const notes: string[] = [];
    if (touchesProtected(root, protectedList)) {
      notes.push(
        `PROTECTED: overlaps Git for Windows (${touchesProtected(root, protectedList)}); excluded from removal`,
      );
    }
    const pathEntries: LegacyInstall["pathEntries"] = [];
    const scan = (scope: "user" | "machine" | "process", value: string | undefined) => {
      for (const part of (value ?? "").split(delimiter).filter(Boolean))
        if (within(root, part)) pathEntries.push({ scope, value: part });
    };
    scan("user", persistent.user);
    scan("machine", persistent.machine);
    const procPath = host.env.PATH ?? host.env.Path;
    scan("process", procPath);
    const dependents: string[] = [];
    for (const file of configs) {
      const text = host.readText(file);
      if (text && lower(text).replace(/\\\\/g, "\\").includes(lower(root)))
        dependents.push(`${file} references ${root}`);
    }
    if (id === "msys2") {
      const home = join(root, "home");
      if (host.isDir(home))
        notes.push(
          `user data: ${
            host
              .list(home)
              .map(h => join(home, h))
              .join(", ") || home
          } (dotfiles are backed up; the rest is deleted with the root)`,
        );
      if (host.exists(join(root, "var", "lib", "pacman", "local")))
        notes.push("pacman state: var/lib/pacman (package list is exported before removal)");
      dependents.push(
        "Rust toolchains named *-pc-windows-gnu use <root>\\ucrt64|mingw64 gcc: check `rustup toolchain list` (use gnullvm via buncc mingw)",
      );
    }
    if (id === "cygwin")
      notes.push(
        "Cygwin ships no uninstaller: removal is the folder, the HKLM\\SOFTWARE\\Cygwin key, shortcuts and PATH",
      );
    const shortcuts = shortcutsFor(id, host);
    const registryKeys = [
      ...found.map(e => e.key),
      ...(id === "cygwin" ? ["HKLM\\SOFTWARE\\Cygwin", "HKCU\\Software\\Cygwin"] : []),
    ].filter((k): k is string => !!k);
    out.push({
      id,
      mode: m.mode,
      root,
      version: entry?.DisplayVersion,
      scoop: m.mode === "scoop" ? scoopInfo(root, host.env) : undefined,
      uninstaller: uninstallers[0],
      uninstallers,
      uninstallerKeys,
      registryKeys,
      pathEntries,
      shortcuts,
      dependents,
      notes,
    });
  }
  return out;
}

function shortcutsFor(id: LegacyId, host: LegacyHost): string[] {
  const bases = [
    join(host.env.ProgramData ?? "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    join(host.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs"),
    host.env.USERPROFILE ? join(host.env.USERPROFILE, "Desktop") : "",
  ].filter(Boolean);
  const re = { msys2: /^msys2/i, mingw: /^(mingw|w64devkit|winlibs)/i, gnuwin32: /gnuwin32/i, cygwin: /^cygwin/i }[id];
  const out: string[] = [];
  for (const base of bases) {
    if (!host.isDir(base)) continue;
    for (const name of host.list(base)) if (re.test(name)) out.push(join(base, name));
  }
  return out;
}

/** Inno Setup writes its uninstall key as <AppId>_is1 and its uninstaller as unins000.exe, unins001.exe, ... */
export function isInnoUninstaller(exe: string, key?: string): boolean {
  return /unins\d{3}\.exe$/i.test(exe) || /_is1$/i.test(key ?? "");
}
/** Documented Inno Setup uninstaller switches (jrsoftware.org/ishelp, "Uninstaller Command Line Parameters"). */
export const INNO_SILENT = ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"];
const UNINSTALL_TIMEOUT_MS = 300_000;

/** Paths and keys a non-elevated process cannot change: HKLM, Program Files, Windows, machine PATH. */
export function needsElevation(kind: StepKind, target: string | undefined): boolean {
  if (!target) return false;
  const t = lower(target);
  if (kind === "path") return false;
  if (/^hklm\\/.test(t) || /^hkey_local_machine\\/.test(t)) return true;
  return /^[a-z]:\\(program files|program files \(x86\)|windows)(\\|$)/.test(t);
}

export type StepKind =
  | "backup"
  | "gate"
  | "uninstaller"
  | "scoop"
  | "winget"
  | "chocolatey"
  | "path"
  | "registry"
  | "shortcut"
  | "delete-dir";
export interface PlanStep {
  kind: StepKind;
  title: string;
  command?: string[];
  /** Path the step deletes or writes. */
  path?: string;
  install?: LegacyId;
  /** The step changes something only an elevated process can change. */
  needsElevation?: boolean;
  /** How the effect is checked after the step. A step is "done" only when this holds. */
  verify?: {
    kind: "reg-gone" | "path-gone" | "path-exists" | "path-entry-gone" | "winget-gone";
    target: string;
    scope?: "user" | "machine";
  };
  timeoutMs?: number;
  /** Run first; a non-zero exit means the step does not apply (e.g. the package is not installed) and it is skipped. */
  precheck?: string[];
}
export interface UninstallPlan {
  installs: LegacyInstall[];
  protected: string[];
  steps: PlanStep[];
  backupDir: string;
  /** Was the planning process elevated? */
  elevated: boolean;
  rollback: string[];
  warnings: string[];
}

/** Commands that read the state needed for rollback. Run before anything is removed. */
function backupSteps(installs: LegacyInstall[], backupDir: string): PlanStep[] {
  const steps: PlanStep[] = [
    { kind: "backup", title: "save the persistent user and machine PATH", path: join(backupDir, "path.json") },
  ];
  for (const i of installs) {
    if (i.id === "msys2") {
      steps.push(
        {
          kind: "backup",
          title: "export installed MSYS2 packages (explicit)",
          path: join(backupDir, "msys2-pacman-Qe.txt"),
          command: [join(i.root, "usr", "bin", "pacman.exe"), "-Qqe"],
        },
        {
          kind: "backup",
          title: "export installed MSYS2 packages (foreign/AUR-style)",
          path: join(backupDir, "msys2-pacman-Qm.txt"),
          command: [join(i.root, "usr", "bin", "pacman.exe"), "-Qqm"],
        },
        {
          kind: "backup",
          title: "copy dotfiles of MSYS2 homes (no caches)",
          path: join(backupDir, "msys2-home"),
          command: [
            "robocopy",
            join(i.root, "home"),
            join(backupDir, "msys2-home"),
            "/E",
            "/XD",
            ".cache",
            "/XF",
            "*.tmp",
          ],
        },
        {
          kind: "backup",
          title: "save pacman.conf and mirrorlists",
          path: join(backupDir, "msys2-etc"),
          command: ["robocopy", join(i.root, "etc", "pacman.d"), join(backupDir, "msys2-etc", "pacman.d"), "/E"],
        },
      );
    }
    if (i.id === "cygwin")
      steps.push({
        kind: "backup",
        title: "export Cygwin package list",
        path: join(backupDir, "cygwin-packages.txt"),
        command: [join(i.root, "bin", "cygcheck.exe"), "-c"],
      });
    for (const key of i.registryKeys)
      steps.push({
        kind: "backup",
        title: `export registry key ${key}`,
        path: join(backupDir, `reg-${i.id}-${basename(key).replace(/\W+/g, "_")}.reg`),
        command: ["reg", "export", key, join(backupDir, `reg-${i.id}-${basename(key).replace(/\W+/g, "_")}.reg`), "/y"],
      });
  }
  return steps;
}

export function planUninstall(
  installs: LegacyInstall[],
  protectedList: string[],
  backupDir: string,
  elevated = false,
  options: { purge?: boolean } = {},
): UninstallPlan {
  const warnings: string[] = [];
  const removable = installs.filter(i => {
    const hit = touchesProtected(i.root, protectedList);
    if (hit) warnings.push(`${i.id} at ${i.root} overlaps protected ${hit}: skipped`);
    return !hit;
  });
  const steps: PlanStep[] = [...backupSteps(removable, backupDir)];
  const gates = new Set(removable.map(i => i.id));
  steps.push({
    kind: "gate",
    title: `smoke-test the replacements (posix shims${gates.has("msys2") || gates.has("mingw") ? ", mingw compile+link" : ""}, buncc sh) before any removal`,
    command: ["buncc", "posix", "smoke", ...(gates.has("msys2") || gates.has("mingw") ? ["--mingw"] : [])],
  });
  for (const i of removable) {
    if (i.mode === "scoop") {
      const sc = i.scoop ?? { app: basename(dirname(i.root)), global: false, appDir: i.root };
      steps.push({
        kind: "scoop",
        title: `scoop uninstall ${sc.app}${sc.global ? " -g (global install)" : ""}${options.purge ? " --purge (also deletes persisted data)" : ""}`,
        command: ["scoop", "uninstall", sc.app, ...(sc.global ? ["-g"] : []), ...(options.purge ? ["--purge"] : [])],
        install: i.id,
        needsElevation: sc.global,
        verify: { kind: "path-gone", target: sc.appDir },
      });
    } else if (i.mode === "winget") {
      const ids = WINGET_IDS[i.id];
      if (!ids.length) warnings.push(`${i.id}: no winget package id is known; the winget uninstall step was not planned`);
      for (const id of ids)
        steps.push({
          kind: "winget",
          title: `winget uninstall ${id} (only if \`winget list --id ${id}\` finds it)`,
          precheck: ["winget", "list", "--id", id, "--exact", "--source", "winget", "--disable-interactivity", "--accept-source-agreements"],
          command: ["winget", "uninstall", "--id", id, "--exact", "--source", "winget", "--silent", "--disable-interactivity", "--accept-source-agreements"],
          install: i.id,
          needsElevation: needsElevation("winget", i.root),
          verify: { kind: "winget-gone", target: id },
        });
    }
    else if (i.mode === "chocolatey")
      steps.push({
        kind: "chocolatey",
        title: `choco uninstall ${i.id}`,
        command: ["choco", "uninstall", i.id, "-y"],
        install: i.id,
      });
    else if (i.mode === "installer")
      i.uninstallers.forEach((uninstaller, n) => {
        const exe = uninstaller[0]!;
        const key = i.uninstallerKeys?.[n];
        const inno = i.id !== "msys2" && isInnoUninstaller(exe, key);
        const command =
          i.id === "msys2" ? [...uninstaller, "pr", "--confirm-command"] : inno ? [exe, ...INNO_SILENT] : uninstaller;
        const title =
          i.id === "msys2"
            ? "run the MSYS2 installer uninstaller (Qt IFW command line, unattended)"
            : inno
              ? `run the Inno Setup uninstaller silently (${INNO_SILENT.join(" ")}, waits up to ${UNINSTALL_TIMEOUT_MS / 1000}s for the effect)`
              : "run the registered uninstaller exactly as Windows records it (interactive; no silent flag is assumed)";
        steps.push({
          kind: "uninstaller",
          title,
          command,
          install: i.id,
          path: exe,
          timeoutMs: UNINSTALL_TIMEOUT_MS,
          needsElevation: needsElevation("uninstaller", exe) || needsElevation("registry", key),
          verify: key ? { kind: "reg-gone", target: key } : { kind: "path-gone", target: exe },
        });
      });
    for (const e of i.pathEntries.filter(e => e.scope !== "process"))
      steps.push({
        kind: "path",
        title: `remove ${e.scope} PATH entry ${e.value}`,
        path: e.value,
        needsElevation: e.scope === "machine",
        verify: { kind: "path-entry-gone", target: e.value, scope: e.scope as "user" | "machine" },
        command: [
          "powershell",
          "-NoProfile",
          "-Command",
          `$s='${e.scope === "user" ? "User" : "Machine"}';$p=[Environment]::GetEnvironmentVariable('Path',$s) -split ';' | Where-Object { $_ -and ($_ -ne '${e.value}') };[Environment]::SetEnvironmentVariable('Path',($p -join ';'),$s)`,
        ],
        install: i.id,
      });
    for (const key of i.registryKeys)
      steps.push({
        kind: "registry",
        title: `delete registry key ${key}`,
        path: key,
        command: ["reg", "delete", key, "/f"],
        install: i.id,
        needsElevation: needsElevation("registry", key),
        verify: { kind: "reg-gone", target: key },
      });
    for (const s of i.shortcuts)
      steps.push({
        kind: "shortcut",
        title: `delete shortcut ${s}`,
        path: s,
        install: i.id,
        needsElevation: needsElevation("shortcut", s),
        verify: { kind: "path-gone", target: s },
      });
    steps.push({
      kind: "delete-dir",
      title: `delete the folder ${i.root} (what the uninstaller leaves behind; only this detected path)`,
      path: i.root,
      install: i.id,
      needsElevation: needsElevation("delete-dir", i.root),
      verify: { kind: "path-gone", target: i.root },
    });
  }
  const rollback = [
    `PATH: read ${join(backupDir, "path.json")} and set it back: [Environment]::SetEnvironmentVariable('Path', <user>, 'User') (machine: elevated)`,
    ...(removable.some(i => i.id === "msys2")
      ? [
          "MSYS2: reinstall with `winget install MSYS2.MSYS2` or buncc env msys2 --ensure, then `pacman -S --needed - < msys2-pacman-Qe.txt`, copy msys2-home back to <root>\\home, restore msys2-etc\\pacman.d",
        ]
      : []),
    ...(removable.some(i => i.id === "cygwin")
      ? ["Cygwin: run setup-x86_64.exe and select the packages listed in cygwin-packages.txt"]
      : []),
    "Registry: `reg import <file>.reg` for each reg-*.reg in the backup directory",
    "Replacements stay installed under the buncc cache; they never conflict with the old stacks",
  ];
  return { installs: removable, protected: protectedList, steps, backupDir, elevated, rollback, warnings };
}

export function renderPlan(plan: UninstallPlan, yes: boolean): string {
  const l: string[] = [];
  l.push(yes ? "UNINSTALL (executing)" : "UNINSTALL DRY RUN: nothing is changed. Re-run with --yes after reviewing.");
  l.push(`backup directory: ${plan.backupDir}`);
  const elevSteps = plan.steps.filter(s => s.needsElevation);
  l.push(`elevated: ${plan.elevated ? "yes" : "no"}`);
  if (!plan.elevated && elevSteps.length)
    l.push(
      `needs elevation: ${elevSteps.length} step(s) below change HKLM or Program Files. buncc never elevates itself: it stops at the first one without marking it done. Re-run from an elevated shell.`,
    );
  l.push(`protected (never touched): ${plan.protected.join("; ") || "none found"}`);
  for (const w of plan.warnings) l.push(`warning: ${w}`);
  for (const i of plan.installs) {
    l.push("", `[${i.id}] ${i.root}  mode=${i.mode}${i.version ? `  version=${i.version}` : ""}`);
    for (const e of i.pathEntries) l.push(`  PATH(${e.scope}): ${e.value}`);
    for (const k of i.registryKeys) l.push(`  registry: ${k}`);
    for (const s of i.shortcuts) l.push(`  shortcut: ${s}`);
    for (const d of i.dependents) l.push(`  depends: ${d}`);
    for (const n of i.notes) l.push(`  note: ${n}`);
  }
  l.push("", "steps:");
  plan.steps.forEach((s, n) =>
    l.push(
      `  ${String(n + 1).padStart(2)}. [${s.kind}] ${s.title}${s.needsElevation && !plan.elevated ? "  [needs elevation]" : ""}${s.command ? `\n        ${s.command.join(" ")}` : ""}`,
    ),
  );
  l.push("", "rollback:", ...plan.rollback.map(r => `  - ${r}`));
  return l.join("\n");
}

export interface SmokeResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Real smoke test: the replacements answer. Each probe is one tool run through the shim directory. */
export async function smokeReplacements(
  need: { posix: boolean; mingw: boolean },
  exec: LegacyHost["exec"],
  shimDir: string | undefined,
  mingwBin?: string,
): Promise<SmokeResult[]> {
  const out: SmokeResult[] = [];
  if (need.posix) {
    if (!shimDir) return [{ name: "posix", ok: false, detail: "no shim directory: run `buncc env posix --ensure`" }];
    const ext = process.platform === "win32" ? ".exe" : "";
    const probes: [string, string[], RegExp][] = [
      ["ls", ["--version"], /./],
      ["cat", ["--version"], /./],
      ["sed", ["--version"], /./],
      ["find", ["--version"], /./],
      ["rg", ["--version"], /ripgrep/],
    ];
    for (const [tool, args, re] of probes) {
      const bin = join(shimDir, tool + ext);
      if (!existsSync(bin)) {
        out.push({ name: tool, ok: false, detail: "shim missing" });
        continue;
      }
      const r = await exec([bin, ...args]);
      const text = r.stdout + r.stderr;
      out.push({
        name: tool,
        ok: (r.code === 0 || tool === "sed") && re.test(text),
        detail: text.split("\n")[0]!.slice(0, 80),
      });
    }
  }
  if (need.mingw) {
    if (!mingwBin)
      out.push({ name: "mingw", ok: false, detail: "no mingw toolchain found: run `buncc install mingw --run`" });
    else {
      const r = await exec([mingwBin, "--version"]);
      out.push({ name: "mingw", ok: r.code === 0, detail: (r.stdout || r.stderr).split("\n")[0]!.slice(0, 80) });
    }
  }
  return out;
}

export interface ExecuteResult {
  executed: { step: PlanStep; ok: boolean; detail?: string }[];
  stoppedAt?: number;
  smoke?: SmokeResult[];
}

export interface ExecuteOptions {
  /** How long to poll for a step's effect (the Inno uninstaller re-launches itself and returns early). Default 60 s for uninstallers, 3 s otherwise. */
  verifyMs?: number;
  pollMs?: number;
}

/** Check the effect of a step. Returns undefined when it holds, else the reason it does not. */
async function verifyStep(step: PlanStep, host: LegacyHost): Promise<string | undefined> {
  const v = step.verify;
  if (!v) return undefined;
  switch (v.kind) {
    case "reg-gone":
      return (await host.regKeyExists(v.target)) ? `registry key still exists: ${v.target}` : undefined;
    case "winget-gone": {
      const r = await host.exec(["winget", "list", "--id", v.target, "--exact", "--source", "winget", "--disable-interactivity", "--accept-source-agreements"], { timeoutMs: 120_000 });
      return r.code === 0 ? `winget still lists ${v.target}` : undefined;
    }
    case "path-gone":
      return host.exists(v.target) ? `still exists: ${v.target}` : undefined;
    case "path-exists":
      return host.exists(v.target) ? undefined : `not created: ${v.target}`;
    case "path-entry-gone": {
      const p = await host.persistentPath();
      const list = (v.scope === "machine" ? p.machine : p.user).split(delimiter).map(x => lower(x).replace(/\\+$/, ""));
      return list.includes(lower(v.target).replace(/\\+$/, "")) ? `${v.scope} PATH still has ${v.target}` : undefined;
    }
  }
}

/**
 * Execute a plan. Every step is checked AFTER it ran (registry query, file system): a step is "done" only when its effect
 * is observed, otherwise it fails with the reason and the run stops. A step that needs elevation is not attempted without it.
 * `smoke` must pass before the first removal step.
 */
export async function executePlan(
  plan: UninstallPlan,
  host: LegacyHost,
  smoke: (need: { posix: boolean; mingw: boolean }) => Promise<SmokeResult[]>,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const result: ExecuteResult = { executed: [] };
  const allowed = new Set(plan.installs.map(i => lower(i.root)));
  const allowedShortcuts = new Set(plan.installs.flatMap(i => i.shortcuts.map(lower)));
  const protectedList = plan.protected;
  const elevated = plan.elevated || (await host.isElevated());
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  for (const [n, step] of plan.steps.entries()) {
    const stop = (detail: string) => {
      result.executed.push({ step, ok: false, detail });
      result.stoppedAt = n;
      return result;
    };
    if (step.kind === "gate") {
      result.smoke = await smoke({ posix: true, mingw: plan.installs.some(i => i.id === "msys2" || i.id === "mingw") });
      const bad = result.smoke.filter(s => !s.ok);
      if (!result.smoke.length || bad.length)
        return stop(`smoke test failed: ${bad.map(b => `${b.name}: ${b.detail}`).join("; ") || "no probes"}`);
      result.executed.push({ step, ok: true });
      continue;
    }
    if (step.needsElevation && !elevated)
      return stop(
        "needs elevation: run this from an elevated shell (buncc does not elevate itself); nothing was attempted",
      );
    try {
      if (step.precheck) {
        const found = await host.exec(step.precheck, { timeoutMs: 120_000 });
        if (found.code !== 0) {
          result.executed.push({ step, ok: true, detail: `skipped: not installed (${step.precheck.slice(0, 4).join(" ")} exited ${found.code})` });
          continue;
        }
      }
      if (step.kind === "backup") {
        mkdirSync(plan.backupDir, { recursive: true });
        if (step.title.startsWith("save the persistent")) {
          host.writeFile(step.path!, JSON.stringify(await host.persistentPath(), null, 2));
        } else if (step.command) {
          const r = await host.exec(step.command);
          // robocopy exit codes 0-7 are success
          const okCode = step.command[0] === "robocopy" ? r.code < 8 : r.code === 0;
          if (!okCode) return stop(`backup command failed (${r.code}): ${r.stderr.slice(0, 200)}`);
          if (step.command[0] !== "robocopy" && step.command[0] !== "reg") host.writeFile(step.path!, r.stdout);
        }
        if (step.path && !host.exists(step.path)) return stop(`backup was not written: ${step.path}`);
        result.executed.push({ step, ok: true });
        continue;
      }
      let exitNote = "";
      if (step.kind === "delete-dir") {
        const target = step.path!;
        if (!allowed.has(lower(target))) return stop(`refusing to delete ${target}: not a detected install root`);
        if (touchesProtected(target, protectedList)) return stop(`refusing to delete ${target}: protected`);
        if (host.exists(target)) host.removeDir(target);
      } else if (step.kind === "shortcut") {
        if (!allowedShortcuts.has(lower(step.path!)))
          return stop(`refusing to delete ${step.path}: not a detected shortcut`);
        if (host.exists(step.path!)) host.removeDir(step.path!);
      } else if (step.command) {
        const r = await host.exec(step.command, { timeoutMs: step.timeoutMs });
        if (r.code !== 0)
          exitNote = `${step.command[0]} exited ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`;
      }
      const budget = options.verifyMs ?? (step.kind === "uninstaller" ? 60_000 : 3_000);
      const deadline = Date.now() + budget;
      let problem = await verifyStep(step, host);
      while (problem && Date.now() < deadline) {
        await sleep(options.pollMs ?? 500);
        problem = await verifyStep(step, host);
      }
      if (problem) return stop(`${problem}${exitNote ? `; ${exitNote}` : ""}`);
      if (!step.verify && exitNote) return stop(exitNote);
      result.executed.push({ step, ok: true, detail: step.verify ? "effect verified" : undefined });
    } catch (error) {
      return stop((error as Error).message);
    }
  }
  return result;
}

/** The real machine, read-only for detection. Windows only; elsewhere it reports nothing installed. */
export function realHost(): LegacyHost {
  const env = Bun.env as Record<string, string | undefined>;
  const reg = async (args: string[]) => {
    const r = await run(["reg", ...args], { output: "capture", timeoutMs: 20_000 });
    return r.code === 0 ? r.stdout : "";
  };
  const parseValues = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s{4}(\S.*?)\s{4}REG_\w+\s{4}(.*)$/.exec(line);
      if (m) out[m[1]!] = m[2]!;
    }
    return out;
  };
  return {
    env,
    exists: p => existsSync(p),
    isDir: p => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
    list: p => {
      try {
        return readdirSync(p);
      } catch {
        return [];
      }
    },
    readText: p => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    },
    async uninstallEntries() {
      if (process.platform !== "win32") return [];
      const roots = [
        "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      ];
      const out: UninstallEntry[] = [];
      for (const root of roots) {
        const text = await reg(["query", root, "/s"]);
        for (const block of text.split(/\r?\n(?=HKEY_)/)) {
          const key = block
            .split(/\r?\n/, 1)[0]!
            .trim()
            .replace(/^HKEY_LOCAL_MACHINE/, "HKLM")
            .replace(/^HKEY_CURRENT_USER/, "HKCU");
          const v = parseValues(block);
          if (v.DisplayName)
            out.push({
              key,
              DisplayName: v.DisplayName,
              DisplayVersion: v.DisplayVersion,
              InstallLocation: v.InstallLocation,
              UninstallString: v.UninstallString,
              Publisher: v.Publisher,
            });
        }
      }
      return out;
    },
    async regValues(key) {
      if (process.platform !== "win32") return undefined;
      const text = await reg(["query", key]);
      return text ? parseValues(text) : undefined;
    },
    async persistentPath() {
      if (process.platform !== "win32") return { user: "", machine: "" };
      const user = parseValues(await reg(["query", "HKCU\\Environment", "/v", "Path"])).Path ?? "";
      const machine =
        parseValues(
          await reg(["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "/v", "Path"]),
        ).Path ?? "";
      return { user, machine };
    },
    exec: (argv, opts) => run(argv, { output: "capture", timeoutMs: opts?.timeoutMs ?? 600_000 }),
    async regKeyExists(key) {
      if (process.platform !== "win32") return false;
      const r = await run(["reg", "query", key], { output: "capture", timeoutMs: 20_000 });
      return r.code === 0;
    },
    async isElevated() {
      if (process.platform !== "win32") return typeof process.getuid === "function" && process.getuid() === 0;
      // The High mandatory level SID S-1-16-12288 is in the token groups only for an elevated process.
      const r = await run(["whoami", "/groups"], { output: "capture", timeoutMs: 20_000 });
      return r.stdout.includes("S-1-16-12288");
    },
    removeDir: p => rmSync(p, { recursive: true, force: true }),
    writeFile: (p, t) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, t);
    },
    configFiles() {
      const appdata = env.APPDATA ?? "";
      const local = env.LOCALAPPDATA ?? "";
      const home = env.USERPROFILE ?? "";
      const files = [
        join(appdata, "Code", "User", "settings.json"),
        join(appdata, "Cursor", "User", "settings.json"),
        join(home, ".cargo", "config.toml"),
        join(home, ".gitconfig"),
      ];
      try {
        const pk = join(local, "Packages");
        for (const d of readdirSync(pk))
          if (d.startsWith("Microsoft.WindowsTerminal")) files.push(join(pk, d, "LocalState", "settings.json"));
      } catch {}
      return files.filter(f => existsSync(f));
    },
  };
}
