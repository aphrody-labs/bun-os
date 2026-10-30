// SPDX-License-Identifier: Apache-2.0
//! `aphrody_home_*`: the agent home database over MCP. One unified search over document chunks,
//! code-graph nodes and memories, and the home status; the same library as `aphrody home`.

#![cfg(not(target_arch = "wasm32"))]

use aphrody_rag::home::{HitKind, UnifiedOptions, home_query_json, home_status_json};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct HomeQueryRequest {
    /// Free-text query.
    pub(crate) query: String,
    /// Maximum hits (1-50, default 10).
    #[serde(default)]
    pub(crate) limit: Option<usize>,
    /// Restrict to kinds: `chunk`, `node`, `memory` (default: all).
    #[serde(default)]
    pub(crate) kinds: Option<Vec<String>>,
    /// Domain profile (`aphrody`, `ie`); default `$APHRODY_PROFILE`, else the global home.
    #[serde(default)]
    pub(crate) profile: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct HomeStatusRequest {
    /// Domain profile; default `$APHRODY_PROFILE`, else the global home.
    #[serde(default)]
    pub(crate) profile: Option<String>,
}

fn kinds(raw: &[String]) -> Vec<HitKind> {
    raw.iter()
        .filter_map(|k| match k.as_str() {
            "chunk" => Some(HitKind::Chunk),
            "node" => Some(HitKind::Node),
            "memory" => Some(HitKind::Memory),
            _ => None,
        })
        .collect()
}

pub(crate) async fn query(req: HomeQueryRequest) -> String {
    if req.query.trim().is_empty() {
        return json!({ "error": "query is empty" }).to_string();
    }
    let options = UnifiedOptions {
        limit: req.limit.unwrap_or(10).clamp(1, 50),
        kinds: kinds(req.kinds.as_deref().unwrap_or(&[])),
        ..UnifiedOptions::default()
    };
    let result = tokio::task::spawn_blocking(move || {
        home_query_json(req.profile.as_deref(), &req.query, &options).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    match result {
        Ok(value) => serde_json::to_string_pretty(&value).unwrap_or_default(),
        Err(error) => json!({ "error": error }).to_string(),
    }
}

pub(crate) async fn status(req: HomeStatusRequest) -> String {
    let result = tokio::task::spawn_blocking(move || {
        home_status_json(req.profile.as_deref()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    match result {
        Ok(value) => serde_json::to_string_pretty(&value).unwrap_or_default(),
        Err(error) => json!({ "error": error }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_names_map_and_unknown_names_are_ignored() {
        assert_eq!(
            kinds(&["chunk".into(), "memory".into(), "x".into()]),
            [HitKind::Chunk, HitKind::Memory]
        );
        assert!(kinds(&[]).is_empty());
    }

    #[tokio::test]
    async fn an_empty_query_is_rejected_without_touching_the_database() {
        let out = query(HomeQueryRequest {
            query: "  ".into(),
            limit: None,
            kinds: None,
            profile: None,
        })
        .await;
        assert!(out.contains("query is empty"), "{out}");
    }
}
