// SPDX-License-Identifier: Apache-2.0
//! Native Google SERP transport and anonymous cache.
//!
//! Domain allowlist copied from aphrody-web commit bbeb5ef4,
//! `apps/bxc/src/google/dns.ts` (SHA-256
//! f82c360e43bce66f7557fd67167f6a7445d62407bd8a1e93b0d25fe7439b1b8d).

use std::{
    path::PathBuf,
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use regex::Regex;
#[cfg(feature = "search-cache")]
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use super::serp::{SerpContent, parse_serp};

const DESKTOP_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SOCS: &str = "CAESHAgBEhJnd3NfMjAyNDA5MDktMF9SQzIaAmVuIAEaBgiA_L-3Bg";
const TIMEOUT: Duration = Duration::from_secs(30);

static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .redirect(search_redirect_policy())
        .build()
        .expect("static search HTTP client")
});

fn search_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10
            || attempt.url().scheme() != "https"
            || !attempt.url().host_str().is_some_and(is_google_domain)
        {
            attempt.error("Google search redirect refused")
        } else {
            attempt.follow()
        }
    })
}

pub(super) async fn public_json(url: Url) -> Result<Value, String> {
    let mut response = HTTP
        .get(url)
        .header("user-agent", DESKTOP_UA)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if bytes.len().saturating_add(chunk.len()) > 8 * 1024 * 1024 {
            return Err("Google discovery response exceeds 8 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

/// The same domain-scoped cookie and native/browser owners as the Web SERP.
pub(super) async fn discovery_html(url: &Url, options: &SearchOptions) -> Result<String, String> {
    if !url.host_str().is_some_and(is_google_domain) {
        return Err("discovery HTML URL must belong to Google".into());
    }
    let owned = options.clone();
    let cookies = blocking(move || search_cookies(&owned)).await?;
    let transports: &[SearchTransport] = match options.transport {
        SearchTransport::Auto => &[SearchTransport::Fetch, SearchTransport::Http],
        SearchTransport::Fetch => &[SearchTransport::Fetch],
        SearchTransport::Http => &[SearchTransport::Http],
    };
    let mut failures = Vec::new();
    for transport in transports {
        let response = match transport {
            SearchTransport::Fetch => native_fetch(url, &cookies, &options.domain).await,
            SearchTransport::Http => browser_fetch(url, &cookies, &options.domain).await,
            SearchTransport::Auto => unreachable!(),
        };
        match response {
            Ok(html) if !is_blocked_serp_html(&html) && html.len() <= 8 * 1024 * 1024 => {
                return Ok(html);
            }
            Ok(_) => {
                failures.push("blocked, empty or oversized Google discovery response".to_owned())
            }
            Err(error) => failures.push(error),
        }
    }
    Err(failures.join("; "))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchTransport {
    Auto,
    Fetch,
    Http,
}

impl SearchTransport {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Fetch => "fetch",
            Self::Http => "http",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SearchOptions {
    pub hl: String,
    pub gl: String,
    pub num: Option<u8>,
    pub start: Option<u32>,
    pub safe: Option<String>,
    pub domain: String,
    pub classic: bool,
    pub udm: Option<u16>,
    pub cache_ttl_ms: Option<u64>,
    pub cookie_path: Option<PathBuf>,
    /// Never load account cookies, including from the default Aphrody store.
    pub anonymous: bool,
    /// Require an existing account cookie jar; never downgrade a private CLI request to anonymous.
    pub require_authenticated: bool,
    pub transport: SearchTransport,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            hl: "en".to_owned(),
            gl: "US".to_owned(),
            num: None,
            start: None,
            safe: None,
            domain: "google.com".to_owned(),
            classic: true,
            udm: None,
            cache_ttl_ms: None,
            cookie_path: None,
            anonymous: false,
            require_authenticated: false,
            transport: SearchTransport::Auto,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichSearchResult {
    #[serde(flatten)]
    pub content: SerpContent,
    pub served_from_cache: bool,
    pub profile_used: SearchTransport,
    pub authenticated: bool,
}

#[derive(Clone)]
struct SearchCookie {
    name: String,
    value: String,
    domain: String,
    path: String,
    secure: bool,
    host_only: bool,
}

pub fn is_google_domain(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    include_str!("google_domains.txt")
        .lines()
        .any(|domain| host == domain || host.ends_with(&format!(".{domain}")))
}

pub fn search_url(query: &str, options: &SearchOptions) -> Result<Url, String> {
    if options.num.is_some_and(|num| num == 0 || num > 100) {
        return Err("Google Search num must be an integer from 1 to 100".to_owned());
    }
    if !is_google_domain(&options.domain) {
        return Err(format!("Invalid Google domain: {}", options.domain));
    }
    let host = if options.domain.starts_with("google.") {
        format!("www.{}", options.domain)
    } else {
        options.domain.clone()
    };
    let mut url =
        Url::parse(&format!("https://{host}/search")).map_err(|error| error.to_string())?;
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs
            .append_pair("q", query)
            .append_pair("hl", &options.hl)
            .append_pair("gl", &options.gl);
        if let Some(num) = options.num {
            query_pairs.append_pair("num", &num.to_string());
        }
        if let Some(start) = options.start.filter(|start| *start > 0) {
            query_pairs.append_pair("start", &start.to_string());
        }
        if let Some(safe) = &options.safe {
            query_pairs.append_pair("safe", safe);
        }
        if let Some(udm) = options.udm.or(options.classic.then_some(14)) {
            query_pairs.append_pair("udm", &udm.to_string());
        }
    }
    Ok(url)
}

fn cookies_dir() -> Option<PathBuf> {
    std::env::var_os("APHRODY_COOKIES_DIR")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("APHRODY_HOME")
                .filter(|path| !path.is_empty())
                .map(|home| PathBuf::from(home).join("cookies"))
        })
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".aphrody/cookies"))
        })
}

fn default_cookie_path() -> Option<PathBuf> {
    if let Some(path) =
        std::env::var_os("APHRODY_GOOGLE_COOKIES_JSON").filter(|path| !path.is_empty())
    {
        return Some(PathBuf::from(path));
    }
    if let Some(dir) = cookies_dir() {
        let json = dir.join("google.json");
        let text = dir.join("google.txt");
        if json.is_file() {
            return Some(json);
        } else if text.is_file() {
            return Some(text);
        }
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let home_path = PathBuf::from(home);
    let aphrody_dir = home_path.join(".aphrody");
    let cookies_json = aphrody_dir.join("google-cookies.json");
    if cookies_json.is_file() {
        return Some(cookies_json);
    }
    let session_json = aphrody_dir.join("google-session.json");
    if session_json.is_file() {
        return Some(session_json);
    }
    let gemini_cookies = home_path.join(".gemini/.cookies/google.com.json");
    if gemini_cookies.is_file() {
        return Some(gemini_cookies);
    }
    // State of the former `bxc` application: read only, never written.
    let legacy_cookies = home_path.join(".bxc/cookies/google.json");
    if legacy_cookies.is_file() {
        return Some(legacy_cookies);
    }
    Some(cookies_json)
}

fn parse_cookies(payload: &str) -> Vec<SearchCookie> {
    let now = now_seconds();
    if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(payload) {
        return items
            .into_iter()
            .filter_map(|item| {
                let name = item.get("name")?.as_str()?.to_owned();
                let value = item.get("value")?.as_str()?.to_owned();
                let domain = item.get("domain")?.as_str()?.to_ascii_lowercase();
                if name.is_empty() || domain.is_empty() {
                    return None;
                }
                if item.get("session").and_then(Value::as_bool) != Some(true)
                    && item
                        .get("expirationDate")
                        .or_else(|| item.get("expires"))
                        .and_then(Value::as_f64)
                        .is_some_and(|expiry| expiry > 0.0 && expiry < now as f64)
                {
                    return None;
                }
                Some(SearchCookie {
                    name,
                    value,
                    domain,
                    path: item
                        .get("path")
                        .and_then(Value::as_str)
                        .unwrap_or("/")
                        .to_owned(),
                    secure: item.get("secure").and_then(Value::as_bool).unwrap_or(false),
                    host_only: item
                        .get("hostOnly")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                })
            })
            .collect();
    }
    payload
        .lines()
        .filter_map(|line| {
            let line = line.strip_prefix("#HttpOnly_").unwrap_or(line);
            if line.starts_with('#') || line.trim().is_empty() {
                return None;
            }
            let columns: Vec<_> = line.split('\t').collect();
            if columns.len() < 7 {
                return None;
            }
            if columns[4]
                .parse::<u64>()
                .ok()
                .is_some_and(|expiry| expiry > 0 && expiry < now)
            {
                return None;
            }
            Some(SearchCookie {
                domain: columns[0].to_ascii_lowercase(),
                path: columns[2].to_owned(),
                secure: columns[3].eq_ignore_ascii_case("true"),
                host_only: !columns[0].starts_with('.'),
                name: columns[5].to_owned(),
                value: columns[6].to_owned(),
            })
        })
        .collect()
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(any(feature = "search-cache", test))]
fn now_milliseconds() -> i64 {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}

fn load_cookies(path: Option<&PathBuf>) -> Vec<SearchCookie> {
    let path = resolve_cookie_path(path, default_cookie_path());
    path.and_then(|path| std::fs::read_to_string(path).ok())
        .map_or_else(Vec::new, |contents| parse_cookies(&contents))
}

fn resolve_cookie_path(explicit: Option<&PathBuf>, configured: Option<PathBuf>) -> Option<PathBuf> {
    explicit.cloned().or(configured)
}

fn search_cookies(options: &SearchOptions) -> Vec<SearchCookie> {
    if options.anonymous {
        Vec::new()
    } else {
        load_cookies(options.cookie_path.as_ref())
    }
}

fn cookie_header(url: &Url, cookies: &[SearchCookie], domain: &str) -> String {
    let host = url.host_str().unwrap_or_default();
    let path = url.path();
    let mut header = Vec::new();
    for cookie in cookies {
        let cookie_domain = cookie.domain.trim_start_matches('.');
        let original_google = matches!(cookie_domain, "google.com");
        let cookie_domain = if original_google && domain != "google.com" {
            domain
        } else {
            cookie_domain
        };
        if (host == cookie_domain
            || (!cookie.host_only && host.ends_with(&format!(".{cookie_domain}"))))
            && path.starts_with(&cookie.path)
            && (!cookie.secure || url.scheme() == "https")
        {
            header.push(format!("{}={}", cookie.name, cookie.value));
        }
    }
    if !cookies.iter().any(|cookie| cookie.name == "CONSENT") {
        header.push(format!(
            "CONSENT=YES+cb.{}-00-p0.en+FX+001",
            chrono::Utc::now().format("%Y%m%d")
        ));
    }
    if !cookies.iter().any(|cookie| cookie.name == "SOCS") {
        header.push(format!("SOCS={SOCS}"));
    }
    header.join("; ")
}

fn empty_serp_reason(html: &str) -> &'static str {
    if html.contains("/httpservice/retry/enablejs") {
        "Google JavaScript bootstrap"
    } else if html.contains("consent.google.com") || html.contains("Before you continue") {
        "Google consent interstitial"
    } else if html.contains("recaptcha") || html.contains("unusual traffic") {
        "Google anti-bot interstitial"
    } else if !html.contains("<h3") {
        "Google response has no result markup (JavaScript or interstitial page)"
    } else {
        "Google result markup is incompatible with the current parser"
    }
}

pub fn is_blocked_serp_html(html: &str) -> bool {
    // Google sometimes returns a large HTTP 200 JavaScript bootstrap instead of
    // server-rendered search results. Its size bypasses the short-page guard.
    if html.contains("/httpservice/retry/enablejs") && !html.contains("<h3") {
        return true;
    }
    static MARKERS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
        r#"(?i)<div[^>]+id=["'](?:search|rso|center_col)["']|<div[^>]+class=["'][^"']*\bg\b[^"']*["']|data-async-context=["']query:"#
    ).expect("static regex")
    });
    static BLOCKED: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
        r#"(?i)<title>[^<]*?(?:sorry|unusual traffic|error 403)|<form[^>]+action=["'][^"']*?(?:sorry|/index)[^"']*["']|id=["']recaptcha["']|class=["'][^"']*?g-recaptcha|unusual traffic from your computer network|consent\.google\.com|<title>Before you continue to Google|SG_REL|SG_SS=|If you're having trouble accessing Google Search"#
    ).expect("static regex")
    });
    if html.trim().is_empty() {
        return true;
    }
    if MARKERS.is_match(html) {
        return false;
    }
    BLOCKED.is_match(html) || html.len() < 2000
}

async fn native_fetch(url: &Url, cookies: &[SearchCookie], domain: &str) -> Result<String, String> {
    let response = HTTP.get(url.clone())
        .header("user-agent", DESKTOP_UA)
        .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
        .header("accept-language", "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("sec-ch-ua", "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"")
        .header("sec-ch-ua-mobile", "?0").header("sec-ch-ua-platform", "\"Windows\"")
        .header("sec-fetch-dest", "document").header("sec-fetch-mode", "navigate")
        .header("sec-fetch-site", "none").header("sec-fetch-user", "?1")
        .header("upgrade-insecure-requests", "1")
        .header("cookie", cookie_header(url, cookies, domain))
        .send().await.map_err(|error| error.to_string())?;
    let mut response = response
        .error_for_status()
        .map_err(|_| "Google search HTTP request failed".to_owned())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Google search body failed".to_owned())?
    {
        if bytes.len().saturating_add(chunk.len()) > 8 * 1024 * 1024 {
            return Err("Google search response exceeds 8 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "Google search response is not UTF-8".to_owned())
}

async fn browser_fetch(
    _url: &Url,
    _cookies: &[SearchCookie],
    _domain: &str,
) -> Result<String, String> {
    Err("Google browser transport is unavailable in this build".into())
}

/// Fetch `url` over the configured transports and return the first parse that
/// holds organic results. The HTML is parsed once: the parse that proves a
/// transport worked is the parse the caller receives.
async fn fetch_serp(
    url: &Url,
    cookies: &[SearchCookie],
    options: &SearchOptions,
    query: &str,
) -> Result<(SerpContent, SearchTransport), String> {
    let transports: &[SearchTransport] = match options.transport {
        SearchTransport::Auto => &[SearchTransport::Fetch, SearchTransport::Http],
        SearchTransport::Fetch => &[SearchTransport::Fetch],
        SearchTransport::Http => &[SearchTransport::Http],
    };
    let mut last_error = String::new();
    for transport in transports {
        let response = match transport {
            SearchTransport::Fetch => native_fetch(url, cookies, &options.domain).await,
            SearchTransport::Http => browser_fetch(url, cookies, &options.domain).await,
            SearchTransport::Auto => unreachable!(),
        };
        match response {
            Ok(html) if !is_blocked_serp_html(&html) => {
                let content = parse_serp(&html, query);
                if !content.organic.is_empty() {
                    return Ok((content, *transport));
                }
                last_error = format!(
                    "transport {} returned HTML with no organic results: {} (bytes={}, h3_tags={})",
                    transport.as_str(),
                    empty_serp_reason(&html),
                    html.len(),
                    html.matches("<h3").count(),
                );
            }
            Ok(_) => {
                last_error = format!(
                    "transport {} returned blocked/empty response",
                    transport.as_str()
                )
            }
            Err(error) => last_error = error,
        }
    }
    Err(format!(
        "google search: all transports failed ({}): {last_error}",
        transports
            .iter()
            .map(|transport| transport.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

#[cfg(feature = "search-cache")]
fn cache_path() -> Option<PathBuf> {
    std::env::var_os("APHRODY_CACHE_FILE")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("APHRODY_HOME")
                .filter(|path| !path.is_empty())
                .map(|home| PathBuf::from(home).join("cache.sqlite"))
        })
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".aphrody/cache.sqlite"))
        })
}

#[cfg(feature = "search-cache")]
fn cache_connection() -> Result<Connection, String> {
    let path = cache_path().ok_or_else(|| "cannot resolve Aphrody cache path".to_owned())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, payload BLOB NOT NULL, is_json INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, compression INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);")
        .map_err(|error| error.to_string())?;
    let _ = connection.execute(
        "ALTER TABLE cache ADD COLUMN compression INTEGER NOT NULL DEFAULT 0",
        [],
    );
    Ok(connection)
}

#[cfg(feature = "search-cache")]
fn cache_get(key: &str) -> Option<RichSearchResult> {
    let connection = cache_connection().ok()?;
    let now = now_milliseconds();
    let mut statement = connection.prepare("SELECT payload FROM cache WHERE key=?1 AND expires_at>?2 AND is_json=1 AND compression=0").ok()?;
    let payload: Vec<u8> = statement
        .query_row(params![key, now], |row| row.get(0))
        .ok()?;
    serde_json::from_slice(&payload).ok()
}

#[cfg(feature = "search-cache")]
fn cache_set(key: &str, value: &RichSearchResult, ttl_ms: u64) -> Result<(), String> {
    let connection = cache_connection()?;
    let now = now_milliseconds();
    let expiry = now.saturating_add(i64::try_from(ttl_ms).unwrap_or(i64::MAX));
    let payload = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    connection.execute("INSERT OR REPLACE INTO cache (key,payload,is_json,created_at,expires_at,compression) VALUES (?1,?2,1,?3,?4,0)",
        params![key, payload, now, expiry]).map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM cache WHERE expires_at<?1", params![now])
        .map_err(|error| error.to_string())?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM cache", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if count > 10_000 {
        connection.execute("DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY created_at ASC LIMIT ?1)", params![count - 10_000]).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Run synchronous file or SQLite work on the blocking pool so it never stalls
/// the async executor that is driving other searches.
async fn blocking<T, F>(job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())
}

/// Fetch and parse a Google SERP with authenticated cookies when available.
pub async fn search_rich(query: &str, options: &SearchOptions) -> Result<RichSearchResult, String> {
    let url = search_url(query, options)?;
    let cookies = {
        let options = options.clone();
        blocking(move || search_cookies(&options)).await?
    };
    let authenticated = !cookies.is_empty();
    if options.require_authenticated && !authenticated {
        return Err("Google search authentication is unavailable".into());
    }
    #[cfg(not(feature = "search-cache"))]
    if options.cache_ttl_ms.is_some_and(|ttl| ttl > 0) {
        return Err("Google search cache is unavailable in this build".into());
    }
    #[cfg(feature = "search-cache")]
    let cache_key = format!("serp-rich:anonymous-v2:{url}");
    #[cfg(feature = "search-cache")]
    let cache_anonymous = !authenticated && options.cache_ttl_ms.is_some_and(|ttl| ttl > 0);
    #[cfg(feature = "search-cache")]
    if cache_anonymous {
        let key = cache_key.clone();
        // A failed lookup is a cache miss, never a failed search.
        if let Some(mut hit) = blocking(move || cache_get(&key)).await.ok().flatten() {
            hit.served_from_cache = true;
            return Ok(hit);
        }
    }
    let (mut content, profile_used) = fetch_serp(&url, &cookies, options, query).await?;
    if content.organic.is_empty() && options.udm.is_none() && !options.classic {
        let mut web_url = url.clone();
        web_url.query_pairs_mut().append_pair("udm", "14");
        if let Ok((web, _)) = fetch_serp(&web_url, &cookies, options, query).await
            && !web.organic.is_empty()
        {
            content.organic = web.organic;
            if content.total_results.is_none() {
                content.total_results = web.total_results;
            }
        }
    }
    let result = RichSearchResult {
        content,
        served_from_cache: false,
        profile_used,
        authenticated,
    };
    #[cfg(feature = "search-cache")]
    if cache_anonymous
        && !result.content.organic.is_empty()
        && let Some(ttl) = options.cache_ttl_ms
    {
        let key = cache_key.clone();
        let stored = result.clone();
        let _ = blocking(move || cache_set(&key, &stored, ttl)).await;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_query_parameters_and_domain_validation() {
        let options = SearchOptions {
            num: Some(10),
            hl: "fr".to_owned(),
            domain: "google.fr".to_owned(),
            ..Default::default()
        };
        let url = search_url("rust & bun", &options).unwrap();
        assert_eq!(url.host_str(), Some("www.google.fr"));
        assert!(
            url.query_pairs()
                .any(|(key, value)| key == "q" && value == "rust & bun")
        );
        assert!(
            url.query_pairs()
                .any(|(key, value)| key == "udm" && value == "14")
        );
        assert!(
            search_url(
                "x",
                &SearchOptions {
                    domain: "evil.example".to_owned(),
                    ..Default::default()
                }
            )
            .is_err()
        );
    }

    #[test]
    fn source_google_specialization_domain_matrix() {
        for domain in [
            "gemini.google.com",
            "geminicli.com",
            "antigravity.google",
            "design.google",
            "m3.material.io",
            "gemini.google",
        ] {
            assert!(is_google_domain(domain), "expected Google domain: {domain}");
        }
        for domain in [
            "google.com.attacker.invalid",
            "evilgoogle.com",
            "example.org",
        ] {
            assert!(
                !is_google_domain(domain),
                "unexpected Google domain: {domain}"
            );
        }
    }

    #[test]
    fn source_serp_retry_shell_is_blocked_but_organic_page_is_allowed() {
        let retry = r#"<html><title>Google Search</title><body><div id="yvlrue">If you're having trouble accessing Google Search</div><script>var x="SG_REL"</script></body></html>"#;
        let organic = r#"<html><body><div id="search"><div class="g"><a href="https://example.com"><h3>Example</h3></a></div></div></body></html>"#;
        assert!(is_blocked_serp_html(retry));
        assert!(!is_blocked_serp_html(organic));
    }

    #[test]
    fn cookie_jar_and_blocked_response_match_source_rules() {
        let jar = parse_cookies(
            r#"[{"name":"SID","value":"token","domain":".google.com","path":"/","secure":true}]"#,
        );
        let url = Url::parse("https://www.google.fr/search?q=x").unwrap();
        let header = cookie_header(&url, &jar, "google.fr");
        assert!(header.contains("SID=token"));
        assert!(header.contains("CONSENT="));
        assert!(header.contains("SOCS="));
        assert!(is_blocked_serp_html(
            "<title>Before you continue to Google</title>"
        ));
        assert!(!is_blocked_serp_html(
            "<div id='rso'><div class='MjjYud'></div></div>"
        ));
        let js_shell = format!(
            "<title>Google Search</title><noscript><a href='/httpservice/retry/enablejs'>enable JS</a></noscript>{}",
            "x".repeat(3000),
        );
        assert!(is_blocked_serp_html(&js_shell));
        assert_eq!(empty_serp_reason(&js_shell), "Google JavaScript bootstrap");
        assert_eq!(
            empty_serp_reason("<title>Before you continue</title>"),
            "Google consent interstitial",
        );
    }

    #[test]
    fn anonymous_overrides_explicit_cookie_file() {
        let path = std::env::temp_dir().join(format!(
            "aphrody-google-no-auth-{}-{}",
            std::process::id(),
            now_milliseconds(),
        ));
        std::fs::write(
            &path,
            r#"[{"name":"SID","value":"test","domain":".google.com"}]"#,
        )
        .unwrap();
        let options = SearchOptions {
            cookie_path: Some(path.clone()),
            ..Default::default()
        };
        assert_eq!(search_cookies(&options).len(), 1);
        let anonymous = SearchOptions {
            anonymous: true,
            ..options
        };
        assert!(search_cookies(&anonymous).is_empty());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn explicit_cookie_path_precedes_environment_default() {
        let explicit = PathBuf::from("/private/explicit.json");
        let configured = PathBuf::from("/private/google.json");
        assert_eq!(
            resolve_cookie_path(Some(&explicit), Some(configured.clone())),
            Some(explicit)
        );
        assert_eq!(
            resolve_cookie_path(None, Some(configured.clone())),
            Some(configured)
        );
        assert_eq!(resolve_cookie_path(None, None), None);
    }

    #[test]
    fn cookie_editor_expiry_and_domain_scope() {
        let json = format!(
            r#"[{{"name":"CURRENT","value":"ok","domain":".google.com","path":"/","secure":true,"expirationDate":{}}},{{"name":"EXPIRED","value":"old","domain":".google.com","expirationDate":1}},{{"name":"SESSION","value":"session","domain":"www.google.com","hostOnly":true,"session":true,"expirationDate":1}}]"#,
            now_seconds() + 3600
        );
        let jar = parse_cookies(&json);
        assert_eq!(jar.len(), 2);
        let root = cookie_header(
            &Url::parse("https://www.google.com/search").unwrap(),
            &jar,
            "google.com",
        );
        assert!(root.contains("CURRENT=ok"));
        assert!(root.contains("SESSION=session"));
        assert!(!root.contains("EXPIRED="));
        let subdomain = cookie_header(
            &Url::parse("https://news.www.google.com/search").unwrap(),
            &jar,
            "google.com",
        );
        assert!(subdomain.contains("CURRENT=ok"));
        assert!(!subdomain.contains("SESSION=session"));
    }

    #[test]
    #[ignore = "requires APHRODY_GOOGLE_COOKIES_JSON pointing to a local session file"]
    fn configured_cookie_file_loads_without_network() {
        let path = std::env::var_os("APHRODY_GOOGLE_COOKIES_JSON")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .expect("configured Google cookie path");
        assert_eq!(default_cookie_path(), Some(path));
        let jar = search_cookies(&SearchOptions::default());
        assert!(jar.iter().any(|cookie| cookie.name == "SID"));
    }

    #[test]
    #[cfg(feature = "search-cache")]
    fn cache_round_trips_source_response_without_network() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE cache (key TEXT PRIMARY KEY, payload BLOB NOT NULL, is_json INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, compression INTEGER NOT NULL);").unwrap();
        let content = parse_serp(
            "<div class='g'><a href='https://example.org'><h3>A</h3></a></div>",
            "a",
        );
        let result = RichSearchResult {
            content,
            served_from_cache: false,
            profile_used: SearchTransport::Fetch,
            authenticated: false,
        };
        let payload = serde_json::to_vec(&result).unwrap();
        connection
            .execute(
                "INSERT INTO cache VALUES (?1,?2,1,0,9999999999999,0)",
                params!["key", payload],
            )
            .unwrap();
        let decoded: Vec<u8> = connection
            .query_row(
                "SELECT payload FROM cache WHERE key=?1",
                params!["key"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<RichSearchResult>(&decoded).unwrap(),
            result
        );
    }

    #[tokio::test]
    #[ignore = "requires live Google Search access"]
    async fn live_search_never_reports_empty_organic_as_success() {
        let options = SearchOptions {
            anonymous: true,
            num: Some(3),
            ..Default::default()
        };
        match search_rich("rust language", &options).await {
            Ok(result) => assert!(!result.content.organic.is_empty()),
            Err(error) => crate::search::output::print_errorln(format_args!("Google Search unavailable: {error}")),
        }
    }
}

#[cfg(test)]
mod redirect_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn forbidden_redirect_is_refused_before_destination_network_activity() {
        let source = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let forbidden = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let destination = format!("http://{}/private", forbidden.local_addr().unwrap());
        let url = format!("http://{}/search", source.local_addr().unwrap());
        let serve = tokio::spawn(async move {
            let (mut socket, _) = source.accept().await.unwrap();
            let mut input = [0u8; 4096];
            socket.read(&mut input).await.unwrap();
            socket.write_all(format!("HTTP/1.1 302 Found\r\nLocation: {destination}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
        });
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(search_redirect_policy())
            .build()
            .unwrap();
        assert!(client.get(url).send().await.is_err());
        serve.await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(25), forbidden.accept())
                .await
                .is_err()
        );
    }
}
