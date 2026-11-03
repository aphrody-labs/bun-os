<#
.SYNOPSIS
  Installs the Bun OS Windows userland (factory/windows/userland/build.ts) as first-class system tools.

.DESCRIPTION
  Payload (multicall binaries, helix runtime, licences, manifest) goes to %SystemRoot%\BunOS\userland. Every command
  name is exposed in %SystemRoot%\System32 as a hard link to its payload binary, like cmd.exe, unless that would
  shadow a Windows file:
    - a name that exists with any PATHEXT extension in System32, SysWOW64, %SystemRoot%, Wbem,
      WindowsPowerShell\v1.0 or OpenSSH (find, sort, where, more, tar, curl, bash, ...) gets the uutils `u` prefix
      (ufind, usort, ...), which the coreutils multicall resolves by suffix; if the prefixed name also exists, the
      command stays only inside its multicall (`coreutils <name>`);
    - names Windows' installer detection would auto-elevate (install, setup, update, patch) and `link` (the MSVC
      linker on PATH) are never linked.
  The script verifies every sha256 in manifest.json, plans everything before changing anything, refuses to overwrite
  any file it did not install itself (install-record.json), and is idempotent. Upgrades replace only files whose
  current hash matches the record. Machine env: HELIX_RUNTIME (only if unset or ours).

  Elevated:  C:\Windows\System32\sudo.exe pwsh -NoProfile -File factory\windows\userland\install-system.ps1 -Source <dir>
  Staging (no elevation, same logic): pwsh -File install-system.ps1 -Source <dir> -Root <dir> -LinkDir <dir>
  Uninstall: uninstall-system.ps1 (removes exactly what install-record.json lists).
#>
[CmdletBinding()]
param(
  [string]$Source,
  [string]$Root = (Join-Path $env:SystemRoot 'BunOS\userland'),
  [string]$LinkDir = (Join-Path $env:SystemRoot 'System32'),
  [switch]$Plan
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $Source) {
  $staging = Join-Path $env:LOCALAPPDATA 'bunos\userland\staging'
  $Source = Get-ChildItem $staging -Directory -Filter 'userland-*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $Source) { throw "No -Source given and nothing staged in $staging" }
}
$Source = (Resolve-Path $Source).Path
$manifestPath = Join-Path $Source 'manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($manifest.kind -ne 'bunos-windows-userland') { throw "$manifestPath is not a Bun OS userland manifest" }

$systemRoot = [IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\')
$underSystem = { param($p) [IO.Path]::GetFullPath($p).StartsWith($systemRoot, [StringComparison]::OrdinalIgnoreCase) }
if (((& $underSystem $Root) -or (& $underSystem $LinkDir)) -and -not $Plan) {
  $id = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $id.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Writing to $Root and $LinkDir needs elevation: C:\Windows\System32\sudo.exe pwsh -NoProfile -File $PSCommandPath -Source $Source"
  }
}

function Hash([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }

# 1. Verify the payload against the manifest.
$payload = @()
foreach ($tool in $manifest.tools) {
  foreach ($f in $tool.files) {
    $src = Join-Path $Source ($f.path -replace '/', '\')
    if (-not (Test-Path -LiteralPath $src)) { throw "missing payload file $($f.path)" }
    if ((Hash $src) -ne $f.sha256) { throw "sha256 mismatch for $($f.path)" }
    if ($src -like '*.exe' -and $manifest.PSObject.Properties.Name -contains 'signing') {
      $sig = Get-AuthenticodeSignature -LiteralPath $src
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Thumbprint -ne $manifest.signing.thumbprint) {
        throw "Authenticode check failed for $($f.path): $($sig.Status) $($sig.SignerCertificate.Thumbprint)"
      }
    }
    $payload += [pscustomobject]@{ tool = $tool.name; rel = $f.path; src = $src; dst = Join-Path $Root ($f.path -replace '/', '\'); sha256 = $f.sha256 }
  }
}
Write-Host "verified $($payload.Count) payload files from $Source"

# 2. Previous record: the only files this script may replace or remove.
$recordPath = Join-Path $Root 'install-record.json'
$previous = @{}
$previousEnv = @()
if (Test-Path -LiteralPath $recordPath) {
  $rec = Get-Content $recordPath -Raw | ConvertFrom-Json
  foreach ($e in $rec.files) { $previous[$e.path.ToLowerInvariant()] = $e.sha256 }
  if ($rec.PSObject.Properties.Name -contains 'env') { $previousEnv = @($rec.env) }
}
$ours = { param($p) $k = $p.ToLowerInvariant(); $previous.ContainsKey($k) -and (Test-Path -LiteralPath $p) -and ((Hash $p) -eq $previous[$k]) }

# 3. Command names: collision rules.
$pathext = ($env:PATHEXT -split ';' | Where-Object { $_ }) + '.exe' + '.com' | Select-Object -Unique
$windowsDirs = @(
  (Join-Path $systemRoot 'System32'), (Join-Path $systemRoot 'SysWOW64'), $systemRoot,
  (Join-Path $systemRoot 'System32\Wbem'), (Join-Path $systemRoot 'System32\WindowsPowerShell\v1.0'),
  (Join-Path $systemRoot 'System32\OpenSSH')
) | Where-Object { Test-Path -LiteralPath $_ }
$never = @('link')
$installerHeuristic = 'install|setup|update|patch'
$reservedDevice = '^(con|prn|aux|nul|com[0-9]|lpt[0-9])$'
function Collides([string]$name) {
  foreach ($d in $windowsDirs) {
    foreach ($e in $pathext) {
      $p = Join-Path $d "$name$e"
      if ((Test-Path -LiteralPath $p) -and -not (& $ours $p)) { return $p }
    }
  }
  return $null
}
$decisions = @()
$links = @()
$taken = @{}
foreach ($tool in $manifest.tools) {
  foreach ($c in $tool.commands) {
    $name = $c.name
    $target = Join-Path $Root ($c.file -replace '/', '\')
    $multicall = [IO.Path]::GetFileNameWithoutExtension($c.file)
    $reason = $null; $linkName = $null
    if ($never -contains $name) { $reason = "reserved name (MSVC link.exe)" }
    elseif ($name -match $installerHeuristic) { $reason = 'installer-detection name; use the multicall' }
    elseif ($name -match $reservedDevice -or $name -match '[\\/:*?"<>|]') { $reason = 'not a valid file name' }
    else {
      $hit = Collides $name
      if (-not $hit) { $linkName = $name }
      else {
        # The multicalls (coreutils, diffutils) dispatch on the name suffix, so u<name> runs <name>.
        $hit2 = Collides "u$name"
        if (-not $hit2) { $linkName = "u$name"; $reason = "would shadow $hit" }
        else { $reason = "would shadow $hit and $hit2" }
      }
    }
    if ($linkName -and $taken.ContainsKey($linkName.ToLowerInvariant())) { $reason = "name already used by $($taken[$linkName.ToLowerInvariant()])"; $linkName = $null }
    if ($linkName) {
      $taken[$linkName.ToLowerInvariant()] = $tool.name
      $links += [pscustomobject]@{ name = $linkName; path = Join-Path $LinkDir "$linkName.exe"; target = $target; sha256 = ($payload | Where-Object { $_.dst -eq $target } | Select-Object -First 1).sha256 }
    }
    $how = if ($linkName) { "$linkName.exe" } else { "$multicall $name" }
    $decisions += [pscustomobject]@{ tool = $tool.name; command = $name; invoke = $how; reason = $reason }
  }
}

# 4. Plan: refuse any foreign file before touching anything.
$conflicts = @()
foreach ($p in $payload) { if ((Test-Path -LiteralPath $p.dst) -and -not (& $ours $p.dst) -and ((Hash $p.dst) -ne $p.sha256)) { $conflicts += $p.dst } }
foreach ($l in $links) { if ((Test-Path -LiteralPath $l.path) -and -not (& $ours $l.path)) { $conflicts += $l.path } }
if ($conflicts) { throw "refusing to overwrite files this installer does not own:`n  $($conflicts -join "`n  ")" }

$renamed = $decisions | Where-Object { $_.reason }
Write-Host "$($links.Count) commands linked into $LinkDir; $(@($renamed).Count) renamed or multicall-only:"
$renamed | ForEach-Object { Write-Host ("  {0,-12} -> {1,-22} {2}" -f $_.command, $_.invoke, $_.reason) }
if ($Plan) { return }

# 5. Remove our previous files that this version no longer ships or changes (links first, then payload).
$newLinkSet = @{}; foreach ($l in $links) { $newLinkSet[$l.path.ToLowerInvariant()] = $l.sha256 }
$newPayloadSet = @{}; foreach ($p in $payload) { $newPayloadSet[$p.dst.ToLowerInvariant()] = $p.sha256 }
foreach ($k in @($previous.Keys)) {
  $want = if ($newLinkSet.ContainsKey($k)) { $newLinkSet[$k] } elseif ($newPayloadSet.ContainsKey($k)) { $newPayloadSet[$k] } else { $null }
  if ((Test-Path -LiteralPath $k) -and $want -ne $previous[$k]) {
    if (& $ours $k) { Remove-Item -LiteralPath $k -Force } else { Write-Warning "kept $k (changed since install)" }
  }
}

# 6. Payload, then hard links (same volume as System32; copy as a fallback).
$installed = @()
foreach ($p in $payload) {
  if (-not ((Test-Path -LiteralPath $p.dst) -and (Hash $p.dst) -eq $p.sha256)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $p.dst) | Out-Null
    Copy-Item -LiteralPath $p.src -Destination $p.dst -Force
  }
  $installed += [pscustomobject]@{ path = $p.dst; sha256 = $p.sha256; kind = 'payload' }
}
foreach ($f in 'install-system.ps1', 'uninstall-system.ps1') {
  $s = Join-Path $PSScriptRoot $f
  if (Test-Path -LiteralPath $s) { Copy-Item -LiteralPath $s -Destination (Join-Path $Root $f) -Force }
}
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $Root 'manifest.json') -Force
New-Item -ItemType Directory -Force -Path $LinkDir | Out-Null
foreach ($l in $links) {
  if (-not (Test-Path -LiteralPath $l.path)) {
    try { New-Item -ItemType HardLink -Path $l.path -Target $l.target | Out-Null }
    catch { Copy-Item -LiteralPath $l.target -Destination $l.path }
  }
  $installed += [pscustomobject]@{ path = $l.path; sha256 = $l.sha256; kind = 'link' }
}

# 7. Environment (machine scope only for a system install).
$envRecords = @()
$hxRuntime = Join-Path $Root 'share\helix\runtime'
if ((& $underSystem $Root) -and (Test-Path -LiteralPath $hxRuntime)) {
  $cur = [Environment]::GetEnvironmentVariable('HELIX_RUNTIME', 'Machine')
  $prevOurs = $previousEnv | Where-Object { $_.name -eq 'HELIX_RUNTIME' } | Select-Object -First 1
  if (-not $cur -or ($prevOurs -and $cur -eq $prevOurs.value) -or $cur -eq $hxRuntime) {
    [Environment]::SetEnvironmentVariable('HELIX_RUNTIME', $hxRuntime, 'Machine')
    $envRecords += [pscustomobject]@{ name = 'HELIX_RUNTIME'; scope = 'Machine'; value = $hxRuntime; previous = $(if ($prevOurs) { $prevOurs.previous } else { $cur }) }
  } else { Write-Warning "HELIX_RUNTIME is already set to $cur; left unchanged" }
}

$record = [pscustomobject]@{
  schema = 1; kind = 'bunos-windows-userland-install'; installed = (Get-Date).ToString('o')
  source = $Source; manifestRevision = $manifest.repository.revision; root = $Root; linkDir = $LinkDir
  files = $installed; env = $envRecords; commands = $decisions
}
$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $recordPath -Encoding utf8
Write-Host "installed $(@($installed | Where-Object kind -eq 'payload').Count) payload files and $($links.Count) links; record $recordPath"
