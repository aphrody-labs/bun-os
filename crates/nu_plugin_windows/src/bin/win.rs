// SPDX-License-Identifier: Apache-2.0
//! `win`: the same Windows API surface as `nu_plugin_windows`, for bash-compatible shells
//! (brush, Git Bash, the Bun OS WSL distro through interop). Prints JSON so it pipes into `jq`,
//! `nu --stdin`, `from json`.
//!
//! ```sh
//! win list-services | jq '.[] | select(.status=="Running") | .name'
//! win wmi-query 'SELECT Caption, Version FROM Win32_OperatingSystem'
//! win shell-file-operation --op recycle --items '["C:\\tmp\\a.txt"]'
//! win call com_invoke '{"progId":"WScript.Shell","steps":[{"name":"ExpandEnvironmentStrings","args":["%USERPROFILE%"]}]}'
//! ```

use std::{io::IsTerminal, process::ExitCode};

use nu_plugin_windows::{Kind, Tool, find, loose, shape, tools};
use serde_json::{Map, Value};

fn usage() -> String {
    let mut out = String::from(
        "usage: win <tool> [positional...] [--flag value] [--switch] [--json '{...}'] [--raw]\n       \
         win call <tool> '<json args>'\n       win help <tool>\n       win tools\n\ntools:\n",
    );
    for tool in tools() {
        out.push_str(&format!("  {:<34} {}\n", tool.command, tool.description.split(". ").next().unwrap_or_default()));
    }
    out
}

fn help(tool: &Tool) -> String {
    let mut out = format!("win {}\n\n{}\n\n", tool.command, tool.description);
    for p in &tool.params {
        let how = if p.required { format!("<{}>", p.flag) } else if p.kind == Kind::Bool { format!("--{}", p.flag) } else { format!("--{} <value>", p.flag) };
        out.push_str(&format!("  {how:<30} {}\n", p.description));
    }
    out
}

fn parse(tool: &Tool, argv: &[String]) -> Result<(Value, bool), String> {
    let mut args = Map::new();
    let mut raw = false;
    let mut positionals = tool.params.iter().filter(|p| p.required);
    let mut index = 0;
    while index < argv.len() {
        let arg = &argv[index];
        index += 1;
        if let Some(flag) = arg.strip_prefix("--") {
            let (flag, inline) = match flag.split_once('=') {
                Some((f, v)) => (f, Some(v.to_owned())),
                None => (flag, None),
            };
            match flag {
                "raw" => raw = true,
                "json" | "with" => {
                    let text = inline.or_else(|| argv.get(index).cloned().inspect(|_| index += 1)).ok_or("--json needs a value")?;
                    match serde_json::from_str::<Value>(&text).map_err(|e| format!("--json: {e}"))? {
                        Value::Object(extra) => args.extend(extra),
                        _ => return Err("--json must be an object".into()),
                    }
                }
                _ => {
                    let param = tool
                        .params
                        .iter()
                        .find(|p| p.flag == flag || p.key == flag)
                        .ok_or_else(|| format!("unknown flag --{flag} for win {}", tool.command))?;
                    let value = if param.kind == Kind::Bool {
                        Value::Bool(inline.map_or(true, |v| v != "false"))
                    } else {
                        let text = inline.or_else(|| argv.get(index).cloned().inspect(|_| index += 1)).ok_or_else(|| format!("--{flag} needs a value"))?;
                        loose(&text, param.kind)
                    };
                    // Repeating a list-like flag accumulates: --items a.txt --items b.txt.
                    match (args.remove(&param.key), param.kind) {
                        (Some(Value::Array(mut items)), Kind::List | Kind::Any) => {
                            items.push(value);
                            args.insert(param.key.clone(), Value::Array(items));
                        }
                        (Some(previous), Kind::List | Kind::Any) => {
                            args.insert(param.key.clone(), Value::Array(vec![previous, value]));
                        }
                        _ => {
                            args.insert(param.key.clone(), value);
                        }
                    }
                }
            }
        } else {
            let param = positionals.next().ok_or_else(|| format!("unexpected argument {arg}"))?;
            args.insert(param.key.clone(), loose(arg, param.kind));
        }
    }
    Ok((Value::Object(args), raw))
}

fn print(value: &Value) {
    let text = if std::io::stdout().is_terminal() { serde_json::to_string_pretty(value) } else { serde_json::to_string(value) };
    println!("{}", text.unwrap_or_default());
}

fn run(argv: Vec<String>) -> Result<(), String> {
    let Some(first) = argv.first() else { return Err(usage()) };
    match first.as_str() {
        "-h" | "--help" | "help" if argv.len() == 1 => {
            print!("{}", usage());
            Ok(())
        }
        "help" => {
            let tool = find(&argv[1]).ok_or_else(|| format!("unknown tool {}", argv[1]))?;
            print!("{}", help(&tool));
            Ok(())
        }
        "tools" => {
            let rows: Vec<Value> = tools()
                .into_iter()
                .map(|t| serde_json::json!({ "command": t.command, "tool": t.name, "description": t.description }))
                .collect();
            print(&Value::Array(rows));
            Ok(())
        }
        "call" => {
            let tool = find(argv.get(1).ok_or("win call <tool> [json]")?).ok_or("unknown tool")?;
            let args = match argv.get(2) {
                Some(text) => serde_json::from_str(text).map_err(|e| format!("arguments: {e}"))?,
                None => Value::Object(Map::new()),
            };
            let raw = argv.iter().any(|a| a == "--raw");
            print(&shape(nu_plugin_windows::call(&tool.name, args)?, raw));
            Ok(())
        }
        name => {
            let tool = find(name).ok_or_else(|| format!("unknown tool {name}; `win tools` lists them"))?;
            if argv.iter().skip(1).any(|a| a == "--help" || a == "-h") {
                print!("{}", help(&tool));
                return Ok(());
            }
            let (args, raw) = parse(&tool, &argv[1..])?;
            print(&shape(nu_plugin_windows::call(&tool.name, args)?, raw));
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("win: {message}");
            ExitCode::FAILURE
        }
    }
}
