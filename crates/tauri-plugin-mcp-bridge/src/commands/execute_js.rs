//! JavaScript execution in webview.
//!
//! Aphrody patch (Tauri 3): the macOS-only native path and the `__script_result` IPC round trip
//! are replaced by one portable mechanism that needs no IPC permission and no
//! `withGlobalTauri`: the script runs inside an async wrapper that stores its outcome in
//! `window.__APHRODY_DEBUG_RESULTS__`, and the host polls that slot with
//! `WebviewWindow::eval_with_callback` (implemented by the wry and CEF runtimes).

use super::script_executor::ScriptExecutor;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Runtime, State, WebviewWindow, command};
use tokio::sync::oneshot;
use uuid::Uuid;

/// Upper bound for one script, including awaited promises.
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(10);
/// Interval between result probes.
const POLL_INTERVAL: Duration = Duration::from_millis(40);

/// Executes JavaScript code in the webview context and returns
/// `{ "success": bool, "data" | "error": ... }`.
#[command]
pub async fn execute_js<R: Runtime>(
    window: WebviewWindow<R>,
    script: String,
    _state: State<'_, ScriptExecutor>,
) -> Result<Value, String> {
    eval_and_poll(&window, &script).await
}

/// Evaluates `js` and returns the callback value parsed as JSON.
async fn eval_json<R: Runtime>(window: &WebviewWindow<R>, js: String) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel::<String>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    window
        .eval_with_callback(js, move |value| {
            if let Some(tx) = tx
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
            {
                let _ = tx.send(value);
            }
        })
        .map_err(|e| format!("Failed to evaluate script: {e}"))?;
    let raw = tokio::time::timeout(SCRIPT_TIMEOUT, rx)
        .await
        .map_err(|_| "Script evaluation timed out".to_string())?
        .map_err(|_| "Script evaluation channel closed".to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("Webview returned invalid JSON: {e}"))
}

/// Builds the wrapper that runs `prepared_script` and stores the outcome under `exec_id`.
fn wrap_script(exec_id: &str, prepared_script: &str) -> String {
    format!(
        r#"(function() {{
            var __slot = (window.__APHRODY_DEBUG_RESULTS__ = window.__APHRODY_DEBUG_RESULTS__ || {{}});
            (async () => {{
                try {{
                    const __executeScript = async () => {{
                        {prepared_script}
                    }};
                    const __result = await __executeScript();
                    __slot['{exec_id}'] = {{ success: true, data: __result !== undefined ? __result : null }};
                }} catch (error) {{
                    __slot['{exec_id}'] = {{ success: false, error: (error && error.message) || String(error) }};
                }}
            }})();
        }})();"#
    )
}

/// Builds the probe that returns and clears the stored outcome ("" while still running).
fn probe_script(exec_id: &str) -> String {
    format!(
        r#"(function() {{
            var __slot = window.__APHRODY_DEBUG_RESULTS__;
            if (!__slot || !('{exec_id}' in __slot)) {{ return ""; }}
            var __value = __slot['{exec_id}'];
            delete __slot['{exec_id}'];
            try {{ return JSON.stringify(__value); }}
            catch (error) {{ return JSON.stringify({{ success: false, error: 'result is not JSON serializable' }}); }}
        }})()"#
    )
}

async fn eval_and_poll<R: Runtime>(
    window: &WebviewWindow<R>,
    script: &str,
) -> Result<Value, String> {
    let exec_id = Uuid::new_v4().simple().to_string();
    let wrapped = wrap_script(&exec_id, &prepare_script(script));
    if let Err(e) = window.eval(&wrapped) {
        return Ok(serde_json::json!({
            "success": false,
            "error": format!("Failed to execute script: {e}")
        }));
    }

    let probe = probe_script(&exec_id);
    let deadline = tokio::time::Instant::now() + SCRIPT_TIMEOUT;
    loop {
        // The callback value of a JS string is a JSON string literal; "" means "not ready".
        if let Value::String(text) = eval_json(window, probe.clone()).await? {
            if !text.is_empty() {
                return serde_json::from_str(&text)
                    .map_err(|e| format!("Script result is not valid JSON: {e}"));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(serde_json::json!({
                "success": false,
                "error": "Script execution timeout"
            }));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Prepare script by adding return statement if needed.
fn prepare_script(script: &str) -> String {
    let trimmed = script.trim();
    let needs_return = !trimmed.starts_with("return ");

    let has_real_semicolons = if let Some(without_trailing) = trimmed.strip_suffix(';') {
        without_trailing.contains(';')
    } else {
        trimmed.contains(';')
    };

    let is_multi_statement = has_real_semicolons
        || trimmed.starts_with("const ")
        || trimmed.starts_with("let ")
        || trimmed.starts_with("var ")
        || trimmed.starts_with("if ")
        || trimmed.starts_with("for ")
        || trimmed.starts_with("while ")
        || trimmed.starts_with("function ")
        || trimmed.starts_with("class ")
        || trimmed.starts_with("try ");

    let is_single_expression = trimmed.starts_with("await ")
        || trimmed.starts_with("(")
        || trimmed.starts_with("JSON.")
        || trimmed.starts_with("{")
        || trimmed.starts_with("[")
        || trimmed.ends_with(")()");

    let is_wrapped_expression = (trimmed.starts_with("(") && trimmed.ends_with(")"))
        || (trimmed.starts_with("(") && trimmed.ends_with(")()"))
        || (trimmed.starts_with("JSON.") && trimmed.ends_with(")"))
        || (trimmed.starts_with("await "));

    if needs_return && (is_single_expression || is_wrapped_expression || !is_multi_statement) {
        format!("return {trimmed}")
    } else {
        script.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::prepare_script;

    #[test]
    fn adds_return_for_simple_expression() {
        assert_eq!(prepare_script("document.title"), "return document.title");
    }

    #[test]
    fn keeps_multi_statement_script_unchanged() {
        let script = "const title = document.title; return title;";
        assert_eq!(prepare_script(script), script);
    }

    #[test]
    fn wrapper_and_probe_share_the_exec_id() {
        let wrapped = super::wrap_script("abc123", "return 1;");
        assert!(wrapped.contains("__slot['abc123']"));
        assert!(wrapped.contains("return 1;"));
        let probe = super::probe_script("abc123");
        assert!(probe.contains("'abc123' in __slot"));
        assert!(probe.contains("delete __slot['abc123']"));
    }
}
