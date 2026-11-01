# Aphrody and Shenron web crawl stack

This is the implementation map for the recursive crawl, indexing, search, and
headless-browser work that feeds Bun OS. `docs/PRODUCT.md` remains the product
status checklist.

## Selected components

| Job                                | Selected owner                                                                                                  | Reason                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public crawl API and Rust crawling | [`aphrody-web`](../../crates/aphrody-web), backed by `bun_browser_crawl` from pinned `aphrody-labs/bun-obscura` | The façade gives other Rust projects a stable entry point while Obscura owns durable SQLite frontier, bounded traversal, per-host pacing, retry/lease recovery, domain scope, robots policy, sitemap discovery, and resumable jobs. CLI and MCP use the same public Playwright transport.                                                                                                                                            |
| Headless browser                   | Aphrody Obscura CDP engine, controlled by [Microsoft Playwright](https://github.com/microsoft/playwright)       | Playwright connects to Obscura over loopback CDP, creates isolated contexts, renders JavaScript pages, and returns bounded HTML. Aphrody's Rust crawler still owns recursion, scope, robots, durable SQLite frontier, extraction and indexing. CDP is Chromium-only and has lower fidelity than Playwright's native protocol; see [connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp). |
| Aphrody retrieval index            | `aphrody-rag` SQLite                                                                                            | SQLite FTS5 and vectors are the durable search index; crawl pages are indexed into the selected Aphrody home.                                                                                                                                                                                                                                                                                                                        |
| Aphrody query cache                | Redis 8.10.3, ephemeral and loopback-only                                                                       | Search results are derived data. The cache has a 512 MiB LRU budget and a 60-second result TTL; Redis is not the source of truth.                                                                                                                                                                                                                                                                                                    |
| Shenron Dragon Ball web pipeline   | Shenron's existing source-aware pipeline and admin web queue                                                    | It owns source allowlists, crawl placement, SQLite ledgers, source records, provenance handling, and its Redis indexer. Keep its jobs and keys separate from Aphrody's search cache.                                                                                                                                                                                                                                                 |

## Language candidates considered

| Language   | Strong candidate                                          | Decision                                                                                                                                                                              |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust       | [`spider-rs/spider`](https://github.com/spider-rs/spider) | Strong general-purpose alternative with HTTP-first crawling and optional Chrome. Do not add it beside the already pinned `bun_browser_crawl` owner.                                   |
| TypeScript | [Crawlee](https://github.com/apify/crawlee)               | Best broad TS crawler option for queues, HTTP and Playwright. Keep it for a future isolated TS integration; a second crawler would duplicate the Rust frontier and browser lifecycle. |
| Python     | [Scrapy](https://github.com/scrapy/scrapy)                | Strong option for source-specific data extraction and Python pipelines. Shenron already has source-specific owners, so do not introduce a parallel Python crawl daemon.               |
| Zig        | No additional crawler selected                            | No new Zig crawl engine is needed beside the maintained Rust owner; the Aphrody Bun OS product code remains Rust-first.                                                               |

## Storage and cache boundaries

- `aphrody web crawl --sqlite <file>` persists crawl state and extracted pages;
  `--revisit` and `--daemon` support a persistent crawl loop.
- `aphrody web crawl-index <seed...> --label <slug>` crawls within the seed
  domain, respects robots rules, writes a private SQLite frontier, and indexes
  the resulting Markdown into the chosen home. It resumes the named job after
  interruption.
- `aphrody rag search` and the MCP `aphrody_rag_search` / `aphrody_rag_context`
  tools read the local SQLite FTS5/vector index. MCP search results use Redis
  only as a short-lived cache. Cache keys include the database path and SQLite
  file/WAL revision, query, limit, path filter, and hashed provider settings.
- Shenron's SQLite placement/receipt state and Redis index data remain owned by
  Shenron. Its source records retain source URLs and provenance; collected
  material does not become a canon verdict automatically.

## Reuse from other projects

### CLI

Install/build the `aphrody` binary, then use the stable `web crawl` and
`web crawl-index` commands. The optional Playwright transport uses the same
frontier and extraction path as native Obscura:

```sh
aphrody web crawl https://example.com --allowed-domains example.com \
  --max-depth 1 --max-requests 10 --obey-robots --browser playwright --json
aphrody web crawl-index https://example.com --label example-site \
  --max-depth 1 --max-requests 10 --browser playwright
```

### JavaScript / TypeScript on Bun

`@aphrody/web-crawl` provides typed `crawl()` and `searchIndex()` APIs plus an
`aphrody-web` executable. Both call the installed Rust CLI using an argument
array, never a shell string. Set `APHRODY_BIN` if the binary is not on `PATH`:

```sh
bun add @aphrody/web-crawl
```

```ts
import { crawl } from "@aphrody/web-crawl";

const report = await crawl({
  urls: ["https://example.com"],
  allowedDomains: ["example.com"],
  maxDepth: 1,
  maxRequests: 10,
  concurrency: 2,
  obeyRobots: true,
  browser: "playwright",
});

const results = await searchIndex({
  query: "Obscura headless browser",
  mode: "hybrid",
  limit: 5,
});
```

`searchIndex()` queries Aphrody's existing RAG index; it does not claim public
Google SERP results. Ingest pages first with `web crawl-index` or
`rag web-ingest`. The JS package currently targets Bun because it uses
`Bun.spawn`; browser and generic JavaScript applications can use the separate
`@aphrody/web-crawl/browser` entry and the versioned
`/api/v1/rag/search` route. The service must include the MCP `rag` feature and
be exposed through same-origin routing or an authenticated CORS gateway. The
package does not download or launch a browser. Install the browser services
separately when `browser: "playwright"` is used.

### Rust

The crawler and safe native/Playwright transports are packaged as the
`aphrody-web` Rust library:

```toml
[dependencies]
aphrody-web = "1.4.7"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

The optional `rag-search` Cargo feature exposes the same Aphrody RAG search
types used by CLI and MCP, without adding that storage stack to crawler-only
consumers:

```toml
aphrody-web = { version = "1.4.7", features = ["rag-search"] }
```

For a remote index, enable `aphrody-web/http-search` and use
`aphrody_web::http_search::HttpSearchClient`. It calls the canonical MCP
`/api/v1/rag/search` route and returns typed wire models without enabling the
local SQLite engine. Reuse one client per service origin. Its optional bearer
token requires HTTPS, except when connecting to loopback for development.

```rust,no_run
use aphrody_web::{
    AddRequest, CrawlOptions, Frontier, FrontierOptions, PlaywrightTransport,
    crawl_bounded,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let now_ms = 1_798_600_000_000_i64;
    let mut frontier = Frontier::memory(FrontierOptions::default());
    frontier.enqueue(AddRequest::seed("https://example.com/"), now_ms)?;
    let domains = vec!["example.com".to_owned()];
    let transport = PlaywrightTransport::connect(domains.clone()).await?;
    let options = CrawlOptions {
        max_depth: 1,
        max_requests: 10,
        allowed_domains: domains,
        obey_robots: true,
        ..CrawlOptions::default()
    };
    let report = crawl_bounded(&mut frontier, &transport, &options).await?;
    println!("crawled {} pages", report.pages.len());
    Ok(())
}
```

For native MCP clients, install/run `aphrody mcp-server` and call
`aphrody_web_crawl`. Set `browser` to `native` or `playwright`; the MCP server
and crawler must be able to reach the local bridge. See
[`crates/aphrody-mcp/README.md`](../../crates/aphrody-mcp/README.md) for
stdio/HTTP connection and authentication setup.

## Packaging and release inputs

- Rust API: `aphrody-web` wraps the public Obscura crawl API and exposes the
  same loopback Playwright bridge transport used by CLI and MCP.
- JS API: workspace package `packages/aphrody-web` is prepared as public
  `@aphrody/web-crawl`, keeping the existing `@aphrody/web` site/domain exports
  intact; it expects an independently installed `aphrody` binary.
- CLI and MCP server are delivered in the Aphrody binary; the Playwright bridge
  is a separately managed local service, not a browser download bundled into
  consumer projects.
- Publish a version only after its package artifacts, CLI version, and Obscura
  revision are recorded together. Shenron continues to own Dragon Ball-specific
  sources, rights, provenance and ingestion.
- The root release planner discovers public workspace packages and Cargo
  crates automatically. Review `bun scripts/release.ts plan`; publish the JS
  package with `bun scripts/release.ts npm --only @aphrody/web-crawl --apply`
  and the Rust crate with `bun scripts/release.ts crates --only aphrody-web
--apply`. The standard release workflow supplies registry credentials from
  GitHub secrets; never put tokens in project files or command arguments.
- The package is deliberately named `@aphrody/web-crawl`: `@aphrody/web` is
  already published and provides Aphrody site and domain-registry APIs.

## VPS service

On the VPS, `aphrody-web-browser-vps.service` exposes Obscura CDP only at
`127.0.0.1:9222`; `aphrody-web-playwright-vps.service` exposes a bounded render
bridge only at `127.0.0.1:9230`. The Rust recursive crawler selects that
transport with `--browser playwright`. The bridge creates a fresh browser
context for every page and blocks navigations and subresources outside the
crawler's explicit host allowlist. `--browser native` keeps the in-process
Obscura HTTP transport.

The VPS host Compose project includes `redis/compose.yaml`. Redis uses the host
network namespace and binds to loopback only, disables persistence,
evicts with `allkeys-lru`, and has a container memory ceiling. A missing Redis
connection degrades search to SQLite without changing the index.
The MCP HTTP container uses host networking, so its protected Compose
environment sets `APHRODY_REDIS_URL` to `redis://127.0.0.1:6379`.

After deploying a checkout that contains the service definition:

```sh
docker compose -f ~/apps/compose.yaml config --quiet
docker compose -f ~/apps/compose.yaml up -d redis
docker compose -f ~/apps/compose.yaml ps redis
```

Useful entry points:

```sh
aphrody web status --json
aphrody web capabilities --json
aphrody web crawl https://aphrody.com --browser playwright --allowed-domains aphrody.com --obey-robots --sqlite ~/.aphrody/private/web/crawl/frontier.sqlite --max-requests 3 --max-depth 1 --json
aphrody web crawl-index https://aphrody.com --label aphrody-site --browser playwright --max-requests 200 --max-depth 4
aphrody rag search "Aphrody Web crawler"
```

For Dragon Ball source collection, use the configured Shenron admin web queue
and its source-specific crawler jobs. Shenron's `aphrodyWebCrawl` client accepts
`browser: "playwright"`; its source policy, export format and provenance
registry remain the owners of Dragon Ball ingestion. `crawl-index` remains
Aphrody Search's SQLite/RAG index path.

### Shenron VPS runtime snapshot (2026-11-01)

The following is an observed operational snapshot, not a deployment promise.
The Shenron user services `shenron-site-crawl.service` and
`shenron-web-engine.service` were running, but both were disabled at boot.
`shenron-crunchyroll.service` was running and enabled. Inspect and follow logs
with:

```sh
systemctl --user status shenron-site-crawl.service shenron-web-engine.service shenron-crunchyroll.service
journalctl --user -u shenron-site-crawl.service -f
journalctl --user -u shenron-web-engine.service -f
```

The recursive site crawler stores its SQLite frontier under
`~/apps/shenron/state/crawl/frontier.sqlite`. The web engine stores its own
queue and index in `~/apps/shenron/state/web-engine/engine.sqlite`. They are
separate from Aphrody Search's RAG database and Redis cache. The web-engine
unit seeds `https://dragonballfr.com`, uses sitemap discovery and the fetch,
Lightpanda and Obscura tiers, and does not pass `--publish`; therefore this
service run does not publish crawl assets to Cloudflare/R2. Its observed
runtime CPU and memory cgroup limits were 200% and 4 GiB, applied at runtime
and not persisted across reboot.

The site crawler treats Dragon Ball France as operator-owned input; its script
does not consult that site's robots.txt. Third-party sources retain their
robots checks. Review the source policy and crawler options before adding
seeds. These workers were intentionally not enabled at boot in this snapshot.

Obscura CDP (`127.0.0.1:9222`) and the Playwright bridge (`127.0.0.1:9230`)
were healthy. Redis responded to `redis-cli ping` on loopback port 6379, but
its keyspace was empty at observation time. The `aphrody-google` daemon was
listening on `127.0.0.1:8802`; `/` and `/health` are not health routes. Google
autocomplete through `aphrody_google_suggest` succeeded, while public Google
SERP search returned a fetch error or anti-bot interstitial. Do not report
public Google search as qualified or attempt to bypass that challenge. The
Crunchyroll API was healthy on `127.0.0.1:9120`, but credentials were absent,
so its catalog sync was partial.

This snapshot records observed service state only. Aphrody Infra owns host
service definitions, proxy configuration, secrets, backups and persistence.

The generic Aphrody `web-pipeline` job accepts `crawl-index` only. Dragon Ball
submissions are rejected at the MCP boundary until they go through Shenron's
source-aware queue, avoiding a job that would be accepted then permanently fail.
