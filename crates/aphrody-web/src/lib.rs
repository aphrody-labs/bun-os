//! Reusable Rust API for bounded Aphrody Web crawling.
//!
//! The crate re-exports the low-level Obscura crawl API and adds scoped native
//! and Playwright transports plus a small in-memory `crawl_seed_urls` helper.

use std::{net::IpAddr, time::Duration};

use reqwest::Url;
use serde::{Deserialize, Serialize};

pub use obscura_crawl::{
    AddRequest, BunBrowserTransport, CrawlDaemonOptions, CrawlOptions, CrawlPage, CrawlReport,
    CrawlTransport, FetchResult, Frontier, FrontierOptions, crawl_bounded, crawl_daemon,
};
pub use obscura_net::BunBrowserHttpClient;

/// Typed HTTP integration for an operator-managed SearXNG instance.
///
/// Enable the `searxng` feature to expose a provider-neutral Aphrody web-search
/// result contract. SearXNG must have JSON output enabled by its operator.
#[cfg(feature = "searxng")]
pub mod web_search {
    use std::{error::Error, fmt, time::Duration};

    use reqwest::{StatusCode, Url};
    use serde::{Deserialize, Serialize};

    const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);

    /// Search categories supported by SearXNG; availability depends on instance configuration.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum SearchCategory {
        General,
        News,
        Science,
        It,
        Images,
        Videos,
    }

    impl SearchCategory {
        fn as_str(self) -> &'static str {
            match self {
                Self::General => "general",
                Self::News => "news",
                Self::Science => "science",
                Self::It => "it",
                Self::Images => "images",
                Self::Videos => "videos",
            }
        }
    }

    /// Time filter applied where an enabled upstream engine supports it.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum TimeRange {
        Day,
        Month,
        Year,
    }

    impl TimeRange {
        fn as_str(self) -> &'static str {
            match self {
                Self::Day => "day",
                Self::Month => "month",
                Self::Year => "year",
            }
        }
    }

    /// Normalized public web-search request.
    #[derive(Debug, Clone)]
    pub struct WebSearchRequest {
        pub query: String,
        pub limit: usize,
        pub categories: Vec<SearchCategory>,
        pub language: Option<String>,
        pub page: u16,
        pub time_range: Option<TimeRange>,
        pub safe_search: Option<u8>,
        pub engines: Vec<String>,
        pub disabled_engines: Vec<String>,
    }

    impl WebSearchRequest {
        pub fn new(query: impl Into<String>) -> Self {
            Self {
                query: query.into(),
                limit: 10,
                categories: Vec::new(),
                language: None,
                page: 1,
                time_range: None,
                safe_search: Some(1),
                engines: Vec::new(),
                disabled_engines: Vec::new(),
            }
        }
    }

    /// One normalized web result with source engine metadata when available.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct WebSearchResultItem {
        pub title: String,
        pub url: String,
        pub snippet: String,
        pub engine: Option<String>,
        pub category: Option<String>,
        pub published_at: Option<String>,
        pub engines: Vec<String>,
        pub score: Option<f64>,
        pub thumbnail: Option<String>,
        pub template: Option<String>,
        pub metadata: serde_json::Value,
    }

    /// Provider-neutral Aphrody result report for public web discovery.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct WebSearchReport {
        pub query: String,
        pub results: Vec<WebSearchResultItem>,
        pub provider: String,
        pub page: u16,
        pub total_results: usize,
        pub answers: Vec<String>,
        pub corrections: Vec<String>,
        pub suggestions: Vec<String>,
        pub unresponsive_engines: Vec<String>,
        pub infoboxes: Vec<serde_json::Value>,
    }

    /// Search client configuration.
    #[derive(Debug, Clone)]
    pub struct SearxngClientOptions {
        pub base_url: Url,
        pub timeout: Duration,
    }

    impl SearxngClientOptions {
        pub fn new(base_url: impl AsRef<str>) -> Result<Self, WebSearchError> {
            let base_url = Url::parse(base_url.as_ref())
                .map_err(|_| WebSearchError::InvalidRequest("base_url is invalid"))?;
            if !matches!(base_url.scheme(), "http" | "https")
                || !base_url.username().is_empty()
                || base_url.password().is_some()
                || base_url.query().is_some()
                || base_url.fragment().is_some()
            {
                return Err(WebSearchError::InvalidRequest(
                    "base_url must be HTTP(S) without credentials, query, or fragment",
                ));
            }
            Ok(Self {
                base_url,
                timeout: DEFAULT_TIMEOUT,
            })
        }

        pub fn timeout(mut self, timeout: Duration) -> Self {
            self.timeout = timeout.clamp(Duration::from_millis(1), Duration::from_secs(120));
            self
        }
    }

    /// Error returned from Aphrody's web-search provider.
    #[derive(Debug)]
    pub enum WebSearchError {
        InvalidRequest(&'static str),
        Transport(reqwest::Error),
        Provider { status: StatusCode, message: String },
        InvalidResponse(&'static str),
    }

    impl fmt::Display for WebSearchError {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self {
                Self::InvalidRequest(message) => write!(f, "invalid web-search request: {message}"),
                Self::Transport(error) => write!(f, "web-search request failed: {error}"),
                Self::Provider { status, message } => {
                    write!(f, "SearXNG returned HTTP {status}: {message}")
                }
                Self::InvalidResponse(message) => write!(f, "invalid SearXNG response: {message}"),
            }
        }
    }

    impl Error for WebSearchError {
        fn source(&self) -> Option<&(dyn Error + 'static)> {
            match self {
                Self::Transport(error) => Some(error),
                Self::InvalidRequest(_) | Self::Provider { .. } | Self::InvalidResponse(_) => None,
            }
        }
    }

    impl From<reqwest::Error> for WebSearchError {
        fn from(error: reqwest::Error) -> Self {
            Self::Transport(error)
        }
    }

    #[derive(Deserialize)]
    struct SearxngResponse {
        results: Option<Vec<SearxngResult>>,
        #[serde(rename = "number_of_results")]
        total_results: Option<usize>,
        answers: Option<Vec<String>>,
        corrections: Option<Vec<String>>,
        suggestions: Option<Vec<String>>,
        unresponsive_engines: Option<Vec<String>>,
        infoboxes: Option<Vec<serde_json::Value>>,
    }

    #[derive(Deserialize)]
    struct SearxngResult {
        title: Option<String>,
        url: Option<String>,
        content: Option<String>,
        engine: Option<String>,
        category: Option<String>,
        #[serde(rename = "publishedDate")]
        published_date: Option<String>,
        engines: Option<Vec<String>>,
        score: Option<f64>,
        thumbnail: Option<String>,
        template: Option<String>,
        #[serde(flatten)]
        metadata: serde_json::Map<String, serde_json::Value>,
    }

    /// Reusable typed client for an operator-managed SearXNG HTTP API.
    #[derive(Clone)]
    pub struct SearxngSearchClient {
        client: reqwest::Client,
        endpoint: Url,
    }

    impl SearxngSearchClient {
        pub fn new(options: SearxngClientOptions) -> Result<Self, WebSearchError> {
            let mut endpoint = options.base_url;
            let prefix = endpoint.path().trim_end_matches('/');
            let path = if prefix.is_empty() {
                "/search".to_owned()
            } else {
                format!("{prefix}/search")
            };
            endpoint.set_path(&path);
            let client = reqwest::Client::builder()
                .timeout(options.timeout)
                .redirect(reqwest::redirect::Policy::none())
                .build()?;
            Ok(Self { client, endpoint })
        }

        pub async fn search(
            &self,
            request: &WebSearchRequest,
        ) -> Result<WebSearchReport, WebSearchError> {
            let query = request.query.trim();
            if query.is_empty() || query.len() > 4096 {
                return Err(WebSearchError::InvalidRequest(
                    "query must contain 1 to 4096 bytes of non-empty text",
                ));
            }
            if !(1..=50).contains(&request.limit) {
                return Err(WebSearchError::InvalidRequest("limit must be from 1 to 50"));
            }
            if !(1..=100).contains(&request.page) {
                return Err(WebSearchError::InvalidRequest("page must be from 1 to 100"));
            }
            if request.safe_search.is_some_and(|value| value > 2) {
                return Err(WebSearchError::InvalidRequest(
                    "safe_search must be 0, 1, or 2",
                ));
            }
            let mut endpoint = self.endpoint.clone();
            {
                let mut pairs = endpoint.query_pairs_mut();
                pairs
                    .append_pair("q", query)
                    .append_pair("format", "json")
                    .append_pair("pageno", &request.page.to_string());
                if !request.categories.is_empty() {
                    let categories = request
                        .categories
                        .iter()
                        .map(|category| category.as_str())
                        .collect::<Vec<_>>()
                        .join(",");
                    pairs.append_pair("categories", &categories);
                }
                if let Some(language) = request.language.as_deref() {
                    pairs.append_pair("language", language);
                }
                if let Some(time_range) = request.time_range {
                    pairs.append_pair("time_range", time_range.as_str());
                }
                if let Some(safe_search) = request.safe_search {
                    pairs.append_pair("safesearch", &safe_search.to_string());
                }
                if !request.engines.is_empty() {
                    pairs.append_pair("engines", &request.engines.join(","));
                }
                if !request.disabled_engines.is_empty() {
                    pairs.append_pair("disabled_engines", &request.disabled_engines.join(","));
                }
            }
            let builder = self.client.get(endpoint);
            let response = builder.send().await?;
            let status = response.status();
            if !status.is_success() {
                let message = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "search provider returned an error".to_owned());
                return Err(WebSearchError::Provider {
                    status,
                    message: message.chars().take(512).collect(),
                });
            }
            let payload: SearxngResponse = response
                .json()
                .await
                .map_err(|_| WebSearchError::InvalidResponse("response is not valid JSON"))?;
            let raw_results = payload.results.ok_or(WebSearchError::InvalidResponse(
                "JSON output is disabled or results is missing",
            ))?;
            let results = raw_results
                .into_iter()
                .filter_map(|item| {
                    let title = item.title?;
                    let raw_url = item.url?;
                    let url = Url::parse(&raw_url).ok()?;
                    if !matches!(url.scheme(), "http" | "https") {
                        return None;
                    }
                    Some(WebSearchResultItem {
                        title,
                        url: url.to_string(),
                        snippet: item.content.unwrap_or_default(),
                        engine: item.engine,
                        category: item.category,
                        published_at: item.published_date,
                        engines: item.engines.unwrap_or_default(),
                        score: item.score,
                        thumbnail: item.thumbnail.filter(|value| {
                            Url::parse(value)
                                .ok()
                                .is_some_and(|url| matches!(url.scheme(), "http" | "https"))
                        }),
                        template: item.template,
                        metadata: serde_json::Value::Object(item.metadata),
                    })
                })
                .take(request.limit)
                .collect::<Vec<_>>();
            Ok(WebSearchReport {
                query: query.to_owned(),
                total_results: payload.total_results.unwrap_or(results.len()),
                results,
                provider: "searxng".to_owned(),
                page: request.page,
                answers: payload.answers.unwrap_or_default(),
                corrections: payload.corrections.unwrap_or_default(),
                suggestions: payload.suggestions.unwrap_or_default(),
                unresponsive_engines: payload.unresponsive_engines.unwrap_or_default(),
                infoboxes: payload.infoboxes.unwrap_or_default(),
            })
        }
    }
}

/// Local Aphrody RAG search API, enabled with the `rag-search` feature.
///
/// This exposes the same lexical, vector and hybrid index used by the CLI and
/// MCP agent tools. It does not perform public web search; index documents with
/// Aphrody RAG before querying them.
#[cfg(feature = "rag-search")]
pub mod search {
    pub use aphrody_rag::{
        ChunkRecord, RagSearcher, RagStats, RagStore, ScoredChunk, SearchMode, SearchOptions,
        SearchResult,
    };
}

/// Typed HTTP client for the Aphrody MCP `/api/v1/rag/search` endpoint.
///
/// This feature has a small wire DTO and does not enable the SQLite RAG engine.
/// Keep bearer tokens in trusted server-side applications; browser clients
/// should use same-origin routing or a gateway.
#[cfg(feature = "http-search")]
pub mod http_search {
    use std::{error::Error, fmt};
    use std::{net::IpAddr, time::Duration};

    use reqwest::{StatusCode, Url};
    use serde::{Deserialize, Serialize};

    const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

    /// Retrieval mode that the service actually used.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum SearchMode {
        /// SQLite FTS text retrieval.
        Lexical,
        /// Dense-vector retrieval.
        Vector,
        /// Fused lexical and vector retrieval.
        Hybrid,
    }

    /// Retrieval strategy requested from the remote index.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum SearchStrategy {
        /// Use SQLite FTS text retrieval only.
        Lexical,
        /// Use dense-vector retrieval only.
        Vector,
        /// Fuse lexical and vector retrieval (the server default).
        Hybrid,
    }

    impl SearchStrategy {
        fn as_query_value(self) -> &'static str {
            match self {
                Self::Lexical => "lexical",
                Self::Vector => "vector",
                Self::Hybrid => "hybrid",
            }
        }
    }

    /// One local indexed text passage returned by search.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SearchChunk {
        /// Stable row identifier within this index.
        pub id: i64,
        /// Parent document identifier within this index.
        pub doc_id: i64,
        /// Local source path.
        pub path: String,
        /// Zero-based position in the source document.
        pub chunk_index: usize,
        /// Heading context, when available.
        pub heading: Option<String>,
        /// Code symbol context, when available.
        pub symbol: Option<String>,
        /// Retrieved text.
        pub content: String,
        /// One-based start line.
        pub start_line: usize,
        /// One-based end line.
        pub end_line: usize,
        /// Approximate token count.
        pub token_count: usize,
    }

    /// Ranked passage and the retrieval channel that produced it.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SearchHit {
        /// Retrieved passage and local provenance.
        pub chunk: SearchChunk,
        /// Relevance score from the serving pipeline.
        pub score: f64,
        /// Retrieval channel, such as `lexical`, `vector`, `rrf`, or `rerank`.
        pub channel: String,
    }

    /// Typed wire result returned by Aphrody's REST and MCP search pipeline.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SearchResult {
        /// Query text.
        pub query: String,
        /// Ranked local passages.
        pub hits: Vec<SearchHit>,
        /// Effective retrieval mode after fallback.
        pub mode_served: SearchMode,
        /// Explanation when the requested retrieval path degraded.
        pub fallback_reason: Option<String>,
        /// End-to-end search duration in milliseconds.
        pub elapsed_ms: u64,
        /// Candidate count before final truncation.
        pub total_candidates: usize,
    }

    /// Options for calling the canonical HTTP search endpoint.
    #[derive(Debug, Clone)]
    pub struct HttpSearchOptions {
        /// Aphrody MCP base URL, such as `https://search.example`.
        pub base_url: Url,
        /// Search text.
        pub query: String,
        /// Maximum number of hits (1-50, defaults to 8).
        pub limit: Option<usize>,
        /// Retrieval strategy; defaults to hybrid in the convenience function.
        pub mode: Option<SearchStrategy>,
        /// Restrict hits to document paths beginning with this prefix.
        pub path_prefix: Option<String>,
        /// Optional bearer credential for a trusted server-side gateway.
        pub bearer_token: Option<String>,
        /// Request timeout. Defaults to 30 seconds.
        pub timeout: Option<Duration>,
    }

    /// Reusable HTTP client for repeated search requests.
    ///
    /// Reuse one client per service origin so reqwest can reuse its connection
    /// pool across requests.
    #[derive(Clone)]
    pub struct HttpSearchClient {
        client: reqwest::Client,
        endpoint: Url,
        bearer_token: Option<String>,
    }

    #[cfg(feature = "rag-search")]
    impl From<crate::search::SearchResult> for SearchResult {
        fn from(result: crate::search::SearchResult) -> Self {
            Self {
                query: result.query,
                hits: result
                    .hits
                    .into_iter()
                    .map(|hit| SearchHit {
                        chunk: SearchChunk {
                            id: hit.chunk.id,
                            doc_id: hit.chunk.doc_id,
                            path: hit.chunk.path,
                            chunk_index: hit.chunk.chunk_index,
                            heading: hit.chunk.heading,
                            symbol: hit.chunk.symbol,
                            content: hit.chunk.content,
                            start_line: hit.chunk.start_line,
                            end_line: hit.chunk.end_line,
                            token_count: hit.chunk.token_count,
                        },
                        score: hit.score,
                        channel: hit.channel,
                    })
                    .collect(),
                mode_served: match result.mode_served {
                    crate::search::SearchMode::Lexical => SearchMode::Lexical,
                    crate::search::SearchMode::Vector => SearchMode::Vector,
                    crate::search::SearchMode::Hybrid => SearchMode::Hybrid,
                },
                fallback_reason: result.fallback_reason,
                elapsed_ms: result.elapsed_ms,
                total_candidates: result.total_candidates,
            }
        }
    }

    /// Failure returned by the HTTP search client.
    #[derive(Debug)]
    pub enum HttpSearchError {
        /// The query or options are invalid.
        InvalidRequest(&'static str),
        /// The request could not be built or sent.
        Transport(reqwest::Error),
        /// The API returned a non-success HTTP status.
        Api { status: StatusCode, message: String },
    }

    impl fmt::Display for HttpSearchError {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self {
                Self::InvalidRequest(message) => {
                    write!(formatter, "invalid search request: {message}")
                }
                Self::Transport(error) => write!(formatter, "search request failed: {error}"),
                Self::Api { status, message } => {
                    write!(
                        formatter,
                        "Aphrody search returned HTTP {status}: {message}"
                    )
                }
            }
        }
    }

    impl Error for HttpSearchError {
        fn source(&self) -> Option<&(dyn Error + 'static)> {
            match self {
                Self::Transport(error) => Some(error),
                Self::InvalidRequest(_) | Self::Api { .. } => None,
            }
        }
    }

    impl From<reqwest::Error> for HttpSearchError {
        fn from(error: reqwest::Error) -> Self {
            Self::Transport(error)
        }
    }

    #[derive(Deserialize)]
    struct ErrorBody {
        error: Option<String>,
    }

    impl HttpSearchClient {
        /// Create a client for an Aphrody MCP origin.
        pub fn new(
            base_url: impl AsRef<str>,
            bearer_token: Option<String>,
            timeout: Option<Duration>,
        ) -> Result<Self, HttpSearchError> {
            let base_url = Url::parse(base_url.as_ref())
                .map_err(|_| HttpSearchError::InvalidRequest("base_url is invalid"))?;
            if !matches!(base_url.scheme(), "http" | "https")
                || !base_url.username().is_empty()
                || base_url.password().is_some()
            {
                return Err(HttpSearchError::InvalidRequest(
                    "base_url must be HTTP(S) and contain no credentials",
                ));
            }
            if bearer_token.is_some() && base_url.scheme() != "https" {
                let loopback = base_url.host_str().is_some_and(|host| {
                    host.eq_ignore_ascii_case("localhost")
                        || host
                            .parse::<IpAddr>()
                            .is_ok_and(|address| address.is_loopback())
                });
                if !loopback {
                    return Err(HttpSearchError::InvalidRequest(
                        "bearer tokens require HTTPS except for loopback services",
                    ));
                }
            }
            let endpoint = base_url
                .join("/api/v1/rag/search")
                .map_err(|_| HttpSearchError::InvalidRequest("base_url is invalid"))?;
            let client = reqwest::Client::builder()
                .timeout(timeout.unwrap_or(DEFAULT_TIMEOUT))
                .redirect(reqwest::redirect::Policy::none())
                .build()?;
            Ok(Self {
                client,
                endpoint,
                bearer_token,
            })
        }

        /// Search through the shared local RAG pipeline.
        pub async fn search(
            &self,
            query: &str,
            limit: Option<usize>,
            path_prefix: Option<&str>,
        ) -> Result<SearchResult, HttpSearchError> {
            self.search_with_mode(query, limit, path_prefix, SearchStrategy::Hybrid)
                .await
        }

        /// Search with an explicit retrieval strategy.
        pub async fn search_with_mode(
            &self,
            query: &str,
            limit: Option<usize>,
            path_prefix: Option<&str>,
            mode: SearchStrategy,
        ) -> Result<SearchResult, HttpSearchError> {
            let query = query.trim();
            if query.is_empty() {
                return Err(HttpSearchError::InvalidRequest("query must not be empty"));
            }
            let limit = limit.unwrap_or(8);
            if !(1..=50).contains(&limit) {
                return Err(HttpSearchError::InvalidRequest(
                    "limit must be from 1 to 50",
                ));
            }
            let mut endpoint = self.endpoint.clone();
            endpoint
                .query_pairs_mut()
                .append_pair("q", query)
                .append_pair("limit", &limit.to_string())
                .append_pair("mode", mode.as_query_value());
            if let Some(prefix) = path_prefix {
                endpoint
                    .query_pairs_mut()
                    .append_pair("path_prefix", prefix);
            }
            let mut request = self
                .client
                .get(endpoint)
                .header(reqwest::header::ACCEPT, "application/json");
            if let Some(token) = self
                .bearer_token
                .as_deref()
                .filter(|token| !token.is_empty())
            {
                request = request.bearer_auth(token);
            }
            let response = request.send().await?;
            let status = response.status();
            if !status.is_success() {
                let message = response
                    .json::<ErrorBody>()
                    .await
                    .ok()
                    .and_then(|body| body.error)
                    .unwrap_or_else(|| "search service returned an error".to_owned());
                return Err(HttpSearchError::Api { status, message });
            }
            Ok(response.json::<SearchResult>().await?)
        }
    }

    /// Query Aphrody's shared local RAG search endpoint with typed results.
    pub async fn search(options: HttpSearchOptions) -> Result<SearchResult, HttpSearchError> {
        HttpSearchClient::new(options.base_url, options.bearer_token, options.timeout)?
            .search_with_mode(
                &options.query,
                options.limit,
                options.path_prefix.as_deref(),
                options.mode.unwrap_or(SearchStrategy::Hybrid),
            )
            .await
    }
}

/// Create an Obscura HTTP transport with the requested outbound host scope.
pub async fn scoped_native_transport(domains: &[String]) -> Result<BunBrowserTransport, String> {
    obscura_net::ensure_rustls_crypto_provider();
    BunBrowserTransport::scoped(BunBrowserHttpClient::new(), domains).await
}

/// Crawl seeds into an in-memory frontier using a scoped native Obscura client.
///
/// When `options.allowed_domains` is empty, it is populated from the seed hosts.
pub async fn crawl_seed_urls(
    seeds: &[String],
    mut options: CrawlOptions,
) -> Result<CrawlReport, String> {
    if seeds.is_empty() {
        return Err("at least one HTTP(S) seed URL is required".into());
    }
    let mut domains = options.allowed_domains.clone();
    for seed in seeds {
        let url = Url::parse(seed).map_err(|error| format!("invalid seed URL: {error}"))?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("seed URLs must be HTTP(S) and contain no credentials".into());
        }
        let host = url.host_str().ok_or("seed URL has no host")?;
        if !domains
            .iter()
            .any(|domain| domain.eq_ignore_ascii_case(host))
        {
            domains.push(host.to_owned());
        }
    }
    options.allowed_domains = domains.clone();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let now_ms = i64::try_from(now_ms).unwrap_or(i64::MAX);
    let mut frontier =
        Frontier::memory(FrontierOptions::default()).map_err(|error| error.to_string())?;
    for seed in seeds {
        frontier
            .enqueue(AddRequest::seed(seed), now_ms)
            .map_err(|error| error.to_string())?;
    }
    let transport = scoped_native_transport(&domains).await?;
    crawl_bounded(&mut frontier, &transport, &options)
        .await
        .map_err(|error| error.to_string())
}

/// Playwright transport over a loopback Aphrody render bridge attached to Obscura.
pub struct PlaywrightTransport {
    client: reqwest::Client,
    endpoint: Url,
    allowed_domains: Vec<String>,
    static_transport: BunBrowserTransport,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderRequest<'a> {
    url: &'a str,
    allowed_domains: &'a [String],
    timeout_ms: u32,
    settle_ms: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderResponse {
    url: String,
    status: u16,
    content_type: Option<String>,
    html: String,
}

impl PlaywrightTransport {
    /// Connect to `APHRODY_WEB_PLAYWRIGHT_URL`, defaulting to the local bridge.
    pub async fn connect(allowed_domains: Vec<String>) -> Result<Self, String> {
        let raw = std::env::var("APHRODY_WEB_PLAYWRIGHT_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:9230/render".to_owned());
        Self::connect_to(raw, allowed_domains).await
    }

    /// Connect to an explicit HTTP loopback bridge endpoint.
    pub async fn connect_to(
        raw_endpoint: impl AsRef<str>,
        allowed_domains: Vec<String>,
    ) -> Result<Self, String> {
        if allowed_domains.is_empty() {
            return Err("Playwright transport requires at least one allowed domain".into());
        }
        obscura_net::ensure_rustls_crypto_provider();
        let endpoint = Url::parse(raw_endpoint.as_ref())
            .map_err(|error| format!("invalid Playwright bridge URL: {error}"))?;
        let loopback = endpoint.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        });
        if endpoint.scheme() != "http"
            || !loopback
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err("Playwright bridge URL must be unauthenticated HTTP on loopback".into());
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(65))
            .build()
            .map_err(|error| error.to_string())?;
        let static_transport = scoped_native_transport(&allowed_domains).await?;
        let transport = Self {
            client,
            endpoint,
            allowed_domains,
            static_transport,
        };
        transport.health().await?;
        Ok(transport)
    }

    /// Check that the local rendering bridge is live before starting a crawl.
    pub async fn health(&self) -> Result<(), String> {
        let endpoint = self
            .endpoint
            .join("/health")
            .map_err(|error| error.to_string())?;
        let response = self
            .client
            .get(endpoint)
            .send()
            .await
            .map_err(|error| format!("Playwright bridge is unavailable: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Playwright bridge health returned HTTP {}",
                response.status()
            ));
        }
        Ok(())
    }
}

impl CrawlTransport for PlaywrightTransport {
    async fn fetch(&self, url: &Url) -> Result<FetchResult, String> {
        let request = RenderRequest {
            url: url.as_str(),
            allowed_domains: &self.allowed_domains,
            timeout_ms: 30_000,
            settle_ms: 250,
        };
        let response = self
            .client
            .post(self.endpoint.clone())
            .json(&request)
            .send()
            .await
            .map_err(|error| format!("Playwright bridge request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Playwright bridge returned HTTP {}",
                response.status()
            ));
        }
        let rendered: RenderResponse = response
            .json()
            .await
            .map_err(|error| format!("invalid Playwright bridge response: {error}"))?;
        let final_url = Url::parse(&rendered.url)
            .map_err(|error| format!("Playwright returned an invalid final URL: {error}"))?;
        let host = final_url
            .host_str()
            .ok_or("Playwright final URL has no host")?;
        let final_host = host.to_ascii_lowercase();
        let in_scope = self.allowed_domains.iter().any(|domain| {
            let domain = domain.to_ascii_lowercase();
            final_host == domain || final_host.ends_with(&format!(".{domain}"))
        });
        if !in_scope || !matches!(final_url.scheme(), "http" | "https") {
            return Err("Playwright final URL is outside the crawl scope".into());
        }
        Ok(FetchResult {
            url: final_url,
            status: rendered.status,
            content_type: rendered.content_type,
            body: rendered.html,
        })
    }

    async fn fetch_sitemap(&self, url: &Url) -> Result<FetchResult, String> {
        self.static_transport.fetch_sitemap(url).await
    }

    async fn fetch_archive(&self, url: &Url) -> Result<FetchResult, String> {
        self.static_transport.fetch_archive(url).await
    }
}
