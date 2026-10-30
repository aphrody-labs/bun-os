// SPDX-License-Identifier: Apache-2.0
//! Direct, cancellable Web product workflows on the shared native runtime.

use std::{ffi::c_char, path::PathBuf};

#[derive(serde::Deserialize)]
struct McpInvocation {
    config: Option<PathBuf>,
    server: String,
    tool: String,
    arguments: serde_json::Value,
}

use super::{
    ffi_util::{borrow_str, error_json_string, guard},
    jobs,
};

/// Additive workflow extension version; the existing Web ABI remains unchanged.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_pipeline_abi_version() -> u32 {
    1
}

/// Includes cancelled workflows until their local futures have actually stopped.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_pipeline_pending_count() -> u64 {
    jobs::local_pending_count()
}

/// Submit a crawl/index operation without a subprocess.
///
/// Arguments omit the `aphrody web` prefix. Input bytes are borrowed only during
/// this call; serde copies them into Rust-owned strings before the job starts.
/// Results use the existing job take/cancel API and its string deallocator.
///
/// # Safety
/// `args_json` must be null or a readable, NUL-terminated UTF-8 string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_pipeline_submit(
    args_json: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        // SAFETY: required by this function's input pointer contract.
        let Some(raw) = (unsafe { borrow_str(args_json) }) else {
            return jobs::resolved(error_json_string("workflow arguments must be UTF-8 JSON"));
        };
        if raw.len() > 1_048_576 {
            return jobs::resolved(error_json_string("workflow arguments exceed one MiB"));
        }
        let args = match serde_json::from_str::<Vec<String>>(raw) {
            Ok(args) if !args.is_empty() && args.len() <= 256 => args,
            _ => return jobs::resolved(error_json_string("expected 1..256 workflow arguments")),
        };
        jobs::submit_local(timeout_ms, move || async move {
            match aphrody_command::run_web_pipeline(args).await {
                Ok(value) => value.to_string(),
                Err(error) => error_json_string(error),
            }
        })
    })
}

/// Asynchronous compatibility entry for the existing Aphrody command surface.
/// Arguments omit the program name. Captures share the synchronous ABI's lock;
/// typed Web workflows above avoid capture and support independent execution.
///
/// # Safety
/// `args_json` must be null or a readable, NUL-terminated UTF-8 string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_command_submit(args_json: *const c_char, timeout_ms: u32) -> u64 {
    guard(0, || {
        // SAFETY: required by this function's input pointer contract.
        let Some(raw) = (unsafe { borrow_str(args_json) }) else {
            return jobs::resolved(error_json_string("command arguments must be UTF-8 JSON"));
        };
        let args = match serde_json::from_str::<Vec<String>>(raw) {
            Ok(args)
                if raw.len() <= 1_048_576
                    && !args.is_empty()
                    && args.len() <= 256
                    && args.iter().all(|arg| !arg.contains('\0')) =>
            {
                args
            }
            _ => {
                return jobs::resolved(error_json_string(
                    "expected 1..256 command arguments without NUL",
                ));
            }
        };
        jobs::submit_captured(timeout_ms, move || async move {
            let argv = std::iter::once("aphrody".to_owned()).chain(args);
            aphrody_command::run_async(argv).await.to_string()
        })
    })
}

/// Submit a tool call through the configured native HTTP MCP client.
/// No process-wide stdio capture is needed, so calls can run concurrently.
///
/// # Safety
/// `request_json` must be null or a readable, NUL-terminated UTF-8 string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_mcp_tool_submit(
    request_json: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        // SAFETY: required by this function's input pointer contract.
        let Some(raw) = (unsafe { borrow_str(request_json) }) else {
            return jobs::resolved(error_json_string("MCP request must be UTF-8 JSON"));
        };
        if raw.len() > 1_048_576 {
            return jobs::resolved(error_json_string("MCP request exceeds one MiB"));
        }
        let request = match serde_json::from_str::<McpInvocation>(raw) {
            Ok(request)
                if raw.len() <= 1_048_576
                    && request.arguments.is_object()
                    && !request.server.is_empty()
                    && !request.tool.is_empty() =>
            {
                request
            }
            _ => {
                return jobs::resolved(error_json_string(
                    "expected an MCP request with object arguments",
                ));
            }
        };
        jobs::submit(timeout_ms, async move {
            match aphrody_command::run_mcp_tool_http(
                request.config,
                request.server,
                request.tool,
                request.arguments,
            )
            .await
            {
                Ok(value) => value.to_string(),
                Err(error) => error_json_string(error),
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::{CStr, CString},
        time::Duration,
    };

    use super::*;

    fn take(id: u64) -> serde_json::Value {
        for _ in 0..500 {
            let pointer = super::super::aphrody_web_job_take(id);
            if !pointer.is_null() {
                // SAFETY: take returned one owned string, read and freed here
                // exactly once with its allocator from this same library.
                let value = unsafe { CStr::from_ptr(pointer) }
                    .to_string_lossy()
                    .into_owned();
                unsafe { super::super::aphrody_web_free_string(pointer) };
                return serde_json::from_str(&value).unwrap();
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        panic!("native workflow did not resolve");
    }

    #[test]
    fn rejects_invalid_input_before_any_workflow_runs() {
        assert_eq!(aphrody_web_pipeline_abi_version(), 1);
        for input in [None, Some("{}"), Some("[]"), Some("[42]")] {
            let input = input.map(|value| CString::new(value).unwrap());
            // SAFETY: each input is null or a live CString for this call.
            let id = unsafe {
                aphrody_web_pipeline_submit(
                    input
                        .as_ref()
                        .map_or(std::ptr::null(), |value| value.as_ptr()),
                    1000,
                )
            };
            assert!(take(id).get("error").is_some());
            assert_eq!(super::super::aphrody_web_job_status(id), -1);
        }
    }

    #[test]
    fn workflow_result_is_returned_without_capturing_process_stdio() {
        let input = CString::new(r#"["dragon-ball","sources"]"#).unwrap();
        // SAFETY: input remains live during submission and is copied by serde.
        let id = unsafe { aphrody_web_pipeline_submit(input.as_ptr(), 1000) };
        drop(input);
        let result = take(id);
        assert!(result["plan"]["targets"].as_array().unwrap().len() >= 20);
        assert!(result.get("registry").is_some());
        assert!(result.get("stdout").is_none());
        assert_eq!(super::super::aphrody_web_job_status(id), -1);
    }

    #[test]
    fn rejects_unrelated_command_surfaces() {
        let input = CString::new(r#"["status"]"#).unwrap();
        // SAFETY: input is a live UTF-8 CString for submission.
        let id = unsafe { aphrody_web_pipeline_submit(input.as_ptr(), 1000) };
        assert!(take(id).get("error").is_some());
    }

    #[test]
    fn direct_mcp_rejects_stdio_before_starting_a_process() {
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("config.toml");
        std::fs::write(
            &config,
            "[mcp_servers.aphrody]\ncommand='must-not-be-started'\n",
        )
        .unwrap();
        let request = CString::new(
            serde_json::json!({
                "config": config, "server": "aphrody", "tool": "aphrody_job_status", "arguments": {}
            })
            .to_string(),
        )
        .unwrap();
        // SAFETY: request is live for submission and copied by deserialization.
        let result = take(unsafe { aphrody_mcp_tool_submit(request.as_ptr(), 1000) });
        assert!(
            result["error"]
                .as_str()
                .unwrap()
                .contains("require a configured HTTP transport")
        );
    }

    #[test]
    fn command_adapter_preserves_usage_diagnostics_and_reuses_runtime() {
        for args in [
            r#"["--version"]"#,
            r#"["--definitely-invalid-native-option"]"#,
        ] {
            let input = CString::new(args).unwrap();
            // SAFETY: input is a live CString and copied before return.
            let id = unsafe { aphrody_command_submit(input.as_ptr(), 2000) };
            drop(input);
            let result = take(id);
            if args.contains("--version") {
                assert_eq!(result["code"], 0);
                assert!(result["stdout"].as_str().unwrap().contains("aphrody"));
            } else {
                assert_eq!(result["code"], 2);
                assert!(!result["stderr"].as_str().unwrap().is_empty());
            }
        }
    }
}
