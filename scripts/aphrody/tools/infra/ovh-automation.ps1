# SPDX-License-Identifier: Apache-2.0
# Native scheduler for the declared owner-only, read-only OVH audits.
[CmdletBinding()]
param([switch]$Apply,[string]$StateRoot)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
$repositoryRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../../docs/aphrody'))
$declared=Get-Content -LiteralPath (Join-Path $repositoryRoot 'tools/config/ovh-automation.json') -Raw|ConvertFrom-Json
$entries=@($declared.boot.entries)
$expected=@{
    'Aphrody OVH protected audit'='ovh-protected.ps1'
}
if($entries.Count -ne $expected.Count){throw 'Unexpected OVH task declaration count'}
foreach($entry in $entries){
    if(-not $expected.ContainsKey($entry.name) -or $entry.path -ne '\Aphrody\' -or $entry.principal -ne 'user' -or $entry.runLevel -ne 'limited' -or -not $entry.desktop -or -not $entry.periodic -or $entry.execute -ne '%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe' -or $entry.workingDirectory -ne '{root}' -or $entry.timeLimitMinutes -ne 5 -or @($entry.triggers).Count -ne 2 -or $entry.triggers[0] -ne 'atLogon' -or $entry.triggers[1] -ne 'every:360m' -or $entry.arguments -notlike "*-File `"{root}\$($expected[$entry.name])`"*"){
        throw "Unexpected OVH task declaration: $($entry.name)"
    }
}
$deploymentRoot=Join-Path $StateRoot 'automation/ovh'
$program=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$plans=@(foreach($entry in $entries){
    [ordered]@{
        name=$entry.name
        path=$entry.path
        principal=$user
        logonType='Interactive'
        runLevel='Limited'
        execute=$program
        arguments=$entry.arguments.Replace('{root}',$deploymentRoot)
        workingDirectory=$deploymentRoot
        triggers=@($entry.triggers)
        executionLimitMinutes=$entry.timeLimitMinutes
        scope='Declared read-only OVH audit only'
        apply=[bool]$Apply
    }
})
$plans|ConvertTo-Json -Depth 5|Write-Output
if(-not $Apply){return}
New-Item -ItemType Directory -Force -Path (Join-Path $deploymentRoot 'tools/config')|Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ovh-protected.ps1') -Destination (Join-Path $deploymentRoot 'ovh-protected.ps1')
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'tools/config/ovh-automation.json') -Destination (Join-Path $deploymentRoot 'infra/config/service-catalog.json')
$logon=New-ScheduledTaskTrigger -AtLogOn -User $user
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
foreach($entry in $entries){
    $arguments=$entry.arguments.Replace('{root}',$deploymentRoot)
    $action=New-ScheduledTaskAction -Execute $program -Argument $arguments -WorkingDirectory $deploymentRoot
    $repeat=New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 360)
    Register-ScheduledTask -TaskName $entry.name -TaskPath $entry.path -Action $action -Trigger @($logon,$repeat) -Principal $principal -Settings $settings -Description $entry.description -Force|Out-Null
    [xml]$xml=Export-ScheduledTask -TaskName $entry.name -TaskPath $entry.path
    $registered=Get-ScheduledTask -TaskName $entry.name -TaskPath $entry.path
    if($registered.Principal.RunLevel -ne 'Limited' -or $xml.Task.Principals.Principal.RunLevel -eq 'HighestAvailable' -or $xml.Task.Principals.Principal.LogonType -ne 'InteractiveToken' -or $xml.Task.Triggers.TimeTrigger.Repetition.Interval -ne 'PT6H' -or $xml.Task.Actions.Exec.Command -ne $program -or $xml.Task.Settings.ExecutionTimeLimit -ne 'PT5M'){
        throw "Registered task differs from the limited interactive plan: $($entry.name)"
    }
    Start-ScheduledTask -TaskName $entry.name -TaskPath $entry.path
}
Write-Output 'Registered and started the declared limited interactive read-only OVH audit task.'
