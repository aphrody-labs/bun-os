// SPDX-License-Identifier: Apache-2.0
//! Aphrody Bun OS HTML page renderer: the landing showcase served at `/` and error pages.

use axum::response::Html;

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

const STYLE: &str = "body{margin:0;min-height:100vh;display:grid;place-content:center;padding:32px;\
background:#101214;color:#e6e8ea;font:16px/1.5 system-ui,sans-serif}main{display:grid;gap:24px;max-width:960px}\
h1{margin:0;font-size:clamp(28px,5vw,44px)}p{margin:0;color:#b8bcc0;max-width:60ch}\
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}\
li{display:grid;gap:4px;padding:16px;border-radius:16px;background:#1b1f23}li span{color:#9aa0a6;font-size:14px}\
.build{font-size:12px;color:#6f757b}";

const LANDING_HTML: &str = include_str!("landing.html");

/// Placeholder served when the full client build is not mounted.
#[allow(dead_code)]
pub fn placeholder(commit: Option<&str>) -> Html<String> {
    let build = commit
        .map(|c| {
            format!(
                "<p class=\"build\">Build {}</p>",
                escape(&c[..c.len().min(10)])
            )
        })
        .unwrap_or_default();
    Html(format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
<meta name=\"color-scheme\" content=\"dark light\">\n<title>Aphrody Bun OS</title>\n\
<meta name=\"description\" content=\"Bun OS in your browser: the COSMIC desktop with Android apps, streamed from Bun OS.\">\n\
<link rel=\"canonical\" href=\"https://aphrody.com/\">\n<style>{STYLE}</style>\n</head>\n<body>\n<main>\n\
<h1>Bun OS in your browser</h1>\n\
<p>One desktop, COSMIC with Android apps inside it, streamed from Bun OS to this tab. The client is being deployed.</p>\n\
{build}\n</main>\n</body>\n</html>\n"
    ))
}

/// The HTML page of an error answered to a browser navigation (unknown path, wrong method, overload, ...); API
/// clients get the RFC 9457 problem instead.
pub fn error(status: axum::http::StatusCode, detail: &str) -> Html<String> {
    let code = status.as_u16();
    let title = status.canonical_reason().unwrap_or("Error");
    let detail = escape(detail);
    Html(format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
<meta name=\"color-scheme\" content=\"dark light\">\n<meta name=\"robots\" content=\"noindex\">\n\
<title>{code} {title} - Aphrody Bun OS</title>\n<style>{STYLE}a{{color:#a8c7fa}}</style>\n</head>\n<body>\n<main>\n\
<h1>{code} {title}</h1>\n<p>{detail}</p>\n<p><a href=\"/\">Open Bun OS</a></p>\n</main>\n</body>\n</html>\n"
    ))
}

/// Full, immersive, pure Rust Axum landing page with Material 3 tokens, authentic Aphrody identity,
/// real Craft Suite, Android 17 subsystem, and WebOS streaming.
pub fn landing(commit: Option<&str>) -> Html<String> {
    let build_meta = commit
        .map(|c| {
            format!(
                r#"<meta name="aphrody-build" content="{}">"#,
                escape(&c[..c.len().min(12)])
            )
        })
        .unwrap_or_default();

    if LANDING_HTML.contains("<!-- BUILD_META -->") {
        Html(LANDING_HTML.replace("<!-- BUILD_META -->", &build_meta))
    } else {
        Html(LANDING_HTML.replace("</head>", &format!("{build_meta}\n</head>")))
    }
}
