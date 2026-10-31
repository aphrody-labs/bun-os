# Aphrody and Shenron web crawl stack

This is the implementation map for the recursive crawl, indexing, search, and
headless-browser work that feeds Bun OS. `docs/PRODUCT.md` remains the product
status checklist.

## Selected components

| Job | Selected owner | Reason |
| --- | --- | --- |
| Rust crawling and extraction | `bun_browser_crawl` from the pinned `aphrody-labs/bun-obscura` revision | Already owns the durable SQLite frontier, bounded traversal, per-host pacing, retry/lease recovery, domain scope, robots policy, sitemap discovery, and resumable jobs used by Aphrody Web. |
| Headless rendering | Aphrody Obscura CDP engine | The same pinned browser runtime is used by the Rust web transport. The VPS daemon is loopback-only on port 9222; the unified image still needs its own per-user package and unit. |
| Aphrody retrieval index | `aphrody-rag` SQLite | SQLite FTS5 and vectors are the durable search index; crawl pages are indexed into the selected Aphrody home. |
| Aphrody query cache | Redis 8.10.3, ephemeral and loopback-only | Search results are derived data. The cache has a 512 MiB LRU budget and a 60-second result TTL; Redis is not the source of truth. |
| Shenron Dragon Ball web pipeline | Shenron's existing source-aware pipeline and admin web queue | It owns source allowlists, crawl placement, SQLite ledgers, source records, provenance handling, and its Redis indexer. Keep its jobs and keys separate from Aphrody's search cache. |

## Language candidates considered

| Language | Strong candidate | Decision |
| --- | --- | --- |
| Rust | [`spider-rs/spider`](https://github.com/spider-rs/spider) | Strong general-purpose alternative with HTTP-first crawling and optional Chrome. Do not add it beside the already pinned `bun_browser_crawl` owner. |
| TypeScript | [Crawlee](https://github.com/apify/crawlee) | Best broad TS crawler option for queues, HTTP and Playwright. Keep it for a future isolated TS integration; a second crawler would duplicate the Rust frontier and browser lifecycle. |
| Python | [Scrapy](https://github.com/scrapy/scrapy) | Strong option for source-specific data extraction and Python pipelines. Shenron already has source-specific owners, so do not introduce a parallel Python crawl daemon. |
| Zig | No additional crawler selected | No new Zig crawl engine is needed beside the maintained Rust owner; the Aphrody Bun OS product code remains Rust-first. |

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

## VPS service

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
aphrody web crawl-index https://aphrody.com --label aphrody-site --max-requests 200 --max-depth 4
aphrody rag search "Aphrody Web crawler"
```

For Dragon Ball source collection, use the configured Shenron admin web queue
and its source-specific crawler jobs. `aphrody web crawl-index` is useful for
an Aphrody home index of authorized public pages; it does not replace Shenron's
curated crawl/import pipeline or its source/provenance records.

The generic Aphrody `web-pipeline` job accepts `crawl-index` only. Dragon Ball
submissions are rejected at the MCP boundary until they go through Shenron's
source-aware queue, avoiding a job that would be accepted then permanently fail.
