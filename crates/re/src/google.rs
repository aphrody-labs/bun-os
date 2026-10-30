// SPDX-License-Identifier: Apache-2.0
//! Google binary analyser — identifies Electron / WebView2 / Chromium / Go /
//! Node / V8 artefacts and extracts OAuth client IDs, API endpoints, updater
//! URLs, and code-signing hints from raw binary bytes.
//!
//! All detection is performed on the raw byte slice via [`extract_strings`]
//! (from the parent crate) combined with byte-pattern scanning using
//! `memchr::memmem` for needle searches and `regex` for structured patterns.
//! No additional crates are introduced beyond those already in the workspace.
//!
//! # Example
//!
//! ```
//! use bun_re::google::{BinaryFamily, analyze_google};
//!
//! // Minimal buffer that looks like an Electron binary.
//! let mut buf = b"MZ".to_vec();
//! buf.extend_from_slice(&[0u8; 62]);
//! buf.extend_from_slice(b"electron\x00app.asar\x00chrome_100_percent.pak\x00");
//! let report = analyze_google(&buf);
//! assert_eq!(report.family, BinaryFamily::Electron);
//! ```

use memchr::memmem;
use regex::bytes::Regex;
use serde::Serialize;

use crate::extract_strings;

const WGA_MARKERS: &[&[u8]] = &[
    b"com.google.windows.app",
    b"wga.google.com",
    b"localized-text.wga.google.com",
    b"search/wga/proto",
];

/// Search for an ASCII marker in either narrow or UTF-16LE form.
fn contains_ascii_or_utf16le(bytes: &[u8], needle: &[u8]) -> bool {
    if memmem::find(bytes, needle).is_some() {
        return true;
    }

    let wide: Vec<u8> = needle.iter().flat_map(|byte| [*byte, 0]).collect();
    memmem::find(bytes, &wide).is_some()
}

/// Visit printable ASCII runs and ASCII-compatible UTF-16LE runs without
/// retaining the complete string corpus. UTF-16LE is checked at both byte
/// alignments because PE resources need not begin on an even file offset.
fn for_each_printable_string(bytes: &[u8], min_len: usize, mut visit: impl FnMut(&[u8])) {
    let mut start = None;
    for (index, byte) in bytes.iter().copied().enumerate() {
        if (0x20..=0x7e).contains(&byte) {
            start.get_or_insert(index);
        } else if let Some(run_start) = start.take()
            && index - run_start >= min_len
        {
            visit(&bytes[run_start..index]);
        }
    }
    if let Some(run_start) = start
        && bytes.len() - run_start >= min_len
    {
        visit(&bytes[run_start..]);
    }

    for alignment in 0..2 {
        let mut run = Vec::new();
        let mut index = alignment;
        while index + 1 < bytes.len() {
            let low = bytes[index];
            if bytes[index + 1] == 0 && (0x20..=0x7e).contains(&low) {
                run.push(low);
            } else {
                if run.len() >= min_len {
                    visit(&run);
                }
                run.clear();
            }
            index += 2;
        }
        if run.len() >= min_len {
            visit(&run);
        }
    }
}

struct TextFindings {
    oauth_client_ids: Vec<String>,
    google_endpoints: Vec<String>,
    updater_urls: Vec<String>,
    wga: Option<WgaReport>,
}

/// Extract all structured text indicators in one streaming pass so a bounded
/// display-string sample never truncates the report or multiplies PE scans.
fn extract_text_findings(
    bytes: &[u8],
    include_wga: bool,
    indicators: &mut Vec<String>,
) -> TextFindings {
    let oauth_re =
        Regex::new(r"\d+-[a-zA-Z0-9_]+\.apps\.googleusercontent\.com").expect("static regex");
    let endpoint_re = Regex::new(
        r#"(?:^|[^a-z0-9.-])((?:https?://)?(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)*(?:googleapis|google|gstatic|googleusercontent|googlevideo|googletagmanager)\.com(?:/[^\s"'<>]*)?)"#,
    )
    .expect("static regex");
    let run_re =
        Regex::new(r#"https?://[a-z0-9\-]+\.run\.app(?:/[^\s"'<>]*)?"#).expect("static regex");
    let wga_endpoint_re = Regex::new(
        r#"(?:https?://)?(?:[a-z0-9-]+\.)*wga\.google\.com(?::[0-9]{1,5})?(?:/[^\s"'<>]*)?"#,
    )
    .expect("static regex");
    let proto_re =
        include_wga.then(|| Regex::new(r"[a-zA-Z0-9_/.-]+\.proto").expect("static regex"));
    let flag_re = include_wga.then(|| Regex::new(r"--[a-z0-9_-]{3,40}").expect("static regex"));

    let mut oauth_ids = Vec::new();
    let mut seen_oauth = std::collections::HashSet::new();
    let mut endpoints = Vec::new();
    let mut seen_endpoints = std::collections::HashSet::new();
    let mut updater_urls = Vec::new();
    let mut seen_updater = std::collections::HashSet::new();
    let mut proto_descriptors = std::collections::BTreeSet::new();
    let mut flags = std::collections::BTreeSet::new();
    let mut wga_endpoints = std::collections::BTreeSet::new();

    for_each_printable_string(bytes, 4, |text| {
        for matched in oauth_re.find_iter(text) {
            let value = String::from_utf8_lossy(matched.as_bytes()).into_owned();
            if seen_oauth.insert(value.clone()) {
                oauth_ids.push(value);
            }
        }
        for capture in endpoint_re.captures_iter(text) {
            if let Some(matched) = capture.get(1) {
                let value = String::from_utf8_lossy(matched.as_bytes()).into_owned();
                if seen_endpoints.insert(value.clone()) {
                    endpoints.push(value);
                }
            }
        }
        for matched in run_re.find_iter(text) {
            let value = String::from_utf8_lossy(matched.as_bytes()).into_owned();
            if seen_endpoints.insert(value.clone()) {
                endpoints.push(value);
            }
        }

        let contains_ci = |needle: &[u8]| {
            text.windows(needle.len())
                .any(|window| window.eq_ignore_ascii_case(needle))
        };
        let is_updater = [
            b"auto-updater".as_slice(),
            b"autoupdate",
            b"update.googleapis",
            b"tools.google.com/service/update",
            b"/update2/",
            b"omaha",
        ]
        .iter()
        .any(|needle| contains_ci(needle))
            || (contains_ci(b".run.app")
                && (text
                    .get(..7)
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"http://"))
                    || text
                        .get(..8)
                        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"https://"))));
        if is_updater {
            let value = String::from_utf8_lossy(text).into_owned();
            if seen_updater.insert(value.clone()) {
                updater_urls.push(value);
            }
        }

        if include_wga {
            if let Some(re) = &proto_re {
                for matched in re.find_iter(text) {
                    if matched.as_bytes().contains(&b'/') {
                        proto_descriptors
                            .insert(String::from_utf8_lossy(matched.as_bytes()).into_owned());
                    }
                }
            }
            if let Some(re) = &flag_re {
                for matched in re.find_iter(text) {
                    flags.insert(String::from_utf8_lossy(matched.as_bytes()).into_owned());
                }
            }
            for matched in wga_endpoint_re.find_iter(text) {
                wga_endpoints.insert(String::from_utf8_lossy(matched.as_bytes()).into_owned());
            }
        }
    });

    for id in &oauth_ids {
        indicators.push(format!("OAuth client_id: {id}"));
    }
    for endpoint in &endpoints {
        let label = if endpoint.contains(".run.app") {
            "Cloud Run endpoint"
        } else {
            "Google endpoint"
        };
        indicators.push(format!("{label}: {endpoint}"));
    }
    for url in &updater_urls {
        indicators.push(format!("Updater URL: {url}"));
    }

    let wga = include_wga.then(|| {
        let aim_detected = contains_ascii_or_utf16le(bytes, b"searchbox/protos/aim")
            || contains_ascii_or_utf16le(bytes, b"aim-sys-color")
            || flags.iter().any(|flag| flag.starts_with("--aim-"));
        let lens_detected = contains_ascii_or_utf16le(bytes, b"search/wga/proto/lens")
            || contains_ascii_or_utf16le(bytes, b"lens_overlay")
            || contains_ascii_or_utf16le(bytes, b"lens.usercontent.google.com");

        indicators.push(format!("WGA Proto schemas: {}", proto_descriptors.len()));
        if aim_detected {
            indicators.push("WGA AIM (AI Mode) subsystem active".to_string());
        }
        if lens_detected {
            indicators.push("WGA Google Lens contextual subsystem active".to_string());
        }

        WgaReport {
            proto_descriptors: proto_descriptors.into_iter().collect(),
            flags: flags.into_iter().collect(),
            wga_endpoints: wga_endpoints.into_iter().collect(),
            aim_detected,
            lens_detected,
        }
    });

    TextFindings {
        oauth_client_ids: oauth_ids,
        google_endpoints: endpoints,
        updater_urls,
        wga,
    }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Broad classification of the Google binary under analysis.
///
/// Detection order (highest-priority first): `Wga` → `Electron` → `WebView2` →
/// `Chromium` → `GoBinary` → `NodeBundle` → `V8Snapshot` → `Generic`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BinaryFamily {
    /// Google desktop companion app for Windows (`com.google.windows.app` / WGA).
    /// Native launcher with embedded WebView2, Abseil flags, Protocol Buffers,
    /// TCMalloc, and Google Lens contextual inputs.
    Wga,
    /// Electron application (ships `app.asar` / `chrome_100_percent.pak` /
    /// the string `"electron"`).
    Electron,
    /// Microsoft Edge WebView2 host application — embeds the Evergreen
    /// WebView2 runtime (`msedgewebview2`, `WebView2Loader`,
    /// `CoreWebView2`, `EBWebView` user-data folder). Distinct from a raw
    /// Chromium browser: the app hosts web content via the Edge runtime
    /// rather than shipping its own Chromium. This is the family of the
    /// `google.exe` desktop launcher (user-data under
    /// `…\Google\latest\default\WebView2\EBWebView`).
    WebView2,
    /// Chromium / Chrome browser binary (`Chrome/`, `chrome.dll`, `Crashpad`).
    Chromium,
    /// Go-compiled binary (`.gopclntab` section / `go:buildid` / `Go build ID:`).
    GoBinary,
    /// Node.js bundled executable (`require(` / `node:internal`).
    NodeBundle,
    /// V8 snapshot blob (`v8_context_snapshot` / `snapshot_blob`).
    V8Snapshot,
    /// Could not match any of the above families.
    Generic,
}

/// Google Windows App (WGA / com.google.windows.app) specific metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WgaReport {
    /// Discovered proto descriptor schemas (.proto files embedded in the binary).
    pub proto_descriptors: Vec<String>,
    /// Discovered CLI/Abseil flags (--aim-*, etc.).
    pub flags: Vec<String>,
    /// Discovered WGA endpoints (e.g. wga.google.com).
    pub wga_endpoints: Vec<String>,
    /// True if AIM (AI Mode / Searchbox AI) components were detected.
    pub aim_detected: bool,
    /// True if Google Lens overlay components were detected.
    pub lens_detected: bool,
}

/// Parsed configuration from Google desktop app's `preferences.txtpb`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WgaPreferences {
    /// True if AI Mode is default.
    pub ai_mode_by_default: bool,
    /// True if AIM (AI Mode) is eligible.
    pub aim_eligible: bool,
    /// True if local filesystem search is enabled.
    pub search_local_files: bool,
    /// True if Google Drive search is enabled.
    pub search_drive_files: bool,
    /// True if window is pinned always on top.
    pub always_on_top: bool,
    /// UI Theme (e.g., "THEME_DARK").
    pub theme: String,
    /// Popup invocation key combination (e.g., "Alt+SPACE").
    pub popup_hotkey: Option<String>,
    /// Double-tap modifier key for popup (e.g. "LCONTROL_KEY").
    pub double_tap_key: Option<String>,
    /// Screenshot / Lens invocation hotkey (e.g., "Ctrl+KEY_L").
    pub screenshot_hotkey: Option<String>,
    /// User zoom factor.
    pub user_zoom_factor: f64,
    /// Enabled experiment IDs.
    pub experiments: Vec<u64>,
}

impl WgaPreferences {
    /// Parse `preferences.txtpb` content in protobuf text format.
    #[must_use]
    pub fn parse_txtpb(content: &str) -> Self {
        let mut ai_mode_by_default = false;
        let mut aim_eligible = false;
        let mut search_local_files = false;
        let mut search_drive_files = false;
        let mut always_on_top = false;
        let mut theme = String::new();
        let mut popup_key = String::new();
        let mut popup_alt = false;
        let mut popup_ctrl = false;
        let mut popup_shift = false;
        let mut popup_win = false;
        let mut in_popup = false;
        let mut in_screenshot = false;
        let mut screenshot_key = String::new();
        let mut screenshot_ctrl = false;
        let mut screenshot_alt = false;
        let mut screenshot_shift = false;
        let mut screenshot_win = false;
        let mut double_tap_key = None;
        let mut user_zoom_factor = 1.0;
        let mut experiments = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            if trimmed.starts_with("popup {") {
                in_popup = true;
                continue;
            }
            if trimmed.starts_with("screenshot_hotkey {") {
                in_screenshot = true;
                continue;
            }
            if trimmed == "}" {
                in_popup = false;
                in_screenshot = false;
                continue;
            }

            if in_popup {
                if let Some(rest) = trimmed.strip_prefix("key:") {
                    popup_key = rest.trim().to_string();
                } else if trimmed == "alt: true" {
                    popup_alt = true;
                } else if trimmed == "control: true" {
                    popup_ctrl = true;
                } else if trimmed == "shift: true" {
                    popup_shift = true;
                } else if trimmed == "win: true" {
                    popup_win = true;
                }
                continue;
            }

            if in_screenshot {
                if let Some(rest) = trimmed.strip_prefix("key:") {
                    screenshot_key = rest.trim().to_string();
                } else if trimmed == "alt: true" {
                    screenshot_alt = true;
                } else if trimmed == "control: true" {
                    screenshot_ctrl = true;
                } else if trimmed == "shift: true" {
                    screenshot_shift = true;
                } else if trimmed == "win: true" {
                    screenshot_win = true;
                }
                continue;
            }

            if let Some(rest) = trimmed.strip_prefix("ai_mode_by_default:") {
                ai_mode_by_default = rest.trim() == "true";
            } else if let Some(rest) = trimmed.strip_prefix("aim_eligible:") {
                aim_eligible = rest.trim() == "true";
            } else if let Some(rest) = trimmed.strip_prefix("search_local_files:") {
                search_local_files = rest.trim() == "true";
            } else if let Some(rest) = trimmed.strip_prefix("search_drive_files:") {
                search_drive_files = rest.trim() == "true";
            } else if let Some(rest) = trimmed.strip_prefix("always_on_top:") {
                always_on_top = rest.trim() == "true";
            } else if let Some(rest) = trimmed.strip_prefix("theme:") {
                theme = rest.trim().trim_matches('"').to_string();
            } else if let Some(rest) = trimmed.strip_prefix("double_tap_modifier_key_for_popup:") {
                double_tap_key = Some(rest.trim().trim_matches('"').to_string());
            } else if let Some(rest) = trimmed.strip_prefix("user_zoom_factor:") {
                if let Ok(v) = rest.trim().parse::<f64>() {
                    user_zoom_factor = v;
                }
            } else if let Some(rest) = trimmed.strip_prefix("experiments:")
                && let Ok(v) = rest.trim().parse::<u64>()
            {
                experiments.push(v);
            }
        }

        let popup_hotkey = if !popup_key.is_empty() {
            let mut parts = Vec::new();
            if popup_ctrl {
                parts.push("Ctrl");
            }
            if popup_alt {
                parts.push("Alt");
            }
            if popup_shift {
                parts.push("Shift");
            }
            if popup_win {
                parts.push("Win");
            }
            parts.push(&popup_key);
            Some(parts.join("+"))
        } else {
            None
        };

        let screenshot_hotkey = if !screenshot_key.is_empty() {
            let mut parts = Vec::new();
            if screenshot_ctrl {
                parts.push("Ctrl");
            }
            if screenshot_alt {
                parts.push("Alt");
            }
            if screenshot_shift {
                parts.push("Shift");
            }
            if screenshot_win {
                parts.push("Win");
            }
            parts.push(&screenshot_key);
            Some(parts.join("+"))
        } else {
            None
        };

        Self {
            ai_mode_by_default,
            aim_eligible,
            search_local_files,
            search_drive_files,
            always_on_top,
            theme,
            popup_hotkey,
            double_tap_key,
            screenshot_hotkey,
            user_zoom_factor,
            experiments,
        }
    }
}

/// Full analysis report for a Google binary.
///
/// Serialises to JSON — all `Vec` fields are always present (never `null`),
/// `Option` fields are `null` when not found.
#[derive(Debug, Clone, Serialize)]
pub struct GoogleReport {
    /// Detected binary family.
    pub family: BinaryFamily,
    /// Chromium version string (`"M.m.b.p"` form), if present.
    pub chromium_version: Option<String>,
    /// Google OAuth2 client IDs found in the binary
    /// (`\d+-[a-z0-9]+\.apps\.googleusercontent\.com`).
    pub oauth_client_ids: Vec<String>,
    /// Google API / CDN / service hosts found
    /// (`*.googleapis.com`, `*.google.com`, `*.gstatic.com`,
    ///  `*.googleusercontent.com`, `*.run.app`).
    pub google_endpoints: Vec<String>,
    /// URLs referencing an auto-updater service or Cloud Run.
    pub updater_urls: Vec<String>,
    /// Code-signing subject hint (`"Google LLC"` or `"Google Inc"`), if the
    /// certificate chain or any DER-embedded string is detected.
    pub code_sign_subject: Option<String>,
    /// Fully-qualified protobuf gRPC service names discovered in a Go binary
    /// (`exa.<package>_pb.<Name>Service`) plus Codeium proto package symbols
    /// (`codeium_common_go_proto`, `exa.<package>_pb`). Sorted + deduped.
    /// Always present (possibly empty).
    pub grpc_services: Vec<String>,
    /// gRPC RPC method names extracted from embedded service paths
    /// (`/exa.<package>_pb.<Name>Service/<Method>`) and from a conservative
    /// verb-noun allowlist of identifiers found in the string corpus. Sorted +
    /// deduped. Always present (possibly empty).
    pub grpc_methods: Vec<String>,
    /// Google Windows App (WGA) details, if detected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wga: Option<WgaReport>,
    /// Human-readable list of detection signals used to classify the binary.
    pub indicators: Vec<String>,
}

// ---------------------------------------------------------------------------
// Main public entry point
// ---------------------------------------------------------------------------

/// Default string-corpus extraction limit for [`analyze_google`].
///
/// At 8 192 entries the corpus is large enough for gRPC string heuristics in
/// typical binaries. OAuth IDs, endpoints and updater/WGA indicators are
/// streamed from the complete binary independently of this display-corpus cap.
pub const GOOGLE_STRINGS_LIMIT_DEFAULT: usize = 8_192;

/// Bounded string-corpus limit used by `aphrody ide re` for large Go language
/// server sidecars. Structured endpoint/OAuth extraction still scans the full
/// binary; this value bounds the supplemental string-based gRPC heuristics.
pub const GOOGLE_STRINGS_LIMIT_SIDECAR: usize = 512;

/// Analyse a raw binary blob for Google-specific artefacts.
///
/// Uses [`GOOGLE_STRINGS_LIMIT_DEFAULT`] for the string corpus extraction.
/// For large binaries (> 50 MB) prefer [`analyze_google_bounded`] with a
/// smaller limit to keep latency bounded.
///
/// Never panics on arbitrary input; all regex / memchr calls are applied to
/// controlled byte ranges only.
///
/// # Example
///
/// ```
/// use bun_re::google::{BinaryFamily, analyze_google};
///
/// // Buffer containing a Go build-id marker.
/// let buf = b"some bytes go:buildid more bytes";
/// let r = analyze_google(buf);
/// assert_eq!(r.family, BinaryFamily::GoBinary);
/// assert!(r.indicators.iter().any(|s| s.contains("go:buildid")));
/// ```
#[must_use]
pub fn analyze_google(bytes: &[u8]) -> GoogleReport {
    analyze_google_bounded(bytes, GOOGLE_STRINGS_LIMIT_DEFAULT)
}

/// Analyse a raw binary blob for Google-specific artefacts with an explicit
/// string-corpus extraction limit.
///
/// `strings_limit` caps the strings retained for gRPC symbol heuristics. Family,
/// Chromium version, code-sign hints, OAuth IDs, Google endpoints, updater URLs,
/// and WGA details are extracted across the complete input (ASCII and
/// ASCII-compatible UTF-16LE) independently of that display-corpus limit.
///
/// Use [`GOOGLE_STRINGS_LIMIT_SIDECAR`] for large Antigravity / Codeium sidecars
/// to bound the supplemental string-corpus work.
///
/// # Example
///
/// ```
/// use bun_re::google::{BinaryFamily, GOOGLE_STRINGS_LIMIT_SIDECAR, analyze_google_bounded};
///
/// let buf = b"runtime.goexit\x00go:buildid\x00";
/// let r = analyze_google_bounded(buf, GOOGLE_STRINGS_LIMIT_SIDECAR);
/// assert_eq!(r.family, BinaryFamily::GoBinary);
/// ```
#[must_use]
pub fn analyze_google_bounded(bytes: &[u8], strings_limit: usize) -> GoogleReport {
    let mut indicators: Vec<String> = Vec::new();

    // --- 1. Extract the string corpus (ASCII + UTF-16LE) once; everything
    //         below operates on this corpus + raw byte needles.
    //         Byte-level needle passes (family, Chromium version, code-sign,
    //         gRPC routing paths) always scan the full slice — not bounded.
    let strings = extract_strings(bytes, 4, strings_limit);

    // --- 2. Detect BinaryFamily via byte-level needle search -----------------
    let family = detect_family(bytes, &mut indicators);

    // --- 3. Chromium version — `Chrome/M.m.b.p` in the raw bytes ------------
    let chromium_version = extract_chromium_version(bytes, &mut indicators);

    // --- 4–6. Structured text indicators, independent of the sample limit ---
    let text = extract_text_findings(bytes, family == BinaryFamily::Wga, &mut indicators);

    // --- 7. Code-signing subject — best-effort byte scan --------------------
    let code_sign_subject = detect_code_sign_subject(bytes, &mut indicators);

    // --- 8. gRPC `exa.*` services + RPC methods (Go binaries: Codeium LS) ----
    let (grpc_services, grpc_methods) = extract_grpc_surface(bytes, &strings, &mut indicators);

    GoogleReport {
        family,
        chromium_version,
        oauth_client_ids: text.oauth_client_ids,
        google_endpoints: text.google_endpoints,
        updater_urls: text.updater_urls,
        code_sign_subject,
        grpc_services,
        grpc_methods,
        wga: text.wga,
        indicators,
    }
}

// ---------------------------------------------------------------------------
// Family detection
// ---------------------------------------------------------------------------

fn detect_family(bytes: &[u8], indicators: &mut Vec<String>) -> BinaryFamily {
    // Needles are ordered by specificity; first match wins.

    // WGA (Google Windows App): native desktop launcher embedding WebView2.
    // Checked before generic WebView2 / Electron because it carries distinct WGA markers.
    for needle in WGA_MARKERS {
        if contains_ascii_or_utf16le(bytes, needle) {
            indicators.push(format!(
                "WGA marker: {}",
                std::str::from_utf8(needle).unwrap_or("<binary>")
            ));
        }
    }
    if indicators.iter().any(|s| s.starts_with("WGA marker:")) {
        return BinaryFamily::Wga;
    }

    // Electron: ships `app.asar` packager artefact or the `electron` string,
    // and always embeds a Chromium PAK resource.
    let electron_needles: &[&[u8]] = &[
        b"app.asar",
        b"electron",
        b"chrome_100_percent.pak",
        b"ELECTRON_RUN_AS_NODE",
    ];
    for needle in electron_needles {
        if memmem::find(bytes, needle).is_some() {
            indicators.push(format!(
                "Electron marker: {}",
                std::str::from_utf8(needle).unwrap_or("<binary>")
            ));
        }
    }
    if indicators.iter().any(|s| s.starts_with("Electron")) {
        return BinaryFamily::Electron;
    }

    // WebView2: Microsoft Edge Evergreen runtime host. Checked before plain
    // Chromium because a WebView2 host also carries `Chrome/` user-agent and
    // `Crashpad` strings — these markers are more specific and win the tie.
    let webview2_needles: &[&[u8]] = &[
        b"msedgewebview2",
        b"WebView2Loader",
        b"CoreWebView2",
        b"EmbeddedBrowserWebView",
        b"EBWebView",
        b"Microsoft.Web.WebView2",
        b"WEBVIEW2_USER_DATA_FOLDER",
        b"WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
    ];
    for needle in webview2_needles {
        if memmem::find(bytes, needle).is_some() {
            indicators.push(format!(
                "WebView2 marker: {}",
                std::str::from_utf8(needle).unwrap_or("<binary>")
            ));
        }
    }
    if indicators.iter().any(|s| s.starts_with("WebView2")) {
        return BinaryFamily::WebView2;
    }

    // Chromium: core browser or headless shell.
    let chromium_needles: &[&[u8]] = &[
        b"Chrome/",
        b"chrome.dll",
        b"Crashpad",
        b"ChromeDriver",
        b"HeadlessChrome",
    ];
    for needle in chromium_needles {
        if memmem::find(bytes, needle).is_some() {
            indicators.push(format!(
                "Chromium marker: {}",
                std::str::from_utf8(needle).unwrap_or("<binary>")
            ));
        }
    }
    if indicators.iter().any(|s| s.starts_with("Chromium")) {
        return BinaryFamily::Chromium;
    }

    // Go binary: build-id tag injected by the Go linker, or the PC-line table
    // section name embedded in the binary.
    let go_needles: &[&[u8]] = &[
        b"go:buildid",
        b"Go build ID:",
        b".gopclntab",
        b"runtime.goexit",
    ];
    for needle in go_needles {
        if memmem::find(bytes, needle).is_some() {
            indicators.push(format!(
                "Go marker: {}",
                std::str::from_utf8(needle).unwrap_or("<binary>")
            ));
        }
    }
    if indicators.iter().any(|s| s.starts_with("Go")) {
        return BinaryFamily::GoBinary;
    }

    // Node.js bundled binary.
    let node_needles: &[&[u8]] = &[b"node:internal", b"require(", b"NODE_PATH", b"node_modules"];
    for needle in node_needles {
        if memmem::find(bytes, needle).is_some() {
            indicators.push(format!(
                "Node marker: {}",
                std::str::from_utf8(needle).unwrap_or("<binary>")
            ));
        }
    }
    if indicators.iter().any(|s| s.starts_with("Node")) {
        return BinaryFamily::NodeBundle;
    }

    // V8 snapshot blob.
    let v8_needles: &[&[u8]] = &[b"v8_context_snapshot", b"snapshot_blob", b"V8_SNAPSHOT"];
    for needle in v8_needles {
        if memmem::find(bytes, needle).is_some() {
            indicators.push(format!(
                "V8Snapshot marker: {}",
                std::str::from_utf8(needle).unwrap_or("<binary>")
            ));
        }
    }
    if indicators.iter().any(|s| s.starts_with("V8Snapshot")) {
        return BinaryFamily::V8Snapshot;
    }

    BinaryFamily::Generic
}

// ---------------------------------------------------------------------------
// Chromium version
// ---------------------------------------------------------------------------

fn extract_chromium_version(bytes: &[u8], indicators: &mut Vec<String>) -> Option<String> {
    // Pattern: `Chrome/M.m.b.p` (user-agent style).
    // We run the regex directly on raw bytes for efficiency.
    let re = Regex::new(r"Chrome/(\d+\.\d+\.\d+\.\d+)").expect("static regex");
    if let Some(cap) = re.captures(bytes)
        && let Some(ver_bytes) = cap.get(1)
        && let Ok(ver) = std::str::from_utf8(ver_bytes.as_bytes())
    {
        let ver = ver.to_owned();
        indicators.push(format!("Chromium version: {ver}"));
        return Some(ver);
    }
    None
}

// ---------------------------------------------------------------------------
// Code-signing subject
// ---------------------------------------------------------------------------

fn detect_code_sign_subject(bytes: &[u8], indicators: &mut Vec<String>) -> Option<String> {
    // Best-effort: scan for "Google LLC" or "Google Inc" embedded as ASCII
    // (common in Authenticode certificates, Go version strings, etc.).
    // Full Authenticode parsing (PKCS#7 DER) is left for a future phase.
    let subjects: &[&[u8]] = &[b"Google LLC", b"Google Inc", b"Google Inc."];
    for needle in subjects {
        if memmem::find(bytes, needle).is_some() {
            let subject = std::str::from_utf8(needle)
                .unwrap_or("Google")
                .trim_end_matches('.')
                .to_owned();
            indicators.push(format!("Code-sign subject: {subject}"));
            return Some(subject);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// gRPC `exa.*` services + RPC methods
// ---------------------------------------------------------------------------

/// Extract protobuf gRPC service descriptors and RPC method names from a Go
/// binary such as the Codeium `language_server.exe`.
///
/// Two complementary passes are run:
///
/// 1. **Raw-byte regex** over the whole blob — Go gRPC binaries embed the fully-qualified routing
///    path verbatim (`/exa.<package>_pb.<Name>Service/<Method>`), the package symbol
///    (`exa.<package>_pb`), and the Codeium proto package marker (`codeium_common_go_proto`).
///    Running on raw bytes catches paths even when they straddle the `extract_strings`
///    minimum-length window.
/// 2. **String-corpus allowlist** — conservatively promotes verb-noun CamelCase identifiers
///    (`Get*`, `Fetch*`, `Start*`, `Record*`, `Accept*`, `Auth*`) that appear in the corpus to
///    method candidates. This is gated behind the presence of at least one `exa.*` service so an
///    arbitrary binary full of `GetFoo` symbols does not produce noise.
///
/// Returns `(services, methods)`, both sorted and deduplicated.
fn extract_grpc_surface(
    bytes: &[u8],
    strings: &[String],
    indicators: &mut Vec<String>,
) -> (Vec<String>, Vec<String>) {
    use std::collections::BTreeSet;

    // Fully-qualified service: `exa.<package>_pb.<Name>Service`.
    let service_re =
        Regex::new(r"\bexa\.[a-z0-9_]+_pb\.[A-Za-z][A-Za-z0-9]*Service\b").expect("static regex");
    // Bare proto package symbol: `exa.<package>_pb` (no trailing `.Service`).
    let package_re = Regex::new(r"\bexa\.[a-z0-9_]+_pb\b").expect("static regex");
    // gRPC routing path: `/exa.<package>_pb.<Name>Service/<Method>`.
    let path_re =
        Regex::new(r"/(exa\.[a-z0-9_]+_pb\.[A-Za-z][A-Za-z0-9]*Service)/([A-Za-z][A-Za-z0-9]*)")
            .expect("static regex");
    // Codeium proto package marker.
    let codeium_marker = b"codeium_common_go_proto";

    let mut services: BTreeSet<String> = BTreeSet::new();
    let mut methods: BTreeSet<String> = BTreeSet::new();

    // --- Pass 1a: routing paths (most authoritative) on raw bytes -----------
    for cap in path_re.captures_iter(bytes) {
        if let (Some(svc), Some(meth)) = (cap.get(1), cap.get(2))
            && let (Ok(svc), Ok(meth)) = (
                std::str::from_utf8(svc.as_bytes()),
                std::str::from_utf8(meth.as_bytes()),
            )
        {
            services.insert(svc.to_owned());
            methods.insert(meth.to_owned());
        }
    }

    // --- Pass 1b: fully-qualified service names on raw bytes ----------------
    for m in service_re.find_iter(bytes) {
        if let Ok(svc) = std::str::from_utf8(m.as_bytes()) {
            services.insert(svc.to_owned());
        }
    }

    // --- Pass 1c: bare `exa.*_pb` package symbols on raw bytes --------------
    for m in package_re.find_iter(bytes) {
        if let Ok(pkg) = std::str::from_utf8(m.as_bytes()) {
            // Skip if this match is actually the prefix of a full service name
            // already recorded — keep only standalone package symbols.
            let pkg = pkg.to_owned();
            if !services
                .iter()
                .any(|s| s.starts_with(&pkg) && s.len() > pkg.len())
            {
                services.insert(pkg);
            }
        }
    }

    // --- Pass 1d: Codeium proto package marker ------------------------------
    if memmem::find(bytes, codeium_marker).is_some() {
        services.insert("codeium_common_go_proto".to_owned());
        indicators.push("gRPC proto package: codeium_common_go_proto".to_owned());
    }

    // --- Pass 2: conservative verb-noun allowlist over the string corpus ----
    // Only mine the corpus for extra methods once we know this binary actually
    // carries an `exa.*` gRPC surface, to keep false positives near zero.
    let has_exa_service = services.iter().any(|s| s.contains("Service"));
    if has_exa_service {
        // `<Verb><Noun>` with at least one capitalised noun segment after the
        // verb (so bare verbs like `Get` alone are rejected).
        let verb_re = Regex::new(r"\b(?:Get|Fetch|Start|Record|Accept|Auth)[A-Z][A-Za-z0-9]+\b")
            .expect("static regex");
        for s in strings {
            for m in verb_re.find_iter(s.as_bytes()) {
                if let Ok(name) = std::str::from_utf8(m.as_bytes()) {
                    methods.insert(name.to_owned());
                }
            }
        }
    }

    let services: Vec<String> = services.into_iter().collect();
    let methods: Vec<String> = methods.into_iter().collect();

    for svc in &services {
        indicators.push(format!("gRPC service: {svc}"));
    }
    for meth in &methods {
        indicators.push(format!("gRPC method: {meth}"));
    }

    (services, methods)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Helpers -----------------------------------------------------------------

    fn make_electron_buf() -> Vec<u8> {
        let mut buf = b"FAKE_HEADER_BYTES".to_vec();
        buf.extend_from_slice(b"app.asar\x00electron\x00chrome_100_percent.pak\x00");
        buf.extend_from_slice(b"some_padding_to_make_it_longer\x00");
        buf
    }

    fn make_go_buf() -> Vec<u8> {
        let mut buf = b"FAKE_HEADER_BYTES_GO".to_vec();
        buf.extend_from_slice(b"go:buildid\x00runtime.goexit\x00");
        buf
    }

    // Family tests ------------------------------------------------------------

    #[test]
    fn google_family_electron_detected() {
        let buf = make_electron_buf();
        let r = analyze_google(&buf);
        assert_eq!(
            r.family,
            BinaryFamily::Electron,
            "should detect Electron, got {:?}",
            r.family
        );
        assert!(
            r.indicators.iter().any(|s| s.contains("app.asar")),
            "should record app.asar indicator"
        );
    }

    #[test]
    fn google_family_go_binary_detected() {
        let buf = make_go_buf();
        let r = analyze_google(&buf);
        assert_eq!(
            r.family,
            BinaryFamily::GoBinary,
            "should detect GoBinary, got {:?}",
            r.family
        );
        assert!(r.indicators.iter().any(|s| s.contains("go:buildid")));
    }

    #[test]
    fn google_family_chromium_detected() {
        let buf = b"Chrome/125.0.6422.141 HeadlessChrome\x00Crashpad\x00".to_vec();
        let r = analyze_google(&buf);
        assert_eq!(r.family, BinaryFamily::Chromium);
        assert!(r.chromium_version.is_some());
        assert_eq!(r.chromium_version.as_deref(), Some("125.0.6422.141"));
    }

    #[test]
    fn google_family_webview2_detected() {
        // A WebView2 host carries both Chromium UA markers AND WebView2-specific
        // strings; the more-specific WebView2 family must win.
        let buf =
            b"Chrome/137.0.7151.69\x00msedgewebview2.exe\x00WebView2Loader.dll\x00EBWebView\x00Crashpad\x00"
                .to_vec();
        let r = analyze_google(&buf);
        assert_eq!(
            r.family,
            BinaryFamily::WebView2,
            "WebView2 must win over Chromium, got {:?}",
            r.family
        );
        assert!(r.indicators.iter().any(|s| s.contains("msedgewebview2")));
        // The Chromium version is still extracted independently of family.
        assert_eq!(r.chromium_version.as_deref(), Some("137.0.7151.69"));
    }

    #[test]
    fn google_family_webview2_serializes_snake_case() {
        let buf = b"CoreWebView2\x00Microsoft.Web.WebView2\x00".to_vec();
        let r = analyze_google(&buf);
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["family"], "web_view2");
    }

    #[test]
    fn google_family_v8_snapshot_detected() {
        let buf = b"v8_context_snapshot\x00snapshot_blob\x00".to_vec();
        let r = analyze_google(&buf);
        assert_eq!(r.family, BinaryFamily::V8Snapshot);
    }

    #[test]
    fn google_family_generic_on_empty() {
        let r = analyze_google(b"");
        assert_eq!(r.family, BinaryFamily::Generic);
        assert!(r.oauth_client_ids.is_empty());
        assert!(r.google_endpoints.is_empty());
        assert!(r.chromium_version.is_none());
        assert!(r.code_sign_subject.is_none());
    }

    // OAuth client ID tests ---------------------------------------------------

    #[test]
    fn google_oauth_id_extracted() {
        // Synthetic buffer containing a real-shaped OAuth client ID.
        let buf = b"config: 123456789012-abcdef0123456789abcdef0123456789.apps.googleusercontent.com extra\x00".to_vec();
        let r = analyze_google(&buf);
        assert_eq!(
            r.oauth_client_ids.len(),
            1,
            "expected 1 client_id, got {:?}",
            r.oauth_client_ids
        );
        assert!(r.oauth_client_ids[0].ends_with(".apps.googleusercontent.com"));
    }

    #[test]
    fn google_oauth_multiple_ids_deduplicated() {
        // Same ID twice — must appear once.
        let id = b"987654321000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps.googleusercontent.com";
        let mut buf = id.to_vec();
        buf.push(b' ');
        buf.extend_from_slice(id);
        let r = analyze_google(&buf);
        assert_eq!(
            r.oauth_client_ids.len(),
            1,
            "duplicate client_id must be deduplicated"
        );
    }

    // Google endpoint tests ---------------------------------------------------

    #[test]
    fn google_endpoint_googleapis_extracted() {
        let buf = b"GET https://oauth2.googleapis.com/token HTTP/1.1\x00".to_vec();
        let r = analyze_google(&buf);
        assert!(
            r.google_endpoints
                .iter()
                .any(|e| e.contains("googleapis.com")),
            "should extract googleapis.com endpoint, got {:?}",
            r.google_endpoints
        );
    }

    #[test]
    fn google_endpoint_run_app_extracted() {
        let buf = b"endpoint=https://my-service-abc123.run.app/api/v1\x00".to_vec();
        let r = analyze_google(&buf);
        assert!(
            r.google_endpoints.iter().any(|e| e.contains(".run.app")),
            "should extract .run.app endpoint, got {:?}",
            r.google_endpoints
        );
    }

    #[test]
    fn google_endpoints_are_found_after_the_bounded_string_sample() {
        let mut buf = b"first printable run\0second printable run\0".to_vec();
        buf.extend_from_slice(b"https://accounts.google.com/o/oauth2/token\0");
        buf.extend_from_slice(b"https://update.googleapis.com/service/update2\0");

        let report = analyze_google_bounded(&buf, 1);

        assert!(
            report
                .google_endpoints
                .iter()
                .any(|endpoint| { endpoint == "https://accounts.google.com/o/oauth2/token" })
        );
        assert!(
            report
                .updater_urls
                .iter()
                .any(|url| { url == "https://update.googleapis.com/service/update2" })
        );
    }

    #[test]
    fn google_endpoints_are_found_in_odd_aligned_utf16le() {
        let text = "https://accounts.google.com/o/oauth2/token";
        let mut buf = b"x".to_vec();
        for byte in text.bytes() {
            buf.extend_from_slice(&[byte, 0]);
        }

        let report = analyze_google_bounded(&buf, 1);

        assert!(
            report
                .google_endpoints
                .iter()
                .any(|endpoint| { endpoint == "https://accounts.google.com/o/oauth2/token" })
        );
    }

    // Code-signing tests ------------------------------------------------------

    #[test]
    fn google_code_sign_llc_detected() {
        let buf = b"\x30\x82Google LLC\x00issuer\x00".to_vec();
        let r = analyze_google(&buf);
        assert_eq!(r.code_sign_subject.as_deref(), Some("Google LLC"));
    }

    #[test]
    fn google_code_sign_inc_detected() {
        let buf = b"subject=Google Inc\x00".to_vec();
        let r = analyze_google(&buf);
        assert!(r.code_sign_subject.is_some());
        assert!(
            r.code_sign_subject
                .as_deref()
                .unwrap()
                .starts_with("Google Inc")
        );
    }

    // JSON serialization -------------------------------------------------------

    #[test]
    fn google_report_serializes_stable_json_shape() {
        let buf = make_electron_buf();
        let r = analyze_google(&buf);
        let json = serde_json::to_value(&r).expect("serialize");
        assert!(json["family"].is_string());
        assert_eq!(json["family"], "electron");
        assert!(json["oauth_client_ids"].is_array());
        assert!(json["google_endpoints"].is_array());
        assert!(json["updater_urls"].is_array());
        assert!(json["indicators"].is_array());
    }

    // gRPC `exa.*` surface tests ----------------------------------------------

    #[test]
    fn google_grpc_path_extracts_service_and_method() {
        // Synthetic Go binary fragment: build-id marker + a real-shaped gRPC
        // routing path + the Codeium proto package symbol.
        let mut buf = b"Go build ID: \"abc\"\x00".to_vec();
        buf.extend_from_slice(b"/exa.language_server_pb.LanguageServerService/FetchUserInfo\x00");
        buf.extend_from_slice(b"codeium_common_go_proto\x00");
        let r = analyze_google(&buf);

        // Family unchanged.
        assert_eq!(
            r.family,
            BinaryFamily::GoBinary,
            "family must stay GoBinary, got {:?}",
            r.family
        );

        // Service from the path is recorded (full FQN).
        assert!(
            r.grpc_services
                .iter()
                .any(|s| s == "exa.language_server_pb.LanguageServerService"),
            "expected service FQN, got {:?}",
            r.grpc_services
        );
        // Codeium proto package marker recorded.
        assert!(
            r.grpc_services
                .iter()
                .any(|s| s == "codeium_common_go_proto"),
            "expected codeium_common_go_proto, got {:?}",
            r.grpc_services
        );
        // Method from the path is recorded.
        assert!(
            r.grpc_methods.iter().any(|m| m == "FetchUserInfo"),
            "expected FetchUserInfo method, got {:?}",
            r.grpc_methods
        );
        // Human indicators present.
        assert!(r.indicators.iter().any(|s| s.starts_with("gRPC service:")));
        assert!(r.indicators.iter().any(|s| s.starts_with("gRPC method:")));
    }

    #[test]
    fn google_grpc_methods_allowlist_and_sorted_dedup() {
        let mut buf = b".gopclntab\x00".to_vec();
        // Two distinct service paths.
        buf.extend_from_slice(b"/exa.auth_pb.AuthService/GetAuthStatus\x00");
        buf.extend_from_slice(b"/exa.models_pb.ModelService/GetAvailableModels\x00");
        // Allowlisted verb-noun identifiers loose in the corpus (mined only
        // because an exa.* service is present). Duplicate to test dedup.
        buf.extend_from_slice(b"FetchUserInfo GetModelResponse FetchUserInfo\x00");
        // A non-allowlisted CamelCase identifier that must NOT be captured.
        buf.extend_from_slice(b"RenderTemplate ComputeHash\x00");
        let r = analyze_google(&buf);

        assert_eq!(r.family, BinaryFamily::GoBinary);

        // Services sorted ascending.
        let mut sorted_svc = r.grpc_services.clone();
        sorted_svc.sort();
        assert_eq!(r.grpc_services, sorted_svc, "services must be sorted");

        // Methods sorted + deduped.
        let mut sorted_meth = r.grpc_methods.clone();
        sorted_meth.sort();
        sorted_meth.dedup();
        assert_eq!(
            r.grpc_methods, sorted_meth,
            "methods must be sorted + deduped"
        );

        // Allowlisted verbs captured.
        for expected in [
            "GetAuthStatus",
            "GetAvailableModels",
            "FetchUserInfo",
            "GetModelResponse",
        ] {
            assert!(
                r.grpc_methods.iter().any(|m| m == expected),
                "expected method {expected}, got {:?}",
                r.grpc_methods
            );
        }
        // FetchUserInfo only once despite appearing twice.
        assert_eq!(
            r.grpc_methods
                .iter()
                .filter(|m| *m == "FetchUserInfo")
                .count(),
            1,
            "FetchUserInfo must be deduplicated"
        );
        // Non-allowlisted identifiers excluded.
        assert!(
            !r.grpc_methods
                .iter()
                .any(|m| m == "RenderTemplate" || m == "ComputeHash"),
            "non-allowlisted identifiers must not be captured, got {:?}",
            r.grpc_methods
        );
    }

    #[test]
    fn google_grpc_no_mining_without_exa_service() {
        // Verb-noun identifiers present, but NO exa.* service — the corpus
        // allowlist must stay dormant so unrelated binaries are not polluted.
        let buf = b"go:buildid\x00GetUserInfo FetchData StartServer\x00".to_vec();
        let r = analyze_google(&buf);
        assert_eq!(r.family, BinaryFamily::GoBinary);
        assert!(
            r.grpc_services.is_empty(),
            "no services expected, got {:?}",
            r.grpc_services
        );
        assert!(
            r.grpc_methods.is_empty(),
            "no methods expected, got {:?}",
            r.grpc_methods
        );
    }

    #[test]
    fn google_grpc_bare_package_symbol_extracted() {
        // A bare `exa.*_pb` package symbol with no full service routing path.
        let buf = b"runtime.goexit\x00exa.codeium_common_pb\x00".to_vec();
        let r = analyze_google(&buf);
        assert_eq!(r.family, BinaryFamily::GoBinary);
        assert!(
            r.grpc_services.iter().any(|s| s == "exa.codeium_common_pb"),
            "expected bare package symbol, got {:?}",
            r.grpc_services
        );
    }

    #[test]
    fn google_grpc_empty_on_non_go() {
        // Electron buffer without any exa.* surface — grpc vecs stay empty.
        let buf = make_electron_buf();
        let r = analyze_google(&buf);
        assert!(r.grpc_services.is_empty());
        assert!(r.grpc_methods.is_empty());
    }

    #[test]
    fn google_report_serializes_grpc_arrays() {
        let r = analyze_google(b"");
        let json = serde_json::to_value(&r).expect("serialize");
        assert!(
            json["grpc_services"].is_array(),
            "grpc_services must serialize as array"
        );
        assert!(
            json["grpc_methods"].is_array(),
            "grpc_methods must serialize as array"
        );
    }

    // Combined test -----------------------------------------------------------

    #[test]
    fn google_combined_electron_with_oauth_and_endpoint() {
        let mut buf = make_electron_buf();
        buf.extend_from_slice(
            b"client_id=111111111111-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com\x00"
        );
        buf.extend_from_slice(b"https://accounts.google.com/o/oauth2/token\x00");
        let r = analyze_google(&buf);
        assert_eq!(r.family, BinaryFamily::Electron);
        assert_eq!(r.oauth_client_ids.len(), 1);
        assert!(r.google_endpoints.iter().any(|e| e.contains("google.com")));
    }

    // WGA tests ---------------------------------------------------------------

    #[test]
    fn google_family_wga_detected() {
        let mut buf = b"MZ_FAKE_HEADER".to_vec();
        buf.extend_from_slice(b"com.google.windows.app\x00search/wga/proto/lens/inputs.proto\x00--aim-sys-color\x00wga.google.com\x00");
        let r = analyze_google(&buf);
        assert_eq!(r.family, BinaryFamily::Wga);
        assert!(r.wga.is_some());
        let w = r.wga.as_ref().unwrap();
        assert!(w.aim_detected);
        assert!(w.lens_detected);
        assert_eq!(w.proto_descriptors.len(), 1);
        assert_eq!(w.proto_descriptors[0], "search/wga/proto/lens/inputs.proto");
        assert_eq!(w.flags.len(), 1);
        assert_eq!(w.flags[0], "--aim-sys-color");
        assert!(
            w.wga_endpoints
                .iter()
                .any(|endpoint| endpoint == "wga.google.com")
        );
    }

    #[test]
    fn generic_product_name_alone_does_not_classify_as_wga() {
        let report = analyze_google(b"Google Windows App\0WebView2Loader.dll\0");

        assert_eq!(report.family, BinaryFamily::WebView2);
        assert!(report.wga.is_none());
    }

    #[test]
    fn unrelated_absl_flags_do_not_mark_aim_as_detected() {
        let buf = b"com.google.windows.app\0--enable-sandbox\0";

        let report = analyze_google(buf);
        let wga = report.wga.expect("WGA marker should populate WGA report");

        assert!(!wga.aim_detected);
        assert!(wga.flags.iter().any(|flag| flag == "--enable-sandbox"));
    }

    #[test]
    fn google_wga_preferences_txtpb_parsed() {
        let sample = r#"
ai_mode_by_default: true
popup {
  key: SPACE
  modifiers {
    shift: false
    control: false
    alt: true
    win: false
  }
}
search_local_files: true
theme: THEME_DARK
search_drive_files: true
double_tap_modifier_key_for_popup: LCONTROL_KEY
experiments: 20004
experiments: 20006
always_on_top: true
user_zoom_factor: 1.8
screenshot_hotkey {
  key: KEY_L
  modifiers {
    shift: false
    control: true
    alt: false
    win: false
  }
}
aim_eligible: true
"#;
        let prefs = WgaPreferences::parse_txtpb(sample);
        assert!(prefs.ai_mode_by_default);
        assert!(prefs.aim_eligible);
        assert!(prefs.search_local_files);
        assert!(prefs.search_drive_files);
        assert!(prefs.always_on_top);
        assert_eq!(prefs.theme, "THEME_DARK");
        assert_eq!(prefs.popup_hotkey.as_deref(), Some("Alt+SPACE"));
        assert_eq!(prefs.screenshot_hotkey.as_deref(), Some("Ctrl+KEY_L"));
        assert_eq!(prefs.double_tap_key.as_deref(), Some("LCONTROL_KEY"));
        assert_eq!(prefs.experiments, vec![20004, 20006]);
        assert!((prefs.user_zoom_factor - 1.8).abs() < 1e-6);
    }

    #[test]
    fn live_google_wga_exe_if_available() {
        let Some(local) = std::env::var_os("LOCALAPPDATA") else {
            return;
        };
        let path = std::path::Path::new(&local).join("Google/Google/latest/google.exe");
        if path.exists() {
            let bytes = std::fs::read(path).expect("read google.exe");
            let r = analyze_google_bounded(&bytes, 2048);
            assert_eq!(r.family, BinaryFamily::Wga, "should classify as Wga");
            assert!(r.wga.is_some(), "Wga report must be populated");
            let w = r.wga.as_ref().unwrap();
            assert!(w.lens_detected, "Lens must be detected");
            assert!(
                !w.proto_descriptors.is_empty(),
                "Proto descriptors should be extracted"
            );
            assert!(
                !w.wga_endpoints.is_empty(),
                "WGA endpoints should be extracted"
            );
            assert!(
                r.oauth_client_ids
                    .iter()
                    .any(|id| id.contains("apps.googleusercontent.com")),
                "OAuth client ID should be extracted"
            );
        }
    }
}
