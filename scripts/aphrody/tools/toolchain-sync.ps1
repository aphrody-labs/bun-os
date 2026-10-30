# SPDX-License-Identifier: Apache-2.0
# Idempotent per-user toolchain sync for Windows (pwsh 7, non-elevated), driven by infra/config/host/toolchain.json.
# No Cargo build, no PATH/profile edits (owned by aphrody-claude user/shell/profile.ps1).
param([string]$Manifest = (Join-Path $(if ($env:YOLO_ROOT) { $env:YOLO_ROOT } else { Join-Path $PSScriptRoot '..\..' }) 'tools\config\host\toolchain.json'))
$ErrorActionPreference = 'Continue'
$m = Get-Content $Manifest -Raw | ConvertFrom-Json
$home_ = $env:USERPROFILE
$env:Path = "$home_\.cargo\bin;$home_\.bun\bin;$home_\.local\bin;$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"
New-Item -ItemType Directory -Force "$home_\.local\bin" | Out-Null
function Log($t) { Write-Output "== $t" }

Log rustup
$rust = $m.versions.rust
rustup toolchain install $rust --profile minimal @($m.rustToolchain.components | % { '-c'; $_ }) 2>&1 | Select-Object -Last 1
rustup default $rust 2>&1 | Select-Object -Last 1
rustup target add --toolchain $rust wasm32-unknown-unknown wasm32-wasip1 2>&1 | Select-Object -Last 1

Log cargo-binstall
if (-not (Get-Command cargo-binstall -ErrorAction SilentlyContinue)) {
  Set-ExecutionPolicy Unrestricted -Scope Process -Force
  iex ((Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.ps1).Content)
}
foreach ($c in ($m.binstall + @('eza', 'ripgrep'))) {
  cargo-binstall --no-confirm --disable-strategies compile --locked $c 2>&1 | Select-Object -Last 1
}

Log winget
$ids = @('jqlang.jq', 'MikeFarah.yq', 'rsteube.Carapace', 'Facebook.zstd', 'wez.wezterm.nightly')
foreach ($id in $ids) {
  winget install --id $id --exact --source winget --scope user --silent --accept-package-agreements --accept-source-agreements 2>&1 | Select-Object -Last 2
}
winget upgrade --id astral-sh.uv --exact --silent --accept-package-agreements --accept-source-agreements 2>&1 | Select-Object -Last 1
$bunPin = $m.versions.bun
if ((Get-Command bun -ErrorAction SilentlyContinue) -and (bun --version).Trim() -eq $bunPin) { "bun $bunPin" } else {
  npm install -g "bun@$bunPin" 2>&1 | Select-Object -Last 1
}

Log windows-extras
winget install --id Rclone.Rclone --exact --source winget --scope user --silent --accept-package-agreements --accept-source-agreements 2>&1 | Select-Object -Last 1
winget install --id Zellij.Zellij --exact --source winget --scope user --silent --accept-package-agreements --accept-source-agreements 2>&1 | Select-Object -Last 1
winget install --id MSYS2.MSYS2 --exact --source winget --silent --accept-package-agreements --accept-source-agreements 2>&1 | Select-Object -Last 1
$sudo = Get-Command gsudo -ErrorAction SilentlyContinue
if ($sudo) {
  gsudo winget install --id Microsoft.OpenSSH.Preview --exact --source winget --silent --accept-package-agreements --accept-source-agreements 2>&1 | Select-Object -Last 1
  if (-not (Test-Path 'C:\Program Files\OpenSSH\sftp.exe')) {
    $r = Invoke-RestMethod https://api.github.com/repos/PowerShell/Win32-OpenSSH/releases/latest
    $zip = Join-Path $env:TEMP 'ossh.zip'
    Invoke-WebRequest (($r.assets | Where-Object name -eq 'OpenSSH-Win64.zip').browser_download_url) -OutFile $zip
    Expand-Archive $zip "$env:TEMP\ossh" -Force
    gsudo { Copy-Item "$env:TEMP\ossh\OpenSSH-Win64\sftp.exe", "$env:TEMP\ossh\OpenSSH-Win64\ssh-keyscan.exe" 'C:\Program Files\OpenSSH\' -Force }
    Remove-Item $zip, "$env:TEMP\ossh" -Recurse -Force
  }
  gsudo { Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent }
}
# rsync and pigz still come from an existing MSYS2 (no pinned portable build yet): the root is configurable, never installed or modified here.
$msysRoot = if ($env:MSYS2_ROOT) { $env:MSYS2_ROOT } else { 'C:\msys64' }
$msys = Join-Path $msysRoot 'usr\bin\bash.exe'
if (Test-Path $msys) {
  & $msys -lc 'pacman -Sy --noconfirm --needed rsync mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-zlib git' 2>&1 | Select-Object -Last 1
  # msys rsync runs with msys ssh; its home (/home/<user>/.ssh) is a junction to the Windows ~/.ssh.
  $msysSsh = "$msysRoot\home\$($env:USERNAME)\.ssh"
  if (-not (Test-Path $msysSsh)) { New-Item -ItemType Junction -Path $msysSsh -Target "$home_\.ssh" | Out-Null }
  Set-Content "$home_\.local\bin\rsync.cmd" "@echo off`r`nsetlocal`r`nset `"PATH=$msysRoot\usr\bin;%PATH%`"`r`n$msysRoot\usr\bin\rsync.exe %*"
  if (-not (Test-Path "$home_\.local\bin\pigz.exe")) {
    & $msys -lc 'export PATH=/ucrt64/bin:/usr/bin; rm -rf /tmp/pigz && git clone -q --depth 1 https://github.com/madler/pigz /tmp/pigz && cd /tmp/pigz && gcc -O3 -static -o pigz.exe pigz.c yarn.c try.c zopfli/src/zopfli/*.c -Izopfli/src/zopfli -lz -lm -lpthread' 2>&1 | Select-Object -Last 2
    Copy-Item "$msysRoot\tmp\pigz\pigz.exe" "$home_\.local\bin\pigz.exe" -Force
  }
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression }
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
foreach ($d in @("$home_\.local\bin", "$home_\.cargo\bin", "$home_\.bun\bin")) { if (($userPath -split ';') -notcontains $d) { $userPath = "$d;$userPath" } }
[Environment]::SetEnvironmentVariable('Path', $userPath, 'User')

Log bun
bun add -g @($m.bunGlobal) 2>&1 | Select-Object -Last 2

Log uv
uv python install $m.versions.python 2>&1 | Select-Object -Last 1

Log uv-tools
uv python install 3.13 2>&1 | Select-Object -Last 1
foreach ($t in $m.uvTools) { uv tool install -p $t.python --from $t.from $t.package 2>&1 | Select-Object -Last 1 }

Log agent-code-intel
$rtkv = $m.versions.rtk
if (-not ((& rtk --version 2>$null | Out-String) -match [regex]::Escape($rtkv))) {
  $zip = Join-Path $env:TEMP 'rtk.zip'
  Invoke-WebRequest "https://github.com/rtk-ai/rtk/releases/download/v$rtkv/rtk-x86_64-pc-windows-msvc.zip" -OutFile $zip
  Expand-Archive $zip "$env:TEMP\rtk" -Force
  Copy-Item "$env:TEMP\rtk\rtk.exe" "$home_\.local\bin\rtk.exe" -Force
  Remove-Item $zip, "$env:TEMP\rtk" -Recurse -Force
}
if (Get-Command codex -ErrorAction SilentlyContinue) {
  if (-not ((codex mcp list 2>&1 | Out-String) -match 'context-mode')) { codex mcp add context-mode -- context-mode }
  if (-not (Select-String -Path "$home_\.codex\hooks.json" -Pattern rtk -Quiet -ErrorAction SilentlyContinue)) { rtk init -g --codex 2>&1 | Select-Object -Last 1 }
}
if (Get-Command agy -ErrorAction SilentlyContinue) {
  $al = (agy mcp list 2>&1 | Out-String)
  if ($al -notmatch 'context-mode') { agy mcp add context-mode context-mode }
  if (-not (Test-Path "$home_\.gemini\config\plugins\rtk")) { rtk init -g --agent antigravity 2>&1 | Select-Object -Last 1 }
}
if (Get-Command claude -ErrorAction SilentlyContinue) {
  if (-not (Select-String -Path "$home_\.claude\settings.json" -Pattern 'rtk hook claude' -Quiet -ErrorAction SilentlyContinue)) { rtk init -g --hook-only --auto-patch 2>&1 | Select-Object -Last 1 }
  claude plugin install aphrody-code-intel@aphrody-user 2>&1 | Select-Object -Last 1
}

Log ovhcloud
$ov = $m.versions.ovhcloud
$have = (& ovhcloud version 2>$null | Out-String)
if ($have -notmatch "v$ov") {
  $zip = Join-Path $env:TEMP 'ovh.zip'
  Invoke-WebRequest "https://github.com/ovh/ovhcloud-cli/releases/download/v$ov/ovhcloud-cli_Windows_x86_64.zip" -OutFile $zip
  Expand-Archive $zip "$env:TEMP\ovh" -Force
  Copy-Item "$env:TEMP\ovh\ovhcloud.exe" "$home_\.local\bin\ovhcloud.exe" -Force
  Remove-Item $zip, "$env:TEMP\ovh" -Recurse -Force
}
Log ovh-rclone-config
# Native authentication is provisioned in its protected Windows store; never copy provider credentials.
if (-not (Test-Path "$home_\.ovh.conf")) { Write-Warning 'Native OVH configuration is absent; provision it through the protected owner workflow.' }
$rc = "$env:APPDATA\rclone\rclone.conf"
if (-not (Select-String -Path $rc -Pattern '^\[vps\]' -Quiet -ErrorAction SilentlyContinue)) {
  New-Item -ItemType Directory -Force (Split-Path $rc) | Out-Null
  Add-Content $rc "[vps]`ntype = sftp`nssh = ssh vps`nshell_type = unix`n`n[dbfr]`ntype = sftp`nssh = ssh dbfr`nshell_type = unix`n"
}
rclone lsd vps: 2>&1 | Select-Object -First 1
rclone lsd dbfr: 2>&1 | Select-Object -First 1
Log done
