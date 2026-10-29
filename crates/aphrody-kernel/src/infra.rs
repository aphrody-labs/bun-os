// SPDX-License-Identifier: Apache-2.0
//! Privileged infrastructure and remote control plane subsystem (`infra`).
//!
//! Exposes native SSH execution, SFTP remote filesystem navigation, differential
//! synchronization (`fast_rsync`), and remote Git inspection as kernel tools.

use aphrody_proc::NoWindow as _;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

use aphrody_subsystem::{SubsystemError, SystemSubsystem, ToolDefinition};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::process::Command;

use crate::paths::{EnvLookup, process_env, var};

/// Layout marker of the Aphrody monorepo that owns `aphrody-ssh`.
const SSH_OWNER_MARKER: &str = "crates/infra/ssh/Cargo.toml";

/// Historical checkout directory under the home directory, tried after everything configured.
const DEFAULT_CHECKOUT_DIR: &str = "aphrody";

/// The kernel-owned infrastructure control plane.
#[derive(Debug, Default)]
pub struct InfraSubsystem;

impl InfraSubsystem {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// Whether `root` is a checkout of the Aphrody monorepo that can build `aphrody-ssh`.
fn has_ssh_owner_layout(root: &Path) -> bool {
    root.join("Cargo.toml").is_file() && root.join(SSH_OWNER_MARKER).is_file()
}

fn find_infra_manifest() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok();
    let executable = std::env::current_exe().ok();
    let home = crate::paths::home_dir();
    resolve_infra_manifest(
        &process_env,
        cwd.as_deref(),
        executable.as_deref(),
        home.as_deref(),
    )
}

/// The workspace manifest that builds `aphrody-ssh` from source (development only, behind
/// `APHRODY_INFRA_BUILD_FROM_SOURCE=1`). First match wins:
///
/// 1. `APHRODY_INFRA_PATH`: the exact `Cargo.toml`.
/// 2. `APHRODY_INFRA_DIR`: a directory holding `Cargo.toml`.
/// 3. `APHRODY_INFRA_ROOT`, then `APHRODY_ROOT`: a checkout root with the SSH owner layout
///    (the names `aphrody-ssh` and the CLI already use for the same checkout).
/// 4. The working directory and the kernel's own directory, with their ancestors.
/// 5. `<home>/aphrody`, the historical default checkout location (same layout check).
///
/// A configured value that does not exist or has the wrong layout falls through to the next
/// step, as before. The environment, the directories and the home are all injected so relocated
/// clean clones and service launches are tested without touching the process environment.
fn resolve_infra_manifest(
    env: EnvLookup<'_>,
    cwd: Option<&Path>,
    executable: Option<&Path>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(path) = var(env, "APHRODY_INFRA_PATH").map(PathBuf::from)
        && path.is_file()
    {
        return Some(path);
    }
    if let Some(directory) = var(env, "APHRODY_INFRA_DIR") {
        let manifest = PathBuf::from(directory).join("Cargo.toml");
        if manifest.is_file() {
            return Some(manifest);
        }
    }
    for key in ["APHRODY_INFRA_ROOT", "APHRODY_ROOT"] {
        if let Some(root) = var(env, key).map(PathBuf::from)
            && has_ssh_owner_layout(&root)
        {
            return Some(root.join("Cargo.toml"));
        }
    }
    find_workspace_manifest(cwd, executable, home)
}

// Keep this independent of process environment so relocated clean clones and service
// launches can be tested without changing environment variables in parallel tests.
fn find_workspace_manifest(
    cwd: Option<&Path>,
    executable: Option<&Path>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    for start in cwd.into_iter().chain(executable.and_then(Path::parent)) {
        for root in start.ancestors() {
            if has_ssh_owner_layout(root) {
                return Some(root.join("Cargo.toml"));
            }
        }
    }
    let root = home?.join(DEFAULT_CHECKOUT_DIR);
    has_ssh_owner_layout(&root).then(|| root.join("Cargo.toml"))
}

fn resolve_infra_invoker() -> Result<(String, Vec<String>), SubsystemError> {
    let executable = std::env::current_exe().ok();
    plan_infra_invoker(
        &process_env,
        ssh_on_path,
        executable.as_deref(),
        find_infra_manifest,
    )
}

/// Whether an `aphrody-ssh` found by the operating system's `PATH` lookup runs.
fn ssh_on_path() -> bool {
    std::process::Command::new("aphrody-ssh")
        .no_window()
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success())
}

/// `APHRODY_SSH_BIN`: the override `aphrody ssh` and the deployment scripts already honour.
///
/// It is authoritative when set, including when it is invalid, so a typo never silently selects
/// another binary. A bare command name is left to the operating system's `PATH` lookup; a value
/// with a directory part must be an existing file.
fn explicit_ssh_binary(env: EnvLookup<'_>) -> Result<Option<String>, SubsystemError> {
    let Some(value) = var(env, "APHRODY_SSH_BIN") else {
        return Ok(None);
    };
    let command = value.to_string_lossy().trim().to_owned();
    if command.is_empty() {
        return Ok(None);
    }
    let path = Path::new(&command);
    if path.components().count() > 1 && !path.is_file() {
        return Err(SubsystemError::Unavailable(format!(
            "APHRODY_SSH_BIN points to `{command}`, which is not an existing file"
        )));
    }
    Ok(Some(command))
}

/// The program and arguments that run `aphrody-ssh`. First match wins:
///
/// 1. `APHRODY_SSH_BIN` (explicit, see [`explicit_ssh_binary`]).
/// 2. `aphrody-ssh` found by `PATH` (`path_probe`).
/// 3. `aphrody-ssh` beside the running kernel.
/// 4. Only with `APHRODY_INFRA_BUILD_FROM_SOURCE=1`: a build of the workspace located by
///    `find_manifest` (see [`resolve_infra_manifest`]).
///
/// With none of them the infra tools report [`SubsystemError::Unavailable`] with the remedies,
/// instead of failing obscurely: they serve the Aphrody infrastructure hosts and have no meaning
/// on a machine that has neither the binary nor a checkout.
fn plan_infra_invoker(
    env: EnvLookup<'_>,
    path_probe: impl FnOnce() -> bool,
    executable: Option<&Path>,
    find_manifest: impl FnOnce() -> Option<PathBuf>,
) -> Result<(String, Vec<String>), SubsystemError> {
    if let Some(binary) = explicit_ssh_binary(env)? {
        return Ok((binary, Vec::new()));
    }

    if path_probe() {
        return Ok(("aphrody-ssh".to_string(), Vec::new()));
    }

    if let Some(directory) = executable.and_then(Path::parent) {
        let binary = directory.join(format!("aphrody-ssh{}", std::env::consts::EXE_SUFFIX));
        if binary.is_file() {
            return Ok((binary.to_string_lossy().into_owned(), Vec::new()));
        }
    }

    if var(env, "APHRODY_INFRA_BUILD_FROM_SOURCE").is_some_and(|value| value == "1")
        && let Some(manifest) = find_manifest()
        && let Some(invoker) = workspace_infra_invoker(&manifest, true)
    {
        return Ok(invoker);
    }

    Err(SubsystemError::Unavailable(
        "the infra tools need the `aphrody-ssh` binary, which was not found: install it on PATH \
         or beside aphrody-kernel, or set APHRODY_SSH_BIN to its path (inside an Aphrody \
         checkout, APHRODY_INFRA_BUILD_FROM_SOURCE=1 builds it from the workspace located by \
         APHRODY_INFRA_DIR, APHRODY_INFRA_PATH, APHRODY_INFRA_ROOT, APHRODY_ROOT or the working \
         directory). These tools only serve the declared Aphrody SSH hosts (vps, dbfr and the wg1 PCs)."
            .into(),
    ))
}

fn workspace_infra_invoker(manifest: &Path, allow_source: bool) -> Option<(String, Vec<String>)> {
    if !allow_source {
        return None;
    }
    if let Some(manifest_dir) = manifest.parent() {
        // `aphrody-ssh` is the `ssh` subcommand of the single `aphrody` multi-call binary.
        let bin_name = if cfg!(windows) {
            "aphrody.exe"
        } else {
            "aphrody"
        };
        let debug_bin = manifest_dir.join("target").join("debug").join(bin_name);
        let release_bin = manifest_dir.join("target").join("release").join(bin_name);
        if release_bin.is_file() {
            return Some((
                release_bin.to_string_lossy().into_owned(),
                vec!["ssh".to_string()],
            ));
        }
        if debug_bin.is_file() {
            return Some((
                debug_bin.to_string_lossy().into_owned(),
                vec!["ssh".to_string()],
            ));
        }
    }

    Some((
        "cargo".to_string(),
        vec![
            "run".to_string(),
            "--locked".to_string(),
            "--manifest-path".to_string(),
            manifest.to_string_lossy().into_owned(),
            "-p".to_string(),
            "aphrody".to_string(),
            "--bin".to_string(),
            "aphrody".to_string(),
            "--".to_string(),
            "ssh".to_string(),
        ],
    ))
}

#[async_trait]
impl SystemSubsystem for InfraSubsystem {
    fn name(&self) -> &'static str {
        "infra"
    }

    fn description(&self) -> &'static str {
        "Kernel-owned infrastructure control plane: native SSH execution, SFTP filesystem \
         traversal, differential fast-rsync sync and remote Git operations."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "infra_exec",
                "Execute an arbitrary remote command on an Aphrody SSH host (vps, dbfr, Omar Windows/WSL, aphro-pc; Windows hosts run cmd.exe) via in-process SSH",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": SSH_HOSTS,
                            "description": "Target infrastructure host alias"
                        },
                        "command": {
                            "type": "string",
                            "description": "Command string to execute remotely"
                        }
                    },
                    "required": ["host", "command"]
                }),
            ),
            ToolDefinition::new(
                "infra_sftp_list",
                "List directory entries and metadata (size, permissions, is_dir) on an Aphrody infrastructure host via native SFTP",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": SSH_HOSTS,
                            "description": "Target infrastructure host alias"
                        },
                        "path": {
                            "type": "string",
                            "description": "Remote directory path (defaults to /var/www)"
                        }
                    },
                    "required": ["host"]
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "infra_sftp_read",
                "Read the content of a remote file on an Aphrody infrastructure host via native in-process SFTP",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": SSH_HOSTS,
                            "description": "Target infrastructure host alias"
                        },
                        "path": {
                            "type": "string",
                            "description": "Remote file path to read"
                        }
                    },
                    "required": ["host", "path"]
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "infra_sync",
                "Execute a differential file/directory synchronization with remote infrastructure host (fast-rsync/rclone)",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": SSH_HOSTS,
                            "description": "Target infrastructure host alias"
                        },
                        "source": {
                            "type": "string",
                            "description": "Local source directory path"
                        },
                        "destination": {
                            "type": "string",
                            "description": "Remote destination directory path"
                        },
                        "apply": {
                            "type": "boolean",
                            "description": "Apply transfer changes (defaults to false = dry-run)"
                        }
                    },
                    "required": ["host", "source", "destination"]
                }),
            ),
            ToolDefinition::new(
                "infra_git_status",
                "Inspect the working tree status and recent commits of a production Git repository on an infrastructure host",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": SSH_HOSTS,
                            "description": "Target infrastructure host alias"
                        },
                        "repo_path": {
                            "type": "string",
                            "description": "Remote path to the git repository (e.g. ~/aphrody)"
                        }
                    },
                    "required": ["host", "repo_path"]
                }),
            )
            .read_only(),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "infra_exec" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let command = arguments
                    .get("command")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing command".into()))?;

                validate_host(host)?;
                let output =
                    run_infra_cli(&["--json", "exec", "--host", host, "--cmd", command]).await?;
                Ok(output)
            }
            "infra_sftp_list" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let path = arguments
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("/var/www");

                validate_host(host)?;
                let output =
                    run_infra_cli(&["--json", "sftp", "--host", host, "--path", path]).await?;
                Ok(output)
            }
            "infra_sftp_read" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let path = arguments
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing path".into()))?;

                validate_host(host)?;
                let output =
                    run_infra_cli(&["--json", "sftp", "--host", host, "--cat", path]).await?;
                Ok(output)
            }
            "infra_sync" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let source = arguments
                    .get("source")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing source".into()))?;
                let destination = arguments
                    .get("destination")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing destination".into())
                    })?;
                let apply = arguments
                    .get("apply")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                validate_host(host)?;
                let mut args = vec![
                    "--json",
                    "sync",
                    "--host",
                    host,
                    "--source",
                    source,
                    "--destination",
                    destination,
                ];
                if apply {
                    args.push("--apply");
                }
                let output = run_infra_cli(&args).await?;
                Ok(output)
            }
            "infra_git_status" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let repo_path = arguments
                    .get("repo_path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing repo_path".into()))?;

                validate_host(host)?;
                let cmd = git_status_command(repo_path)?;
                let output =
                    run_infra_cli(&["--json", "exec", "--host", host, "--cmd", &cmd]).await?;
                Ok(output)
            }
            _ => Err(SubsystemError::UnknownTool(tool.to_owned())),
        }
    }
}

fn git_status_command(repo_path: &str) -> Result<String, SubsystemError> {
    if repo_path.is_empty() || repo_path.contains('\0') {
        return Err(SubsystemError::InvalidArguments(
            "repo_path must be nonempty and contain no NUL".into(),
        ));
    }
    let quote = |value: &str| format!("'{}'", value.replace('\'', "'\"'\"'"));
    // Expand only the documented home shorthand, keeping the rest a literal
    // shell argument even when names contain quotes, spaces or shell operators.
    let path = if repo_path == "~" {
        "\"$HOME\"".to_owned()
    } else if let Some(relative) = repo_path.strip_prefix("~/") {
        format!("\"$HOME\"/{}", quote(relative))
    } else {
        quote(repo_path)
    };
    Ok(format!(
        "git -C {path} status --short --branch && git -C {path} log -n 5 --oneline"
    ))
}

/// SSH hosts of `aphrody infra ssh --host` (`aphrody_ssh::Host` values and aliases).
const SSH_HOSTS: [&str; 8] = [
    "vps",
    "dbfr",
    "omar",
    "omar-pc",
    "omar-rt",
    "omar-wsl",
    "omar-wsl-rt",
    "aphro-pc",
];

fn validate_host(host: &str) -> Result<(), SubsystemError> {
    if !SSH_HOSTS.contains(&host) {
        return Err(SubsystemError::InvalidArguments(format!(
            "host must be one of {}",
            SSH_HOSTS.join(", ")
        )));
    }
    Ok(())
}

async fn run_infra_cli(args: &[&str]) -> Result<Value, SubsystemError> {
    let (program, mut cmd_args) = resolve_infra_invoker()?;
    for arg in args {
        cmd_args.push((*arg).to_string());
    }

    let output = Command::new(&program)
        .no_window()
        .args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| SubsystemError::Failed(format!("failed to spawn {program}: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(SubsystemError::Failed(format!(
            "aphrody-ssh failed with exit code {:?}: {}",
            output.status.code(),
            stderr.trim()
        )));
    }

    if let Ok(parsed) = serde_json::from_str::<Value>(&stdout) {
        Ok(parsed)
    } else {
        Ok(json!({
            "stdout": stdout.to_string(),
            "stderr": stderr.to_string(),
            "exit_code": output.status.code().unwrap_or(0),
        }))
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use super::*;
    use crate::paths::table;

    /// A checkout carrying the SSH owner layout at `base/name`.
    fn checkout(base: &Path, name: &str) -> PathBuf {
        let root = base.join(name);
        std::fs::create_dir_all(root.join("crates/infra/ssh")).unwrap();
        std::fs::write(root.join("Cargo.toml"), "[workspace]\n").unwrap();
        std::fs::write(root.join(SSH_OWNER_MARKER), "[package]\n").unwrap();
        root
    }

    #[test]
    fn discovers_relocated_workspace_from_nested_cwd_and_kernel() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("relocated");
        std::fs::create_dir_all(root.join("crates/infra/ssh")).unwrap();
        std::fs::write(root.join("Cargo.toml"), "[workspace]\n").unwrap();
        std::fs::write(root.join("crates/infra/ssh/Cargo.toml"), "[package]\n").unwrap();
        let expected = Some(root.join("Cargo.toml"));
        assert_eq!(
            find_workspace_manifest(Some(&root.join("docs/reference")), None, None),
            expected
        );
        assert_eq!(
            find_workspace_manifest(
                None,
                Some(&root.join("target/release/aphrody-kernel")),
                None
            ),
            expected
        );
        assert_eq!(find_workspace_manifest(Some(dir.path()), None, None), None);
    }

    #[test]
    fn workspace_manifest_never_triggers_an_implicit_build() {
        let dir = tempfile::tempdir().expect("tempdir");
        let manifest = dir.path().join("Cargo.toml");
        std::fs::write(&manifest, "[workspace]\n").unwrap();
        assert_eq!(workspace_infra_invoker(&manifest, false), None);
        let (command, args) = workspace_infra_invoker(&manifest, true).unwrap();
        assert_eq!(command, "cargo");
        assert!(args.contains(&"--locked".to_owned()));
        assert!(args.contains(&manifest.to_string_lossy().into_owned()));
    }

    #[test]
    fn home_fallback_requires_current_owner_layout() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("aphrody");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("Cargo.toml"), "[workspace]\n").unwrap();
        assert_eq!(find_workspace_manifest(None, None, Some(dir.path())), None);
        std::fs::create_dir_all(root.join("crates/infra/ssh")).unwrap();
        std::fs::write(root.join("crates/infra/ssh/Cargo.toml"), "[package]\n").unwrap();
        assert_eq!(
            find_workspace_manifest(None, None, Some(dir.path())),
            Some(root.join("Cargo.toml"))
        );
    }

    #[test]
    fn legacy_archives_are_not_automatically_discovered() {
        let dir = tempfile::tempdir().expect("tempdir");
        let legacy = dir.path().join("src/aphrody-infra");
        std::fs::create_dir_all(legacy.join("crates/aphrody-ssh")).unwrap();
        std::fs::write(legacy.join("Cargo.toml"), "[workspace]\n").unwrap();
        std::fs::write(legacy.join("crates/aphrody-ssh/Cargo.toml"), "[package]\n").unwrap();
        assert_eq!(find_workspace_manifest(Some(&legacy), None, None), None);
        assert_eq!(find_workspace_manifest(None, None, Some(dir.path())), None);
    }

    #[cfg(unix)]
    #[test]
    fn git_status_handles_literal_paths_and_home_shorthand() {
        let dir = tempfile::tempdir().expect("tempdir");
        for relative in ["quoted ' name", "repo' ; touch INJECTED ; #", "ordinary"] {
            let repository = dir.path().join(relative);
            std::fs::create_dir(&repository).unwrap();
            assert!(
                std::process::Command::new("git")
                    .args(["init", "--quiet"])
                    .arg(&repository)
                    .status()
                    .unwrap()
                    .success()
            );
            // A missing HEAD makes log fail; status must still run for the correct path.
            for path in [
                repository.to_string_lossy().into_owned(),
                format!("~/{relative}"),
            ] {
                let output = std::process::Command::new("sh")
                    .arg("-c")
                    .arg(git_status_command(&path).unwrap())
                    .env("HOME", dir.path())
                    .current_dir(dir.path())
                    .output()
                    .unwrap();
                assert!(String::from_utf8_lossy(&output.stdout).contains("## No commits yet"));
                assert!(!dir.path().join("INJECTED").exists());
            }
        }
        assert!(git_status_command("").is_err());
        assert!(git_status_command("repo\0path").is_err());
    }

    #[tokio::test]
    async fn infra_subsystem_declares_tools() {
        let infra = InfraSubsystem::new();
        assert_eq!(infra.name(), "infra");
        let tools = infra.tools();
        assert_eq!(tools.len(), 5);
        let names: Vec<_> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"infra_exec"));
        assert!(names.contains(&"infra_sftp_list"));
        assert!(names.contains(&"infra_sftp_read"));
        assert!(names.contains(&"infra_sync"));
        assert!(names.contains(&"infra_git_status"));
    }

    #[tokio::test]
    async fn infra_subsystem_rejects_unknown_host() {
        let infra = InfraSubsystem::new();
        let res = infra
            .call(
                "infra_exec",
                json!({ "host": "unknown_vps", "command": "uptime" }),
            )
            .await;
        assert!(matches!(res, Err(SubsystemError::InvalidArguments(_))));
    }

    #[tokio::test]
    async fn infra_subsystem_validates_arguments_and_tools() {
        let infra = InfraSubsystem::new();

        // Unknown tool
        let res_unknown = infra.call("nonexistent_tool", json!({})).await;
        assert!(matches!(res_unknown, Err(SubsystemError::UnknownTool(_))));

        // Missing command in infra_exec
        let res_no_cmd = infra.call("infra_exec", json!({ "host": "vps" })).await;
        assert!(matches!(
            res_no_cmd,
            Err(SubsystemError::InvalidArguments(_))
        ));

        // Missing path in infra_sftp_read
        let res_no_path = infra
            .call("infra_sftp_read", json!({ "host": "vps" }))
            .await;
        assert!(matches!(
            res_no_path,
            Err(SubsystemError::InvalidArguments(_))
        ));

        // Missing host in infra_sftp_list
        let res_no_host = infra.call("infra_sftp_list", json!({})).await;
        assert!(matches!(
            res_no_host,
            Err(SubsystemError::InvalidArguments(_))
        ));

        // Missing destination in infra_sync
        let res_no_dest = infra
            .call("infra_sync", json!({ "host": "vps", "source": "." }))
            .await;
        assert!(matches!(
            res_no_dest,
            Err(SubsystemError::InvalidArguments(_))
        ));

        // Missing repo_path in infra_git_status
        let res_no_repo = infra
            .call("infra_git_status", json!({ "host": "vps" }))
            .await;
        assert!(matches!(
            res_no_repo,
            Err(SubsystemError::InvalidArguments(_))
        ));
    }

    #[test]
    fn validate_host_rules() {
        assert!(validate_host("vps").is_ok());
        assert!(validate_host("dbfr").is_ok());
        assert!(validate_host("omar-wsl").is_ok());
        assert!(validate_host("aphro-pc").is_ok());
        assert!(validate_host("unknown").is_err());
        assert!(validate_host("").is_err());
    }

    #[test]
    fn explicit_manifest_path_beats_every_other_source() {
        let dir = tempfile::tempdir().expect("tempdir");
        let explicit = dir.path().join("explicit/Cargo.toml");
        std::fs::create_dir_all(explicit.parent().unwrap()).unwrap();
        std::fs::write(&explicit, "[workspace]\n").unwrap();
        let by_dir = checkout(dir.path(), "by-dir");
        let by_root = checkout(dir.path(), "by-root");
        let walked = checkout(dir.path(), "walked");
        let home = dir.path().join("home");
        checkout(&home, DEFAULT_CHECKOUT_DIR);
        let env = table([
            ("APHRODY_INFRA_PATH", explicit.as_os_str()),
            ("APHRODY_INFRA_DIR", by_dir.as_os_str()),
            ("APHRODY_INFRA_ROOT", by_root.as_os_str()),
        ]);
        assert_eq!(
            resolve_infra_manifest(&env, Some(&walked), None, Some(&home)),
            Some(explicit)
        );
    }

    #[test]
    fn configured_sources_are_tried_before_the_walk_and_the_home_default() {
        let dir = tempfile::tempdir().expect("tempdir");
        let by_dir = checkout(dir.path(), "by-dir");
        let by_infra_root = checkout(dir.path(), "by-infra-root");
        let by_root = checkout(dir.path(), "by-root");
        let walked = checkout(dir.path(), "walked");
        let home = dir.path().join("home");
        let default = checkout(&home, DEFAULT_CHECKOUT_DIR);
        let manifest = |root: &Path| Some(root.join("Cargo.toml"));
        let resolve = |env: &dyn Fn(&str) -> Option<std::ffi::OsString>| {
            resolve_infra_manifest(env, Some(&walked), None, Some(&home))
        };

        let all = table([
            ("APHRODY_INFRA_DIR", by_dir.as_os_str()),
            ("APHRODY_INFRA_ROOT", by_infra_root.as_os_str()),
            ("APHRODY_ROOT", by_root.as_os_str()),
        ]);
        assert_eq!(resolve(&all), manifest(&by_dir));
        let without_dir = table([
            ("APHRODY_INFRA_ROOT", by_infra_root.as_os_str()),
            ("APHRODY_ROOT", by_root.as_os_str()),
        ]);
        assert_eq!(resolve(&without_dir), manifest(&by_infra_root));
        let only_root = table([("APHRODY_ROOT", by_root.as_os_str())]);
        assert_eq!(resolve(&only_root), manifest(&by_root));

        // Nothing configured: the working directory walk, then the home default, as before.
        let none = table::<&str, &str>([]);
        assert_eq!(resolve(&none), manifest(&walked));
        assert_eq!(
            resolve_infra_manifest(&none, None, None, Some(&home)),
            manifest(&default)
        );
        assert_eq!(resolve_infra_manifest(&none, None, None, None), None);
    }

    #[test]
    fn configured_values_that_do_not_apply_fall_through_instead_of_failing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let walked = checkout(dir.path(), "walked");
        let bare = dir.path().join("bare");
        std::fs::create_dir_all(&bare).unwrap();
        std::fs::write(bare.join("Cargo.toml"), "[workspace]\n").unwrap();
        let missing = dir.path().join("missing");
        // A missing manifest, a directory without one, a root without the owner layout and an
        // empty variable all leave the resolution to the walk.
        let env = table([
            ("APHRODY_INFRA_PATH", missing.join("Cargo.toml").as_os_str()),
            ("APHRODY_INFRA_DIR", missing.as_os_str()),
            ("APHRODY_INFRA_ROOT", bare.as_os_str()),
            ("APHRODY_ROOT", OsStr::new("")),
        ]);
        assert_eq!(
            resolve_infra_manifest(&env, Some(&walked), None, None),
            Some(walked.join("Cargo.toml"))
        );
        assert_eq!(resolve_infra_manifest(&env, None, None, None), None);
    }

    #[test]
    fn explicit_ssh_binary_is_authoritative_when_set() {
        let dir = tempfile::tempdir().expect("tempdir");
        let binary = dir
            .path()
            .join(format!("custom-ssh{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&binary, "").unwrap();

        // Unset, empty and blank values leave the choice to the rest of the order.
        for value in [None, Some(""), Some("  ")] {
            let env = table(value.map(|value| ("APHRODY_SSH_BIN", value)));
            assert_eq!(explicit_ssh_binary(&env).unwrap(), None, "{value:?}");
        }
        let env = table([("APHRODY_SSH_BIN", binary.as_os_str())]);
        assert_eq!(
            explicit_ssh_binary(&env).unwrap(),
            Some(binary.to_string_lossy().into_owned())
        );
        // A bare command name is resolved by the operating system's PATH lookup at spawn time.
        let env = table([("APHRODY_SSH_BIN", "my-ssh")]);
        assert_eq!(
            explicit_ssh_binary(&env).unwrap(),
            Some("my-ssh".to_owned())
        );
        // A path that does not exist is an error, never a silent switch to another binary.
        let missing = dir.path().join("missing-ssh");
        let env = table([("APHRODY_SSH_BIN", missing.as_os_str())]);
        let error = explicit_ssh_binary(&env).unwrap_err();
        assert!(
            matches!(&error, SubsystemError::Unavailable(message) if message.contains("APHRODY_SSH_BIN")),
            "{error}"
        );
    }

    #[test]
    fn invoker_order_is_explicit_then_path_then_sibling_then_opted_in_source() {
        let dir = tempfile::tempdir().expect("tempdir");
        let kernel_directory = dir.path().join("bin");
        std::fs::create_dir_all(&kernel_directory).unwrap();
        let sibling = kernel_directory.join(format!("aphrody-ssh{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&sibling, "").unwrap();
        let kernel = kernel_directory.join("aphrody-kernel");
        let none = table::<&str, &str>([]);

        let explicit = table([("APHRODY_SSH_BIN", "custom-ssh")]);
        assert_eq!(
            plan_infra_invoker(&explicit, || true, Some(&kernel), || None).unwrap(),
            ("custom-ssh".to_owned(), Vec::new())
        );
        assert_eq!(
            plan_infra_invoker(&none, || true, Some(&kernel), || None).unwrap(),
            ("aphrody-ssh".to_owned(), Vec::new())
        );
        assert_eq!(
            plan_infra_invoker(&none, || false, Some(&kernel), || None).unwrap(),
            (sibling.to_string_lossy().into_owned(), Vec::new())
        );

        // A workspace is never built (nor even searched) without the explicit opt-in.
        let manifest = checkout(dir.path(), "checkout").join("Cargo.toml");
        let searched =
            || -> Option<PathBuf> { panic!("no opt-in: the workspace must not be searched") };
        for value in [None, Some("0"), Some("true"), Some("")] {
            let env = table(value.map(|value| ("APHRODY_INFRA_BUILD_FROM_SOURCE", value)));
            assert!(
                plan_infra_invoker(&env, || false, None, searched).is_err(),
                "{value:?}"
            );
        }
        let opted_in = table([("APHRODY_INFRA_BUILD_FROM_SOURCE", "1")]);
        let (program, arguments) =
            plan_infra_invoker(&opted_in, || false, None, || Some(manifest.clone())).unwrap();
        assert_eq!(program, "cargo");
        assert!(arguments.contains(&"--locked".to_owned()));
        assert!(arguments.contains(&manifest.to_string_lossy().into_owned()));
    }

    #[test]
    fn without_a_binary_or_a_checkout_the_infra_tools_say_what_to_do() {
        let none = table::<&str, &str>([]);
        let error = plan_infra_invoker(&none, || false, None, || None).unwrap_err();
        let SubsystemError::Unavailable(message) = &error else {
            panic!("expected Unavailable, got {error:?}");
        };
        for remedy in [
            "aphrody-ssh",
            "PATH",
            "APHRODY_SSH_BIN",
            "APHRODY_INFRA_BUILD_FROM_SOURCE",
        ] {
            assert!(message.contains(remedy), "missing `{remedy}` in: {message}");
        }
        // The opt-in alone does not help when no workspace can be located either.
        let opted_in = table([("APHRODY_INFRA_BUILD_FROM_SOURCE", "1")]);
        assert!(plan_infra_invoker(&opted_in, || false, None, || None).is_err());
    }
}
