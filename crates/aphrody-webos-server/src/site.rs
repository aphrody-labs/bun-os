// SPDX-License-Identifier: Apache-2.0
//! Public web surface of aphrody.com around the wasm client: search (robots.txt, sitemap.xml, security.txt),
//! language models (llms.txt), installation (web app manifest, service worker, offline page), sharing (Open Graph
//! image and icons rendered from one SVG mark with resvg) and storage management (privacy page, Clear-Site-Data).

use std::sync::{Arc, OnceLock};

use axum::{
    Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;

use crate::{API, AppState};

pub const ORIGIN: &str = "https://aphrody.com";
pub const NAME: &str = "Aphrody";
pub const SHORT_NAME: &str = "Aphrody";
pub const DESCRIPTION: &str = "The unified operating system: Android 17, console emulators, the COSMIC desktop, and ambient Gemini intelligence.";
/// Subtitle of the site card: short enough for three lines.
const TAGLINE: &str =
    "The unified operating system: Android 17, console emulators, and the COSMIC desktop.";
const THEME: &str = "#0f141c"; // Gemini celestial dark surface
const ACCENT: &str = "#8ab4f8"; // Gemini Light Blue
/// Inter Bold (SIL Open Font License 1.1, assets/effectcraft/fonts), the only font the share images use.
const FONT: &[u8] = include_bytes!("../../../assets/effectcraft/fonts/Inter-Bold.ttf");
/// Public pages listed in the sitemap: (path, change frequency, priority).
const PAGES: &[(&str, &str, &str)] = &[
    ("/", "daily", "1.0"),
    ("/privacy", "monthly", "0.3"),
    ("/status", "hourly", "0.4"),
];

/// The Aphrody identity (crates/aphrody-identity): the Byron Love portrait icon set and the pet's idle animation.
const ICON_SVG: &[u8] = include_bytes!("../../aphrody-identity/assets/brand/icon.svg");
const FAVICON_ICO: &[u8] = include_bytes!("../../aphrody-identity/assets/brand/favicon.ico");
const ICONS: &[(&str, &[u8])] = &[
    ("icon-192.png", include_bytes!("../../aphrody-identity/assets/brand/icon-192.png")),
    ("icon-512.png", include_bytes!("../../aphrody-identity/assets/brand/icon-512.png")),
    ("maskable-192.png", include_bytes!("../../aphrody-identity/assets/brand/maskable-192.png")),
    ("maskable-512.png", include_bytes!("../../aphrody-identity/assets/brand/maskable-512.png")),
    ("apple-touch-icon.png", include_bytes!("../../aphrody-identity/assets/brand/apple-touch-icon.png")),
];
/// Portrait drawn on the share card.
const CARD_ICON: &[u8] = include_bytes!("../../aphrody-identity/assets/brand/icon-256.png");
/// Fullbody artwork of Byron Love (Aphrodi), sovereign mascot and logo of Aphrody.
const BYRON_FULLBODY: &[u8] = include_bytes!("../../aphrody-identity/assets/logo/source/byron_r0_fullbody.png");
/// Canonical portrait in lossless WebP.
const BYRON_PORTRAIT: &[u8] = include_bytes!("../../aphrody-identity/assets/logo/aphrody.webp");
/// Idle track of the pet (atlas row 0: six 192x208 cells), extracted from assets/aphrody/sprites/spritesheet.png.
const PET_IDLE: &[u8] = include_bytes!("../../aphrody-identity/assets/aphrody/sprites/idle.webp");

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Open Graph card (1200x630): the Aphrody portrait, a title and a subtitle, wrapped to the card width.
fn card(title: &str, subtitle: &str) -> String {
    fn wrap(text: &str, max: usize, lines: usize) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for word in text.split_whitespace() {
            let fits = out
                .last()
                .is_some_and(|line| line.chars().count() + 1 + word.chars().count() <= max);
            if fits {
                if let Some(line) = out.last_mut() {
                    line.push(' ');
                    line.push_str(word);
                }
            } else if out.len() == lines {
                if let Some(line) = out.last_mut() {
                    line.push('…');
                }
                break;
            } else {
                out.push(word.to_owned());
            }
        }
        out
    }
    let title_lines = wrap(title, 22, 2);
    let subtitle_lines = wrap(subtitle, 52, 3);
    let mut text = String::new();
    for (i, line) in title_lines.iter().enumerate() {
        text += &format!(
            r##"<text x="80" y="{}" font-family="Inter" font-weight="700" font-size="76" fill="#f4f5f6">{}</text>"##,
            300 + i as u32 * 88,
            escape(line)
        );
    }
    let top = 300 + title_lines.len() as u32 * 88 + 10;
    for (i, line) in subtitle_lines.iter().enumerate() {
        text += &format!(
            r##"<text x="80" y="{}" font-family="Inter" font-weight="700" font-size="32" fill="#a9afb5">{}</text>"##,
            top + i as u32 * 44,
            escape(line)
        );
    }
    use base64::Engine as _;
    let icon = base64::engine::general_purpose::STANDARD.encode(CARD_ICON);
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><radialGradient id="bg" cx="0.85" cy="0.1" r="1"><stop offset="0" stop-color="#142034"/><stop offset="0.6" stop-color="{THEME}"/></radialGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<rect x="0" y="618" width="1200" height="12" fill="{ACCENT}"/>
<image x="80" y="80" width="128" height="128" href="data:image/png;base64,{icon}"/>
<text x="232" y="160" font-family="Inter" font-weight="700" font-size="40" fill="{ACCENT}">aphrody.com</text>
{text}
</svg>"##
    )
}

fn render_png(svg: &str, width: u32, height: u32) -> Option<Vec<u8>> {
    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_font_data(FONT.to_vec());
    let tree = resvg::usvg::Tree::from_str(svg, &options).ok()?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)?;
    let size = tree.size();
    let transform = resvg::tiny_skia::Transform::from_scale(
        width as f32 / size.width(),
        height as f32 / size.height(),
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    pixmap.encode_png().ok()
}

/// The share card is rendered once per process and then served from memory.
fn card_png() -> &'static [u8] {
    static CARD: OnceLock<Vec<u8>> = OnceLock::new();
    CARD.get_or_init(|| render_png(&card(NAME, TAGLINE), 1200, 630).unwrap_or_default())
}

fn bytes(content_type: &'static str, cache: &'static str, body: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(content_type)),
            (header::CACHE_CONTROL, HeaderValue::from_static(cache)),
        ],
        body,
    )
        .into_response()
}

const DAY: &str = "public, max-age=86400, stale-while-revalidate=604800";
const HOUR: &str = "public, max-age=3600, stale-while-revalidate=86400";

async fn robots() -> Response {
    let body = format!(
        "# aphrody.com: every public page may be indexed, by search engines and by AI crawlers alike.\n\
User-agent: *\nAllow: /\nDisallow: /api/sessions\nDisallow: /privacy/clear\n\n\
Sitemap: {ORIGIN}/sitemap.xml\n"
    );
    bytes("text/plain; charset=utf-8", DAY, body.into_bytes())
}

async fn sitemap(State(state): State<Arc<AppState>>) -> Response {
    let lastmod = state.released.as_str();
    let mut body = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\" \
xmlns:image=\"http://www.google.com/schemas/sitemap-image/1.1\">\n",
    );
    for (path, freq, priority) in PAGES {
        body += &format!(
            "  <url><loc>{ORIGIN}{path}</loc><lastmod>{lastmod}</lastmod><changefreq>{freq}</changefreq><priority>{priority}</priority>"
        );
        if *path == "/" {
            body += &format!("<image:image><image:loc>{ORIGIN}/og.png</image:loc></image:image>");
        }
        body += "</url>\n";
    }
    body += "</urlset>\n";
    bytes("application/xml; charset=utf-8", HOUR, body.into_bytes())
}

/// https://llmstxt.org: what the site is, then links an agent can follow; the API section is generated from `API`.
fn llms_txt(full: bool) -> String {
    let mut out = format!(
        "# {NAME}\n\n> {DESCRIPTION}\n\n\
aphrody.com is one Rust process (axum) behind nginx (HTTP/3). The page loads an iced/libcosmic client compiled to \
WebAssembly; sessions are streamed over WebSocket. Bun OS is a single image: Android, ChromiumOS components, the \
COSMIC desktop and a Rust base, with Gemini at the centre.\n\n\
## Site\n\n\
- [Home]({ORIGIN}/): the WebOS session client\n\
- [Status]({ORIGIN}/status): live health of every Bun OS service\n\
- [Privacy and storage]({ORIGIN}/privacy): what the site stores in the browser, and how to clear it\n\
- [Sitemap]({ORIGIN}/sitemap.xml)\n\n\
## API\n\n\
- [OpenAPI document]({ORIGIN}/api/openapi.json): {title} {version}\n\
- [Public API catalogue](https://api.aphrody.com/v1/openapi.json): every Bun OS service\n\
- [Health]({ORIGIN}/api/health)\n\
- [Emulator catalog]({ORIGIN}/api/emulators)\n\
- [Inventory]({ORIGIN}/api/inventory): every crate, package, app and factory member of Bun OS\n\n\
## Source\n\n\
- [GitHub: aphrody-labs/bun-os](https://github.com/aphrody-labs/bun-os)\n",
        title = API.title,
        version = API.version,
    );
    if full {
        out += &format!("\n## Operations of {}\n\n", API.title);
        for op in API.ops {
            out += &format!(
                "- `{} /api{}`: {}{}\n",
                op.method,
                op.path,
                op.summary,
                if op.auth { " (owner session)" } else { "" }
            );
        }
    } else {
        out += &format!(
            "\n## Optional\n\n- [Full text]({ORIGIN}/llms-full.txt): every API operation\n"
        );
    }
    out
}

async fn llms() -> Response {
    bytes(
        "text/markdown; charset=utf-8",
        HOUR,
        llms_txt(false).into_bytes(),
    )
}

async fn llms_full() -> Response {
    bytes(
        "text/markdown; charset=utf-8",
        HOUR,
        llms_txt(true).into_bytes(),
    )
}

async fn security_txt(State(state): State<Arc<AppState>>) -> Response {
    // RFC 9116: Expires at most a year ahead; one year after this release.
    let year: u32 = state
        .released
        .get(..4)
        .and_then(|y| y.parse().ok())
        .unwrap_or(2026);
    let body = format!(
        "Contact: mailto:contact@aphrody.com\nExpires: {}-12-31T23:59:59Z\nPreferred-Languages: en, fr\n\
Canonical: {ORIGIN}/.well-known/security.txt\nPolicy: {ORIGIN}/privacy\n",
        year + 1
    );
    bytes("text/plain; charset=utf-8", DAY, body.into_bytes())
}

async fn manifest() -> Response {
    let body = serde_json::json!({
        "id": "/",
        "name": NAME,
        "short_name": SHORT_NAME,
        "description": DESCRIPTION,
        "lang": "en",
        "dir": "ltr",
        "start_url": "/?source=pwa",
        "scope": "/",
        "display": "standalone",
        "display_override": ["window-controls-overlay", "standalone", "minimal-ui"],
        "orientation": "any",
        "background_color": THEME,
        "theme_color": THEME,
        "categories": ["productivity", "utilities", "games", "developer"],
        "prefer_related_applications": false,
        "launch_handler": { "client_mode": ["navigate-existing", "auto"] },
        "handle_links": "preferred",
        "icons": [
            { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
            { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
            { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
            { "src": "/icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
            { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
        ],
        "screenshots": [
            { "src": "/og.png", "sizes": "1200x630", "type": "image/png", "form_factor": "wide", "label": "Aphrody" },
        ],
        "shortcuts": [
            { "name": "Status", "url": "/status", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] },
            { "name": "Privacy and storage", "url": "/privacy", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] },
        ],
    });
    bytes(
        "application/manifest+json",
        HOUR,
        body.to_string().into_bytes(),
    )
}

async fn favicon_svg() -> Response {
    bytes("image/svg+xml", DAY, ICON_SVG.to_vec())
}

async fn favicon_ico() -> Response {
    bytes("image/x-icon", DAY, FAVICON_ICO.to_vec())
}

async fn icon(Path(name): Path<String>) -> Response {
    match ICONS.iter().find(|(file, _)| *file == name) {
        Some((_, png)) => bytes("image/png", DAY, png.to_vec()),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn pet_idle() -> Response {
    bytes("image/webp", DAY, PET_IDLE.to_vec())
}

async fn apple_touch_icon() -> Response {
    icon(Path("apple-touch-icon.png".into())).await
}

async fn byron_png() -> Response {
    bytes("image/png", DAY, BYRON_FULLBODY.to_vec())
}

async fn byron_webp() -> Response {
    bytes("image/webp", DAY, BYRON_PORTRAIT.to_vec())
}

#[derive(Deserialize)]
struct CardQuery {
    title: Option<String>,
    subtitle: Option<String>,
}

/// `/og.png` is the site card; `?title=&subtitle=` renders a card for any shared link (bounded text).
async fn og(Query(query): Query<CardQuery>) -> Response {
    if query.title.is_none() && query.subtitle.is_none() {
        return bytes("image/png", DAY, card_png().to_vec());
    }
    let clip = |text: Option<String>, max: usize, default: &str| {
        text.unwrap_or_else(|| default.to_owned())
            .chars()
            .take(max)
            .collect::<String>()
    };
    let title = clip(query.title, 60, NAME);
    let subtitle = clip(query.subtitle, 150, TAGLINE);
    match tokio::task::spawn_blocking(move || render_png(&card(&title, &subtitle), 1200, 630)).await
    {
        Ok(Some(png)) => bytes("image/png", DAY, png),
        _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Network first for pages (offline page when the network is gone), cache first for content-hashed assets,
/// never for the API, the session stream or other origins. The cache name carries the release commit.
async fn service_worker(State(state): State<Arc<AppState>>) -> Response {
    let version = state
        .source_commit
        .as_deref()
        .map_or("dev", |c| &c[..c.len().min(12)]);
    let body = format!(
        r#"// SPDX-License-Identifier: Apache-2.0
// aphrody.com service worker (crates/aphrody-webos-server/src/site.rs), release {version}.
const CACHE = "aphrody-{version}";
const SHELL = ["/offline", "/favicon.svg", "/icons/icon-192.png", "/manifest.webmanifest"];
const HASHED = /[.-][0-9a-f]{{12,64}}\.(?:js|mjs|css|wasm|woff2|png|webp|avif|svg)$/;
self.addEventListener("install", (event) => {{
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
}});
self.addEventListener("activate", (event) => {{
  event.waitUntil((async () => {{
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  }})());
}});
self.addEventListener("fetch", (event) => {{
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {{
    event.respondWith((async () => {{
      try {{ return (await event.preloadResponse) || (await fetch(request)); }}
      catch {{ return (await caches.match("/offline")) || Response.error(); }}
    }})());
    return;
  }}
  if (HASHED.test(url.pathname)) {{
    event.respondWith((async () => {{
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }})());
  }}
}});
self.addEventListener("message", (event) => {{
  if (event.data === "clear-caches") event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
}});
"#
    );
    (
        [
            (header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
            (
                header::HeaderName::from_static("service-worker-allowed"),
                "/",
            ),
        ],
        body,
    )
        .into_response()
}

/// Source colour of the aphrody.com scheme (Gemini brand blue #3186ff); every colour on the pages is an M3 role of it.
const SEED: u32 = aphrody_m3_tokens::gemini_brand::GEMINI_BLUE;
const SITE_CSS: &str = include_str!("site.css");

/// M3 light and dark schemes generated from `SEED` by aphrody-m3-tokens, its static tokens (shape, type, motion,
/// state layers, elevation) and the page components. `html.dark` forces the dark scheme (the landing).
fn stylesheet() -> &'static str {
    static CSS: OnceLock<String> = OnceLock::new();
    CSS.get_or_init(|| {
        use aphrody_m3_tokens::{scheme::Variant, sheets};
        let light = sheets::scheme_css(SEED, Variant::TonalSpot, false, 0.0);
        let dark = sheets::scheme_css(SEED, Variant::TonalSpot, true, 0.0);
        format!(
            "{light}
@media (prefers-color-scheme: dark) {{
{dark}}}
{forced}
{statics}
{SITE_CSS}",
            forced = dark.replace(":root", "html.dark"),
            statics = sheets::static_css(),
        )
    })
}

async fn site_css() -> Response {
    bytes(
        "text/css; charset=utf-8",
        HOUR,
        stylesheet().as_bytes().to_vec(),
    )
}

fn page(path: &str, title: &str, description: &str, body: &str) -> Html<String> {
    Html(format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="{THEME}">
<title>{title} · {NAME}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{ORIGIN}{path}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/site.css">
<link rel="describedby" type="text/markdown" href="/llms.txt">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{NAME}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{ORIGIN}{path}">
<meta property="og:image" content="{ORIGIN}/og.png?title={title_q}">
<meta name="twitter:card" content="summary_large_image">
<script type="module" src="/site.js"></script>
</head>
<body>
<main class="page" id="main">
{body}
<p><a href="/">Back to {NAME}</a></p>
</main>
</body>
</html>
"#,
        title = escape(title),
        description = escape(description),
        title_q = title.replace(' ', "+"),
    ))
}

async fn privacy() -> Html<String> {
    page(
        "/privacy",
        "Privacy and storage",
        "What aphrody.com stores in your browser, why, and how to inspect or clear it.",
        r#"<h1>Privacy and storage</h1>
<p>aphrody.com sets no advertising or tracking cookies and loads nothing from third parties. It only stores what the
desktop needs to work: the cookie of an owner session, your storage choice and the offline copy of the client.</p>
<h2>What is stored</h2>
<div class="table-wrap" tabindex="0" role="region" aria-label="What is stored"><table class="wide">
<caption hidden>Storage used by aphrody.com</caption>
<thead><tr><th>Name</th><th>Kind</th><th>Purpose</th><th>Lifetime</th></tr></thead>
<tbody>
<tr><td><code>aphrody_session</code></td><td>Cookie (HttpOnly, Secure)</td><td>Owner sign-in to start and stop sessions</td><td>Until it expires</td></tr>
<tr><td><code>aphrody.storage</code></td><td>localStorage</td><td>Your choice in the storage notice</td><td>Until cleared</td></tr>
<tr><td><code>aphrody-&lt;release&gt;</code></td><td>Cache Storage</td><td>Offline page and the WebAssembly client</td><td>Replaced on every release</td></tr>
</tbody>
</table></div>
<h2>Your choice</h2>
<p>“Essential only” keeps the session cookie and nothing else: no offline copy and no saved preferences.</p>
<div class="row">
<button type="button" class="filled" data-storage="accept">Allow functional storage</button>
<button type="button" data-storage="refuse">Essential only</button>
</div>
<h2>In this browser now</h2>
<div class="table-wrap"><table id="storage-report"><tbody><tr><td>Reading local storage…</td></tr></tbody></table></div>
<div class="row">
<button type="button" class="tonal" data-storage="persist">Keep data on this device</button>
<button type="button" data-storage="clear-local">Clear local data</button>
</div>
<section class="danger-zone" aria-labelledby="danger-title">
<h2 id="danger-title">Clear everything</h2>
<p>Deletes cookies, storage and caches of aphrody.com in this browser and signs you out. This cannot be undone.</p>
<div class="row"><button type="button" class="danger" data-storage="clear-all">Clear everything and sign out</button></div>
</section>
<output id="storage-status" role="status" aria-live="polite"></output>"#,
    )
}

async fn offline() -> Html<String> {
    page(
        "/offline",
        "Offline",
        "aphrody.com needs the network to stream your Bun OS session.",
        r#"<h1>You are offline</h1>
<p>The Bun OS session is streamed from the server. Reconnect, then reload this page.</p>
<div class="row"><button type="button" class="filled" data-action="reload">Reload</button></div>"#,
    )
}

/// `Clear-Site-Data`: the browser drops cookies, storage and caches of aphrody.com (same-origin POST only).
async fn clear(headers: HeaderMap) -> Response {
    let same_origin = headers
        .get(header::ORIGIN)
        .and_then(|o| o.to_str().ok())
        .is_some_and(|o| {
            o == ORIGIN || o.starts_with("http://127.0.0.1") || o.starts_with("http://localhost")
        });
    if !same_origin {
        return StatusCode::FORBIDDEN.into_response();
    }
    (
        StatusCode::NO_CONTENT,
        [
            (
                header::HeaderName::from_static("clear-site-data"),
                "\"cache\", \"cookies\", \"storage\"",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
    )
        .into_response()
}

/// Storage notice, storage manager, service worker registration, install prompt and WebGPU probe. Plain module,
/// same origin (CSP `script-src 'self'`); the wasm client itself stays in boot.js.
const SITE_JS: &str = include_str!("site.js");

async fn site_js() -> Response {
    bytes(
        "text/javascript; charset=utf-8",
        "no-cache",
        SITE_JS.as_bytes().to_vec(),
    )
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/robots.txt", get(robots))
        .route("/sitemap.xml", get(sitemap))
        .route("/llms.txt", get(llms))
        .route("/llms-full.txt", get(llms_full))
        .route("/.well-known/security.txt", get(security_txt))
        .route("/manifest.webmanifest", get(manifest))
        .route("/favicon.svg", get(favicon_svg))
        .route("/favicon.ico", get(favicon_ico))
        .route("/apple-touch-icon.png", get(apple_touch_icon))
        .route("/icons/{name}", get(icon))
        .route("/pet-idle.webp", get(pet_idle))
        .route("/byron.png", get(byron_png))
        .route("/byron.webp", get(byron_webp))
        .route("/og.png", get(og))
        .route("/sw.js", get(service_worker))
        .route("/site.js", get(site_js))
        .route("/site.css", get(site_css))
        .route("/privacy", get(privacy))
        .route("/offline", get(offline))
        .route("/privacy/clear", post(clear))
        .with_state(state)
}

/// Warm the raster cache off the request path.
pub fn prerender() {
    std::thread::spawn(|| {
        card_png();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_images_render() {
        assert_eq!(&card_png()[1..4], b"PNG");
        assert!(ICONS.iter().all(|(_, png)| &png[1..4] == b"PNG"));
        assert_eq!(&FAVICON_ICO[..4], &[0, 0, 1, 0]);
        assert!(ICON_SVG.starts_with(b"<svg") || ICON_SVG.starts_with(b"<?xml"));
        assert_eq!(&PET_IDLE[8..12], b"WEBP");
        assert_eq!(&BYRON_FULLBODY[1..4], b"PNG");
        assert_eq!(&BYRON_PORTRAIT[8..12], b"WEBP");
    }

    #[test]
    fn llms_lists_every_operation() {
        let full = llms_txt(true);
        assert!(full.starts_with("# Aphrody\n\n> "));
        assert!(API.ops.iter().all(|op| full.contains(op.summary)));
    }

    #[test]
    fn stylesheet_has_both_schemes() {
        let css = stylesheet();
        assert!(css.contains("--md-sys-color-primary:"));
        assert!(css.contains("prefers-color-scheme: dark"));
        assert!(css.contains("html.dark"));
        assert!(css.contains("--md-sys-shape-corner-full"));
        assert!(css.contains("#storage-notice"));
    }
}
