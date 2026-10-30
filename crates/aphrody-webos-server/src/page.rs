// SPDX-License-Identifier: Apache-2.0
//! The page served at `/` while the wasm client is not part of the release: rendered here, no JavaScript.

use aphrody_webos_protocol::OsId;
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

pub fn placeholder(commit: Option<&str>) -> Html<String> {
    let items: String = OsId::ALL
        .iter()
        .map(|os| {
            format!(
                "<li><strong>{}</strong><span>{}</span></li>",
                escape(os.name()),
                escape(os.summary())
            )
        })
        .collect();
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
<meta name=\"description\" content=\"Arch Linux, Alpine, Android, Wine and Proton in your browser, streamed from Bun OS.\">\n\
<link rel=\"canonical\" href=\"https://aphrody.com/\">\n<style>{STYLE}</style>\n</head>\n<body>\n<main>\n\
<h1>Bun OS in your browser</h1>\n\
<p>Real operating systems, streamed from Bun OS: pick one and use it in this tab. The streaming client is being deployed.</p>\n\
<ul>{items}</ul>\n{build}\n</main>\n</body>\n</html>\n"
    ))
}
