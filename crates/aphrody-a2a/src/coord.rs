// SPDX-License-Identifier: Apache-2.0
//! Aphrody fleet coordination contracts: `.coord` envelopes (ai.json v1), the
//! legacy `message/send` JSON-RPC params used on the `/a2a` endpoint, the peer
//! roster, and machine-readable JSON Schemas for all of them.
//!
//! These contracts are shared by `aphrody` and `aphrody-infra`.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// HTTP path of the JSON-RPC 2.0 A2A endpoint.
pub const A2A_ENDPOINT_PATH: &str = "/a2a";
/// Well-known path of the public Agent Card (A2A 1.0).
pub const AGENT_CARD_WELL_KNOWN_PATH: &str = "/.well-known/agent-card.json";
/// Fleet method name for dispatching an instruction to a peer.
pub const FLEET_MESSAGE_SEND: &str = "message/send";
/// Current `.coord` envelope version.
pub const ENVELOPE_VERSION: u32 = 1;

/// Known fleet peers.
pub const PEERS: [&str; 5] = ["codex", "agycli", "claude", "ocr", "rag"];

/// Returns true when `name` is a known fleet peer.
#[must_use]
pub fn is_known_peer(name: &str) -> bool {
    PEERS.contains(&name)
}

/// Envelope kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvelopeKind {
    Ask,
    Fact,
    Ack,
    Ping,
    Error,
}

impl EnvelopeKind {
    /// Canonical spelling used by compatibility projections.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::Fact => "fact",
            Self::Ack => "ack",
            Self::Ping => "ping",
            Self::Error => "error",
        }
    }
}

/// Transport a sender suggests for delivery/reply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelHint {
    FileJsonl,
    HttpJsonrpc,
}

impl ChannelHint {
    /// Canonical spelling used by compatibility projections.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::FileJsonl => "file_jsonl",
            Self::HttpJsonrpc => "http_jsonrpc",
        }
    }
}

/// `.coord` envelope, ai.json v1. One JSON object per line on the file channel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoordEnvelope {
    pub v: u32,
    /// RFC 3339 timestamp.
    pub ts: String,
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: EnvelopeKind,
    pub topic: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub re: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channel_hint: Vec<ChannelHint>,
}

impl CoordEnvelope {
    /// Build a v1 envelope with a fresh UUIDv7 id and the current UTC timestamp.
    #[must_use]
    pub fn new(
        from: impl Into<String>,
        to: impl Into<String>,
        kind: EnvelopeKind,
        topic: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        Self {
            v: ENVELOPE_VERSION,
            ts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            id: uuid::Uuid::now_v7().to_string(),
            from: from.into(),
            to: to.into(),
            kind,
            topic: topic.into(),
            body: body.into(),
            re: None,
            channel_hint: vec![ChannelHint::FileJsonl, ChannelHint::HttpJsonrpc],
        }
    }

    /// Validate structural invariants not expressible in serde.
    ///
    /// # Errors
    /// Returns a description of the first violated invariant.
    pub fn validate(&self) -> Result<(), String> {
        if self.v != ENVELOPE_VERSION {
            return Err(format!("unsupported envelope version {}", self.v));
        }
        if chrono::DateTime::parse_from_rfc3339(&self.ts).is_err() {
            return Err(format!("ts is not RFC 3339: {}", self.ts));
        }
        for (name, val) in [("id", &self.id), ("from", &self.from), ("to", &self.to)] {
            if val.trim().is_empty() {
                return Err(format!("{name} must not be empty"));
            }
        }
        Ok(())
    }
}

/// Params of the fleet `message/send` JSON-RPC method on `/a2a`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetSendParams {
    pub target: String,
    pub source_agent: String,
    pub instruction: String,
    #[serde(default)]
    pub yolo: bool,
}

/// JSON Schema (draft 2020-12) for [`CoordEnvelope`].
#[must_use]
pub fn envelope_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://aphrody.dev/schemas/coord-envelope.v1.json",
        "title": "CoordEnvelope",
        "type": "object",
        "additionalProperties": false,
        "required": ["v", "ts", "id", "from", "to", "kind", "topic", "body"],
        "properties": {
            "v": { "const": 1 },
            "ts": { "type": "string", "format": "date-time" },
            "id": { "type": "string", "minLength": 1 },
            "from": { "type": "string", "minLength": 1 },
            "to": { "type": "string", "minLength": 1 },
            "kind": { "enum": ["ask", "fact", "ack", "ping", "error"] },
            "topic": { "type": "string" },
            "body": { "type": "string" },
            "re": { "type": "string" },
            "channel_hint": {
                "type": "array",
                "items": { "enum": ["file_jsonl", "http_jsonrpc"] },
                "uniqueItems": true
            }
        }
    })
}

/// JSON Schema for a JSON-RPC 2.0 request on `/a2a` (fleet `message/send`
/// or any A2A 1.0 method).
#[must_use]
pub fn jsonrpc_request_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://aphrody.dev/schemas/a2a-jsonrpc-request.json",
        "title": "JsonRpcRequest",
        "type": "object",
        "required": ["jsonrpc", "method"],
        "properties": {
            "jsonrpc": { "const": "2.0" },
            "id": { "type": ["string", "integer", "null"] },
            "method": { "type": "string", "minLength": 1 },
            "params": { "type": "object" }
        },
        "if": { "properties": { "method": { "const": FLEET_MESSAGE_SEND } } },
        "then": { "properties": { "params": {
            "type": "object",
            "required": ["target", "sourceAgent", "instruction"],
            "properties": {
                "target": { "type": "string", "minLength": 1 },
                "sourceAgent": { "type": "string", "minLength": 1 },
                "instruction": { "type": "string", "minLength": 1 },
                "yolo": { "type": "boolean" }
            }
        } } }
    })
}

/// JSON Schema for a JSON-RPC 2.0 response.
#[must_use]
pub fn jsonrpc_response_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://aphrody.dev/schemas/a2a-jsonrpc-response.json",
        "title": "JsonRpcResponse",
        "type": "object",
        "required": ["jsonrpc", "id"],
        "properties": {
            "jsonrpc": { "const": "2.0" },
            "id": { "type": ["string", "integer", "null"] },
            "result": {},
            "error": {
                "type": "object",
                "required": ["code", "message"],
                "properties": {
                    "code": { "type": "integer" },
                    "message": { "type": "string" },
                    "data": {}
                }
            }
        },
        "oneOf": [ { "required": ["result"] }, { "required": ["error"] } ]
    })
}

/// Minimal JSON Schema for the A2A 1.0 Agent Card served at
/// [`AGENT_CARD_WELL_KNOWN_PATH`].
#[must_use]
pub fn agent_card_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://aphrody.dev/schemas/agent-card.json",
        "title": "AgentCard",
        "type": "object",
        "required": ["name", "description", "version", "supportedInterfaces", "capabilities",
                     "defaultInputModes", "defaultOutputModes", "skills"],
        "properties": {
            "name": { "type": "string" },
            "description": { "type": "string" },
            "version": { "type": "string" },
            "supportedInterfaces": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["url", "protocolBinding"],
                    "properties": {
                        "url": { "type": "string" },
                        "protocolBinding": { "type": "string" },
                        "protocolVersion": { "type": "string" }
                    }
                }
            },
            "capabilities": { "type": "object" },
            "defaultInputModes": { "type": "array", "items": { "type": "string" } },
            "defaultOutputModes": { "type": "array", "items": { "type": "string" } },
            "skills": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["id", "name", "description", "tags"],
                    "properties": {
                        "id": { "type": "string" },
                        "name": { "type": "string" },
                        "description": { "type": "string" },
                        "tags": { "type": "array", "items": { "type": "string" } }
                    }
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jsonrpc::{JsonRpcId, JsonRpcRequest, JsonRpcResponse};

    #[test]
    fn envelope_roundtrip_matches_wire_format() {
        let wire = r#"{"v":1,"ts":"2026-09-14T12:00:00Z","id":"env-1","from":"codex","to":"claude","kind":"ask","topic":"t","body":"b","re":"env-0","channel_hint":["file_jsonl","http_jsonrpc"]}"#;
        let env: CoordEnvelope = serde_json::from_str(wire).unwrap();
        assert_eq!(env.kind, EnvelopeKind::Ask);
        env.validate().unwrap();
        assert_eq!(serde_json::to_string(&env).unwrap(), wire);
    }

    #[test]
    fn envelope_new_is_valid_and_optional_fields_omitted() {
        let mut env = CoordEnvelope::new("claude", "rag", EnvelopeKind::Ping, "hb", "");
        env.validate().unwrap();
        env.channel_hint.clear();
        let v = serde_json::to_value(&env).unwrap();
        assert!(v.get("re").is_none() && v.get("channel_hint").is_none());
        let back: CoordEnvelope = serde_json::from_value(v).unwrap();
        assert_eq!(back, env);
    }

    #[test]
    fn envelope_rejects_bad_kind_unknown_field_and_version() {
        let bad = r#"{"v":1,"ts":"2026-09-14T12:00:00Z","id":"a","from":"x","to":"y","kind":"nope","topic":"","body":""}"#;
        assert!(serde_json::from_str::<CoordEnvelope>(bad).is_err());
        let extra = r#"{"v":1,"ts":"2026-09-14T12:00:00Z","id":"a","from":"x","to":"y","kind":"ack","topic":"","body":"","zz":1}"#;
        assert!(serde_json::from_str::<CoordEnvelope>(extra).is_err());
        let mut env = CoordEnvelope::new("a", "b", EnvelopeKind::Fact, "", "");
        env.v = 2;
        assert!(env.validate().is_err());
    }

    #[test]
    fn all_kinds_serialize_lowercase() {
        for (k, s) in [
            (EnvelopeKind::Ask, "ask"),
            (EnvelopeKind::Fact, "fact"),
            (EnvelopeKind::Ack, "ack"),
            (EnvelopeKind::Ping, "ping"),
            (EnvelopeKind::Error, "error"),
        ] {
            assert_eq!(serde_json::to_value(k).unwrap(), json!(s));
        }
    }

    #[test]
    fn fleet_send_request_roundtrip() {
        let wire = json!({"jsonrpc":"2.0","id":"req-1","method":"message/send",
            "params":{"target":"ocr","sourceAgent":"codex","instruction":"go","yolo":true}});
        let req: JsonRpcRequest = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(req.method, FLEET_MESSAGE_SEND);
        let p: FleetSendParams = serde_json::from_value(req.params.clone().unwrap()).unwrap();
        assert!(p.yolo && is_known_peer(&p.target) && is_known_peer(&p.source_agent));
        assert_eq!(serde_json::to_value(&req).unwrap(), wire);
    }

    #[test]
    fn jsonrpc_response_roundtrip() {
        let wire = json!({"jsonrpc":"2.0","id":"req-1","result":{"ok":true}});
        let resp: JsonRpcResponse = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(resp.id, JsonRpcId::String("req-1".into()));
        assert_eq!(serde_json::to_value(&resp).unwrap(), wire);
    }

    #[test]
    fn schemas_are_consistent() {
        let e = envelope_schema();
        assert_eq!(e["required"].as_array().unwrap().len(), 8);
        assert_eq!(e["properties"]["kind"]["enum"].as_array().unwrap().len(), 5);
        assert_eq!(
            jsonrpc_request_schema()["if"]["properties"]["method"]["const"],
            "message/send"
        );
        assert!(jsonrpc_response_schema()["oneOf"].is_array());
        assert_eq!(agent_card_schema()["title"], "AgentCard");
    }
}
