# SPDX-License-Identifier: Apache-2.0
# Full Windows developer bootstrap for a fresh Aphrody checkout.
[CmdletBinding()]
param([switch]$SkipSources, [switch]$SkipPython, [switch]$SkipNativeTools, [switch]$Canary)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required command missing after installation: $Name. Open a new terminal and rerun." }
}
function Install-Winget([string]$Id, [string]$Override = '') {
  $present = winget list --id $Id --exact --accept-source-agreements 2>$null
  if ($LASTEXITCODE -ne 0 -or -not ($present | Select-String -SimpleMatch $Id)) {
    $wingetArgs = @('install','--id',$Id,'--exact','--source','winget','--accept-source-agreements','--accept-package-agreements','--disable-interactivity')
    if ($Override) { $wingetArgs += @('--override',$Override) }
    winget @wingetArgs
    if ($LASTEXITCODE -ne 0) { throw "winget failed installing $Id (exit $LASTEXITCODE)" }
  }
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install/enable App Installer (winget) first, then rerun.' }
$tools = @(
  @{ Id='Git.Git' }, @{ Id='Rustlang.Rustup' }, @{ Id='astral-sh.uv' },
  @{ Id='Kitware.CMake' }, @{ Id='Ninja-build.Ninja' }, @{ Id='LLVM.LLVM' },
  @{ Id='Microsoft.VisualStudio.2022.BuildTools'; Override='--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --add Microsoft.VisualStudio.Component.Windows11SDK.26100' }
)
if (-not $SkipNativeTools) { foreach ($tool in $tools) { Install-Winget $tool.Id $tool.Override } }
foreach ($path in @("$env:USERPROFILE\.cargo\bin", "$env:USERPROFILE\.bun\bin", "$env:USERPROFILE\.local\bin", "$env:ProgramFiles\Git\cmd", "$env:ProgramFiles\LLVM\bin")) {
  if (Test-Path $path) { $env:PATH = "$path;$env:PATH" }
}
Require-Command git; Require-Command rustup; Require-Command uv
$packagePins = Get-Content (Join-Path $root 'infra/config/system-packages.json') -Raw | ConvertFrom-Json
$bunPin = $packagePins.toolchains.bun.version
$haveBun = if (Get-Command bun -ErrorAction SilentlyContinue) { (bun --version).Trim() } else { '' }
if ($haveBun -ne $bunPin) {
  # Unmodified upstream Bun, installed from its npm package at the exact pin (see infra/config/system-packages.json).
  npm install -g "bun@$bunPin"
  $env:PATH = "$(npm prefix -g);$env:USERPROFILE\.bun\bin;$env:PATH"
  if ((bun --version).Trim() -ne $bunPin) { throw "Pinned Bun $bunPin installation failed" }
}
$uvPin = $packagePins.toolchains.uv.version
if ((uv --version) -notmatch [regex]::Escape($uvPin)) {
  winget install --id astral-sh.uv --exact --source winget --version $uvPin --accept-source-agreements --accept-package-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw "Pinned uv $uvPin is not available from Winget" }
}

$channel = (Select-String -Path (Join-Path $root 'rust-toolchain.toml') -Pattern '^channel\s*=\s*"([^"]+)"').Matches.Groups[1].Value
if (-not $channel) { throw 'rust-toolchain.toml has no pinned channel' }
rustup toolchain install $channel --profile minimal -c rustfmt -c clippy -c rust-src -c rust-analyzer
if ($LASTEXITCODE -ne 0) { throw 'rustup toolchain installation failed' }
rustup target add --toolchain $channel x86_64-pc-windows-msvc wasm32-unknown-unknown wasm32-wasip1
if ($LASTEXITCODE -ne 0) { throw 'Rust target installation failed' }
if ($Canary) {
  rustup toolchain install nightly --profile minimal -c rustfmt -c clippy -c rust-src -c rust-analyzer
  if ($LASTEXITCODE -ne 0) { throw 'Rust nightly toolchain installation failed' }
  rustup target add --toolchain nightly x86_64-pc-windows-msvc wasm32-unknown-unknown wasm32-wasip1
  if ($LASTEXITCODE -ne 0) { throw 'Rust nightly targets installation failed' }
}

if (-not (Get-Command cargo-binstall -ErrorAction SilentlyContinue)) {
  bun (Join-Path $root 'scripts/aphrody/build/rust/cargo-serial.ts') --msvc install --locked cargo-binstall
  if ($LASTEXITCODE -ne 0) { throw 'cargo-binstall installation failed' }
}
$cargoTools = @($packagePins.cargoTools)
bun (Join-Path $root 'scripts/aphrody/build/rust/cargo-serial.ts') --msvc binstall --yes --locked nu @cargoTools
if ($LASTEXITCODE -ne 0) { throw 'Rust developer tools installation failed' }

bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Bun workspace install failed' }
if (-not $SkipSources) { bun run sources:sync; if ($LASTEXITCODE -ne 0) { throw 'Pinned upstream source synchronization failed' } }
cargo fetch --locked
if ($LASTEXITCODE -ne 0) { throw 'Cargo dependency fetch failed' }
if (-not $SkipPython) {
  $pyRoot = Join-Path $root 'py'
  if (Test-Path (Join-Path $pyRoot 'pyproject.toml')) {
    Push-Location $pyRoot
    try { uv sync --all-packages --locked; if ($LASTEXITCODE -ne 0) { throw 'Python workspace sync failed' } }
    finally { Pop-Location }
  } else { Write-Warning "Python workspace not found at $pyRoot; skipping it." }
}
Write-Host "Aphrody dependencies are installed. Restart the terminal if Visual Studio or PATH changed."
