// SPDX-License-Identifier: Apache-2.0
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Rich `ai.json` manifest — file channel + optional HTTP A2A 1.0 surface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiManifest {
    pub version: String,
    pub spec: String,
    pub id: String,
    pub schema_version: String,
    pub kind: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// A2A protocol version for wire (`A2A-Version` header). Prefer `"1.0"`.
    #[serde(default, rename = "a2a_protocol_version")]
    pub a2a_protocol_version: Option<String>,
    #[serde(default)]
    pub documentation_url: Option<String>,
    #[serde(default)]
    pub provider: Option<Provider>,
    #[serde(default)]
    pub supported_interfaces: Vec<SupportedInterface>,
    #[serde(default)]
    pub capabilities: Option<Capabilities>,
    #[serde(default)]
    pub default_input_modes: Vec<String>,
    #[serde(default)]
    pub default_output_modes: Vec<String>,
    #[serde(default)]
    pub peers: Vec<PeerDef>,
    #[serde(default)]
    pub skills: Vec<SkillDef>,
    #[serde(default)]
    pub coord: Option<CoordConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Provider {
    pub organization: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SupportedInterface {
    pub url: String,
    pub protocol_binding: String,
    #[serde(default)]
    pub protocol_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub push_notifications: bool,
    #[serde(default)]
    pub extended_agent_card: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PeerDef {
    pub id: String,
    #[serde(default)]
    pub role: Option<String>,
    pub transport: String,
    #[serde(default)]
    pub binary: Option<String>,
    #[serde(default)]
    pub invocation: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SkillDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CoordConfig {
    #[serde(default)]
    pub mailbox_dir: Option<String>,
    #[serde(default)]
    pub inbox_pattern: Option<String>,
    #[serde(default)]
    pub http_bind: Option<String>,
    #[serde(default)]
    pub envelope: Option<EnvelopeSchema>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnvelopeSchema {
    #[serde(default)]
    pub v: Option<u32>,
    #[serde(default)]
    pub kinds: Vec<String>,
}

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("ai.json not found under {0}")]
    NotFound(PathBuf),
}

impl AiManifest {
    pub fn load(path: &Path) -> Result<Self, ManifestError> {
        let text = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&text)?)
    }

    pub fn load_repo_default() -> Result<(Self, PathBuf), ManifestError> {
        let root = find_repo_root()?;
        let path = root.join("ai.json");
        if !path.is_file() {
            return Err(ManifestError::NotFound(path));
        }
        Ok((Self::load(&path)?, root))
    }

    #[must_use]
    pub fn coord_dir(&self, repo_root: &Path) -> PathBuf {
        self.coord
            .as_ref()
            .and_then(|c| c.mailbox_dir.as_ref())
            .map(|d| {
                let p = PathBuf::from(d);
                if p.is_absolute() {
                    p
                } else {
                    repo_root.join(p)
                }
            })
            .unwrap_or_else(|| repo_root.join(".coord"))
    }

    pub fn peer_by_short_id(&self, short: &str) -> Option<&PeerDef> {
        self.peers.iter().find(|p| {
            p.id.split('@').next().map(|s| s == short).unwrap_or(false) || p.id.contains(short)
        })
    }
}

/// Walk up from cwd until `ai.json` exists, else fall back to `APHRODY_ROOT` (agents working in
/// sibling repos such as the Bun fork share the monorepo manifest and mailbox).
pub fn find_repo_root() -> Result<PathBuf, ManifestError> {
    let start = std::env::current_dir()?;
    let fallback = std::env::var_os("APHRODY_ROOT").map(PathBuf::from);
    find_repo_root_from(&start, fallback.as_deref())
}

fn find_repo_root_from(start: &Path, fallback: Option<&Path>) -> Result<PathBuf, ManifestError> {
    if let Some(dir) = start.ancestors().find(|d| d.join("ai.json").is_file()) {
        return Ok(dir.to_path_buf());
    }
    match fallback {
        Some(root) if root.join("ai.json").is_file() => Ok(root.to_path_buf()),
        _ => Err(ManifestError::NotFound(start.to_path_buf())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_root_falls_back_to_aphrody_root_outside_the_monorepo() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .find(|d| d.join("ai.json").is_file())
            .unwrap();
        let outside = std::env::temp_dir();
        assert_eq!(find_repo_root_from(&outside, Some(repo)).unwrap(), repo);
        assert!(find_repo_root_from(&outside, None).is_err());
    }

    /// The repository advertises local coordination until public deployment
    /// has been qualified. Peers live in the monorepo catalogue.
    #[test]
    fn repo_manifest_parses_without_unqualified_public_endpoint() {
        let manifest: AiManifest =
            serde_json::from_str(include_str!("../data/ai.json")).expect("ai.json parses");
        assert!(manifest.supported_interfaces.is_empty());
        assert!(
            manifest.peers.is_empty(),
            "peer list belongs to tools/config/a2a-peers.json"
        );
    }
}
