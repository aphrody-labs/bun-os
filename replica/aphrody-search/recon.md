# Aphrody Search clean-room reconstruction map

## Scope

Build Aphrody's own web search home and the core query-to-results flow for the
Aphrody Search product. The user is an Aphrody web visitor or agent integrator.
This map uses public product/API documentation and a human-paced view of the
user's own signed-in Perplexity session. It does not reproduce Perplexity's
brand, wording, source code, private interfaces, or account data.

## Sources

| Source | URL | Evidence used |
| --- | --- | --- |
| Perplexity API overview | https://docs.perplexity.ai/docs/getting-started/overview | Public API families and stated capabilities |
| Search API quickstart | https://docs.perplexity.ai/docs/search/quickstart | Query/filter/search API concepts |
| Agent API quickstart | https://docs.perplexity.ai/docs/agent-api/quickstart | Agent-facing web grounded answer API |
| Perplexity public GitHub organization | https://github.com/orgs/perplexityai/repositories | Publicly published SDK, CLI, MCP and search-evaluation repositories |
| Perplexity terms | https://www.perplexity.ai/fr/hub/legal/terms-of-service | Boundaries on automated access to the consumer service |
| Perplexity web application | https://www.perplexity.ai/ | Human-paced review of search entry and response/source tabs |

The proprietary Perplexity retrieval backend and its private service endpoints
are not public evidence and are not inferred here. The Perplexity website terms
prohibit automated extraction; no crawler, bulk download, private API or source
bundle was used.

## Screen inventory

| ID | Screen | Route | Purpose | Key components | States seen/planned |
| --- | --- | --- | --- | --- | --- |
| S01 | Aphrody Search home and results | `/` | Search the public web or Aphrody's indexed corpus | Source selector, labeled query field, submit action, language selector, result list | Empty home, loading, results, empty index, error/retry, retrieval fallback |

## Core flow

F01 Visitor searches Aphrody's index: S01 choose Indexed knowledge -> enter a
query -> submit -> inspect ranked local excerpts with file provenance, mode and
retrieval timing. Error state offers retry. The search service is configurable
through `VITE_APHRODY_SEARCH_API_URL`; same-origin is the default.

F02 Visitor searches the public web: S01 choose Public web -> enter a query ->
submit -> inspect the existing public web results.

## Components

| Component | Variants/states | Screen |
| --- | --- | --- |
| Search source selector | Public web / Indexed knowledge; selected state | S01 |
| Search form | Empty, focused, submitting | S01 |
| Retrieval excerpt | Path, heading, content, retrieval channel and score | S01 |
| Status panel | Loading, empty, unavailable/retry, fallback detail | S01 |

## Data model (inferred from Aphrody API contract)

- `SearchResult`: query, ordered hits, served retrieval mode, optional fallback
  reason, elapsed milliseconds and candidate count. Confidence: high; shared
  typed Rust/HTTP response contract.
- `SearchHit`: score, retrieval channel and `SearchChunk`. Confidence: high.
- `SearchChunk`: local indexed path, heading/symbol context, body, line range
  and token estimate. Confidence: high.
- Public web hit: URL, title and snippet exposed by the existing Aphrody web
  search adapter. Confidence: high.

## Out of scope

Perplexity's proprietary backend, private endpoints, user network/history,
generated answer synthesis, projects, account management, automations, browser
actions, and product branding. Aphrody's indexed mode clearly labels excerpts
as retrieval results; it does not claim to generate an answer.

## Size

S for the Aphrody Search vertical slice. A complete agent answer pipeline with
citations, persisted conversations, streaming, multi-source orchestration and
administration is a separate L/XL effort.
