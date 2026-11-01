# `@aphrody/web-crawl`

Typed Bun client and small CLI for Aphrody Web crawling and local index search.
It delegates crawl policy, rendering, extraction, persistence, indexing and
search to the installed `aphrody` Rust CLI; it never shells out through a
command string.

## Install

```sh
bun add @aphrody/web-crawl
```

Install the matching Aphrody CLI from the [Aphrody Bun OS releases](https://github.com/aphrody-labs/bun-os/releases)
or build `aphrody` from the workspace. Put it on `PATH`, or set `APHRODY_BIN`
to its absolute path. JavaScript package support targets Bun; the crawler and
its public Rust API are implemented in Rust.

## JavaScript / TypeScript API

```ts
import { crawl, searchIndex } from "@aphrody/web-crawl";

const report = await crawl({
  urls: ["https://example.com"],
  allowedDomains: ["example.com"],
  maxDepth: 1,
  maxRequests: 10,
  concurrency: 2,
  obeyRobots: true,
  browser: "playwright",
});

console.log(report.pages.map(({ url, title }) => ({ url, title })));
```

Search the configured local Aphrody RAG index:

```ts
import { searchIndex } from "@aphrody/web-crawl";

const result = await searchIndex({
  query: "Obscura headless browser",
  mode: "hybrid",
  limit: 5,
});

console.log(
  result.hits.map(({ chunk, score }) => ({
    source: chunk.path,
    excerpt: chunk.content,
    score,
  })),
);
```

The index must already contain the relevant documents. Use
`aphrody rag web-ingest <url>` for a single page or
`aphrody web crawl-index ...` for a bounded recursive site ingest. Search
returns the effective mode and any fallback reason so an agent can distinguish
hybrid retrieval from lexical fallback.

The API validates seed URL schemes and numeric bounds, passes arguments as an
argv array (no shell), returns the CLI JSON report, and throws
`AphrodyWebError` with the exit code and stderr on failure.

Both operations accept an `AbortSignal` in their client options to stop the
underlying CLI job when an agent cancels or replaces a request.

## CLI

```sh
bunx @aphrody/web-crawl https://example.com \
  --allowed-domain example.com --max-depth 1 --max-requests 10 \
  --browser playwright --obey-robots true
```

The package targets Bun because its adapter uses `Bun.spawn` to call the Rust
CLI. It cannot run in a browser or generic JavaScript runtime yet. The
`playwright` transport requires the local Aphrody Obscura browser and Playwright
bridge services. Use `native` when no bridge is installed.
