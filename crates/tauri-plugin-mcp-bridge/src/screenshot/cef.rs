//! Viewport capture through the Chrome DevTools Protocol of the CEF runtime.
//!
//! `Page.captureScreenshot` renders the visible viewport from the compositor surface, so it works
//! for hidden-behind and off-screen windows and needs no platform webview API (no WebKitGTK,
//! WKWebView or WebView2). The one desktop runtime is `tauri-runtime-cef`.

use std::{
    any::Any,
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
    time::Duration,
};

use base64::Engine as _;
use tauri::{Runtime, WebviewWindow};
use tauri_runtime::dynamic::DynWebviewDispatcher;
use tauri_runtime_cef::{CefWebviewDispatcher, DevToolsProtocol, allocate_devtools_message_id};
use tokio::sync::oneshot;

use super::{Screenshot, ScreenshotError};

/// How long one capture may take before it is reported as a timeout.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);

type Answer = Result<Vec<u8>, String>;

/// Capture requests waiting for their `MethodResult`, by DevTools message id.
fn pending() -> &'static Mutex<HashMap<i32, oneshot::Sender<Answer>>> {
    static PENDING: OnceLock<Mutex<HashMap<i32, oneshot::Sender<Answer>>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

/// Labels whose webview already has the result observer. The runtime keeps every observer for the
/// life of the webview, so exactly one is registered per webview, not one per capture.
fn observed() -> &'static Mutex<HashSet<String>> {
    static OBSERVED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    OBSERVED.get_or_init(Mutex::default)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The CEF dispatcher of a webview window, whether the app runs the runtime directly or behind
/// `tauri::Builder::default()`'s type-erased runtime. `None` for any other runtime.
fn cef_dispatcher<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Option<CefWebviewDispatcher<tauri::EventLoopMessage>> {
    let dispatcher: &dyn Any = window.as_ref().dispatcher();
    if let Some(dynamic) =
        dispatcher.downcast_ref::<DynWebviewDispatcher<tauri::EventLoopMessage>>()
    {
        return dynamic
            .downcast_ref::<CefWebviewDispatcher<tauri::EventLoopMessage>>()
            .cloned();
    }
    dispatcher
        .downcast_ref::<CefWebviewDispatcher<tauri::EventLoopMessage>>()
        .cloned()
}

/// Decodes the `data` field of a `Page.captureScreenshot` result.
fn png_from_result(result: &[u8]) -> Result<Vec<u8>, ScreenshotError> {
    let value: serde_json::Value = serde_json::from_slice(result)
        .map_err(|e| ScreenshotError::CaptureFailed(format!("Invalid DevTools result: {e}")))?;
    let data = value
        .get("data")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            ScreenshotError::CaptureFailed("DevTools result has no screenshot data".into())
        })?;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| ScreenshotError::EncodeFailed(format!("Invalid screenshot encoding: {e}")))
}

/// Captures the visible viewport as PNG bytes.
pub async fn capture_viewport<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<Screenshot, ScreenshotError> {
    let dispatcher = cef_dispatcher(window).ok_or(ScreenshotError::PlatformUnsupported)?;
    let label = window.label().to_owned();
    let message_id = allocate_devtools_message_id()
        .map_err(|e| ScreenshotError::CaptureFailed(e.to_string()))?;
    let (answer_tx, answer_rx) = oneshot::channel();
    lock(pending()).insert(message_id, answer_tx);

    let sent = tauri::async_runtime::spawn_blocking({
        let label = label.clone();
        move || -> Result<(), String> {
            if lock(observed()).insert(label.clone()) {
                let registered = dispatcher.on_dev_tools_protocol(|protocol| {
                    if let DevToolsProtocol::MethodResult {
                        message_id,
                        success,
                        result,
                    } = protocol
                    {
                        if let Some(waiting) = lock(pending()).remove(&message_id) {
                            let _ = waiting.send(if success {
                                Ok(result)
                            } else {
                                Err(String::from_utf8_lossy(&result).into_owned())
                            });
                        }
                    }
                });
                if let Err(error) = registered {
                    lock(observed()).remove(&label);
                    return Err(format!("DevTools observer: {error}"));
                }
            }
            let request = serde_json::json!({
                "id": message_id,
                "method": "Page.captureScreenshot",
                "params": { "format": "png", "fromSurface": true },
            });
            dispatcher
                .send_dev_tools_message(request.to_string().as_bytes())
                .map_err(|error| format!("DevTools request: {error}"))
        }
    })
    .await
    .map_err(|e| ScreenshotError::CaptureFailed(format!("Capture task failed: {e}")))?;

    if let Err(error) = sent {
        lock(pending()).remove(&message_id);
        return Err(ScreenshotError::CaptureFailed(error));
    }

    match tokio::time::timeout(CAPTURE_TIMEOUT, answer_rx).await {
        Ok(Ok(Ok(result))) => Ok(Screenshot {
            data: png_from_result(&result)?,
        }),
        Ok(Ok(Err(error))) => Err(ScreenshotError::CaptureFailed(format!(
            "Page.captureScreenshot failed: {error}"
        ))),
        Ok(Err(_)) => Err(ScreenshotError::CaptureFailed(
            "DevTools observer dropped".into(),
        )),
        Err(_) => {
            lock(pending()).remove(&message_id);
            // The webview may have been recreated under the same label: observe it again next time.
            lock(observed()).remove(&label);
            Err(ScreenshotError::Timeout)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_screenshot_data_field_is_decoded() {
        let encoded = base64::engine::general_purpose::STANDARD.encode([0x89, b'P', b'N', b'G']);
        let result = format!(r#"{{"data":"{encoded}"}}"#);
        assert_eq!(
            png_from_result(result.as_bytes()).unwrap(),
            [0x89, b'P', b'N', b'G']
        );
    }

    #[test]
    fn a_result_without_data_or_with_bad_base64_is_refused() {
        assert!(png_from_result(b"{}").is_err());
        assert!(png_from_result(b"not json").is_err());
        assert!(png_from_result(br#"{"data":"%%%"}"#).is_err());
    }
}
