<!-- SPDX-License-Identifier: Apache-2.0 -->
# Training data on SQL databases (2026-10-01)

Scope: dataset registries; run, artifact, eval and promotion metadata; lineage;
content-hash dedup; triple and hard-negative mining for E5 embedders and BGE
rerankers; LoRA/QLoRA dataset preparation; export from SQL. Versions come from
GitHub, PyPI and crates.io on 2026-10-01. `UNVERIFIED` marks claims without a
primary source.

## 1. Registries and lineage tools

| Tool | Version | Licence | SQL role | Notes |
|---|---|---|---|---|
| MLflow | 3.16.1 (2026-09-17) | Apache-2.0 | Backend store is any SQLAlchemy URI (PostgreSQL, MySQL, MSSQL, SQLite; default `sqlite:///mlflow.db`). Run `mlflow db upgrade` before starting a new server version. | Model stages are deprecated since 2.9; use **aliases** (`models:/name@champion`) plus tags. MLflow 3 adds **LoggedModel** as a first-class entity. [backend store](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/), [registry workflow](https://github.com/mlflow/mlflow/blob/master/docs/docs/classic-ml/model-registry/workflow.mdx), [MLflow 3](https://github.com/mlflow/mlflow/blob/master/docs/docs/classic-ml/mlflow-3/index.mdx) |
| Aim | 3.29.1 (2025-05-08) | Apache-2.0 | RocksDB for sequences, SQLite (`run_metadata.sqlite`, Alembic) for run metadata | Low activity. [storage](https://github.com/aimhubio/aim/blob/main/docs/source/understanding/data_storage.md) |
| DVC | 3.67.1 (2026-03-31) | Apache-2.0 | none (files) | Content-addressed cache keyed by MD5 of file contents. [internal files](https://github.com/iterative/dvc.org/blob/main/content/docs/user-guide/project-structure/internal-files.md) |
| lakeFS | 1.88.0 (2026-10-01) | **BSL 1.1 since 2026-09-22** (was Apache-2.0) | metadata KV (Postgres option) | Licence change: check the use grant before adopting. [LICENSE](https://github.com/treeverse/lakeFS/blob/master/LICENSE) |
| HF `datasets` | 5.0.1 (2026-07-28) | Apache-2.0 | none (Arrow/Parquet) | Fingerprint = hash of the Arrow table/files chained with a hash of each transform. [cache](https://github.com/huggingface/datasets/blob/main/docs/source/about_cache.mdx) |
| OpenLineage | spec 2-0-2, python 1.53.0 | Apache-2.0 | event spec | Run states START/RUNNING/COMPLETE/ABORT/FAIL/OTHER; facets include `DatasetVersion`, `ColumnLineage`, `DataQualityMetrics`. [spec](https://github.com/OpenLineage/OpenLineage/blob/main/spec/OpenLineage.json) |
| Marquez | 0.51.1 tag (2025-03) | Apache-2.0 | PostgreSQL | Reference OpenLineage server; low activity. [repo](https://github.com/MarquezProject/marquez) |

**Takeaway:** for a single-owner, private stack, a small hand-written
PostgreSQL schema is enough, and Aphrody already has one on Neon. Borrow the
concepts rather than the servers:
- Content-addressed dataset versions (DVC, `datasets`).
- Aliases for promotion (MLflow).
- Typed run states and input/output edges (OpenLineage).

Adopt MLflow only if a UI and experiment comparison become necessary. Its
Postgres backend can then share the Neon project in a separate schema.

## 2. Reference schema (synthesis)

This is not a standard. It maps MLflow, OpenLineage and DVC concepts onto
PostgreSQL 18.

| Table | Purpose | Key columns |
|---|---|---|
| `datasets` | logical dataset | `name`, `kind` |
| `dataset_versions` | immutable, content-addressed snapshot | `content_sha256 bytea UNIQUE`, `row_count`, `parent_version_id`, `source_commit`, `uri` |
| `examples` (optional) | per-row identity for split and leak checks | `text_sha256`, `minhash` (bytea), `split CHECK (split IN ('train','val','test'))` |
| `runs` | job execution | `kind`, `state` (OpenLineage), `params jsonb`, `code_commit`, `started_at`, `finished_at` |
| `run_inputs` / `run_outputs` | lineage edges | `(run_id, dataset_version_id)` |
| `artifacts` | produced files | `format`, `uri`, `sha256`, `size_bytes` |
| `evals` | metrics vs baseline | `artifact_id`, `eval_version_id`, `metric`, `value`, `baseline_value`, `params jsonb` (ANN settings) |
| `promotions` | alias moves | `alias`, `artifact_id`, `eval_id`, `status`; a partial UNIQUE index ensures one live alias |

```sql
-- One live 'champion' per model kind, enforced by the database.
CREATE UNIQUE INDEX promotions_one_live
  ON training.promotions (kind, alias) WHERE status = 'promoted';
```

**Eval gate:** promote only if every required metric is at or above its
baseline plus a margin, measured on a version that is **hash-disjoint from
training**. Aphrody's gate is ΔRecall@5 ≥ +0.01 with per-tag regression
≤ 0.03 (`crates/ai/train/src/lib.rs`).

## 3. Dedup

| Level | Method | Tools (licence) |
|---|---|---|
| Exact | SHA-256 of NFC-normalised, whitespace-collapsed text; `UNIQUE` plus `ON CONFLICT DO NOTHING` | Postgres `sha256()`, Rust `sha2`; datatrove `ExactDedup*` (Apache-2.0) |
| Near-duplicate | MinHash LSH over 5-gram shingles (datatrove defaults: 14 buckets × 8 hashes) or SimHash | datatrove 0.10.1 (Apache-2.0), text-dedup 0.4.1 (Apache-2.0), datasketch 2.0.0 (MIT). [datatrove minhash](https://github.com/huggingface/datatrove/blob/main/src/datatrove/pipeline/dedup/minhash.py), [text-dedup](https://github.com/ChenghaoMou/text-dedup), [datasketch](https://github.com/ekzhu/datasketch) |
| Semantic | Cluster embeddings and drop near-identical members (SemDeDup) | SemDeDup repo is archived (licence UNVERIFIED); semhash 0.5.0 (MIT). [paper](https://arxiv.org/abs/2303.09540) |

**Split leakage:** dedup *before* assigning splits, and assign whole duplicate
clusters to one split. Persist `text_sha256` for every train and gold row, so
a leak check is one SQL anti-join instead of substring heuristics:

```sql
SELECT count(*) FROM training_examples t
JOIN gold_examples g USING (text_sha256);   -- must be 0
```

## 4. Embedder (E5) and reranker (BGE) fine-tuning data

### sentence-transformers 6.1.0 (2026-09-18, Apache-2.0)

- v6.0.0 (2026-08-18) added `MultiVectorEncoder` (ColBERT-style) and moved to
  transformers v5. `MultipleNegativesRankingLoss` and `CachedMNRL` remain.
  [releases](https://github.com/UKPLab/sentence-transformers/releases)
- `util.mine_hard_negatives(dataset, model, corpus=None, cross_encoder=None, range_min=0, range_max=None, max_score=None, min_score=None, absolute_margin=None, relative_margin=None, num_negatives=3, sampling_strategy="top", output_format="triplet"|"n-tuple"|"labeled-pair"|"labeled-list", use_faiss=False, ...)`.
  [source](https://github.com/UKPLab/sentence-transformers/blob/main/sentence_transformers/util/hard_negatives.py)
- **Positive-aware mining (NV-Retriever):** `range_max=50, max_score=0.8,
  relative_margin=0.05, sampling_strategy="top"`. This is the "TopK-PercPos
  (95%)" method: any candidate scoring above 95% of the positive is discarded
  as a likely false negative. [paper](https://arxiv.org/abs/2407.15831); the 95%
  figure is taken from the sentence-transformers docstring.
- **E5 prefixes are mandatory:** `query: ` and `passage: ` for asymmetric
  retrieval. Without them performance degrades.
  [model card](https://huggingface.co/intfloat/multilingual-e5-large)

### FlagEmbedding 1.4.2 (2026-08-24, MIT)

- Training JSONL: `{"query", "pos": [], "neg": [], "pos_scores": [], "neg_scores": [], "prompt", "type"}`.
  [embedder README](https://github.com/FlagOpen/FlagEmbedding/blob/master/examples/finetune/embedder/README.md)
- **`scripts/hn_mine.py` (not in repo):** `--range_for_sampling` defaults to `10-210`; use
  `60-300` for easier negatives. `--negative_number` defaults to 15;
  `--candidate_pool` sets the corpus. Mining is rank-only, so false negatives
  are possible. [hn_mine.py](https://github.com/FlagOpen/FlagEmbedding/blob/master/scripts/hn_mine.py)
- **Distillation:** `scripts/add_reranker_score.py --reranker_name_or_path BAAI/bge-reranker-v2-m3`
  fills the scores; then train with `--knowledge_distillation True`.
- **Reranker data:** the same JSONL (without `type`); input is built as
  `query [sep] passage [sep] prompt`.
  [reranker README](https://github.com/FlagOpen/FlagEmbedding/blob/master/examples/finetune/reranker/README.md)

### Mining recipe backed by SQL

1. Store queries and positives with `text_sha256`, already gold-filtered.
2. Get candidates from the **current production index** (pgvector or
   sqlite-vec, plus BM25), top 50–200 per query. Mining from the same index
   you will be evaluated on gives the hardest, most realistic negatives.
3. Drop candidates whose score is ≥ 0.95 × the positive's score, or which a
   cross-encoder scores above the positive. Drop candidates from the same
   source document (or URL) as the positive.
4. Persist the triples as a `dataset_versions` row with the content hash of
   the JSONL. Record the miner model, the range and the margin in `params`.

## 5. LoRA / QLoRA dataset preparation

| Tool | Version | Licence | Dataset formats |
|---|---|---|---|
| TRL | 1.14.1 (2026-09-29) | Apache-2.0 | conversational `{"messages": [...]}`, `{"prompt", "completion"}`, conversational prompt-completion; `packing=True`; `assistant_only_loss=True` needs `{% generation %}` in the chat template; `completion_only_loss` is on by default for prompt-completion. [SFT docs](https://github.com/huggingface/trl/blob/main/docs/source/sft_trainer.md) |
| PEFT | 0.21.2 (2026-10-01) | Apache-2.0 | `LoraConfig(r, lora_alpha, target_modules)` |
| Unsloth | 2026.9.14 (PyPI) | Apache-2.0 | TRL formats; fast 4-bit kernels |
| Axolotl | 0.20.0 (2026-09-30) | Apache-2.0 | `pretrain`, `completion`, `input_output`, `chat_template`, `alpaca`, pre-tokenized. [formats](https://github.com/axolotl-ai-cloud/axolotl/blob/main/docs/dataset-formats/index.qmd) |

- **QLoRA:** NF4 4-bit base weights, double quantization of the quantization
  constants, and paged optimizers.
  [arXiv 2305.14314](https://arxiv.org/abs/2305.14314)
- **Template choice:** render with the **target model's own chat template**,
  the one that will serve it (GGUF metadata in llama.cpp, or the tokenizer's
  template). A mismatch silently degrades adapters.
- **Dedup:** dedup conversations by hash of the rendered prompt. Stratify
  splits by source and tag.

## 6. Exporting from SQL

- **PostgreSQL:** `COPY { table | (query) } TO STDOUT` in text, csv or binary
  format; there is no JSON format.
  [COPY](https://www.postgresql.org/docs/current/sql-copy.html)
  - For JSONL, watch out: `COPY ... TO STDOUT` in **text** format doubles
    backslashes. JSON escapes such as `\n` then come out as `\\n` and the file
    is corrupt. Use one of:
    - `psql -At -c "SELECT row_to_json(t) FROM (...) t"`;
    - `\copy (...) TO 'f.jsonl' WITH (FORMAT csv, QUOTE e'\x01', DELIMITER e'\x02')`;
    - a client-side writer (tokio-postgres or postgres.js).
- **DuckDB:** `ATTACH 'dbname=...' AS pg (TYPE postgres, READ_ONLY); COPY
  (SELECT ...) TO 'triples.parquet';`. Reads use binary COPY.
  [DuckDB postgres](https://duckdb.org/docs/current/core_extensions/postgres/overview.html)
- **Recording an export:** compute the SHA-256 of the exported file, then
  insert `dataset_versions(content_sha256, row_count, uri)`. The registry
  stores metadata only; the bytes stay in the protected store (repository
  rule).

## 7. Current Aphrody state (observed 2026-10-01)

**Registry:** none. The registry must be generic, reusable by every Aphrody training (any model, any domain), and lives in the Neon project `aphrody` (`APHRODY_TRAINING_DATABASE_URL`, direct; `APHRODY_TRAINING_DATABASE_URL_POOLED`, runtime). The draft's lessons still apply to the next design: dataset lineage, code commit on runs, validated `sha256`, generic metrics instead of hard-coded Recall@5, one live promotion per alias.

**No code writes the registry.** Searching this repository and
`../aphrody-py` finds no writer of `training.*` or of
`APHRODY_TRAINING_DATABASE_URL`. `crates/ai/train` persists `events.jsonl`
and `triples.jsonl` to disk only.

**Triples:** `aphrody-py/.../aphrody_train/triples.py`
- Queries are the first sentence of a chunk (synthetic).
- The negative is the chunk at `(idx + n/2) % n`. It is **positional and
  random, not a hard negative**.
- Gold-leak guard: substring and URL matching against gold JSONL.

**Trainers:**
- `embed.py`: `CachedMultipleNegativesRankingLoss`, default
  `intfloat/multilingual-e5-small`, with correct `query:`/`passage:` prefixes.
- `rerank.py`: `BinaryCrossEntropyLoss` on (query, pos/neg), default
  `BAAI/bge-reranker-base`.
- `lora.py`: TRL `SFTTrainer` with PEFT `r=4`.
- `pyproject` pins `sentence-transformers>=5.0`, while upstream is now 6.1.

See [recommendations.md](recommendations.md) for the changes this implies.
