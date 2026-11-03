// SPDX-License-Identifier: Apache-2.0
use std::{net::SocketAddr, sync::Arc};

use aphrody_a2a::{AgentCapabilities, ListTasksRequest, TaskState};
use aphrody_a2a_server::{
    DefaultRequestHandler, FsTaskStore, StaticAgentCard, TaskStore, agent_card::agent_card_router,
    jsonrpc::jsonrpc_router, rest::rest_router,
};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use tokio::net::TcpListener;
use tracing::info;

use crate::{
    card::agent_card_from_manifest_with_auth, envelope::Envelope, executor::CoordPeerExecutor,
    mailbox::Mailbox, manifest::AiManifest, proxy::CoordProxy,
};

#[derive(Debug, Clone)]
pub struct ListenerConfig {
    pub bind: SocketAddr,
    pub manifest: AiManifest,
    pub repo_root: std::path::PathBuf,
    /// When true, peer CLIs are not spawned (`APHRODY_A2A_DRY_RUN` env also enables this).
    pub dry_run: bool,
}

#[derive(Clone)]
struct AppState {
    mailbox: Mailbox,
}

/// Combined HTTP surface: coord (`/ping`, `/msg`, `/coord`) + A2A JSON-RPC + agent card.
pub fn router(cfg: &ListenerConfig) -> Router {
    let coord_dir = cfg.manifest.coord_dir(&cfg.repo_root);
    let mailbox = Mailbox::new(coord_dir);
    router_with_token(cfg, mailbox, crate::auth::token())
}

/// Build the HTTP surface with all A2A files scoped to one Home Agent profile.
pub fn router_for_profile(cfg: &ListenerConfig, profile_root: &std::path::Path) -> Router {
    router_with_token(
        cfg,
        Mailbox::for_profile_root(profile_root),
        crate::auth::token(),
    )
}

fn router_with_token(cfg: &ListenerConfig, mailbox: Mailbox, token: Option<String>) -> Router {
    let app = router_with_mailbox(cfg, mailbox, token.is_some());
    crate::auth::protect(app, token)
}

fn router_with_mailbox(cfg: &ListenerConfig, mailbox: Mailbox, requires_bearer: bool) -> Router {
    let base =
        std::env::var("APHRODY_A2A_PUBLIC_URL").unwrap_or_else(|_| format!("http://{}", cfg.bind));
    let card = agent_card_from_manifest_with_auth(&cfg.manifest, &base, requires_bearer);
    let card_producer = Arc::new(StaticAgentCard::new(card));

    let dry_run = cfg.dry_run || std::env::var_os("APHRODY_A2A_DRY_RUN").is_some();
    let cap = cfg.manifest.capabilities.clone().unwrap_or_default();
    let capabilities = AgentCapabilities {
        streaming: Some(cap.streaming),
        push_notifications: Some(cap.push_notifications),
        extended_agent_card: Some(cap.extended_agent_card),
        extensions: None,
    };
    let executor = CoordPeerExecutor::new_with_mailbox(
        cfg.manifest.clone(),
        cfg.repo_root.clone(),
        mailbox.clone(),
        dry_run,
    )
    .with_default_peer(
        crate::executor::default_peer_from_env().unwrap_or(crate::peer::PeerId::Grok),
    );
    let handler = Arc::new(
        DefaultRequestHandler::new(executor, FsTaskStore::new(mailbox.coord_dir.join("a2a")))
            .with_capabilities(capabilities),
    );
    let a2a_rpc = jsonrpc_router(handler.clone());
    let a2a_rest = rest_router(handler);

    let state_mailbox = mailbox.clone();
    let task_api_root = mailbox.coord_dir.clone();
    let task_api_root_peers = task_api_root.clone();
    let state = AppState { mailbox };

    let coord = Router::new()
        .route("/ping", get(handle_ping))
        .route("/msg", post(handle_msg))
        .route("/coord", get(handle_coord))
        .with_state(state);

    Router::new()
        .merge(crate::api::router(task_api_root.clone()))
        .merge(coord)
        .merge(crate::bridge::a2a_router(
            state_mailbox,
            cfg.manifest.id.clone(),
        ))
        .merge(crate::task_api::task_api_router(
            task_api_root,
            None, // The outer listener layer authenticates every private route.
        ))
        .merge(crate::hub::peers_router(task_api_root_peers))
        .merge(agent_card_router(card_producer))
        .merge(a2a_rpc)
        .merge(a2a_rest)
}

#[cfg(test)]
mod auth_tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn config(root: &std::path::Path) -> ListenerConfig {
        ListenerConfig {
            bind: "127.0.0.1:8788".parse().unwrap(),
            manifest: serde_json::from_value(serde_json::json!({
                "version":"1", "spec":"a2a/v1.0", "id":"aphrody-test",
                "schema_version":"1", "kind":"agent", "coord":{"mailbox_dir":".coord"}
            }))
            .unwrap(),
            repo_root: root.to_path_buf(),
            dry_run: true,
        }
    }

    fn saved_task(id: &str, state: TaskState) -> aphrody_a2a::Task {
        serde_json::from_value(serde_json::json!({
            "id":id, "contextId":"saved-context", "status":{"state":state},
            "history":[{"messageId":"saved-message", "role":"ROLE_USER", "parts":[{"text":"saved history"}]}],
            "artifacts":[{"artifactId":"saved-artifact", "parts":[{"text":"saved result"}]}],
            "metadata":{"owner":"preserved"}
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn every_private_binding_rejects_missing_and_wrong_bearers() {
        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        let app = coord_router(
            &config(root.path()),
            private.path(),
            Some("test-credential".into()),
        );
        for (method, path) in [
            ("POST", "/"),
            ("POST", "/a2a"),
            ("POST", "/msg"),
            ("GET", "/coord"),
            ("POST", "/message:send"),
            ("GET", "/tasks"),
            ("GET", "/coord/aphrody/tasks"),
            ("POST", "/coord/aphrody/envelopes"),
        ] {
            for credential in [None, Some("Bearer wrong")] {
                let mut request = Request::builder().method(method).uri(path);
                if let Some(credential) = credential {
                    request = request.header("authorization", credential);
                }
                let response = app
                    .clone()
                    .oneshot(request.body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(
                    response.status(),
                    StatusCode::UNAUTHORIZED,
                    "{method} {path}"
                );
            }
        }
        for path in ["/ping", "/.well-known/agent-card.json"] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }
        assert!(!root.path().join(".coord").exists());
    }

    #[tokio::test]
    async fn discovery_and_route_auth_share_one_snapshot_for_every_router() {
        let root = tempfile::tempdir().unwrap();
        let profile = tempfile::tempdir().unwrap();
        let cfg = config(root.path());
        for token in [None, Some("snapshot-test-credential".to_owned())] {
            let apps = [
                router_with_token(
                    &cfg,
                    Mailbox::new(cfg.manifest.coord_dir(root.path())),
                    token.clone(),
                ),
                router_with_token(
                    &cfg,
                    Mailbox::for_profile_root(profile.path()),
                    token.clone(),
                ),
                coord_router(&cfg, profile.path(), token.clone()),
            ];
            for app in apps {
                let response = app
                    .clone()
                    .oneshot(
                        Request::builder()
                            .uri("/.well-known/agent-card.json")
                            .body(Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
                    .await
                    .unwrap();
                let card: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                if token.is_some() {
                    assert_eq!(
                        card["securitySchemes"]["bearer"]["httpAuthSecurityScheme"]["scheme"],
                        "Bearer"
                    );
                    assert_eq!(
                        card["securityRequirements"],
                        serde_json::json!([{ "bearer": [] }])
                    );
                    assert!(
                        !String::from_utf8(bytes.to_vec())
                            .unwrap()
                            .contains("snapshot-test-credential")
                    );
                } else {
                    assert!(card.get("securitySchemes").is_none());
                    assert!(card.get("securityRequirements").is_none());
                }
                let response = app
                    .clone()
                    .oneshot(
                        Request::builder()
                            .uri("/coord")
                            .body(Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    response.status(),
                    if token.is_some() {
                        StatusCode::UNAUTHORIZED
                    } else {
                        StatusCode::OK
                    }
                );
                if let Some(token) = &token {
                    let response = app
                        .oneshot(
                            Request::builder()
                                .uri("/coord")
                                .header("authorization", format!("Bearer {token}"))
                                .body(Body::empty())
                                .unwrap(),
                        )
                        .await
                        .unwrap();
                    assert_eq!(response.status(), StatusCode::OK);
                }
            }
        }
        assert!(!root.path().join(".coord").exists());
    }

    #[tokio::test]
    async fn retained_ephemeral_listener_advertises_its_assigned_tcp_address() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let root = tempfile::tempdir().unwrap();
        let profile = tempfile::tempdir().unwrap();
        for variant in 0..3 {
            let mut cfg = config(root.path());
            cfg.bind = "127.0.0.1:0".parse().unwrap();
            let listener = bind_tcp(&mut cfg, None).await.unwrap();
            assert_ne!(cfg.bind.port(), 0);
            assert_eq!(cfg.bind, listener.local_addr().unwrap());
            let app = match variant {
                0 => router_with_token(
                    &cfg,
                    Mailbox::new(cfg.manifest.coord_dir(root.path())),
                    None,
                ),
                1 => router_with_token(&cfg, Mailbox::for_profile_root(profile.path()), None),
                _ => coord_router(&cfg, profile.path(), None),
            };
            let (stop, stopped) = tokio::sync::oneshot::channel();
            let server = tokio::spawn(async move {
                axum::serve(listener, app)
                    .with_graceful_shutdown(async {
                        let _ = stopped.await;
                    })
                    .await
            });
            let response = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                let mut stream = tokio::net::TcpStream::connect(cfg.bind).await?;
                stream
                    .write_all(
                        format!(
                            "GET /.well-known/agent-card.json HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
                            cfg.bind
                        )
                        .as_bytes(),
                    )
                    .await?;
                let mut bytes = Vec::new();
                stream.take(1024 * 1024).read_to_end(&mut bytes).await?;
                Ok::<_, std::io::Error>(bytes)
            })
            .await;
            let _ = stop.send(());
            server.await.unwrap().unwrap();
            let response = String::from_utf8(response.unwrap().unwrap()).unwrap();
            let (headers, body) = response.split_once("\r\n\r\n").unwrap();
            let status = headers
                .lines()
                .next()
                .unwrap()
                .split_whitespace()
                .nth(1)
                .unwrap()
                .parse::<u16>()
                .unwrap();
            assert_eq!(status, StatusCode::OK.as_u16());
            let content_length = headers.lines().find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().unwrap())
            });
            assert_eq!(content_length, Some(body.len()));
            let card: serde_json::Value = serde_json::from_str(body).unwrap();
            let expected_url = std::env::var("APHRODY_A2A_PUBLIC_URL")
                .unwrap_or_else(|_| format!("http://{}", cfg.bind));
            assert_eq!(card["supportedInterfaces"][0]["url"], expected_url);
        }
    }

    #[tokio::test]
    async fn authenticated_tasks_use_the_explicit_private_directory() {
        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        let app = coord_router(
            &config(root.path()),
            private.path(),
            Some("test-credential".into()),
        );
        let request = Request::builder()
            .method("POST")
            .uri("/coord/aphrody/tasks")
            .header("authorization", "Bearer test-credential")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"id":"owned-task","body":"private"}"#))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::CREATED
        );
        assert!(
            private
                .path()
                .join("agents/aphrody/tasks/owned-task.json")
                .is_file()
        );
        assert!(!root.path().join(".coord").exists());
        let request = Request::builder()
            .uri("/tasks")
            .header("authorization", "Bearer test-credential")
            .body(Body::empty())
            .unwrap();
        assert_eq!(app.oneshot(request).await.unwrap().status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn protocol_tasks_remain_queryable_after_reconstructing_the_listener() {
        use http_body_util::BodyExt;

        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        let cfg = config(root.path());
        let response = coord_router(&cfg, private.path(), None)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "jsonrpc":"2.0", "id":1, "method":"SendMessage",
                            "params":{"message":{
                                "messageId":"durable-probe", "role":"ROLE_USER",
                                "parts":[{"text":"@codex durable probe"}]
                            }}
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(
            value.get("error").is_none(),
            "protocol probe failed: {value}"
        );
        let task_id = value["result"]["task"]["id"]
            .as_str()
            .or_else(|| value["result"]["id"].as_str())
            .expect("completed protocol task");
        assert!(
            private
                .path()
                .join("a2a/tasks")
                .join(format!("{task_id}.json"))
                .is_file()
        );
        let response = coord_router(&cfg, private.path(), None)
            .oneshot(
                Request::builder()
                    .uri(format!("/tasks/{task_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!root.path().join(".coord").exists());
    }

    #[tokio::test]
    async fn immediate_submission_acknowledges_before_peer_completion() {
        use aphrody_a2a_server::TaskStore;
        use http_body_util::BodyExt;

        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        let response = coord_router(&config(root.path()), private.path(), None)
            .oneshot(
                Request::builder().method("POST").uri("/")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::json!({
                        "jsonrpc":"2.0", "id":1, "method":"SendMessage",
                        "params":{
                            "message":{"messageId":"immediate-probe", "role":"ROLE_USER", "parts":[{"text":"@codex immediate probe"}]},
                            "configuration":{"returnImmediately":true}
                        }
                    }).to_string())).unwrap(),
            ).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let value: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        let task = &value["result"]["task"];
        assert!(matches!(
            task["status"]["state"].as_str(),
            Some("TASK_STATE_WORKING" | "TASK_STATE_COMPLETED")
        ));
        let id = task["id"].as_str().unwrap();
        let store = aphrody_a2a_server::FsTaskStore::new(private.path().join("a2a"));
        let completed = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if let Ok(Some(task)) = store.get(id).await
                    && task.status.state.is_terminal()
                {
                    break task;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(completed.status.state, aphrody_a2a::TaskState::Completed);
    }

    #[tokio::test]
    async fn closing_the_stream_does_not_cancel_the_background_task() {
        use aphrody_a2a::TaskState;
        use aphrody_a2a_server::TaskStore;

        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        let response = coord_router(&config(root.path()), private.path(), None)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/message:stream")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"message":{
                            "messageId":"disconnect-probe", "taskId":"disconnected-task",
                            "contextId":"disconnect-context", "role":"ROLE_USER",
                            "parts":[{"text":"@codex disconnected probe"}]
                        }})
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        drop(response);
        let store = FsTaskStore::new(private.path().join("a2a"));
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if let Some(task) = store.get("disconnected-task").await.unwrap()
                    && task.status.state == TaskState::Completed
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("background execution survived the disconnected stream");
    }

    #[tokio::test]
    async fn peer_launcher_failure_becomes_a_durable_failed_task_after_ack() {
        use http_body_util::BodyExt;

        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join(".coord/shared")).unwrap();
        std::fs::write(
            root.path().join(".coord/shared/branch"),
            "private-branch-detail\n",
        )
        .unwrap();
        let response = coord_router(&config(root.path()), private.path(), None)
            .oneshot(
                Request::builder().method("POST").uri("/")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::json!({
                        "jsonrpc":"2.0", "id":1, "method":"SendMessage",
                        "params":{
                            "message":{"messageId":"failure-input", "taskId":"failure-task", "contextId":"failure-context", "role":"ROLE_USER", "parts":[{"text":"@codex failure probe"}]},
                            "configuration":{"returnImmediately":true}
                        }
                    }).to_string())).unwrap(),
            )
            .await
            .unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(value.get("error").is_none());
        let acknowledged = &value["result"]["task"];
        assert_eq!(acknowledged["id"], "failure-task");
        assert!(matches!(
            acknowledged["status"]["state"].as_str(),
            Some("TASK_STATE_WORKING" | "TASK_STATE_FAILED")
        ));
        let store = FsTaskStore::new(private.path().join("a2a"));
        let failed = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if let Some(task) = store.get("failure-task").await.unwrap()
                    && task.status.state.is_terminal()
                {
                    break task;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(failed.status.state, TaskState::Failed);
        assert_eq!(failed.context_id, "failure-context");
        let value = serde_json::to_value(&failed).unwrap();
        assert_eq!(value["history"][0]["messageId"], "failure-input");
        assert_eq!(value["metadata"], acknowledged["metadata"]);
        let status = serde_json::to_string(&failed.status).unwrap();
        assert!(status.contains("shared checkout branch mismatch"));
        assert!(!status.contains("private-branch-detail"));
        assert_eq!(
            FsTaskStore::new(private.path().join("a2a"))
                .get("failure-task")
                .await
                .unwrap(),
            Some(failed)
        );
    }

    #[tokio::test]
    async fn restart_recovery_covers_all_pages_and_preserves_suspended_and_other_profiles() {
        let private = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let store = FsTaskStore::new(private.path().join("a2a"));
        let other_store = FsTaskStore::new(other.path().join("a2a"));
        let outside = saved_task("other-profile", TaskState::Working);
        other_store.create(outside.clone()).await.unwrap();
        let mut interrupted = Vec::new();
        for index in 0..103 {
            let state = if index % 2 == 0 {
                TaskState::Submitted
            } else {
                TaskState::Working
            };
            let task = saved_task(&format!("interrupted-{index:03}"), state);
            store.create(task.clone()).await.unwrap();
            interrupted.push(task);
        }
        let suspended = [
            saved_task("auth-required", TaskState::AuthRequired),
            saved_task("input-required", TaskState::InputRequired),
            saved_task("completed", TaskState::Completed),
        ];
        for task in &suspended {
            store.create(task.clone()).await.unwrap();
        }
        assert_eq!(
            reconcile_interrupted_tasks(private.path()).await.unwrap(),
            103
        );
        let reopened = FsTaskStore::new(private.path().join("a2a"));
        for task in interrupted {
            let failed = reopened.get(&task.id).await.unwrap().unwrap();
            assert_eq!(failed.status.state, TaskState::Failed);
            assert_eq!(failed.context_id, task.context_id);
            assert_eq!(failed.artifacts, task.artifacts);
            assert_eq!(failed.history, task.history);
            assert_eq!(failed.metadata, task.metadata);
            assert!(failed.status.timestamp.is_some());
        }
        for task in suspended {
            assert_eq!(reopened.get(&task.id).await.unwrap(), Some(task));
        }
        assert_eq!(other_store.get(&outside.id).await.unwrap(), Some(outside));
        assert_eq!(
            reconcile_interrupted_tasks(private.path()).await.unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn router_construction_and_failed_bind_do_not_recover_live_tasks() {
        let root = tempfile::tempdir().unwrap();
        let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut cfg = config(root.path());
        cfg.bind = occupied.local_addr().unwrap();
        let coord = cfg.manifest.coord_dir(root.path());
        let store = FsTaskStore::new(coord.join("a2a"));
        let working = saved_task("live-task", TaskState::Working);
        store.create(working.clone()).await.unwrap();
        let _app = router(&cfg);
        assert_eq!(store.get(&working.id).await.unwrap(), Some(working.clone()));
        assert!(serve(cfg.clone()).await.is_err());
        assert_eq!(store.get(&working.id).await.unwrap(), Some(working.clone()));
        assert!(
            serve_with_options(
                cfg,
                ServeOptions {
                    coord_dir: Some(coord),
                    ..Default::default()
                },
            )
            .await
            .is_err()
        );
        assert_eq!(store.get(&working.id).await.unwrap(), Some(working));
    }

    #[tokio::test]
    async fn unsupported_native_cancellation_preserves_the_durable_task() {
        use http_body_util::BodyExt;

        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        let store = FsTaskStore::new(private.path().join("a2a"));
        let task = saved_task("uncancellable-task", TaskState::Working);
        store.create(task.clone()).await.unwrap();
        let response = coord_router(&config(root.path()), private.path(), None)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "jsonrpc":"2.0", "id":1, "method":"CancelTask",
                            "params":{"id":"uncancellable-task"}
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(
            value["error"]["code"],
            aphrody_a2a::error_code::TASK_NOT_CANCELABLE
        );
        assert_eq!(store.get(&task.id).await.unwrap(), Some(task));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unix_bind_preserves_an_active_owner_and_non_socket_paths() {
        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        let path = private.path().join("active.sock");
        let active = tokio::net::UnixListener::bind(&path).unwrap();
        let store = FsTaskStore::new(private.path().join("a2a"));
        let task = saved_task("live-unix-task", TaskState::Working);
        store.create(task.clone()).await.unwrap();
        assert!(
            serve_with_options(
                config(root.path()),
                ServeOptions {
                    no_tcp: true,
                    unix: Some(path.clone()),
                    coord_dir: Some(private.path().to_path_buf()),
                },
            )
            .await
            .is_err()
        );
        assert!(tokio::net::UnixStream::connect(&path).await.is_ok());
        assert_eq!(store.get(&task.id).await.unwrap(), Some(task));
        drop(active);
        let _replacement = bind_unix(&path).await.unwrap();
        let file = private.path().join("owned-file");
        std::fs::write(&file, "preserved").unwrap();
        assert!(bind_unix(&file).await.is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "preserved");
    }
}

async fn handle_ping() -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true,
        "service": "aphrody-a2a-coord",
        "a2a_version": aphrody_a2a::VERSION,
    }))
}

async fn handle_msg(State(state): State<AppState>, Json(env): Json<Envelope>) -> impl IntoResponse {
    let short = env.from.split('@').next().unwrap_or("unknown").to_string();
    match state.mailbox.append(&short, &env) {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "ok": true, "id": env.id })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn handle_coord(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let proxy = CoordProxy::new(state.mailbox.inbox_path("aphrody"));
    let accept = headers
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok());
    match proxy.handle_get_coord(accept).await {
        Ok(resp) => (
            StatusCode::from_u16(resp.status).unwrap_or(StatusCode::OK),
            [(axum::http::header::CONTENT_TYPE, resp.content_type)],
            axum::body::Body::from_stream(resp.body),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

/// Called once after every listener has bound and before accepting requests.
/// Interrupted code is never replayed; suspended auth/input contracts are retained.
async fn reconcile_interrupted_tasks(
    coord_dir: &std::path::Path,
) -> Result<usize, aphrody_a2a::A2AError> {
    let store = FsTaskStore::new(coord_dir.join("a2a"));
    let mut request = ListTasksRequest {
        context_id: None,
        status: None,
        page_size: Some(100),
        page_token: None,
        history_length: None,
        status_timestamp_after: None,
        include_artifacts: Some(true),
        tenant: None,
    };
    let mut interrupted = Vec::new();
    loop {
        let page = store.list(&request).await?;
        interrupted.extend(
            page.tasks
                .into_iter()
                .filter(|task| {
                    matches!(task.status.state, TaskState::Submitted | TaskState::Working)
                })
                .map(|task| task.id),
        );
        if page.next_page_token.is_empty() {
            break;
        }
        request.page_token = Some(page.next_page_token);
    }
    // Collect every page first: changing status timestamps must not reorder a
    // later page and leave interrupted tasks behind.
    let mut recovered = 0;
    for id in interrupted {
        if let Some(task) = store.get(&id).await?
            && matches!(task.status.state, TaskState::Submitted | TaskState::Working)
        {
            store
                .update(crate::executor::failed_task(
                    task,
                    "execution interrupted by server restart",
                ))
                .await?;
            recovered += 1;
        }
    }
    Ok(recovered)
}

/// Run the listener until shutdown.
pub async fn serve(
    mut cfg: ListenerConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    crate::executor::default_peer_from_env()?;
    let token = crate::auth::token();
    let listener = bind_tcp(&mut cfg, token.as_deref()).await?;
    reconcile_interrupted_tasks(&cfg.manifest.coord_dir(&cfg.repo_root)).await?;
    let mailbox = Mailbox::new(cfg.manifest.coord_dir(&cfg.repo_root));
    let app = router_with_token(&cfg, mailbox, token);
    info!(%cfg.bind, "aphrody A2A coord listener started");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Run the profile-scoped listener until shutdown.
pub async fn serve_profile(
    mut cfg: ListenerConfig,
    profile_root: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    crate::executor::default_peer_from_env()?;
    let token = crate::auth::token();
    let listener = bind_tcp(&mut cfg, token.as_deref()).await?;
    reconcile_interrupted_tasks(&Mailbox::for_profile_root(profile_root).coord_dir).await?;
    let app = router_with_token(&cfg, Mailbox::for_profile_root(profile_root), token);
    info!(%cfg.bind, profile_root = %profile_root.display(), "aphrody A2A coord listener started");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn bind_tcp(cfg: &mut ListenerConfig, token: Option<&str>) -> std::io::Result<TcpListener> {
    crate::auth::validate_bind(cfg.bind, token)?;
    let listener = TcpListener::bind(cfg.bind).await?;
    cfg.bind = listener.local_addr()?;
    Ok(listener)
}

/// Extra bind options for [`serve_with_options`] .
#[derive(Debug, Clone, Default)]
pub struct ServeOptions {
    /// Also (or only, with `no_tcp`) listen on this Unix socket (mode 0666, stale file removed).
    pub unix: Option<std::path::PathBuf>,
    /// Skip the TCP listener (requires `unix`).
    pub no_tcp: bool,
    /// Coordination directory; defaults to the manifest coord dir.
    pub coord_dir: Option<std::path::PathBuf>,
}

/// Router over `coord_dir`, protected by the configured bearer token.
pub fn router_with_coord_dir(cfg: &ListenerConfig, coord_dir: &std::path::Path) -> Router {
    coord_router(cfg, coord_dir, crate::auth::token())
}

fn coord_router(
    cfg: &ListenerConfig,
    coord_dir: &std::path::Path,
    token: Option<String>,
) -> Router {
    let app = router_with_mailbox(cfg, Mailbox::new(coord_dir.to_path_buf()), token.is_some());
    crate::auth::protect(app, token)
}

#[cfg(unix)]
async fn bind_unix(
    path: &std::path::Path,
) -> Result<tokio::net::UnixListener, Box<dyn std::error::Error + Send + Sync>> {
    use std::os::unix::fs::{FileTypeExt as _, PermissionsExt as _};
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.file_type().is_socket() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "Unix listener path is not a stale socket",
                )
                .into());
            }
            match tokio::net::UnixStream::connect(path).await {
                Ok(_) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::AddrInUse,
                        "Unix listener is already active",
                    )
                    .into());
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
                    ) => {}
                Err(error) => return Err(error.into()),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let listener = tokio::net::UnixListener::bind(path)?;
    if let Err(e) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o666)) {
        tracing::warn!("chmod socket failed: {e}");
    }
    Ok(listener)
}

/// Run the listener on TCP and/or a Unix socket.
pub async fn serve_with_options(
    mut cfg: ListenerConfig,
    opts: ServeOptions,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    crate::executor::default_peer_from_env()?;
    if opts.no_tcp && opts.unix.is_none() {
        return Err("--no-tcp requires --unix".into());
    }
    #[cfg(not(unix))]
    if opts.unix.is_some() {
        return Err("--unix is not supported on this platform".into());
    }
    let token = crate::auth::token();
    let coord_dir = opts
        .coord_dir
        .clone()
        .unwrap_or_else(|| cfg.manifest.coord_dir(&cfg.repo_root));
    let tcp_listener = if opts.no_tcp {
        None
    } else {
        Some(bind_tcp(&mut cfg, token.as_deref()).await?)
    };
    #[cfg(unix)]
    let unix_listener = match opts.unix.as_deref() {
        Some(path) => Some(bind_unix(path).await?),
        None => None,
    };
    reconcile_interrupted_tasks(&coord_dir).await?;
    let app = coord_router(&cfg, &coord_dir, token);
    let tcp = async {
        let Some(listener) = tcp_listener else {
            return std::future::pending::<Result<(), Box<dyn std::error::Error + Send + Sync>>>()
                .await;
        };
        info!(%cfg.bind, "aphrody A2A coord listener started");
        axum::serve(listener, app.clone()).await?;
        Ok(())
    };
    let unix = async {
        #[cfg(unix)]
        if let Some(listener) = unix_listener {
            info!(socket = ?opts.unix, "aphrody A2A coord listener started (unix)");
            axum::serve(listener, app.clone()).await?;
            return Ok(());
        }
        std::future::pending::<Result<(), Box<dyn std::error::Error + Send + Sync>>>().await
    };
    tokio::try_join!(tcp, unix).map(|_| ())
}

/// Duel-tick helper: compose + append envelope for a side.
#[derive(Debug, Deserialize)]
pub struct TickOptions {
    pub iteration: u64,
    pub side: String,
    pub peer: Option<String>,
    pub subject: Option<String>,
    pub body: Option<String>,
    pub kind: Option<String>,
}

pub fn run_tick(
    manifest: &AiManifest,
    repo_root: &std::path::Path,
    opts: &TickOptions,
) -> Result<Envelope, Box<dyn std::error::Error + Send + Sync>> {
    let mailbox = Mailbox::new(manifest.coord_dir(repo_root));
    mailbox.ensure_dir()?;
    let side = opts.side.as_str();
    let peer = opts.peer.as_deref().unwrap_or("winclean");
    let peer_last = mailbox.read_last(peer)?;
    let kind = opts.kind.as_deref().unwrap_or("ping");
    let subject = opts
        .subject
        .clone()
        .unwrap_or_else(|| format!("coord tick {}", opts.iteration));
    let mut body = opts
        .body
        .clone()
        .unwrap_or_else(|| format!("Tick {} from {side}.", opts.iteration));
    if let Some(ref last) = peer_last {
        body.push_str(&format!(" Last peer id={} kind={}.", last.id, last.kind));
    }
    let from = format!("{side}@aphrody-code/{side}");
    let to = format!("{peer}@aphrody-code/{peer}");
    let env = Envelope::new(from, to, parse_kind(kind), subject, body);
    mailbox.append(side, &env)?;
    mailbox.bump_heartbeat(side)?;
    Ok(env)
}

fn parse_kind(s: &str) -> crate::envelope::EnvelopeKind {
    match s {
        "ask" => crate::envelope::EnvelopeKind::Ask,
        "fact" => crate::envelope::EnvelopeKind::Fact,
        "ack" => crate::envelope::EnvelopeKind::Ack,
        "error" => crate::envelope::EnvelopeKind::Error,
        _ => crate::envelope::EnvelopeKind::Ping,
    }
}
