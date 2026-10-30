// SPDX-License-Identifier: Apache-2.0
//! The language-neutral call surface of `aphrody-rag-core`: the single source of truth for
//! every binding (WebAssembly in `aphrody-command-wasm`, C ABI in `aphrody-rag-ffi`, and any
//! future host).
//!
//! A binding never re-declares a capability. It forwards three entry points:
//!
//! * [`manifest`]: JSON document listing [`ABI_VERSION`] and every operation name.
//! * [`call_json`]: structured operations (chunking, fusion, MMR, source weighting, the
//!   retrieval eval harness, text helpers). Input and output are JSON documents.
//! * [`call_vec`]: dense-vector kernels over little-endian `f32`/`f64`/`i8` byte buffers
//!   with JSON parameters, so large matrices never go through JSON.
//!
//! Adding a capability means adding one row to [`JSON_OPS`] or [`VEC_OPS`]; the bindings and
//! the TypeScript facade (`packages/ai/rag-core`) pick it up through the manifest, and the
//! drift tests fail when the facade lacks it.
//!
//! Vector wire format: matrices are row-major little-endian. [`call_vec`] top-k results are
//! records of `u32` row index followed by `f32` score (8 bytes each).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{
    Chunk, ChunkOptions, LengthUnit, chunker_for_path, detect_language,
    eval::{self, Aggregate, CaseResult, GoldCase, Report, RetrievedHit, UrlNormalizer},
    fusion::{self, QuotaRule, ScoreScaling, SourceWeight, WeightedCandidate},
    text, vectors_f32, vectors_f64,
};

/// Version of this call surface. Bump on any incompatible change to an operation.
pub const ABI_VERSION: u32 = 1;

type JsonOp = fn(Value) -> Result<Value, String>;
type VecOp = fn(&Value, &[u8], &[u8]) -> Result<Vec<u8>, String>;

/// Structured operations: `(name, summary, handler)`.
pub static JSON_OPS: &[(&str, &str, JsonOp)] = &[
    (
        "chunk",
        "Split a source file into line-addressed chunks",
        op_chunk,
    ),
    (
        "detect_language",
        "Language of a path from its extension",
        op_detect_language,
    ),
    (
        "normalize_newlines",
        "CRLF and CR to LF",
        op_normalize_newlines,
    ),
    (
        "measure",
        "Length of a text in utf16, chars or bytes",
        op_measure,
    ),
    (
        "split_sentences",
        "Sentence split with line ranges",
        op_split_sentences,
    ),
    ("rrf", "Reciprocal rank fusion", op_rrf),
    (
        "rrf_weighted",
        "Weighted reciprocal rank fusion",
        op_rrf_weighted,
    ),
    (
        "fuse_scores",
        "Relative or distribution based score fusion",
        op_fuse_scores,
    ),
    (
        "apply_source_weights",
        "Source boosts and quota promotion",
        op_apply_source_weights,
    ),
    ("mmr", "Maximal marginal relevance selection", op_mmr),
    (
        "minmax_normalize",
        "Min-max rescale of scores",
        op_minmax_normalize,
    ),
    ("merge_top_k", "Merge per-shard top-k lists", op_merge_top_k),
    (
        "eval_parse_gold",
        "Parse a JSONL gold set",
        op_eval_parse_gold,
    ),
    (
        "eval_normalize_url",
        "Eval URL normalisation",
        op_eval_normalize_url,
    ),
    (
        "eval_matches_url",
        "Boundary-aware expected URL match",
        op_eval_matches_url,
    ),
    (
        "eval_is_hit",
        "Whether a retrieved hit satisfies a case",
        op_eval_is_hit,
    ),
    (
        "eval_first_hit_rank",
        "1-based rank of the first hit, 0 when none",
        op_eval_first_hit_rank,
    ),
    (
        "eval_ndcg_at_k",
        "nDCG at k for one case",
        op_eval_ndcg_at_k,
    ),
    (
        "eval_run_case",
        "Score one case against its results",
        op_eval_run_case,
    ),
    (
        "eval_aggregate",
        "Recall, MRR and nDCG over cases",
        op_eval_aggregate,
    ),
    (
        "eval_aggregate_by_tag",
        "Aggregates grouped by tag",
        op_eval_aggregate_by_tag,
    ),
    ("eval_quantile", "Nearest-rank quantile", op_eval_quantile),
    (
        "eval_latency_stats",
        "p50 and p95 latency",
        op_eval_latency_stats,
    ),
    ("eval_report", "Full report from cases", op_eval_report),
    (
        "eval_gate_check",
        "Check an aggregate against a gate expression",
        op_eval_gate_check,
    ),
    ("eval_compare", "Compare two reports", op_eval_compare),
];

/// Dense-vector operations: `(name, summary, handler)`.
pub static VEC_OPS: &[(&str, &str, VecOp)] = &[
    (
        "normalize_f32",
        "L2 normalise rows (zero norm kept)",
        |p, a, _| {
            let (rows, width) = (usize_of(p, "rows")?, usize_of(p, "width")?);
            let out = vectors_f32::normalize(&rows_f32(a, rows, width)?)?;
            Ok(put_f32(out.iter().flatten()))
        },
    ),
    (
        "normalize_f64",
        "L2 normalise rows with the 1e-12 clamp",
        |p, a, _| {
            let (rows, width) = (usize_of(p, "rows")?, usize_of(p, "width")?);
            let out = vectors_f64::normalize(&rows_f64(a, rows, width)?)?;
            Ok(put_f64(out.iter().flatten()))
        },
    ),
    (
        "similarities_f32",
        "left * right^T, row-major",
        |p, a, b| {
            let (lr, rr, w) = (
                usize_of(p, "rows")?,
                usize_of(p, "right_rows")?,
                usize_of(p, "width")?,
            );
            let out = vectors_f32::similarities_flat(
                &flat_f32(a, lr, w)?,
                &flat_f32(b, rr, w)?,
                lr,
                rr,
                w,
            )?;
            Ok(put_f32(out.iter()))
        },
    ),
    (
        "similarities_f64",
        "left * right^T, row-major",
        |p, a, b| {
            let (lr, rr, w) = (
                usize_of(p, "rows")?,
                usize_of(p, "right_rows")?,
                usize_of(p, "width")?,
            );
            let out = vectors_f64::similarities_flat(
                &flat_f64(a, lr, w)?,
                &flat_f64(b, rr, w)?,
                lr,
                rr,
                w,
            )?;
            Ok(put_f64(out.iter()))
        },
    ),
    ("mean_f32", "Mean embedding", |p, a, _| {
        let (rows, width) = (usize_of(p, "rows")?, usize_of(p, "width")?);
        Ok(put_f32(
            vectors_f32::mean(&rows_f32(a, rows, width)?)?.iter(),
        ))
    }),
    ("mean_f64", "Mean embedding", |p, a, _| {
        let (rows, width) = (usize_of(p, "rows")?, usize_of(p, "width")?);
        Ok(put_f64(
            vectors_f64::mean(&rows_f64(a, rows, width)?)?.iter(),
        ))
    }),
    (
        "squared_distances_f32",
        "Squared Euclidean distances rows x centroids",
        |p, a, b| {
            let (rows, cr, w) = (
                usize_of(p, "rows")?,
                usize_of(p, "right_rows")?,
                usize_of(p, "width")?,
            );
            let out = vectors_f32::squared_distances(&rows_f32(a, rows, w)?, &rows_f32(b, cr, w)?)?;
            Ok(put_f32(out.iter().flatten()))
        },
    ),
    (
        "squared_distances_f64",
        "Squared Euclidean distances rows x centroids",
        |p, a, b| {
            let (rows, cr, w) = (
                usize_of(p, "rows")?,
                usize_of(p, "right_rows")?,
                usize_of(p, "width")?,
            );
            let out = vectors_f64::squared_distances(&rows_f64(a, rows, w)?, &rows_f64(b, cr, w)?)?;
            Ok(put_f64(out.iter().flatten()))
        },
    ),
    (
        "update_centers_f64",
        "Recompute cluster centers; params.labels",
        |p, a, b| {
            let (rows, cr, w) = (
                usize_of(p, "rows")?,
                usize_of(p, "right_rows")?,
                usize_of(p, "width")?,
            );
            let labels: Vec<usize> = from_field(p, "labels")?;
            let out =
                vectors_f64::update_centers(&rows_f64(a, rows, w)?, &labels, &rows_f64(b, cr, w)?)?;
            Ok(put_f64(out.iter().flatten()))
        },
    ),
    ("dot_f32", "Dot product of two vectors", |_, a, b| {
        Ok(put_f32([fusion::dot(&f32s(a)?, &f32s(b)?)].iter()))
    }),
    (
        "cosine_f32",
        "Cosine similarity of two vectors",
        |_, a, b| Ok(put_f32([fusion::cosine(&f32s(a)?, &f32s(b)?)].iter())),
    ),
    (
        "l2_normalize_f32",
        "L2 normalise each row in place semantics",
        |p, a, _| {
            let (rows, width) = (usize_of(p, "rows")?, usize_of(p, "width")?);
            let mut flat = flat_f32(a, rows, width)?;
            if width > 0 {
                for row in flat.chunks_exact_mut(width) {
                    fusion::l2_normalize(row);
                }
            }
            Ok(put_f32(flat.iter()))
        },
    ),
    (
        "top_k_cosine_f32",
        "Exact top-k by cosine: a=query, b=matrix",
        |p, a, b| {
            let (dim, k) = (usize_of(p, "dim")?, usize_of(p, "k")?);
            Ok(put_hits(&fusion::top_k_exact(&f32s(a)?, &f32s(b)?, dim, k)))
        },
    ),
    (
        "top_k_dot_f32",
        "Exact top-k by dot, unit vectors: a=query, b=matrix",
        |p, a, b| {
            let (dim, k) = (usize_of(p, "dim")?, usize_of(p, "k")?);
            Ok(put_hits(&fusion::top_k_dot(&f32s(a)?, &f32s(b)?, dim, k)))
        },
    ),
    (
        "quantize_i8",
        "Symmetric int8 quantisation: out = f32 scale then i8 codes",
        |_, a, _| {
            let (codes, scale) = fusion::quantize_i8(&f32s(a)?);
            let mut out = scale.to_le_bytes().to_vec();
            out.extend(codes.iter().map(|c| c.to_le_bytes()[0]));
            Ok(out)
        },
    ),
    (
        "top_k_i8",
        "Approximate top-k: b = rows*dim i8 codes then rows f32 scales",
        |p, a, b| {
            let (dim, k, rows) = (usize_of(p, "dim")?, usize_of(p, "k")?, usize_of(p, "rows")?);
            let code_len = rows.checked_mul(dim).ok_or("shape overflow")?;
            let scale_len = rows.checked_mul(4).ok_or("shape overflow")?;
            if b.len() != code_len.checked_add(scale_len).ok_or("shape overflow")? {
                return Err("codes and scales do not match rows x dim".into());
            }
            let codes: Vec<i8> = b[..code_len]
                .iter()
                .map(|&c| i8::from_le_bytes([c]))
                .collect();
            let scales = f32s(&b[code_len..])?;
            Ok(put_hits(&fusion::top_k_i8(
                &f32s(a)?,
                &codes,
                &scales,
                dim,
                k,
            )))
        },
    ),
];

/// JSON document describing this surface.
#[must_use]
pub fn manifest() -> String {
    let json_ops = list_json(JSON_OPS);
    let vec_ops = list_vec(VEC_OPS);
    json!({
        "abi": ABI_VERSION,
        "crate": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
        "oxc": cfg!(feature = "oxc"),
        "json": json_ops,
        "vec": vec_ops,
    })
    .to_string()
}

fn list_json(ops: &[(&str, &str, JsonOp)]) -> Vec<Value> {
    ops.iter()
        .map(|(n, s, _)| json!({ "name": n, "summary": s }))
        .collect()
}

fn list_vec(ops: &[(&str, &str, VecOp)]) -> Vec<Value> {
    ops.iter()
        .map(|(n, s, _)| json!({ "name": n, "summary": s }))
        .collect()
}

/// Run a structured operation. `input` is a JSON document (empty means `{}`).
///
/// # Errors
/// Unknown operation, invalid input or an operation failure, as a message.
pub fn call_json(op: &str, input: &str) -> Result<String, String> {
    let handler = JSON_OPS
        .iter()
        .find(|(name, _, _)| *name == op)
        .ok_or_else(|| format!("unknown json operation: {op}"))?;
    let value: Value = if input.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(input).map_err(|e| format!("invalid json input: {e}"))?
    };
    (handler.2)(value).map(|v| v.to_string())
}

/// Run a dense-vector operation over byte buffers `a` and `b` with JSON `params`.
///
/// # Errors
/// Unknown operation, invalid parameters or buffer shapes, as a message.
pub fn call_vec(op: &str, params: &str, a: &[u8], b: &[u8]) -> Result<Vec<u8>, String> {
    let handler = VEC_OPS
        .iter()
        .find(|(name, _, _)| *name == op)
        .ok_or_else(|| format!("unknown vec operation: {op}"))?;
    let params: Value = if params.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(params).map_err(|e| format!("invalid json params: {e}"))?
    };
    (handler.2)(&params, a, b)
}

// ---------------------------------------------------------------- vector helpers

fn usize_of(p: &Value, key: &str) -> Result<usize, String> {
    p.get(key)
        .and_then(Value::as_u64)
        .and_then(|v| usize::try_from(v).ok())
        .ok_or_else(|| format!("missing or invalid integer parameter: {key}"))
}

fn from_field<T: DeserializeOwned>(p: &Value, key: &str) -> Result<T, String> {
    let v = p
        .get(key)
        .ok_or_else(|| format!("missing parameter: {key}"))?;
    serde_json::from_value(v.clone()).map_err(|e| format!("invalid parameter {key}: {e}"))
}

fn f32s(bytes: &[u8]) -> Result<Vec<f32>, String> {
    let (chunks, rest) = bytes.as_chunks::<4>();
    if !rest.is_empty() {
        return Err("f32 buffer length is not a multiple of 4".into());
    }
    Ok(chunks.iter().map(|c| f32::from_le_bytes(*c)).collect())
}

fn f64s(bytes: &[u8]) -> Result<Vec<f64>, String> {
    let (chunks, rest) = bytes.as_chunks::<8>();
    if !rest.is_empty() {
        return Err("f64 buffer length is not a multiple of 8".into());
    }
    Ok(chunks.iter().map(|c| f64::from_le_bytes(*c)).collect())
}

fn check_shape(len: usize, rows: usize, width: usize, elem: usize) -> Result<(), String> {
    match rows.checked_mul(width).and_then(|n| n.checked_mul(elem)) {
        Some(expected) if expected == len => Ok(()),
        _ => Err("buffer length does not match rows x width".into()),
    }
}

fn flat_f32(bytes: &[u8], rows: usize, width: usize) -> Result<Vec<f32>, String> {
    check_shape(bytes.len(), rows, width, 4)?;
    f32s(bytes)
}

fn flat_f64(bytes: &[u8], rows: usize, width: usize) -> Result<Vec<f64>, String> {
    check_shape(bytes.len(), rows, width, 8)?;
    f64s(bytes)
}

fn rows_f32(bytes: &[u8], rows: usize, width: usize) -> Result<Vec<Vec<f32>>, String> {
    let flat = flat_f32(bytes, rows, width)?;
    if width == 0 {
        return Ok(vec![Vec::new(); rows]);
    }
    Ok(flat.chunks_exact(width).map(<[f32]>::to_vec).collect())
}

fn rows_f64(bytes: &[u8], rows: usize, width: usize) -> Result<Vec<Vec<f64>>, String> {
    let flat = flat_f64(bytes, rows, width)?;
    if width == 0 {
        return Ok(vec![Vec::new(); rows]);
    }
    Ok(flat.chunks_exact(width).map(<[f64]>::to_vec).collect())
}

fn put_f32<'a>(values: impl Iterator<Item = &'a f32>) -> Vec<u8> {
    values.flat_map(|v| v.to_le_bytes()).collect()
}

fn put_f64<'a>(values: impl Iterator<Item = &'a f64>) -> Vec<u8> {
    values.flat_map(|v| v.to_le_bytes()).collect()
}

fn put_hits(hits: &[(usize, f32)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(hits.len() * 8);
    for &(row, score) in hits {
        out.extend_from_slice(&u32::try_from(row).unwrap_or(u32::MAX).to_le_bytes());
        out.extend_from_slice(&score.to_le_bytes());
    }
    out
}

// ---------------------------------------------------------------- json helpers

fn parse<T: DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("invalid input: {e}"))
}

fn out<T: Serialize>(v: &T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

/// An identifier: integer or string, preserved in the output.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
enum Id {
    Num(i64),
    Str(String),
}

#[derive(Serialize, Deserialize)]
struct Scored {
    id: Id,
    score: f64,
}

fn scored(rows: Vec<(Id, f64)>) -> Vec<Scored> {
    rows.into_iter()
        .map(|(id, score)| Scored { id, score })
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}

// ---------------------------------------------------------------- chunking and text

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct OptionsIn {
    /// `default` (aphrody) or `ts_parity`.
    profile: Option<String>,
    max_chars: Option<usize>,
    overlap_pct: Option<f32>,
    min_chars: Option<usize>,
    length_unit: Option<LengthUnit>,
    cjk_sentence_breaks: Option<bool>,
}

impl OptionsIn {
    fn resolve(self) -> Result<ChunkOptions, String> {
        let mut o = match self.profile.as_deref() {
            None | Some("default") => ChunkOptions::default(),
            Some("ts_parity") => ChunkOptions::ts_parity(),
            Some(other) => return Err(format!("unknown options profile: {other}")),
        };
        if let Some(v) = self.max_chars {
            o.max_chars = v;
        }
        if let Some(v) = self.overlap_pct {
            o.overlap_pct = v;
        }
        if let Some(v) = self.min_chars {
            o.min_chars = v;
        }
        if let Some(v) = self.length_unit {
            o.length_unit = v;
        }
        if let Some(v) = self.cjk_sentence_breaks {
            o.cjk_sentence_breaks = v;
        }
        Ok(o)
    }
}

#[derive(Serialize)]
struct ChunkOut {
    ord: u32,
    kind: crate::ChunkKind,
    symbol: Option<String>,
    start_line: u32,
    end_line: u32,
    text: String,
    /// BLAKE3 digest of `text`, lowercase hex.
    hash: String,
}

impl From<Chunk> for ChunkOut {
    fn from(c: Chunk) -> Self {
        Self {
            ord: c.ord,
            kind: c.kind,
            symbol: c.symbol,
            start_line: c.start_line,
            end_line: c.end_line,
            text: c.text,
            hash: hex(&c.hash),
        }
    }
}

fn op_chunk(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        path: String,
        text: String,
        #[serde(default)]
        options: OptionsIn,
    }
    let i: In = parse(v)?;
    let opts = i.options.resolve()?;
    let chunks: Vec<ChunkOut> = chunker_for_path(&i.path)
        .chunk(&i.path, &i.text, &opts)
        .into_iter()
        .map(Into::into)
        .collect();
    out(&chunks)
}

fn op_detect_language(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        path: String,
    }
    out(&detect_language(&parse::<In>(v)?.path))
}

fn op_normalize_newlines(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        text: String,
    }
    out(&text::normalize_newlines(&parse::<In>(v)?.text))
}

fn op_measure(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        text: String,
        #[serde(default)]
        unit: LengthUnit,
    }
    let i: In = parse(v)?;
    out(&text::measure(&i.text, i.unit))
}

fn op_split_sentences(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        text: String,
        #[serde(default = "one")]
        base_line: u32,
        #[serde(default = "yes")]
        cjk_sentence_breaks: bool,
    }
    #[derive(Serialize)]
    struct S {
        text: String,
        start_line: u32,
        end_line: u32,
    }
    let i: In = parse(v)?;
    let sentences: Vec<S> =
        text::split_sentences_with_offsets(&i.text, i.base_line, i.cjk_sentence_breaks)
            .into_iter()
            .map(|s| S {
                text: s.text,
                start_line: s.start_line,
                end_line: s.end_line,
            })
            .collect();
    out(&sentences)
}

const fn one() -> u32 {
    1
}
const fn yes() -> bool {
    true
}
const fn rrf_k() -> f64 {
    60.0
}

// ---------------------------------------------------------------- fusion

fn op_rrf(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        lists: Vec<Vec<Id>>,
        #[serde(default = "rrf_k")]
        k: f64,
    }
    let i: In = parse(v)?;
    let slices: Vec<&[Id]> = i.lists.iter().map(Vec::as_slice).collect();
    out(&scored(fusion::rrf(&slices, i.k)))
}

fn op_rrf_weighted(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct List {
        ids: Vec<Id>,
        weight: f64,
    }
    #[derive(Deserialize)]
    struct In {
        lists: Vec<List>,
        #[serde(default = "rrf_k")]
        k: f64,
    }
    let i: In = parse(v)?;
    let lists: Vec<(&[Id], f64)> = i
        .lists
        .iter()
        .map(|l| (l.ids.as_slice(), l.weight))
        .collect();
    out(&scored(fusion::rrf_weighted(&lists, i.k)))
}

fn op_fuse_scores(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct List {
        items: Vec<Scored>,
        weight: f64,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum Scaling {
        MinMax,
        DistBased,
    }
    #[derive(Deserialize)]
    struct In {
        lists: Vec<List>,
        scaling: Scaling,
    }
    let i: In = parse(v)?;
    let owned: Vec<Vec<(Id, f64)>> = i
        .lists
        .iter()
        .map(|l| l.items.iter().map(|s| (s.id.clone(), s.score)).collect())
        .collect();
    let lists: Vec<(&[(Id, f64)], f64)> = owned
        .iter()
        .zip(&i.lists)
        .map(|(o, l)| (o.as_slice(), l.weight))
        .collect();
    let scaling = match i.scaling {
        Scaling::MinMax => ScoreScaling::MinMax,
        Scaling::DistBased => ScoreScaling::DistBased,
    };
    out(&scored(fusion::fuse_scores(&lists, scaling)))
}

#[derive(Serialize, Deserialize)]
struct CandidateJson {
    id: Id,
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    score: f64,
}

fn op_apply_source_weights(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct W {
        source_id: String,
        weight: f64,
    }
    #[derive(Deserialize)]
    struct Q {
        source_id: String,
        quota: usize,
        min_score: f64,
    }
    #[derive(Deserialize)]
    struct In {
        candidates: Vec<CandidateJson>,
        #[serde(default)]
        weights: Vec<W>,
        quota: Option<Q>,
        #[serde(default)]
        protected_kinds: Vec<String>,
        top_n: usize,
    }
    let i: In = parse(v)?;
    let candidates = i
        .candidates
        .into_iter()
        .map(|c| WeightedCandidate {
            id: c.id,
            source_id: c.source_id,
            kind: c.kind,
            score: c.score,
        })
        .collect();
    let weights: Vec<SourceWeight> = i
        .weights
        .into_iter()
        .map(|w| SourceWeight {
            source_id: w.source_id,
            weight: w.weight,
        })
        .collect();
    let quota = i.quota.map(|q| QuotaRule {
        source_id: q.source_id,
        quota: q.quota,
        min_score: q.min_score,
    });
    let result: Vec<CandidateJson> = fusion::apply_source_weights(
        candidates,
        &weights,
        quota.as_ref(),
        &i.protected_kinds,
        i.top_n,
    )
    .into_iter()
    .map(|c| CandidateJson {
        id: c.id,
        source_id: c.source_id,
        kind: c.kind,
        score: c.score,
    })
    .collect();
    out(&result)
}

fn op_mmr(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct C {
        id: Id,
        embedding: Vec<f32>,
        score: f64,
    }
    #[derive(Deserialize)]
    struct In {
        candidates: Vec<C>,
        lambda: f64,
        top_n: usize,
    }
    let i: In = parse(v)?;
    let candidates: Vec<(Id, Vec<f32>, f64)> = i
        .candidates
        .into_iter()
        .map(|c| (c.id, c.embedding, c.score))
        .collect();
    out(&fusion::mmr(&candidates, i.lambda, i.top_n))
}

fn op_minmax_normalize(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        values: Vec<f64>,
    }
    let mut values = parse::<In>(v)?.values;
    fusion::minmax_normalize(&mut values);
    out(&values)
}

fn op_merge_top_k(v: Value) -> Result<Value, String> {
    #[derive(Serialize, Deserialize)]
    struct Hit {
        index: usize,
        score: f32,
    }
    #[derive(Deserialize)]
    struct In {
        parts: Vec<Vec<Hit>>,
        k: usize,
    }
    let i: In = parse(v)?;
    let parts = i
        .parts
        .into_iter()
        .map(|p| p.into_iter().map(|h| (h.index, h.score)).collect())
        .collect();
    let merged: Vec<Hit> = fusion::merge_top_k(parts, i.k)
        .into_iter()
        .map(|(index, score)| Hit { index, score })
        .collect();
    out(&merged)
}

// ---------------------------------------------------------------- eval

fn op_eval_parse_gold(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        text: String,
    }
    out(&eval::parse_gold(&parse::<In>(v)?.text))
}

fn normalizer(strip_origin: Option<&str>) -> Result<UrlNormalizer, String> {
    match strip_origin {
        None => Ok(UrlNormalizer::default()),
        Some("") => Ok(UrlNormalizer { strip_origin: None }),
        Some(re) => regex::Regex::new(re)
            .map(|r| UrlNormalizer {
                strip_origin: Some(r),
            })
            .map_err(|e| format!("invalid strip_origin regex: {e}")),
    }
}

fn op_eval_normalize_url(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        url: String,
        strip_origin: Option<String>,
    }
    let i: In = parse(v)?;
    out(&normalizer(i.strip_origin.as_deref())?.normalize(&i.url))
}

fn op_eval_matches_url(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        actual: String,
        expected: String,
        strip_origin: Option<String>,
    }
    let i: In = parse(v)?;
    out(&eval::matches_expected_url_with(
        &normalizer(i.strip_origin.as_deref())?,
        &i.actual,
        &i.expected,
    ))
}

fn op_eval_is_hit(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        hit: RetrievedHit,
        case: GoldCase,
    }
    let i: In = parse(v)?;
    out(&eval::is_hit(&i.hit, &i.case))
}

fn op_eval_first_hit_rank(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        results: Vec<RetrievedHit>,
        case: GoldCase,
    }
    let i: In = parse(v)?;
    out(&eval::first_hit_rank(&i.results, &i.case))
}

fn op_eval_ndcg_at_k(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        results: Vec<RetrievedHit>,
        case: GoldCase,
        #[serde(default = "ten")]
        k: usize,
    }
    let i: In = parse(v)?;
    out(&eval::ndcg_at_k(&i.results, &i.case, i.k))
}

const fn ten() -> usize {
    10
}

fn op_eval_run_case(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        case: GoldCase,
        results: Vec<RetrievedHit>,
        mode: String,
        #[serde(default)]
        latency_ms: u64,
    }
    let i: In = parse(v)?;
    out(&eval::run_case(i.case, &i.results, &i.mode, i.latency_ms))
}

fn cases_of(v: Value) -> Result<Vec<CaseResult>, String> {
    #[derive(Deserialize)]
    struct In {
        cases: Vec<CaseResult>,
    }
    Ok(parse::<In>(v)?.cases)
}

fn op_eval_aggregate(v: Value) -> Result<Value, String> {
    out(&eval::aggregate(&cases_of(v)?))
}

fn op_eval_aggregate_by_tag(v: Value) -> Result<Value, String> {
    out(&eval::aggregate_by_tag(&cases_of(v)?))
}

fn op_eval_quantile(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        values: Vec<f64>,
        q: f64,
    }
    let i: In = parse(v)?;
    out(&eval::quantile(&i.values, i.q))
}

fn op_eval_latency_stats(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        latencies_ms: Vec<f64>,
    }
    out(&eval::latency_stats(&parse::<In>(v)?.latencies_ms))
}

fn op_eval_report(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        condition: String,
        cases: Vec<CaseResult>,
    }
    let i: In = parse(v)?;
    out(&Report::from_cases(i.condition, i.cases))
}

fn op_eval_gate_check(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        expr: String,
        aggregate: Aggregate,
    }
    let i: In = parse(v)?;
    let gate = eval::Gate::parse(&i.expr).map_err(|e| e.to_string())?;
    match gate.check(&i.aggregate) {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(f) => Ok(json!({
            "ok": false,
            "failure": { "expr": f.expr, "actual": f.actual, "threshold": f.threshold },
        })),
    }
}

fn op_eval_compare(v: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct In {
        baseline: Report,
        candidate: Report,
        #[serde(default)]
        allow_mixed: bool,
    }
    let i: In = parse(v)?;
    out(&eval::compare(&i.baseline, &i.candidate, i.allow_mixed).map_err(|e| e.to_string())?)
}

/// Names of every operation, for drift checks.
#[must_use]
pub fn operation_names() -> BTreeMap<&'static str, Vec<&'static str>> {
    BTreeMap::from([
        ("json", JSON_OPS.iter().map(|(n, _, _)| *n).collect()),
        ("vec", VEC_OPS.iter().map(|(n, _, _)| *n).collect()),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f32_bytes(v: &[f32]) -> Vec<u8> {
        put_f32(v.iter())
    }

    fn read_f32(b: &[u8]) -> Vec<f32> {
        f32s(b).unwrap()
    }

    fn jv(op: &str, input: &Value) -> Value {
        serde_json::from_str(&call_json(op, &input.to_string()).unwrap()).unwrap()
    }

    #[test]
    fn manifest_lists_every_operation_once() {
        let m: Value = serde_json::from_str(&manifest()).unwrap();
        assert_eq!(m["abi"], ABI_VERSION);
        let names = operation_names();
        assert_eq!(m["json"].as_array().unwrap().len(), names["json"].len());
        assert_eq!(m["vec"].as_array().unwrap().len(), names["vec"].len());
        for list in names.values() {
            let mut sorted = list.clone();
            sorted.sort_unstable();
            sorted.dedup();
            assert_eq!(sorted.len(), list.len(), "duplicate operation name");
        }
    }

    #[test]
    fn unknown_operations_and_bad_input_are_errors() {
        assert!(call_json("nope", "{}").unwrap_err().contains("unknown"));
        assert!(call_json("rrf", "{").unwrap_err().contains("invalid json"));
        assert!(
            call_json("rrf", "{}")
                .unwrap_err()
                .contains("invalid input")
        );
        assert!(
            call_vec("nope", "", &[], &[])
                .unwrap_err()
                .contains("unknown")
        );
        assert!(call_vec("dot_f32", "", &[1, 2, 3], &[]).is_err());
    }

    #[test]
    fn chunk_matches_direct_call() {
        let src = "fn greet() {\n    println!(\"hi\");\n}\n";
        let got = jv("chunk", &json!({ "path": "src/lib.rs", "text": src }));
        let direct =
            chunker_for_path("src/lib.rs").chunk("src/lib.rs", src, &ChunkOptions::default());
        assert_eq!(got.as_array().unwrap().len(), direct.len());
        assert_eq!(got[0]["symbol"], "greet");
        assert_eq!(got[0]["hash"], hex(&direct[0].hash));
        assert_eq!(got[0]["hash"].as_str().unwrap().len(), 64);
    }

    #[test]
    fn chunk_covers_markdown_prose_and_profiles() {
        let md = "# A\n\ntext one.\n\n## B\n\ntext two.\n";
        let got = jv(
            "chunk",
            &json!({ "path": "a.md", "text": md, "options": { "profile": "ts_parity" } }),
        );
        assert!(!got.as_array().unwrap().is_empty());
        assert!(
            call_json(
                "chunk",
                r#"{"path":"a.md","text":"x","options":{"profile":"zz"}}"#
            )
            .is_err()
        );
        let prose = jv(
            "chunk",
            &json!({ "path": "a.txt", "text": "Hello world. Second one." }),
        );
        assert_eq!(prose[0]["kind"], "prose");
    }

    #[test]
    fn text_ops() {
        assert_eq!(
            jv("detect_language", &json!({ "path": "x.tsx" })),
            "type_script"
        );
        assert_eq!(
            jv("normalize_newlines", &json!({ "text": "a\r\nb\rc" })),
            "a\nb\nc"
        );
        assert_eq!(jv("measure", &json!({ "text": "a😀", "unit": "utf16" })), 3);
        assert_eq!(jv("measure", &json!({ "text": "a😀", "unit": "chars" })), 2);
        assert_eq!(jv("measure", &json!({ "text": "a😀", "unit": "bytes" })), 5);
        let s = jv("split_sentences", &json!({ "text": "One. Two! Three?" }));
        assert_eq!(s.as_array().unwrap().len(), 3);
    }

    #[test]
    fn rrf_matches_core_and_preserves_id_types() {
        let got = jv("rrf", &json!({ "lists": [[1, 2, 3], [3, 2, 9]], "k": 60 }));
        let direct = fusion::rrf(&[&[1_usize, 2, 3][..], &[3, 2, 9][..]], 60.0);
        assert_eq!(got.as_array().unwrap().len(), direct.len());
        for (g, (id, score)) in got.as_array().unwrap().iter().zip(direct) {
            assert_eq!(g["id"], id);
            assert!((g["score"].as_f64().unwrap() - score).abs() < 1e-12);
        }
        let s = jv("rrf", &json!({ "lists": [["a", "b"], ["b"]] }));
        assert_eq!(s[0]["id"], "b");
        let w = jv(
            "rrf_weighted",
            &json!({ "lists": [{ "ids": ["a"], "weight": 2.0 }, { "ids": ["b"], "weight": 1.0 }] }),
        );
        assert_eq!(w[0]["id"], "a");
    }

    #[test]
    fn fusion_ops() {
        let f = jv(
            "fuse_scores",
            &json!({ "scaling": "min_max", "lists": [
                { "items": [{"id": "a", "score": 2.0}, {"id": "b", "score": 1.0}], "weight": 1.0 },
                { "items": [{"id": "b", "score": 5.0}, {"id": "c", "score": 0.0}], "weight": 1.0 } ] }),
        );
        assert_eq!(f.as_array().unwrap().len(), 3);
        let w = jv(
            "apply_source_weights",
            &json!({ "candidates": [
                {"id": 1, "source_id": "x", "score": 1.0}, {"id": 2, "source_id": "y", "score": 0.9}],
                "weights": [{"source_id": "y", "weight": 2.0}], "top_n": 1 }),
        );
        assert_eq!(w[0]["id"], 2);
        let m = jv(
            "mmr",
            &json!({ "lambda": 0.5, "top_n": 2, "candidates": [
                {"id": "a", "embedding": [1.0, 0.0], "score": 1.0},
                {"id": "b", "embedding": [1.0, 0.0], "score": 0.9},
                {"id": "c", "embedding": [0.0, 1.0], "score": 0.8}] }),
        );
        assert_eq!(m, json!(["a", "c"]));
        assert_eq!(
            jv("minmax_normalize", &json!({ "values": [1.0, 3.0] })),
            json!([0.0, 1.0])
        );
        let t = jv(
            "merge_top_k",
            &json!({ "k": 2, "parts": [[{"index": 5, "score": 0.5}], [{"index": 1, "score": 0.9}, {"index": 2, "score": 0.1}]] }),
        );
        assert_eq!(t[0]["index"], 1);
        assert_eq!(t.as_array().unwrap().len(), 2);
    }

    #[test]
    fn eval_pipeline() {
        let gold = jv(
            "eval_parse_gold",
            &json!({ "text": "// c\n{\"q\":\"x\",\"expectUrl\":[\"/a\"],\"tags\":[\"t\"]}\nbad\n" }),
        );
        assert_eq!(gold.as_array().unwrap().len(), 1);
        let case = gold[0].clone();
        let hit = |url: &str| json!({ "title": "t", "url": url, "snippet": "s", "score": 1.0 });
        let results = json!([hit("/zzz"), hit("https://example.com/a/")]);
        assert_eq!(
            jv(
                "eval_normalize_url",
                &json!({ "url": "https://example.com/A/" })
            ),
            "/a"
        );
        assert_eq!(
            jv(
                "eval_matches_url",
                &json!({ "actual": "/a/b", "expected": "/a" })
            ),
            true
        );
        assert_eq!(
            jv(
                "eval_matches_url",
                &json!({ "actual": "/ab", "expected": "/a" })
            ),
            false
        );
        assert_eq!(
            jv(
                "eval_first_hit_rank",
                &json!({ "results": results, "case": case })
            ),
            2
        );
        assert!(
            jv(
                "eval_ndcg_at_k",
                &json!({ "results": results, "case": case })
            )
            .as_f64()
            .unwrap()
                > 0.0
        );
        assert_eq!(
            jv("eval_is_hit", &json!({ "hit": hit("/a"), "case": case })),
            true
        );
        let run = jv(
            "eval_run_case",
            &json!({ "case": case, "results": results, "mode": "hybrid", "latency_ms": 12 }),
        );
        let cases = json!({ "cases": [run] });
        let agg = jv("eval_aggregate", &cases);
        assert_eq!(agg["cases"], 1);
        assert_eq!(agg["recall"]["5"], 1.0);
        assert!(jv("eval_aggregate_by_tag", &cases).get("t").is_some());
        assert_eq!(
            jv(
                "eval_gate_check",
                &json!({ "expr": "recall@5>=0.8", "aggregate": agg })
            )["ok"],
            true
        );
        assert_eq!(
            jv(
                "eval_gate_check",
                &json!({ "expr": "recall@1>=0.8", "aggregate": agg })
            )["ok"],
            false
        );
        assert!(
            call_json(
                "eval_gate_check",
                &json!({ "expr": "wat", "aggregate": agg }).to_string()
            )
            .is_err()
        );
        let report = jv("eval_report", &json!({ "condition": "c", "cases": [run] }));
        let cmp = jv(
            "eval_compare",
            &json!({ "baseline": report, "candidate": report }),
        );
        assert_eq!(cmp["mrr"]["delta"], 0.0);
        let other = jv("eval_report", &json!({ "condition": "d", "cases": [run] }));
        assert!(
            call_json(
                "eval_compare",
                &json!({ "baseline": report, "candidate": other }).to_string()
            )
            .is_err()
        );
        assert_eq!(
            jv(
                "eval_quantile",
                &json!({ "values": [1.0, 2.0, 3.0, 4.0], "q": 0.5 })
            ),
            3.0
        );
        assert_eq!(
            jv("eval_latency_stats", &json!({ "latencies_ms": [10.0] }))["p95_ms"],
            10.0
        );
    }

    #[test]
    fn vector_ops_match_core() {
        let v = [3.0_f32, 4.0, 0.0, 2.0];
        let n = read_f32(
            &call_vec(
                "normalize_f32",
                r#"{"rows":2,"width":2}"#,
                &f32_bytes(&v),
                &[],
            )
            .unwrap(),
        );
        assert!((n[0] - 0.6).abs() < 1e-6 && (n[1] - 0.8).abs() < 1e-6);
        let sim = read_f32(
            &call_vec(
                "similarities_f32",
                r#"{"rows":2,"right_rows":2,"width":2}"#,
                &f32_bytes(&v),
                &f32_bytes(&v),
            )
            .unwrap(),
        );
        assert_eq!(sim, vec![25.0, 8.0, 8.0, 4.0]);
        let mean = read_f32(
            &call_vec("mean_f32", r#"{"rows":2,"width":2}"#, &f32_bytes(&v), &[]).unwrap(),
        );
        assert_eq!(mean, vec![1.5, 3.0]);
        let d = read_f32(
            &call_vec(
                "squared_distances_f32",
                r#"{"rows":2,"right_rows":1,"width":2}"#,
                &f32_bytes(&v),
                &f32_bytes(&[0.0, 0.0]),
            )
            .unwrap(),
        );
        assert_eq!(d, vec![25.0, 4.0]);
        assert_eq!(
            read_f32(
                &call_vec(
                    "dot_f32",
                    "",
                    &f32_bytes(&[1.0, 2.0]),
                    &f32_bytes(&[3.0, 4.0])
                )
                .unwrap()
            ),
            vec![11.0]
        );
        let c = read_f32(
            &call_vec(
                "cosine_f32",
                "",
                &f32_bytes(&[1.0, 0.0]),
                &f32_bytes(&[1.0, 0.0]),
            )
            .unwrap(),
        );
        assert!((c[0] - 1.0).abs() < 1e-6);
        let l2 = read_f32(
            &call_vec(
                "l2_normalize_f32",
                r#"{"rows":1,"width":2}"#,
                &f32_bytes(&[3.0, 4.0]),
                &[],
            )
            .unwrap(),
        );
        assert!((l2[0] - 0.6).abs() < 1e-6);
        // f64 family and update_centers
        let b64 = put_f64([3.0_f64, 4.0].iter());
        let n64 = f64s(&call_vec("normalize_f64", r#"{"rows":1,"width":2}"#, &b64, &[]).unwrap())
            .unwrap();
        assert!((n64[0] - 0.6).abs() < 1e-12);
        assert_eq!(
            f64s(&call_vec("mean_f64", r#"{"rows":1,"width":2}"#, &b64, &[]).unwrap()).unwrap(),
            vec![3.0, 4.0]
        );
        assert_eq!(
            f64s(
                &call_vec(
                    "similarities_f64",
                    r#"{"rows":1,"right_rows":1,"width":2}"#,
                    &b64,
                    &b64
                )
                .unwrap()
            )
            .unwrap(),
            vec![25.0]
        );
        assert_eq!(
            f64s(
                &call_vec(
                    "squared_distances_f64",
                    r#"{"rows":1,"right_rows":1,"width":2}"#,
                    &b64,
                    &b64
                )
                .unwrap()
            )
            .unwrap(),
            vec![0.0]
        );
        let uc = call_vec(
            "update_centers_f64",
            r#"{"rows":1,"right_rows":1,"width":2,"labels":[0]}"#,
            &b64,
            &b64,
        )
        .unwrap();
        assert_eq!(uc.len(), 16);
        assert!(
            call_vec(
                "normalize_f32",
                r#"{"rows":3,"width":2}"#,
                &f32_bytes(&v),
                &[]
            )
            .is_err()
        );
    }

    #[test]
    fn top_k_ops_and_int8() {
        let matrix = [1.0_f32, 0.0, 0.0, 1.0, 0.7, 0.7];
        let q = f32_bytes(&[1.0, 0.0]);
        let hits = call_vec(
            "top_k_cosine_f32",
            r#"{"dim":2,"k":2}"#,
            &q,
            &f32_bytes(&matrix),
        )
        .unwrap();
        assert_eq!(hits.len(), 16);
        assert_eq!(u32::from_le_bytes(hits[0..4].try_into().unwrap()), 0);
        assert_eq!(u32::from_le_bytes(hits[8..12].try_into().unwrap()), 2);
        let unit = [1.0_f32, 0.0, 0.0, 1.0];
        let dot = call_vec("top_k_dot_f32", r#"{"dim":2,"k":1}"#, &q, &f32_bytes(&unit)).unwrap();
        assert_eq!(u32::from_le_bytes(dot[0..4].try_into().unwrap()), 0);
        // int8: quantize each unit row, concatenate codes then scales
        let mut codes = Vec::new();
        let mut scales = Vec::new();
        for row in unit.chunks(2) {
            let qz = call_vec("quantize_i8", "", &f32_bytes(row), &[]).unwrap();
            scales.extend_from_slice(&qz[..4]);
            codes.extend_from_slice(&qz[4..]);
        }
        codes.extend_from_slice(&scales);
        let i8hits = call_vec("top_k_i8", r#"{"dim":2,"k":1,"rows":2}"#, &q, &codes).unwrap();
        assert_eq!(u32::from_le_bytes(i8hits[0..4].try_into().unwrap()), 0);
        assert!(call_vec("top_k_i8", r#"{"dim":2,"k":1,"rows":3}"#, &q, &codes).is_err());
    }
}
