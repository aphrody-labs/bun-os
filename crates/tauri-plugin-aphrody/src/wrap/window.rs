// SPDX-License-Identifier: Apache-2.0
//! The main window: one webview on the start URL, the navigation policy on its hooks, downloads
//! to the user's download folder, popups that keep their opener.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::wrap::config::WrapConfig;
use crate::wrap::policy::{Decision, Policy};

/// Schemes handed to the operating system. Anything else (`ms-msdt:`, `search-ms:`, other registered
/// handlers) is refused: a remote page must not be able to launch arbitrary protocol handlers.
const OPENABLE: [&str; 5] = ["http", "https", "mailto", "tel", "sms"];

/// Opens `url` in the system browser or mail/phone handler when its scheme is on the list.
pub fn open_external(url: &Url) {
    if OPENABLE.contains(&url.scheme()) {
        if let Err(error) = open::that_detached(url.as_str()) {
            eprintln!("aphrody-tauri-wrap: cannot open {url}: {error}");
        }
    } else {
        eprintln!(
            "aphrody-tauri-wrap: blocked a link with the {} scheme",
            url.scheme()
        );
    }
}

/// Top-level navigation: stay, leave for the system browser, or stop.
fn allow_navigation(policy: &Policy, url: &Url) -> bool {
    match policy.decide(url) {
        Decision::Allow => true,
        Decision::External => {
            open_external(url);
            false
        }
        Decision::Deny => false,
    }
}

/// `file.pdf` becomes `file (1).pdf` when `file.pdf` already exists.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("download");
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!(".{extension}"))
        .unwrap_or_default();
    (1..10_000)
        .map(|index| dir.join(format!("{stem} ({index}){extension}")))
        .find(|path| !path.exists())
        .unwrap_or(candidate)
}

/// File name of a download: the suggested one, else the last path segment of the URL.
fn download_name(suggested: &Path, url: &Url) -> String {
    suggested
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .or_else(|| {
            url.path_segments()
                .and_then(|mut segments| segments.next_back())
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "download".to_string())
}

/// Builds the main window on `start`.
///
/// # Errors
///
/// Fails when the webview cannot be created.
pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    config: &WrapConfig,
    start: Url,
    policy: Arc<Policy>,
) -> tauri::Result<WebviewWindow<R>> {
    let window = &config.window;
    let navigation_policy = Arc::clone(&policy);
    let popup_policy = Arc::clone(&policy);
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start))
        .title(window.title.as_deref().unwrap_or(&config.name))
        .inner_size(window.width, window.height)
        .zoom_hotkeys_enabled(window.zoom_hotkeys)
        .on_navigation(move |url| allow_navigation(&navigation_policy, url))
        // Popups of an allowed origin (OAuth, payment) keep their opener; the others leave for the system browser.
        .on_new_window(move |url, _features| match popup_policy.decide(&url) {
            Decision::Allow => NewWindowResponse::Allow,
            Decision::External => {
                open_external(&url);
                NewWindowResponse::Deny
            }
            Decision::Deny => NewWindowResponse::Deny,
        })
        .on_download(|webview, event| {
            if let DownloadEvent::Requested { url, destination } = event
                && let Ok(dir) = webview.app_handle().path().download_dir()
            {
                *destination = unique_path(&dir, &download_name(destination, &url));
            }
            true
        });
    if let (Some(width), Some(height)) = (window.min_width, window.min_height) {
        builder = builder.min_inner_size(width, height);
    }
    if let Some(agent) = config.user_agent.as_deref() {
        builder = builder.user_agent(agent);
    }
    if !window.drag_drop {
        // Native drag and drop would swallow HTML5 drag and drop (file drop zones, boards).
        builder = builder.disable_drag_drop_handler();
    }
    if window.sync_title {
        builder = builder.on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        });
    }
    builder.build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloads_never_overwrite() {
        let dir = std::env::temp_dir().join(format!("aphrody-wrap-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_path(&dir, "report.pdf"), dir.join("report.pdf"));
        std::fs::write(dir.join("report.pdf"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "report.pdf"), dir.join("report (1).pdf"));
        std::fs::write(dir.join("report (1).pdf"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "report.pdf"), dir.join("report (2).pdf"));
        std::fs::write(dir.join("noext"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "noext"), dir.join("noext (1)"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_a_download_from_the_suggestion_or_the_url() {
        let url = Url::parse("https://example.com/files/report.pdf?x=1").unwrap();
        assert_eq!(
            download_name(Path::new("/tmp/suggested.bin"), &url),
            "suggested.bin"
        );
        assert_eq!(download_name(Path::new("/"), &url), "report.pdf");
        assert_eq!(
            download_name(Path::new("/"), &Url::parse("https://example.com/").unwrap()),
            "download"
        );
    }

    #[test]
    fn only_safe_schemes_reach_the_operating_system() {
        for scheme in ["http", "https", "mailto", "tel", "sms"] {
            assert!(OPENABLE.contains(&scheme));
        }
        for scheme in ["file", "ms-msdt", "search-ms", "javascript", "vscode"] {
            assert!(!OPENABLE.contains(&scheme));
        }
    }
}
