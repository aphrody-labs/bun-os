//! Reusable Rust API for bounded Aphrody Web crawling.
//!
//! The crate re-exports the low-level Obscura crawl API and adds scoped native
//! and Playwright transports plus a small in-memory `crawl_seed_urls` helper.

use std::{net::IpAddr, time::Duration};

use reqwest::Url;
use serde::{Deserialize, Serialize};

pub use bun_browser_crawl::{
    AddRequest, BunBrowserTransport, CrawlDaemonOptions, CrawlOptions, CrawlPage, CrawlReport,
    CrawlTransport, FetchResult, Frontier, FrontierOptions, crawl_bounded, crawl_daemon,
};
pub use bun_browser_net::BunBrowserHttpClient;

/// Create an Obscura HTTP transport with the requested outbound host scope.
pub async fn scoped_native_transport(domains: &[String]) -> Result<BunBrowserTransport, String> {
    bun_browser_net::ensure_rustls_crypto_provider();
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
        bun_browser_net::ensure_rustls_crypto_provider();
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
