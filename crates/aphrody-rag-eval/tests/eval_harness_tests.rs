// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

use std::sync::Arc;

use aphrody_rag::{Embedder, RagSearcher, RagStore, SearchMode, StubEmbedder};
use aphrody_rag_core::eval::{GoldCase, RetrievedHit};
use aphrody_rag_eval::{
    EvalError, EvalOptions, EvalTarget, LocalIndexTarget, TargetResponse, run_eval,
};
use async_trait::async_trait;

struct MockTarget {
    name: String,
    mode: String,
    return_hits: Vec<RetrievedHit>,
}

#[async_trait]
impl EvalTarget for MockTarget {
    fn name(&self) -> &str {
        &self.name
    }

    async fn query(&self, _query: &str, limit: usize) -> Result<TargetResponse, EvalError> {
        let hits: Vec<RetrievedHit> = self.return_hits.iter().take(limit).cloned().collect();
        Ok(TargetResponse {
            hits,
            mode_served: self.mode.clone(),
            latency_ms: 12,
        })
    }
}

#[tokio::test]
async fn test_harness_eval_metrics_and_markdown() {
    let mock = MockTarget {
        name: "test-mock".to_string(),
        mode: "hybrid".to_string(),
        return_hits: vec![
            RetrievedHit {
                title: "Goku Ultra Instinct".to_string(),
                url: "https://example.com/goku-ui".to_string(),
                snippet: "Goku reaches divine speed.".to_string(),
                score: 0.95,
                ..Default::default()
            },
            RetrievedHit {
                title: "Vegeta Ultra Ego".to_string(),
                url: "https://example.com/vegeta-ue".to_string(),
                snippet: "Destruction power unleashed.".to_string(),
                score: 0.85,
                ..Default::default()
            },
        ],
    };

    let cases = vec![
        GoldCase {
            q: "ultra instinct".to_string(),
            expect_url: vec!["/goku-ui".to_string()],
            tags: vec!["dbs".to_string()],
            ..Default::default()
        },
        GoldCase {
            q: "ultra ego".to_string(),
            expect_url: vec!["/vegeta-ue".to_string()],
            tags: vec!["dbs".to_string()],
            ..Default::default()
        },
    ];

    let opts = EvalOptions {
        limit_k: 5,
        allow_mixed: false,
        gates: vec!["recall@5>=0.90".to_string(), "mrr>=0.50".to_string()],
        tag_filter: None,
    };

    let summary = run_eval(&mock, &cases, &opts).await.expect("run eval ok");

    assert_eq!(summary.cases_count(), 2);
    assert_eq!(summary.dominant_mode, "hybrid");
    assert!(summary.passed_gates);
    assert!(summary.gate_failures.is_empty());

    // Case 1 hit at rank 1, Case 2 hit at rank 2
    // Recall@1 = 0.5, Recall@5 = 1.0, MRR = (1.0 + 0.5) / 2 = 0.75
    let r5 = summary
        .report
        .overall
        .recall
        .get(&5)
        .copied()
        .unwrap_or(0.0);
    assert_eq!(r5, 1.0);
    assert!((summary.report.overall.mrr - 0.75).abs() < 1e-4);

    let md = summary.format_markdown();
    assert!(md.contains("## RAG Evaluation Report: `test-mock`"));
    assert!(md.contains("PASSED"));
    assert!(md.contains("`dbs`"));
}

#[tokio::test]
async fn test_harness_gate_failure() {
    let mock = MockTarget {
        name: "test-failing-gate".to_string(),
        mode: "lexical".to_string(),
        return_hits: vec![],
    };

    let cases = vec![GoldCase {
        q: "missing hit".to_string(),
        expect: vec!["keyword".to_string()],
        ..Default::default()
    }];

    let opts = EvalOptions {
        gates: vec!["recall@5>=0.80".to_string()],
        ..Default::default()
    };

    let summary = run_eval(&mock, &cases, &opts).await.expect("run eval");
    assert!(!summary.passed_gates);
    assert_eq!(summary.gate_failures.len(), 1);
    assert!(summary.gate_failures[0].contains("gate failed"));
}

#[tokio::test]
async fn test_harness_condition_mismatch_aborts() {
    struct MixedTarget {
        call_count: std::sync::atomic::AtomicUsize,
    }

    #[async_trait]
    impl EvalTarget for MixedTarget {
        fn name(&self) -> &str {
            "mixed"
        }

        async fn query(&self, _query: &str, _limit: usize) -> Result<TargetResponse, EvalError> {
            let count = self
                .call_count
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let mode = if count == 0 {
                "hybrid".to_string()
            } else {
                "lexical".to_string()
            };
            Ok(TargetResponse {
                hits: vec![],
                mode_served: mode,
                latency_ms: 10,
            })
        }
    }

    let target = MixedTarget {
        call_count: std::sync::atomic::AtomicUsize::new(0),
    };

    let cases = vec![
        GoldCase {
            q: "q1".to_string(),
            expect: vec!["a".to_string()],
            ..Default::default()
        },
        GoldCase {
            q: "q2".to_string(),
            expect: vec!["b".to_string()],
            ..Default::default()
        },
    ];

    // With allow_mixed = false -> should abort with ConditionMismatch
    let opts = EvalOptions {
        allow_mixed: false,
        ..Default::default()
    };

    let err = run_eval(&target, &cases, &opts).await.unwrap_err();
    match err {
        EvalError::ConditionMismatch { expected, observed } => {
            assert_eq!(expected, "hybrid");
            assert_eq!(observed, "lexical");
        }
        other => panic!("Expected ConditionMismatch, got {:?}", other),
    }

    // With allow_mixed = true -> should succeed
    let target_ok = MixedTarget {
        call_count: std::sync::atomic::AtomicUsize::new(0),
    };
    let opts_allow = EvalOptions {
        allow_mixed: true,
        ..Default::default()
    };
    let ok = run_eval(&target_ok, &cases, &opts_allow).await;
    assert!(ok.is_ok());
}

#[tokio::test]
async fn missing_mode_is_rejected_even_when_mixed_modes_are_allowed() {
    let target = MockTarget {
        name: "unknown-mode".into(),
        mode: "unknown".into(),
        return_hits: vec![],
    };
    let cases = vec![GoldCase {
        q: "query".into(),
        ..Default::default()
    }];
    let opts = EvalOptions {
        allow_mixed: true,
        ..Default::default()
    };
    assert!(matches!(
        run_eval(&target, &cases, &opts).await,
        Err(EvalError::ConditionMismatch { .. })
    ));
}

#[tokio::test]
async fn http_target_serializes_get_requests_at_two_qps() {
    use std::time::{Duration, Instant};

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        sync::mpsc,
    };

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("local address");
    let (sender, mut received) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut request = [0u8; 2048];
            let count = socket.read(&mut request).await.expect("read request");
            sender
                .send((
                    Instant::now(),
                    String::from_utf8_lossy(&request[..count]).into_owned(),
                ))
                .expect("send observation");
            let body = r#"{"hits":[],"mode_served":"lexical"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \
                 {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket
                .write_all(response.as_bytes())
                .await
                .expect("respond");
        }
    });
    let target = aphrody_rag_eval::HttpTarget::new(format!("http://{addr}/search"))
        .with_rate_limit(Duration::from_millis(1));
    let (first, second) = tokio::join!(target.query("first", 5), target.query("second", 5));
    assert_eq!(first.expect("first query").mode_served, "lexical");
    assert_eq!(second.expect("second query").mode_served, "lexical");
    let (at_first, request_first) = received.recv().await.expect("first request");
    let (at_second, request_second) = received.recv().await.expect("second request");
    assert!(at_second.duration_since(at_first) >= Duration::from_millis(480));
    assert!(request_first.starts_with("GET /search?"));
    assert!(request_second.starts_with("GET /search?"));
    assert!(
        request_first
            .to_ascii_lowercase()
            .contains("user-agent: aphrody-rag-eval/")
    );
}

#[tokio::test]
async fn test_local_index_target_evaluation() {
    let store = Arc::new(RagStore::open_in_memory().expect("open store"));
    let embedder = Arc::new(StubEmbedder::new());

    let doc_id = store
        .upsert_doc(
            "crates/cli/src/main.rs",
            "hash_main",
            Some("Main Entrypoint"),
            Some("rust"),
            1710000000,
            100,
        )
        .await
        .expect("upsert doc");

    let chunk_id = store
        .insert_chunk(
            doc_id,
            0,
            Some("entry"),
            None,
            "pub fn main() {\n    println!(\"Aphrody Agent\");\n}",
            1,
            3,
            10,
        )
        .await
        .expect("insert chunk");

    let emb = embedder.embed_query("pub fn main").await.expect("embed");
    store
        .insert_vector(chunk_id, embedder.model_id(), &emb)
        .await
        .expect("insert vector");

    let searcher = Arc::new(RagSearcher::new(store).with_embedder(embedder));
    let local_target = LocalIndexTarget::new(searcher).with_mode(SearchMode::Hybrid);

    let cases = vec![GoldCase {
        q: "Aphrody Agent".to_string(),
        expect_url: vec!["crates/cli/src/main.rs".to_string()],
        ..Default::default()
    }];

    let opts = EvalOptions {
        limit_k: 5,
        gates: vec!["recall@1==1.0".to_string()],
        ..Default::default()
    };

    let summary = run_eval(&local_target, &cases, &opts)
        .await
        .expect("eval local target");

    assert!(summary.passed_gates);
    assert_eq!(summary.dominant_mode, "hybrid");
    assert_eq!(summary.report.overall.recall.get(&1).copied(), Some(1.0));
}

#[tokio::test]
async fn test_http_target_circuit_breaker() {
    use std::time::Duration;

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("local addr");

    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let response = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: \
                            0\r\nConnection: close\r\n\r\n";
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });

    let target = aphrody_rag_eval::HttpTarget::new(format!("http://{addr}/search"))
        .with_rate_limit(Duration::from_millis(5))
        .with_max_failures(3);

    let cases = vec![
        GoldCase {
            q: "q1".to_string(),
            ..Default::default()
        },
        GoldCase {
            q: "q2".to_string(),
            ..Default::default()
        },
        GoldCase {
            q: "q3".to_string(),
            ..Default::default()
        },
        GoldCase {
            q: "q4".to_string(),
            ..Default::default()
        },
    ];

    let opts = EvalOptions {
        allow_mixed: true,
        ..Default::default()
    };

    let err = run_eval(&target, &cases, &opts).await.unwrap_err();
    match err {
        EvalError::CircuitBreaker {
            consecutive_failures,
            last_status,
            ..
        } => {
            assert_eq!(consecutive_failures, 3);
            assert_eq!(last_status, 500);
        }
        other => panic!("Expected CircuitBreaker error, got {:?}", other),
    }
}
