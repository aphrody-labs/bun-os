// SPDX-License-Identifier: Apache-2.0
// Windows: build script for the compiled `.exe` (cross-compiled from any OS), and service scripts. A Bun
// executable does not speak the Windows service control protocol, so `sc.exe create` on it fails with error 1053.
// The scripts therefore use WinSW (https://github.com/winsw/winsw, drop `WinSW-x64.exe` next to them) when it is
// there, and a scheduled task that starts at boot as the fallback.
// The desktop side installs per user without elevation: Start menu and desktop shortcuts and an Apps & features
// entry under HKCU. The application icon is an SVG (a Material Symbol from @aphrody/material-design-icons, the
// app's own, or the Aphrody emblem of @aphrody/identity) that build-windows.ts turns into icon.ico with
// m3-svg-to-ico before compiling; windows-check.ts reads the result back through the registry (inspectWindows).
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { GENERATED_NOTE } from "../util.ts";
import { appFromTarget } from "./lambda.ts";
import type { Target, TargetContext, TargetFile } from "./types.ts";
import { shortcutName, uninstallKey } from "./windows-inspect.ts";

export const buildScript = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Build ${c.name}.exe (Windows x64) with its icon and metadata through build-windows.ts; Bun cross-compiles from
# any OS but applies the icon only on a Windows host.
$ErrorActionPreference = 'Stop'
& bun (Join-Path $PSScriptRoot 'build-windows.ts') @args
if ($LASTEXITCODE -ne 0) { throw 'build-windows.ts failed' }
`;

/** Bun script: icon.svg to icons/icon.ico (m3-svg-to-ico), then compileApp for windows-x64 with the metadata. */
export const buildTs = (c: TargetContext): string => `#!/usr/bin/env bun
// ${GENERATED_NOTE}
// ${c.name}.exe: icons/icon.ico from icon.svg (m3-svg-to-ico, Tauri CLI), then \`compile --target windows-x64\`
// with the icon, title and publisher, and out/SHA256SUMS.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { compileApp, loadApp } from "@aphrody/m3-bun";
import { windowsIcon } from "@aphrody/m3-bun/targets";

const here = import.meta.dir;
const ico = existsSync(join(here, "icons", "icon.ico")) ? join(here, "icons", "icon.ico") : windowsIcon(join(here, "icon.svg"), join(here, "icons"));
const app = await loadApp(join(here, ${JSON.stringify(appFromTarget(c))}));
app.bun.compile = {
  ...app.bun.compile,
  windows: {
    title: ${JSON.stringify(c.windows?.title ?? c.name)},
    publisher: ${JSON.stringify(c.windows?.publisher ?? c.name)},
    description: ${JSON.stringify(c.windows?.description ?? `${c.name}: M3 app, UI and API from one executable`)},
    version: ${JSON.stringify(c.version)},
    ...app.bun.compile?.windows,
    icon: ico,
  },
};
const report = await compileApp({ app, target: "windows-x64", outfile: join(here, "out", ${JSON.stringify(`${c.name}.exe`)}) });
for (const warning of report.warnings) console.warn(warning);
const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(report.outfile).bytes()).digest("hex");
await Bun.write(join(here, "out", "SHA256SUMS"), \`\${hash}  ${c.name}.exe\\n\`);
console.log(\`built \${report.outfile} (\${hash})\`);
`;

const ps = (value: string): string => value.replaceAll("'", "''");
const registryPath = (c: TargetContext): string => `Registry::${uninstallKey(c).replace(/^HKCU/, "HKEY_CURRENT_USER")}`;

/** Per-user desktop install: copy the .exe, Start menu and desktop shortcuts, Apps & features entry (HKCU). */
export const installAppScript = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Installs ${c.name} for the current user, no elevation: the executable under %LOCALAPPDATA%\\Programs, Start menu
# and desktop shortcuts, and an Apps & features entry. Nothing runs until you do; bun windows-check.ts verifies it.
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\\${c.name}'),
  [switch]$NoDesktopShortcut
)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'out\\${c.name}.exe'
if (-not (Test-Path $exe)) { throw "missing $exe (run build-windows.ps1)" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item $exe $InstallDir -Force
Copy-Item (Join-Path $PSScriptRoot 'uninstall-app.ps1') $InstallDir -Force
$target = Join-Path $InstallDir '${c.name}.exe'

$shell = New-Object -ComObject WScript.Shell
$folders = @([Environment]::GetFolderPath('Programs'))
if (-not $NoDesktopShortcut) { $folders += [Environment]::GetFolderPath('Desktop') }
foreach ($folder in $folders) {
  $link = $shell.CreateShortcut((Join-Path $folder '${ps(shortcutName(c))}'))
  $link.TargetPath = $target
  $link.WorkingDirectory = $InstallDir
  $link.IconLocation = "$target,0"
  $link.Description = '${ps(c.windows?.description ?? c.name)}'
  $link.Save()
}

$key = '${registryPath(c)}'
New-Item -Path $key -Force | Out-Null
$values = [ordered]@{
  DisplayName = '${ps(c.windows?.title ?? c.name)}'
  DisplayVersion = '${c.version}'
  Publisher = '${ps(c.windows?.publisher ?? c.name)}'
  DisplayIcon = "$target,0"
  InstallLocation = $InstallDir
  UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \`"$(Join-Path $InstallDir 'uninstall-app.ps1')\`""
}
foreach ($name in $values.Keys) { New-ItemProperty -Path $key -Name $name -Value $values[$name] -PropertyType String -Force | Out-Null }
New-ItemProperty -Path $key -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $key -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
Write-Host "installed $target"
`;

export const uninstallAppScript = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Removes the per-user install of ${c.name}: shortcuts, Apps & features entry and install folder.
$ErrorActionPreference = 'Stop'
$key = '${registryPath(c)}'
$dir = if (Test-Path $key) { (Get-ItemProperty $key).InstallLocation } else { $null }
foreach ($folder in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  Remove-Item (Join-Path $folder '${ps(shortcutName(c))}') -Force -ErrorAction SilentlyContinue
}
if (Test-Path $key) { Remove-Item $key -Recurse -Force }
if ($dir -and (Test-Path $dir)) { Remove-Item $dir -Recurse -Force }
Write-Host 'removed ${c.name}'
`;

export const checkScript = (c: TargetContext): string => `#!/usr/bin/env bun
// ${GENERATED_NOTE}
// Read-only check of the Windows install of ${c.name} through the registry and sc.exe: executable, shortcuts,
// Apps & features entry, service. Exit status 1 when the executable is missing or not version ${c.version}.
import { inspectWindows } from "@aphrody/m3-bun/targets";

const report = await inspectWindows(${JSON.stringify({ name: c.name, version: c.version, ...(c.windows ? { windows: c.windows } : {}) })});
console.log(JSON.stringify(report, null, 2));
process.exit(report.executable.exists && report.upToDate ? 0 : 1);
`;

/** A PNG inside a square SVG, the input m3-svg-to-ico takes. */
export const pngSvg = (png: Uint8Array, size: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image width="${size}" height="${size}" xlink:href="data:image/png;base64,${Buffer.from(png).toString("base64")}"/></svg>\n`;

/**
 * The application icon: `windows.icon` of the config (`.ico` as is, `.svg`), a Material Symbol named by
 * `iconSymbol` in the seed colour (the @aphrody/material-design-icons catalogue, else the m3-bun icon loader),
 * or the Aphrody emblem of @aphrody/identity.
 */
export async function iconFile(c: TargetContext): Promise<TargetFile> {
  const own = c.windows?.icon;
  if (own) {
    if (!c.appDir) throw new Error("m3-bun: windows.icon needs the app directory");
    const path = resolve(c.appDir, own);
    if (!existsSync(path)) throw new Error(`m3-bun: windows.icon ${own} does not exist`);
    const ext = extname(path).toLowerCase();
    if (ext === ".ico")
      return {
        path: "icons/icon.ico",
        content: new Uint8Array(readFileSync(path)),
      };
    if (ext !== ".svg") throw new Error(`m3-bun: windows.icon must be .ico or .svg, got ${own}`);
    return { path: "icon.svg", content: readFileSync(path, "utf8") };
  }
  if (c.iconSymbol) {
    const symbol = c.iconSymbol;
    let symbols: typeof import("@aphrody/material-design-icons");
    try {
      symbols = await import("@aphrody/material-design-icons");
    } catch (error) {
      throw new Error(
        `m3-bun: the windows icon ${symbol} needs @aphrody/material-design-icons (${(error as Error).message})`,
        { cause: error },
      );
    }
    const svg = symbols.hasSymbol(symbol)
      ? symbols.readSymbolSvg(symbol)
      : await import("../icons.ts").then(({ loadIcon, parseIconSpecifier }) => loadIcon(parseIconSpecifier(symbol)));
    return {
      path: "icon.svg",
      content: svg.replace(/<svg /, `<svg fill="${c.seed ?? "#6750a4"}" `),
    };
  }
  let emblem: string;
  try {
    emblem = join(dirname(Bun.resolveSync("@aphrody/identity", import.meta.dir)), "../assets/icon-192.png");
  } catch (error) {
    throw new Error(`m3-bun: the default windows icon needs @aphrody/identity (${(error as Error).message})`, {
      cause: error,
    });
  }
  return {
    path: "icon.svg",
    content: pngSvg(new Uint8Array(readFileSync(emblem)), 192),
  };
}

/** `m3-svg-to-ico <svg> --out <dir>` (@aphrody/material-design-icons, through the Tauri CLI); returns `<dir>/icon.ico`. */
export function windowsIcon(svg: string, outDir: string): string {
  let cli: string;
  try {
    cli = join(dirname(Bun.resolveSync("@aphrody/material-design-icons", import.meta.dir)), "../scripts/svg-to-ico.ts");
  } catch (error) {
    throw new Error(`m3-bun: windowsIcon needs @aphrody/material-design-icons (${(error as Error).message})`, {
      cause: error,
    });
  }
  const run = Bun.spawnSync([process.execPath, cli, svg, "--out", outDir], {
    windowsHide: true,
    cwd: dirname(svg),
    stdout: "pipe",
    stderr: "pipe",
  });
  const ico = join(outDir, "icon.ico");
  if (run.exitCode !== 0 || !existsSync(ico))
    throw new Error(
      `m3-bun: m3-svg-to-ico ${svg} failed (${run.exitCode}): ${run.stderr.toString().trim() || run.stdout.toString().trim()}`,
    );
  return ico;
}

export const installScript = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Installs ${c.name} as a Windows service through WinSW, or as a boot-time scheduled task when WinSW is absent.
# Run from an elevated PowerShell next to ${c.name}.exe (and WinSW-x64.exe, if you have it). Nothing runs until you do.
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles '${c.name}'),
  [int]$Port = ${c.port},
  [switch]$OpenFirewall
)
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'run this script as Administrator' }

$exe = Join-Path $PSScriptRoot '${c.name}.exe'
if (-not (Test-Path $exe)) { throw "missing $exe (run build-windows.ps1)" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item $exe $InstallDir -Force

$winsw = Join-Path $PSScriptRoot 'WinSW-x64.exe'
if (Test-Path $winsw) {
  $svc = Join-Path $InstallDir '${c.name}-service.exe'
  Copy-Item $winsw $svc -Force
  (Get-Content (Join-Path $PSScriptRoot '${c.name}-service.xml') -Raw).Replace('__PORT__', "$Port") | Set-Content -Encoding utf8 (Join-Path $InstallDir '${c.name}-service.xml')
  & $svc install
  & $svc start
  Write-Host 'service installed with WinSW'
} else {
  $action = New-ScheduledTaskAction -Execute (Join-Path $InstallDir '${c.name}.exe') -WorkingDirectory $InstallDir
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -Hidden -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName '${c.name}' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  [Environment]::SetEnvironmentVariable('PORT', "$Port", 'Machine')
  Start-ScheduledTask -TaskName '${c.name}'
  Write-Host 'WinSW not found: registered a boot-time scheduled task instead'
}
if ($OpenFirewall) {
  New-NetFirewallRule -DisplayName '${c.name}' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}
`;

export const uninstallScript = (c: TargetContext): string => `# ${GENERATED_NOTE}
[CmdletBinding()]
param([string]$InstallDir = (Join-Path $env:ProgramFiles '${c.name}'))
$ErrorActionPreference = 'Stop'
$svc = Join-Path $InstallDir '${c.name}-service.exe'
if (Test-Path $svc) { & $svc stop; & $svc uninstall }
if (Get-ScheduledTask -TaskName '${c.name}' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName '${c.name}' -Confirm:$false }
Get-NetFirewallRule -DisplayName '${c.name}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'removed; ${c.name}.exe and its folder are left in place'
`;

export const winswXml = (c: TargetContext): string => `<?xml version="1.0" encoding="utf-8"?>
<!-- ${GENERATED_NOTE} -->
<service>
  <id>${c.name}</id>
  <name>${c.windows?.title ?? c.name}</name>
  <description>${c.windows?.description ?? `${c.name}: M3 app, UI and API from one executable`}</description>
  <executable>%BASE%\\${c.name}.exe</executable>
  <env name="PORT" value="__PORT__" />
  <env name="HOST" value="0.0.0.0" />
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
  <onfailure action="restart" delay="5 sec" />
  <onfailure action="restart" delay="30 sec" />
  <startmode>Automatic</startmode>
</service>
`;

export const windows: Target = {
  id: "windows",
  title: "Windows",
  description:
    "build-windows.ps1/.ts (.exe with icon.ico from m3-svg-to-ico), per-user install (shortcuts, Apps & features), WinSW service or boot task, windows-check.ts (registry)",
  async generate(c): Promise<TargetFile[]> {
    return [
      await iconFile(c),
      { path: "build-windows.ps1", content: buildScript(c) },
      { path: "build-windows.ts", content: buildTs(c), mode: 0o755 },
      { path: "install-app.ps1", content: installAppScript(c) },
      { path: "uninstall-app.ps1", content: uninstallAppScript(c) },
      { path: "windows-check.ts", content: checkScript(c), mode: 0o755 },
      { path: "install-service.ps1", content: installScript(c) },
      { path: "uninstall-service.ps1", content: uninstallScript(c) },
      { path: `${c.name}-service.xml`, content: winswXml(c) },
    ];
  },
};
