# `@aphrody/web-crawl`

Typed Bun and Fetch client plus small CLI for Aphrody Web search, crawling and
local index search. It delegates crawl policy, rendering, extraction,
persistence and indexing to the installed `aphrody` Rust CLI; it never shells
out through a command string.

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

The default package entry targets Bun because its crawler and local-index
adapters use `Bun.spawn` to call the Rust CLI. The `playwright` transport
requires the local Aphrody Obscura browser and Playwright bridge services. Use
`native` when no bridge is installed.

### Browser and generic JavaScript search

The `@aphrody/web-crawl/browser` entry point uses only the Fetch API and talks
to Aphrody's `/api/v1/rag/search` and `/api/v1/web/search` gateway routes. The
first delegates to the local SQLite index; the second calls the configured
SearXNG web-search service. Build `aphrody-mcp` with its `rag` feature for the
RAG route and set `APHRODY_SEARXNG_URL` for public web search. Both can run in
browsers and other JS runtimes that provide `fetch`:

```ts
import { createHttpSearchClient } from "@aphrody/web-crawl/browser";

const web = createHttpSearchClient({ baseUrl: "https://search.example" });
const result = await web.search({
  query: "Obscura headless browser",
  limit: 5,
  mode: "hybrid",
});
```

The same client and HTTP types are re-exported from the package root for
server-side JavaScript apps. Browser apps can use the dedicated `./browser`
entry point, which avoids importing the Bun CLI adapter.

### Public web search with SearXNG

`createSearxngSearchClient` connects to Aphrody's authenticated deployment
gateway, which calls the configured self-hosted SearXNG instance. The service
must enable JSON output. SearXNG is AGPL-3.0; this package uses the documented
HTTP API, while the SearXNG fork is tracked separately as source in
`vendor/searxng`. Keep upstream and Aphrody attribution and license notices
with the service you operate.

```ts
import { createSearxngSearchClient } from "@aphrody/web-crawl/browser";

const search = createSearxngSearchClient({
  baseUrl: "https://aphrody.example.org/",
  timeoutMs: 15_000,
});
const result = await search.search({
  query: "headless browser automation",
  limit: 8,
  categories: ["general", "it"],
  language: "en",
  safeSearch: 1,
});
```

The adapter returns Aphrody's `WebSearchReport`, normalized result items and
provider suggestions, answers, infoboxes and engine availability. It validates result
URLs, omits browser credentials, rejects redirects, supports `AbortSignal`,
and enforces a bounded timeout. This is distinct from Aphrody's local RAG
index and Obscura crawler: SearXNG supplies federated discovery; Aphrody can
then fetch, extract and index selected pages through its own crawl pipeline.
The route requires the configured Aphrody AI HTTP gateway bearer. Supply
`bearerToken` only from trusted server-side JS; browser apps should call the
same-origin gateway protected by their hosting/auth layer and must never bundle
the secret.

The local RAG endpoint supports `lexical`, `vector`, and `hybrid` retrieval.
Omit `mode` to use the server's `hybrid` default. Limits follow the server
contract of 1 through 50 results.

The endpoint returns ranked local RAG results and honest mode/fallback
metadata. It does not perform public web SERP. The gateway is private by
default: browser callers need same-origin hosting or an operator-configured
CORS/authenticated gateway. Do not put a server bearer secret in public
browser code. The normal package entry remains Bun-only and supplies recursive
crawl plus local index search.

The RAG REST route itself is currently separate from MCP's Bearer middleware.
For a public deployment, put an authenticated gateway in front of the REST
route; do not assume the MCP token protects it. Trusted server-side clients can
pass `bearerToken` for that gateway over HTTPS (or loopback during development).
The client rejects redirects when a token is configured so credentials cannot
be forwarded to a redirected origin. Store tokens in the server environment,
never in a browser bundle.

Non-success responses throw `AphrodyWebHttpError`, exposing the HTTP `status`
and optional service `code`; the current REST route returns plain-string
`error` fields. Inject a Fetch-compatible implementation with the `fetch`
option when adapting another runtime or transport.

## Public web search and local retrieval

`createSearxngSearchClient` calls Aphrody `/api/v1/web/search` for public web
discovery. `createHttpSearchClient` calls `/api/v1/rag/search` for the local
indexed corpus. These have distinct result types and semantics.
