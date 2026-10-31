# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
Verify and optionally register a factory-built Bun OS WSL 2 image and its kernel.
.DESCRIPTION
Verification is the default. -Install registers the supplied image without
launching it or replacing another distribution, through `wsl --import` (default)
or `wsl --install --from-file` (-Method InstallFromFile, WSL 2.4.4 or later).
Use the SHA256 values from the factory's independently verified SHA256SUMS.

The Bun OS kernel (Linux 7.3 + CachyOS + dxgkrnl) is optional. With -KernelPath and
-ModulesVhdxPath the files are verified and copied to -KernelDirectory, and the
.wslconfig lines are printed. Only -ConfigureKernel writes them to
%UserProfile%\.wslconfig (after a timestamped backup); that setting applies to every
WSL 2 distribution and takes effect after `wsl --shutdown`.
.EXAMPLE
.\setup-wsl.ps1 -ImagePath .\BunOS.wsl -ImageSha256 <sha> -KernelPath .\bunos-wsl-7.3.0-bunos-wsl.bzImage -KernelSha256 <sha> -ModulesVhdxPath .\bunos-wsl-7.3.0-bunos-wsl-modules.vhdx -ModulesSha256 <sha> -Install -ConfigureKernel
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string] $ImagePath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string] $ImageSha256,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{0,63}$')]
    [string] $Name = 'BunOS',
    [string] $InstallDirectory,
    [switch] $Install,
    [ValidateSet('Import', 'InstallFromFile')]
    [string] $Method = 'Import',
    [string] $KernelPath,
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string] $KernelSha256,
    [string] $ModulesVhdxPath,
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string] $ModulesSha256,
    [string] $KernelDirectory,
    [switch] $ConfigureKernel
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-FileHash([string] $Path, [string] $Expected, [string] $Label) {
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer) { throw "$Label must be a file." }
    if (-not $Expected) { throw "$Label needs its SHA256 from the factory SHA256SUMS." }
    $actual = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.ToLowerInvariant()) { throw "$Label SHA256 does not match the expected factory artifact." }
    return $item
}

$image = Assert-FileHash $ImagePath $ImageSha256 'ImagePath'
if ($image.Extension -notin @('.wsl', '.tar', '.gz')) {
    throw 'ImagePath must name a factory-built .wsl (gzip tar) archive.'
}
$actualSha256 = $ImageSha256.ToLowerInvariant()

if (-not $InstallDirectory) {
    if (-not $env:LOCALAPPDATA) { throw 'Set InstallDirectory on hosts without LOCALAPPDATA.' }
    $InstallDirectory = Join-Path $env:LOCALAPPDATA "BunOS\WSL\$Name"
}
$destination = [System.IO.Path]::GetFullPath($InstallDirectory)
if ($destination -eq [System.IO.Path]::GetPathRoot($destination)) {
    throw 'The installation directory must not be a filesystem root.'
}
$result = [ordered]@{
    distribution = $Name
    image = $image.FullName
    imageSha256 = $actualSha256
    installDirectory = $destination
    integrityVerified = $true
    registered = $false
    launched = $false
    kernelStaged = $false
    wslconfigUpdated = $false
    wslconfigSnippet = $null
    wslRuntimeQualified = $false
}

if ($KernelPath -or $ModulesVhdxPath) {
    if (-not ($KernelPath -and $ModulesVhdxPath)) { throw 'Pass both -KernelPath and -ModulesVhdxPath.' }
    $kernel = Assert-FileHash $KernelPath $KernelSha256 'KernelPath'
    $modules = Assert-FileHash $ModulesVhdxPath $ModulesSha256 'ModulesVhdxPath'
    if ($modules.Extension -ne '.vhdx') { throw 'ModulesVhdxPath must name the factory modules .vhdx.' }
    if (-not $KernelDirectory) { $KernelDirectory = Join-Path $env:SystemDrive 'BunOS\wsl' }
    $kernelDestination = [System.IO.Path]::GetFullPath($KernelDirectory)
    $kernelTarget = Join-Path $kernelDestination $kernel.Name
    $modulesTarget = Join-Path $kernelDestination $modules.Name
    # .wslconfig paths use escaped backslashes.
    $escape = { param($p) $p.Replace('\', '\\') }
    $snippet = "[wsl2]`nkernel=$(& $escape $kernelTarget)`nkernelModules=$(& $escape $modulesTarget)`nguiApplications=true`nnestedVirtualization=true`n"
    $result.wslconfigSnippet = $snippet
    if ($PSCmdlet.ShouldProcess($kernelDestination, 'Copy the verified Bun OS kernel and modules VHDX')) {
        [void][System.IO.Directory]::CreateDirectory($kernelDestination)
        Copy-Item -LiteralPath $kernel.FullName -Destination $kernelTarget -Force
        Copy-Item -LiteralPath $modules.FullName -Destination $modulesTarget -Force
        $result.kernelStaged = $true
    }
    if ($ConfigureKernel) {
        $wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
        $lines = @()
        if (Test-Path -LiteralPath $wslconfig) { $lines = @(Get-Content -LiteralPath $wslconfig) }
        $wanted = [ordered]@{
            kernel = & $escape $kernelTarget
            kernelModules = & $escape $modulesTarget
            guiApplications = 'true'
            nestedVirtualization = 'true'
        }
        $output = New-Object System.Collections.Generic.List[string]
        $section = ''
        $seen = @{}
        $inserted = $false
        foreach ($line in $lines) {
            if ($line -match '^\s*\[(.+)\]\s*$') {
                if ($section -eq 'wsl2' -and -not $inserted) {
                    foreach ($key in $wanted.Keys) { if (-not $seen[$key]) { $output.Add("$key=$($wanted[$key])") } }
                    $inserted = $true
                }
                $section = $Matches[1].Trim().ToLowerInvariant()
                $output.Add($line)
                continue
            }
            if ($section -eq 'wsl2' -and $line -match '^\s*([A-Za-z]+)\s*=') {
                $key = @($wanted.Keys | Where-Object { $_ -ieq $Matches[1] })
                if ($key.Count -eq 1) {
                    $output.Add("$($key[0])=$($wanted[$key[0]])")
                    $seen[$key[0]] = $true
                    continue
                }
            }
            $output.Add($line)
        }
        if ($section -eq 'wsl2' -and -not $inserted) {
            foreach ($key in $wanted.Keys) { if (-not $seen[$key]) { $output.Add("$key=$($wanted[$key])") } }
            $inserted = $true
        }
        if (-not $inserted) {
            $output.Add('[wsl2]')
            foreach ($key in $wanted.Keys) { $output.Add("$key=$($wanted[$key])") }
        }
        if ($PSCmdlet.ShouldProcess($wslconfig, 'Point WSL 2 at the Bun OS kernel (applies to all distributions)')) {
            if (Test-Path -LiteralPath $wslconfig) {
                Copy-Item -LiteralPath $wslconfig -Destination "$wslconfig.$(Get-Date -Format yyyyMMddHHmmss).bak"
            }
            Set-Content -LiteralPath $wslconfig -Value $output -Encoding utf8
            $result.wslconfigUpdated = $true
        }
    }
} elseif ($ConfigureKernel) {
    throw '-ConfigureKernel needs -KernelPath and -ModulesVhdxPath.'
}

if (-not $Install) {
    [pscustomobject]$result
    return
}

$wsl = Get-Command wsl.exe -CommandType Application -ErrorAction Stop
# These management commands do not launch a Linux distribution.
$versionOutput = & $wsl.Source --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "WSL version discovery failed. Install a supported WSL 2 release first: $versionOutput"
}
$existing = @(& $wsl.Source --list --quiet 2>&1)
if ($LASTEXITCODE -ne 0) { throw "WSL distribution inventory failed: $existing" }
$names = @($existing | ForEach-Object { ([string]$_).Replace([string][char]0, '').Trim() })
if ($names -contains $Name) { throw "Distribution '$Name' already exists; it will not be replaced." }
if (Test-Path -LiteralPath $destination) {
    $directory = Get-Item -LiteralPath $destination
    if (-not $directory.PSIsContainer -or ($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        throw 'The installation directory must be a regular directory.'
    }
    if (Get-ChildItem -LiteralPath $destination -Force | Select-Object -First 1) {
        throw 'The installation directory must be empty.'
    }
}
if ($PSCmdlet.ShouldProcess($destination, "Register '$Name' as WSL 2 from the verified image ($Method)")) {
    [void][System.IO.Directory]::CreateDirectory($destination)
    if ($Method -eq 'InstallFromFile') {
        & $wsl.Source --install --from-file $image.FullName --name $Name --location $destination --no-launch
    } else {
        & $wsl.Source --import $Name $destination $image.FullName --version 2
    }
    if ($LASTEXITCODE -ne 0) { throw 'WSL image registration failed; existing distributions were not modified.' }
    $result.registered = $true
}
[pscustomobject]$result
