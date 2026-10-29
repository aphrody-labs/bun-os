// SPDX-License-Identifier: Apache-2.0
use aphrody_app_protocol::{
    AphrodyStatusCapabilities, AphrodyStatusResponse, ApprovalDecision, AskForApproval,
    ClientRequest, CommandExecutionRequestApprovalParams, JSONRPCError, JSONRPCNotification,
    JSONRPCRequest, JSONRPCResponse, NotificationsDrainResponse, PatchApplyStatus, RequestId,
    SandboxMode, ServerNotification, ServerRequest, ShutdownResponse, Thread, ThreadItem,
    ThreadStatus, ToolsListResponse, Turn, TurnEventsResponse, TurnStatus, UserInput,
};
use pretty_assertions::assert_eq;
use serde_json::json;

#[test]
fn test_request_id_variants() {
    let s_id: RequestId = "req-uuid-123".into();
    let i_id: RequestId = 42i64.into();

    assert_eq!(serde_json::to_string(&s_id).unwrap(), "\"req-uuid-123\"");
    assert_eq!(serde_json::to_string(&i_id).unwrap(), "42");

    let s_parsed: RequestId = serde_json::from_str("\"req-uuid-123\"").unwrap();
    let i_parsed: RequestId = serde_json::from_str("42").unwrap();

    assert_eq!(s_parsed, s_id);
    assert_eq!(i_parsed, i_id);
}

#[test]
fn test_wire_jsonrpc_invariants() {
    // 1. Serialization must omit "jsonrpc"
    let req = JSONRPCRequest::new("id-1", "thread/start", Some(json!({"cwd": "/test"})));
    let req_json = serde_json::to_string(&req).unwrap();
    assert!(!req_json.contains("jsonrpc"));

    let notif = JSONRPCNotification::new("turn/started", Some(json!({})));
    let notif_json = serde_json::to_string(&notif).unwrap();
    assert!(!notif_json.contains("jsonrpc"));

    let resp = JSONRPCResponse::new("id-1", json!({"status": "ok"}));
    let resp_json = serde_json::to_string(&resp).unwrap();
    assert!(!resp_json.contains("jsonrpc"));

    // 2. Deserialization tolerates "jsonrpc"
    let raw_with_jsonrpc = r#"{"jsonrpc":"2.0","id":"id-1","method":"thread/start","params":{}}"#;
    let parsed: JSONRPCRequest = serde_json::from_str(raw_with_jsonrpc).unwrap();
    assert_eq!(parsed.id, RequestId::String("id-1".to_string()));
    assert_eq!(parsed.jsonrpc, Some("2.0".to_string()));

    // 3. Error code for unknown method
    let err = JSONRPCError::method_not_found("id-99", "non_existent/method");
    assert_eq!(err.error.code, -32601);
    assert_eq!(err.error.data.unwrap()["unsupported"], true);
}

#[test]
fn test_initialize_contract() {
    let req_val = json!({
        "method": "initialize",
        "id": 1,
        "params": {
            "clientInfo": {
                "name": "vscode",
                "version": "1.98.0",
                "title": "VS Code Extension"
            },
            "capabilities": {
                "experimentalApi": true,
                "aphrody": true
            }
        }
    });

    let req: ClientRequest = serde_json::from_value(req_val).unwrap();
    assert_eq!(req.method_name(), "initialize");
    assert_eq!(req.id(), &RequestId::Integer(1));

    if let ClientRequest::Initialize { id, params } = req {
        assert_eq!(id, RequestId::Integer(1));
        assert_eq!(params.client_info.name, "vscode");
        assert_eq!(params.capabilities.unwrap().aphrody, true);
    } else {
        panic!("Expected Initialize variant");
    }
}

#[test]
fn test_thread_lifecycle_requests() {
    // thread/start
    let start_val = json!({
        "method": "thread/start",
        "id": "start-1",
        "params": {
            "model": "qwen2.5-coder-7b",
            "cwd": "C:/work/aphrody",
            "approvalPolicy": "never",
            "sandbox": "workspace-write"
        }
    });
    let start_req: ClientRequest = serde_json::from_value(start_val).unwrap();
    assert_eq!(start_req.method_name(), "thread/start");
    if let ClientRequest::ThreadStart { params, .. } = start_req {
        assert_eq!(params.model.as_deref(), Some("qwen2.5-coder-7b"));
        assert_eq!(params.approval_policy, Some(AskForApproval::Never));
        assert_eq!(params.sandbox, Some(SandboxMode::WorkspaceWrite));
    } else {
        panic!("Expected ThreadStart variant");
    }

    // thread/resume
    let resume_val = json!({
        "method": "thread/resume",
        "id": "resume-1",
        "params": {
            "threadId": "t-123",
            "cwd": "C:/work/aphrody"
        }
    });
    let resume_req: ClientRequest = serde_json::from_value(resume_val).unwrap();
    assert_eq!(resume_req.method_name(), "thread/resume");

    // thread/fork
    let fork_val = json!({
        "method": "thread/fork",
        "id": "fork-1",
        "params": {
            "threadId": "t-123"
        }
    });
    let fork_req: ClientRequest = serde_json::from_value(fork_val).unwrap();
    assert_eq!(fork_req.method_name(), "thread/fork");

    // thread/list
    let list_val = json!({
        "method": "thread/list",
        "id": "list-1",
        "params": {
            "limit": 10,
            "archived": false
        }
    });
    let list_req: ClientRequest = serde_json::from_value(list_val).unwrap();
    assert_eq!(list_req.method_name(), "thread/list");

    // thread/archive
    let archive_val = json!({
        "method": "thread/archive",
        "id": "arch-1",
        "params": {
            "threadId": "t-123"
        }
    });
    let archive_req: ClientRequest = serde_json::from_value(archive_val).unwrap();
    assert_eq!(archive_req.method_name(), "thread/archive");

    // thread/compact/start
    let compact_val = json!({
        "method": "thread/compact/start",
        "id": "compact-1",
        "params": {
            "threadId": "t-123"
        }
    });
    let compact_req: ClientRequest = serde_json::from_value(compact_val).unwrap();
    assert_eq!(compact_req.method_name(), "thread/compact/start");
}

#[test]
fn test_turn_lifecycle_requests() {
    // turn/start
    let turn_val = json!({
        "method": "turn/start",
        "id": "turn-1",
        "params": {
            "threadId": "t-123",
            "input": [
                {
                    "type": "text",
                    "text": "run cargo check"
                }
            ],
            "approvalPolicy": "never"
        }
    });
    let turn_req: ClientRequest = serde_json::from_value(turn_val).unwrap();
    assert_eq!(turn_req.method_name(), "turn/start");

    // turn/steer
    let steer_val = json!({
        "method": "turn/steer",
        "id": "steer-1",
        "params": {
            "threadId": "t-123",
            "turnId": "turn-1",
            "input": [
                {
                    "type": "text",
                    "text": "stop and run cargo test instead"
                }
            ]
        }
    });
    let steer_req: ClientRequest = serde_json::from_value(steer_val).unwrap();
    assert_eq!(steer_req.method_name(), "turn/steer");

    // turn/interrupt
    let interrupt_val = json!({
        "method": "turn/interrupt",
        "id": "int-1",
        "params": {
            "threadId": "t-123",
            "turnId": "turn-1"
        }
    });
    let int_req: ClientRequest = serde_json::from_value(interrupt_val).unwrap();
    assert_eq!(int_req.method_name(), "turn/interrupt");
}

#[test]
fn test_model_and_config_and_account_requests() {
    // model/list
    let model_val = json!({
        "method": "model/list",
        "id": "mod-1",
        "params": {}
    });
    let model_req: ClientRequest = serde_json::from_value(model_val).unwrap();
    assert_eq!(model_req.method_name(), "model/list");

    // config/read
    let cfg_val = json!({
        "method": "config/read",
        "id": "cfg-1",
        "params": {}
    });
    let cfg_req: ClientRequest = serde_json::from_value(cfg_val).unwrap();
    assert_eq!(cfg_req.method_name(), "config/read");

    // account/login/start
    let login_val = json!({
        "method": "account/login/start",
        "id": "log-1",
        "params": {
            "mode": "apikey",
            "apiKey": "sk-secret-test"
        }
    });
    let login_req: ClientRequest = serde_json::from_value(login_val).unwrap();
    assert_eq!(login_req.method_name(), "account/login/start");

    // mcpServerStatus/list
    let mcp_val = json!({
        "method": "mcpServerStatus/list",
        "id": "mcp-1",
        "params": {}
    });
    let mcp_req: ClientRequest = serde_json::from_value(mcp_val).unwrap();
    assert_eq!(mcp_req.method_name(), "mcpServerStatus/list");
}

#[test]
fn test_server_notifications() {
    let thread = Thread {
        id: "t-1".into(),
        session_id: "s-1".into(),
        preview: "test preview".into(),
        ephemeral: false,
        model_provider: "llama".into(),
        model: Some("qwen2.5-coder-7b".into()),
        cwd: "/app".into(),
        created_at: 1_700_000_000,
        updated_at: 1_700_000_000,
        status: ThreadStatus::Active,
        source: aphrody_app_protocol::SessionSource::VsCode,
        turns: vec![],
        git_info: None,
        name: Some("test-thread".into()),
    };

    let notif =
        ServerNotification::ThreadStarted(aphrody_app_protocol::ThreadStartedNotification {
            thread: thread.clone(),
        });
    assert_eq!(notif.method_name(), "thread/started");

    let val = serde_json::to_value(&notif).unwrap();
    assert_eq!(val["method"], "thread/started");
    assert_eq!(val["params"]["thread"]["id"], "t-1");

    // TurnStarted & ItemCompleted
    let turn = Turn {
        id: "turn-10".into(),
        thread_id: "t-1".into(),
        status: TurnStatus::InProgress,
        items: vec![
            ThreadItem::UserMessage {
                id: "item-1".into(),
                content: vec![UserInput::text("hello agent")],
            },
            ThreadItem::AgentMessage {
                id: "item-2".into(),
                text: "hello human".into(),
            },
        ],
        error: None,
    };

    let turn_notif =
        ServerNotification::TurnStarted(aphrody_app_protocol::TurnStartedNotification {
            turn: turn.clone(),
        });
    assert_eq!(turn_notif.method_name(), "turn/started");

    let item_notif =
        ServerNotification::ItemCompleted(aphrody_app_protocol::ItemCompletedNotification {
            thread_id: "t-1".into(),
            turn_id: "turn-10".into(),
            item: ThreadItem::FileChange {
                id: "patch-1".into(),
                path: "src/main.rs".into(),
                diff: "--- a\n+++ b".into(),
                status: PatchApplyStatus::Completed,
            },
            completed_at_ms: 1_700_000_123,
        });
    assert_eq!(item_notif.method_name(), "item/completed");

    let delta_notif = ServerNotification::AgentMessageDelta(
        aphrody_app_protocol::AgentMessageDeltaNotification {
            thread_id: "t-1".into(),
            turn_id: "turn-10".into(),
            item_id: "item-2".into(),
            delta: " token".into(),
        },
    );
    assert_eq!(delta_notif.method_name(), "item/agentMessage/delta");
}

#[test]
fn test_server_requests_and_approvals() {
    let s_req = ServerRequest::CommandExecutionApproval {
        id: "appr-1".into(),
        params: CommandExecutionRequestApprovalParams {
            thread_id: "t-1".into(),
            turn_id: "turn-1".into(),
            item_id: "item-cmd-1".into(),
            command: "rm -rf /tmp/data".into(),
            cwd: "/tmp".into(),
            reason: Some("clean cache".into()),
        },
    };
    assert_eq!(s_req.method_name(), "item/commandExecution/requestApproval");
    assert_eq!(s_req.id(), &RequestId::String("appr-1".to_string()));

    let json_val = serde_json::to_value(&s_req).unwrap();
    assert_eq!(json_val["method"], "item/commandExecution/requestApproval");
    assert_eq!(json_val["id"], "appr-1");
    assert_eq!(json_val["params"]["command"], "rm -rf /tmp/data");

    // Decision deserialization
    let dec_json = json!({"decision": "acceptForSession"});
    let dec: aphrody_app_protocol::CommandExecutionRequestApprovalResponse =
        serde_json::from_value(dec_json).unwrap();
    assert_eq!(dec.decision, ApprovalDecision::AcceptForSession);
}

#[test]
fn test_aphrody_extensions() {
    // RAG search
    let rag_req_val = json!({
        "method": "aphrody/rag/search",
        "id": "rag-1",
        "params": {
            "query": "retrieval eval harness",
            "topK": 3
        }
    });
    let rag_req: ClientRequest = serde_json::from_value(rag_req_val).unwrap();
    assert_eq!(rag_req.method_name(), "aphrody/rag/search");

    if let ClientRequest::RagSearch { id, params } = rag_req {
        assert_eq!(id, RequestId::String("rag-1".to_string()));
        assert_eq!(params.query, "retrieval eval harness");
        assert_eq!(params.top_k, 3);
    } else {
        panic!("Expected RagSearch variant");
    }

    // Llama status
    let llama_req_val = json!({
        "method": "aphrody/llama/status",
        "id": "llama-1",
        "params": {}
    });
    let llama_req: ClientRequest = serde_json::from_value(llama_req_val).unwrap();
    assert_eq!(llama_req.method_name(), "aphrody/llama/status");

    // Generic app-server status (aliased "system/status" on the aphrody-ai wire).
    let status_req_val = json!({
        "method": "aphrody/status",
        "id": "status-1",
        "params": {}
    });
    let status_req: ClientRequest = serde_json::from_value(status_req_val).unwrap();
    assert_eq!(status_req.method_name(), "aphrody/status");
    assert!(matches!(status_req, ClientRequest::AphrodyStatus { .. }));

    let status_response = AphrodyStatusResponse {
        service: "aphrody-app-server".to_string(),
        version: "0.1.0".to_string(),
        initialized: true,
        threads: 2,
        home: "/home/aphrody".to_string(),
        profile: None,
        capabilities: AphrodyStatusCapabilities {
            threads: true,
            turns: true,
            local_models: true,
            interrupt: true,
            steer: true,
            events: true,
            rag: true,
        },
    };
    let status_json = serde_json::to_value(&status_response).unwrap();
    assert_eq!(status_json["service"], json!("aphrody-app-server"));
    assert_eq!(status_json["capabilities"]["localModels"], json!(true));
}

#[test]
fn test_previously_undocumented_methods_now_contracted() {
    // thread/unarchive
    let unarchive_val = json!({
        "method": "thread/unarchive",
        "id": "unarch-1",
        "params": {
            "threadId": "t-123"
        }
    });
    let unarchive_req: ClientRequest = serde_json::from_value(unarchive_val).unwrap();
    assert_eq!(unarchive_req.method_name(), "thread/unarchive");
    if let ClientRequest::ThreadUnarchive { id, params } = unarchive_req {
        assert_eq!(id, RequestId::String("unarch-1".to_string()));
        assert_eq!(params.thread_id, "t-123");
    } else {
        panic!("Expected ThreadUnarchive variant");
    }

    // thread/close
    let close_val = json!({
        "method": "thread/close",
        "id": "close-1",
        "params": {
            "threadId": "t-123"
        }
    });
    let close_req: ClientRequest = serde_json::from_value(close_val).unwrap();
    assert_eq!(close_req.method_name(), "thread/close");
    if let ClientRequest::ThreadClose { id, params } = close_req {
        assert_eq!(id, RequestId::String("close-1".to_string()));
        assert_eq!(params.thread_id, "t-123");
    } else {
        panic!("Expected ThreadClose variant");
    }

    // notifications/drain (canonical name; aphrody/notifications is a raw-string
    // alias handled by aphrody-ai's dispatcher, not a second enum variant)
    let drain_val = json!({
        "method": "notifications/drain",
        "id": "drain-1",
        "params": {}
    });
    let drain_req: ClientRequest = serde_json::from_value(drain_val).unwrap();
    assert_eq!(drain_req.method_name(), "notifications/drain");
    assert!(matches!(
        drain_req,
        ClientRequest::NotificationsDrain { .. }
    ));

    let drain_response = NotificationsDrainResponse {
        notifications: vec![json!({"method": "thread/started"})],
    };
    let drain_json = serde_json::to_value(&drain_response).unwrap();
    assert_eq!(
        drain_json["notifications"][0]["method"],
        json!("thread/started")
    );

    // shutdown
    let shutdown_val = json!({
        "method": "shutdown",
        "id": "shutdown-1",
        "params": {}
    });
    let shutdown_req: ClientRequest = serde_json::from_value(shutdown_val).unwrap();
    assert_eq!(shutdown_req.method_name(), "shutdown");
    assert!(matches!(shutdown_req, ClientRequest::Shutdown { .. }));

    let shutdown_json = serde_json::to_value(&ShutdownResponse { ok: true }).unwrap();
    assert_eq!(shutdown_json["ok"], json!(true));

    // tools/list
    let tools_val = json!({
        "method": "tools/list",
        "id": "tools-1",
        "params": {
            "threadId": "t-123"
        }
    });
    let tools_req: ClientRequest = serde_json::from_value(tools_val).unwrap();
    assert_eq!(tools_req.method_name(), "tools/list");
    if let ClientRequest::ToolsList { id, params } = tools_req {
        assert_eq!(id, RequestId::String("tools-1".to_string()));
        assert_eq!(params.thread_id.as_deref(), Some("t-123"));
    } else {
        panic!("Expected ToolsList variant");
    }

    let tools_json = serde_json::to_value(&ToolsListResponse {
        data: json!([{"name": "shell"}]),
    })
    .unwrap();
    assert_eq!(tools_json["data"][0]["name"], json!("shell"));

    // turn/events
    let events_val = json!({
        "method": "turn/events",
        "id": "events-1",
        "params": {
            "threadId": "t-123"
        }
    });
    let events_req: ClientRequest = serde_json::from_value(events_val).unwrap();
    assert_eq!(events_req.method_name(), "turn/events");
    if let ClientRequest::TurnEvents { id, params } = events_req {
        assert_eq!(id, RequestId::String("events-1".to_string()));
        assert_eq!(params.thread_id, "t-123");
    } else {
        panic!("Expected TurnEvents variant");
    }

    let events_json = serde_json::to_value(&TurnEventsResponse {
        thread_id: "t-123".to_string(),
        data: json!([{"id": "evt-1", "msg": {"type": "agent_message"}}]),
        completed: false,
        notifications: json!([]),
    })
    .unwrap();
    assert_eq!(events_json["threadId"], json!("t-123"));
    assert_eq!(events_json["completed"], json!(false));
}

#[test]
fn test_sandbox_mode_serialization_reconciliation() {
    // Serializes canonically to "danger-full-access"
    let mode = SandboxMode::DangerouslyBypass;
    let serialized = serde_json::to_string(&mode).unwrap();
    assert_eq!(serialized, "\"danger-full-access\"");

    // Deserializes from canonical "danger-full-access"
    let parsed1: SandboxMode = serde_json::from_str("\"danger-full-access\"").unwrap();
    assert_eq!(parsed1, SandboxMode::DangerouslyBypass);

    // Deserializes from legacy alias "dangerously-bypass"
    let parsed2: SandboxMode = serde_json::from_str("\"dangerously-bypass\"").unwrap();
    assert_eq!(parsed2, SandboxMode::DangerouslyBypass);

    // Other modes work as expected
    let read_only: SandboxMode = serde_json::from_str("\"read-only\"").unwrap();
    assert_eq!(read_only, SandboxMode::ReadOnly);
    let ws_write: SandboxMode = serde_json::from_str("\"workspace-write\"").unwrap();
    assert_eq!(ws_write, SandboxMode::WorkspaceWrite);
}
