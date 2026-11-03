// SPDX-License-Identifier: Apache-2.0
//! Windows API access for the Bun OS shells, generated from the WinClean catalog
//! (`packages/bun-windows-winclean/src/tools.json`): every WinClean tool becomes a nushell command
//! `win <tool-name>` (plugin) and a `win <tool-name>` subcommand of the CLI used from bash/brush.
//! Required schema properties are positional, optional ones are flags (`--new-name`), booleans
//! are switches, and a pipeline record or `--args {...}` supplies arbitrary JSON arguments.

pub mod convert;

use bun_windows_winclean::{ToolInfo, catalog, dispatch};
use serde_json::{Map, Value};

/// How a schema property is passed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    String,
    Int,
    Float,
    Bool,
    List,
    Any,
}

#[derive(Debug, Clone)]
pub struct Param {
    /// JSON property name (`newName`).
    pub key: String,
    /// Shell flag name (`new-name`).
    pub flag: String,
    pub kind: Kind,
    pub required: bool,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct Tool {
    pub name: String,
    /// `wmi-query`.
    pub command: String,
    pub description: String,
    pub params: Vec<Param>,
}

/// `newName` / `new_name` -> `new-name`.
#[must_use]
pub fn kebab(key: &str) -> String {
    let mut out = String::new();
    for (index, ch) in key.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if index > 0 && !out.ends_with('-') {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
        } else if ch == '_' {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    out
}

fn kind_of(schema: &Value) -> Kind {
    match schema.get("type") {
        Some(Value::String(t)) => match t.as_str() {
            "string" => Kind::String,
            "integer" => Kind::Int,
            "number" => Kind::Float,
            "boolean" => Kind::Bool,
            "array" => Kind::List,
            _ => Kind::Any,
        },
        _ => Kind::Any,
    }
}

fn tool_from(info: &ToolInfo) -> Tool {
    let schema = &info.input_schema;
    let required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|r| r.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut params: Vec<Param> = schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|props| {
            props
                .iter()
                .map(|(key, prop)| Param {
                    key: key.clone(),
                    flag: kebab(key),
                    kind: kind_of(prop),
                    required: required.contains(&key.as_str()),
                    description: prop
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                })
                .collect()
        })
        .unwrap_or_default();
    // Required parameters keep the schema's `required` order so positionals are predictable.
    params.sort_by_key(|p| {
        (
            !p.required,
            required.iter().position(|r| *r == p.key).unwrap_or(usize::MAX),
        )
    });
    Tool {
        name: info.name.clone(),
        command: kebab(&info.name),
        description: info.description.clone().unwrap_or_default(),
        params,
    }
}

/// Every catalog tool.
#[must_use]
pub fn tools() -> Vec<Tool> {
    catalog().iter().map(tool_from).collect()
}

/// Find a tool by catalog name (`wmi_query`) or command name (`wmi-query`).
#[must_use]
pub fn find(name: &str) -> Option<Tool> {
    let wanted = kebab(name);
    tools().into_iter().find(|t| t.command == wanted || t.name == name)
}

/// Call a tool with JSON arguments.
pub fn call(tool: &str, args: Value) -> Result<Value, String> {
    let args = if args.is_null() { Value::Object(Map::new()) } else { args };
    dispatch::call_rust(tool, args).map_err(|e| e.to_string())
}

/// Shell-friendly view of a result: `{count, rows: [...]}`-style envelopes (one array of records
/// plus scalar metadata) become the array itself so it renders as a table and pipes into
/// `where`/`sort-by`/`jq`. `raw` keeps the envelope.
#[must_use]
pub fn shape(value: Value, raw: bool) -> Value {
    if raw {
        return value;
    }
    if let Value::Object(map) = &value {
        let arrays: Vec<&String> = map
            .iter()
            .filter(|(_, v)| matches!(v, Value::Array(items) if items.iter().all(Value::is_object)))
            .map(|(k, _)| k)
            .collect();
        let rest_scalar = map
            .iter()
            .all(|(k, v)| arrays.contains(&k) || !(v.is_object() || v.is_array()));
        if arrays.len() == 1 && rest_scalar {
            return map[arrays[0]].clone();
        }
    }
    value
}

/// Parse a CLI/flag string the way a shell user means it: JSON literals (numbers, booleans,
/// arrays, objects) when they parse, the plain string otherwise.
#[must_use]
pub fn loose(text: &str, kind: Kind) -> Value {
    match kind {
        Kind::String => Value::String(text.to_owned()),
        _ => serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kebab_names() {
        assert_eq!(kebab("newName"), "new-name");
        assert_eq!(kebab("shell_recycle_bin"), "shell-recycle-bin");
        assert_eq!(kebab("processId"), "process-id");
    }

    #[test]
    fn every_tool_maps() {
        let all = tools();
        assert!(all.len() > 150);
        let wmi = find("wmi-query").expect("wmi_query in catalog");
        assert_eq!(wmi.params[0].key, "query");
        assert!(wmi.params[0].required);
        let mut names: Vec<_> = all.iter().map(|t| t.command.clone()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), all.len(), "command names collide");
    }

    #[test]
    fn shapes_envelopes() {
        let v = serde_json::json!({"count": 1, "rows": [{"a": 1}]});
        assert_eq!(shape(v.clone(), false), serde_json::json!([{"a": 1}]));
        assert_eq!(shape(v.clone(), true), v);
    }
}
