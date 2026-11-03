<#
.SYNOPSIS
  Removes exactly what install-system.ps1 recorded in install-record.json: each listed file is deleted only if its
  sha256 still matches the record (anything changed since is kept and reported); recorded environment variables are
  restored to their previous value. Empty directories under the root are removed last.

  C:\Windows\System32\sudo.exe pwsh -NoProfile -File C:\Windows\BunOS\userland\uninstall-system.ps1
#>
[CmdletBinding()]
param([string]$Root = (Join-Path $env:SystemRoot 'BunOS\userland'))
$ErrorActionPreference = 'Stop'
$recordPath = Join-Path $Root 'install-record.json'
if (-not (Test-Path -LiteralPath $recordPath)) { throw "no install record at $recordPath" }
$rec = Get-Content $recordPath -Raw | ConvertFrom-Json
$removed = 0; $kept = @()
$trashDir = Join-Path $Root '.trash'
if (Test-Path -LiteralPath $trashDir) { Get-ChildItem -LiteralPath $trashDir -Force | ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force } catch {} } }
# Links first, then payload.
foreach ($f in @($rec.files | Where-Object kind -eq 'link') + @($rec.files | Where-Object kind -ne 'link')) {
  if (-not (Test-Path -LiteralPath $f.path)) { continue }
  if ((Get-FileHash -LiteralPath $f.path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f.sha256) {
    # A running executable cannot be deleted but can be renamed on the same volume.
    try { Remove-Item -LiteralPath $f.path -Force }
    catch {
      $trash = Join-Path $Root '.trash'; New-Item -ItemType Directory -Force -Path $trash | Out-Null
      Move-Item -LiteralPath $f.path -Destination (Join-Path $trash "$([guid]::NewGuid().ToString('N'))-$(Split-Path $f.path -Leaf)") -Force
    }
    $removed++
  } else { $kept += $f.path }
}
foreach ($e in @($rec.env)) {
  if (-not $e) { continue }
  if ([Environment]::GetEnvironmentVariable($e.name, $e.scope) -eq $e.value) {
    [Environment]::SetEnvironmentVariable($e.name, $(if ($e.previous) { $e.previous } else { $null }), $e.scope)
  }
}
foreach ($f in 'manifest.json', 'install-system.ps1', 'install-record.json') {
  $p = Join-Path $Root $f; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
}
Get-ChildItem -LiteralPath $Root -Directory -Recurse -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending |
  Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force) } | Remove-Item -Force
Write-Host "removed $removed files"; if ($kept) { Write-Warning "kept (changed since install):`n  $($kept -join "`n  ")" }
Write-Host "the running uninstall-system.ps1 in $Root can be deleted by hand once this window closes"
