// SPDX-License-Identifier: Apache-2.0
//! Bounded, in-process crawl over the shared Rust frontier.

use std::{
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use aphrody_web::{
    AddRequest, BunBrowserTransport, CrawlOptions, Frontier, FrontierOptions, PlaywrightTransport,
    crawl_bounded,
};
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};

const MAX_PAGE_RESULTS: u64 = 100;
const MAX_ERROR_RESULTS: usize = 50;
const CRAWL_TIMEOUT: Duration = Duration::from_secs(120);

static TOOL: LazyLock<Tool> = LazyLock::new(|| {
    serde_json::from_value(json!({
    "name": "aphrody_web_crawl",
    "description": "Run one bounded Rust crawl pass with optional persistent SQLite frontier, domain limits, robots checks and sitemap discovery. Returns page summaries and frontier statistics.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "urls": { "type": "array", "items": { "type": "string", "format": "uri" }, "minItems": 1, "maxItems": 100 },
            "sqlitePath": { "type": "string", "description": "Optional persistent SQLite frontier path." },
            "allowedDomains": { "type": "array", "items": { "type": "string" }, "maxItems": 100 },
            "maxDepth": { "type": "integer", "minimum": 0, "maximum": 20, "default": 2 },
            "maxRequests": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 25 },
            "concurrency": { "type": "integer", "minimum": 1, "maximum": 32, "default": 4 },
            "resultLimit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 50 },
            "browser": { "type": "string", "enum": ["native", "playwright"], "default": "native", "description": "Use native Obscura or Playwright through the local Obscura CDP bridge." },
            "obeyRobots": { "type": "boolean", "default": true },
            "sitemaps": { "type": "boolean", "default": false }
        },
        "required": ["urls"],
        "additionalProperties": false
    }
})).expect("static crawl tool schema")
});

pub(crate) fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    if taken(TOOL.name.as_ref()) {
        Vec::new()
    } else {
        vec![TOOL.clone()]
    }
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    (TOOL.name == name).then(|| TOOL.clone())
}

pub(crate) fn owns(name: &str) -> bool {
    TOOL.name == name
}

fn count(args: &Value, name: &str, default: u64, min: u64, max: u64) -> Result<u64, String> {
    let Some(value) = args.get(name) else {
        return Ok(default);
    };
    value
        .as_u64()
        .filter(|value| (min..=max).contains(value))
        .ok_or_else(|| format!("{name} must be an integer from {min} to {max}"))
}

fn flag(args: &Value, name: &str, default: bool) -> Result<bool, String> {
    args.get(name).map_or(Ok(default), |value| {
        value
            .as_bool()
            .ok_or_else(|| format!("{name} must be a boolean"))
    })
}

fn parse_urls(args: &Value) -> Result<Vec<String>, String> {
    let entries = args
        .get("urls")
        .and_then(Value::as_array)
        .ok_or("urls must be an array")?;
    if entries.is_empty() || entries.len() > 100 {
        return Err("urls must contain 1 to 100 entries".into());
    }
    entries
        .iter()
        .map(|entry| {
            let raw = entry.as_str().ok_or("each URL must be a string")?;
            let url = reqwest::Url::parse(raw).map_err(|error| format!("invalid URL: {error}"))?;
            if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
                return Err(format!("crawl seed must be HTTP or HTTPS: {raw}"));
            }
            Ok(url.to_string())
        })
        .collect()
}

async fn run(args: &Value) -> Result<Value, String> {
    let urls = parse_urls(args)?;
    let mut allowed_domains = args.get("allowedDomains").map_or(Ok(Vec::new()), |value| {
        let domains = value.as_array().ok_or("allowedDomains must be an array")?;
        if domains.len() > 100 {
            return Err("allowedDomains must contain no more than 100 entries");
        }
        domains
            .iter()
            .map(|entry| {
                entry
                    .as_str()
                    .filter(|name| !name.is_empty())
                    .map(str::to_owned)
                    .ok_or("allowedDomains entries must be non-empty strings")
            })
            .collect::<Result<Vec<_>, _>>()
    })?;
    if allowed_domains.is_empty() {
        for seed in &urls {
            let url = reqwest::Url::parse(seed).map_err(|error| error.to_string())?;
            let host = url.host_str().ok_or("seed has no hostname")?;
            if !allowed_domains.iter().any(|name| name == host) {
                allowed_domains.push(host.to_owned());
            }
        }
    }
    let sqlite_path = args
        .get("sqlitePath")
        .map(|value| {
            value
                .as_str()
                .filter(|path| !path.is_empty())
                .ok_or("sqlitePath must be a non-empty string")
        })
        .transpose()?;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let now_ms = i64::try_from(now_ms).unwrap_or(i64::MAX);
    let mut frontier = if let Some(path) = sqlite_path {
        Frontier::open(path, FrontierOptions::default(), now_ms)
    } else {
        Frontier::memory(FrontierOptions::default())
    }
    .map_err(|error| error.to_string())?;
    for url in &urls {
        frontier
            .enqueue(AddRequest::seed(url), now_ms)
            .map_err(|error| error.to_string())?;
    }
    let options = CrawlOptions {
        max_depth: count(args, "maxDepth", 2, 0, 20)? as u32,
        max_requests: count(args, "maxRequests", 25, 1, 1000)? as usize,
        max_concurrency: count(args, "concurrency", 4, 1, 32)? as usize,
        allowed_domains,
        obey_robots: flag(args, "obeyRobots", true)?,
        ingest_sitemaps: flag(args, "sitemaps", false)?,
        ..CrawlOptions::default()
    };
    let result_limit = count(args, "resultLimit", 50, 1, MAX_PAGE_RESULTS)? as usize;
    let browser = args.get("browser").map_or(Ok("native"), |value| {
        value.as_str().ok_or("browser must be a string")
    })?;
    let crawl = async {
        match browser {
            "native" => crawl_bounded(&mut frontier, &BunBrowserTransport::default(), &options)
                .await
                .map_err(|error| error.to_string()),
            "playwright" => {
                let transport =
                    PlaywrightTransport::connect(options.allowed_domains.clone()).await?;
                crawl_bounded(&mut frontier, &transport, &options)
                    .await
                    .map_err(|error| error.to_string())
            }
            _ => Err("browser must be native or playwright".into()),
        }
    };
    let report = tokio::time::timeout(CRAWL_TIMEOUT, crawl)
        .await
        .map_err(|_| {
            format!(
                "crawl exceeded the {} second tool budget",
                CRAWL_TIMEOUT.as_secs()
            )
        })?
        .map_err(|error| error.to_string())?;
    let page_count = report.pages.len();
    let error_count = report.errors.len();
    Ok(json!({
        "attempts": report.attempts,
        "pagesFound": page_count,
        "pagesReturned": page_count.min(result_limit),
        "pagesTruncated": page_count > result_limit,
        "pages": report.pages.iter().take(result_limit).map(|page| json!({
            "url": page.url, "depth": page.depth, "status": page.status,
            "title": page.extracted.title, "wordCount": page.extracted.word_count,
            "duplicate": page.duplicate, "discoveredLinks": page.discovered_links,
        })).collect::<Vec<_>>(),
        "exactDuplicates": report.exact_duplicates,
        "nearDuplicates": report.near_duplicates,
        "errors": report.errors.iter().take(MAX_ERROR_RESULTS).collect::<Vec<_>>(),
        "errorsFound": error_count,
        "errorsTruncated": error_count > MAX_ERROR_RESULTS,
        "robotsFetched": report.robots_fetched,
        "robotsBlocked": report.robots_blocked,
        "sitemapsFetched": report.sitemaps_fetched,
        "sitemapUrlsEnqueued": report.sitemap_urls_enqueued,
        "frontier": {
            "pending": report.frontier.pending, "locked": report.frontier.locked,
            "done": report.frontier.done, "failed": report.frontier.failed,
        }
    }))
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let args = request
        .arguments
        .as_ref()
        .map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    match run(&args).await {
        Ok(value) => {
            let mut result = CallToolResult::success(vec![ContentBlock::text(value.to_string())]);
            result.structured_content = Some(value);
            result
        }
        Err(error) => CallToolResult::error(vec![ContentBlock::text(format!(
            "aphrody_web_crawl: {error}"
        ))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bounds_and_protocol_without_network() {
        assert!(owns("aphrody_web_crawl"));
        assert_eq!(
            parse_urls(&json!({"urls": ["https://example.com/"]}))
                .unwrap()
                .len(),
            1
        );
        assert!(parse_urls(&json!({"urls": ["file:///tmp/a"]})).is_err());
        assert!(parse_urls(&json!({"urls": []})).is_err());
        assert!(count(&json!({"maxRequests": 1001}), "maxRequests", 25, 1, 1000).is_err());
        assert!(
            count(
                &json!({"resultLimit": 101}),
                "resultLimit",
                50,
                1,
                MAX_PAGE_RESULTS
            )
            .is_err()
        );
        assert!(flag(&json!({"obeyRobots": "yes"}), "obeyRobots", true).is_err());
    }

    #[test]
    fn result_schema_is_small_and_bounded() {
        let serialized = serde_json::to_value(get("aphrody_web_crawl").unwrap()).unwrap();
        let schema = &serialized["inputSchema"]["properties"];
        assert_eq!(schema["resultLimit"]["maximum"], 100);
        assert_eq!(schema["allowedDomains"]["maxItems"], 100);
        assert_eq!(schema["urls"]["maxItems"], 100);
    }
}
