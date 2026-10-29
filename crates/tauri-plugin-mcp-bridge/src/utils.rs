use tauri::{Runtime, WebviewWindow};

/// Prepares a window for a screenshot. The CEF runtime captures from the compositor surface, so a
/// covered or minimised window needs no foregrounding on any platform.
pub fn prepare_window_for_screenshot<R: Runtime>(_window: &WebviewWindow<R>) -> Result<(), String> {
    Ok(())
}
