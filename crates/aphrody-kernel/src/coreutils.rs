// SPDX-License-Identifier: Apache-2.0
//! Kernel adapter for the pinned upstream `uutils/coreutils` multicall binary.

use aphrody_proc::NoWindow as _;
use std::{
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use aphrody_subsystem::{SubsystemError, SystemSubsystem, ToolDefinition};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncReadExt};

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_OUTPUT_BYTES: usize = 1_048_576;
const MAX_OUTPUT_BYTES: usize = 8_388_608;

struct Companion {
    tool: &'static str,
    repository: &'static str,
    binary: &'static str,
    prefix: &'static [&'static str],
}

const COMPANIONS: &[Companion] = &[
    Companion {
        tool: "find",
        repository: "uutils-findutils",
        binary: "find",
        prefix: &[],
    },
    Companion {
        tool: "locate",
        repository: "uutils-findutils",
        binary: "locate",
        prefix: &[],
    },
    Companion {
        tool: "updatedb",
        repository: "uutils-findutils",
        binary: "updatedb",
        prefix: &[],
    },
    Companion {
        tool: "xargs",
        repository: "uutils-findutils",
        binary: "xargs",
        prefix: &[],
    },
    Companion {
        tool: "grep",
        repository: "uutils-grep",
        binary: "grep",
        prefix: &[],
    },
    Companion {
        tool: "sed",
        repository: "uutils-sed",
        binary: "sed",
        prefix: &[],
    },
    Companion {
        tool: "cmp",
        repository: "uutils-diffutils",
        binary: "diffutils",
        prefix: &["cmp"],
    },
    Companion {
        tool: "diff",
        repository: "uutils-diffutils",
        binary: "diffutils",
        prefix: &["diff"],
    },
    Companion {
        tool: "tar",
        repository: "uutils-tar",
        binary: "tarapp",
        prefix: &["tar"],
    },
];

#[derive(Debug)]
struct CapturedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

/// Reads to EOF so a child never blocks on a full pipe, retaining only a bounded prefix for MCP.
async fn read_capped<R: AsyncRead + Unpin>(
    mut reader: R,
    limit: usize,
) -> std::io::Result<CapturedOutput> {
    let mut bytes = Vec::with_capacity(limit.min(16_384));
    let mut buffer = [0_u8; 16_384];
    let mut truncated = false;
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            return Ok(CapturedOutput { bytes, truncated });
        }
        let remaining = limit.saturating_sub(bytes.len());
        let retained = remaining.min(read);
        bytes.extend_from_slice(&buffer[..retained]);
        truncated |= retained != read;
    }
}

fn default_binary() -> PathBuf {
    let binary = if cfg!(windows) {
        "coreutils.exe"
    } else {
        "coreutils"
    };
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../target/aphrody-uutils/coreutils/bin")
        .join(binary)
}

fn platform_binary(binary: &str) -> String {
    if cfg!(windows) {
        format!("{binary}.exe")
    } else {
        binary.to_owned()
    }
}

fn coreutils_binary() -> PathBuf {
    env::var_os("APHRODY_COREUTILS_BIN").map_or_else(default_binary, PathBuf::from)
}

/// Companions are installed next to the multicall binary (`scripts/aphrody/build/os/build-uutils-coreutils.ts`).
fn companion_binary(companion: &Companion) -> PathBuf {
    let name = platform_binary(companion.binary);
    coreutils_binary()
        .parent()
        .map_or_else(|| PathBuf::from(&name), |dir| dir.join(&name))
}

fn companion(utility: &str) -> Option<&'static Companion> {
    COMPANIONS
        .iter()
        .find(|companion| companion.tool == utility)
}

fn resolve_binary() -> Result<PathBuf, String> {
    let path = coreutils_binary();
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!(
            "uutils coreutils binary not found at `{}`; run `bun scripts/aphrody/build/os/build-uutils-coreutils.ts` or set APHRODY_COREUTILS_BIN",
            path.display()
        ))
    }
}

fn utility_name(value: &Value) -> Result<&str, SubsystemError> {
    let utility = value
        .get("utility")
        .and_then(Value::as_str)
        .ok_or_else(|| SubsystemError::InvalidArguments("missing `utility`".to_owned()))?;
    if utility.is_empty()
        || !utility.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'_' | b'.' | b'[')
        })
    {
        return Err(SubsystemError::InvalidArguments(
            "`utility` must be a uutils command name, not a path or shell expression".to_owned(),
        ));
    }
    Ok(utility)
}

fn string_args(value: &Value) -> Result<Vec<OsString>, SubsystemError> {
    let Some(arguments) = value.get("args") else {
        return Ok(Vec::new());
    };
    let arguments = arguments.as_array().ok_or_else(|| {
        SubsystemError::InvalidArguments("`args` must be an array of strings".to_owned())
    })?;
    arguments
        .iter()
        .map(|argument| {
            let value = argument.as_str().ok_or_else(|| {
                SubsystemError::InvalidArguments("`args` must contain only strings".to_owned())
            })?;
            if value.contains('\0') {
                return Err(SubsystemError::InvalidArguments(
                    "`args` cannot contain NUL bytes".to_owned(),
                ));
            }
            Ok(OsString::from(value))
        })
        .collect()
}

fn bounded_u64(
    value: &Value,
    field: &str,
    default: u64,
    maximum: u64,
) -> Result<u64, SubsystemError> {
    let Some(value) = value.get(field) else {
        return Ok(default);
    };
    let value = value.as_u64().ok_or_else(|| {
        SubsystemError::InvalidArguments(format!("`{field}` must be an unsigned integer"))
    })?;
    if value == 0 || value > maximum {
        return Err(SubsystemError::InvalidArguments(format!(
            "`{field}` must be between 1 and {maximum}"
        )));
    }
    Ok(value)
}

fn output_format(value: &Value) -> Result<&str, SubsystemError> {
    let format = value
        .get("output_format")
        .and_then(Value::as_str)
        .unwrap_or("text");
    match format {
        "text" | "json" | "jsonl" => Ok(format),
        _ => Err(SubsystemError::InvalidArguments(
            "`output_format` must be `text`, `json`, or `jsonl`".to_owned(),
        )),
    }
}

fn decode_output(format: &str, bytes: &[u8]) -> (Value, Option<String>) {
    match format {
        "text" => (Value::Null, None),
        "json" => match serde_json::from_slice(bytes) {
            Ok(value) => (value, None),
            Err(error) => (
                Value::Null,
                Some(format!("stdout is not valid JSON: {error}")),
            ),
        },
        "jsonl" => {
            let mut rows = Vec::new();
            for (index, line) in String::from_utf8_lossy(bytes).lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str(line) {
                    Ok(value) => rows.push(value),
                    Err(error) => {
                        return (
                            Value::Null,
                            Some(format!(
                                "stdout line {} is not valid JSON: {error}",
                                index + 1
                            )),
                        );
                    }
                }
            }
            (Value::Array(rows), None)
        }
        _ => unreachable!("output_format validates accepted values"),
    }
}

fn installed_utilities() -> Vec<String> {
    let Ok(binary) = resolve_binary() else {
        return Vec::new();
    };
    let Ok(output) = std::process::Command::new(binary)
        .no_window()
        .arg("--list")
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|utility| !utility.is_empty() && *utility != "[")
        .filter(|utility| {
            utility
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'_'))
        })
        .map(str::to_owned)
        .collect()
}

fn command_schema(include_utility: bool) -> Value {
    let mut properties = serde_json::Map::from_iter([
        (
            "args".to_owned(),
            json!({ "type": "array", "items": { "type": "string" }, "description": "Literal command arguments; shell syntax is never interpreted" }),
        ),
        (
            "cwd".to_owned(),
            json!({ "type": "string", "description": "Optional working directory" }),
        ),
        (
            "output_format".to_owned(),
            json!({ "type": "string", "enum": ["text", "json", "jsonl"], "default": "text", "description": "Decode stdout for LLM/API consumers without changing the upstream command" }),
        ),
        (
            "timeout_ms".to_owned(),
            json!({ "type": "integer", "minimum": 1, "maximum": MAX_TIMEOUT_MS, "default": DEFAULT_TIMEOUT_MS }),
        ),
        (
            "max_output_bytes".to_owned(),
            json!({ "type": "integer", "minimum": 1, "maximum": MAX_OUTPUT_BYTES, "default": DEFAULT_OUTPUT_BYTES }),
        ),
    ]);
    if include_utility {
        properties.insert("utility".to_owned(), json!({ "type": "string", "description": "uutils command name, such as ls, cp, sort, or sha256sum" }));
    }
    json!({ "type": "object", "properties": properties, "required": if include_utility { vec!["utility"] } else { Vec::new() } })
}

#[derive(Default)]
pub struct CoreutilsSubsystem;

impl CoreutilsSubsystem {
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    async fn execute(
        &self,
        utility: &str,
        binary: PathBuf,
        arguments: Value,
        program_args: Vec<OsString>,
    ) -> Result<Value, SubsystemError> {
        let args = string_args(&arguments)?;
        let output_format = output_format(&arguments)?;
        let timeout_ms = bounded_u64(&arguments, "timeout_ms", DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)?;
        let max_output_bytes = bounded_u64(
            &arguments,
            "max_output_bytes",
            DEFAULT_OUTPUT_BYTES as u64,
            MAX_OUTPUT_BYTES as u64,
        )? as usize;
        let mut command = tokio::process::Command::new(&binary).no_window();
        command
            .args(program_args)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = arguments.get("cwd").and_then(Value::as_str) {
            command.current_dir(cwd);
        }

        let mut child = command.spawn().map_err(|error| {
            SubsystemError::Failed(format!("failed to launch `{}`: {error}", binary.display()))
        })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SubsystemError::Failed("uutils stdout unavailable".to_owned()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| SubsystemError::Failed("uutils stderr unavailable".to_owned()))?;
        let stdout_task = tokio::spawn(read_capped(stdout, max_output_bytes));
        let stderr_task = tokio::spawn(read_capped(stderr, max_output_bytes));
        let (status, timed_out) =
            match tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await {
                Ok(result) => (
                    result.map_err(|error| {
                        SubsystemError::Failed(format!("failed to wait for uutils: {error}"))
                    })?,
                    false,
                ),
                Err(_) => {
                    child.kill().await.map_err(|error| {
                        SubsystemError::Failed(format!("failed to stop timed-out uutils: {error}"))
                    })?;
                    (
                        child.wait().await.map_err(|error| {
                            SubsystemError::Failed(format!(
                                "failed to reap timed-out uutils: {error}"
                            ))
                        })?,
                        true,
                    )
                }
            };
        let stdout = stdout_task
            .await
            .map_err(|error| {
                SubsystemError::Failed(format!("stdout capture task failed: {error}"))
            })?
            .map_err(|error| SubsystemError::Failed(format!("stdout capture failed: {error}")))?;
        let stderr = stderr_task
            .await
            .map_err(|error| {
                SubsystemError::Failed(format!("stderr capture task failed: {error}"))
            })?
            .map_err(|error| SubsystemError::Failed(format!("stderr capture failed: {error}")))?;
        let (data, parse_error) = decode_output(output_format, &stdout.bytes);
        Ok(json!({
            "utility": utility,
            "exit_code": status.code(),
            "timed_out": timed_out,
            "stdout": String::from_utf8_lossy(&stdout.bytes),
            "stderr": String::from_utf8_lossy(&stderr.bytes),
            "stdout_truncated": stdout.truncated,
            "stderr_truncated": stderr.truncated,
            "output_format": output_format,
            "data": data,
            "parse_error": parse_error,
            "binary": binary,
        }))
    }

    async fn run(&self, arguments: Value) -> Result<Value, SubsystemError> {
        let utility = utility_name(&arguments)?.to_owned();
        let binary = resolve_binary().map_err(SubsystemError::Failed)?;
        self.execute(&utility, binary, arguments, vec![OsString::from(&utility)])
            .await
    }

    async fn run_companion(
        &self,
        utility: &str,
        arguments: Value,
    ) -> Result<Value, SubsystemError> {
        let companion = companion(utility)
            .ok_or_else(|| SubsystemError::UnknownTool(format!("uutils_{utility}")))?;
        let binary = companion_binary(companion);
        if !binary.is_file() {
            return Err(SubsystemError::Failed(format!(
                "uutils `{utility}` binary not found at `{}`; run `bun scripts/aphrody/build/os/build-uutils-coreutils.ts`",
                binary.display()
            )));
        }
        self.execute(
            utility,
            binary,
            arguments,
            companion.prefix.iter().map(OsString::from).collect(),
        )
        .await
    }
}

#[async_trait]
impl SystemSubsystem for CoreutilsSubsystem {
    fn name(&self) -> &str {
        "coreutils"
    }

    fn description(&self) -> &str {
        "Pinned uutils/coreutils multicall distribution, routed through the local kernel"
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        let mut tools = vec![
            ToolDefinition::new(
                "coreutils_run",
                "Run one command from the pinned uutils/coreutils distribution without a shell",
                command_schema(true),
            ),
            ToolDefinition::new(
                "coreutils_status",
                "Report the resolved pinned uutils/coreutils binary and whether it is available",
                json!({ "type": "object", "properties": {} }),
            )
            .read_only(),
            ToolDefinition::new(
                "coreutils_catalog",
                "List every command compiled into the pinned uutils/coreutils multicall binary",
                json!({ "type": "object", "properties": {} }),
            )
            .read_only(),
            ToolDefinition::new(
                "uutils_run",
                "Run a pinned uutils companion utility (find, grep, sed, diff, or tar) without a shell",
                command_schema(true),
            ),
            ToolDefinition::new(
                "uutils_catalog",
                "List supported pinned uutils companion utilities and their availability",
                json!({ "type": "object", "properties": {} }),
            )
            .read_only(),
        ];
        for utility in installed_utilities() {
            tools.push(ToolDefinition::new(
                format!("coreutils_{utility}"),
                format!("Run uutils `{utility}` through the local Aphrody kernel"),
                command_schema(false),
            ));
        }
        for companion in COMPANIONS
            .iter()
            .filter(|companion| companion_binary(companion).is_file())
        {
            tools.push(ToolDefinition::new(
                format!("uutils_{}", companion.tool),
                format!(
                    "Run uutils {} through the local Aphrody kernel",
                    companion.tool
                ),
                command_schema(false),
            ));
        }
        tools
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "coreutils_run" => self.run(arguments).await,
            "coreutils_catalog" => {
                let result = self
                    .run(json!({ "utility": "--list", "max_output_bytes": MAX_OUTPUT_BYTES }))
                    .await?;
                let stdout = result
                    .get("stdout")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let utilities: Vec<_> = stdout.lines().filter(|line| !line.is_empty()).collect();
                let count = utilities.len();
                Ok(
                    json!({ "utilities": utilities, "count": count, "upstream": "uutils/coreutils", "version": "0.12.0" }),
                )
            }
            "uutils_catalog" => Ok(json!({
                "utilities": COMPANIONS.iter().map(|companion| json!({
                    "utility": companion.tool,
                    "repository": format!("uutils/{}", companion.repository.trim_start_matches("uutils-")),
                    "available": companion_binary(companion).is_file(),
                })).collect::<Vec<_>>(),
            })),
            "coreutils_status" => match resolve_binary() {
                Ok(binary) => Ok(json!({
                    "available": true,
                    "binary": binary,
                    "upstream": "uutils/coreutils",
                    "version": "0.12.0",
                    "companions": COMPANIONS.iter().map(|companion| json!({
                        "utility": companion.tool,
                        "repository": format!("uutils/{}", companion.repository.trim_start_matches("uutils-")),
                        "available": companion_binary(companion).is_file(),
                    })).collect::<Vec<_>>(),
                })),
                Err(reason) => Ok(json!({
                    "available": false,
                    "reason": reason,
                    "upstream": "uutils/coreutils",
                    "version": "0.12.0",
                })),
            },
            "uutils_run" => {
                let utility = utility_name(&arguments)?.to_owned();
                self.run_companion(&utility, arguments).await
            }
            tool if tool.starts_with("coreutils_") => {
                let utility = tool.trim_start_matches("coreutils_");
                if !installed_utilities()
                    .iter()
                    .any(|available| available == utility)
                {
                    return Err(SubsystemError::UnknownTool(tool.to_owned()));
                }
                let mut arguments = arguments.as_object().cloned().ok_or_else(|| {
                    SubsystemError::InvalidArguments("arguments must be a JSON object".to_owned())
                })?;
                arguments.insert("utility".to_owned(), Value::String(utility.to_owned()));
                self.run(Value::Object(arguments)).await
            }
            tool if tool.starts_with("uutils_") => {
                self.run_companion(tool.trim_start_matches("uutils_"), arguments)
                    .await
            }
            _ => Err(SubsystemError::UnknownTool(tool.to_owned())),
        }
    }
}

#[cfg(test)]
mod tests {
    use aphrody_subsystem::SystemSubsystem;
    use serde_json::json;

    use super::CoreutilsSubsystem;

    #[tokio::test]
    async fn exposes_only_the_upstream_multicall_contract() {
        let subsystem = CoreutilsSubsystem::new();
        let names: Vec<_> = subsystem
            .tools()
            .into_iter()
            .map(|tool| tool.name)
            .collect();
        assert!(names.starts_with(&[
            "coreutils_run".to_owned(),
            "coreutils_status".to_owned(),
            "coreutils_catalog".to_owned(),
        ]));
        assert!(
            subsystem
                .call("coreutils_not_a_real_command", json!({}))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn rejects_shell_syntax_in_utility_name() {
        let subsystem = CoreutilsSubsystem::new();
        let result = subsystem
            .call("coreutils_run", json!({ "utility": "ls;rm" }))
            .await;
        assert!(result.is_err());
    }

    #[test]
    fn companions_resolve_next_to_the_multicall_binary() {
        let sed = super::COMPANIONS
            .iter()
            .find(|companion| companion.tool == "sed")
            .unwrap();
        assert_eq!(
            super::companion_binary(sed).parent(),
            super::coreutils_binary().parent()
        );
    }

    #[tokio::test]
    async fn runs_an_installed_companion() {
        let sed = super::COMPANIONS
            .iter()
            .find(|companion| companion.tool == "sed")
            .unwrap();
        if !super::companion_binary(sed).is_file() {
            eprintln!(
                "uutils sed not installed: bun scripts/aphrody/build/os/build-uutils-coreutils.ts"
            );
            return;
        }
        let result = CoreutilsSubsystem::new()
            .call(
                "uutils_run",
                json!({ "utility": "sed", "args": ["--version"] }),
            )
            .await
            .unwrap();
        assert_eq!(result["exit_code"], 0, "{result}");
    }

    #[test]
    fn decodes_json_lines_for_api_consumers() {
        let (data, error) =
            super::decode_output("jsonl", b"{\"name\":\"aphrody\"}\n{\"ok\":true}\n");
        assert!(error.is_none());
        assert_eq!(data, json!([{"name":"aphrody"}, {"ok":true}]));
    }
}
