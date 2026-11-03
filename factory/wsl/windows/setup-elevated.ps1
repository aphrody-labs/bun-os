<#
.SYNOPSIS
  Installs the Bun OS for Windows bundle (WSL kernel, modules VHD, bunos distro image, docker.exe, bunos.exe) into
  %SystemRoot%\BunOS, like cmd.exe or explorer.exe, then runs the per-user part (install.ts).

.DESCRIPTION
  Layout (shared with factory/windows/userland/install-system.ps1):
    %SystemRoot%\BunOS\wsl\        bzImage, modules.vhdx, bunos-wsl.wsl, waydroid-src.tar.gz, installer + templates
    %SystemRoot%\BunOS\bin\        docker.exe, bunos.exe (test-signed, factory/windows/signing)
    %SystemRoot%\BunOS\manifests\wsl.json   what this script installed: path, source sha256, installed sha256, signer
    %SystemRoot%\System32\docker.exe, bunos.exe   hard links to bin\ (no copy, no launcher process), only when the name
                                   exists in no Windows directory with any PATHEXT extension
  Verifies every file against the bundle's SHA256SUMS, plans before changing anything, never overwrites a file it did
  not install (manifest + hash), idempotent. PowerShell because hard links, signing and the admin check are
  Windows-only APIs; the per-user part (.wslconfig, distro, Docker context) is install.ts (Bun).

  Install:   C:\Windows\System32\sudo.exe pwsh -NoProfile -File setup-elevated.ps1 -Bundle <bunos-windows dir>
  Plan only: pwsh -NoProfile -File setup-elevated.ps1 -Bundle <dir> -Plan
  Uninstall: C:\Windows\System32\sudo.exe pwsh -NoProfile -File setup-elevated.ps1 -Uninstall
             (removes exactly what manifests\wsl.json lists, restores the backed-up .wslconfig/.wslgconfig; the bunos
             distro is kept: `wsl --unregister bunos` removes it and its disk)
#>
[CmdletBinding()]
param(
  [string]$Bundle,
  [string]$Root = (Join-Path $env:SystemRoot 'BunOS'),
  [string]$LinkDir = (Join-Path $env:SystemRoot 'System32'),
  [switch]$Plan,
  [switch]$Uninstall,
  [switch]$SkipUser,
  [switch]$Native
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$systemRoot = [IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\')
$manifestPath = Join-Path $Root 'manifests\wsl.json'
$signer = Join-Path $PSScriptRoot '..\..\windows\signing\test-signing.ps1'
function Hash([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
function Bun { $b = Get-Command bun -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($b) { $b.Source } else { throw "bun not found on PATH" } }

$previous = @{}
if (Test-Path -LiteralPath $manifestPath) {
  foreach ($e in (Get-Content $manifestPath -Raw | ConvertFrom-Json).files) { $previous[$e.path.ToLowerInvariant()] = $e }
}
$ours = { param($p) $e = $previous[$p.ToLowerInvariant()]; $e -and (Test-Path -LiteralPath $p) -and ((Hash $p) -eq $e.sha256) }
# After an interrupted run (files copied, no record yet) a file is still recognisably ours: same bytes as the bundle,
# or an .exe signed with the Bun OS test-signing certificate (factory/windows/signing).
$ourCert = Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object Subject -like 'CN=Bun OS Test Signing*' | Select-Object -First 1 -ExpandProperty Thumbprint
$adoptable = { param($p, $sha) (Test-Path -LiteralPath $p) -and (((Hash $p) -eq $sha) -or ($ourCert -and $p -like '*.exe' -and (Get-AuthenticodeSignature -LiteralPath $p).SignerCertificate.Thumbprint -eq $ourCert)) }

if ($Uninstall) {
  if (-not $Plan -and -not (Admin)) { throw "Uninstall needs elevation: C:\Windows\System32\sudo.exe pwsh -NoProfile -File $PSCommandPath -Uninstall" }
  # Links first (they share data with bin\), then payload.
  foreach ($e in ($previous.Values | Sort-Object { $_.kind -ne 'hardlink' })) {
    if (& $ours $e.path) { Write-Host "remove $($e.path)"; if (-not $Plan) { Remove-Item -LiteralPath $e.path -Force } }
    elseif (Test-Path -LiteralPath $e.path) { Write-Warning "kept $($e.path): changed since install" }
  }
  foreach ($cfg in '.wslconfig', '.wslgconfig') {
    $p = Join-Path $env:USERPROFILE $cfg
    if (Test-Path -LiteralPath "$p.bunos-backup") { Write-Host "restore $p"; if (-not $Plan) { Move-Item -Force "$p.bunos-backup" $p } }
    elseif (Test-Path -LiteralPath "$p.bunos-absent") { Write-Host "remove $p (did not exist before)"; if (-not $Plan) { Remove-Item -Force $p, "$p.bunos-absent" } }
  }
  if (-not $Plan) {
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
    foreach ($d in 'wsl', 'bin', 'manifests', '') {
      $dir = Join-Path $Root $d
      if ((Test-Path $dir) -and -not (Get-ChildItem -LiteralPath $dir -Force)) { Remove-Item -LiteralPath $dir }
    }
    & "$env:SystemRoot\System32\wsl.exe" --shutdown
  }
  Write-Host 'Bun OS for Windows removed (distro kept: wsl --unregister bunos removes it).'
  return
}

if (-not $Bundle) { $Bundle = Join-Path $env:LOCALAPPDATA 'BunOS\bundle\bunos-windows' }
$Bundle = (Resolve-Path $Bundle).Path
$sums = Join-Path $Bundle 'SHA256SUMS'
if (-not (Test-Path $sums)) { throw "no SHA256SUMS in $Bundle (bundle.sh output expected)" }
$expected = @{}
foreach ($line in Get-Content $sums) { if ($line -match '^([0-9a-f]{64})\s+\*?(.+)$') { $expected[$Matches[2]] = $Matches[1] } }

# 1. Plan: payload files (bundle name -> Root-relative path) and System32 links.
$layout = [ordered]@{
  'bzImage' = 'wsl\bzImage'; 'modules.vhdx' = 'wsl\modules.vhdx'; 'bunos-wsl.wsl' = 'wsl\bunos-wsl.wsl'
  'waydroid-src.tar.gz' = 'wsl\waydroid-src.tar.gz'; 'bunos-wsl-native.sh' = 'wsl\bunos-wsl-native.sh'
  'install.ts' = 'wsl\install.ts'; 'latency.ts' = 'wsl\latency.ts'
  'wslconfig.template' = 'wsl\wslconfig.template'; 'wslgconfig.template' = 'wsl\wslgconfig.template'
  'docker.exe' = 'bin\docker.exe'; 'bunos.exe' = 'bin\bunos.exe'
}
$required = 'bzImage', 'modules.vhdx', 'bunos-wsl.wsl', 'install.ts', 'wslconfig.template', 'wslgconfig.template'
$items = @()
foreach ($name in $layout.Keys) {
  $src = Join-Path $Bundle $name
  if (-not (Test-Path -LiteralPath $src)) { if ($required -contains $name) { throw "missing $name in $Bundle" } else { continue } }
  if (-not $expected.ContainsKey($name)) { throw "$name is not listed in SHA256SUMS" }
  if ((Hash $src) -ne $expected[$name]) { throw "sha256 mismatch: $name" }
  $dst = Join-Path $Root $layout[$name]
  $state = if (-not (Test-Path -LiteralPath $dst)) { 'new' }
    elseif ($previous[$dst.ToLowerInvariant()] -and $previous[$dst.ToLowerInvariant()].source -eq $expected[$name] -and (& $ours $dst)) { 'same' }
    elseif (& $ours $dst) { 'upgrade' }
    elseif (& $adoptable $dst $expected[$name]) { if ((Hash $dst) -eq $expected[$name] -or $name -like '*.exe') { 'adopt' } }
    else { throw "refusing to overwrite $dst (not installed by this script, or changed since)" }
  $items += [pscustomobject]@{ name = $name; src = $src; dst = $dst; source = $expected[$name]; state = $state; sign = $name -like '*.exe' }
}
$pathext = (($env:PATHEXT -split ';' | Where-Object { $_ }) + '.exe', '.com') | Select-Object -Unique
$windowsDirs = @((Join-Path $systemRoot 'System32'), (Join-Path $systemRoot 'SysWOW64'), $systemRoot,
  (Join-Path $systemRoot 'System32\Wbem'), (Join-Path $systemRoot 'System32\WindowsPowerShell\v1.0'),
  (Join-Path $systemRoot 'System32\OpenSSH')) | Where-Object { Test-Path -LiteralPath $_ }
$links = @()
foreach ($i in $items | Where-Object sign) {
  $base = [IO.Path]::GetFileNameWithoutExtension($i.name)
  $hit = $null
  foreach ($d in $windowsDirs) {
    foreach ($e in $pathext) {
      $p = Join-Path $d "$base$e"
      # Our own earlier link (same bytes as the payload we just placed or are about to) is not a collision.
      $mine = (& $ours $p) -or ($p -ieq (Join-Path $LinkDir $i.name) -and (Test-Path -LiteralPath $i.dst) -and (Test-Path -LiteralPath $p) -and (Hash $p) -eq (Hash $i.dst))
      if ((Test-Path -LiteralPath $p) -and -not $mine) { $hit = $p }
    }
  }
  if ($hit) { Write-Warning "no System32 link for $($i.name): would shadow $hit (use $($i.dst))"; continue }
  $links += [pscustomobject]@{ path = Join-Path $LinkDir $i.name; target = $i.dst }
}
foreach ($i in $items) { Write-Host ("{0,-8} {1}" -f $i.state, $i.dst) }
foreach ($l in $links) { Write-Host ("link     {0} -> {1}" -f $l.path, $l.target) }
if ($Plan) { return }
if (-not (Admin)) { throw "Writing to $Root and $LinkDir needs elevation: C:\Windows\System32\sudo.exe pwsh -NoProfile -File $PSCommandPath -Bundle $Bundle" }

# 2. Apply. A running WSL VM holds bzImage/modules.vhdx open: stop it before replacing them.
if ($items | Where-Object { $_.state -eq 'upgrade' -and $_.dst -like '*\wsl\*' }) { & "$env:SystemRoot\System32\wsl.exe" --shutdown }
foreach ($l in $links) { if ((Test-Path -LiteralPath $l.path) -and ($items | Where-Object { $_.dst -eq $l.target -and $_.state -in 'new', 'upgrade' })) { Remove-Item -LiteralPath $l.path -Force } }
foreach ($i in $items | Where-Object { $_.state -in 'new', 'upgrade' }) {
  New-Item -ItemType Directory -Force (Split-Path $i.dst) | Out-Null
  Copy-Item -LiteralPath $i.src -Destination $i.dst -Force
}
$toSign = @($items | Where-Object { $_.sign -and $_.state -in 'new', 'upgrade' } | ForEach-Object dst)
if ($toSign.Count) { & pwsh -NoProfile -File $signer sign @toSign; if ($LASTEXITCODE) { throw "signing failed ($LASTEXITCODE)" } }
foreach ($l in $links) { if (-not (Test-Path -LiteralPath $l.path)) { New-Item -ItemType HardLink -Path $l.path -Target $l.target | Out-Null } }

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
  kind = 'bunos-windows-wsl'; component = 'wsl'; installed = (Get-Date).ToUniversalTime().ToString('o')
  bundle = $Bundle; commit = ${meta}?.commit; kernelrelease = ${meta}?.kernelrelease; files = $files
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
Write-Host "manifest $manifestPath ($($files.Count) entries)"

# 4. Per-user part (same account under sudo): .wslconfig -> %SystemRoot%\BunOS\wsl, distro, Docker context.
if (-not $SkipUser) {
  $ia = @((Join-Path $Root 'wsl\install.ts'), '--bundle', (Join-Path $Root 'wsl'), '--dest', (Join-Path $Root 'wsl'), '--no-copy')
  if ($Native) { $ia += '--native' }
  & (Bun) @ia
  if ($LASTEXITCODE) { throw "install.ts failed ($LASTEXITCODE)" }
}
