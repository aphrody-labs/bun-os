// SPDX-License-Identifier: Apache-2.0
//! `nu_plugin_windows`: every WinClean tool as a nushell command `win <tool>`.
//!
//! ```nu
//! plugin add ($env.SystemRoot | path join BunOS bin nu_plugin_windows.exe); plugin use windows
//! win list-services | where status == Running
//! win wmi-query "SELECT Name, ProcessId FROM Win32_Process" | sort-by Name
//! win shell-context-menu C:\Windows\notepad.exe
//! ```

use nu_plugin::{EngineInterface, EvaluatedCall, MsgPackSerializer, Plugin, PluginCommand, SimplePluginCommand, serve_plugin};
use nu_plugin_windows::{Kind, Tool, call, convert, shape, tools};
use nu_protocol::{Category, Example, LabeledError, Signature, SyntaxShape, Type, Value};
use serde_json::{Map, Value as Json};

struct WindowsPlugin;

impl Plugin for WindowsPlugin {
    fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").into()
    }

    fn commands(&self) -> Vec<Box<dyn PluginCommand<Plugin = Self>>> {
        let mut out: Vec<Box<dyn PluginCommand<Plugin = Self>>> = vec![Box::new(Root), Box::new(CallAny)];
        out.extend(tools().into_iter().map(|tool| {
            let name = format!("win {}", tool.command);
            Box::new(ToolCommand { tool, name }) as Box<dyn PluginCommand<Plugin = Self>>
        }));
        out
    }
}

fn category() -> Category {
    Category::Custom("windows".into())
}

fn shape_of(kind: Kind) -> SyntaxShape {
    match kind {
        Kind::String => SyntaxShape::String,
        Kind::Int => SyntaxShape::Int,
        Kind::Float => SyntaxShape::Number,
        Kind::Bool => SyntaxShape::Boolean,
        Kind::List => SyntaxShape::List(Box::new(SyntaxShape::Any)),
        Kind::Any => SyntaxShape::Any,
    }
}

fn error(message: impl Into<String>, call: &EvaluatedCall) -> LabeledError {
    LabeledError::new(message.into()).with_label("Windows API call failed", call.head)
}

fn record_of(value: &Value) -> Map<String, Json> {
    match convert::to_json(value) {
        Json::Object(map) => map,
        _ => Map::new(),
    }
}

fn run_tool(tool: &str, args: Json, raw: bool, call: &EvaluatedCall) -> Result<Value, LabeledError> {
    let result = nu_plugin_windows::call(tool, args).map_err(|e| error(e, call))?;
    Ok(convert::to_nu(&shape(result, raw), call.head))
}

struct ToolCommand {
    tool: Tool,
    name: String,
}

impl SimplePluginCommand for ToolCommand {
    type Plugin = WindowsPlugin;

    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        self.tool.description.split(". ").next().unwrap_or(&self.tool.description)
    }

    fn extra_description(&self) -> &str {
        &self.tool.description
    }

    fn search_terms(&self) -> Vec<&str> {
        vec!["windows", "winclean", &self.tool.name]
    }

    fn signature(&self) -> Signature {
        let mut sig = Signature::build(&self.name)
            .input_output_types(vec![(Type::Nothing, Type::Any), (Type::record(), Type::Any)])
            .category(category())
            .switch("raw", "Keep the full result envelope instead of unwrapping its table.", None)
            .named("with", SyntaxShape::Record(Vec::<(String, SyntaxShape)>::new().into()), "Extra JSON arguments (merged last).", None);
        for param in &self.tool.params {
            sig = if param.required {
                sig.required(&param.flag, shape_of(param.kind), &param.description)
            } else if param.kind == Kind::Bool {
                sig.switch(&param.flag, &param.description, None)
            } else {
                sig.named(&param.flag, shape_of(param.kind), &param.description, None)
            };
        }
        sig
    }

    fn examples(&self) -> Vec<Example<'_>> {
        Vec::new()
    }

    fn run(&self, _plugin: &WindowsPlugin, _engine: &EngineInterface, call: &EvaluatedCall, input: &Value) -> Result<Value, LabeledError> {
        let mut args = record_of(input);
        let mut position = 0;
        for param in &self.tool.params {
            if param.required {
                if let Some(value) = call.nth(position) {
                    args.insert(param.key.clone(), convert::to_json(&value));
                }
                position += 1;
            } else if param.kind == Kind::Bool {
                if call.get_flag_span(&param.flag).is_some() {
                    let on = call.has_flag(&param.flag).map_err(|e| error(e.to_string(), call))?;
                    args.insert(param.key.clone(), Json::Bool(on));
                }
            } else if let Some(value) = call.get_flag_value(&param.flag) {
                args.insert(param.key.clone(), convert::to_json(&value));
            }
        }
        if let Some(extra) = call.get_flag_value("with") {
            args.extend(record_of(&extra));
        }
        let raw = call.has_flag("raw").unwrap_or(false);
        run_tool(&self.tool.name, Json::Object(args), raw, call)
    }
}

/// `win`: the catalog as a table.
struct Root;

impl SimplePluginCommand for Root {
    type Plugin = WindowsPlugin;

    fn name(&self) -> &str {
        "win"
    }

    fn description(&self) -> &str {
        "Windows APIs for nushell: list the `win <tool>` commands (WinClean catalog)."
    }

    fn signature(&self) -> Signature {
        Signature::build("win").input_output_types(vec![(Type::Nothing, Type::table())]).category(category())
    }

    fn run(&self, _plugin: &WindowsPlugin, _engine: &EngineInterface, call: &EvaluatedCall, _input: &Value) -> Result<Value, LabeledError> {
        let rows = tools()
            .into_iter()
            .map(|t| {
                let mut row = Map::new();
                row.insert("command".into(), Json::String(format!("win {}", t.command)));
                row.insert("tool".into(), Json::String(t.name));
                row.insert(
                    "description".into(),
                    Json::String(t.description.split(". ").next().unwrap_or_default().to_owned()),
                );
                Json::Object(row)
            })
            .collect();
        Ok(convert::to_nu(&Json::Array(rows), call.head))
    }
}

/// `win call <tool> {args}`: any tool by catalog name with a JSON-shaped record.
struct CallAny;

impl SimplePluginCommand for CallAny {
    type Plugin = WindowsPlugin;

    fn name(&self) -> &str {
        "win call"
    }

    fn description(&self) -> &str {
        "Call any WinClean tool by name with a record of arguments."
    }

    fn signature(&self) -> Signature {
        Signature::build("win call")
            .input_output_types(vec![(Type::Nothing, Type::Any), (Type::record(), Type::Any)])
            .required("tool", SyntaxShape::String, "Tool name (wmi_query or wmi-query).")
            .optional("args", SyntaxShape::Record(Vec::<(String, SyntaxShape)>::new().into()), "Arguments.")
            .switch("raw", "Keep the full result envelope.", None)
            .category(category())
    }

    fn run(&self, _plugin: &WindowsPlugin, _engine: &EngineInterface, call: &EvaluatedCall, input: &Value) -> Result<Value, LabeledError> {
        let name: String = call.req(0).map_err(|e| error(e.to_string(), call))?;
        let tool = nu_plugin_windows::find(&name).ok_or_else(|| error(format!("unknown tool {name}"), call))?;
        let mut args = record_of(input);
        if let Some(extra) = call.nth(1) {
            args.extend(record_of(&extra));
        }
        let raw = call.has_flag("raw").unwrap_or(false);
        run_tool(&tool.name, Json::Object(args), raw, call)
    }
}

fn main() {
    let _ = call;
    serve_plugin(&WindowsPlugin, MsgPackSerializer {});
}
