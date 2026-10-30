<#
.SYNOPSIS
  Installs the local auto-sync of Bun OS: one light clone and a Scheduled Task that fast-forwards it from origin/main.

.DESCRIPTION
  - Clone: blobless (--filter=blob:none) and sparse, default C:\bun-os. Only the paths in $SparsePaths are checked out;
    add more with `git -C C:\bun-os sparse-checkout add <path>`. Submodules are never fetched.
  - Task: "BunOS-Sync", every 10 minutes, hidden, lowest priority, only on the current user's session, no UI. It runs
    `git pull --ff-only origin main`. A diverged or dirty clone is left alone (the pull refuses) and the reason is appended to
    <clone>\.git\bunos-sync.log. Nothing is ever forced, reset or stashed.
  - Push is not part of the task: the workstation commits and pushes by hand (or through the repository's own tooling);
    this task only brings origin/main down so the workstation, GitHub and the VPS converge. See docs/SYNC.md.

.PARAMETER Clone            Clone directory (default C:\bun-os).
.PARAMETER IntervalMinutes  Pull period (default 10).
.PARAMETER TaskName         Scheduled task name (default BunOS-Sync).
.PARAMETER Remote           Remote URL (default https://github.com/aphrody-labs/bun-os.git).
.PARAMETER Uninstall        Remove the task (the clone is kept).
#>
[CmdletBinding()]
param(
  [string]$Clone = 'C:\bun-os',
  [int]$IntervalMinutes = 10,
  [string]$TaskName = 'BunOS-Sync',
  [string]$Remote = 'https://github.com/aphrody-labs/bun-os.git',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed task $TaskName (clone $Clone kept)."
  } else {
    Write-Host "Task $TaskName does not exist."
  }
  return
}

$SparsePaths = @(
  '/*.md', '/Cargo.toml', '/Cargo.lock', '/package.json', '/bun.lock', '/.gitmodules', '/justfile', '/rust-toolchain.toml',
  '/.github/', '/docs/', '/factory/bunos/', '/factory/sync/', '/scripts/sync/', '/packages/bun-workspace/config/'
)

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is not on PATH.' }

if (-not (Test-Path (Join-Path $Clone '.git'))) {
  if ((Test-Path $Clone) -and (Get-ChildItem $Clone -Force | Select-Object -First 1)) {
    throw "$Clone exists and is not a git clone; choose another -Clone."
  }
  git clone --filter=blob:none --no-checkout --branch main $Remote $Clone
  if ($LASTEXITCODE -ne 0) { throw 'clone failed' }
  git -C $Clone sparse-checkout init --no-cone
  git -C $Clone sparse-checkout set @SparsePaths
  git -C $Clone config core.longpaths true
  git -C $Clone config core.autocrlf false
  git -C $Clone config fetch.recurseSubmodules false
  git -C $Clone config submodule.recurse false
  git -C $Clone checkout main
  if ($LASTEXITCODE -ne 0) { throw 'checkout failed' }
} else {
  Write-Host "Clone $Clone already exists; keeping it."
}

$log = Join-Path $Clone '.git\bunos-sync.log'
# The task body: one pull, one log line on failure, exit code kept for Task Scheduler history.
$body = "`$ErrorActionPreference='Continue'; `$o = git -C '$Clone' pull --ff-only --no-recurse-submodules origin main 2>&1 | Out-String; " +
  "if (`$LASTEXITCODE -ne 0) { Add-Content -Path '$log' -Value ((Get-Date -Format s) + ' ' + `$o.Trim()) }; exit `$LASTEXITCODE"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$body`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
# Priority 7 = below normal CPU/IO class for scheduled tasks; battery use allowed; a run still going is not doubled.
$settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -Priority 7 `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Fast-forwards the light Bun OS clone from origin/main (docs/SYNC.md).' -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
Write-Host "Task $($task.TaskName): state $($task.State), every $IntervalMinutes min, clone $Clone"
