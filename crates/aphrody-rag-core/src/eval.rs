// SPDX-License-Identifier: Apache-2.0
//! Retrieval-quality evaluation, ported bit-for-bit from the TypeScript reference's
//! `apps/bot/src/lib/rag-eval.ts` (gold-case parsing, URL matching, ranks,
//! nDCG) and `apps/bot/scripts/rag-eval.ts` (the `quantile` percentile
//! method), both read 2026-09-19. Every subtle rule below cites the TS line
//! range it mirrors so a future re-read of the source can diff against it.

use std::collections::BTreeMap;

use regex::Regex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Rank thresholds the TypeScript reference reports Recall@ for (`rag-eval.ts:31`).
pub const RANKS: [u32; 4] = [1, 3, 5, 10];

/// One row of the gold set (`rag-eval.ts:22-29`). `q` is required; a row
/// missing every matcher (`expect`/`expect_url`/`expect_title`) is dropped by
/// [`parse_gold`], mirroring `parseGold`'s filter (`rag-eval.ts:137`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GoldCase {
    pub q: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub expect: Vec<String>,
    #[serde(default, rename = "expectUrl", skip_serializing_if = "Vec::is_empty")]
    pub expect_url: Vec<String>,
    #[serde(default, rename = "expectTitle", skip_serializing_if = "Vec::is_empty")]
    pub expect_title: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

/// A single retrieved result, in the shape a target (`aphrody-rag-eval`'s
/// `HttpTarget`/`McpTarget`/`LocalIndexTarget`) hands to this crate. Field
/// names and shape match the TypeScript reference's `RagHit` (`rag.ts:45-62`) exactly, so a
/// production response `{rowid, kind, title, url, snippet, sourceId, lang,
/// score}` round-trips through this type losslessly (`rowid`/`kind` are
/// optional here because a target without a backing row, e.g. an HTTP-only
/// target, may not have them).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RetrievedHit {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rowid: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub title: String,
    pub url: String,
    pub snippet: String,
    #[serde(default, rename = "sourceId", skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    pub score: f64,
}

/// Strips a configurable origin prefix and normalises a trailing slash the
/// same way `normalizeUrl` does (`rag-eval.ts:34-40`). The default strips any
/// `http(s)://host` origin; a caller targeting an
/// index with another URL shape supplies its own `strip_origin`.
pub struct UrlNormalizer {
    pub strip_origin: Option<Regex>,
}

impl Default for UrlNormalizer {
    fn default() -> Self {
        Self {
            strip_origin: Regex::new(r"(?i)^https?://[^/?#]+").ok(),
        }
    }
}

impl UrlNormalizer {
    /// `normalizeUrl`: trim, strip origin, strip a trailing slash run only
    /// when it sits right before the end of the string or a `?`/`#`
    /// boundary (the JS lookahead `(?=$|[?#])`, replicated here with plain
    /// string ops since `regex` has no lookahead support), lowercase.
    #[must_use]
    pub fn normalize(&self, url: &str) -> String {
        let trimmed = url.trim();
        let stripped = match &self.strip_origin {
            Some(re) => re.replace(trimmed, "").into_owned(),
            None => trimmed.to_string(),
        };
        let split_at = stripped.find(['?', '#']).unwrap_or(stripped.len());
        let (path, rest) = stripped.split_at(split_at);
        let path = path.trim_end_matches('/');
        format!("{path}{rest}").to_lowercase()
    }
}

/// `normalizeUrl` (`rag-eval.ts:34`) with the default
/// origin stripper.
#[must_use]
pub fn normalize_url(url: &str) -> String {
    UrlNormalizer::default().normalize(url)
}

/// `matchesExpectedUrl` (`rag-eval.ts:43-48`): boundary-aware prefix match —
/// exact, or followed by `#`, `?`, or `/` — so `/freezer` never matches
/// `/freezer-futur`.
#[must_use]
pub fn matches_expected_url(actual: &str, expected: &str) -> bool {
    matches_expected_url_with(&UrlNormalizer::default(), actual, expected)
}

/// [`matches_expected_url`] with a caller-supplied [`UrlNormalizer`].
#[must_use]
pub fn matches_expected_url_with(normalizer: &UrlNormalizer, actual: &str, expected: &str) -> bool {
    let url = normalizer.normalize(actual);
    let prefix = normalizer.normalize(expected);
    if prefix.is_empty() {
        return false;
    }
    url == prefix
        || url.starts_with(&format!("{prefix}#"))
        || url.starts_with(&format!("{prefix}?"))
        || url.starts_with(&format!("{prefix}/"))
}

/// `isHit` (`rag-eval.ts:51-62`): when the case carries `expectUrl`/
/// `expectTitle`, ONLY those matchers decide (a `expect` substring list is
/// diagnostic-only in that case, per the module doc comment); otherwise fall
/// back to a case-insensitive substring search over `title\nsnippet`.
#[must_use]
pub fn is_hit(hit: &RetrievedHit, case: &GoldCase) -> bool {
    if !case.expect_url.is_empty() || !case.expect_title.is_empty() {
        let title = hit.title.to_lowercase();
        return case
            .expect_url
            .iter()
            .any(|p| matches_expected_url(&hit.url, p))
            || case
                .expect_title
                .iter()
                .any(|t| title.contains(&t.to_lowercase()));
    }
    let hay = format!("{}\n{}", hit.title, hit.snippet).to_lowercase();
    case.expect.iter().any(|m| hay.contains(&m.to_lowercase()))
}

/// `firstHitRank` (`rag-eval.ts:65-68`): 1-based rank of the first hit
/// satisfying `isHit`, `0` if none does.
#[must_use]
pub fn first_hit_rank(results: &[RetrievedHit], case: &GoldCase) -> usize {
    for (i, hit) in results.iter().enumerate() {
        if is_hit(hit, case) {
            return i + 1;
        }
    }
    0
}

/// `ndcgAtK` (`rag-eval.ts:74-87`): binary-gain nDCG. The IDCG is computed
/// as if every hit found in the top-`k` had landed contiguously at rank 1 —
/// not the textbook IDCG over the *whole* gold-relevant set — so nDCG can
/// only be `1.0` when every found hit is optimally placed among *itself*,
/// not when every possible relevant document is retrieved. `0.0` when no hit
/// lands in the top-`k`.
#[must_use]
pub fn ndcg_at_k(results: &[RetrievedHit], case: &GoldCase, k: usize) -> f64 {
    let mut dcg = 0.0_f64;
    let mut hits = 0usize;
    for (i, hit) in results.iter().take(k).enumerate() {
        if is_hit(hit, case) {
            dcg += 1.0 / (i as f64 + 2.0).log2();
            hits += 1;
        }
    }
    if hits == 0 {
        return 0.0;
    }
    let idcg: f64 = (0..hits).map(|i| 1.0 / (i as f64 + 2.0).log2()).sum();
    dcg / idcg
}

/// The three hits surfaced for eyeballing a case's result (`CaseResult.top`,
/// `rag-eval.ts:100`), now carrying `kind` too (correction: `RetrievedHit`
/// gained `rowid`/`kind` to round-trip the TypeScript reference's production hit shape).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TopHit {
    pub title: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// One case's outcome (`CaseResult`, `rag-eval.ts:96-103`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::struct_field_names)]
pub struct CaseResult {
    pub case: GoldCase,
    pub rank: usize,
    pub ndcg: f64,
    pub top: Vec<TopHit>,
    pub latency_ms: u64,
    pub mode: String,
}

/// Build a [`CaseResult`] from a case and its already-retrieved `results` +
/// `mode` + measured `latency_ms` (the Rust caller times the search itself,
/// unlike `runCase`'s `performance.now()` bracket, since it drives an HTTP/
/// MCP/local target rather than an in-process function).
#[must_use]
pub fn run_case(
    case: GoldCase,
    results: &[RetrievedHit],
    mode: &str,
    latency_ms: u64,
) -> CaseResult {
    let rank = first_hit_rank(results, &case);
    let ndcg = ndcg_at_k(results, &case, 10);
    let top = results
        .iter()
        .take(3)
        .map(|h| TopHit {
            title: h.title.clone(),
            url: h.url.clone(),
            kind: h.kind.clone(),
        })
        .collect();
    CaseResult {
        case,
        rank,
        ndcg,
        top,
        latency_ms,
        mode: mode.to_string(),
    }
}

/// Aggregate metrics over a set of cases (`Metrics`, `rag-eval.ts:89-94`).
/// `recall` keys are the [`RANKS`] thresholds; serialising to JSON produces
/// the same `{"1":…, "3":…, "5":…, "10":…}` shape as the TS `Record`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aggregate {
    pub cases: usize,
    pub recall: BTreeMap<u32, f64>,
    pub mrr: f64,
    pub ndcg: f64,
}

/// `aggregate` (`rag-eval.ts:105-114`).
#[must_use]
pub fn aggregate(results: &[CaseResult]) -> Aggregate {
    let n = (results.len().max(1)) as f64;
    let mut recall = BTreeMap::new();
    for &k in &RANKS {
        let within = results
            .iter()
            .filter(|r| r.rank > 0 && r.rank as u32 <= k)
            .count();
        recall.insert(k, within as f64 / n);
    }
    let mrr = results
        .iter()
        .map(|r| if r.rank > 0 { 1.0 / r.rank as f64 } else { 0.0 })
        .sum::<f64>()
        / n;
    let ndcg = results.iter().map(|r| r.ndcg).sum::<f64>() / n;
    Aggregate {
        cases: results.len(),
        recall,
        mrr,
        ndcg,
    }
}

/// `aggregateByTag` (`rag-eval.ts:117-127`): a case with no `tags` counts
/// under `"untagged"` (TS: `"sans-tag"`, renamed to keep every identifier
/// and data label English per the repository's naming contract).
#[must_use]
pub fn aggregate_by_tag(results: &[CaseResult]) -> BTreeMap<String, Aggregate> {
    let mut groups: BTreeMap<String, Vec<CaseResult>> = BTreeMap::new();
    for r in results {
        let tags = if r.case.tags.is_empty() {
            vec!["untagged".to_string()]
        } else {
            r.case.tags.clone()
        };
        for t in tags {
            groups.entry(t).or_default().push(r.clone());
        }
    }
    groups
        .into_iter()
        .map(|(t, g)| (t, aggregate(&g)))
        .collect()
}

/// `parseGold` (`rag-eval.ts:130-144`): one JSON object per non-empty,
/// non-`//`-prefixed line; a line that fails to parse, or parses to a case
/// with no `q` string and no matcher, is skipped — never fatal.
#[must_use]
pub fn parse_gold(text: &str) -> Vec<GoldCase> {
    let mut out = Vec::new();
    for line in text.split('\n') {
        let t = line.trim();
        if t.is_empty() || t.starts_with("//") {
            continue;
        }
        let Ok(case) = serde_json::from_str::<GoldCase>(t) else {
            continue;
        };
        if !case.q.is_empty()
            && (!case.expect_url.is_empty()
                || !case.expect_title.is_empty()
                || !case.expect.is_empty())
        {
            out.push(case);
        }
    }
    out
}

/// `quantile` (`apps/bot/scripts/rag-eval.ts:79-83`): `sorted[min(len-1,
/// floor(q*len))]`, `0.0` on an empty input. This is a nearest-rank
/// percentile, not linear interpolation — replicated exactly rather than
/// "fixed", since a different formula would move CI thresholds tuned
/// against the original.
#[must_use]
pub fn quantile(values: &[f64], q: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((q * sorted.len() as f64).floor() as usize).min(sorted.len() - 1);
    sorted[idx]
}

/// p50/p95 latency, as printed by `rag-eval.ts`'s CLI harness (script
/// lines 149-150).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct LatencyStats {
    pub p50_ms: f64,
    pub p95_ms: f64,
}

/// Build [`LatencyStats`] from a set of per-case latencies (milliseconds).
#[must_use]
pub fn latency_stats(latencies_ms: &[f64]) -> LatencyStats {
    LatencyStats {
        p50_ms: quantile(latencies_ms, 0.5),
        p95_ms: quantile(latencies_ms, 0.95),
    }
}

/// A full evaluation run: the served condition, overall + per-tag
/// aggregates, and every case's raw result — enough to gate CI or diff two
/// runs without re-querying the target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Report {
    pub schema_version: u32,
    /// A label for what was actually served (`"lexical"`, `"hybrid"`,
    /// `"hybrid+rerank"`, or a target-defined string). [`compare`] refuses to
    /// diff two reports with different conditions unless told to.
    pub condition: String,
    pub overall: Aggregate,
    pub by_tag: BTreeMap<String, Aggregate>,
    pub cases: Vec<CaseResult>,
}

impl Report {
    /// Build a [`Report`] from a completed run's cases.
    #[must_use]
    pub fn from_cases(condition: impl Into<String>, cases: Vec<CaseResult>) -> Self {
        Self {
            schema_version: 1,
            condition: condition.into(),
            overall: aggregate(&cases),
            by_tag: aggregate_by_tag(&cases),
            cases,
        }
    }
}

/// Errors parsing or evaluating a [`Gate`] expression.
#[derive(Debug, Error)]
pub enum EvalError {
    #[error("invalid gate expression: {0:?}")]
    InvalidGate(String),
}

/// A parsed threshold gate such as `recall@5>=0.80`, `mrr>=0.6`, or
/// `ndcg@10>0.7`. `ndcg@N` always checks [`Aggregate::ndcg`] regardless of
/// `N` — the TypeScript reference's own harness only ever computes nDCG@10, so `N` besides
/// `10` is accepted syntactically (interface parity) but evaluated against
/// the same figure.
#[derive(Debug, Clone, Copy)]
pub struct Gate {
    metric: GateMetric,
    op: GateOp,
    threshold: f64,
}

#[derive(Debug, Clone, Copy)]
enum GateMetric {
    RecallAt(u32),
    Mrr,
    Ndcg,
}

#[derive(Debug, Clone, Copy)]
enum GateOp {
    Ge,
    Gt,
    Le,
    Lt,
    Eq,
}

impl GateOp {
    fn eval(self, actual: f64, threshold: f64) -> bool {
        match self {
            Self::Ge => actual >= threshold,
            Self::Gt => actual > threshold,
            Self::Le => actual <= threshold,
            Self::Lt => actual < threshold,
            Self::Eq => (actual - threshold).abs() < f64::EPSILON,
        }
    }
}

/// Why a [`Gate`] rejected an [`Aggregate`].
#[derive(Debug, Error)]
#[error("gate failed: {expr} (actual {actual})")]
pub struct GateFailure {
    pub expr: String,
    pub actual: f64,
    pub threshold: f64,
}

static GATE_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"^(recall@(\d+)|mrr|ndcg(?:@(\d+))?)\s*(>=|<=|==|>|<)\s*([0-9]*\.?[0-9]+)$")
        .unwrap()
});

impl Gate {
    /// Parse a gate expression like `recall@5>=0.80`.
    pub fn parse(expr: &str) -> Result<Self, EvalError> {
        let caps = GATE_RE
            .captures(expr.trim())
            .ok_or_else(|| EvalError::InvalidGate(expr.to_string()))?;
        let metric = if let Some(r) = caps.get(2) {
            GateMetric::RecallAt(
                r.as_str()
                    .parse()
                    .map_err(|_| EvalError::InvalidGate(expr.to_string()))?,
            )
        } else if caps[1].starts_with("mrr") {
            GateMetric::Mrr
        } else {
            GateMetric::Ndcg
        };
        let op = match &caps[4] {
            ">=" => GateOp::Ge,
            "<=" => GateOp::Le,
            "==" => GateOp::Eq,
            ">" => GateOp::Gt,
            "<" => GateOp::Lt,
            _ => return Err(EvalError::InvalidGate(expr.to_string())),
        };
        let threshold: f64 = caps[5]
            .parse()
            .map_err(|_| EvalError::InvalidGate(expr.to_string()))?;
        Ok(Self {
            metric,
            op,
            threshold,
        })
    }

    /// Check `agg` against this gate.
    pub fn check(&self, agg: &Aggregate) -> Result<(), GateFailure> {
        let actual = match self.metric {
            GateMetric::RecallAt(k) => agg.recall.get(&k).copied().unwrap_or(0.0),
            GateMetric::Mrr => agg.mrr,
            GateMetric::Ndcg => agg.ndcg,
        };
        if self.op.eval(actual, self.threshold) {
            Ok(())
        } else {
            Err(GateFailure {
                expr: self.describe(),
                actual,
                threshold: self.threshold,
            })
        }
    }

    fn describe(&self) -> String {
        let metric = match self.metric {
            GateMetric::RecallAt(k) => format!("recall@{k}"),
            GateMetric::Mrr => "mrr".to_string(),
            GateMetric::Ndcg => "ndcg@10".to_string(),
        };
        let op = match self.op {
            GateOp::Ge => ">=",
            GateOp::Le => "<=",
            GateOp::Eq => "==",
            GateOp::Gt => ">",
            GateOp::Lt => "<",
        };
        format!("{metric}{op}{}", self.threshold)
    }
}

/// Two reports were compared with different `condition`s and `allow_mixed`
/// was not set — `docs/plans/codex-oss.md` P9's "runs with different
/// conditions are not comparable without `--allow-mixed`".
#[derive(Debug, Error)]
#[error(
    "condition mismatch: baseline={baseline:?} candidate={candidate:?} (pass allow_mixed to \
     compare anyway)"
)]
pub struct ConditionMismatch {
    pub baseline: String,
    pub candidate: String,
}

/// One metric's before/after.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MetricDelta {
    pub baseline: f64,
    pub candidate: f64,
    pub delta: f64,
}

fn delta(baseline: f64, candidate: f64) -> MetricDelta {
    MetricDelta {
        baseline,
        candidate,
        delta: candidate - baseline,
    }
}

/// The result of [`compare`]: per-metric deltas plus every tag where
/// `recall@5` regressed (delta `< 0.0`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comparison {
    pub recall: BTreeMap<u32, MetricDelta>,
    pub mrr: MetricDelta,
    pub ndcg: MetricDelta,
    pub by_tag_recall5_regressions: BTreeMap<String, MetricDelta>,
}

/// Compare `candidate` against `baseline`. Refuses (returns
/// [`ConditionMismatch`]) when the two reports' `condition` differs, unless
/// `allow_mixed` is `true`.
pub fn compare(
    baseline: &Report,
    candidate: &Report,
    allow_mixed: bool,
) -> Result<Comparison, ConditionMismatch> {
    if !allow_mixed && baseline.condition != candidate.condition {
        return Err(ConditionMismatch {
            baseline: baseline.condition.clone(),
            candidate: candidate.condition.clone(),
        });
    }
    let mut recall = BTreeMap::new();
    for &k in &RANKS {
        let b = baseline.overall.recall.get(&k).copied().unwrap_or(0.0);
        let c = candidate.overall.recall.get(&k).copied().unwrap_or(0.0);
        recall.insert(k, delta(b, c));
    }
    let mut by_tag = BTreeMap::new();
    for (tag, base_agg) in &baseline.by_tag {
        if let Some(cand_agg) = candidate.by_tag.get(tag) {
            let b = base_agg.recall.get(&5).copied().unwrap_or(0.0);
            let c = cand_agg.recall.get(&5).copied().unwrap_or(0.0);
            if c < b {
                by_tag.insert(tag.clone(), delta(b, c));
            }
        }
    }
    Ok(Comparison {
        recall,
        mrr: delta(baseline.overall.mrr, candidate.overall.mrr),
        ndcg: delta(baseline.overall.ndcg, candidate.overall.ndcg),
        by_tag_recall5_regressions: by_tag,
    })
}
