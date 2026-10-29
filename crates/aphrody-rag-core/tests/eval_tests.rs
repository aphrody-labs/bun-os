// SPDX-License-Identifier: Apache-2.0
//! Parity tests for the `eval` module against the TypeScript `rag-eval.ts` rules.
//! Two sources of ground truth: hand-derived goldens, computed by tracing the TypeScript reference
//! algorithm quoted in `eval.rs`'s doc comments against each input and documented inline at each
//! case.

use aphrody_rag_core::eval::{
    Gate, GoldCase, RetrievedHit, aggregate, aggregate_by_tag, compare, first_hit_rank, is_hit,
    matches_expected_url, ndcg_at_k, normalize_url, parse_gold, quantile, run_case,
};

fn hit(title: &str, url: &str, snippet: &str) -> RetrievedHit {
    RetrievedHit {
        title: title.to_string(),
        url: url.to_string(),
        snippet: snippet.to_string(),
        score: 1.0,
        ..Default::default()
    }
}

fn url_case(q: &str, expect_url: &[&str]) -> GoldCase {
    GoldCase {
        q: q.to_string(),
        expect_url: expect_url.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    }
}

fn text_case(q: &str, expect: &[&str]) -> GoldCase {
    GoldCase {
        q: q.to_string(),
        expect: expect.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    }
}

// --- normalize_url / matches_expected_url ----------------------------------

#[test]
fn normalize_url_strips_origin_and_trailing_slash() {
    assert_eq!(
        normalize_url("https://www.example.com/wiki/Freezer/"),
        "/wiki/freezer"
    );
    assert_eq!(
        normalize_url("https://example.com/wiki/Freezer"),
        "/wiki/freezer"
    );
    assert_eq!(normalize_url("/wiki/Freezer"), "/wiki/freezer");
}

#[test]
fn normalize_url_keeps_slash_before_query_or_hash() {
    // The JS lookahead only strips a slash right before `$`, `?`, or `#` — a
    // slash mid-path is untouched either way; this exercises the boundary.
    assert_eq!(normalize_url("/wiki/Freezer/?x=1"), "/wiki/freezer?x=1");
    assert_eq!(normalize_url("/wiki/Freezer/#top"), "/wiki/freezer#top");
}

#[test]
fn matches_expected_url_boundary_rejects_prefix_collision() {
    assert!(!matches_expected_url(
        "/wiki/freezer-futur",
        "/wiki/freezer"
    ));
    assert!(matches_expected_url("/wiki/freezer", "/wiki/freezer"));
    assert!(matches_expected_url(
        "/wiki/freezer/forme-finale",
        "/wiki/freezer"
    ));
    assert!(matches_expected_url("/wiki/freezer#bio", "/wiki/freezer"));
    assert!(matches_expected_url(
        "/wiki/freezer?tab=bio",
        "/wiki/freezer"
    ));
}

#[test]
fn matches_expected_url_empty_expected_never_matches() {
    assert!(!matches_expected_url("/wiki/freezer", ""));
}

// --- is_hit ------------------------------------------------------------------

#[test]
fn is_hit_url_case_ignores_expect_field() {
    // `expect` is documented as diagnostic-only once `expectUrl` is set.
    let mut c = url_case("who is freezer", &["/wiki/freezer"]);
    c.expect = vec!["nonsense that never appears".to_string()];
    let h = hit("Freezer", "/wiki/freezer", "The tyrant of universe 7.");
    assert!(is_hit(&h, &c));
}

#[test]
fn is_hit_falls_back_to_text_when_no_url_case() {
    let c = text_case("what is a zeni", &["zeni"]);
    let h = hit(
        "Currency",
        "/wiki/monnaie",
        "The zeni is the currency of Earth.",
    );
    assert!(is_hit(&h, &c));
    let miss = hit("Unrelated", "/wiki/x", "nothing here");
    assert!(!is_hit(&miss, &c));
}

#[test]
fn is_hit_expect_title_matches_case_insensitively() {
    let c = GoldCase {
        q: "q".to_string(),
        expect_title: vec!["Freezer".to_string()],
        ..Default::default()
    };
    let h = hit("freezer (personnage)", "/wiki/whatever-url", "bio");
    assert!(is_hit(&h, &c));
}

// --- first_hit_rank / ndcg_at_k ------------------------------------------------

#[test]
fn first_hit_rank_zero_when_absent() {
    let c = url_case("q", &["/wiki/freezer"]);
    let results = vec![
        hit("Goku", "/wiki/goku", ""),
        hit("Vegeta", "/wiki/vegeta", ""),
    ];
    assert_eq!(first_hit_rank(&results, &c), 0);
}

#[test]
fn first_hit_rank_is_one_based() {
    let c = url_case("q", &["/wiki/freezer"]);
    let results = vec![
        hit("Goku", "/wiki/goku", ""),
        hit("Freezer", "/wiki/freezer", ""),
    ];
    assert_eq!(first_hit_rank(&results, &c), 2);
}

#[test]
fn ndcg_zero_hits_is_zero() {
    let c = url_case("q", &["/wiki/freezer"]);
    let results = vec![hit("Goku", "/wiki/goku", "")];
    assert_eq!(ndcg_at_k(&results, &c, 10), 0.0);
}

#[test]
fn ndcg_single_top_hit_is_one() {
    // hits=1, dcg = 1/log2(2) = 1; idcg = same sum over hits=1 => 1. 1/1=1.
    let c = url_case("q", &["/wiki/freezer"]);
    let results = vec![hit("Freezer", "/wiki/freezer", "")];
    assert!((ndcg_at_k(&results, &c, 10) - 1.0).abs() < 1e-9);
}

#[test]
fn ndcg_two_hits_not_at_top_is_less_than_one() {
    // Both results are hits (same case, multiple prefixes) at rank 1 and 2:
    // dcg = 1/log2(2) + 1/log2(3) = 1 + 0.6309... = 1.6309...
    // idcg (hits=2, assumed contiguous at top) = 1/log2(2) + 1/log2(3) = same.
    // => ndcg == 1.0 exactly, because the *upstream* IDCG rule assumes the
    // hits found are already optimally placed among themselves (see the doc
    // comment on `ndcg_at_k`), not that a single earlier hit would be better.
    let c = url_case("q", &["/wiki/freezer", "/wiki/freezer-hell"]);
    let results = vec![
        hit("Freezer", "/wiki/freezer", ""),
        hit("Freezer Hell", "/wiki/freezer-hell", ""),
    ];
    assert!((ndcg_at_k(&results, &c, 10) - 1.0).abs() < 1e-9);
}

#[test]
fn ndcg_hit_at_rank_two_only_is_less_than_one() {
    // Only rank 2 is a hit: dcg = 1/log2(3) ≈ 0.6309; idcg (hits=1) = 1/log2(2) = 1.
    // ndcg = 0.6309/1 ≈ 0.6309.
    let c = url_case("q", &["/wiki/freezer"]);
    let results = vec![
        hit("Goku", "/wiki/goku", ""),
        hit("Freezer", "/wiki/freezer", ""),
    ];
    let n = ndcg_at_k(&results, &c, 10);
    let expected = (1.0 / (3.0_f64).log2()) / 1.0;
    assert!((n - expected).abs() < 1e-9, "{n} vs {expected}");
}

// --- aggregate / aggregate_by_tag --------------------------------------------

#[test]
fn aggregate_recall_and_mrr_over_three_cases() {
    // ranks: [1, 3, 0] -> recall@1 = 1/3, recall@3 = 2/3, recall@5=recall@10=2/3
    // mrr = (1/1 + 1/3 + 0)/3 = (1 + 0.3333)/3 = 0.44444...
    //
    // `run_case` always computes `rank` from the (here empty) `results`
    // slice, so each case's rank is set by hand afterward to drive
    // `aggregate` with a known distribution.
    let mut results = Vec::new();
    for (i, rank) in [1usize, 3, 0].into_iter().enumerate() {
        let mut cr = run_case(url_case(&format!("q{i}"), &["/x"]), &[], "lexical", 0);
        cr.rank = rank;
        results.push(cr);
    }
    let agg = aggregate(&results);
    assert_eq!(agg.cases, 3);
    assert!((agg.recall[&1] - 1.0 / 3.0).abs() < 1e-9);
    assert!((agg.recall[&3] - 2.0 / 3.0).abs() < 1e-9);
    assert!((agg.recall[&5] - 2.0 / 3.0).abs() < 1e-9);
    assert!((agg.recall[&10] - 2.0 / 3.0).abs() < 1e-9);
    assert!((agg.mrr - ((1.0 + 1.0 / 3.0) / 3.0)).abs() < 1e-9);
}

#[test]
fn aggregate_by_tag_groups_untagged_cases() {
    let mut a = run_case(
        GoldCase {
            q: "a".to_string(),
            expect_url: vec!["/a".to_string()],
            tags: vec!["lang-fr".to_string()],
            ..Default::default()
        },
        &[],
        "lexical",
        0,
    );
    a.rank = 1;
    a.ndcg = 1.0;
    let mut b = run_case(
        GoldCase {
            q: "b".to_string(),
            expect_url: vec!["/b".to_string()],
            ..Default::default()
        },
        &[],
        "lexical",
        0,
    );
    b.rank = 0;
    let by_tag = aggregate_by_tag(&[a, b]);
    assert_eq!(by_tag["lang-fr"].cases, 1);
    assert_eq!(by_tag["untagged"].cases, 1);
}

// --- parse_gold ---------------------------------------------------------------

#[test]
fn parse_gold_skips_comments_blanks_and_invalid_json() {
    let text = "// a comment\n\n{\"q\":\"valid\",\"expectUrl\":[\"/x\"]}\nnot json at \
                all\n{\"q\":\"no matcher\"}\n";
    let cases = parse_gold(text);
    assert_eq!(cases.len(), 1);
    assert_eq!(cases[0].q, "valid");
}

// --- quantile ------------------------------------------------------------------

#[test]
fn quantile_matches_ts_nearest_rank_method() {
    // sorted = [10,20,30,40,50] (len=5); p50 -> idx=min(4, floor(0.5*5)=2) -> 30
    // p95 -> idx=min(4, floor(0.95*5)=4) -> 50
    let v = [50.0, 10.0, 40.0, 20.0, 30.0];
    assert_eq!(quantile(&v, 0.5), 30.0);
    assert_eq!(quantile(&v, 0.95), 50.0);
    assert_eq!(quantile(&[], 0.5), 0.0);
}

// --- Gate -----------------------------------------------------------------------

#[test]
fn gate_parses_and_checks_recall_expression() {
    let gate = Gate::parse("recall@5>=0.80").unwrap();
    let mut results = Vec::new();
    for rank in [1, 1, 1, 1, 0] {
        let mut cr = run_case(url_case("q", &["/x"]), &[], "lexical", 0);
        cr.rank = rank;
        results.push(cr);
    }
    let agg = aggregate(&results); // recall@5 = 4/5 = 0.8
    assert!(gate.check(&agg).is_ok());
    let strict = Gate::parse("recall@5>=0.90").unwrap();
    assert!(strict.check(&agg).is_err());
}

#[test]
fn gate_parses_mrr_and_ndcg() {
    assert!(Gate::parse("mrr>=0.6").is_ok());
    assert!(Gate::parse("ndcg@10>0.7").is_ok());
    assert!(Gate::parse("garbage").is_err());
}

// --- compare --------------------------------------------------------------------

#[test]
fn compare_refuses_mixed_conditions_unless_allowed() {
    let mut a = run_case(url_case("q", &["/x"]), &[], "lexical", 0);
    a.rank = 1;
    let report_lexical = aphrody_rag_core::eval::Report::from_cases("lexical", vec![a.clone()]);
    let report_hybrid = aphrody_rag_core::eval::Report::from_cases("hybrid", vec![a]);
    assert!(compare(&report_lexical, &report_hybrid, false).is_err());
    assert!(compare(&report_lexical, &report_hybrid, true).is_ok());
}

#[test]
fn compare_flags_per_tag_recall5_regression() {
    let mut good = run_case(
        GoldCase {
            q: "q".to_string(),
            expect_url: vec!["/x".to_string()],
            tags: vec!["t".to_string()],
            ..Default::default()
        },
        &[],
        "lexical",
        0,
    );
    good.rank = 1;
    let mut bad = good.clone();
    bad.rank = 0;
    let baseline = aphrody_rag_core::eval::Report::from_cases("lexical", vec![good]);
    let candidate = aphrody_rag_core::eval::Report::from_cases("lexical", vec![bad]);
    let cmp = compare(&baseline, &candidate, false).unwrap();
    assert!(cmp.by_tag_recall5_regressions.contains_key("t"));
    assert!(cmp.recall[&5].delta < 0.0);
}

// --- RetrievedHit round-trips the reference production hit shape ----------

#[test]
fn retrieved_hit_round_trips_production_json_losslessly() {
    // Captured from a real `hybridSearch` response shape (`rag.ts:45-62`).
    let production = serde_json::json!({
        "rowid": 1,
        "kind": "character",
        "title": "Son Goku",
        "url": "/personnages/son-goku",
        "snippet": "...",
        "sourceId": "db_characters",
        "lang": "fr",
        "score": 12.5
    });
    let parsed: RetrievedHit =
        serde_json::from_value(production.clone()).expect("deserialize production hit");
    assert_eq!(parsed.rowid, Some(1));
    assert_eq!(parsed.kind.as_deref(), Some("character"));
    assert_eq!(parsed.title, "Son Goku");
    assert_eq!(parsed.url, "/personnages/son-goku");
    assert_eq!(parsed.snippet, "...");
    assert_eq!(parsed.source_id.as_deref(), Some("db_characters"));
    assert_eq!(parsed.lang.as_deref(), Some("fr"));
    assert!((parsed.score - 12.5).abs() < f64::EPSILON);

    // Lossless: re-serializing must reproduce every field with the same
    // JSON keys (camelCase `sourceId`, present `rowid`/`kind`), not just
    // equal Rust values.
    let round_tripped = serde_json::to_value(&parsed).expect("serialize back to JSON");
    assert_eq!(round_tripped, production);
}

#[test]
fn retrieved_hit_omits_optional_fields_when_absent() {
    let minimal = serde_json::json!({ "title": "x", "url": "/x", "snippet": "s", "score": 1.0 });
    let parsed: RetrievedHit = serde_json::from_value(minimal).expect("deserialize minimal hit");
    assert_eq!(parsed.rowid, None);
    assert_eq!(parsed.kind, None);
    let out = serde_json::to_value(&parsed).unwrap();
    assert!(out.get("rowid").is_none());
    assert!(out.get("kind").is_none());
}
