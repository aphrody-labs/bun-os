// SPDX-License-Identifier: Apache-2.0
//! Canonical Rust Web commands behind `aphrody web`.

use clap::{Parser, Subcommand, ValueEnum};
use miette::{IntoDiagnostic, miette};
use std::time::Duration;

#[path = "web_crawl_index.rs"]
mod crawl_index;

#[path = "web_design_sync.rs"]
mod design_sync;

/// Execute the product Web ingestion pipeline in process, without printing or
/// invoking the command facade. FFI and CLI share the same typed owners.
pub async fn run_web_pipeline(args: Vec<String>) -> miette::Result<serde_json::Value> {
    #[derive(Parser)]
    struct PipelineRequest {
        #[command(subcommand)]
        action: WebAction,
    }
    let request = PipelineRequest::try_parse_from(std::iter::once("web".to_owned()).chain(args))
        .map_err(|error| miette!("invalid Web pipeline arguments: {error}"))?;
    obscura_net::ensure_rustls_crypto_provider();
    match request.action {
        WebAction::CrawlIndex(args) => {
            serde_json::to_value(crawl_index::run(args).await?).into_diagnostic()
        }
        WebAction::DesignSync(args) => design_sync::run(args).await,
        _ => Err(miette!(
            "Web pipeline accepts crawl-index and design-sync actions"
        )),
    }
}

#[derive(Debug, Subcommand)]
pub(crate) enum WebAction {
    /// Acquire Google Design/M3 reference data, index it, and generate native themes
    DesignSync(design_sync::DesignSyncArgs),
    /// Inspect the linked Rust Web runtime
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// List the linked Rust Web capabilities
    Capabilities {
        /// Emit capabilities as JSON
        #[arg(long)]
        json: bool,
    },
    /// Fetch and convert a URL directly to clean Markdown
    Fetch {
        /// The URL to fetch and convert
        url: String,
        /// Fetch profile: static, http, fast, stealth or max
        #[arg(long)]
        profile: Option<String>,
        /// Emit the complete fetch result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Search the Google Web index with the shared Rust SERP client
    Search {
        /// Search terms
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
        /// Results per page (1..100)
        #[arg(long)]
        num: Option<u8>,
        /// One-based results page
        #[arg(long, conflicts_with = "start")]
        page: Option<u32>,
        /// Zero-based result offset
        #[arg(long)]
        start: Option<u32>,
        /// Interface language
        #[arg(long, default_value = "en")]
        hl: String,
        /// Region bias
        #[arg(long, default_value = "US")]
        gl: String,
        /// Google search domain
        #[arg(long, default_value = "google.com")]
        domain: String,
        /// Enable SafeSearch
        #[arg(long)]
        safe: bool,
        /// Include rich SERP modules
        #[arg(long)]
        rich: bool,
        /// Render Markdown instead of plain text
        #[arg(long, conflicts_with = "json")]
        markdown: bool,
        /// Emit the structured result as JSON
        #[arg(long)]
        json: bool,
        /// Google transport
        #[arg(long, value_enum, default_value_t = WebSearchTransport::Auto)]
        transport: WebSearchTransport,
        /// Cookie-Editor jar for Google auth
        #[arg(long, conflicts_with = "no_auth")]
        cookies: Option<std::path::PathBuf>,
        /// Force anonymous search
        #[arg(long)]
        no_auth: bool,
    },
    /// One-shot page reconnaissance with linked Rust HTTP and DOM engines
    Recon {
        url: String,
        #[arg(long, default_value = "static")]
        profile: String,
        #[arg(long)]
        json: bool,
        /// Write report to a file
        #[arg(short, long)]
        output: Option<std::path::PathBuf>,
    },
    /// Extract CSS-selected text or an entire page
    Scrape {
        url: String,
        selector: Option<String>,
        #[arg(long, default_value = "static")]
        profile: String,
        #[arg(long, default_value_t = 50)]
        max: usize,
        #[arg(long, conflicts_with = "html")]
        markdown: bool,
        #[arg(long)]
        html: bool,
    },
    /// Extract main content and metadata from a page
    Extract {
        url: String,
        #[arg(long, default_value = "http")]
        profile: String,
        #[arg(long)]
        json: bool,
    },
    /// Detect site technologies and anti-bot challenges with the shared Rust engine
    Detect {
        url: String,
        #[arg(long)]
        json: bool,
    },
    /// Ask Gemini through the shared authenticated Rust Web client
    Gemini {
        #[arg(required = true, num_args = 1..)]
        prompt: Vec<String>,
        #[arg(long)]
        model: Option<String>,
        #[arg(long, default_value = "en")]
        language: String,
        #[arg(long)]
        cookies: Option<std::path::PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Read X profiles, timelines, search and news with cookie authentication
    X {
        /// X cookie pair; defaults to the session file or environment
        #[arg(long, global = true)]
        cookie: Option<String>,
        #[command(subcommand)]
        action: WebXAction,
    },
    /// Extract direct media URLs or HLS variants from a page
    Media {
        #[command(subcommand)]
        action: WebMediaAction,
    },
    /// Inspect a page through the shared native browser session
    Browser {
        #[command(subcommand)]
        action: WebBrowserAction,
    },
    /// Crawl a bounded set of pages through the shared Rust frontier
    Crawl {
        /// Seed URLs
        #[arg(required = true, num_args = 1..)]
        urls: Vec<String>,
        /// Persist the frontier and extracted pages in SQLite
        #[arg(long)]
        sqlite: Option<std::path::PathBuf>,
        /// Maximum link depth from seed pages
        #[arg(long, default_value_t = 5)]
        max_depth: u32,
        /// Maximum attempted requests in this run
        #[arg(long, default_value_t = 25)]
        max_requests: usize,
        /// Concurrent HTTP requests
        #[arg(long, default_value_t = 4)]
        concurrency: usize,
        /// Restrict discovered links to these domains
        #[arg(long, value_delimiter = ',')]
        allowed_domains: Vec<String>,
        /// Include only discovered URLs matching these regular expressions (repeatable)
        #[arg(long = "include-url-regex")]
        include_url_regex: Vec<String>,
        /// Reject discovered URLs matching these regular expressions (repeatable)
        #[arg(long = "exclude-url-regex")]
        exclude_url_regex: Vec<String>,
        /// Minimum delay between requests to one host
        #[arg(long, default_value_t = 0)]
        per_host_delay: i64,
        /// Maximum concurrent requests to one host
        #[arg(long, default_value_t = 8)]
        max_per_host: u32,
        /// Retry budget for failed requests
        #[arg(long, default_value_t = 3)]
        max_retries: u32,
        /// Respect robots.txt disallow and crawl delay
        #[arg(long)]
        obey_robots: bool,
        /// Discover seeds from site sitemaps
        #[arg(long)]
        sitemaps: bool,
        /// Maximum sitemap documents per crawl
        #[arg(long, default_value_t = 25)]
        max_sitemaps: usize,
        /// Prioritize links relevant to this goal
        #[arg(long)]
        goal: Option<String>,
        /// Schedule revisits in a persistent frontier
        #[arg(long)]
        revisit: bool,
        /// Run continuously as a 24/7 background crawl daemon
        #[arg(long)]
        daemon: bool,
        /// Emit a structured report
        #[arg(long)]
        json: bool,
    },
    /// Crawl into a private persistent frontier and index the selected home in process
    CrawlIndex(crawl_index::CrawlIndexArgs),
    /// Enumerate and extract pages through a MediaWiki Action API
    Mediawiki {
        /// Action API endpoint, such as https://example.org/w/api.php
        #[arg(long)]
        api_url: String,
        /// Article path with $1 as the encoded title
        #[arg(long, default_value = "/wiki/$1")]
        article_path: String,
        /// Restrict titles to this prefix
        #[arg(long)]
        prefix: Option<String>,
        /// Include article URLs matching these expressions (repeatable)
        #[arg(long = "include-url-regex")]
        include_url_regex: Vec<String>,
        /// Exclude article URLs matching these expressions (repeatable)
        #[arg(long = "exclude-url-regex")]
        exclude_url_regex: Vec<String>,
        /// Maximum documents to return (hard capped by the library)
        #[arg(long, default_value_t = 200)]
        max_pages: usize,
        /// Titles per allpages API request
        #[arg(long, default_value_t = 50)]
        batch_size: usize,
        /// Minimum interval between API requests, in milliseconds
        #[arg(long, default_value_t = 250)]
        request_interval_ms: u64,
    },
    /// Mirror HTML pages and their linked CSS/assets through Obscura
    Mirror {
        /// Seed page URL
        url: String,
        /// Local mirror destination
        output_dir: std::path::PathBuf,
        /// Follow in-scope page links recursively
        #[arg(long)]
        recursive: bool,
        /// Maximum HTML pages, including the seed
        #[arg(long, default_value_t = 100)]
        max_pages: usize,
        /// Maximum linked non-HTML resources
        #[arg(long, default_value_t = 2000)]
        max_assets: usize,
        /// Maximum page-link depth from the seed
        #[arg(long, default_value_t = 3)]
        max_depth: u32,
        /// Concurrent HTTP requests
        #[arg(long, default_value_t = 4)]
        concurrency: usize,
        /// Minimum delay between request starts, in milliseconds
        #[arg(long, default_value_t = 500)]
        delay_ms: u64,
        /// Restrict followed page links (comma-separated hostnames)
        #[arg(long, value_delimiter = ',')]
        allowed_domains: Vec<String>,
        /// Follow common CDN hostnames, or provide an explicit comma-separated host list
        #[arg(long, default_value = "false")]
        resolve_cdns: String,
        /// Optional HTTP/SOCKS proxy passed to Obscura
        #[arg(long)]
        proxy: Option<String>,
        /// Emit a structured report
        #[arg(long)]
        json: bool,
    },
    /// Search a MediaWiki installation through its Action API
    WikiSearch {
        /// Action API endpoint, such as https://example.org/w/api.php
        api_url: String,
        /// Search terms
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
        /// Maximum results (1..100)
        #[arg(long, default_value_t = 20)]
        limit: usize,
        /// Emit a structured JSON array
        #[arg(long)]
        json: bool,
    },
    /// Read a complete MediaWiki page dossier or Markdown through the Action API
    WikiPage {
        /// Article URL (/wiki/title or ?title=title)
        url: String,
        /// Action API endpoint for this wiki
        #[arg(long)]
        api_url: String,
        /// Return only Markdown, without image-information batches
        #[arg(long)]
        markdown: bool,
        /// Include Markdown and wikitext in the dossier
        #[arg(long)]
        include_content: bool,
        /// Skip resolving original images
        #[arg(long)]
        no_images: bool,
        #[arg(long)]
        json: bool,
    },
    /// MPEG-7 frame vectors, SQLite indexing and local/trace.moe search
    Frames {
        #[command(subcommand)]
        action: WebFramesAction,
    },
}

#[derive(Debug, Subcommand)]
pub(crate) enum WebFramesAction {
    Vector {
        path: std::path::PathBuf,
        #[arg(long)]
        at: Option<String>,
        #[arg(long)]
        json: bool,
    },
    Search {
        path: std::path::PathBuf,
        #[arg(long, group = "mode")]
        local: bool,
        #[arg(long, group = "mode")]
        remote: bool,
        #[arg(long, group = "mode")]
        auto: bool,
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long)]
        anilist_id: Option<i64>,
        #[arg(long)]
        at: Option<String>,
        #[arg(long)]
        json: bool,
    },
    Stats {
        #[arg(long)]
        json: bool,
    },
    List {
        filter: Option<String>,
        #[arg(long)]
        json: bool,
    },
    Quota {
        #[arg(long)]
        json: bool,
    },
    Index {
        path: std::path::PathBuf,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        season: Option<i64>,
        #[arg(long)]
        episode: Option<i64>,
        #[arg(long, default_value_t = 1.0)]
        fps: f64,
        #[arg(long)]
        force: bool,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum WebSearchTransport {
    Auto,
    Fetch,
    Http,
}

#[derive(Debug, Subcommand)]
pub(crate) enum WebXAction {
    Profile {
        handle: String,
    },
    Tweets {
        handle: String,
        #[arg(long, short = 'n', default_value_t = 20)]
        count: u32,
    },
    Search {
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
        #[arg(long, short = 'n', default_value_t = 20)]
        count: u32,
    },
    News {
        #[arg(long, short = 'n', default_value_t = 20)]
        count: usize,
    },
    Whoami,
}

#[derive(Debug, Subcommand)]
pub(crate) enum WebMediaAction {
    /// Resolve an embed page into video candidates
    Resolve {
        url: String,
        /// Referer sent to the host when required
        #[arg(long)]
        referer: Option<String>,
        /// Enumerate variants from an HLS master playlist
        #[arg(long)]
        variants: bool,
        /// Timeout for each request in milliseconds
        #[arg(long, default_value_t = 30_000)]
        timeout_ms: u64,
    },
    /// Parse variants from a known HLS master playlist
    Variants {
        url: String,
        #[arg(long)]
        referer: Option<String>,
        #[arg(long, default_value_t = 30_000)]
        timeout_ms: u64,
    },
}

#[derive(Debug, Subcommand)]
pub(crate) enum WebBrowserAction {
    /// Navigate and capture a readable snapshot in the same browser session
    Snapshot {
        url: String,
        #[arg(long)]
        json: bool,
    },
}

pub(crate) async fn handle_web(action: WebAction) -> miette::Result<()> {
    match action {
        WebAction::DesignSync(args) => print_web_json(&design_sync::run(args).await?)?,
        WebAction::Status { json } => {
            let status = serde_json::json!({
                "layer": "web",
                "status": "ready",
                "runtime": "shared-rust",
                "components": {
                    "dom": "linked",
                    "http": "linked",
                    "browser": "linked",
                    "search": "linked",
                    "crawler": "linked",
                    "media": "linked",
                    "gemini": "linked",
                    "x": "linked",
                },
                "network": "unchecked",
            });
            if json {
                print_web_json(&status)?;
            } else {
                println!(
                    "Aphrody Web: {} (shared Rust; network unchecked)",
                    status["status"].as_str().unwrap_or("unknown")
                );
            }
        }
        WebAction::Capabilities { json } => {
            let capabilities = [
                "http-fetch",
                "obscura-browser",
                "dom-extract",
                "markdown",
                "dns",
                "google-search",
                "recon",
                "scrape",
                "main-content-extract",
                "gemini-web",
                "x-read",
                "media-resolve",
                "hls-variants",
                "native-browser-snapshot",
                "bounded-crawl",
                "persistent-crawl-index",
                "crawl-redirect-allowlist-before-network",
                "crawl-url-regex-filters",
                "structured-crawl-extraction",
                "robots",
                "sitemaps",
                "revisits",
                "goal-priority",
            ];
            if json {
                print_web_json(&serde_json::json!({
                    "layer": "web", "runtime": "shared-rust", "capabilities": capabilities
                }))?;
            } else {
                for capability in capabilities {
                    println!("{capability}");
                }
            }
        }
        WebAction::Fetch { url, profile, json } => {
            let mut request = aphrody_web_service::fetch::Request::new(url);
            if let Some(name) = profile {
                let selected = aphrody_web_service::fetch::Profile::parse(&name)
                    .ok_or_else(|| miette!("unknown Web profile: {name}"))?;
                request = request.with_profile(selected);
            }
            let result = aphrody_web_service::fetch::fetch(&request)
                .await
                .into_diagnostic()?;
            if result.body.trim().is_empty() {
                eprintln!(
                    "{}",
                    serde_json::json!({
                        "event": "web.fetch.empty",
                        "url": result.url,
                        "profileRequested": result.profile_requested,
                        "profileObtained": result.profile_obtained,
                        "error": "fetch produced no content"
                    })
                );
                return Err(miette!("fetch produced no content"));
            }
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&result).into_diagnostic()?
                );
            } else {
                println!("{}", result.to_report());
            }
        }
        WebAction::Search {
            query,
            num,
            page,
            start,
            hl,
            gl,
            domain,
            safe,
            rich,
            markdown,
            json,
            transport,
            cookies,
            no_auth,
        } => {
            use aphrody_google::search::{SearchOptions, SearchTransport};
            let query = query.join(" ");
            let start = match (page, start) {
                (Some(0), _) => return Err(miette!("--page must be at least 1")),
                (Some(page), _) => Some((page - 1).saturating_mul(u32::from(num.unwrap_or(10)))),
                (_, start) => start,
            };
            let transport = match transport {
                WebSearchTransport::Auto => SearchTransport::Auto,
                WebSearchTransport::Fetch => SearchTransport::Fetch,
                WebSearchTransport::Http => SearchTransport::Http,
            };
            let options = SearchOptions {
                hl,
                gl,
                num,
                start,
                domain,
                safe: safe.then(|| "active".to_owned()),
                classic: !rich,
                cookie_path: cookies,
                transport,
                anonymous: no_auth,
                ..SearchOptions::default()
            };
            let result = aphrody_google::search::search_rich(&query, &options)
                .await
                .map_err(|error| miette!("Google Search: {error}"))?;
            if json {
                let mut value = serde_json::to_value(&result).into_diagnostic()?;
                value.as_object_mut().map(|value| value.remove("jsonLd"));
                print_web_json(&value)?;
            } else if markdown {
                println!(
                    "# Search: {query}\n\n## Results ({})\n",
                    result.content.organic.len()
                );
                if let Some(corrected) = &result.content.corrected_query {
                    println!("> Showing results for **{corrected}**\n");
                }
                if let Some(snippet) = &result.content.featured_snippet {
                    println!("## Featured snippet\n\n**{}**\n", snippet.title);
                    if !snippet.content.is_empty() {
                        println!("{}\n", snippet.content);
                    }
                    if !snippet.url.is_empty() {
                        println!("Source: {}\n", snippet.url);
                    }
                }
                if let Some(panel) = &result.content.knowledge_panel {
                    println!("## {}\n", panel.title);
                    if !panel.description.is_empty() {
                        println!("{}\n", panel.description);
                    }
                    for (name, value) in &panel.metadata {
                        println!("- **{name}**: {value}");
                    }
                    println!();
                }
                for hit in &result.content.organic {
                    println!("{}. [{}]({})", hit.position, hit.title, hit.url);
                    if !hit.snippet.is_empty() {
                        println!("   {}", hit.snippet);
                    }
                }
                if !result.content.people_also_ask.is_empty() {
                    println!("\n## People also ask\n");
                    for question in &result.content.people_also_ask {
                        println!("- {question}");
                    }
                }
                if !result.content.related_searches.is_empty() {
                    println!("\n## Related searches\n");
                    for related in &result.content.related_searches {
                        println!("- {related}");
                    }
                }
            } else {
                if let Some(corrected) = &result.content.corrected_query {
                    println!("(showing results for \"{corrected}\")\n");
                }
                if let Some(snippet) = &result.content.featured_snippet
                    && !snippet.content.is_empty()
                {
                    println!("★ {}\n  {}\n", snippet.title, snippet.content);
                }
                for hit in &result.content.organic {
                    println!("{}. {}\n   {}", hit.position, hit.title, hit.url);
                    if !hit.snippet.is_empty() {
                        println!("   {}", hit.snippet);
                    }
                    println!();
                }
                let total = result
                    .content
                    .total_results
                    .map_or_else(String::new, |count| format!(" · ~{count} results"));
                println!(
                    "[{} parsed{} · {:?}{}]",
                    result.content.organic.len(),
                    total,
                    result.profile_used,
                    if result.authenticated { " · auth" } else { "" }
                );
            }
            if result.content.organic.is_empty() {
                return Err(miette!("Google Search returned no organic results"));
            }
        }
        WebAction::Recon {
            url,
            profile,
            json,
            output,
        } => {
            let page = fetch_web_page(&url, &profile).await?;
            let dom = ParsedPage::parse(&page.html);
            let extracted = aphrody_web_extract::extract_main(&page.html, Some(&page.final_url));
            let report = serde_json::json!({
                "schema": "aphrody-recon-v1",
                "url": url,
                "finalUrl": page.final_url,
                "httpStatus": page.status,
                "bytes": page.html.len(),
                "profile": profile,
                "profileRequested": page.profile_requested,
                "profileObtained": page.profile_obtained,
                "title": extracted.title,
                "description": extracted.description,
                "canonical": extracted.canonical,
                "wordCount": extracted.word_count,
                "scripts": dom.count("script[src]")?,
                "stylesheets": dom.count("link[rel=stylesheet]")?,
                "images": dom.count("img[src]")?,
            });
            let rendered = if json {
                serde_json::to_string_pretty(&report).into_diagnostic()?
            } else {
                format!(
                    "# Recon: {}\n\n- Final URL: {}\n- HTTP: {}\n- Profile requested: {}\n- Profile obtained: {}\n- Title: {}\n- Canonical: {}\n- Words: {}\n- Scripts: {}\n- Stylesheets: {}\n- Images: {}\n",
                    url,
                    report["finalUrl"].as_str().unwrap_or("unknown"),
                    report["httpStatus"]
                        .as_u64()
                        .map_or_else(|| "unavailable".to_owned(), |n| n.to_string()),
                    report["profileRequested"].as_str().unwrap_or("unknown"),
                    report["profileObtained"].as_str().unwrap_or("unknown"),
                    report["title"].as_str().unwrap_or(""),
                    report["canonical"].as_str().unwrap_or(""),
                    report["wordCount"],
                    report["scripts"],
                    report["stylesheets"],
                    report["images"]
                )
            };
            if let Some(path) = output {
                std::fs::write(&path, rendered).into_diagnostic()?;
                println!("{}", path.display());
            } else {
                println!("{rendered}");
            }
        }
        WebAction::Scrape {
            url,
            selector,
            profile,
            max,
            markdown,
            html,
        } => {
            if !markdown && !html && selector.is_none() {
                return Err(miette!(
                    "scrape requires a CSS selector, --markdown, or --html"
                ));
            }
            let page = fetch_web_page(&url, &profile).await?;
            if html {
                println!("{}", page.html);
            } else if markdown {
                let result =
                    aphrody_web_extract::html_to_markdown(&page.html, Some(&page.final_url));
                if result.trim().is_empty() {
                    return Err(miette!("page produced empty Markdown"));
                }
                println!("{result}");
            } else if let Some(selector) = selector {
                let dom = ParsedPage::parse(&page.html);
                let mut rows = Vec::new();
                for (index, text) in dom
                    .texts(&selector)?
                    .into_iter()
                    .filter(|text| !text.trim().is_empty())
                    .take(max)
                    .enumerate()
                {
                    let text = text.trim().chars().take(500).collect::<String>();
                    rows.push(serde_json::json!({"index": index, "text": text}));
                }
                if rows.is_empty() {
                    eprintln!(
                        "{}",
                        serde_json::json!({
                            "event": "web.scrape.empty",
                            "url": page.final_url,
                            "selector": selector,
                            "profileRequested": page.profile_requested,
                            "profileObtained": page.profile_obtained,
                            "error": "selector matched no content"
                        })
                    );
                    return Err(miette!("scrape selector {selector:?} matched no content"));
                }
                print_web_json(&serde_json::Value::Array(rows))?;
            }
            eprintln!(
                "{}",
                serde_json::json!({
                    "event": "web.scrape.profile",
                    "profileRequested": page.profile_requested,
                    "profileObtained": page.profile_obtained
                })
            );
        }
        WebAction::Extract { url, profile, json } => {
            let page = fetch_web_page(&url, &profile).await?;
            let extracted = aphrody_web_extract::extract_main(&page.html, Some(&page.final_url));
            if extracted.markdown.trim().is_empty() {
                return Err(miette!("page produced no main content"));
            }
            if json {
                print_web_json(&serde_json::to_value(extracted).into_diagnostic()?)?;
            } else {
                println!("{}", extracted.markdown);
            }
        }
        WebAction::Detect { url, json } => {
            let report = aphrody_web_detect::detect_url(&url)
                .await
                .map_err(|error| miette!("Web detection: {error}"))?;
            if json {
                print_web_json(&serde_json::to_value(report).into_diagnostic()?)?;
            } else {
                println!("{} [{}]", report.final_url, report.http_status);
                for finding in &report.findings {
                    println!(
                        "- {} ({:?}, {:.0}%): {}",
                        finding.name,
                        finding.bucket,
                        finding.confidence * 100.0,
                        finding.evidence
                    );
                }
                println!("Challenge: {:?}", report.challenge);
                println!("Suggested profile: {:?}", report.strategy.profile);
            }
        }
        WebAction::Gemini {
            prompt,
            model,
            language,
            cookies,
            json,
        } => {
            use aphrody_google::gemini_web::GeminiWebClient;
            let cookie_path = cookies.or_else(default_gemini_cookie_path);
            let client = if let Some(path) = cookie_path {
                GeminiWebClient::from_cookie_file(path, &language)
                    .await
                    .into_diagnostic()?
            } else {
                GeminiWebClient::from_default_cookie_file(&language)
                    .await
                    .into_diagnostic()?
            };
            let reply = client
                .ask(&prompt.join(" "), model.as_deref())
                .await
                .into_diagnostic()?;
            if json {
                print_web_json(&serde_json::to_value(reply).into_diagnostic()?)?;
            } else {
                println!("{}", reply.text);
            }
        }
        WebAction::X { cookie, action } => handle_web_x(cookie, action).await?,
        WebAction::Media { action } => handle_web_media(action).await?,
        WebAction::Browser { action } => handle_web_browser(action).await?,
        WebAction::Crawl {
            urls,
            sqlite,
            max_depth,
            max_requests,
            concurrency,
            allowed_domains,
            include_url_regex,
            exclude_url_regex,
            per_host_delay,
            max_per_host,
            max_retries,
            obey_robots,
            sitemaps,
            max_sitemaps,
            goal,
            revisit,
            daemon,
            json,
        } => {
            handle_web_crawl(WebCrawlRequest {
                urls,
                sqlite,
                max_depth,
                max_requests,
                concurrency,
                allowed_domains,
                include_url_regex,
                exclude_url_regex,
                per_host_delay,
                max_per_host,
                max_retries,
                obey_robots,
                sitemaps,
                max_sitemaps,
                goal,
                revisit,
                daemon,
                json,
            })
            .await?;
        }
        WebAction::CrawlIndex(args) => {
            let report = crawl_index::run(args).await?;
            print_web_json(&serde_json::to_value(&report).into_diagnostic()?)?;
        }
        WebAction::Mediawiki {
            api_url,
            article_path,
            prefix,
            include_url_regex,
            exclude_url_regex,
            max_pages,
            batch_size,
            request_interval_ms,
        } => {
            handle_web_mediawiki(aphrody_web_crawl::MediaWikiOptions {
                api_url: reqwest::Url::parse(&api_url).into_diagnostic()?,
                article_path,
                prefix,
                include_url_regex,
                exclude_url_regex,
                max_pages,
                page_batch_size: batch_size,
                request_interval: Duration::from_millis(request_interval_ms),
            })
            .await?;
        }
        WebAction::Mirror {
            url,
            output_dir,
            recursive,
            max_pages,
            max_assets,
            max_depth,
            concurrency,
            delay_ms,
            allowed_domains,
            resolve_cdns,
            proxy,
            json,
        } => {
            handle_web_mirror(
                url,
                output_dir,
                recursive,
                max_pages,
                max_assets,
                max_depth,
                concurrency,
                delay_ms,
                allowed_domains,
                resolve_cdns,
                proxy,
                json,
            )
            .await?;
        }
        WebAction::WikiSearch {
            api_url,
            query,
            limit,
            json,
        } => {
            handle_web_wiki_search(api_url, query.join(" "), limit, json).await?;
        }
        WebAction::WikiPage {
            url,
            api_url,
            markdown,
            include_content,
            no_images,
            json,
        } => {
            let options = aphrody_web_crawl::MediaWikiOptions::new(
                reqwest::Url::parse(&api_url).into_diagnostic()?,
            );
            let client = obscura_net::BunBrowserHttpClient::new();
            if markdown {
                let content = aphrody_web_crawl::wiki::page_markdown(&client, &options, &url)
                    .await
                    .map_err(|error| miette!("MediaWiki page failed: {error}"))?;
                if json {
                    print_web_json(&serde_json::json!(content))?;
                } else {
                    println!("{content}");
                }
            } else {
                let dossier = aphrody_web_crawl::wiki::page_dossier(
                    &client,
                    &options,
                    &url,
                    aphrody_web_crawl::wiki::WikiPageOptions {
                        include_images: !no_images,
                        include_content,
                    },
                )
                .await
                .map_err(|error| miette!("MediaWiki page failed: {error}"))?;
                print_web_json(&serde_json::to_value(dossier).into_diagnostic()?)?;
            }
        }
        WebAction::Frames { action } => handle_web_frames(action).await?,
    }
    Ok(())
}

async fn handle_web_mediawiki(options: aphrody_web_crawl::MediaWikiOptions) -> miette::Result<()> {
    if options.max_pages == 0 || options.page_batch_size == 0 {
        return Err(miette!("--max-pages and --batch-size must be positive"));
    }
    let client = obscura_net::BunBrowserHttpClient::new();
    let pages = aphrody_web_crawl::crawl_mediawiki(&client, &options)
        .await
        .map_err(|error| miette!("MediaWiki crawl failed: {error}"))?;
    let pages = pages
        .into_iter()
        .map(|page| {
            serde_json::json!({
                "pageId": page.page_id,
                "title": page.title,
                "url": page.url,
                "markdown": page.markdown,
            })
        })
        .collect::<Vec<_>>();
    print_web_json(&serde_json::json!({ "pages": pages }))
}

#[allow(clippy::too_many_arguments)]
async fn handle_web_mirror(
    raw_url: String,
    output_dir: std::path::PathBuf,
    recursive: bool,
    max_pages: usize,
    max_assets: usize,
    max_depth: u32,
    concurrency: usize,
    delay_ms: u64,
    allowed_domains: Vec<String>,
    resolve_cdns: String,
    proxy: Option<String>,
    json: bool,
) -> miette::Result<()> {
    if max_pages == 0 || max_pages > 10_000 || max_assets > 20_000 {
        return Err(miette!(
            "--max-pages must be 1..=10000 and --max-assets must be <= 20000"
        ));
    }
    if concurrency == 0 || concurrency > 64 {
        return Err(miette!("--concurrency must be 1..=64"));
    }
    let seed_url = reqwest::Url::parse(&raw_url).into_diagnostic()?;
    let client = if let Some(proxy_url) = proxy.as_deref() {
        obscura_net::BunBrowserHttpClient::with_options(
            std::sync::Arc::new(obscura_net::CookieJar::new()),
            Some(proxy_url),
        )
    } else {
        obscura_net::BunBrowserHttpClient::new()
    };
    let mut options = aphrody_web_crawl::MirrorOptions::new(seed_url, output_dir);
    options.recursive = recursive;
    options.max_pages = max_pages;
    options.max_assets = max_assets;
    options.max_depth = max_depth;
    options.max_concurrency = concurrency;
    options.request_delay = Duration::from_millis(delay_ms);
    options.allowed_domains = allowed_domains;
    match resolve_cdns.trim().to_ascii_lowercase().as_str() {
        "" | "false" | "0" => {}
        "true" | "1" => options.resolve_cdns = true,
        hosts => {
            options.cdn_domains = hosts
                .split(',')
                .map(str::trim)
                .filter(|host| !host.is_empty())
                .map(str::to_owned)
                .collect();
        }
    }
    let report = aphrody_web_crawl::mirror_site(&client, &options)
        .await
        .map_err(|error| miette!("Web mirror failed: {error}"))?;
    if json {
        print_web_json(&serde_json::json!({
            "requests": report.requests,
            "pagesWritten": report.pages_written,
            "assetsWritten": report.assets_written,
            "bytesWritten": report.bytes_written,
            "files": report.files,
            "failures": report.failures.iter().map(|failure| serde_json::json!({
                "url": failure.url,
                "error": failure.error,
            })).collect::<Vec<_>>(),
        }))
    } else {
        println!(
            "Mirror complete: {} pages, {} assets, {} requests, {} failures, {} bytes",
            report.pages_written,
            report.assets_written,
            report.requests,
            report.failures.len(),
            report.bytes_written,
        );
        for failure in report.failures {
            eprintln!("Mirror failed {}: {}", failure.url, failure.error);
        }
        Ok(())
    }
}

async fn handle_web_frames(action: WebFramesAction) -> miette::Result<()> {
    use aphrody_web_frames::{FramesClient, FramesSearchMode, FramesSearchOptions, MediaMeta};
    let client = FramesClient::new().into_diagnostic()?;
    let value = match action {
        WebFramesAction::Vector { path, at, json: _ } => {
            let at_ms = at
                .as_deref()
                .map(aphrody_web_frames::parse_timecode)
                .transpose()
                .into_diagnostic()?;
            serde_json::to_value(client.vector_file(path, at_ms).into_diagnostic()?)
        }
        WebFramesAction::Search {
            path,
            local: _,
            remote,
            auto,
            limit,
            anilist_id,
            at,
            json: _,
        } => {
            let at_ms = at
                .as_deref()
                .map(aphrody_web_frames::parse_timecode)
                .transpose()
                .into_diagnostic()?;
            let mode = if remote {
                FramesSearchMode::Remote
            } else if auto {
                FramesSearchMode::Auto
            } else {
                FramesSearchMode::Local
            };
            serde_json::to_value(
                client
                    .search_file(
                        path,
                        at_ms,
                        FramesSearchOptions {
                            mode,
                            limit,
                            anilist_id,
                        },
                    )
                    .await
                    .into_diagnostic()?,
            )
        }
        WebFramesAction::Stats { json: _ } => {
            serde_json::to_value(client.stats().into_diagnostic()?)
        }
        WebFramesAction::List { filter, json: _ } => {
            serde_json::to_value(client.list(filter.as_deref()).into_diagnostic()?)
        }
        WebFramesAction::Quota { json: _ } => {
            serde_json::to_value(client.quota().await.into_diagnostic()?)
        }
        WebFramesAction::Index {
            path,
            title,
            season,
            episode,
            fps,
            force,
            json: _,
        } => {
            let title = title.unwrap_or_else(|| {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
            let meta = MediaMeta {
                source: path.to_string_lossy().into_owned(),
                title,
                season,
                episode,
                duration_ms: 0,
                fps,
            };
            let frames = client.index(&path, meta, fps, force).into_diagnostic()?;
            Ok(serde_json::json!({ "frames": frames, "path": client.index_path() }))
        }
    }
    .into_diagnostic()?;
    print_web_json(&value)
}

async fn handle_web_wiki_search(
    api_url: String,
    query: String,
    limit: usize,
    json: bool,
) -> miette::Result<()> {
    if !(1..=100).contains(&limit) {
        return Err(miette!("--limit must be between 1 and 100"));
    }
    let api_url = reqwest::Url::parse(&api_url).into_diagnostic()?;
    let options = aphrody_web_crawl::MediaWikiOptions::new(api_url);
    let client = obscura_net::BunBrowserHttpClient::new();
    let hits = aphrody_web_crawl::wiki::search_mediawiki(&client, &options, &query, limit)
        .await
        .map_err(|error| miette!("MediaWiki search failed: {error}"))?;
    if json {
        let hits = hits
            .into_iter()
            .map(|hit| {
                let mut value = serde_json::json!({ "titre": hit.title, "url": hit.url });
                if let Some(size) = hit.size {
                    value["taille"] = serde_json::json!(size);
                }
                value
            })
            .collect::<Vec<_>>();
        print_web_json(&serde_json::json!(hits))
    } else {
        for hit in hits {
            println!("{}\n{}", hit.title, hit.url);
        }
        Ok(())
    }
}

fn print_web_json(value: &serde_json::Value) -> miette::Result<()> {
    println!("{}", serde_json::to_string_pretty(value).into_diagnostic()?);
    Ok(())
}

fn default_gemini_cookie_path() -> Option<std::path::PathBuf> {
    let dir = std::env::var_os("APHRODY_COOKIES_DIR")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("APHRODY_HOME")
                .map(|home| std::path::PathBuf::from(home).join("cookies"))
        })
        .or_else(|| dirs::home_dir().map(|home| home.join(".aphrody/cookies")))?;
    let candidate = dir.join("gemini.json");
    candidate.is_file().then_some(candidate)
}

/// A parsed page: the shared Obscura DOM, with NUL bytes removed first (they truncate parsers).
struct ParsedPage {
    tree: obscura_dom::DomTree,
}

impl ParsedPage {
    fn parse(html: &str) -> Self {
        let clean = html.replace('\0', "");
        Self {
            tree: obscura_dom::parse_html(&clean),
        }
    }

    fn count(&self, selector: &str) -> miette::Result<usize> {
        Ok(self.matches(selector)?.len())
    }

    /// Text content of every element matching `selector`.
    fn texts(&self, selector: &str) -> miette::Result<Vec<String>> {
        Ok(self
            .matches(selector)?
            .into_iter()
            .map(|id| self.tree.text_content(id))
            .collect())
    }

    fn matches(&self, selector: &str) -> miette::Result<Vec<obscura_dom::NodeId>> {
        self.tree
            .query_selector_all(selector)
            .map_err(|detail| miette!("invalid selector {selector:?}: {detail}"))
    }
}

struct WebPage {
    html: String,
    final_url: String,
    status: Option<u16>,
    profile_requested: String,
    profile_obtained: String,
}

async fn fetch_web_page(url: &str, profile: &str) -> miette::Result<WebPage> {
    let url = reqwest::Url::parse(url).into_diagnostic()?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(miette!("Web pages must use HTTP or HTTPS"));
    }
    let selected = aphrody_web_service::fetch::Profile::parse(profile)
        .ok_or_else(|| miette!("unknown Web profile: {profile}"))?;
    if selected.needs_browser() {
        let browser = obscura::Browser::builder()
            .stealth(matches!(
                selected,
                aphrody_web_service::fetch::Profile::Stealth
                    | aphrody_web_service::fetch::Profile::Max
            ))
            .build()
            .into_diagnostic()?;
        let mut page = browser.new_page().await.into_diagnostic()?;
        tokio::time::timeout(Duration::from_secs(45), page.goto(url.as_str()))
            .await
            .into_diagnostic()?
            .into_diagnostic()?;
        let html = page.content();
        if html.trim().is_empty() {
            return Err(miette!("browser returned empty HTML for {url}"));
        }
        return Ok(WebPage {
            html,
            final_url: page.url(),
            status: None,
            profile_requested: profile.to_owned(),
            profile_obtained: selected.as_str().to_owned(),
        });
    }
    obscura_net::ensure_rustls_crypto_provider();
    let response = obscura_net::BunBrowserHttpClient::new()
        .fetch(&url)
        .await
        .into_diagnostic()?;
    if response.status >= 400 {
        return Err(miette!("HTTP {} for {}", response.status, response.url));
    }
    if response.body.len() > 8 * 1024 * 1024 {
        return Err(miette!("page exceeds the 8 MiB HTML extraction limit"));
    }
    if !response.is_html() && !response.body.starts_with(b"<") {
        return Err(miette!("{} returned non-HTML content", response.url));
    }
    let html = response.text();
    if html.trim().is_empty() {
        return Err(miette!(
            "web request produced no HTML content for {}",
            response.url
        ));
    }
    Ok(WebPage {
        html,
        final_url: response.url.to_string(),
        status: Some(response.status),
        profile_requested: profile.to_owned(),
        profile_obtained: selected.as_str().to_owned(),
    })
}

async fn handle_web_x(cookie: Option<String>, action: WebXAction) -> miette::Result<()> {
    let session = if let Some(cookie) = cookie {
        aphrody_x::XSession::from_cookie_string(&cookie).into_diagnostic()?
    } else {
        aphrody_x::XSession::load_or_env().into_diagnostic()?
    };
    let client = aphrody_x::XClient::new(session).into_diagnostic()?;
    let result = match action {
        WebXAction::Profile { handle } => serde_json::to_value(
            client
                .user_by_screen_name(&handle)
                .await
                .into_diagnostic()?,
        )
        .into_diagnostic()?,
        WebXAction::Tweets { handle, count } => {
            let user = client
                .user_by_screen_name(&handle)
                .await
                .into_diagnostic()?;
            serde_json::to_value(
                client
                    .user_tweets(&user.id, count, None, 1)
                    .await
                    .into_diagnostic()?,
            )
            .into_diagnostic()?
        }
        WebXAction::Search { query, count } => serde_json::to_value(
            client
                .search(&query.join(" "), count, None, "Latest", 1)
                .await
                .into_diagnostic()?,
        )
        .into_diagnostic()?,
        WebXAction::News { count } => serde_json::to_value(
            client
                .get_news(count, &aphrody_x::NewsOptions::default())
                .await
                .into_diagnostic()?,
        )
        .into_diagnostic()?,
        WebXAction::Whoami => {
            serde_json::to_value(client.whoami().await.into_diagnostic()?).into_diagnostic()?
        }
    };
    print_web_json(&result)
}

struct WebMediaTransport;

#[async_trait::async_trait]
impl aphrody_web_extract::media::MediaTransport for WebMediaTransport {
    async fn fetch(
        &self,
        request: aphrody_web_extract::media::MediaRequest,
    ) -> Result<aphrody_web_extract::media::MediaResponse, String> {
        if request.method != "GET" {
            return Err(format!("unsupported media HTTP method: {}", request.method));
        }
        let url = reqwest::Url::parse(&request.url).map_err(|error| error.to_string())?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("media URL must use HTTP or HTTPS".to_owned());
        }
        obscura_net::ensure_rustls_crypto_provider();
        let mut client = obscura_net::BunBrowserHttpClient::new();
        client.timeout =
            Duration::from_millis(request.timeout_ms.unwrap_or(30_000).clamp(1, 120_000));
        {
            let mut headers = client.extra_headers.write().await;
            headers.extend(request.headers);
            if let Some(referer) = request.referer {
                headers.insert("Referer".to_owned(), referer);
            }
        }
        let response = client
            .fetch(&url)
            .await
            .map_err(|error| error.to_string())?;
        if response.body.len() > 8 * 1024 * 1024 {
            return Err("media response exceeds 8 MiB extraction limit".to_owned());
        }
        Ok(aphrody_web_extract::media::MediaResponse {
            status: response.status,
            body: response.text(),
            url: Some(response.url.to_string()),
        })
    }
}

async fn handle_web_media(action: WebMediaAction) -> miette::Result<()> {
    let transport = WebMediaTransport;
    match action {
        WebMediaAction::Resolve {
            url,
            referer,
            variants,
            timeout_ms,
        } => {
            let mut options = aphrody_web_extract::media::ResolveOptions::new(&transport);
            options.referer = referer.as_deref();
            options.enumerate_variants = variants;
            options.timeout_ms = Some(timeout_ms);
            let result = aphrody_web_extract::media::resolve_embed(&url, &options).await;
            print_web_json(&serde_json::to_value(&result).into_diagnostic()?)?;
            if let Some(error) = result.error {
                return Err(miette!("media resolution: {error}"));
            }
        }
        WebMediaAction::Variants {
            url,
            referer,
            timeout_ms,
        } => {
            let mut options = aphrody_web_extract::media::ResolveOptions::new(&transport);
            options.referer = referer.as_deref();
            options.timeout_ms = Some(timeout_ms);
            let variants = aphrody_web_extract::media::resolve_variants(&url, &options).await;
            print_web_json(&serde_json::to_value(&variants).into_diagnostic()?)?;
            if variants.is_empty() {
                return Err(miette!("no HLS variants found at {url}"));
            }
        }
    }
    Ok(())
}

async fn handle_web_browser(action: WebBrowserAction) -> miette::Result<()> {
    match action {
        WebBrowserAction::Snapshot { url, json } => {
            let parsed = reqwest::Url::parse(&url).into_diagnostic()?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err(miette!("browser URL must use HTTP or HTTPS"));
            }
            // One shared in-process browser session: navigate, then read the same page.
            aphrody_web_service::session::navigate(&url, Duration::from_secs(45))
                .await
                .into_diagnostic()?;
            let snapshot = aphrody_web_service::session::snapshot(Duration::from_secs(15))
                .await
                .into_diagnostic()?;
            if snapshot.trim().is_empty() {
                return Err(miette!("browser snapshot returned no readable content"));
            }
            if json {
                print_web_json(&serde_json::json!({ "url": url, "snapshot": snapshot }))?;
            } else {
                println!("{snapshot}");
            }
        }
    }
    Ok(())
}

struct WebCrawlRequest {
    urls: Vec<String>,
    sqlite: Option<std::path::PathBuf>,
    max_depth: u32,
    max_requests: usize,
    concurrency: usize,
    allowed_domains: Vec<String>,
    include_url_regex: Vec<String>,
    exclude_url_regex: Vec<String>,
    per_host_delay: i64,
    max_per_host: u32,
    max_retries: u32,
    obey_robots: bool,
    sitemaps: bool,
    max_sitemaps: usize,
    goal: Option<String>,
    revisit: bool,
    daemon: bool,
    json: bool,
}

async fn handle_web_crawl(request: WebCrawlRequest) -> miette::Result<()> {
    use aphrody_web_crawl::{
        AddRequest, BunBrowserTransport, CrawlOptions, Frontier, FrontierOptions,
    };
    use regex::Regex;

    if request.max_requests == 0 || request.concurrency == 0 || request.max_per_host == 0 {
        return Err(miette!(
            "--max-requests, --concurrency and --max-per-host must be positive"
        ));
    }
    if request.per_host_delay < 0 {
        return Err(miette!("--per-host-delay must be nonnegative"));
    }
    for pattern in request
        .include_url_regex
        .iter()
        .chain(&request.exclude_url_regex)
    {
        Regex::new(pattern)
            .map_err(|error| miette!("invalid crawl URL regex {pattern:?}: {error}"))?;
    }
    if request.sitemaps && request.max_sitemaps == 0 {
        return Err(miette!(
            "--max-sitemaps must be positive when --sitemaps is enabled"
        ));
    }
    if request.revisit && request.sqlite.is_none() {
        return Err(miette!(
            "--revisit requires --sqlite to retain crawl history"
        ));
    }
    let mut allowed_domains = request.allowed_domains;
    if allowed_domains.is_empty() {
        for url in &request.urls {
            let parsed = reqwest::Url::parse(url).into_diagnostic()?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err(miette!("crawl seeds must use HTTP or HTTPS: {url}"));
            }
            let domain = parsed
                .host_str()
                .ok_or_else(|| miette!("seed has no host: {url}"))?;
            if !allowed_domains.iter().any(|known| known == domain) {
                allowed_domains.push(domain.to_owned());
            }
        }
    }
    let frontier_options = FrontierOptions {
        per_host_delay_ms: request.per_host_delay,
        max_in_flight_per_host: request.max_per_host,
        max_retries: request.max_retries,
        goal: request.goal,
        enable_revisits: request.revisit,
        ..FrontierOptions::default()
    };
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .into_diagnostic()?
        .as_millis();
    let now_ms = i64::try_from(now_ms).unwrap_or(i64::MAX);
    let mut frontier = if let Some(path) = &request.sqlite {
        Frontier::open(path, frontier_options, now_ms).into_diagnostic()?
    } else {
        Frontier::memory(frontier_options).into_diagnostic()?
    };
    for url in &request.urls {
        frontier
            .enqueue(AddRequest::seed(url), now_ms)
            .into_diagnostic()?;
    }
    let options = CrawlOptions {
        max_depth: request.max_depth,
        max_requests: request.max_requests,
        max_concurrency: request.concurrency,
        allowed_domains,
        include_url_regex: request.include_url_regex,
        exclude_url_regex: request.exclude_url_regex,
        obey_robots: request.obey_robots,
        ingest_sitemaps: request.sitemaps,
        max_sitemaps: request.max_sitemaps,
        user_agent: aphrody_web_service::fetch::USER_AGENT.to_owned(),
        ..CrawlOptions::default()
    };
    obscura_net::ensure_rustls_crypto_provider();
    let transport = BunBrowserTransport::scoped(
        obscura_net::BunBrowserHttpClient::new(),
        &options.allowed_domains,
    )
    .await
    .map_err(|error| miette!("crawl transport scope: {error}"))?;
    let report = if request.daemon {
        let daemon_opts = aphrody_web_crawl::CrawlDaemonOptions {
            base: options,
            idle_poll_ms: 1_000,
            maintenance_interval_ms: 10_000,
            max_iterations: None,
        };
        aphrody_web_crawl::crawl_daemon(&mut frontier, &transport, &daemon_opts, None)
            .await
            .into_diagnostic()?
    } else {
        aphrody_web_crawl::crawl_bounded(&mut frontier, &transport, &options)
            .await
            .into_diagnostic()?
    };
    if request.json {
        let pages = report
            .pages
            .iter()
            .map(|page| {
                serde_json::json!({
                    "url": page.url,
                    "depth": page.depth,
                    "status": page.status,
                    "title": page.extracted.title,
                    "description": page.extracted.description,
                    "canonical": page.extracted.canonical,
                    "lang": page.extracted.lang,
                    "markdown": page.extracted.markdown,
                    "text": page.extracted.text,
                    "blocks": page.extracted.blocks,
                    "wordCount": page.extracted.word_count,
                    "duplicate": page.duplicate,
                    "discoveredLinks": page.discovered_links,
                })
            })
            .collect::<Vec<_>>();
        print_web_json(&serde_json::json!({
            "attempts": report.attempts,
            "pages": pages,
            "exactDuplicates": report.exact_duplicates,
            "nearDuplicates": report.near_duplicates,
            "errors": report.errors,
            "frontier": {
                "pending": report.frontier.pending,
                "locked": report.frontier.locked,
                "done": report.frontier.done,
                "failed": report.frontier.failed,
            }
        }))?;
    } else {
        for page in &report.pages {
            println!(
                "{} [{}] {} ({} words, {} links)",
                page.url,
                page.status,
                page.extracted.title,
                page.extracted.word_count,
                page.discovered_links
            );
        }
        for (url, error) in &report.errors {
            eprintln!("{url}: {error}");
        }
        println!(
            "{} pages, {} attempts, {} pending, {} failed",
            report.pages.len(),
            report.attempts,
            report.frontier.pending,
            report.frontier.failed
        );
    }
    if report.pages.is_empty() && !report.errors.is_empty() {
        return Err(miette!("crawl fetched no successful pages"));
    }
    Ok(())
}

#[cfg(test)]
mod web_cli_tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser)]
    struct Probe {
        #[command(subcommand)]
        action: WebAction,
    }

    #[tokio::test]
    async fn ffi_pipeline_rejects_unrelated_web_actions() {
        assert!(
            run_web_pipeline(vec!["status".into(), "--json".into()])
                .await
                .is_err()
        );
    }

    #[test]
    fn search_preserves_source_paging_and_anonymous_flags() {
        let parsed = Probe::try_parse_from([
            "web",
            "search",
            "rust",
            "async",
            "--page",
            "2",
            "--num",
            "5",
            "--no-auth",
            "--markdown",
        ])
        .expect("search flags parse");
        assert!(matches!(parsed.action, WebAction::Search {
            query, page: Some(2), num: Some(5), no_auth: true, markdown: true, ..
        } if query == ["rust", "async"]));
    }

    #[test]
    fn crawl_is_explicitly_bounded_and_domain_scoped() {
        let parsed = Probe::try_parse_from([
            "web",
            "crawl",
            "https://example.com",
            "--max-requests",
            "3",
            "--allowed-domains",
            "example.com,example.org",
            "--obey-robots",
            "--sitemaps",
        ])
        .expect("crawl flags parse");
        assert!(matches!(parsed.action, WebAction::Crawl {
            max_requests: 3, obey_robots: true, sitemaps: true, allowed_domains, ..
        } if allowed_domains == ["example.com", "example.org"]));
    }

    #[test]
    fn media_and_x_subcommands_parse() {
        let media =
            Probe::try_parse_from(["web", "media", "variants", "https://example.com/a.m3u8"])
                .expect("media flags parse");
        assert!(matches!(
            media.action,
            WebAction::Media {
                action: WebMediaAction::Variants { .. }
            }
        ));
        let x = Probe::try_parse_from(["web", "x", "search", "rust", "--count", "5"])
            .expect("X flags parse");
        assert!(matches!(
            x.action,
            WebAction::X {
                action: WebXAction::Search { count: 5, .. },
                ..
            }
        ));
        let browser = Probe::try_parse_from([
            "web",
            "browser",
            "snapshot",
            "https://example.com",
            "--json",
        ])
        .expect("browser flags parse");
        assert!(matches!(
            browser.action,
            WebAction::Browser {
                action: WebBrowserAction::Snapshot { json: true, .. }
            }
        ));
        let detect = Probe::try_parse_from(["web", "detect", "https://example.com", "--json"])
            .expect("detect flags parse");
        assert!(matches!(
            detect.action,
            WebAction::Detect { json: true, .. }
        ));
    }
}
