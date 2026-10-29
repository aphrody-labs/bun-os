// SPDX-License-Identifier: Apache-2.0
//! Rank fusion, source-weighted re-ranking, diversification (MMR), and the
//! small vector-math kernels retrieval needs: dot product, cosine
//! similarity, int8 scalar quantization, and a bounded-heap exact top-k
//! scan. No parallelism here by design (`docs/plans/codex-oss.md` P8/P9):
//! the host crate (`aphrody-rag`) parallelises with rayon over shards; this
//! crate stays single-threaded and wasm-safe.

use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap, HashSet},
    hash::Hash,
};

/// Reciprocal Rank Fusion: `score(id) = sum_over_lists(1 / (k + rank + 1))`,
/// `rank` 0-based. Ties are broken deterministically by first appearance
/// across `lists` (scanning `lists[0]` then `lists[1]`… in order), never by
/// hash-map iteration order.
#[must_use]
pub fn rrf<Id: Clone + Eq + Hash>(lists: &[&[Id]], k: f64) -> Vec<(Id, f64)> {
    let weighted: Vec<(&[Id], f64)> = lists.iter().map(|&l| (l, 1.0)).collect();
    rrf_weighted(&weighted, k)
}

/// [`rrf`] with a per-list weight multiplier: `score(id) = sum(weight_i / (k
/// + rank_i + 1))`.
#[must_use]
pub fn rrf_weighted<Id: Clone + Eq + Hash>(lists: &[(&[Id], f64)], k: f64) -> Vec<(Id, f64)> {
    let mut scores: HashMap<Id, f64> = HashMap::new();
    let mut first_seen: HashMap<Id, usize> = HashMap::new();
    let mut order = 0usize;
    for (list, weight) in lists {
        for (rank, id) in list.iter().enumerate() {
            *scores.entry(id.clone()).or_insert(0.0) += weight / (k + rank as f64 + 1.0);
            first_seen.entry(id.clone()).or_insert_with(|| {
                let o = order;
                order += 1;
                o
            });
        }
    }
    let mut out: Vec<(Id, f64, usize)> = scores
        .into_iter()
        .map(|(id, score)| {
            let seen = first_seen[&id];
            (id, score, seen)
        })
        .collect();
    out.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.2.cmp(&b.2))
    });
    out.into_iter().map(|(id, score, _)| (id, score)).collect()
}

/// Keep the first occurrence of each `key_fn(item)`, preserving relative
/// order — the generic form of the TypeScript reference's URL/title dedup pass in
/// `apps/bot/src/lib/rag.ts`.
#[must_use]
pub fn dedup_by_key<T, K, F>(items: Vec<T>, key_fn: F) -> Vec<T>
where
    K: Eq + Hash,
    F: Fn(&T) -> K,
{
    let mut seen: HashSet<K> = HashSet::new();
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        if seen.insert(key_fn(&item)) {
            out.push(item);
        }
    }
    out
}

/// A multiplicative boost applied to every candidate whose `source_id`
/// matches, before the final sort — the TypeScript reference's `RAG_MANGA_WEIGHT`.
#[derive(Debug, Clone)]
pub struct SourceWeight {
    pub source_id: String,
    pub weight: f64,
}

/// Guarantee at least `quota` results from `source_id` in the final top-N,
/// provided a candidate scores at least `min_score` (boosted) — the TypeScript reference's
/// `RAG_MANGA_QUOTA` / `RAG_MANGA_QUOTA_MIN_SCORE`. A quota candidate never
/// evicts a result whose `kind` is in the caller's protected set.
#[derive(Debug, Clone)]
pub struct QuotaRule {
    pub source_id: String,
    pub quota: usize,
    pub min_score: f64,
}

/// A candidate entering the source-weighting / quota stage.
#[derive(Debug, Clone)]
pub struct WeightedCandidate<Id> {
    pub id: Id,
    pub source_id: Option<String>,
    pub kind: Option<String>,
    pub score: f64,
}

fn boosted(weights: &[SourceWeight], c: &WeightedCandidate<impl Clone>) -> f64 {
    let mult = c
        .source_id
        .as_deref()
        .and_then(|sid| weights.iter().find(|w| w.source_id == sid))
        .map_or(1.0, |w| w.weight);
    c.score * mult
}

/// Port of the TypeScript reference's `boost()` + `MANGA_QUOTA` promotion pass
/// (`apps/bot/src/lib/rag.ts`, read 2026-09-19): sort all candidates by
/// boosted score, take the top `top_n`, then — if a `quota` is configured —
/// promote enough matching, sufficiently-scored candidates from the
/// remainder to satisfy the quota, evicting only non-protected, non-quota
/// entries starting from the bottom of the current top-N.
#[must_use]
pub fn apply_source_weights<Id: Clone + Eq>(
    candidates: Vec<WeightedCandidate<Id>>,
    weights: &[SourceWeight],
    quota: Option<&QuotaRule>,
    protected_kinds: &[String],
    top_n: usize,
) -> Vec<WeightedCandidate<Id>> {
    let mut ordered = candidates;
    ordered.sort_by(|a, b| {
        boosted(weights, b)
            .partial_cmp(&boosted(weights, a))
            .unwrap_or(Ordering::Equal)
    });

    let mut top: Vec<WeightedCandidate<Id>> = ordered.iter().take(top_n).cloned().collect();
    let rest: Vec<WeightedCandidate<Id>> = ordered.into_iter().skip(top_n).collect();

    if let Some(rule) = quota
        && rule.quota > 0
    {
        let is_quota_source =
            |c: &WeightedCandidate<Id>| c.source_id.as_deref() == Some(rule.source_id.as_str());
        let mut promotable: Vec<WeightedCandidate<Id>> = rest
            .into_iter()
            .filter(|c| is_quota_source(c) && boosted(weights, c) >= rule.min_score)
            .collect();
        promotable.sort_by(|a, b| {
            boosted(weights, b)
                .partial_cmp(&boosted(weights, a))
                .unwrap_or(Ordering::Equal)
        });

        let initial_count = top.iter().filter(|c| is_quota_source(c)).count();
        for (have, promoted) in (initial_count..).zip(promotable) {
            if have >= rule.quota {
                break;
            }
            let worst = top.iter().rposition(|c| {
                !is_quota_source(c)
                    && !c
                        .kind
                        .as_deref()
                        .is_some_and(|k| protected_kinds.iter().any(|p| p == k))
            });
            let Some(worst_idx) = worst else { break };
            top[worst_idx] = promoted;
        }
        top.sort_by(|a, b| {
            boosted(weights, b)
                .partial_cmp(&boosted(weights, a))
                .unwrap_or(Ordering::Equal)
        });
    }
    top
}

/// Maximal Marginal Relevance: greedily pick `top_n` ids from `candidates`
/// (`(id, embedding, relevance)`) maximising `lambda * relevance - (1 -
/// lambda) * max_similarity_to_already_selected` at each step.
#[must_use]
pub fn mmr<Id: Clone>(candidates: &[(Id, Vec<f32>, f64)], lambda: f64, top_n: usize) -> Vec<Id> {
    let mut selected: Vec<usize> = Vec::new();
    let mut remaining: Vec<usize> = (0..candidates.len()).collect();

    while selected.len() < top_n && !remaining.is_empty() {
        let mut best_pos = 0usize;
        let mut best_score = f64::MIN;
        for (pos, &idx) in remaining.iter().enumerate() {
            let relevance = candidates[idx].2;
            let max_sim = selected
                .iter()
                .map(|&s| f64::from(cosine(&candidates[idx].1, &candidates[s].1)))
                .fold(f64::MIN, f64::max);
            let max_sim = if selected.is_empty() { 0.0 } else { max_sim };
            let score = lambda * relevance - (1.0 - lambda) * max_sim;
            if score > best_score {
                best_score = score;
                best_pos = pos;
            }
        }
        selected.push(remaining.remove(best_pos));
    }
    selected
        .into_iter()
        .map(|i| candidates[i].0.clone())
        .collect()
}

/// Dot product of two equal-length vectors (`0.0` on length mismatch).
///
/// Eight independent accumulators break the serial floating-point dependency
/// chain so the compiler can vectorise the loop (safe code, no intrinsics,
/// wasm-safe). Vectors shorter than eight lanes are summed in order, exactly
/// as a plain `iter().zip().map().sum()` would.
#[must_use]
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let (a_blocks, a_rest) = a.as_chunks::<8>();
    let (b_blocks, b_rest) = b.as_chunks::<8>();
    let mut lanes = [0.0_f32; 8];
    for (x, y) in a_blocks.iter().zip(b_blocks) {
        for ((lane, &p), &q) in lanes.iter_mut().zip(x).zip(y) {
            *lane += p * q;
        }
    }
    let mut sum: f32 = lanes.iter().sum();
    for (x, y) in a_rest.iter().zip(b_rest) {
        sum += x * y;
    }
    sum
}

/// L2-normalise `v` in place (no-op on a zero vector).
pub fn l2_normalize(v: &mut [f32]) {
    let norm = dot(v, v).sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

/// Cosine similarity of two equal-length vectors (`0.0` on length mismatch
/// or either vector being all zeros).
#[must_use]
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let na = dot(a, a).sqrt();
    let nb = dot(b, b).sqrt();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot(a, b) / (na * nb)
}

/// Euclidean (L2) norm of `v`.
#[must_use]
pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

/// [`cosine`] with the query's norm computed once by the caller
/// (`query_norm == norm(query)`), for scans that compare one query against
/// many rows. Bit-identical to `cosine(query, row)`; `0.0` on a length
/// mismatch or when either vector is all zeros.
#[must_use]
pub fn cosine_with_norm(query: &[f32], query_norm: f32, row: &[f32]) -> f32 {
    if query.len() != row.len() || query_norm == 0.0 {
        return 0.0;
    }
    let row_norm = norm(row);
    if row_norm == 0.0 {
        return 0.0;
    }
    dot(query, row) / (query_norm * row_norm)
}

/// Symmetric scalar int8 quantization: `scale = max(|v|) / 127`, `q_i =
/// round(v_i / scale)` clamped to `[-127, 127]`. Returns `(quantized,
/// scale)`; `scale == 0.0` for an all-zero input (quantized is then all
/// zeros too).
#[must_use]
pub fn quantize_i8(v: &[f32]) -> (Vec<i8>, f32) {
    let max_abs = v.iter().fold(0.0_f32, |m, x| m.max(x.abs()));
    if max_abs == 0.0 {
        return (vec![0_i8; v.len()], 0.0);
    }
    let scale = max_abs / 127.0;
    let q = v
        .iter()
        .map(|x| ((x / scale).round().clamp(-127.0, 127.0)) as i8)
        .collect();
    (q, scale)
}

/// Dot product of two int8-quantized vectors, widened to `i32` to avoid
/// overflow (`i8::MAX * i8::MAX * len` fits comfortably for any realistic
/// embedding dimension).
#[must_use]
pub fn dot_i8(a: &[i8], b: &[i8]) -> i32 {
    a.iter()
        .zip(b)
        .map(|(&x, &y)| i32::from(x) * i32::from(y))
        .sum()
}

#[derive(PartialEq)]
struct Scored(f32, usize);
impl Eq for Scored {}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0
            .total_cmp(&other.0)
            .then_with(|| other.1.cmp(&self.1))
    }
}

/// Exact top-`k` nearest neighbours of `query` (length `dim`) among the rows
/// of `matrix` (row-major, `matrix.len() / dim` rows), ranked by cosine
/// similarity, using a `k`-bounded binary heap so memory stays `O(k)`
/// regardless of `matrix` size. Returns `(row_index, score)` sorted by score
/// descending, ties broken by ascending row index.
#[must_use]
pub fn top_k_exact(query: &[f32], matrix: &[f32], dim: usize, k: usize) -> Vec<(usize, f32)> {
    if dim == 0 || k == 0 {
        return Vec::new();
    }
    // The query norm is the same for every row: compute it once.
    let query_norm = norm(query);
    let rows = matrix.len() / dim;
    top_k_by(rows, k, |r| {
        cosine_with_norm(query, query_norm, &matrix[r * dim..(r + 1) * dim])
    })
}

/// Bounded-heap selection shared by every top-`k` scan: scores each of `rows`
/// candidates with `score(row)`, keeps the `k` best (`O(k)` memory) and
/// returns `(row, score)` sorted by score descending, ties broken by
/// ascending row index. A `NaN` score ranks last instead of poisoning the
/// ordering. Rows are scored in ascending order, so an equal score never
/// displaces an earlier row.
fn top_k_by(rows: usize, k: usize, mut score: impl FnMut(usize) -> f32) -> Vec<(usize, f32)> {
    if rows == 0 || k == 0 {
        return Vec::new();
    }
    let mut heap: BinaryHeap<std::cmp::Reverse<Scored>> =
        BinaryHeap::with_capacity(k.min(rows) + 1);
    for r in 0..rows {
        let raw = score(r);
        let s = if raw.is_nan() { f32::NEG_INFINITY } else { raw };
        if heap.len() < k {
            heap.push(std::cmp::Reverse(Scored(s, r)));
        } else if let Some(std::cmp::Reverse(worst)) = heap.peek()
            && s > worst.0
        {
            heap.pop();
            heap.push(std::cmp::Reverse(Scored(s, r)));
        }
    }
    let mut out: Vec<(usize, f32)> = heap
        .into_iter()
        .map(|std::cmp::Reverse(Scored(s, i))| (i, s))
        .collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    out
}

/// [`top_k_exact`] for a **unit-normalised** `query` against **unit-normalised**
/// rows: the score is the plain dot product, which equals the cosine for unit
/// vectors, so each row costs one pass instead of three. Returns `(row,
/// score)` sorted by score descending, ties by ascending row. Empty when
/// `query.len() != dim`.
#[must_use]
pub fn top_k_dot(query: &[f32], matrix: &[f32], dim: usize, k: usize) -> Vec<(usize, f32)> {
    if dim == 0 || k == 0 || query.len() != dim {
        return Vec::new();
    }
    let rows = matrix.len() / dim;
    top_k_by(rows, k, |r| dot(query, &matrix[r * dim..(r + 1) * dim]))
}

/// Approximate top-`k` over an int8-quantised matrix (`codes` row-major,
/// `scales[r]` the per-row scale from [`quantize_i8`]). `query` must be
/// unit-normalised and every stored row must be the quantisation of a
/// unit-normalised vector; the score `dot_i8(q, row) * q_scale * row_scale`
/// then approximates the cosine within about `1e-2`. 4x smaller and faster
/// to scan than the f32 matrix. Returns `(row, score)` sorted by score
/// descending, ties by ascending row. Empty when `query.len() != dim`.
#[must_use]
pub fn top_k_i8(
    query: &[f32],
    codes: &[i8],
    scales: &[f32],
    dim: usize,
    k: usize,
) -> Vec<(usize, f32)> {
    if dim == 0 || k == 0 || query.len() != dim {
        return Vec::new();
    }
    let (q, q_scale) = quantize_i8(query);
    let rows = (codes.len() / dim).min(scales.len());
    top_k_by(rows, k, |r| {
        dot_i8(&q, &codes[r * dim..(r + 1) * dim]) as f32 * q_scale * scales[r]
    })
}

/// Merge per-shard top-`k` lists (each already expressed in *global* row
/// indices) into the global top-`k`: score descending, ties by ascending
/// row. Identical to a single scan over every shard because each shard keeps
/// its own best `k` under the same total order.
#[must_use]
pub fn merge_top_k(parts: Vec<Vec<(usize, f32)>>, k: usize) -> Vec<(usize, f32)> {
    let mut all: Vec<(usize, f32)> = parts.into_iter().flatten().collect();
    all.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    all.truncate(k);
    all
}

/// How [`fuse_scores`] rescales each ranked list before the weighted sum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScoreScaling {
    /// `(s - min) / (max - min)` per list: LlamaIndex `relative_score`.
    MinMax,
    /// Same, with `min = mean - 3 sigma` and `max = mean + 3 sigma` (population
    /// standard deviation) and no clamping: LlamaIndex `dist_based_score`.
    DistBased,
}

fn scale_bounds<Id>(list: &[(Id, f64)], scaling: ScoreScaling) -> (f64, f64) {
    match scaling {
        ScoreScaling::MinMax => list
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), (_, s)| {
                (lo.min(*s), hi.max(*s))
            }),
        ScoreScaling::DistBased => {
            let n = list.len() as f64;
            let mean = list.iter().map(|(_, s)| *s).sum::<f64>() / n;
            let variance = list
                .iter()
                .map(|(_, s)| (*s - mean) * (*s - mean))
                .sum::<f64>()
                / n;
            let spread = 3.0 * variance.sqrt();
            (mean - spread, mean + spread)
        }
    }
}

/// Score-based fusion of several ranked lists (LlamaIndex
/// `QueryFusionRetriever` `relative_score` / `dist_based_score`): every list
/// is rescaled by `scaling` (a list whose bounds coincide maps to `1.0` when
/// positive, else `0.0`), multiplied by its weight (weights are normalised to
/// sum to one; non-positive totals fall back to equal weights), and the
/// per-id contributions are summed. Sorted by fused score descending, ties by
/// first appearance across `lists`.
#[must_use]
pub fn fuse_scores<Id: Clone + Eq + Hash>(
    lists: &[(&[(Id, f64)], f64)],
    scaling: ScoreScaling,
) -> Vec<(Id, f64)> {
    let total_weight: f64 = lists.iter().map(|(_, w)| w.max(0.0)).sum();
    let equal_weight = 1.0 / lists.len().max(1) as f64;
    let mut scores: HashMap<Id, f64> = HashMap::new();
    let mut first_seen: HashMap<Id, usize> = HashMap::new();
    let mut order = 0usize;
    for (list, weight) in lists {
        if list.is_empty() {
            continue;
        }
        let weight = if total_weight > 0.0 {
            weight.max(0.0) / total_weight
        } else {
            equal_weight
        };
        let (lo, hi) = scale_bounds(list, scaling);
        for (id, score) in *list {
            let scaled = if hi == lo {
                if hi > 0.0 { 1.0 } else { 0.0 }
            } else {
                (score - lo) / (hi - lo)
            };
            *scores.entry(id.clone()).or_insert(0.0) += scaled * weight;
            first_seen.entry(id.clone()).or_insert_with(|| {
                let o = order;
                order += 1;
                o
            });
        }
    }
    let mut out: Vec<(Id, f64, usize)> = scores
        .into_iter()
        .map(|(id, score)| {
            let seen = first_seen[&id];
            (id, score, seen)
        })
        .collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.2.cmp(&b.2)));
    out.into_iter().map(|(id, score, _)| (id, score)).collect()
}

/// Min-max rescale `values` in place to `[0, 1]`; a constant slice becomes
/// all `1.0`. Rank-preserving: used to put heterogeneous retrieval scores on
/// the same footing as cosine similarities before [`mmr`].
pub fn minmax_normalize(values: &mut [f64]) {
    if values.is_empty() {
        return;
    }
    let (lo, hi) = values
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &v| {
            (lo.min(v), hi.max(v))
        });
    if hi > lo {
        for v in values.iter_mut() {
            *v = (*v - lo) / (hi - lo);
        }
    } else {
        for v in values.iter_mut() {
            *v = 1.0;
        }
    }
}
