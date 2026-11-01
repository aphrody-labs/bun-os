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

## Search an Aphrody RAG index

Enable the optional `rag-search` feature to use the same lexical, vector and
hybrid retrieval engine as the CLI and MCP agent tools:

```toml
[dependencies]
aphrody-web = { version = "1.4.7", features = ["rag-search"] }
```

```rust,no_run
use std::sync::Arc;
use aphrody_web::search::{RagSearcher, RagStore, SearchMode, SearchOptions};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let store = Arc::new(RagStore::open("./aphrody-rag.sqlite")?);
    let result = RagSearcher::new(store).search(
        "Obscura headless browser",
        &SearchOptions { mode: SearchMode::Lexical, ..Default::default() },
    ).await?;
    for hit in result.hits {
        println!("{}: {}", hit.chunk.path, hit.chunk.content);
    }
    Ok(())
}
```

The default crate stays crawler-only; `rag-search` is opt-in because it adds
SQLite and retrieval dependencies. This API searches a local indexed corpus,
not the public web.

The CLI, typed Bun package, and MCP tool are documented in
[`docs/aphrody/WEB-CRAWL-STACK.md`](../../docs/aphrody/WEB-CRAWL-STACK.md).

### Search over the Aphrody HTTP API

Enable `http-search` for a typed Rust client that calls the shared Aphrody MCP
search service. This feature uses the response wire types without enabling
SQLite or the local retrieval engine:

```toml
[dependencies]
aphrody-web = { version = "1.4.7", features = ["http-search"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

```rust,no_run
use aphrody_web::http_search::HttpSearchClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = HttpSearchClient::new(
        "https://search.example",
        None,
        None,
    )?;
    let result = client.search("Obscura headless browser", Some(8), None).await?;
    for hit in result.hits {
        println!("{}: {}", hit.chunk.path, hit.chunk.content);
    }
    Ok(())
}
```

This client uses the same typed `SearchResult` as in-process retrieval. The
service owner must keep the MCP listener private or put an authenticated,
same-origin gateway in front of it. A bearer token is appropriate only for
trusted server-side Rust applications; never embed it in browser code.
