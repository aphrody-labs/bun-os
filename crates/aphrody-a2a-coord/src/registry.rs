// SPDX-License-Identifier: Apache-2.0
//! Cross-repo A2A peer registry.
//!
//! Resolution order per peer (first hit wins):
//! 1. env `APHRODY_A2A_PEER_<ID>_URL` (upper-case id, `-` -> `_`);
//! 2. `tools/aphrody/config/a2a-peers.json` (or `APHRODY_A2A_PEERS_FILE`),
//!    shape `{"peers":[{"id":"claude","transport":"https-jsonrpc","endpoint":"https://..."}]}`
//!    (the legacy `url` field is still accepted; `coord-file` endpoints are paths,
//!    not URLs, and keep the peer on the file channel);
//! 3. local file coordination (no implicit retired public endpoint).
//!
//! Peers without an HTTP endpoint fall back to the `.coord` file channel.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Canonical peers of the aphrody federation.
pub const KNOWN_PEERS: &[&str] = &["codex", "agycli", "claude", "ocr", "rag"];

/// Channel a peer is reached through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    HttpJsonrpc,
    FileJsonl,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerEndpoint {
    pub id: String,
    #[serde(default)]
    pub url: Option<String>,
}

impl PeerEndpoint {
    #[must_use]
    pub fn channel(&self) -> Channel {
        if self.url.is_some() {
            Channel::HttpJsonrpc
        } else {
            Channel::FileJsonl
        }
    }
}

#[derive(Debug, Deserialize)]
struct PeersFile {
    #[serde(default)]
    peers: Vec<CatalogPeer>,
}

/// One entry of the monorepo `tools/aphrody/config/a2a-peers.json`.
#[derive(Debug, Deserialize)]
struct CatalogPeer {
    id: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    endpoint: Option<String>,
    #[serde(default)]
    transport: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

impl CatalogPeer {
    fn into_endpoint(self) -> PeerEndpoint {
        if self.status.as_deref() == Some("retired") {
            return PeerEndpoint {
                id: self.id,
                url: None,
            };
        }
        let is_http = |u: &str| u.starts_with("http://") || u.starts_with("https://");
        let endpoint = self.endpoint.filter(|e| {
            is_http(e)
                && self
                    .transport
                    .as_deref()
                    .is_none_or(|t| t.starts_with("http"))
        });
        let url = self.url.filter(|u| is_http(u)).or(endpoint);
        PeerEndpoint { id: self.id, url }
    }
}

#[derive(Debug, Clone, Default)]
pub struct PeerRegistry {
    peers: Vec<PeerEndpoint>,
}

fn env_key(id: &str) -> String {
    format!(
        "APHRODY_A2A_PEER_{}_URL",
        id.to_ascii_uppercase().replace('-', "_")
    )
}

impl PeerRegistry {
    /// Build from an explicit catalog file (optional) and an env lookup.
    pub fn resolve(catalog: Option<&Path>, env: impl Fn(&str) -> Option<String>) -> Self {
        let file_peers: Vec<PeerEndpoint> = catalog
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str::<PeersFile>(&t).ok())
            .map(|f| {
                f.peers
                    .into_iter()
                    .map(CatalogPeer::into_endpoint)
                    .collect()
            })
            .unwrap_or_default();
        let mut ids: Vec<String> = KNOWN_PEERS.iter().map(|s| (*s).to_owned()).collect();
        for p in &file_peers {
            if !ids.contains(&p.id) {
                ids.push(p.id.clone());
            }
        }
        let peers = ids
            .into_iter()
            .map(|id| {
                let url = env(&env_key(&id))
                    .filter(|u| !u.trim().is_empty())
                    .or_else(|| {
                        file_peers
                            .iter()
                            .find(|p| p.id == id)
                            .and_then(|p| p.url.clone())
                    });
                PeerEndpoint { id, url }
            })
            .collect();
        Self { peers }
    }

    /// Resolve from the process env and the sibling infra catalog.
    #[must_use]
    pub fn from_env(repo_root: &Path) -> Self {
        let catalog = std::env::var_os("APHRODY_A2A_PEERS_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| repo_root.join("tools/aphrody/config/a2a-peers.json"));
        Self::resolve(Some(&catalog), |k| std::env::var(k).ok())
    }

    #[must_use]
    pub fn get(&self, id: &str) -> Option<&PeerEndpoint> {
        let short = id.split('@').next().unwrap_or(id);
        self.peers.iter().find(|p| p.id == short)
    }

    #[must_use]
    pub fn peers(&self) -> &[PeerEndpoint] {
        &self.peers
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_use_file_coordination() {
        let r = PeerRegistry::resolve(None, |_| None);
        assert_eq!(r.peers().len(), KNOWN_PEERS.len());
        assert_eq!(r.get("claude").unwrap().channel(), Channel::FileJsonl);
        assert_eq!(r.get("codex@x").unwrap().channel(), Channel::FileJsonl);
    }

    #[test]
    fn retired_catalog_peer_never_revives_its_http_endpoint() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("peers.json");
        std::fs::write(&path, r#"{"peers":[{"id":"claude","status":"retired","transport":"https-jsonrpc","endpoint":"https://retired.invalid/a2a"}]}"#).unwrap();
        assert_eq!(
            PeerRegistry::resolve(Some(&path), |_| None)
                .get("claude")
                .unwrap()
                .channel(),
            Channel::FileJsonl
        );
    }

    #[test]
    fn env_overrides_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a2a-peers.json");
        std::fs::write(
            &f,
            r#"{"peers":[{"id":"rag","url":"http://rag.local/a2a"},{"id":"extra","url":"http://e/a2a"}]}"#,
        )
        .unwrap();
        let r = PeerRegistry::resolve(Some(&f), |k| {
            (k == "APHRODY_A2A_PEER_CLAUDE_URL").then(|| "http://s/a2a".to_owned())
        });
        assert_eq!(
            r.get("claude").unwrap().url.as_deref(),
            Some("http://s/a2a")
        );
        assert_eq!(
            r.get("rag").unwrap().url.as_deref(),
            Some("http://rag.local/a2a")
        );
        assert!(r.get("extra").is_some());
    }

    #[test]
    fn infra_catalog_shape() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a2a-peers.json");
        std::fs::write(
            &f,
            r#"{"peers":[
                {"id":"aphrody","transport":"https-jsonrpc","endpoint":"https://aphrody.com/api/v1/a2a"},
                {"id":"claude","transport":"https-jsonrpc","endpoint":"https://s.example/a2a"},
                {"id":"codex","transport":"coord-file","endpoint":".coord/inbox-from-codex.jsonl"}
            ]}"#,
        )
        .unwrap();
        let r = PeerRegistry::resolve(Some(&f), |_| None);
        assert_eq!(
            r.get("aphrody").unwrap().url.as_deref(),
            Some("https://aphrody.com/api/v1/a2a")
        );
        assert_eq!(
            r.get("claude").unwrap().url.as_deref(),
            Some("https://s.example/a2a")
        );
        assert_eq!(r.get("codex").unwrap().channel(), Channel::FileJsonl);
    }
}
