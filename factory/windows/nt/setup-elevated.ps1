<#
.SYNOPSIS
  Installs the Bun OS NT layer (the WinClean bridge service, the bunos-nt client, the Bun guest client, and the
  bunos.sys driver package staged for a later owner-run load) into %SystemRoot%\BunOS, like cmd.exe or explorer.exe.

.DESCRIPTION
  Layout (shares the %SystemRoot%\BunOS tree and manifest format with factory/wsl/windows/setup-elevated.ps1 and
  factory/windows/userland/install-system.ps1):
    %SystemRoot%\BunOS\bin\        bunos-nt.exe, bunos-winbridge.exe (test-signed, factory/windows/signing)
    %SystemRoot%\BunOS\nt\         bunos-win.ts (the Bun OS / WSL guest client), driver\ (bunos.sys/.inf/.cat +
                                   the post-reboot load and test scripts), install/test scripts
    %SystemRoot%\BunOS\bridge.token   32-byte hex token, admin-writable only; shared into the guest read-only
    %SystemRoot%\BunOS\manifests\nt.json   what this script installed (path, source sha256, installed sha256, signer)
    %SystemRoot%\System32\bunos-nt.exe, bunos-winbridge.exe   hard links to bin\, only when the name exists in no
                                   Windows directory (never overwrite or shadow a system file)
  Registers the BunOSWinBridge Windows service (demand start) pointing at bin\bunos-winbridge.exe service. Verifies
  every source file against SHA256SUMS, plans before changing anything, never overwrites a file it did not install
  (manifest + hash), idempotent. Does NOT load the kernel driver, enable test signing or touch boot configuration:
  that stays an owner-run step (see driver\load-driver.cmd and docs/NTCORE.md).

  Install:   C:\Windows\System32\sudo.exe pwsh -NoProfile -File setup-elevated.ps1 -Bundle <nt bundle dir>
  Plan only: pwsh -NoProfile -File setup-elevated.ps1 -Bundle <dir> -Plan
  Uninstall: C:\Windows\System32\sudo.exe pwsh -NoProfile -File setup-elevated.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$Bundle,
  [string]$Root = (Join-Path $env:SystemRoot 'BunOS'),
  [string]$LinkDir = (Join-Path $env:SystemRoot 'System32'),
  [switch]$Plan,
  [switch]$Uninstall,
  [switch]$StartBridge
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$systemRoot = [IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\')
$manifestPath = Join-Path $Root 'manifests\nt.json'
$signer = Join-Path $PSScriptRoot '..\signing\test-signing.ps1'
$service = 'BunOSWinBridge'
function Hash([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }

$previous = @{}
if (Test-Path -LiteralPath $manifestPath) {
  foreach ($e in (Get-Content $manifestPath -Raw | ConvertFrom-Json).files) { $previous[$e.path.ToLowerInvariant()] = $e }
}
$ours = { param($p) $e = $previous[$p.ToLowerInvariant()]; $e -and (Test-Path -LiteralPath $p) -and ((Hash $p) -eq $e.sha256) }

if ($Uninstall) {
  if (-not $Plan -and -not (Admin)) { throw "Uninstall needs elevation: C:\Windows\System32\sudo.exe pwsh -NoProfile -File $PSCommandPath -Uninstall" }
  if (Get-Service $service -ErrorAction SilentlyContinue) {
    Write-Host "stop + delete service $service"
    if (-not $Plan) { & sc.exe stop $service | Out-Null; & sc.exe delete $service | Out-Null }
  }
  # Links first (they share data with bin\), then payload.
  foreach ($e in ($previous.Values | Sort-Object { $_.kind -ne 'hardlink' })) {
    if (& $ours $e.path) { Write-Host "remove $($e.path)"; if (-not $Plan) { Remove-Item -LiteralPath $e.path -Force } }
    elseif (Test-Path -LiteralPath $e.path) { Write-Warning "kept $($e.path): changed since install" }
  }
  if (-not $Plan) {
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Root 'bridge.token') -Force -ErrorAction SilentlyContinue
    foreach ($d in 'nt\driver', 'nt', 'bin', 'manifests', '') {
      $dir = Join-Path $Root $d
      if ((Test-Path $dir) -and -not (Get-ChildItem -LiteralPath $dir -Force)) { Remove-Item -LiteralPath $dir }
    }
  }
  Write-Host 'Bun OS NT layer removed (the driver, if the owner loaded it, is removed with pnputil /delete-driver + sc delete BunOS).'
  return
}

if (-not $Bundle) { $Bundle = Join-Path $env:LOCALAPPDATA 'BunOS\bundle\bunos-nt' }
$Bundle = (Resolve-Path $Bundle).Path
$sums = Join-Path $Bundle 'SHA256SUMS'
if (-not (Test-Path $sums)) { throw "no SHA256SUMS in $Bundle (build-nt-bundle.ts output expected)" }
$expected = @{}
foreach ($line in Get-Content $sums) { if ($line -match '^([0-9a-f]{64})\s+\*?(.+)$') { $expected[($Matches[2] -replace '/', '\')] = $Matches[1] } }

# 1. Plan: payload (bundle-relative name -> Root-relative path). The .exe files are linked into System32 and signed.
$layout = [ordered]@{
  'bunos-nt.exe' = 'bin\bunos-nt.exe'; 'bunos-winbridge.exe' = 'bin\bunos-winbridge.exe'
  'bunos-win.ts' = 'nt\bunos-win.ts'
  'driver\bunos.sys' = 'nt\driver\bunos.sys'; 'driver\bunos.inf' = 'nt\driver\bunos.inf'; 'driver\bunos.cat' = 'nt\driver\bunos.cat'
  'driver\load-driver.cmd' = 'nt\driver\load-driver.cmd'; 'driver\test-driver.cmd' = 'nt\driver\test-driver.cmd'
  'end-to-end.ts' = 'nt\end-to-end.ts'
}
$required = 'bunos-nt.exe', 'bunos-winbridge.exe', 'bunos-win.ts'
$items = @()
foreach ($name in $layout.Keys) {
  $src = Join-Path $Bundle $name
  if (-not (Test-Path -LiteralPath $src)) { if ($required -contains $name) { throw "missing $name in $Bundle" } else { continue } }
  if (-not $expected.ContainsKey($name)) { throw "$name is not listed in SHA256SUMS" }
  if ((Hash $src) -ne $expected[$name]) { throw "sha256 mismatch: $name" }
  $dst = Join-Path $Root $layout[$name]
  $sign = $name -like '*.exe' -or $name -like '*.sys' -or $name -like '*.cat'
  # The %SystemRoot%\BunOS tree is written only by this script, so a file already there is ours to refresh (adopt),
  # even if a prior run placed it before recording the manifest or re-signing changed its hash. A path outside $Root
  # (only the System32 links are, handled below) is never overwritten.
  $underRoot = ([IO.Path]::GetFullPath($dst)).StartsWith(([IO.Path]::GetFullPath($Root)), [StringComparison]::OrdinalIgnoreCase)
  $state = if (-not (Test-Path -LiteralPath $dst)) { 'new' }
    elseif (& $ours $dst) { if ($previous[$dst.ToLowerInvariant()].source -eq $expected[$name]) { 'same' } else { 'upgrade' } }
    elseif ($underRoot) { 'upgrade' }
    else { throw "refusing to overwrite $dst (not installed by this script, or changed since)" }
  $items += [pscustomobject]@{ name = $name; src = $src; dst = $dst; source = $expected[$name]; state = $state; sign = $sign; link = ($name -like '*.exe') }
}

# System32 links only when the base name collides with nothing Windows ships.
$pathext = (($env:PATHEXT -split ';' | Where-Object { $_ }) + '.exe', '.com') | Select-Object -Unique
$windowsDirs = @((Join-Path $systemRoot 'System32'), (Join-Path $systemRoot 'SysWOW64'), $systemRoot,
  (Join-Path $systemRoot 'System32\Wbem'), (Join-Path $systemRoot 'System32\WindowsPowerShell\v1.0'),
  (Join-Path $systemRoot 'System32\OpenSSH')) | Where-Object { Test-Path -LiteralPath $_ }
$links = @()
foreach ($i in $items | Where-Object link) {
  $base = [IO.Path]::GetFileNameWithoutExtension($i.name)
  $hit = $null
  foreach ($d in $windowsDirs) {
    foreach ($e in $pathext) {
      $p = Join-Path $d "$base$e"
      $mine = (& $ours $p) -or ($p -ieq (Join-Path $LinkDir ([IO.Path]::GetFileName($i.name))) -and (Test-Path -LiteralPath $i.dst) -and (Test-Path -LiteralPath $p) -and (Hash $p) -eq (Hash $i.dst))
      if ((Test-Path -LiteralPath $p) -and -not $mine) { $hit = $p }
    }
  }
  if ($hit) { Write-Warning "no System32 link for $($i.name): would shadow $hit (use $($i.dst))"; continue }
  $links += [pscustomobject]@{ path = Join-Path $LinkDir ([IO.Path]::GetFileName($i.name)); target = $i.dst }
}
foreach ($i in $items) { Write-Host ("{0,-8} {1}" -f $i.state, $i.dst) }
foreach ($l in $links) { Write-Host ("link     {0} -> {1}" -f $l.path, $l.target) }
Write-Host ("service  {0} -> {1} service" -f $service, (Join-Path $Root 'bin\bunos-winbridge.exe'))
if ($Plan) { return }
if (-not (Admin)) { throw "Writing to $Root and $LinkDir needs elevation: C:\Windows\System32\sudo.exe pwsh -NoProfile -File $PSCommandPath -Bundle $Bundle" }

# 2. Apply.
if (Get-Service $service -ErrorAction SilentlyContinue) { & sc.exe stop $service | Out-Null }
foreach ($l in $links) { if ((Test-Path -LiteralPath $l.path) -and ($items | Where-Object { $_.dst -eq $l.target -and $_.state -in 'new', 'upgrade' })) { Remove-Item -LiteralPath $l.path -Force } }
foreach ($i in $items | Where-Object { $_.state -in 'new', 'upgrade' }) {
  New-Item -ItemType Directory -Force (Split-Path $i.dst) | Out-Null
  Copy-Item -LiteralPath $i.src -Destination $i.dst -Force
}
$toSign = @($items | Where-Object { $_.sign -and $_.state -in 'new', 'upgrade' } | ForEach-Object dst)
if ($toSign.Count) { & pwsh -NoProfile -File $signer sign @toSign; if ($LASTEXITCODE) { throw "signing failed ($LASTEXITCODE)" } }
foreach ($l in $links) { if (-not (Test-Path -LiteralPath $l.path)) { New-Item -ItemType HardLink -Path $l.path -Target $l.target | Out-Null } }

# Token (create once, admin-only ACL).
$tokenPath = Join-Path $Root 'bridge.token'
$tokenNew = -not (Test-Path -LiteralPath $tokenPath) -or -not (Get-Content -Raw -LiteralPath $tokenPath).Trim()
if ($tokenNew) {
  $bytes = [byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  ($bytes | ForEach-Object { $_.ToString('x2') }) -join '' | Set-Content -NoNewline -LiteralPath $tokenPath
}
# Always enforce the restrictive ACL (locale-independent well-known SIDs: LocalSystem + Administrators).
$acl = Get-Acl $tokenPath; $acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
foreach ($sid in 'S-1-5-18', 'S-1-5-32-544') {
  $id = [System.Security.Principal.SecurityIdentifier]::new($sid)
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($id, 'FullControl', 'Allow'))
}
$acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
Set-Acl $tokenPath $acl
if ($tokenNew) { Write-Host "created $tokenPath (SYSTEM + Administrators only)" }

# Service (demand start; the bridge reads the token store and serves hvsocket on the default port).
$bridge = Join-Path $Root 'bin\bunos-winbridge.exe'
if (-not (Get-Service $service -ErrorAction SilentlyContinue)) {
  & sc.exe create $service binPath= "`"$bridge`" service" start= demand DisplayName= "Bun OS Windows bridge" | Out-Null
  & sc.exe description $service "Serves the WinClean tool catalog and bunos.sys event streams to the Bun OS WSL guest over hvsocket." | Out-Null
  Write-Host "created service $service"
}
if ($StartBridge) { & sc.exe start $service | Out-Null; Write-Host "started $service" }

# 3. Record.
$files = @()
foreach ($i in $items) {
  $sig = if ($i.sign) { (Get-AuthenticodeSignature -LiteralPath $i.dst).SignerCertificate.Thumbprint } else { $null }
  $files += [ordered]@{ path = $i.dst; kind = 'file'; source = $i.source; sha256 = Hash $i.dst; bytes = (Get-Item $i.dst).Length; signer = $sig }
}
foreach ($l in $links) { $files += [ordered]@{ path = $l.path; kind = 'hardlink'; target = $l.target; sha256 = Hash $l.path } }
$bundleManifest = Join-Path $Bundle 'manifest.json'
$meta = if (Test-Path $bundleManifest) { Get-Content $bundleManifest -Raw | ConvertFrom-Json } else { $null }
New-Item -ItemType Directory -Force (Split-Path $manifestPath) | Out-Null
[ordered]@{
  schema       = 1
  kind         = 'bunos-windows-nt'
  installed    = (Get-Date).ToString('o')
  root         = $Root
  service      = $service
  bundle       = @{ revision = $meta.repository.revision; built = $meta.built }
  files        = $files
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath
Write-Host "manifest $manifestPath"
Write-Host 'Bun OS NT layer installed. Bridge: sc start BunOSWinBridge. Driver load is an owner step: nt\driver\load-driver.cmd (needs Secure Boot off + test signing; see docs/NTCORE.md).'
