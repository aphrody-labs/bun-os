// SPDX-License-Identifier: Apache-2.0
//! Public API of the A2A hub: https://api.aphrody.com/v1/a2a/ (docs/ops/API.md). `/health`, `/openapi.json`,
//! `/ping` and the agent card are public; every other route needs the hub bearer token. The A2A bindings keep the
//! protocol's JSON-RPC and REST error bodies.

use aphrody_http_error::api::{Check, Op, Service};
use axum::{Router, response::Response, routing::get};

pub const API: Service = Service {
    name: "a2a",
    title: "Aphrody A2A hub",
    version: env!("CARGO_PKG_VERSION"),
    description: "Agent-to-agent hub: A2A JSON-RPC and REST bindings, the agent card, the coordination mailbox (messages, tasks, envelopes) and the peer registry.",
    ops: &[
        Op::get("/.well-known/agent-card.json", "Agent card").tag("a2a"),
        Op::post("/", "A2A JSON-RPC")
            .tag("a2a")
            .auth()
            .errors("jsonrpc"),
        Op::post("/a2a", "A2A JSON-RPC bridge to the mailbox")
            .tag("a2a")
            .auth()
            .errors("jsonrpc"),
        Op::post("/message:send", "Send a message")
            .tag("a2a")
            .auth()
            .errors("a2a"),
        Op::post("/message:stream", "Send a message and stream the task")
            .tag("a2a")
            .auth()
            .sse()
            .errors("a2a"),
        Op::get("/tasks", "List tasks")
            .tag("a2a")
            .auth()
            .errors("a2a"),
        Op::get("/tasks/{id}", "Get a task")
            .tag("a2a")
            .auth()
            .errors("a2a"),
        Op::post("/tasks/{id}", "Task action (cancel, subscribe)")
            .tag("a2a")
            .auth()
            .errors("a2a"),
        Op::get(
            "/tasks/{id}/pushNotificationConfigs",
            "List push configurations",
        )
        .tag("a2a")
        .auth()
        .errors("a2a"),
        Op::post(
            "/tasks/{id}/pushNotificationConfigs",
            "Create a push configuration",
        )
        .tag("a2a")
        .auth()
        .errors("a2a"),
        Op::get(
            "/tasks/{id}/pushNotificationConfigs/{config_id}",
            "Get a push configuration",
        )
        .tag("a2a")
        .auth()
        .errors("a2a"),
        Op::delete(
            "/tasks/{id}/pushNotificationConfigs/{config_id}",
            "Delete a push configuration",
        )
        .tag("a2a")
        .auth()
        .errors("a2a"),
        Op::get("/extendedAgentCard", "Extended agent card")
            .tag("a2a")
            .auth()
            .errors("a2a"),
        Op::get("/ping", "Liveness of the listener").tag("coord"),
        Op::post("/msg", "Post a coordination message")
            .tag("coord")
            .auth(),
        Op::get("/coord", "Coordination state").tag("coord").auth(),
        Op::get("/coord/{namespace}/tasks", "List coordination tasks")
            .tag("coord")
            .auth(),
        Op::post("/coord/{namespace}/tasks", "Create a coordination task")
            .tag("coord")
            .auth(),
        Op::get(
            "/coord/{namespace}/tasks/{task_id}",
            "Get a coordination task",
        )
        .tag("coord")
        .auth(),
        Op::delete(
            "/coord/{namespace}/tasks/{task_id}",
            "Delete a coordination task",
        )
        .tag("coord")
        .auth(),
        Op::get("/coord/{namespace}/envelopes", "List envelopes")
            .tag("coord")
            .auth(),
        Op::post("/coord/{namespace}/envelopes", "Append an envelope")
            .tag("coord")
            .auth(),
        Op::get("/peers", "List peers").tag("peers").auth(),
        Op::post("/peers", "Register a peer").tag("peers").auth(),
    ],
};

/// `/health` and `/openapi.json`, public (the auth layer lets them through).
pub fn router(coord_dir: std::path::PathBuf) -> Router {
    API.routes().route(
        "/health",
        get(move || {
            let coord_dir = coord_dir.clone();
            async move { health(&coord_dir) }
        }),
    )
}

fn health(coord_dir: &std::path::Path) -> Response {
    aphrody_http_error::api::health(
        API.name,
        API.version,
        option_env!("APHRODY_COMMIT"),
        option_env!("APHRODY_CHANNEL"),
        &[Check {
            name: "coord",
            ok: coord_dir.is_dir(),
            optional: false,
            detail: Some("coordination directory".into()),
        }],
        serde_json::Value::Null,
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn openapi_snapshot_is_current() {
        super::API.check_snapshot(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."));
    }
}
