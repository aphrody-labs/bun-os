// SPDX-License-Identifier: Apache-2.0
//! JSON adapters for the shell, WMI and COM tools; `None` when the tool is not ours.

use serde_json::Value;

use crate::SubsystemError;

/// Tool names routed here.
pub const TOOLS: &[&str] = &[
    "wmi_query",
    "com_invoke",
    "shell_known_folders",
    "shell_drives",
    "shell_file_operation",
    "shell_recycle_bin",
    "shell_context_menu",
    "shell_properties",
    "shell_thumbnail",
    "shell_open_with",
    "shell_reveal",
];

#[cfg(windows)]
pub fn call(tool: &str, args: &Value) -> Option<Result<Value, SubsystemError>> {
    use super::{com, namespace, wmi};
    let result = match tool {
        "wmi_query" => {
            let Some(query) = args.get("query").and_then(Value::as_str) else {
                return Some(Err(SubsystemError::InvalidArguments("wmi_query requires query".into())));
            };
            wmi::query(
                args.get("namespace").and_then(Value::as_str),
                query,
                args.get("limit").and_then(Value::as_u64).map(|n| n as usize),
            )
        }
        "com_invoke" => com::invoke(args),
        "shell_known_folders" => namespace::known_folders(),
        "shell_drives" => namespace::drives(),
        "shell_file_operation" => namespace::file_operation(args),
        "shell_recycle_bin" => namespace::recycle_bin(args),
        "shell_context_menu" => namespace::context_menu_tool(args),
        "shell_properties" => namespace::properties(args),
        "shell_thumbnail" => namespace::thumbnail(args),
        "shell_open_with" => namespace::open_with(args),
        "shell_reveal" => namespace::reveal(args),
        _ => return None,
    };
    Some(result.map_err(|error| match error.kind() {
        std::io::ErrorKind::InvalidInput => SubsystemError::InvalidArguments(error.to_string()),
        _ => SubsystemError::Failed(error.to_string()),
    }))
}

#[cfg(not(windows))]
pub fn call(tool: &str, _args: &Value) -> Option<Result<Value, SubsystemError>> {
    TOOLS
        .contains(&tool)
        .then(|| Err(SubsystemError::Unavailable(format!("{tool} needs Windows"))))
}
