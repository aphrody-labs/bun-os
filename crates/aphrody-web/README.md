# aphrody-web

Reusable Rust library for Aphrody Web crawling. It exposes the Obscura crawler,
a safe host-scoped native transport, an in-memory seed helper, and an optional
Playwright transport over Aphrody's local loopback rendering bridge.

## Add to a Rust project

```toml
[dependencies]
aphrody-web = "1.4.7"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

## Crawl with native Obscura

```rust,no_run
use aphrody_web::{CrawlOptions, crawl_seed_urls};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = CrawlOptions {
        max_depth: 1,
        max_requests: 10,
        obey_robots: true,
        ..CrawlOptions::default()
    };
    let report = crawl_seed_urls(&["https://example.com/".into()], options).await?;
    println!("crawled {} pages", report.pages.len());
    Ok(())
}
```

## Crawl through Playwright

Run the Aphrody Obscura browser and Playwright bridge services first, then use
the same durable crawler policy with the rendered-page transport:

```rust,no_run
use aphrody_web::{
    AddRequest, CrawlOptions, CrawlTransport, Frontier, FrontierOptions,
    PlaywrightTransport, crawl_bounded,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let domains = vec!["example.com".to_owned()];
    let transport = PlaywrightTransport::connect(domains.clone()).await?;
    let now_ms = 1_798_600_000_000_i64;
    let mut frontier = Frontier::memory(FrontierOptions::default())?;
    frontier.enqueue(AddRequest::seed("https://example.com/"), now_ms)?;
    let options = CrawlOptions {
        max_depth: 1,
        max_requests: 10,
        allowed_domains: domains,
        obey_robots: true,
        ..CrawlOptions::default()
    };
    let report = crawl_bounded(&mut frontier, &transport, &options).await?;
    println!("rendered {} pages", report.pages.len());
    Ok(())
}
```

The Rust crate never starts or downloads a browser. `PlaywrightTransport`
requires `APHRODY_WEB_PLAYWRIGHT_URL` to be a loopback HTTP URL; it defaults to
`http://127.0.0.1:9230/render` and checks bridge health before crawling.

The CLI, typed Bun package, and MCP tool are documented in
[`docs/aphrody/WEB-CRAWL-STACK.md`](../../docs/aphrody/WEB-CRAWL-STACK.md).
