// SPDX-License-Identifier: Apache-2.0
use aphrody_a2a::coord::CoordEnvelope;
pub use aphrody_a2a::coord::EnvelopeKind;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// JSONL mailbox envelope (v1). Legacy `type`/`subject` aliases accepted on read.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Envelope {
    #[serde(default)]
    pub v: Option<u32>,
    #[serde(default)]
    pub ts: String,
    pub id: String,
    pub from: String,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(alias = "type", default)]
    pub kind: String,
    #[serde(alias = "subject", default)]
    pub topic: String,
    #[serde(default)]
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub re: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_hint: Option<Vec<String>>,
    /// Preserve domain extensions such as `taskId`, `verdict` and `artifacts`.
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

impl Envelope {
    #[must_use]
    pub fn new(
        from: impl Into<String>,
        to: impl Into<String>,
        kind: EnvelopeKind,
        topic: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        let mut envelope = Self::from(CoordEnvelope::new(from, to, kind, topic, body));
        // Retain the established OS mailbox id format.
        envelope.id = new_id("env");
        envelope
    }
}

/// Compatibility projection: inbound legacy fields remain permissive while
/// outbound defaults and enum spellings come from the contracts owner.
impl From<CoordEnvelope> for Envelope {
    fn from(value: CoordEnvelope) -> Self {
        Self {
            v: Some(value.v),
            ts: value.ts,
            id: value.id,
            from: value.from,
            to: Some(value.to),
            kind: value.kind.as_str().to_owned(),
            topic: value.topic,
            body: value.body,
            re: value.re,
            channel_hint: Some(
                value
                    .channel_hint
                    .into_iter()
                    .map(|hint| hint.as_str().to_owned())
                    .collect(),
            ),
            extensions: BTreeMap::new(),
        }
    }
}

#[must_use]
pub fn new_id(prefix: &str) -> String {
    let mut buf = [0_u8; 4];
    if getrandom::fill(&mut buf).is_err() {
        let nanos = Utc::now().timestamp_nanos_opt().unwrap_or(0) as u64;
        buf.copy_from_slice(&nanos.to_le_bytes()[..4]);
    }
    format!("{prefix}-{}", hex::encode(buf))
}

mod hex {
    pub(super) fn encode(bytes: [u8; 4]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projection_preserves_canonical_wire_fields() {
        for kind in [
            EnvelopeKind::Ask,
            EnvelopeKind::Fact,
            EnvelopeKind::Ack,
            EnvelopeKind::Ping,
            EnvelopeKind::Error,
        ] {
            let canonical = CoordEnvelope::new("codex", "claude", kind, "work", "task");
            let expected = serde_json::to_value(&canonical).unwrap();
            let projected = serde_json::to_value(Envelope::from(canonical)).unwrap();
            assert_eq!(projected, expected);
        }
    }
    #[test]
    fn legacy_aliases_and_mailbox_id_are_preserved() {
        let value: Envelope =
            serde_json::from_str(r#"{"id":"legacy","from":"agy","type":"ask","subject":"work"}"#)
                .unwrap();
        assert_eq!(value.kind, "ask");
        assert_eq!(value.topic, "work");
        assert_eq!(value.v, None);
        assert!(
            Envelope::new("codex", "claude", EnvelopeKind::Ask, "work", "task")
                .id
                .starts_with("env-")
        );
    }
}
