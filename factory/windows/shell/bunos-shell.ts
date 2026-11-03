#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Bun OS shell for Windows: nushell + Rio + GlazeWM + COSMIC Files over the stock Windows shell,
 * without replacing or renaming any Windows file (cmd.exe, powershell.exe and explorer.exe stay).
 *
 *   sudo.exe bun factory/windows/shell/bunos-shell.ts install     elevated: sign + copy binaries to %SystemRoot%\BunOS
 *   sudo.exe bun factory/windows/shell/bunos-shell.ts uninstall   elevated: remove exactly the files in the manifest
 *   bun factory/windows/shell/bunos-shell.ts enable [component..] per user (default: all but files-default)
 *   bun factory/windows/shell/bunos-shell.ts disable [component..] per user, restores the journaled previous state
 *   bun factory/windows/shell/bunos-shell.ts undo                 disable everything (per user)
 *   bun factory/windows/shell/bunos-shell.ts status               JSON state of every component
 *
 * Components: nu-plugin, terminal, assoc, verbs, files, files-default (opt-in), navpane, wm.
 * Per-user state changes are HKCU values/keys and files under %LOCALAPPDATA%; every previous value
 * is journaled in %LOCALAPPDATA%\bunos\shell\journal.json before it is touched.
 * Registry writes go through our own `win` CLI (WinClean), never reg.exe.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const env = process.env;
const repo = resolve(import.meta.dir, "../../..");
const systemRoot = env.SystemRoot ?? "C:\\Windows";
const bunosRoot = join(systemRoot, "BunOS");
const binDir = join(bunosRoot, "bin");
const shareDir = join(bunosRoot, "share");
const licenseDir = join(bunosRoot, "licenses");
const manifestPath = join(bunosRoot, "manifests", "shell.json");
const localAppData = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? "", "AppData", "Local");
const stateDir = join(localAppData, "bunos", "shell");
const journalPath = join(stateDir, "journal.json");
const cacheTarget = env.CARGO_TARGET_DIR ?? join(localAppData, "Aphrody", "cache", "cargo-target");

/** The binaries we ship, where each is built, and its licence source. */
const artifacts = [
  { file: "nu_plugin_windows.exe", from: ["nu-plugin-windows/release"], license: "crates/nu_plugin_windows", spdx: "Apache-2.0" },
  { file: "win.exe", from: ["nu-plugin-windows/release"], license: "crates/nu_plugin_windows", spdx: "Apache-2.0" },
  { file: "nu.exe", from: ["nushell-fork/release"], license: "vendor/nushell", spdx: "MIT", shared: true },
  { file: "rio.exe", from: ["shell-forks/release"], license: "vendor/rio", spdx: "MIT" },
  { file: "glazewm.exe", from: ["shell-forks/release"], license: "vendor/glazewm", spdx: "GPL-3.0-only" },
  { file: "glazewm-cli.exe", from: ["shell-forks/release"], license: "vendor/glazewm", spdx: "GPL-3.0-only" },
  { file: "glazewm-watcher.exe", from: ["shell-forks/release"], license: "vendor/glazewm", spdx: "GPL-3.0-only" },
  { file: "cosmic-files.exe", from: ["shell-forks/release"], license: "vendor/cosmic-epoch/cosmic-files", spdx: "GPL-3.0-only" },
  { file: "bunos-win11-chrome.exe", from: ["release"], license: "crates/bunos-win11-chrome", spdx: "Apache-2.0" },
  { file: "bunos-win11-wallpaper.exe", from: ["release"], license: "crates/bunos-win11-wallpaper", spdx: "Apache-2.0" },
] as const;

const bin = (file: string) => join(binDir, file);

/** A userland command (nu, brush, hx): the userland bundle's System32 link / payload first, then ours. */
function tool(file: string): string {
  for (const candidate of [join(systemRoot, "System32", file), join(bunosRoot, "userland", "bin", file), bin(file)]) {
    if (existsSync(candidate)) return candidate;
  }
  return bin(file);
}

/**
 * Bun OS Material icons (design agent: %SystemRoot%\BunOS\icons\bunos-icons.dll, ordinals from its
 * icon-theme.json; light 100+, dark 1100+ following the user's app theme), else `fallback`.
 */
const ICON_ORDINALS = { terminal: 150, files: 151, linux: 170, script: 133, bunos: 173 } as const;
function icon(id: keyof typeof ICON_ORDINALS, fallback: string): string {
  const dll = join(bunosRoot, "icons", "bunos-icons.dll");
  if (!existsSync(dll)) return fallback;
  const light = regGet("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "AppsUseLightTheme")?.value === "1";
  return `${dll},-${ICON_ORDINALS[id] + (light ? 0 : 1000)}`;
}
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

// ---------------------------------------------------------------- process helpers

function run(cmd: string[], opts: { allowFail?: boolean } = {}): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  const result = { code: p.exitCode ?? 1, out: p.stdout.toString(), err: p.stderr.toString() };
  if (result.code !== 0 && !opts.allowFail) throw new Error(`${cmd.join(" ")}: ${result.err || result.out}`);
  return result;
}

/** `win` CLI (WinClean): the installed one, or the freshly built one before install. */
function winExe(): string {
  const installed = bin("win.exe");
  if (existsSync(installed)) return installed;
  const built = join(cacheTarget, "nu-plugin-windows", "release", "win.exe");
  if (existsSync(built)) return built;
  throw new Error("win.exe not found: run the install step first");
}

function win(tool: string, args: Record<string, unknown>, allowFail = false): any {
  const r = run([winExe(), "call", tool, JSON.stringify(args), "--raw"], { allowFail });
  if (r.code !== 0) return null;
  return r.out.trim() ? JSON.parse(r.out) : null;
}

// ---------------------------------------------------------------- registry with journal

type Entry = { kind: "value"; path: string; name: string; previous: null | { type: string; value: string } } | { kind: "key"; path: string; existed: boolean };
type Journal = Record<string, Entry[]>;

const loadJournal = (): Journal => (existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, "utf8")) : {});
function saveJournal(journal: Journal) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n");
}

function regGet(path: string, name: string): null | { type: string; value: string } {
  const v = win("get_registry_value", { path, name }, true);
  return v && v.Type ? { type: v.Type, value: String(v.Value ?? v.Data ?? "") } : null;
}
const regKeyExists = (path: string) => win("list_registry_key", { path }, true) !== null;

class Changes {
  constructor(private journal: Journal, private component: string) {
    journal[component] ??= [];
  }
  private record(entry: Entry) {
    const list = this.journal[this.component];
    const same = list.find(e => e.kind === entry.kind && e.path === entry.path && (e.kind === "key" || (entry.kind === "value" && e.name === entry.name)));
    if (!same) list.push(entry); // keep the first (original) previous state
  }
  /** A key we own entirely (BunOS.*): deleted on disable if it did not exist before. */
  key(path: string) {
    this.record({ kind: "key", path, existed: regKeyExists(path) });
  }
  set(path: string, name: string, value: string, type = "REG_SZ") {
    this.record({ kind: "value", path, name, previous: regGet(path, name) });
    win("set_registry_value", { path, name, value, type });
  }
}

function revert(journal: Journal, component: string) {
  for (const entry of (journal[component] ?? []).slice().reverse()) {
    if (entry.kind === "value") {
      if (entry.previous) win("set_registry_value", { path: entry.path, name: entry.name, value: entry.previous.value, type: entry.previous.type }, true);
      else win("delete_registry_entry", { path: entry.path, name: entry.name }, true);
    } else if (!entry.existed) {
      win("delete_registry_entry", { path: entry.path }, true);
    }
  }
  delete journal[component];
}

// ---------------------------------------------------------------- elevated install

function requireAdmin() {
  const r = run(["net", "session"], { allowFail: true });
  if (r.code !== 0) throw new Error("install/uninstall must run elevated: sudo.exe bun factory/windows/shell/bunos-shell.ts install");
}

function locate(from: readonly string[], file: string): string | null {
  const roots = [env.BUNOS_SHELL_FROM, ...from.map(f => join(cacheTarget, f))].filter(Boolean) as string[];
  for (const root of roots) {
    const candidate = join(root, file);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function signerThumbprint(path: string): string | null {
  const r = run(["pwsh", "-NoProfile", "-Command", `(Get-AuthenticodeSignature -LiteralPath '${path}').SignerCertificate.Thumbprint`], { allowFail: true });
  return r.out.trim() || null;
}

function install() {
  requireAdmin();
  const stage = join(env.TEMP ?? localAppData, `bunos-shell-stage-${process.pid}`);
  mkdirSync(stage, { recursive: true });
  for (const d of [binDir, shareDir, licenseDir, dirname(manifestPath)]) mkdirSync(d, { recursive: true });
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { files: [] };
  const staged: { file: string; staged: string; source: string; art: (typeof artifacts)[number] }[] = [];
  const missing: string[] = [];
  for (const art of artifacts) {
    const source = locate(art.from, art.file);
    if (!source) {
      if (!("shared" in art && art.shared && existsSync(bin(art.file)))) missing.push(art.file);
      continue;
    }
    // nu.exe is shared with the userland bundle: never replace one another component installed.
    if ("shared" in art && art.shared && (tool(art.file) !== bin(art.file) || (existsSync(bin(art.file)) && !previous.files.some((f: any) => f.file === art.file)))) continue;
    const target = join(stage, art.file);
    copyFileSync(source, target);
    staged.push({ file: art.file, staged: target, source, art });
  }
  if (missing.length) throw new Error(`not built: ${missing.join(", ")} (see docs/WINDOWS-SHELL.md, Build)`);
  // Sign every binary with the machine-trusted Bun OS test certificate (factory/windows/signing).
  run(["pwsh", "-NoProfile", "-File", join(repo, "factory/windows/signing/test-signing.ps1"), "sign", ...staged.map(s => s.staged)]);
  const files: any[] = [];
  for (const s of staged) {
    const target = bin(s.file);
    const hash = sha256(s.staged);
    if (!existsSync(target) || sha256(target) !== hash) {
      if (s.file === "glazewm.exe" || s.file === "glazewm-watcher.exe") run(["taskkill", "/IM", s.file, "/F"], { allowFail: true });
      copyFileSync(s.staged, target);
    }
    files.push({ file: s.file, path: target, sha256: hash, size: statSync(target).size, spdx: s.art.spdx, source: s.source, thumbprint: signerThumbprint(target) });
    const lic = join(licenseDir, basename(s.art.license));
    mkdirSync(lic, { recursive: true });
    for (const name of readdirSync(join(repo, s.art.license))) if (/^(LICENSE|COPYING|NOTICE)/i.test(name)) copyFileSync(join(repo, s.art.license, name), join(lic, name));
  }
  // Shared data: GlazeWM sample config (our session config derives from it) and the nu module.
  mkdirSync(join(shareDir, "glazewm"), { recursive: true });
  copyFileSync(join(repo, "vendor/glazewm/resources/assets/sample-config.yaml"), join(shareDir, "glazewm", "sample-config.yaml"));
  copyFileSync(join(repo, "vendor/glazewm/resources/assets/icon.ico"), join(shareDir, "glazewm", "icon.ico"));
  mkdirSync(join(shareDir, "nu"), { recursive: true });
  copyFileSync(join(repo, "factory/windows/shell/nu/bunos-windows.nu"), join(shareDir, "nu", "bunos-windows.nu"));
  copyFileSync(import.meta.path, join(shareDir, "bunos-shell.ts"));
  rmSync(stage, { recursive: true, force: true });
  const rev = run(["git", "-C", repo, "rev-parse", "HEAD"], { allowFail: true }).out.trim();
  const manifest = { schema: 1, component: "bunos-shell", installedAt: new Date().toISOString(), repoRev: rev, root: bunosRoot, files };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ installed: files.map(f => f.file), manifest: manifestPath, thumbprint: files[0]?.thumbprint }, null, 2));
}

function uninstall() {
  requireAdmin();
  if (!existsSync(manifestPath)) return console.log("nothing installed");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const f of manifest.files) {
    // Only remove what we installed and what is unchanged since.
    if (existsSync(f.path) && f.path.startsWith(binDir) && sha256(f.path) === f.sha256) {
      if (/glazewm|cosmic-files|rio|bunos-win11/.test(f.file)) run(["taskkill", "/IM", f.file, "/F"], { allowFail: true });
      rmSync(f.path, { force: true });
    }
  }
  for (const d of ["glazewm", "nu"]) rmSync(join(shareDir, d), { recursive: true, force: true });
  rmSync(join(shareDir, "bunos-shell.ts"), { force: true });
  rmSync(manifestPath, { force: true });
  console.log("uninstalled");
}

// ---------------------------------------------------------------- per-user components

const HKCU_CLASSES = "HKCU\\Software\\Classes";
const NU_PROFILE_GUID = "{7b0f5a3e-4b1d-4c2e-9a10-b05e05de1101}";
const NAVPANE_CLSID = "{b05e05de-5a3e-4b1d-9a10-7b0f5a3e1102}";
const WT_PACKAGES = ["Microsoft.WindowsTerminal_8wekyb3d8bbwe", "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe"];
const quote = (s: string) => `"${s}"`;

/** The registered name of the Bun OS WSL distribution (per-user Lxss registry; WSL is not started). */
function bunosDistro(): string {
  const lxss = win("list_registry_key", { path: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss" }, true);
  for (const key of lxss?.SubKeys ?? []) {
    const name = win("get_registry_value", { path: key, name: "DistributionName" }, true)?.Value;
    if (typeof name === "string" && name.toLowerCase() === "bunos") return name;
  }
  return "bunos";
}

function wtSettings(): string[] {
  return WT_PACKAGES.map(p => join(localAppData, "Packages", p, "LocalState", "settings.json")).filter(existsSync);
}

function setWtDefault(file: string, guid: string): string | null {
  const text = readFileSync(file, "utf8");
  const match = text.match(/"defaultProfile"\s*:\s*"([^"]*)"/);
  const next = match ? text.replace(match[0], `"defaultProfile": "${guid}"`) : text.replace("{", `{\n    "defaultProfile": "${guid}",`);
  writeFileSync(file, next);
  return match?.[1] ?? null;
}

type Files = Record<string, { path: string; previous: string | null; restore?: { file: string; key: string; value: string | null } }>;
const filesPath = join(stateDir, "files.json");
const loadFiles = (): Files => (existsSync(filesPath) ? JSON.parse(readFileSync(filesPath, "utf8")) : {});
const saveFiles = (f: Files) => (mkdirSync(stateDir, { recursive: true }), writeFileSync(filesPath, JSON.stringify(f, null, 2) + "\n"));

/** Write a file we own; remember whether something else was there (it is restored on disable). */
function ownFile(files: Files, id: string, path: string, content: string) {
  if (!files[id]) files[id] = { path, previous: existsSync(path) ? readFileSync(path, "utf8") : null };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
function releaseFile(files: Files, id: string) {
  const f = files[id];
  if (!f) return;
  if (f.previous === null) rmSync(f.path, { force: true });
  else writeFileSync(f.path, f.previous);
  delete files[id];
}

const components: Record<string, { enable(c: Changes, files: Files): void; disable?(files: Files): void; status(): unknown }> = {
  "nu-plugin": {
    enable() {
      run([tool("nu.exe"), "-c", `plugin add '${bin("nu_plugin_windows.exe")}'`]);
      // The module with cmd/pwsh-familiar wrappers, loaded from the user's autoload directory.
      const autoload = run([tool("nu.exe"), "-c", "$nu.user-autoload-dirs | first"]).out.trim();
      const files = loadFiles();
      ownFile(files, "nu-autoload", join(autoload, "bunos-windows.nu"), readFileSync(join(shareDir, "nu", "bunos-windows.nu"), "utf8"));
      saveFiles(files);
    },
    disable(files) {
      run([tool("nu.exe"), "-c", "plugin rm windows"], { allowFail: true });
      releaseFile(files, "nu-autoload");
    },
    status: () => run([tool("nu.exe"), "-c", "plugin list | where name == windows | length"], { allowFail: true }).out.trim() === "1",
  },

  terminal: {
    enable(c, files) {
      // Windows Terminal stays the console host (Rio has no ITerminalHandoff/console delegation);
      // nushell becomes its default profile, and Rio is configured to start nushell.
      const fragment = {
        profiles: [
          { guid: NU_PROFILE_GUID, name: "Bun OS nushell", commandline: quote(tool("nu.exe")), icon: icon("terminal", join(shareDir, "glazewm", "icon.ico")), startingDirectory: "%USERPROFILE%" },
        ],
      };
      ownFile(files, "wt-fragment", join(localAppData, "Microsoft", "Windows Terminal", "Fragments", "BunOS", "bunos.json"), JSON.stringify(fragment, null, 2) + "\n");
      for (const settings of wtSettings()) {
        const id = `wt-default:${settings}`;
        const previous = setWtDefault(settings, NU_PROFILE_GUID);
        files[id] ??= { path: settings, previous: null, restore: { file: settings, key: "defaultProfile", value: previous } };
      }
      const rioConfig = `# Bun OS: Rio starts nushell (written by bunos-shell; removed on disable).\n[shell]\nprogram = '${tool("nu.exe")}'\nargs = []\n\n[window]\nmode = "Windowed"\n`;
      ownFile(files, "rio-config", join(localAppData, "rio", "config.toml"), rioConfig);
      // Explorer's own "Open in Terminal" and the console delegation (HKCU\Console\%%Startup) keep
      // Windows Terminal, which now opens nushell: nothing to change there.
      void c;
    },
    disable(files) {
      releaseFile(files, "wt-fragment");
      releaseFile(files, "rio-config");
      for (const [id, f] of Object.entries(files)) {
        if (!id.startsWith("wt-default:") || !f.restore) continue;
        if (existsSync(f.restore.file) && f.restore.value !== null) setWtDefault(f.restore.file, f.restore.value);
        delete files[id];
      }
    },
    status: () => ({ fragment: existsSync(join(localAppData, "Microsoft", "Windows Terminal", "Fragments", "BunOS", "bunos.json")), default: wtSettings().map(f => readFileSync(f, "utf8").includes(NU_PROFILE_GUID)) }),
  },

  assoc: {
    enable(c) {
      const types = [
        { ext: ".nu", progId: "BunOS.NuScript", label: "Nushell script", open: `${quote(tool("nu.exe"))} "%1" %*` },
        { ext: ".sh", progId: "BunOS.ShScript", label: "Shell script", open: existsSync(tool("brush.exe")) ? `${quote(tool("brush.exe"))} "%1" %*` : `${quote(tool("nu.exe"))} -c "^bash '%1'"` },
      ];
      for (const t of types) {
        c.key(`${HKCU_CLASSES}\\${t.progId}`);
        c.set(`${HKCU_CLASSES}\\${t.progId}`, "(default)", t.label);
        c.set(`${HKCU_CLASSES}\\${t.progId}\\DefaultIcon`, "(default)", icon("script", `${tool("nu.exe")},0`));
        c.set(`${HKCU_CLASSES}\\${t.progId}\\shell\\open\\command`, "(default)", t.open);
        c.set(`${HKCU_CLASSES}\\${t.progId}\\shell\\edit\\command`, "(default)", existsSync(tool("hx.exe")) ? `${quote(tool("hx.exe"))} "%1"` : `notepad.exe "%1"`);
        c.set(`${HKCU_CLASSES}\\${t.ext}`, "(default)", t.progId);
        c.set(`${HKCU_CLASSES}\\${t.ext}\\OpenWithProgids`, t.progId, "", "REG_NONE");
      }
    },
    status: () => regGet(`${HKCU_CLASSES}\\.nu`, "(default)")?.value === "BunOS.NuScript",
  },

  verbs: {
    enable(c) {
      // Explorer "Open in Rio (nushell)" on folders, drives and folder backgrounds.
      for (const base of ["Directory", "Directory\\Background", "Drive"]) {
        const target = base === "Directory\\Background" ? "%V" : "%1";
        const key = `${HKCU_CLASSES}\\${base}\\shell\\BunOS.Rio`;
        c.key(key);
        c.set(key, "(default)", "Open in Rio (nushell)");
        c.set(key, "Icon", icon("terminal", bin("rio.exe")));
        c.set(`${key}\\command`, "(default)", `${quote(bin("rio.exe"))} --working-dir "${target}"`);
      }
    },
    status: () => regKeyExists(`${HKCU_CLASSES}\\Directory\\shell\\BunOS.Rio`),
  },

  files: {
    enable(c) {
      // COSMIC Files as an "Open with" application and an Explorer verb on folders and drives.
      const app = `${HKCU_CLASSES}\\Applications\\cosmic-files.exe`;
      c.key(app);
      c.set(app, "FriendlyAppName", "COSMIC Files");
      c.set(`${app}\\DefaultIcon`, "(default)", icon("files", `${bin("cosmic-files.exe")},0`));
      c.set(`${app}\\shell\\open\\command`, "(default)", `${quote(bin("cosmic-files.exe"))} "%1"`);
      c.set(`${app}\\SupportedTypes`, "Folder", "", "REG_SZ");
      for (const base of ["Directory", "Directory\\Background", "Drive"]) {
        const target = base === "Directory\\Background" ? "%V" : "%1";
        const key = `${HKCU_CLASSES}\\${base}\\shell\\BunOS.CosmicFiles`;
        c.key(key);
        c.set(key, "(default)", "Open in COSMIC Files");
        c.set(key, "Icon", icon("files", bin("cosmic-files.exe")));
        c.set(`${key}\\command`, "(default)", `${quote(bin("cosmic-files.exe"))} "${target}"`);
      }
      // Start menu entry.
      const lnk = join(env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "COSMIC Files.lnk");
      shortcut(lnk, bin("cosmic-files.exe"), "%USERPROFILE%");
    },
    disable() {
      rmSync(join(env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "COSMIC Files.lnk"), { force: true });
    },
    status: () => regKeyExists(`${HKCU_CLASSES}\\Directory\\shell\\BunOS.CosmicFiles`),
  },

  "files-default": {
    // Opt-in: double-click on folders (ShellExecute "open" on Directory) opens COSMIC Files.
    // Explorer itself, Win+E and the taskbar stay Explorer; disable restores the previous verb.
    enable(c) {
      c.set(`${HKCU_CLASSES}\\Directory\\shell`, "(default)", "BunOS.CosmicFiles");
      c.set(`${HKCU_CLASSES}\\Drive\\shell`, "(default)", "BunOS.CosmicFiles");
    },
    status: () => regGet(`${HKCU_CLASSES}\\Directory\\shell`, "(default)")?.value === "BunOS.CosmicFiles",
  },

  navpane: {
    // "Bun OS (Linux)" pinned in Explorer's navigation pane: a per-user shell folder delegating to
    // the system file-system folder (CLSID_FolderShortcut pattern, no DLL of ours) targeting
    // \\wsl.localhost\BunOS.
    enable(c) {
      const k = `${HKCU_CLASSES}\\CLSID\\${NAVPANE_CLSID}`;
      c.key(k);
      c.set(k, "(default)", "Bun OS (Linux)");
      c.set(k, "System.IsPinnedToNameSpaceTree", "1", "REG_DWORD");
      c.set(k, "SortOrderIndex", "66", "REG_DWORD");
      c.set(`${k}\\DefaultIcon`, "(default)", icon("linux", "%SystemRoot%\\system32\\imageres.dll,-1040"), "REG_EXPAND_SZ");
      c.set(`${k}\\InProcServer32`, "(default)", "%SystemRoot%\\system32\\shell32.dll", "REG_EXPAND_SZ");
      c.set(`${k}\\Instance`, "CLSID", "{0E5AAE11-A475-4c5b-AB00-C66DE400274E}");
      c.set(`${k}\\Instance\\InitPropertyBag`, "Attributes", "17", "REG_DWORD");
      c.set(`${k}\\Instance\\InitPropertyBag`, "TargetFolderPath", `\\\\wsl.localhost\\${bunosDistro()}`);
      c.set(`${k}\\ShellFolder`, "FolderValueFlags", "40", "REG_DWORD");
      c.set(`${k}\\ShellFolder`, "Attributes", String(0xf080004d), "REG_DWORD");
      const ns = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace\\${NAVPANE_CLSID}`;
      c.key(ns);
      c.set(ns, "(default)", "Bun OS (Linux)");
      c.set("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons\\NewStartPanel", NAVPANE_CLSID, "1", "REG_DWORD");
    },
    status: () => regKeyExists(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace\\${NAVPANE_CLSID}`),
  },

  wm: {
    // GlazeWM as the per-user tiling WM (Explorer stays the shell), with our DWM chrome and the
    // WorkerW wallpaper started/stopped with it; autostart at logon through the HKCU Run key.
    enable(c, files) {
      ownFile(files, "glazewm-config", join(stateDir, "glazewm.yaml"), glazewmConfig());
      c.set("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "BunOS.GlazeWM", `${quote(bin("glazewm.exe"))} start --config ${quote(join(stateDir, "glazewm.yaml"))}`);
      Bun.spawn([bin("glazewm.exe"), "start", "--config", join(stateDir, "glazewm.yaml")], { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref();
    },
    disable(files) {
      run([bin("glazewm-cli.exe"), "command", "wm-exit"], { allowFail: true });
      for (const exe of ["glazewm.exe", "glazewm-watcher.exe", "bunos-win11-wallpaper.exe", "bunos-win11-chrome.exe"]) run(["taskkill", "/IM", exe, "/F"], { allowFail: true });
      releaseFile(files, "glazewm-config");
    },
    status: () => ({ autostart: regGet("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "BunOS.GlazeWM") !== null, running: run(["tasklist", "/FI", "IMAGENAME eq glazewm.exe"], { allowFail: true }).out.includes("glazewm.exe") }),
  },
};

/** A Start menu shortcut through WScript.Shell (one COM chain: create, set, save). */
function shortcut(lnk: string, target: string, workdir: string) {
  win("com_invoke", {
    progId: "WScript.Shell",
    steps: [
      { name: "CreateShortcut", args: [lnk] },
      { on: 1, name: "TargetPath", op: "put", value: target },
      { on: 1, name: "WorkingDirectory", op: "put", value: workdir },
      { on: 1, name: "IconLocation", op: "put", value: `${target},0` },
      { on: 1, name: "Save", op: "call" },
    ],
  });
}

function glazewmConfig(): string {
  let yaml = readFileSync(join(shareDir, "glazewm", "sample-config.yaml"), "utf8");
  const sq = (s: string) => s.replaceAll("\\", "/");
  yaml = yaml.replace(/startup_commands: \[.*\]/, `startup_commands: ["shell-exec ${sq(bin("bunos-win11-wallpaper.exe"))} run inf", "shell-exec ${sq(bin("bunos-win11-chrome.exe"))} watch"]`);
  yaml = yaml.replace(/shutdown_commands: \[.*\]/, `shutdown_commands: ["shell-exec taskkill /IM bunos-win11-wallpaper.exe /F", "shell-exec taskkill /IM bunos-win11-chrome.exe /F"]`);
  yaml = yaml.replace(/- commands: \["shell-exec cmd"\]/, `- commands: ["shell-exec ${sq(bin("rio.exe"))}"]`);
  return `# Bun OS GlazeWM session (generated by bunos-shell from GlazeWM's sample config; GPL-3.0 upstream).\n${yaml}`;
}

const ALL = ["nu-plugin", "terminal", "assoc", "verbs", "files", "navpane", "wm"];

function enable(names: string[]) {
  const journal = loadJournal();
  const files = loadFiles();
  for (const name of names) {
    const component = components[name];
    if (!component) throw new Error(`unknown component ${name}`);
    component.enable(new Changes(journal, name), files);
    saveJournal(journal);
    saveFiles(files);
    console.log(`enabled ${name}`);
  }
  refreshShell();
}

function disable(names: string[]) {
  const journal = loadJournal();
  const files = loadFiles();
  for (const name of names.slice().reverse()) {
    components[name]?.disable?.(files);
    revert(journal, name);
    saveJournal(journal);
    saveFiles(files);
    console.log(`disabled ${name}`);
  }
  refreshShell();
}

/** SHChangeNotify(SHCNE_ASSOCCHANGED) equivalent: ask Explorer to re-read associations/namespace. */
function refreshShell() {
  win("com_invoke", { progId: "Shell.Application", steps: [{ name: "Windows" }, { name: "Count" }] }, true);
  run(["ie4uinit.exe", "-show"], { allowFail: true });
}

function status() {
  const out: Record<string, unknown> = { installed: existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).files.map((f: any) => f.file) : [] };
  for (const [name, c] of Object.entries(components)) {
    try {
      out[name] = c.status();
    } catch (e) {
      out[name] = `error: ${(e as Error).message}`;
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
const names = rest.length ? rest : ALL;
switch (command) {
  case "install":
    install();
    break;
  case "uninstall":
    disable(Object.keys(loadJournal()));
    uninstall();
    break;
  case "enable":
    enable(names);
    break;
  case "disable":
    disable(names);
    break;
  case "undo":
    disable([...ALL, "files-default"].filter(n => n in loadJournal() || n in components));
    break;
  case "status":
    status();
    break;
  default:
    console.log(readFileSync(import.meta.path, "utf8").split("*/")[0]);
    process.exit(command ? 2 : 0);
}
