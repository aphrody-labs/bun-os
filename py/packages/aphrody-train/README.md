# aphrody-train

Training surface for aphrody (P10, docs/plans/codex-oss.md):
- `triples`: Generates dataset triples `(query, positive, negative)` from distinct source chunks, with exact-hash gold-leak gates, optional MinHash near-duplicate clustering before split assignment and mined hard negatives (see below). A supplied `--gold-file` must be readable and nonempty.
- `embed`: Fine-tunes dense text embeddings with MultipleNegativesRankingLoss / Matryoshka and exports to ONNX.
- `rerank`: Fine-tunes cross-encoder rerankers and exports to ONNX.
- `lora`: Fine-tunes a PEFT LoRA adapter from guarded `dataset rollouts` output, then converts it to a verified GGUF adapter with llama.cpp. Explicit NF4 QLoRA is available for qualified CUDA training hosts; DPO training is not implemented.
- `dry_run`: Runs actual CPU all-MiniLM training on 50 deterministic probe triples and verifies its ONNX export; it requires the full training dependencies.
- `dataset rollouts|dpo`: Exports redacted JSONL from Rust rollout records. Successful turns require a final message and successful tool results. DPO pairs require a failed/denied call followed by a successful same-tool repair in one turn. Both require `--gold-file`; rows that hash to a gold query, sentence, title or URL are excluded, rows gain `text_sha256` of the prompt, and identical content from different sessions is kept once.
- `hashing gold`: Writes a copy of a gold JSONL with additive `text_sha256` / `target_sha256` fields for registry anti-joins.
- `protocol`: Emits streaming JSONL events (`start`, `progress`, `eval`, `checkpoint`, `artifact`, `done`, `error`) to stdout.

Install `--extra full` before `embed` or `rerank`. Both commands require a
nonempty triples JSONL file, train a checkpoint, export ONNX and verify its
output against the trained model before emitting `artifact` and `done`.

Run these commands from the selected Aphrody `py/` workspace. Set
`APHRODY_PY_ROOT` when the deployed workspace uses another declared path.

LoRA preserves the full precision base model by default. It
requires a local Hugging Face base model, a prepared directory containing
`rollouts.jsonl` from `dataset rollouts`, the untouched gold JSONL, and an
official llama.cpp checkout. Set `APHRODY_LLAMA_CPP_CONVERTER` to its
`convert_lora_to_gguf.py` path, then run with `uv run --package aphrody-train
--extra full python -m aphrody_train.lora --rollout-dir <prepared-dir>
--gold-file <gold.jsonl> --base-model <local-model-dir> --output-dir <output-dir>`.
The output `adapter.gguf` is a LoRA adapter and needs the matching base model
in GGUF at inference time; it is not a standalone merged model. The trainer
rechecks gold overlap, redacts known secret forms, and verifies nonzero finite
adapter weights and GGUF tensor pairs before reporting success. Model quality
still requires an independent evaluation before promotion.

The official converter runs with a qualified CPython entry point. Standalone
Python uses its own `sys.executable`; native Bun embedding reports Bun there,
so set `APHRODY_LORA_CONVERTER_PYTHON` (or `--converter-python`) to the absolute
Python executable from the locked training environment. This selection is
validated before loading the model. It does not replace the shared interpreter
used for training or change another SDK consumer's `sys.executable`.

For an exclusive GPU training job, `--quantization nf4` (or
`APHRODY_LORA_QUANTIZATION=nf4`) loads the same local Hugging Face base through
bitsandbytes NF4 with double quantization, prepares it with PEFT's
`prepare_model_for_kbit_training`, and uses a paged 8-bit optimizer. The qualified
GPU environment installs the locked `full` and `qlora` extras (`bitsandbytes==0.50.0`);
this option fails if CUDA or
that dependency is absent. It never silently trains on CPU or downloads another
base. The host scheduler must acquire an exclusive GPU lease and suspend its
inference allocation first. An 8 GiB GPU is a candidate to qualify, not a memory
capacity guarantee.

Completed output directories are refused. Each successful export adds a private
`training-manifest.json` with base config, dataset, untouched gold and adapter
SHA-256, quantization mode and step count. `promoted` remains false; training
does not change the active model. Compare the candidate against the current
adapter on untouched gold before promotion.

Implementation follows the [Transformers bitsandbytes guide](https://huggingface.co/docs/transformers/main/quantization/bitsandbytes)
and [PEFT quantization guide](https://huggingface.co/docs/peft/developer_guides/quantization).

The source-only training container is declared in
`tools/config/container/gpu-fleet/Dockerfile.train`. It requires an immutable,
already qualified native Bun/Buv/PyJS/CPython/Aphrody-train runtime image and
consumes `py/uv.lock` with `--locked --extra full --extra qlora`. Builds belong
to the declared VPS factory; datasets, model weights, provider stores and run
output are separate protected runtime mounts. A source Dockerfile or a passing
metadata check does not qualify an Omar GPU training run.

The same trainer is callable through the native Python SDK as
`sdk.invoke('aphrody_train.lora', 'run_lora_job', [request])`. The JSON request
names absolute `rollout_dir`, `gold_file`, `base_model`, `converter` and
`output_dir` paths, plus `job_id`, positive integer `steps` and explicit
`quantization` (`none` or `nf4`). The function emits the existing job protocol,
returns the verified export manifest only after success, and keeps the same
gold, secret, converter and completed-output guards. The host scheduler must
hold the exclusive GPU allocation for the entire invocation; runtime/package
qualification remains separate from this source adapter.
The optional `converter_python` names that same qualified absolute CPython
entry point; otherwise the deployed environment supplies it.

CPU receipt of 2026-10-09: Bun `1.4.3-aphrody.4 (41211b568)` and CPython
3.12.15 execute the SDK job in the same PID, reject gold overlap before
loading Torch, and select the existing training virtualenv's CPython entry
point for conversion. Its separate CPU probe reports that virtualenv prefix
and CPython 3.12.15. This evidence covers the native boundary and interpreter
selection; it does not qualify GPU training or a GGUF conversion.

Dataset extraction is available as `uv run --package aphrody-train python -m aphrody_train.dataset rollouts --rollout-dir <dir> --gold-file <gold.jsonl> --output-dir <dir>` (or `dpo`). Redaction covers credential fields and common token forms; review generated datasets before external publication because arbitrary secrets cannot be recognized by patterns alone.

## Triples, leak and dedup gates

`python -m aphrody_train.triples` runs, in order (D11 of
`docs/decisions/infra/sql-convergence.md` in the Aphrody monorepo; background
in `docs/research/ai/sqllm/training.md` there):

1. **Hashing.** `aphrody_train.hashing` normalises text with NFC, collapses
   every run of Unicode whitespace to one space and strips it, then takes the
   SHA-256 hex of the UTF-8 bytes. `casefold=True` folds case first. Emitted
   rows carry `text_sha256` (no casefold) of their anchor text, the triple
   query or the rollout prompt; gold rows hashed with `hashing gold` use the
   same rule on the gold query, so the registry leak check is
   `JOIN gold USING (text_sha256)`. Rows also carry `text_casefold_sha256`.
2. **Exact dedup.** Chunks whose casefolded passage hash was already seen are
   dropped (`exact_duplicates`).
3. **Gold anti-join** (`aphrody_train.gates.GoldIndex`). In memory, a row leaks
   when one of its keys is a gold key. Keys are the casefolded hashes of the
   whole query, passage and title, of each sentence or line of at least 12
   characters, and of each URL (fragment and trailing slash removed) plus its
   path. Gold queries, titles and URLs are keyed the same way. Leaked chunks
   are not reused as negatives. `--legacy-substring-guard` adds the former
   substring heuristic on top; it is off by default.
4. **Near duplicates.** `--near-dup auto|on|off` (default `auto`: on when
   `datasketch` is installed, otherwise reported as unavailable) clusters
   passages with MinHash LSH: word 5-gram shingles, `--minhash-perm 128`,
   `--near-dup-threshold 0.8` (Jaccard; at 128 permutations LSH accepts up to
   0.98). Clustering runs before split assignment. `--val-fraction` sends
   whole clusters, chosen by a seeded hash of the cluster id
   (`--split-seed`), to `triples.val.jsonl`. `--near-dup-drop` keeps one
   member per cluster.
5. **Negatives.** `--negatives auto|mined|positional`. Mining calls
   `sentence_transformers.util.mine_hard_negatives` per split with
   `range_max=50`, `max_score=0.8`, `relative_margin=0.05` and
   `sampling_strategy="top"`. The miner is `--miner-model`, else
   `--base-model`, else `intfloat/multilingual-e5-small`; E5 models get
   `query: ` / `passage: ` prompts. Candidates from the same document
   (`doc_id`, `document_id`, `source_id`, `parent_id`, `doc`, else URL, else
   path) or the same near-duplicate cluster are removed. A row with no
   remaining candidate gets the positional negative. `positional` is the
   former `(idx + n/2) % n` choice; it moves to the next position when that
   chunk shares the document or cluster. `auto` falls back to `positional`
   when sentence-transformers, `datasets` or the model cannot be loaded, and
   reports the reason. `mined` fails instead.
6. **Reranker data.** With `--reranker-model`, every training row is also
   written to `triples.flag.jsonl` in the FlagEmbedding layout:
   `{"query", "pos", "neg", "pos_scores", "neg_scores", "text_sha256"}`. The
   scores are cross-encoder scores. Candidates that score at or above the
   positive are dropped as likely false negatives.

Outputs: `triples.jsonl` keeps the original `query`, `positive`, `negative`
and `chunk_id` fields and adds `text_sha256`, `text_casefold_sha256`,
`positive_sha256`, `negative_sha256`, `cluster_id`, `split`,
`negative_strategy` and, for mined rows, `negative_score`. It holds the
training split only. Artifact roles are `triples`, `triples_val` and
`reranker_flag`. The `done` event carries a `stats` object with every gate
count, the negative strategy and the fallback reason.

Extras: `dedup` installs datasketch 2.0 (MIT). `mine` and `full` use the locked
sentence-transformers 6.1 (Apache-2.0), `datasets` and torch for mining and
reranker scoring. `full` also supplies the declared ONNX exporters and
PEFT/TRL training stack. Consume these extras through the existing workspace
lock rather than installing an independent dependency set.

```sh
uv run --package aphrody-train --extra mine python -m aphrody_train.triples \
  --input-chunks chunks.jsonl --gold-file gold.jsonl --output-dir out \
  --negatives mined --val-fraction 0.1 \
  --reranker-model BAAI/bge-reranker-v2-m3
```
