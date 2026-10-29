# SPDX-License-Identifier: MIT
# Pester v5 tests of the PowerShell side of Bun OS. Run: Invoke-Pester -Path factory/dotnet-linux/tests -CI
# Environment: BUNOS_REPO (repository root, default: two levels above this file), BUNOS_PWSH_PIN (expected $PSVersionTable
# version, set by CI), BUNOS_BUN (bun executable for the buncc sh interop test).
BeforeDiscovery {
    $script:repo = if ($env:BUNOS_REPO) { $env:BUNOS_REPO } else { (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path }
    # Every PowerShell script of the repository (tracked or checked out), without vendored and generated trees.
    $script:scripts = Get-ChildItem -LiteralPath $script:repo -Recurse -File -Include *.ps1, *.psm1, *.psd1 -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.git|target|vendor)[\\/]' } |
        ForEach-Object { @{ Path = $_.FullName; Rel = [IO.Path]::GetRelativePath($script:repo, $_.FullName) } }
}

BeforeAll {
    $script:repo = if ($env:BUNOS_REPO) { $env:BUNOS_REPO } else { (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path }
    $script:profilePath = Join-Path $script:repo 'factory/dotnet-linux/pwsh/Microsoft.PowerShell_profile.ps1'
    $script:pins = Get-Content -Raw (Join-Path $script:repo 'factory/dotnet-linux/pins.json') | ConvertFrom-Json
    $script:pwsh = (Get-Process -Id $PID).Path
}

Describe 'PowerShell runtime' {
    It 'runs the pinned upstream version when CI says so' -Skip:(-not $env:BUNOS_PWSH_PIN) {
        $PSVersionTable.PSVersion.ToString() | Should -Be $env:BUNOS_PWSH_PIN
    }
    It 'is a Linux build on Linux' -Skip:(-not $IsLinux) {
        $PSVersionTable.Platform | Should -Be 'Unix'
        $PSVersionTable.OS | Should -Match 'Linux'
    }
    It 'ships PSReadLine and PSResourceGet (bundled since 7.4)' {
        (Get-Module -ListAvailable PSReadLine).Count | Should -BeGreaterThan 0
        (Get-Module -ListAvailable Microsoft.PowerShell.PSResourceGet).Count | Should -BeGreaterThan 0
    }
}

Describe 'Bun OS profile' {
    It 'parses without errors' {
        $errors = $null; $tokens = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($script:profilePath, [ref]$tokens, [ref]$errors)
        $errors | Should -BeNullOrEmpty
    }
    It 'loads in a fresh non-interactive session, opts out of telemetry and defines bunos-info' {
        $out = & $script:pwsh -NoLogo -NoProfile -NonInteractive -Command "
            . '$($script:profilePath)'
            [pscustomobject]@{
                telemetry = `$env:POWERSHELL_TELEMETRY_OPTOUT; update = `$env:POWERSHELL_UPDATECHECK; dotnet = `$env:DOTNET_CLI_TELEMETRY_OPTOUT
                bunInstall = `$env:BUN_INSTALL; info = (bunos-info).PowerShell; resourceGet = (bunos-info).PSResourceGet
            } | ConvertTo-Json -Compress" | ConvertFrom-Json
        $out.telemetry | Should -Be '1'
        $out.update | Should -Be 'Off'
        $out.dotnet | Should -Be '1'
        $out.bunInstall | Should -Match '\.bun$'
        $out.info | Should -Be $PSVersionTable.PSVersion.ToString()
        $out.resourceGet | Should -Match '^\d+\.\d+\.\d+'
    }
    It 'registers the dotnet completer when dotnet is on PATH' -Skip:(-not (Get-Command dotnet -CommandType Application -ErrorAction Ignore)) {
        $r = & $script:pwsh -NoLogo -NoProfile -NonInteractive -Command ". '$($script:profilePath)'; (TabExpansion2 'dotnet bu' 9).CompletionMatches.CompletionText -join ','"
        $r | Should -Match 'build'
    }
    It 'loads within the 3 second budget (measured, not assumed)' {
        $ms = (Measure-Command { & $script:pwsh -NoLogo -NoProfile -NonInteractive -Command ". '$($script:profilePath)'" }).TotalMilliseconds
        Write-Host "profile load incl. pwsh start: $([int]$ms) ms"
        $ms | Should -BeLessThan 3000
    }
}

Describe 'Pins' {
    It 'record SHA-512 for .NET and SHA-256 for PowerShell on every RID' {
        foreach ($ch in '10.0', '11.0') {
            foreach ($rid in 'linux-x64', 'linux-arm64', 'linux-musl-x64', 'linux-musl-arm64') {
                $script:pins.dotnet.$ch.assets.$rid.sha512 | Should -Match '^[0-9a-f]{128}$'
            }
        }
        foreach ($k in 'stable', 'preview') {
            foreach ($rid in 'linux-x64', 'linux-arm64', 'linux-musl-x64') {
                $script:pins.powershell.$k.assets.$rid.sha256 | Should -Match '^[0-9a-f]{64}$'
            }
        }
    }
}

# Scripts that do not parse today. Imported third-party files are reported here, not edited by this suite.
Describe 'Repository PowerShell scripts' {
    BeforeAll {
        $script:knownBroken = @{
            'docs/libraries/artcraft/script/rust/windows_sqlite_migrate.ps1' = 'imported artcraft script: bare --database-url arguments are a PowerShell syntax error (line 5)'
        }
    }
    It 'parse: <Rel>' -ForEach $script:scripts {
        $key = $Rel.Replace('\', '/')
        if ($script:knownBroken.ContainsKey($key)) { Set-ItResult -Skipped -Because $script:knownBroken[$key]; return }
        $errors = $null; $tokens = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
        $errors | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" } | Should -BeNullOrEmpty
    }
}

Describe 'Existing offline orchestration test (scripts/aphrody/tools/infra)' {
    # The script manages Windows ACLs (Set-Acl, WindowsIdentity): it cannot run on Linux, so it is skipped there with this reason.
    It 'domain-cutover-loop.tests.ps1 passes' -Skip:(-not $IsWindows -or -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $file = Join-Path $script:repo 'scripts/aphrody/tools/infra/domain-cutover-loop.tests.ps1'
        { & $script:pwsh -NoLogo -NoProfile -NonInteractive -File $file } | Should -Not -Throw
        $LASTEXITCODE | Should -Be 0
    }
}

Describe 'buncc sh and pwsh interop' {
    BeforeAll { $script:bun = if ($env:BUNOS_BUN) { $env:BUNOS_BUN } else { (Get-Command bun -ErrorAction Ignore).Source } }
    It 'Bun Shell runs pwsh and its output pipes back' -Skip:(-not (Get-Command bun -ErrorAction Ignore) -and -not $env:BUNOS_BUN) {
        $cli = Join-Path $script:repo 'packages/buncc/src/cli.ts'
        $out = & $script:bun $cli sh -c "pwsh -NoProfile -NonInteractive -Command '[pscustomobject]@{answer=6*7} | ConvertTo-Json -Compress'"
        ($out | ConvertFrom-Json).answer | Should -Be 42
    }
    It 'pwsh runs buncc sh' -Skip:(-not (Get-Command bun -ErrorAction Ignore) -and -not $env:BUNOS_BUN) {
        $cli = Join-Path $script:repo 'packages/buncc/src/cli.ts'
        $out = & $script:bun $cli sh -c 'echo from-bun-shell'
        ($out | Out-String).Trim() | Should -Be 'from-bun-shell'
    }
}
