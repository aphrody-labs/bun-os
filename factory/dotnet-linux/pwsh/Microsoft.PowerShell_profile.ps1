# SPDX-License-Identifier: MIT
# Bun OS PowerShell profile (CurrentUserCurrentHost). Installed to /etc/skel by bunos-powershell-default; source of truth:
# factory/dotnet-linux/pwsh/Microsoft.PowerShell_profile.ps1. Keep it fast: no network, no module installs.

# PATH: Bun and the .NET global tools. BUN_INSTALL follows the Bun installer convention.
if (-not $env:BUN_INSTALL) { $env:BUN_INSTALL = Join-Path $HOME '.bun' }
$bunosPath = @('/usr/local/bin', (Join-Path $env:BUN_INSTALL 'bin'), (Join-Path $HOME '.dotnet/tools'))
$have = $env:PATH -split ':'
foreach ($dir in $bunosPath) {
    if ((Test-Path -LiteralPath $dir) -and ($have -notcontains $dir)) { $env:PATH = "${dir}:$env:PATH" }
}

# Telemetry and update-check opt-outs documented by Microsoft (about_Telemetry; dotnet CLI telemetry).
$env:POWERSHELL_TELEMETRY_OPTOUT = '1'
$env:POWERSHELL_UPDATECHECK = 'Off'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
if (-not $env:DOTNET_ROOT -and (Test-Path -LiteralPath '/usr/share/dotnet/dotnet')) { $env:DOTNET_ROOT = '/usr/share/dotnet' }

# Completion: dynamic .NET CLI shim from "How to enable tab completion for the .NET CLI" (Microsoft Learn).
if (Get-Command dotnet -CommandType Application -ErrorAction Ignore) {
    Register-ArgumentCompleter -Native -CommandName dotnet -ScriptBlock {
        param($wordToComplete, $commandAst, $cursorPosition)
        dotnet complete --position $cursorPosition "$commandAst" | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
    }
}
# Tools that ship their own PowerShell completion script.
foreach ($spec in @(@('just', '--completions', 'powershell'), @('rustup', 'completions', 'powershell'), @('gh', 'completion', '-s', 'powershell'))) {
    if (Get-Command $spec[0] -CommandType Application -ErrorAction Ignore) {
        try { & $spec[0] $spec[1..($spec.Count - 1)] 2>$null | Out-String | Invoke-Expression } catch { }
    }
}

# PSReadLine (bundled since PowerShell 7.4): history prediction as a list, only on a real terminal.
if ($Host.Name -eq 'ConsoleHost' -and -not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) {
    try {
        Set-PSReadLineOption -PredictionSource History -PredictionViewStyle ListView -HistorySearchCursorMovesToEnd
        Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
        Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
    } catch { }
}

# Bun OS helpers: PSResourceGet is bundled (Microsoft.PowerShell.PSResourceGet); nothing is installed or trusted for you.
function global:bunos-info {
    [pscustomobject]@{
        PowerShell = $PSVersionTable.PSVersion.ToString()
        Dotnet     = if (Get-Command dotnet -CommandType Application -ErrorAction Ignore) { (dotnet --version) } else { $null }
        Bun        = if (Get-Command bun -CommandType Application -ErrorAction Ignore) { (bun --version) } else { $null }
        PSResourceGet = (Get-Module -ListAvailable Microsoft.PowerShell.PSResourceGet | Select-Object -First 1).Version.ToString()
    }
}
