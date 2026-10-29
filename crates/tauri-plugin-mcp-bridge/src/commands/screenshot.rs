//! Native screenshot capture.

use serde_json::Value;
use tauri::{Runtime, WebviewWindow, command};

/// Screenshot command of the one desktop runtime (CEF).
///
/// This command takes a screenshot of the **current viewport** (visible area) of the webview
/// with the Chrome DevTools Protocol (`Page.captureScreenshot`, from the compositor surface).
///
/// **Note**: This captures only what's currently visible in the viewport.
/// The agent should scroll content into view before taking screenshots if needed.
///
/// # Arguments
///
/// * `window` - The window to capture
/// * `format` - Image format ("png" or "jpeg")
/// * `quality` - JPEG quality (0-100), only used for JPEG format
///
/// # Returns
///
/// * `Ok(Value)` - JSON object containing:
///   - `dataUrl`: Base64-encoded image data URL
///   - `imageWidth`: Image width in pixels
///   - `imageHeight`: Image height in pixels
///   - `cssWidth`: Webview viewport width in CSS pixels
///   - `cssHeight`: Webview viewport height in CSS pixels
/// * `Err(String)` - Error message if capture fails
#[command]
pub async fn capture_native_screenshot<R: Runtime>(
    window: WebviewWindow<R>,
    format: Option<String>,
    quality: Option<u8>,
    max_width: Option<u32>,
) -> Result<Value, String> {
    let format = format.unwrap_or_else(|| "png".to_string());
    let quality = quality.unwrap_or(90);

    // Use the screenshot module for viewport capture
    use crate::screenshot;

    match screenshot::capture_viewport_screenshot(&window, &format, quality, max_width).await {
        Ok(captured) => Ok(serde_json::json!({
            "dataUrl": captured.data_url,
            "imageWidth": captured.image_width,
            "imageHeight": captured.image_height,
            "cssWidth": captured.css_width,
            "cssHeight": captured.css_height,
        })),
        Err(e) => Err(e.to_string()),
    }
}
