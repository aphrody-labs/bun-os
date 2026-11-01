# Aphrody Search clean-room reconstruction map

## Scope

Build Aphrody's own search home and the core search-to-evidence journeys for
web visitors and agent integrators. The reference is Perplexity Search on the
web, studied from its public documentation and a human-paced view of the
user's own signed-in session. Preserve useful behavior patterns; write fresh
copy and use Aphrody's own identity, APIs, and data.

The visible Perplexity UI shows a search composer, model selection, an answer
view with source citations, alternate Links and Images tabs, a source list,
and a follow-up composer. Official documentation adds the Deep Research and
focused search workflows. The proprietary retrieval backend and private
service endpoints are not public evidence and are not inferred here.

## Sources

| Source | URL | Evidence used |
| --- | --- | --- |
| Perplexity web app | https://www.perplexity.ai/ | Human-paced observation of the search composer and one answer session. No user history was read or saved. |
| What is Pro Search? | https://www.perplexity.ai/help-center/en/articles/10352903-what-is-pro-search | Search automatically uses Pro Search when a plan allows; model menu, Deep Research, source synthesis, citations, follow-ups, and plan limits. Last modified Oct. 26, 2026. |
| Search product page | https://www.perplexity.ai/en-GB/hub/products/search | Product positioning: web, files and apps; cited answer; Deep Research; Spaces/custom instructions. |
| Search API quickstart | https://docs.perplexity.ai/docs/search/quickstart | `POST /search`, ranked JSON results, extracted snippets, domain/country/language filters, multi-query and budget controls. |
| Agent API quickstart | https://docs.perplexity.ai/docs/agent-api/quickstart | `POST /v1/agent`, optional `web_search` tool, citation-bearing answer output, model and effort controls, multi-turn response context. |
| API overview | https://docs.perplexity.ai/docs/getting-started/overview | Public API catalogue: Search, Agent, Orchestrator, Embeddings and Decisions APIs; API MCP and CLI docs. |
| Perplexity public GitHub organization | https://github.com/orgs/perplexityai/repositories | Public SDK, CLI, MCP server, search evaluation framework, and sandbox repositories. Public integrations, not the proprietary search backend. |
| Perplexity terms | https://www.perplexity.ai/fr/hub/legal/terms-of-service | Consumer service terms restrict automated extraction and reverse engineering; supports the clean-room boundary. |

The account page includes personal recent-search navigation. It was not copied
into project artifacts; no screenshot is retained for that reason. No crawler,
bulk download, source bundle, network-call inspection, private API, or other
user's account was used.

## Core loops

1. Ask a question, receive a current answer with citations, inspect the
   sources, then refine the same session with a follow-up.
2. For a simple agent integration, call Search API for ranked result records
   and let the caller's own model synthesize an answer.
3. For one-call grounded generation, call Agent API with web search enabled
   and render its answer and citations.
4. For deeper research, choose Deep Research; the product help describes a
   multi-search, multi-source report workflow. Its exact orchestration is
   proprietary and outside this reconstruction.

## Screens

| ID | Screen | Route / how to reach | Purpose | Key components | Evidence and states |
| --- | --- | --- | --- | --- | --- |
| S01 | Search home | `/` | Start a new question | Search composer, Search/Computer choice, model picker, attachment control, dictation/voice, account navigation | Observed signed-in home. Empty composer; query entry. Plan notice and account navigation are user-specific. |
| S02 | Answer session | `/search/{session-id}` | Read answer and refine the question | Query heading/actions, Response/Links/Images tabs, citations, Sources disclosure, follow-up composer, response status | Observed one completed public-topic query. In-progress and completed states visible; answer body and source list were present. |
| S03 | Source list | S02 Sources disclosure or Links tab | Inspect and open supporting pages | Source cards/list, title/domain/snippet/link | The UI exposed a Sources count and Links tab. Individual citation navigation was not exercised. |
| S04 | Deep Research report | Select Deep Research from the Search menu | Produce a longer research report | Search menu, research progress, synthesized report and source citations | Official help only; not visually observed in the free account. Plan limits may apply. |
| S05 | Focused search results | Choose a supported focus/source such as Academic, Finance, or Files | Constrain evidence to a content domain | Search/focus selector, selected focus, answer/results | Help/product docs describe focused sources. Exact available options depend on plan and current rollout; not all were observed. |

## Flows

```text
F01 Quick web question
    S01 type a question -> submit -> S02 read cited answer
    happy path: one form submission; choosing a model is optional
    edge: empty input, in-progress response, service error, no useful sources,
          plan limit, and retry

F02 Verify evidence
    S02 inspect inline citation or Sources -> S03 inspect/open source
    happy path: one source-selection action after the answer
    edge: source unavailable, snippet is empty, duplicate/low-quality evidence

F03 Continue the session
    S02 enter follow-up -> submit -> S02 updated answer with prior context
    happy path: one follow-up submission
    edge: long thread, changed intent, missing prior context, generation failure

F04 Run a deeper report
    S01 Search menu -> Deep Research -> S04 research progress -> report/citations
    happy path: choose mode and submit a question
    evidence: documented capability, not observed in the signed-in free plan

F05 Use Search as an agent tool
    Agent calls Search API -> receives ranked result JSON -> caller synthesizes
    or Agent API with web_search -> receives generated grounded answer/citations
    evidence: official public API docs; API credentials and billing are separate
```

## Components

| Component | Variants / states | Used on |
| --- | --- | --- |
| Search composer | empty, focused, filled, submitting, disabled, error | S01, S02 |
| Search mode selector | Search; Computer action mode | S01, S02 |
| Model selector | Best/default; named model choices subject to plan | S01, S02 |
| Attachment and voice controls | collapsed, file/source choice, voice/dictation availability | S01, S02 |
| Answer tabs | Response, Links, Images; selected/unselected | S02 |
| Citation marker | inline source reference; opened/unopened | S02 |
| Source panel | collapsed, expanded, populated, empty/unavailable | S02, S03 |
| Follow-up composer | empty, filled, submitting | S02 |
| Research progress/status | working, completed, error/limit | S02, S04 |
| API result record | ranked, filtered, empty snippet, no results | agent flow; not a consumer screen |

## Public API contract map

| API | Public contract | What Aphrody can learn/use |
| --- | --- | --- |
| Search API | `POST https://api.perplexity.ai/search`; `query`, `max_results` (1–20, default 10), optional country, language, domain include/exclude, multiple queries, and budget controls; returns ranked structured results with title, URL and extracted text/snippet. | Search-only provider contract. It returns no generated answer; caller owns answer synthesis and UI. |
| Agent API | `POST https://api.perplexity.ai/v1/agent`; `/v1/responses` is documented as a compatibility alias. Web search is opt-in by `tools: [{type: "web_search"}]` or documented effort behavior. | Unified model/tool request with generated answer and citations. Supports model/reasoning/token controls and multi-turn response context. |
| SDKs and CLI | Public TypeScript/Python SDKs, `pplx` CLI and API MCP server are listed by Perplexity. | Integration examples and client ergonomics; these are wrappers/consumers, not source for the proprietary retrieval backend. |
| Other public API families | Orchestrator, Embeddings, Decisions, analytics, audit and API management docs. | Useful adjacent capabilities, outside this core search-flow slice. |

## Inferred data model

```text
SearchSession
  id, ordered turns, selected search mode/model, created/updated timestamps
  evidence: observed S02 route and follow-up composer; high confidence for
  session/turn behavior, exact persistence schema unknown

SearchTurn
  query, answer text, status, selected focus, response metadata
  evidence: S01/S02 and official Search help; medium confidence

SourceRecord
  title, canonical URL, snippet/extracted text, domain, published/updated time,
  source type, rank, citation identity
  evidence: Search API result examples and S02 Sources/Links UI; high for public
  API result fields, medium for UI's internal citation mapping

AgentResponse
  response id, output text/structured output, status, model, tool calls,
  usage/cost, prior response id
  evidence: Agent API docs; high for documented public response contract
```

Relationships: SearchSession 1-to-many SearchTurn; SearchTurn 1-to-many
SourceRecord; AgentResponse may reference a prior response and tool results.
These are product-level recon entities, not claims about Perplexity's private
database schema.

## Feature matrix

See `features.csv`. Priorities distinguish the essential Aphrody search loop
from capabilities that require a separate answer/agent pipeline.

## Out of scope

- Private search index, ranking models, internal services, database layout,
  source ingestion, private endpoints, and request/response traffic.
- Perplexity branding, illustrations, exact copy, proprietary content, or
  account data.
- Full Computer/browser automation, Projects, connectors, scheduled Tasks,
  image generation, shopping, and unrelated product surfaces.
- Treating Perplexity API availability or plans as implied authorization to
  spend money or send Aphrody user data to that service.

## Size

The current Aphrody UI slice is one screen and two visible search modes; the
reference search experience covers five screen states and five flows. A basic
cited-answer vertical slice is L; deep research, agent APIs, streaming,
multi-turn persistence, source evaluation, web indexing, API auth and
administration together are XL. The exact proprietary implementation remains
unknown and is unnecessary for Aphrody's own design.
