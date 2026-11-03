#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
/**
 * Installs the built @aphrody/bun-dotnet-windows into %SystemRoot%\BunOS\dotnet-windows with a manifest under
 * %SystemRoot%\BunOS\manifests\bun-dotnet-windows.json. Idempotent; elevated (Windows Sudo, inline):
 *
 *   sudo.exe bun packages/bun-dotnet-windows/install/install.ts install     stage, sign, copy, write the manifest
 *   sudo.exe bun packages/bun-dotnet-windows/install/install.ts uninstall   remove exactly the unchanged manifest files
 *   bun packages/bun-dotnet-windows/install/install.ts status               (not elevated) what is installed
 *
 * Layout (src/paths.ts "installed"): bunos_windows.dll, bunos_win_cpp.dll, winrtact.dll,
 * Microsoft.Management.Deployment.winmd, BunOs.Pwsh.dll (+ .deps.json, .runtimeconfig.json), bunos-winget.exe,
 * bunos-pwsh.exe, include\bunos_windows.h, pshome\ (the vendor/powershell build), licenses\.
 * Every unsigned PE file is Authenticode-signed with the machine-trusted Bun OS test certificate
 * (factory/windows/signing/test-signing.ps1); files that already carry a valid signature keep it. A file that
 * exists in the target but is not in the previous manifest is never overwritten: the install stops instead.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const pkg = resolve(import.meta.dir, "..");
const repo = resolve(pkg, "..", "..");
const build = process.env.BUNOS_DOTNET_WINDOWS_FROM ?? join(repo, "target", "bun-dotnet-windows");
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const bunosRoot = join(systemRoot, "BunOS");
const target = join(bunosRoot, "dotnet-windows");
const manifestPath = join(bunosRoot, "manifests", "bun-dotnet-windows.json");

interface Entry {
  file: string;
  path: string;
  sha256: string;
  size: number;
  source: string;
  thumbprint: string | null;
}

interface Manifest {
  schema: 1;
  component: "bun-dotnet-windows";
  installedAt: string;
  repoRev: string;
  root: string;
  thumbprint: string | null;
  files: Entry[];
}

function run(cmd: string[], allowFail = false): string {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", windowsHide: true });
  if (r.exitCode !== 0 && !allowFail)
    throw new Error(
      `${cmd[0]} ${cmd[1] ?? ""} failed (${r.exitCode}): ${r.stderr.toString().trim() || r.stdout.toString().trim()}`,
    );
  return r.stdout.toString();
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function elevated(): boolean {
  return Bun.spawnSync(["net", "session"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

function requireAdmin(): void {
  if (!elevated()) throw new Error("run elevated: sudo.exe bun packages/bun-dotnet-windows/install/install.ts install");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** source -> relative target path. */
function plan(): Map<string, string> {
  const files = new Map<string, string>();
  const need = (source: string, rel: string) => {
    if (!existsSync(source)) throw new Error(`not built: ${source} (bun packages/bun-dotnet-windows/scripts/build.ts)`);
    files.set(source, rel);
  };
  need(join(build, "native", "bunos_windows.dll"), "bunos_windows.dll");
  need(join(build, "cpp", "bunos_win_cpp.dll"), "bunos_win_cpp.dll");
  need(join(build, "cpp", "winrtact.dll"), "winrtact.dll");
  need(join(build, "winmd", "Microsoft.Management.Deployment.winmd"), "Microsoft.Management.Deployment.winmd");
  for (const name of ["BunOs.Pwsh.dll", "BunOs.Pwsh.deps.json", "BunOs.Pwsh.runtimeconfig.json"])
    need(join(build, "pwsh-host", name), name);
  for (const name of ["bunos-winget.exe", "bunos-pwsh.exe"]) need(join(build, "bin", name), name);
  need(join(pkg, "include", "bunos_windows.h"), join("include", "bunos_windows.h"));
  const pshome = join(build, "pwsh-fxdependent");
  if (!existsSync(join(pshome, "System.Management.Automation.dll")))
    throw new Error(`not built: ${pshome} (bun packages/bun-dotnet-windows/scripts/build.ts pwsh)`);
  for (const file of walk(pshome)) files.set(file, join("pshome", relative(pshome, file)));
  const licenses: [string, string][] = [
    [join(repo, "vendor", "winget-cli", "LICENSE"), "winget-cli.LICENSE"],
    [join(repo, "vendor", "winget-cli", "NOTICE.txt"), "winget-cli.NOTICE.txt"],
    [join(repo, "vendor", "powershell", "LICENSE.txt"), "PowerShell.LICENSE.txt"],
    [join(repo, "vendor", "powershell", "ThirdPartyNotices.txt"), "PowerShell.ThirdPartyNotices.txt"],
    [join(repo, "vendor", "detours", "LICENSE.md"), "Detours.LICENSE.md"],
    [join(repo, "vendor", "wil", "LICENSE"), "wil.LICENSE"],
    [join(repo, "vendor", "directx-headers", "LICENSE"), "DirectX-Headers.LICENSE"],
  ];
  for (const [source, name] of licenses) if (existsSync(source)) files.set(source, join("licenses", name));
  return files;
}

const PE = /\.(dll|exe)$/i;

/** Signature status of PE files in one pwsh call: path -> signer thumbprint (null when not validly signed). */
function signatures(paths: string[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  if (paths.length === 0) return result;
  const list = join(process.env.TEMP ?? bunosRoot, `bunos-dotnet-windows-sig-${process.pid}.txt`);
  writeFileSync(list, paths.join("\n"));
  const script = `Get-Content -LiteralPath '${list}' | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; "{0}|{1}" -f $_, $(if ($s.Status -eq 'Valid') { $s.SignerCertificate.Thumbprint } else { '' }) }`;
  const out = run(["pwsh", "-NoProfile", "-Command", script]);
  rmSync(list, { force: true });
  for (const line of out.split(/\r?\n/)) {
    const at = line.lastIndexOf("|");
    if (at > 0) result.set(line.slice(0, at), line.slice(at + 1) || null);
  }
  return result;
}

function readManifest(): Manifest | null {
  return existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest) : null;
}

function install(): void {
  requireAdmin();
  const previous = readManifest();
  const owned = new Set((previous?.files ?? []).map(f => f.path.toLowerCase()));
  const files = plan();

  // Refuse to replace anything this component does not own.
  const foreign = [...files.values()]
    .map(rel => join(target, rel))
    .filter(p => existsSync(p) && !owned.has(p.toLowerCase()));
  if (foreign.length)
    throw new Error(`refusing to overwrite files not installed by bun-dotnet-windows:\n  ${foreign.join("\n  ")}`);

  // Stage, then sign the unsigned PE files of the stage.
  const stage = join(process.env.TEMP ?? bunosRoot, `bun-dotnet-windows-stage-${process.pid}`);
  rmSync(stage, { recursive: true, force: true });
  for (const [source, rel] of files) {
    const staged = join(stage, rel);
    mkdirSync(dirname(staged), { recursive: true });
    copyFileSync(source, staged);
  }
  const pe = [...files.values()].filter(rel => PE.test(rel)).map(rel => join(stage, rel));
  const before = signatures(pe);
  const unsigned = pe.filter(p => !before.get(p));
  if (unsigned.length) {
    const signer = join(repo, "factory", "windows", "signing", "test-signing.ps1");
    for (let i = 0; i < unsigned.length; i += 32)
      run(["pwsh", "-NoProfile", "-File", signer, "sign", ...unsigned.slice(i, i + 32)]);
  }
  const after = signatures(pe);

  // Copy what changed; record everything.
  const entries: Entry[] = [];
  for (const [source, rel] of files) {
    const staged = join(stage, rel);
    const dest = join(target, rel);
    const hash = sha256(staged);
    mkdirSync(dirname(dest), { recursive: true });
    if (!existsSync(dest) || sha256(dest) !== hash) copyFileSync(staged, dest);
    entries.push({
      file: rel,
      path: dest,
      sha256: hash,
      size: statSync(dest).size,
      source,
      thumbprint: PE.test(rel) ? (after.get(staged) ?? null) : null,
    });
  }
  rmSync(stage, { recursive: true, force: true });

  // Files of the previous install that are no longer shipped, unchanged since: removed.
  const current = new Set(entries.map(e => e.path.toLowerCase()));
  for (const old of previous?.files ?? [])
    if (!current.has(old.path.toLowerCase()) && existsSync(old.path) && sha256(old.path) === old.sha256)
      rmSync(old.path, { force: true });

  const signer = run(
    ["pwsh", "-NoProfile", "-File", join(repo, "factory", "windows", "signing", "test-signing.ps1"), "status"],
    true,
  );
  const thumbprint =
    /"?Certificate"?\s*[:=]\s*"?([0-9A-F]{40})/i.exec(signer)?.[1] ??
    entries.find(e => e.thumbprint)?.thumbprint ??
    null;
  const manifest: Manifest = {
    schema: 1,
    component: "bun-dotnet-windows",
    installedAt: new Date().toISOString(),
    repoRev: run(["git", "-C", repo, "rev-parse", "HEAD"], true).trim(),
    root: target,
    thumbprint,
    files: entries,
  };
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify(
      { installed: entries.length, signed: unsigned.length, root: target, manifest: manifestPath, thumbprint },
      null,
      2,
    ),
  );
}

function uninstall(): void {
  requireAdmin();
  const manifest = readManifest();
  if (!manifest) {
    console.log("nothing installed");
    return;
  }
  let removed = 0;
  const kept: string[] = [];
  for (const f of manifest.files) {
    if (!existsSync(f.path)) continue;
    if (!f.path.toLowerCase().startsWith(target.toLowerCase())) continue;
    if (sha256(f.path) === f.sha256) {
      rmSync(f.path, { force: true });
      removed++;
    } else {
      kept.push(f.path);
    }
  }
  // Empty directories left behind, deepest first.
  const dirs = new Set<string>();
  for (const f of manifest.files) for (let d = dirname(f.path); d.length > target.length; d = dirname(d)) dirs.add(d);
  for (const d of [...dirs, target].sort((a, b) => b.length - a.length))
    if (existsSync(d) && readdirSync(d).length === 0) rmSync(d, { recursive: true, force: true });
  rmSync(manifestPath, { force: true });
  console.log(JSON.stringify({ removed, keptModified: kept }, null, 2));
}

function status(): void {
  const manifest = readManifest();
  if (!manifest) {
    console.log(JSON.stringify({ installed: false, root: target }, null, 2));
    return;
  }
  const changed = manifest.files.filter(f => !existsSync(f.path) || statSync(f.path).size !== f.size).map(f => f.file);
  console.log(
    JSON.stringify(
      {
        installed: true,
        root: manifest.root,
        installedAt: manifest.installedAt,
        repoRev: manifest.repoRev,
        thumbprint: manifest.thumbprint,
        files: manifest.files.length,
        changed,
      },
      null,
      2,
    ),
  );
}

const command = process.argv[2] ?? "status";
try {
  if (command === "install") install();
  else if (command === "uninstall") uninstall();
  else if (command === "status") status();
  else throw new Error(`unknown command '${command}' (install | uninstall | status)`);
} catch (error) {
  console.error(`bun-dotnet-windows install: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
