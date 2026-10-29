//! Thin synchronous Zukan consumer of the shared Aphrody Web crawler.
//! Domain cache paths stay here; network acquisition, retries and pacing have one owner.

use anyhow::{Context, Result};
use aphrody_web_crawl::BlockingCrawler;
use std::path::{Path, PathBuf};
use tracing::debug;

/// Official Zukan base URL.
pub const BASE_URL: &str = "https://zukan.inazuma.jp";

/// Identifying User-Agent used by the shared Web transport.
pub const USER_AGENT: &str = "AphrodyWeb/1.0 (+https://aphrody.com; zukan)";

/// Minimum delay between requests to the same host.
pub const RATE_LIMIT_MS: u64 = 350;

/// Maximum attempts for transient HTTP failures.
pub const MAX_RETRIES: u32 = 3;

/// Synchronous Web consumer with a domain-owned disk cache.
pub struct ZukanClient {
    inner: BlockingCrawler,
    cache_root: PathBuf,
}

impl ZukanClient {
    /// Creates a client using the supplied domain cache directory.
    pub fn new(cache_root: PathBuf) -> Result<Self> {
        let inner = BlockingCrawler::new(USER_AGENT, RATE_LIMIT_MS, MAX_RETRIES)
            .map_err(anyhow::Error::msg)
            .context("initializing the shared Aphrody Web crawler")?;
        Ok(Self { inner, cache_root })
    }

    /// Returns the domain cache path for a resource.
    ///
    /// `cache_key` is an opaque identifier such as `page_1` or `c01000010`.
    #[must_use]
    pub fn cache_path(&self, lang: &str, route: &str, cache_key: &str) -> PathBuf {
        self.cache_root
            .join(lang)
            .join(route)
            .join(format!("{cache_key}.html"))
    }

    /// Reads an existing cache entry or acquires it through the shared crawler.
    /// Successful acquisitions are stored under the supplied cache path.
    pub fn get_cached(&self, url: &str, cache_path: &Path) -> Result<String> {
        // Read the domain cache first
        if cache_path.exists() {
            debug!(path = %cache_path.display(), "cache hit");
            return std::fs::read_to_string(cache_path).context("reading the domain cache");
        }

        // Delegate network acquisition
        let content = self.fetch_with_retry(url)?;

        // Store the successful domain response
        if let Some(parent) = cache_path.parent() {
            std::fs::create_dir_all(parent).context("creating the domain cache directory")?;
        }
        std::fs::write(cache_path, &content).context("writing the domain cache")?;
        debug!(path = %cache_path.display(), "cache miss: saved");

        Ok(content)
    }

    /// Delegates network scheduling to the sole Aphrody Web owner.
    fn fetch_with_retry(&self, url: &str) -> Result<String> {
        self.inner.get(url).map_err(anyhow::Error::msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_path_structure() {
        let client = ZukanClient::new(PathBuf::from("/tmp/test-cache")).unwrap();
        let p = client.cache_path("ja", "chara_list", "page_1");
        assert_eq!(
            p,
            PathBuf::from("/tmp/test-cache/ja/chara_list/page_1.html")
        );
    }

    #[test]
    fn cache_path_fr() {
        let client = ZukanClient::new(PathBuf::from("/tmp/test-cache")).unwrap();
        let p = client.cache_path("fr", "chara_param", "c01000010");
        assert_eq!(
            p,
            PathBuf::from("/tmp/test-cache/fr/chara_param/c01000010.html")
        );
    }
}
