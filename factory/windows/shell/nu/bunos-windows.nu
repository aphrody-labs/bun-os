# SPDX-License-Identifier: Apache-2.0
# Bun OS: Windows from nushell. Loaded from the user autoload directory by
# `bunos-shell enable nu-plugin`; every command is structured data over the `windows` plugin
# (`win <tool>`, generated from the WinClean catalog: `win` lists them all).
#
# PowerShell / cmd habit          nushell (Bun OS)
# Get-Service / sc query          win svc
# Start-/Stop-/Restart-Service    win svc start|stop|restart <name>
# Get-Process / tasklist          win procs            (nu's own `ps` stays available)
# Stop-Process / taskkill         win kill <pid|name>
# reg query / Get-ItemProperty    win reg <key> [value]
# reg add / Set-ItemProperty      win reg set <key> <name> <value> [--type String]
# Get-ScheduledTask / schtasks    win tasks [folder]
# Get-WinEvent / wevtutil         win events <log> [--max 50]
# Get-CimInstance / wmic          win cim <class|WQL> [--namespace ROOT\CIMV2]
# New-Object -ComObject           win com <ProgID> ...steps
# explorer /select,<path>         win reveal <path>
# Remove-Item to Recycle Bin      win trash <paths...>
# Explorer context menu           win menu <paths...>   (Explorer's own popup)
# Properties                      win props <path> [--dialog]
# Open with                       win open-with <path>
# pwsh -c "<script>"              win pwsh "<script>"   (pwsh through WinClean; .NET library pending)

# Services: list, or start/stop/restart one.
export def "win svc" [action?: string, name?: string] {
  match $action {
    null => (win list-services)
    "start" => (win start-service $name)
    "stop" => (win stop-service $name)
    "restart" => (win restart-service $name)
    _ => (error make {msg: $"unknown action ($action): start|stop|restart"})
  }
}

# Processes as a table (pid, name, memory, ...).
export def "win procs" [] { win list-processes }

# Kill by pid or image name.
export def "win kill" [target: any, --force] {
  if ($target | describe) == "int" {
    win kill-process --pid $target --force=$force
  } else {
    win kill-process --name $target --force=$force
  }
}

# Registry: list a key, or read one value.
export def "win reg" [key: string, value?: string] {
  if $value == null { win list-registry-key $key --raw } else { win get-registry-value $key $value }
}

# Registry: write one value (String, ExpandString, DWord, QWord, MultiString, Binary, None).
export def "win reg set" [key: string, name: string, value: string, --type: string = "String"] {
  win set-registry-value $key $name $value --type $type
}

# Scheduled tasks under a folder (default: all).
export def "win tasks" [folder: string = "\\"] { win list-scheduled-tasks --folder $folder }

# Event log records.
export def "win events" [log: string, --max: int = 50] {
  win query-event-log $log --max-events $max
}

# WMI/CIM: a class name (all properties) or a full WQL query.
export def "win cim" [what: string, --namespace: string = "ROOT\\CIMV2", --limit: int] {
  let query = if ($what | str uppercase | str starts-with "SELECT") { $what } else { $"SELECT * FROM ($what)" }
  win wmi-query $query --namespace $namespace --limit $limit
}

# COM automation: win com WScript.Shell [{name: ExpandEnvironmentStrings, args: ["%USERPROFILE%"]}]
export def "win com" [prog_id: string, ...steps: record] {
  win com-invoke --prog-id $prog_id --steps $steps | get result
}

# Explorer integration.
export def "win reveal" [path: path] { win shell-reveal ($path | path expand) }
export def "win trash" [...paths: path] {
  win shell-file-operation recycle --items ($paths | each { path expand })
}
export def "win menu" [...paths: path] {
  win shell-context-menu ($paths | each { path expand }) --action popup
}
export def "win props" [path: path, --dialog] {
  if $dialog {
    win shell-properties ($path | path expand) --action dialog
  } else {
    win shell-properties ($path | path expand) | get properties
  }
}
export def "win open-with" [path: path] {
  win shell-context-menu ($path | path expand) --action invoke --verb openas
}
export def "win thumb" [path: path, output: path, --size: int = 256] {
  win shell-thumbnail ($path | path expand) --size $size --output ($output | path expand)
}

# PowerShell script through WinClean's power_shell tool (structured result).
export def "win pwsh" [script: string, --timeout: int = 60] {
  win power-shell $script --timeout-seconds $timeout
}
