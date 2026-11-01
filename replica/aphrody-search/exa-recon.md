# Exa Search clean-room recon for Aphrody

## Scope

Public recon of Exa's developer search product and public marketing-page demo,
with API integration prioritized for Aphrody Search. The web surface was
observed in the user's Chrome at `https://exa.ai/`; only the public homepage
demo was used. API behavior below comes from Exa's public documentation.
The visible UI state was recorded through the browser accessibility tree; no
reference screenshot was retained in the repository.

This maps public contracts and UX patterns. It does not inspect Exa's private
index, ranking models, infrastructure, account dashboard, source code, or
request traffic. No API key was used and no account was created.

## Sources

| Source | URL | Evidence used |
| --- | --- | --- |
| Exa public homepage | https://exa.ai/ | Visible Search/Agent demo, latency and effort choices, categories, output tabs, result preview and playground links. |
| Search API | https://exa.ai/docs/reference/search | `POST /search`, search types, domain/date/category filters, content options, response and cost metadata. |
| Contents API | https://exa.ai/docs/reference/contents | URL extraction, text/highlights/summary, JavaScript-rendered pages and PDF support. |
| Answer API | https://exa.ai/docs/reference/answer | Generated answers with citations, SSE streaming and structured output. |
| Exa Agent quickstart | https://exa.ai/docs/agent/quickstart | Async research runs, polling, streaming events, grounding, output schemas and continuation. |
| Create an Agent run | https://exa.ai/docs/reference/agent-api/create-a-run | `POST /agent/runs`, request fields and SSE negotiation. |
| Get an Agent run | https://exa.ai/docs/reference/agent-api/get-a-run | `GET /agent/runs/{id}`, lifecycle states and run response. |
| SDK quickstart | https://exa.ai/docs/sdks/quickstart | Official JavaScript/Python SDK setup and recommended `search`/`getContents` usage. |
| Exa JavaScript SDK | https://github.com/exa-labs/exa-js | Context7-resolved official docs confirm typed `search`, conditional content result fields, and Agent create/poll methods. |
| Pricing | https://exa.ai/docs/reference/pricing | Pay-as-you-go model, request and effort rates. Snapshot read 2026-11-01; verify before any purchase or pricing decision. |
| Exa MCP | https://exa.ai/mcp | Hosted MCP integration and public tool setup. |
| Exa MCP public repository | https://github.com/exa-labs/exa-mcp-server | Public integration repository listing and MCP setup evidence only; implementation source was not inspected. |

## Screen inventory

| ID | Screen | Route / how to reach | Purpose | Key components | States and evidence |
| --- | --- | --- | --- | --- | --- |
| S01 | Public search playground | `https://exa.ai/` | Try the Search API without leaving the marketing page | Query field, Search/Agent switch, Run preview, Lite/Auto/Deep choices, Full Web/News/Companies/Research/People/Financials categories, Results/Answer/Structured tabs, Show code view, API Playground link | Public page observed. Demo starts with an example query and can show results, a cited answer, or structured data. The marketing latency labels are examples, not an API SLA. |
| S02 | Public agent playground | Switch to Agent on S01 | Demonstrate multi-step list/research tasks | Natural-language task, effort selector (Auto/Low/Medium/High observed), Object/Text output, progress label, structured result table, playground link | Public demo observed with a company-list example and progress text. Account-specific dashboard was not opened. |
| S03 | Search API reference | Official docs | Configure machine search | JSON request, search type, filters, content controls, ranked result schema | Documentation; no live API key request made. |
| S04 | Contents API reference | Official docs | Extract selected pages | URL/ID list, text/highlights/summary controls, freshness and extraction options | Documentation; no page was submitted to a paid endpoint. |
| S05 | Answer API reference | Official docs | Return one answer with citations | Query, optional output schema, stream option, answer and citation records | Documentation; generated answers can stream over SSE. |
| S06 | Agent run lifecycle | Create/Get run docs | Start and collect long-running research | Create request, run ID, queued/running/completed/failed/cancelled states, events or polling, structured output and grounding | Documentation; runtime lifecycle is high-confidence from the public contract. |

## Flows

```text
F01 Public quick search
    S01 enter query -> choose Search -> select Lite/Auto/Deep and a category
    -> Run preview -> S01 Results
    edge: no results, query failure, category/filter conflict, request limit

F02 Compare answer formats
    S01 run preview -> Results / Answer / Structured
    edge: structured schema does not match the returned shape; answer has no
          usable evidence; generated output takes longer than expected

F03 Agent list building
    S01 choose Agent -> state criteria -> choose effort -> Object or Text
    -> inspect progress and structured table -> open API Playground
    edge: long-running run, schema failure, budget cap, partial source coverage

F04 Integrate Search API
    app POSTs /search -> receives ranked pages and requested excerpts
    -> caller renders sources or synthesizes an answer
    edge: provider errors, unsupported filters for a category, stale index result

F05 Extract known URLs
    app POSTs /contents with URL/IDs -> request highlights/text/summary
    -> store or render normalized page content

F06 Grounded answer
    app POSTs /answer -> receive answer plus citation records
    -> optionally consume SSE -> display and open citations

F07 Async agent research
    POST /agent/runs -> persist run ID -> stream SSE or GET /agent/runs/{id}
    -> handle terminal status -> render text/structured output and grounding
    edge: failed/cancelled run, budget exhausted, invalid output schema
```

## Public API contract map

| API | Contract and outputs | Aphrody design implication |
| --- | --- | --- |
| Search | `POST https://api.exa.ai/search`; authenticate with `x-api-key` or Bearer. Request includes `query`, `type`, `numResults`, category, domain/date/user-location filters and `contents` options. Result records can include URL, title, date, author, text, highlights, highlight scores, summary and metadata. | Make live-web retrieval a provider interface that returns normalized URL-backed source records. Keep excerpts separate from full page bodies. Preserve request ID, resolved mode, latency, warnings and cost when available. |
| Search modes | Current docs describe `auto`, `lite`, `deep-lite`, and `deep`; legacy names include `instant`, `fast`, and `deep-reasoning`. `lite` has a restricted option set and serves the periodically refreshed index without live fetch. | Expose a provider mode separate from Aphrody's local lexical/vector/hybrid RAG mode. Do not map these mode names onto local retrieval enums. |
| Contents | `/contents` accepts known URLs/IDs and returns text, highlights or summaries; docs describe JS-rendered and PDF extraction. Search can include page content in the same request. | Offer a distinct URL extraction operation, or an explicit search `include` setting; avoid always returning full text when highlights suffice. |
| Answer | `POST /answer` returns answer, citations, request ID and cost metadata; supports streaming and schema-constrained output. | Ground generated answers in an explicit source list and render citation links; keep answer synthesis optional over pure ranked search. |
| Agent | `POST /agent/runs` starts an asynchronous run; `GET /agent/runs/{id}` retrieves it. SSE can report lifecycle events. Requests support effort, output schema, input rows/exclusions, previous run, metadata, data sources and budget. Results expose text/structured output, field grounding, usage and cost. | Agent jobs need durable IDs, cancellation/state handling, bounded spend, structured output validation and per-field citations. This is a separate pipeline from low-latency SERP retrieval. |
| MCP | Exa documents a hosted MCP endpoint and public `exa-labs/exa-mcp-server` integration. | Aphrody should expose its own stable search and fetch tools through MCP; optional third-party provider adapters should not make Aphrody MCP depend on Exa credentials. |
| SDKs | Official Python `exa-py` and JavaScript `exa-js`; docs show Search, Contents and Answer calls. | Aphrody's own Rust and JS facades should use a provider-neutral typed result model; provider SDKs can remain implementation details behind adapters. |

## UX components

| Component | Variants / states | Used on |
| --- | --- | --- |
| Search/Agent switch | Search mode; Agent task mode | S01, S02 |
| Query/task composer | example-filled, edited, submitting, disabled | S01, S02 |
| Search speed selector | Lite, Auto, Deep; labels show demo latency | S01 |
| Category selector | Full Web, News, Companies, Research, People, Financials | S01 |
| Output selector | Results, Answer, Structured | S01 |
| Agent effort selector | Auto, Low, Medium, High visibly shown; API docs expose additional effort levels | S02, S06 |
| Agent output selector | Object, Text | S02 |
| Result card/list | title, URL/domain, excerpts, source link | S01, API |
| Structured output table | named columns and rows from the example task | S02 |
| Run progress | queued/in progress/completed/error | S02, S06 |
| Code-view toggle | hidden/shown request example | S01 |
| Playground handoff | public dashboard/API Playground link | S01, S02 |

## Inferred data model

```text
SearchRequest
  query, type, category, filters, contents, userIdentifier, metadata
  evidence: Search API reference; high confidence for public fields

SearchResult
  requestId, results[], resolvedSearchType, searchTime, warnings/notices,
  costDollars, optional synthesized output
  evidence: Search API schema; high confidence

PageResult
  id, url, title, publishedDate, author, text, highlights[], summary,
  optional subpages/entities/extras
  evidence: documented Search/Contents response fields; high confidence

AgentRun
  id, status, request, effort, outputSchema, previousRunId, timestamps,
  output, grounding[], usage, costDollars, error
  evidence: Create/Get Agent run docs; high confidence for exposed contract
```

These are public API entities, not claims about Exa's internal database.

## Feature matrix and price note

See `exa-features.csv`. As read on 2026-11-01, the pricing page lists Search at
$7/1,000 requests, Contents at $1/1,000 pages per content type, Answer at
$5/1,000 requests, Deep Search at $12–15/1,000, and Agent fixed-effort or
usage-metered runs. Exa documents effort-specific Agent charges and per-run
caps. Prices and free-credit terms change; recheck the official pricing page
before choosing a paid provider or enabling billing.

## Out of scope

- Exa's private search index, ranking and embedding models, crawler internals,
  databases, infrastructure, private API traffic or account dashboard.
- Reproducing Exa branding, exact copy, proprietary data or customer claims.
- Sending Aphrody queries or user identifiers to Exa, creating an API key,
  enabling billing, or adding Exa as a default provider without a separate
  product decision.
- Treating marketing latency and benchmark claims as independently verified
  performance measurements.

## Size

Exa's public Search API adapter is an M-to-L addition once Aphrody defines its
provider-neutral web-result contract, configuration and credential handling.
Answer synthesis, citations, streaming, agent run persistence, cost controls
and MCP exposure together are XL. Reusing the public contract is feasible;
replicating Exa's underlying index is outside this recon.
