// SPDX-License-Identifier: Apache-2.0
//! Cross-repo `/a2a` JSON-RPC 2.0 bridge (`message/send` with
//! `target`/`sourceAgent`/`instruction`/`yolo`), shared with aphrody-os and
//! aphrody-infra. Each call is mirrored as a `.coord` envelope.

use axum::{Json, Router, extract::State, routing::post};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

use crate::{
    envelope::{Envelope, EnvelopeKind},
    mailbox::{Mailbox, MailboxError},
    registry::{Channel, PeerRegistry},
};

pub const A2A_PATH: &str = "/a2a";
pub const METHOD_MESSAGE_SEND: &str = "message/send";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendParams {
    pub target: String,
    pub source_agent: String,
    pub instruction: String,
    #[serde(default)]
    pub yolo: bool,
}

impl SendParams {
    #[must_use]
    pub fn to_envelope(&self) -> Envelope {
        let topic = if self.yolo {
            "a2a.message.send.yolo"
        } else {
            "a2a.message.send"
        };
        Envelope::new(
            &self.source_agent,
            &self.target,
            EnvelopeKind::Ask,
            topic,
            &self.instruction,
        )
    }
}

#[must_use]
pub fn build_request(id: &str, params: &SendParams) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": METHOD_MESSAGE_SEND, "params": params })
}

fn rpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message.into() } })
}

/// Server-side handling of one JSON-RPC request: records the ask in the
/// local mailbox (`inbox-from-<source>.jsonl`) and answers with an ack envelope.
pub fn handle_request(mailbox: &Mailbox, self_id: &str, req: &Value) -> Value {
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    if req.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return rpc_error(id, -32600, "invalid request: jsonrpc must be \"2.0\"");
    }
    if req.get("method").and_then(Value::as_str) != Some(METHOD_MESSAGE_SEND) {
        return rpc_error(id, -32601, "method not found");
    }
    let params: SendParams = match req.get("params").cloned().map(serde_json::from_value) {
        Some(Ok(p)) => p,
        Some(Err(e)) => return rpc_error(id, -32602, format!("invalid params: {e}")),
        None => return rpc_error(id, -32602, "invalid params: missing"),
    };
    let ask = params.to_envelope();
    let short = params.source_agent.split('@').next().unwrap_or("unknown");
    if let Err(e) = mailbox.append(short, &ask) {
        return rpc_error(id, -32603, e.to_string());
    }
    let mut ack = Envelope::new(
        self_id,
        &params.source_agent,
        EnvelopeKind::Ack,
        "a2a.ack",
        "queued",
    );
    ack.re = Some(ask.id.clone());
    json!({ "jsonrpc": "2.0", "id": id, "result": { "status": "queued", "envelope": ask, "ack": ack } })
}

#[derive(Clone)]
struct BridgeState {
    mailbox: Mailbox,
    self_id: String,
}

/// Router exposing `POST /a2a`.
pub fn a2a_router(mailbox: Mailbox, self_id: impl Into<String>) -> Router {
    Router::new()
        .route(A2A_PATH, post(serve_a2a))
        .with_state(BridgeState {
            mailbox,
            self_id: self_id.into(),
        })
}

async fn serve_a2a(State(s): State<BridgeState>, Json(req): Json<Value>) -> Json<Value> {
    Json(handle_request(&s.mailbox, &s.self_id, &req))
}

#[derive(Debug, Error)]
pub enum SendError {
    #[error("unknown peer: {0}")]
    UnknownPeer(String),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("mailbox: {0}")]
    Mailbox(#[from] MailboxError),
}

/// Client: HTTP JSON-RPC when the peer has an endpoint, else `.coord` file channel
/// (`outbox-to-<target>.jsonl`). Returns the JSON-RPC response or the written envelope.
pub async fn send(
    registry: &PeerRegistry,
    mailbox: &Mailbox,
    params: &SendParams,
) -> Result<Value, SendError> {
    let peer = registry
        .get(&params.target)
        .ok_or_else(|| SendError::UnknownPeer(params.target.clone()))?;
    match (peer.channel(), peer.url.as_deref()) {
        (Channel::HttpJsonrpc, Some(url)) => {
            let req = build_request(&crate::envelope::new_id("rpc"), params);
            let resp = reqwest::Client::new()
                .post(url)
                .header("A2A-Version", "1.0")
                .json(&req)
                .send()
                .await?
                .error_for_status()?
                .json::<Value>()
                .await?;
            Ok(resp)
        }
        _ => {
            let env = params.to_envelope();
            mailbox.ensure_dir()?;
            let path = mailbox
                .coord_dir
                .join(format!("outbox-to-{}.jsonl", peer.id));
            let line = serde_json::to_string(&env).map_err(MailboxError::from)?;
            use std::io::Write as _;
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map_err(MailboxError::from)?;
            writeln!(f, "{line}").map_err(MailboxError::from)?;
            Ok(json!({ "status": "queued_file", "envelope": env }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(target: &str) -> SendParams {
        SendParams {
            target: target.into(),
            source_agent: "aphrody".into(),
            instruction: "ping codex".into(),
            yolo: true,
        }
    }

    #[test]
    fn request_shape_is_camel_case() {
        let r = build_request("1", &params("codex"));
        assert_eq!(r["method"], "message/send");
        assert_eq!(r["params"]["sourceAgent"], "aphrody");
        assert_eq!(r["params"]["yolo"], true);
    }

    #[test]
    fn handle_records_envelope_and_acks() {
        let dir = tempfile::tempdir().unwrap();
        let mb = Mailbox::new(dir.path().join(".coord"));
        let resp = handle_request(&mb, "aphrody", &build_request("7", &params("aphrody")));
        assert_eq!(resp["id"], "7");
        assert_eq!(resp["result"]["status"], "queued");
        assert_eq!(resp["result"]["ack"]["kind"], "ack");
        let env = mb.read_last("aphrody").unwrap().unwrap();
        assert_eq!(env.kind, "ask");
        assert_eq!(env.v, Some(1));
        assert_eq!(resp["result"]["ack"]["re"], env.id);
    }

    #[test]
    fn handle_rejects_bad_method_and_params() {
        let mb = Mailbox::new(std::env::temp_dir().join("unused-coord"));
        let r = handle_request(&mb, "a", &json!({"jsonrpc":"2.0","id":1,"method":"x"}));
        assert_eq!(r["error"]["code"], -32601);
        let r = handle_request(
            &mb,
            "a",
            &json!({"jsonrpc":"2.0","id":1,"method":"message/send","params":{}}),
        );
        assert_eq!(r["error"]["code"], -32602);
    }

    #[tokio::test]
    async fn send_falls_back_to_file_channel() {
        let dir = tempfile::tempdir().unwrap();
        let mb = Mailbox::new(dir.path().join(".coord"));
        let reg = PeerRegistry::resolve(None, |_| None);
        let out = send(&reg, &mb, &params("codex")).await.unwrap();
        assert_eq!(out["status"], "queued_file");
        assert!(mb.coord_dir.join("outbox-to-codex.jsonl").is_file());
        assert!(send(&reg, &mb, &params("nobody")).await.is_err());
    }
}
