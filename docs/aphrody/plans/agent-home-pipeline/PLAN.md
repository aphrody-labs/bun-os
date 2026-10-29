<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent home, one database, one pipeline, one RAG

Status: **active**, opened 2026-10-06 by two owner orders of the same day.
Claim: `.coord/claims/agent-home-pipeline.json`. Inventory evidence below was measured on
this machine on 2026-10-06 (row counts and file sizes only; no database content, secret,
cookie or transcript text was read or copied).

## Owner orders

1. Merge Graphify, `yolo scan`, `yolo train` and the Aphrody infra, workspace, session,
   memory, agent-home and sync owners onto ONE pipeline, ONE database, ONE RAG and ONE
   agent home `~/.aphrody`.
2. Graphify is absorbed natively, not kept as an optional external extractor: a private,
   traced import of Graphify-Labs/graphify (Apache-2.0, branch `v8`) with provenance and
   NOTICE, a native Rust equivalent (nodes, EXTRACTED/INFERRED edges with confidence,
   communities, god nodes, `query/path/explain`, report, compatible `graph.json`) wired to
   the common database and RAG. Graphify Python stays only a parity oracle until proof,
   then leaves the execution path. After parity the old entry points and duplicated
   stores are removed, with compatibility aliases kept and every old data store left
   intact and backed up.

Hard rules (unchanged): no secret, cookie, token, database content or transcript is
printed, committed or uploaded; migrations are additive; checksum-verified backup before
any schema change; no deletion or overwrite of an existing database, model or cookie file;
no production service or host data touched; no public fork or publication; no LLM or
external API by default; heavy Cargo only through `bun scripts/build/rust/vps-cargo.ts`.

This plan **supersedes**, for the stores only, two earlier statements:
`docs/plans/ai/rag-native-integration.md` ("memory is a distinct model, do not merge
stores", "knowledge graph is not planned"). The distinct *models* stay distinct tables
with their own namespaces; the *database file*, schema owner, migrations and pipeline
become one. The accepted ADR `docs/decisions/infra/sql-convergence.md` is kept (SQLite for
local state, `aphrody-sql` runner, `vec0` for vectors, PostgreSQL only for shared server
data, training metadata in the optional Neon registry).

## 1. Inventory

Headline: **15 AI crates plus `shell/session` and `infra/sql` (about 46.5k Rust lines)**,
**5 Bun owners (workspace 33.6k, update 11.5k, yolo cli 13k, sql 1k, vfs 0.6k lines)**,
**16 SQLite databases and about 735 JSONL transcripts** under `~/.aphrody`, **4 divergent
RAG database defaults**, **3 incompatible memory layouts**, **4 vector stores**, **3
training stores**, **more than a dozen user-facing entry points** that index, search, remember or train.

### 1.1 Rust owners (crates)

| Owner | Role | Engine / store | Who writes | Who reads |
| --- | --- | --- | --- | --- |
| `crates/infra/sql` (`aphrody-sql`) | SQLite open policy (WAL, busy timeout, FK, optimize), `VACUUM INTO`, checkpoint, optional `vec0`; PG pool; checksummed plain-SQL migration runner (`aphrody_migrations`) | rusqlite 0.40 bundled, sqlite-vec 0.1.9 (feature `vec`, tested, not yet used by any store) | n/a (library) | rag, memory, train(pg), mcp |
| `crates/ai/agent-home` | Soul/identity/user/tools documents, bootstrap budget, mmap cache, hot reload, workspace and profile path resolution, `sync_defaults` snapshot | files under `~/.aphrody/workspace[s/<p>]`; path authority delegated to `aphrody-models::paths` | `aphrody oc-onboard`, `aphrody-ops agent-home` | agent-runtime, memory (`ingest_agent_home`) |
| `crates/ai/models` (`paths`) | Single authority for `~/.aphrody` (`APHRODY_HOME`, `state_dir`, `memory_sqlite_path`, `vector_dir`, `sessions_dir`) | none | n/a | everything |
| `crates/ai/rag-core` | Chunkers (Rust via syn, JS/TS via oxc, Markdown, structural, prose), RRF, MMR, top-k, eval harness | none (pure, wasm-safe) | n/a | rag, train, memory, rag-eval, rag-python |
| `crates/ai/rag-eval` | Recall/MRR/nDCG harness | reads a local index or HTTP/MCP | CLI | CI gates |
| `crates/ai/rag-python` (`aphrody-rust`) | PyO3 kernels over rag-core (vector kernels, fusion); owned by the vu agent | none | n/a | `py/` wheel |
| `crates/ai/memory` | `MemoryBackend` (JSONL, brute-force "HNSW", SQLite `memory_items`, LanceDB optional) and `MemoryProvider` (SqliteLocal `memory_records`, Mem0, Honcho) | `~/.aphrody/memory/memory.sqlite` (14 327 records) plus root `memory.sqlite` and `workspaces/*/db/agent.db` | chat loop, session sync (`feature memory`), `aphrody-agent-home-memory` | chat, `aphrody memory` |
| `crates/ai/session` | Native `Session` JSONL store; `external` mirror of Codex, Claude Code and Antigravity transcripts with per-file byte offsets | JSONL under `~/.aphrody/sessions[/<agent>]`, state file `.external-sync-state.json` | `aphrody ai sync-sessions`, MCP `sync_external_agents`, `agent-sync.ts` | resume/fork, memory feed |
| `crates/ai/rollout` | Async JSONL rollout recorder | `~/.aphrody/sessions/rollout-*.jsonl` | agent runtime | resume |
| `crates/shell/session` | PTY shell sessions | in-memory | shell | shell |
| `crates/ai/train` | GPU lease, job runner, NDJSON events, triple generation with gold-leak guard, promotion gates; optional PG 18 registry (`training` schema, ADR D11) | files under `~/.aphrody/train/*`, PG (inert without `APHRODY_TRAINING_DATABASE_URL`) | `aphrody train`, `aphrody-agent-train` | promotion, model store |
| `crates/ai/embed` | Offline embeddings (fastembed/ort, native BERT, reranker, `/v1/embeddings`) | model cache under `~/.aphrody/models` | n/a | rag (features `ort`, `native`) |
| `crates/ai/context`, `summary`, `project-doc`, `skills`, `skills-forge` | Token budget, docs summary, AGENTS.md discovery, skills discovery/forge | none (files) | n/a | agent-runtime, plugins |
| `crates/infra/aphrody-command` | CLI verbs `rag`, `index` (fsindex), `scan` (manifests/tree), `memory`, `train`, `session`, `ai sync-sessions`, `job` | thin | n/a | users; **held by the bxc/n2b agent** |
| `crates/infra/infra` (`aphrody infra sync`) | Plans a repository/worktree synchronization per target (preserve-dirty-worktrees); not data | none | `aphrody infra sync [--apply]` | operators |

### 1.2 Bun owners

| Owner | Role | Store | Notes |
| --- | --- | --- | --- |
| `packages/engine/yolo/src/scan.ts` + `packages/engine/core/src/vfs/scan.ts` | `yolo scan`: parallel repo scan, per-extension stats, wyhash tree fingerprint, JSON/MD | none (report only) | a fingerprinting scanner, not an ingester; same concern as stage `scan` |
| `yolo train` | **does not exist** as a command (verified with `yolo --help`) | n/a | training is `aphrody train` / `aphrody-agent-train` (Rust) and the Redis `TrainDb` below |
| `packages/engine/core/src/redis/{traindb,vector}.ts` | Redis-backed train instructions/triples and cosine vector store | Redis (cache only per ADR D1) | MCP tools `yolo_traindb_stats`, `yolo_vector_search`; AI CLI `yolo ai call` |
| `packages/engine/core/src/tools/registry.ts` | MCP/AI tool catalog including `yolo_scan` | n/a | single schema list |
| `packages/infra/workspace` | `agent-home.ts` (REPOS.md/TOOLS.md context), `agent-sync.ts` (domain session ingestion loop over native MCP `sync_external_agents`, output must equal `workspaces/<domain>/sessions`), `agent-home-drive-sync.ts` (dbfr agent.db + `aphrody-agent-train`), `repo-sync.ts`, ops/fleet | files + calls Rust binaries | the "domain session sync" |
| `packages/infra/sql` (`@aphrody/sql`) | Bun twin of `aphrody-sql` (pragmas, `Bun.SQL`, redis factory, sqlite-vec test) | `bun:sqlite` | shared pragmas |
| `packages/infra/update` | Dependency/toolchain/sources sync (`sources:sync`) | files | not a data store; out of scope except provenance |
| `~/.aphrody/packages/{knowledge,orchestrator,canon,toriyama}` + `scripts/*` | Legacy local Bun code writing `knowledge.db` (`documents`), outside the repo | `knowledge.db` | replaced by the pipeline; kept readable |

### 1.3 MCP, plugins, documentation

| Surface | Today | Target |
| --- | --- | --- |
| aphrody-mcp tools | `yolo_scan`, `yolo_vector_search`, `yolo_traindb_stats` | delegate to the Rust library through the `aphrody` binary; Redis path removed after parity |
| Plugin skills (`plugins/aphrody`, own repo `aphrody-labs/plugin-aphrody`; `plugins/` is repo `aphrody-labs/plugins`) | `aphrody-rag`, `aphrody-train`, `ecosystem`, `upstreams`, `graphify` (user skill) cite `aphrody rag ...`, `aphrody train ...`, `knowledge.db`, `graphify query` | cite `aphrody index|graph|query|memory|session|train|sync` and the home database |
| Docs | `docs/ecosystem/{CLI,MCP-TOOLS,ECOSYSTEM}`, `CLAUDE.md`/`AGENTS.md` Graphify paragraph | regenerated or edited after each batch |

### 1.4 Real stores on this machine (sizes and counts only)

| Path under `~/.aphrody` | Engine | Content (counts) | Writer | Decision |
| --- | --- | --- | --- | --- |
| `memory/memory.sqlite` (25 MB) | SQLite, journal `delete` | `memory_records` 14 327 | SqliteLocalProvider | import to `memories`; keep file |
| `memory.sqlite` (20 KB) | SQLite | `memory_records` 4 | same | import; keep |
| `workspaces/{aphrody,dbfr,ie}/db/agent.db` | SQLite | `memory_records` 37 / 2 / 0 | agent-home-memory, drive sync | import into the matching profile home; keep |
| `workspace/knowledge.db` (40 MB) | SQLite WAL | `documents` 1 264 | legacy Bun scripts | import to `docs`/`chunks` (global home); keep |
| `workspaces/{aphrody,ie}/knowledge.db` (18/19 MB), `dbfr/knowledge.db` (17 MB, no tables) | SQLite | `documents` 350 / 345 / 0 | legacy Bun scripts | import per profile; keep |
| `workspaces/dbfr/crawl/rag.sqlite` (14 MB) | rag schema | docs 421, chunks 2 362, vectors 0 | `aphrody rag` | import per profile; keep |
| `proofs/codex-oss-rag/index.db` | rag schema | docs 2, chunks 2 | proof | not imported (fixture value only) |
| `index/web-source.db` | SQLite WAL | `files` 538 | `aphrody index` (fsindex) | import to `files`; keep |
| `jobs/jobs.db` | SQLite | `jobs` 4 | `aphrody job` (os/jobs) | stays its owner; journal rows mirrored to `pipeline_runs` only for pipeline jobs |
| `ocr/results.db` | SQLite | pages 822, blocks 2 377 | `aphrody ocr` | later batch: OCR text becomes a `docs` source; owner unchanged |
| `translations.sqlite` (27 MB) | SQLite | 9 845 | translate | out of scope (cache) |
| `cache.sqlite` | SQLite | 3 | cache | out of scope (cache) |
| `sessions/{codex,agy,claude}` | JSONL mirror | 455 + 152 + 55 files, 360 + 87 + 19 MB | session external sync | index into `sessions` (metadata by default); keep JSONL as the transcript store |
| `sessions/2026/09`, root `sessions/*.jsonl`, `workspaces/aphrody/sessions`, `workspaces/dbfr/sessions` | JSONL | 27, 31, 13, 1 files | native session store | index; keep |
| `history/claude-history.jsonl`, `train/*`, `state/commit-sync` | JSONL / JSON | 1, 3 dirs, 1 | various | train dirs imported as datasets/runs; rest untouched |
| `private/backups/aphrody-unique/<date>/` | files | consolidated backups (ADR D12) | ops | the only backup location for this work |
| `cookies`, `credentials`, `secrets`, `private`, `google-cookies.json`, `.env`, `models`, `services` | files | secrets, weights | various | **never read, copied, moved or indexed**; excluded by the pipeline's ignore rules |

Not on this machine: no `vector/rag.sqlite`, no `rag/index.db`, no LanceDB directory. The
two RAG defaults the code resolves have never been written here, so retrieval has no
default corpus: the divergence is real but costs no migration.

### 1.5 Code graph evidence (Graphify 0.9.77, `graphify update .`, offline, no LLM)

`graphify-out/graph.json` for this repository (gitignored): 105 977 nodes, 234 039 edges
(97 % EXTRACTED, 3 % INFERRED, average inferred confidence 0.86), 3 674 communities,
134 MB; relations: calls 66 461, contains 54 661, references 42 665, method 23 683,
imports_from 19 901, imports 8 427, case_of 7 251, indirect_call 3 389, plus re_exports,
implements, rationale_for, defines, extends, inherits, uses, dynamic_import, depends_on.
Node kinds: code 99 216, concept 3 696, document 1 570, rationale 1 495. Node shape:
`id, label, file_type, source_file, source_location, community, community_name, norm_label`;
edge shape: `source, target, relation, confidence, confidence_score, context, source_file,
source_location, weight`. Noise to exclude by rule: generated bundles (for example
`crates/ui/app/ui-dist/app.js` dominates the "hub" list).
`graphify explain "RagStore"` shows the callers that fix the migration surface: `RagIndexer`,
`RagSearcher`, `aphrody-command::rag_cmd`, `aphrody-mcp::rag_tools::open_store`,
`app-server::rag_store`. Upstream: `Graphify-Labs/graphify`, branch `v8`
(head `5c7b84792f453582676548185aaec3824d51dfe2`, 2026-10-05), Apache-2.0 (plus MIT
file and NOTICE), package 0.9.77; tree-sitter based extractors for about 25 languages,
`extract.py` 428 KB, `build.py`, `cluster.py`, `analyze.py`, `report.py`, `serve.py`.

### 1.6 Duplication that the target removes

- RAG database path: 4 resolutions (`vector/rag.sqlite`, `rag/index.db`, config `rag.db_path`, domain `crawl/rag.sqlite`).
- Memory layouts: `memory_items` (SqliteBackend), `memory_records` (SqliteLocal, the one on disk), JSONL, LanceDB option, Mem0/Honcho HTTP.
- Vector stores: RAG BLOB scan, memory BLOB scan, Redis cosine store (Bun), LanceDB option; `vec0` qualified but unused.
- Training stores: PG registry, JSONL files, Redis `TrainDb`, `pipeline-state.json`.
- Document corpora: docs and chunks tables (rag), `documents` (knowledge.db x4), `files` (fsindex), Graphify `graph.json`.
- Session sync: Rust external mirror, TS `agent-sync.ts` loop, MCP `sync_external_agents`, `aphrody ai sync-sessions`.

## 2. Target architecture

### 2.1 Agent home and database

- Root `~/.aphrody` from `aphrody-models::paths::state_dir()` (`APHRODY_HOME` override).
  XDG compatibility is added in that one function (batch 8): `APHRODY_HOME`, else an
  existing `~/.aphrody`, else `$XDG_DATA_HOME/aphrody` when set, never moving data.
- Domain homes `workspaces/{aphrody,dbfr,ie}` stay isolated. Profile resolution stays in
  `aphrody-agent-home::paths` (`named_profile_workspace`).
- **One database file per home**: `<home>/db/aphrody.sqlite` where `<home>` is
  `state_dir()` for the unprofiled global home and the profile home for a domain.
  Isolation is by file, never by a column. A profile never reads the global file.
- Engine SQLite 3.5x bundled through `aphrody-sql` (WAL, FK, busy timeout, optimize),
  migrations versioned by `aphrody_migrations` (checksummed, immutable once applied).
- Vectors: BLOB column with the existing RAG layout (f32, model id and dimension recorded)
  as the baseline; `vec0` virtual tables created by an additive migration when the `vec`
  feature is on; the LanceDB option is dropped after parity (no `.lance` store exists).

### 2.2 Crates

| Crate | Status | Responsibility |
| --- | --- | --- |
| `aphrody-store` (crates/ai/store, new) | owner of the **database**: path resolution, open, migrations, schema, backup with sha256, importers, `sync_state`, `pipeline_runs`, typed access for sources/files/graph/memories/sessions/train | depends on `aphrody-sql`, `aphrody-models`, `aphrody-agent-home`; no embedding, no network |
| `aphrody-code-graph` (crates/ai/code-graph, new) | native Graphify equivalent: tree-sitter extraction, graph model, communities, god nodes, `query/path/explain`, report, `graph.json` read/write | writes through `aphrody-store`; Graphify Python is only the oracle in tests |
| `aphrody-rag` | owner of **retrieval and the pipeline**: stages classify/chunk/embed/index, unified hybrid search over chunks + graph + memories (one RRF), context assembly | `RagStore::open` keeps its API and now opens the unified file; baseline migration is byte-identical to today's DDL |
| `aphrody-memory`, `aphrody-session`, `aphrody-train` | keep their domain APIs; persistence becomes thin adapters over `aphrody-store` tables (`memories`, `sessions/messages`, `train_*`); PG registry stays an optional sink | no second store |
| `aphrody-agent-home` | unchanged API; exposes `db_path(profile)` helper by calling the store | documents stay files |
| `aphrody-rust` (`rag-python`) | still calls `aphrody-rag-core`; Python reaches the index only through the CLI/MCP or a later binding on `aphrody-rag`; no second index | coordinated with the vu agent through the claim notes |

### 2.3 Schema (migrations in crates/ai/store/migrations)

- `0001_rag_baseline`: `docs`, `chunks`, `chunks_fts` (+ triggers), `vectors`, `meta`, exactly the current DDL (`IF NOT EXISTS`), so every existing RAG database upgrades in place.
- `0002_home_core` (additive): `sources(id, kind, label UNIQUE, root, meta_json)`; `files(source_id, rel_path, blake3, size, mtime_ms, class, lang, scanned_at, PK(source_id, rel_path))`; `ALTER TABLE docs ADD COLUMN source_id`; `pipeline_runs(id, source_id, stage, status, started_at, finished_at, stats_json, error)`; `sync_state(scope, key, value, blake3, updated_at)`; `backups(id, path, sha256, bytes, reason, created_at)`.
- `0003_code_graph`: `graph_nodes(id, source_id, label, kind, file_path, loc, lang, community, attrs_json)`, `graph_edges(src, dst, relation, confidence CHECK IN ('EXTRACTED','INFERRED','AMBIGUOUS'), score, source_file, loc, weight, context)`, `graph_communities(id, source_id, name, size)`, `graph_nodes_fts` (label, file_path), indexes on `(src)`, `(dst)`, `(relation)`, `(file_path)`.
- `0004_memories`: `memories(id, ns, agent_id, content, tags_json, metadata_json, embedding, embedding_model, origin, created_at_ms, updated_at_ms)` + `memories_fts`; covers both `memory_items` and `memory_records` (`ns` holds the agent id or namespace).
- `0005_sessions`: `sessions(id, agent, domain, title, started_at, ended_at, source_path, source_blake3, records, meta_json)`, `messages(session_id, seq, role, content, ts, tokens_in, tokens_out, cost_usd, tool_json)` + `messages_fts`; default import is metadata only, message text only with an explicit flag.
- `0006_training`: `train_datasets`, `train_examples(dataset_id, id, kind, payload_json, split, text_sha256)`, `train_runs`, `train_artifacts`, `train_metrics`, `train_promotions`, view `train_split_leaks`; local mirror of the PG `training` registry (same names and constraints), PG remains the optional shared sink.
- `0007_vec` (feature `vec` only): `vec0` tables for chunks and memories.

### 2.4 One pipeline

`scan -> classify -> extract -> chunk -> embed -> index -> serve`, incremental by blake3,
idempotent (one transaction per file, upsert by `(source_id, rel_path)`), resumable
(`pipeline_runs` and per-file fingerprints; an interrupted run restarts at the first file
whose hash differs from the stored row).

| Stage | Library | Output |
| --- | --- | --- |
| scan | `ignore` walker with `.gitignore` plus `.graphifyignore`-compatible rules and a hard secret deny list (cookies, credentials, secrets, private, `.env`, models, `*.sqlite`) | `files` rows, change set |
| classify | extension + size + generated-file heuristics | `class` (code, doc, data, generated, binary, ignored), `lang` |
| extract | `aphrody-code-graph` for code classes (native); documents get structural headings only, no semantic LLM extraction | `graph_nodes/edges` |
| chunk | `aphrody-rag-core` chunkers | `docs`, `chunks`, FTS |
| embed | optional (`aphrody-embed` native/ort or configured endpoint); off by default, lexical only | `vectors` |
| index | single writer, WAL checkpoint after bulk | tables above |
| serve | `aphrody-rag` unified search; `aphrody-code-graph` query/path/explain | CLI, MCP |

`yolo scan` and the missing `yolo train` become thin delegates: `yolo scan --ingest`
(and the MCP `yolo_scan` with `ingest`) call `aphrody index`; the existing pure report
path (wyhash tree fingerprint) stays for its tests until `aphrody index --report`
reproduces it, then it is a delegate too. `yolo train` is created as a delegate of
`aphrody train`. No Bun reimplementation of ingestion.

### 2.5 One RAG

`aphrody-rag` owns hybrid search over **chunks, code graph and memories**: lexical FTS5 per
table, optional vector scan (`vec0` when available), one RRF from `aphrody-rag-core::fusion`,
optional rerank; results carry `kind` (`chunk|node|memory`), source, path and line, channel
and score. Python (`rag-python`, `py/`) and Bun (`yolo ai`, MCP) reach it only through the
CLI/MCP. No second index.

### 2.6 Interfaces (single surface)

CLI `aphrody` verbs (new module in `aphrody-store`/`aphrody-rag`, wired into
`aphrody-command` with minimal hunks re-read before editing): `index` (run the pipeline),
`graph` (build, query, path, explain, report, export), `query` (hybrid retrieval and
context), `memory` (add, search, list, import), `session` (sync, list, show), `train`
(datasets, runs, promote, import), `sync` (store backup, verify, import preview/apply),
all with `--profile` and `--home`, JSON by default for agents, human text with `--text`.
Compatibility aliases: `aphrody rag ...`, `aphrody scan`, `aphrody ai sync-sessions`,
`aphrody-agent-home-memory`, `aphrody-agent-train` keep working and delegate to the same
library. `aphrody-mcp` exposes `home_index`, `home_query`, `home_graph`, `home_memory`,
`home_session`, `home_train`, `home_sync`; the existing tool identities
(`aphrody_rag_search`, `aphrody_rag_context`, `sync_external_agents`, `infra_sync`) are
contracts and stay as aliases.

### 2.7 Sync and backup

- `aphrody sync` (and `aphrody infra sync --store`) operates on the home database:
  **preview by default, `--apply` to write**.
- Every apply starts with a checksum-verified backup: `VACUUM INTO` a temp file under
  `private/backups/aphrody-unique/<date>/`, sha256 recorded in `backups` and a sidecar
  `.sha256`, verification by reopening and `PRAGMA integrity_check` (ADR D12 location; no
  second copy elsewhere).
- Domain session sync (`agent-sync.ts` -> MCP `sync_external_agents`) writes the JSONL
  mirror as today and then upserts `sessions` rows through the same library; its output
  directory check against `workspaces/<domain>/sessions` stays.
- `aphrody infra sync` keeps its repository/worktree meaning; the store target is an
  additive option.

## 3. Decisions per item

| Item | Target |
| --- | --- |
| `aphrody-sql` | stays the single SQL owner; store uses its runner and `vec` feature |
| `aphrody-models::paths` | stays the path authority; XDG added there (batch 8) |
| `aphrody-agent-home` | stays; gains `db_path(profile)` only |
| `aphrody-store` | **new**, the database owner |
| `aphrody-code-graph` | **new**, native Graphify; Graphify becomes parity oracle then leaves the execution path |
| `aphrody-rag` | RAG owner and pipeline; `RagStore::open_default` and the CLI/MCP defaults resolve the home database; `vector/rag.sqlite` and `rag/index.db` become read-compat fallbacks, then are removed from code |
| `aphrody-rag-core`, `rag-eval`, `embed` | unchanged owners |
| `aphrody-rust` (`rag-python`) | unchanged, no second index; follow-up with the vu agent for a binding on `aphrody-rag` |
| `aphrody-memory` | domain API stays; `SqliteBackend` (`memory_items`) and `SqliteLocalProvider` (`memory_records`) are replaced by one `HomeMemory` adapter; JSONL and "HNSW" kept as in-memory/test backends; LanceDB, Mem0 and Honcho kept as optional remote providers until measured; no removal of providers in this plan |
| `aphrody-session`, `rollout` | JSONL stays the transcript store; `sessions/messages` is the queryable index; `external` sync writes both |
| `aphrody-train` | runner, lease and gates stay; registry gains the local SQLite mirror; PG registry stays optional |
| `packages/engine/core/src/redis/{traindb,vector}.ts` and tools `yolo_traindb_stats`, `yolo_vector_search` | delegate to `aphrody train`/`aphrody query`; Redis code removed after parity (Redis is cache only, ADR D1) |
| `yolo scan` | delegate of `aphrody index`; pure fingerprint report retained until reproduced |
| `yolo train` | new thin delegate of `aphrody train` |
| `aphrody index` (fsindex), `aphrody scan` (manifests) | `index` becomes the pipeline verb (fsindex data imported into `files`); manifest analytics stays under `aphrody scan` |
| `knowledge.db` (4 files) and legacy `~/.aphrody/packages/knowledge` | imported, files kept read-only; legacy scripts replaced by the pipeline |
| `jobs.db`, `ocr/results.db`, `translations.sqlite`, `cache.sqlite` | owners unchanged in this plan; OCR becomes a pipeline source in a later batch |
| Graphify skill and `CLAUDE.md`/`AGENTS.md` paragraph | rewritten to `aphrody graph` after parity |

## 4. Graphify absorption

### 4.1 Provenance (batch 1)

Add `tools/config/upstream-sources.json` entry `graphify` (tier `integrated`, role "port source
and parity oracle"): `upstreamUrl https://github.com/Graphify-Labs/graphify`, ref `v8`,
`upstreamCommit 5c7b84792f453582676548185aaec3824d51dfe2`, version 0.9.77, license
Apache-2.0 (LICENSE, LICENSE-MIT, NOTICE preserved), `integratedPath crates/ai/code-graph`,
`upstreamPackageIdentityPreserved false`. Reading is done with `aphrody git api` (REST,
no clone) and the wheel installed by `uv tool install graphifyy`. A private mirror
repository under `aphrody-labs` is created only if the owner wants a vendored tree; no
fork or visibility change on any public repository. crates/ai/code-graph/NOTICE keeps
the Apache-2.0 attribution and a statement of changes for every ported file.

### 4.2 Native crate `aphrody-code-graph` (batch 4, then growth)

Concepts kept from Graphify: nodes (`code`, `document`, `concept`, `rationale`), edges with
`relation` and `EXTRACTED | INFERRED | AMBIGUOUS` + `confidence_score`, communities,
god nodes (highest degree excluding noise), surprising connections, `query` (BFS with a
token budget), `path` (shortest path), `explain` (node and neighbors grouped by file),
`GRAPH_REPORT.md`, `graph.json` (same keys: `directed, multigraph, graph, nodes, links,
hyperedges, built_at_commit`). Differences: storage in the home database (JSON is an
export), no LLM labelling (community names from the highest-degree member), no external API.
Languages in order: Rust, TypeScript/JavaScript, Python, then Go, Java, C/C++, C#, Ruby,
PHP, Bash, JSON/TOML config, Markdown headings, following Graphify's extractor list.
Parser choice is measured: tree-sitter (0.26.x, grammars verified on crates.io at batch 4)
is the uniform default; `syn` and `oxc`, already in `rag-core`, are reused only if the parity
numbers show a benefit. Communities: modularity optimisation (Louvain/Leiden) implemented
natively; ids are not required to match the oracle, quality (modularity) is.

### 4.3 Parity criteria (all must pass before Graphify leaves the execution path)

Oracle: Graphify 0.9.77 `graphify update` on committed fixture repositories
(`crates/ai/code-graph/tests/fixtures/{rust,ts,py}`, about 30 files each) with the expected
JSON snapshots committed; env `APHRODY_GRAPHIFY_ORACLE=1` re-generates them.

- P1 format: our `graph.json` loads in `graphify query/explain/path`; Graphify's loads in our reader (round trip, node and edge counts equal).
- P2 fixtures: node set (file, label, kind) Jaccard >= 0.95; edge set for `contains`, `defines`, `imports_from`, `method`, `extends`, `implements` Jaccard >= 0.95; for `calls` and `references` >= 0.90; confidence class agreement >= 0.95.
- P3 repository: on this repository restricted to first-party Rust, TS and Python, per-relation counts within 10 %, no generated/vendored tree, wall time not worse than `graphify update` on the same files (claim only with the measurement).
- P4 queries: 20 reference queries; `explain` neighbor sets overlap >= 0.8; `path` length equal; `query` top-10 node overlap >= 0.7.
- P5 structure: community modularity within 0.05 of the oracle; top-10 god nodes overlap >= 0.7.
- P6 integration: graph tables populated through the pipeline are incremental (second run with no change writes 0 rows) and survive a kill mid-run.

After P1 to P6: remove the Graphify call from docs, skill and `CLAUDE.md`; keep the wheel
only in `tests/oracle`.

## 5. Safety and migration protocol

1. Before any schema change or import `apply`: `aphrody sync backup` creates a verified
   backup of the target database (if it exists) and records sha256.
2. Importers read legacy stores **read-only** (`mode=ro`, never WAL checkpoint them) and
   write only the new file. Legacy files are never moved, truncated or deleted. Compat
   symlinks are not needed because paths are not changed.
3. Each importer has `--dry-run` (default) printing counts only; `--apply` writes; import
   is idempotent by source key (`origin`, legacy id, blake3).
4. Tests use fixtures and temporary copies; the real import is run once after the dry run
   and its counts are recorded in `MEMORY.md`.
5. The pipeline refuses paths matching the secret deny list and never stores credential
   files; message text of sessions is opt-in.

## 6. Batches (ordered by value and risk)

| # | Batch | Gate | Status |
| --- | --- | --- | --- |
| 0 | This plan, inventory, claim | docs gate `yolo ops docs-links --root . --docs docs --scope docs` | this commit |
| 1 | `aphrody-store`: path resolution, open, migrations 0001-0006 (schema for all later batches), backup with sha256, `files/sources/pipeline_runs/sync_state`, deny list, unit tests; Graphify reference provenance entry | VPS `test -p aphrody-store` (36 tests), `clippy --all-targets -D warnings` | done |
| 2 | Importers with dry-run: Graphify `graph.json` (streamed), memory, legacy rag, session index (metadata only) with the `aphrody-store` transitional CLI (`status`, `backup`, `import ... [--apply]`); remaining: knowledge.db (needs the rag chunkers, batch 3), fsindex `files`, train dirs; real dry-run counts on this machine | same + fixtures | code done, real dry run pending |
| 3 | Unified retrieval in `aphrody-rag`: `RagStore::open_home`, one hybrid search over chunks + graph + memories (`unified_search`, one RRF), pipeline `scan -> classify -> extract -> chunk -> index` with `files` fingerprints, incremental, resumable, removal of vanished documents; embedding stays an optional later stage | VPS tests (`aphrody-rag` 35 + 12), clippy `-D warnings` | done (lexical; vector channel pending) |
| 4 | `aphrody-code-graph`: model, `graph.json` export and import round trip, query/path/explain/report, Louvain communities, god nodes, Rust extraction (tree-sitter 0.27) with call resolution and stub folding, incremental build over the store (scan, per-file cache by BLAKE3, resume); oracle fixture and snapshot (tests/fixtures/rust, P2: nodes 1.000, edges 0.981); whole-repository measurement against Graphify on first-party Rust (nodes 0.9993, method 1.000, contains 0.993, case_of 0.993, implements 0.985, inherits 0.971, calls 0.897, references 0.747, imports_from 0.471); remaining: references and imports_from stub folding, TS/JS/Python, P3 to P6 | VPS tests (28 + 1 oracle), clippy `-D warnings` | Rust extractor measured, P2 met on the fixture, repository thresholds not yet met for references and imports_from |
| 5 | Code-graph breadth: TS/JS and Python, communities, god nodes, P2 to P6 complete; Graphify leaves the execution path | parity report committed | |
| 6 | CLI verbs: `aphrody home status|backup|import|index|query` and `aphrody graph build|query|explain|path|report|export` wired through the multi-call table (done); remaining: `memory`, `session`, `train`, `sync` verbs, compatibility aliases for `aphrody rag|index|scan`, MCP `home_*`, `rag_tools` default | VPS check/clippy/tests, MCP smoke | partly done |
| 7 | Bun delegates (done: `yolo scan --ingest`, `yolo train`; remaining: `yolo scan --ingest`, `yolo train`, `yolo_scan`/`yolo_vector_search`/`yolo_traindb_stats`; Redis TrainDb/vector removed after parity; plugin skills and docs updated (plugin repos committed then pointer bumped) | `bun test` for touched TS, oxlint, oxfmt, tsc, docs gate | |
| 8 | Sync: `aphrody home sync [--apply]` (done: integrity check, backup ledger verification, session index, preview by default, verified backup before apply); remaining: `aphrody sync` alias,  `infra sync --store`, domain session sync writing `sessions`; XDG resolution in `aphrody-models::paths`; removal of replaced code after the rollback window (old stores kept) | gates + backup restore test | |

Each batch: explicit pathspecs, author `aphrody-dev <contact@aphrody.com>`, no assistant
attribution, `git push workspace main` (rebase on conflict, never force), one dated line
in `MEMORY.md` for this claim.

## 7. Risks

- Root `Cargo.lock`/`Cargo.toml` are dirty from other agents; new crates and their lock
  entries are committed with a pathspec/index-level extraction of this claim's hunks only.
- `crates/infra/aphrody-command` and `crates/ai/mcp` are held by the bxc/n2b agent: the new
  logic lives in new crates and the wiring hunks are minimal and re-read before editing.
- `rag-python` and `packages/engine/yolo/src/{vu,python}.ts` belong to the vu agent: no edit there.
- Large corpora (about 740 transcript files, 440 MB) make a full message import heavy and
  sensitive: metadata-only by default.
- A native port of a 428 KB extractor is long; parity is measured per language and the
  oracle stays in tests until each language passes.
- Plugin skill repositories are separate (`plugin-aphrody`, `plugin-yolo`, `plugins`):
  commit order is skill repo, then pointer bump.
