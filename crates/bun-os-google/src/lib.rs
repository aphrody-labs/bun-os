//! Bun's Google SDK: public search (SERP parsing, discovery, cache, browser fallback), the
//! language detection atlas and the non-secret Google project contract. Model clients and
//! credentials stay in the OS (`aphrody-google` in aphrody-labs/bun-distribution).

// Standalone host outside Bun's event loop: std I/O, collections and strings are intended here, as in bun_host and bun_docker.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros,
)]

pub mod atlas;
pub mod language_detect;
pub mod languages;
#[cfg(all(not(target_arch = "wasm32"), feature = "search"))]
pub mod search;
use serde::{Deserialize, Serialize};

/// Cloud target for a workload. DBFR and NIE use `Aphrody`; RG uses `Rgfr`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GoogleProject {
    Aphrody,
    Rgfr,
}

impl GoogleProject {
    pub const fn id(self) -> &'static str {
        match self {
            Self::Aphrody => "aphrody",
            Self::Rgfr => "rgfr",
        }
    }
}

/// Non-secret runtime contract shared by Rust, Bun, Python and the kernel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoogleRuntime {
    pub project: GoogleProject,
    pub location: String,
    pub home: String,
    pub auth: String,
}

impl GoogleRuntime {
    /// Resolve only non-secret configuration from the process environment.
    pub fn from_env() -> Self {
        let project_name = std::env::var("APHRODY_VERTEX_PROJECT")
            .ok()
            .or_else(|| std::env::var("GOOGLE_CLOUD_PROJECT").ok());
        let project = match project_name.as_deref() {
            Some("rgfr") | Some("rgfr-8927d") => GoogleProject::Rgfr,
            _ => GoogleProject::Aphrody,
        };
        Self {
            project,
            location: std::env::var("GOOGLE_CLOUD_LOCATION")
                .unwrap_or_else(|_| "us-central1".to_owned()),
            home: std::env::var("APHRODY_HOME").unwrap_or_else(|_| "~/.aphrody".to_owned()),
            auth: std::env::var("APHRODY_GCP_AUTH")
                .unwrap_or_else(|_| "adc-or-secret-manager".to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_ids_are_canonical() {
        assert_eq!(GoogleProject::Aphrody.id(), "aphrody");
        assert_eq!(GoogleProject::Rgfr.id(), "rgfr");
    }
}
