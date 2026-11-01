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
                .append_pair("limit", &limit.to_string());
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
            .search(
                &options.query,
                options.limit,
                options.path_prefix.as_deref(),
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
