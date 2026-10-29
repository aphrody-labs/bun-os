<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS RAG and inference engines

> **Historical capability description.** The deployment described here uses
> the Aphrody AI services (`aphrody-ai-http`, `aphrody-embed`) which are
> marked retired in the root production/service catalogues. Their config/model
> entries describe a prior or proposed contract; they do not establish an
> active VPS capability. For current placement and dated runtime evidence, see
> [`production-topology.json`](../../../../../tools/aphrody/config/production-topology.json),
> [`service-catalog.json`](../../../../../tools/aphrody/config/service-catalog.json), and the
> 2026-10-02 topology observation.

Retrieval, embedding and synthesis engines that run on or are reached from the production VPS.
Model names, dimensions, services and environment names are owned by
[`tools/config/local-ai.json`](../../../../../tools/aphrody/config/local-ai.json) (validated by `aphrody-infra validate`) and
by the model catalog of `aphrody-ai` (`crates/ai/models/catalog.json`); this page explains
the pipelines. Restored from the retired `aphrody` monolith (`docs/reference/infra/vps/RAG.md`).

## 1. Platform RAG (`aphrody-ai`)

- Engine: `crates/ai/rag` (indexer, PostgreSQL and SQLite stores, embedders,
  rerankers), served by `aphrody-ai-http` and the `aphrody rag` CLI.
- Store: PostgreSQL database `aphrody` through `APHRODY_MCP_DATABASE_URL`; an explicit `--db`
  selects a local SQLite index instead ([DATABASES.md](./DATABASES.md)).
- Web ingestion: `aphrody rag web-ingest` reads pages from the BXC Web API on loopback and writes
  only to the AI database; the operator wrapper is
  [`scripts/tools/infra/aphrody-rag-web-ingest.sh`](../../../../scripts/tools/infra/aphrody-rag-web-ingest.sh).
- Indexes and their embedding spaces are declared under `indexes` in `tools/config/local-ai.json`.
  Querying an index with another model or dimension is forbidden (`mix-embedding-spaces`); a
  mismatch falls back to lexical search.

## 2. X / Autopilot hybrid retrieval (recorded design)

The crawling agents of the former autopilot combined semantic and lexical retrieval over
`x-store.sqlite` (schema in [DATABASES.md](./DATABASES.md), store code in
`packages/web/x/src/db/store.ts`). The scoring recorded in the monolith was:

- **Embeddings**: Gemini API `gemini-embedding-001`, 768 dimensions. Without an API key the
  offline test mode produced normalised random vectors so runs did not abort; such vectors are
  not a production index and must never be mixed with real embeddings.
- **Candidates**: Redis `VSIM` vector search over `tweet_embeddings` (semantic) and FTS5 `MATCH`
  over `tweets_fts` (lexical).
- **Hybrid score**: `score = cosine_similarity * 0.6 + keyword_ratio * 0.4`, with exact-phrase
  boosts of `+0.25` (title) and `+0.12` (body).
- **Language weighting** favouring local results: `fr` x1.35, `en` x1.10, `ja` x0.95, other
  languages x0.40.
- **Context expansion**: for each hit, up to 10 tweets of the same `conversation_id` in order,
  formatted with author handle, display name, like count and text.
- **Synthesis**: `gemini-2.5-flash` through the Google Generative AI SDK (service account or API
  key), French analytical summary with `[@username]` citations.

Before relying on these weights, locate the live implementation in `aphrody-web` or
`aphrody-ai`; this section records intent and is not a validated contract.

## 3. Local open-weight models

Managed `llama-server` instances (chat, code, reasoning, small, vision, embeddings, rerank) are
planned and supervised by `aphrody-ai` (`crates/ai/llama-server`) with dynamic loopback
ports; `aphrody ai env` prints their canonical `APHRODY_AI_*` variables on hosts that run them.
The VPS row of `targets` in `tools/config/local-ai.json` records which capabilities are available there
and which are deliberately unavailable.
