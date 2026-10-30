// SPDX-License-Identifier: Apache-2.0
//! Static Google ecosystem audit atlas.
//!
//! `atlas.json` was extracted from the source Web checkout at commit
//! bbeb5ef4c497f7d27f546ad2cc15a250dcc93c83,
//! `apps/bxc/src/google/atlas.ts` SHA-256
//! 9c5b3745e2422f0713dcbbc690343c34d327c07ba4b75a5741871d53f9727e34.
//! The source's derived `FRAMEWORK_BY_HOST` lets `unknown` shadow known
//! frameworks; this lookup resolves concrete classifications first.

use std::{collections::BTreeMap, sync::LazyLock};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AtlasStats {
    pub total_audits: usize,
    pub unique_hosts: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtlasData {
    stats: AtlasStats,
    cdn_counts: Vec<(String, usize)>,
    framework_counts: Vec<(String, usize)>,
    hosts_by_cdn: BTreeMap<String, Vec<String>>,
    hosts_by_framework: BTreeMap<String, Vec<String>>,
    all_hosts: Vec<String>,
}

static ATLAS: LazyLock<AtlasData> = LazyLock::new(|| {
    serde_json::from_str(include_str!("atlas.json"))
        .expect("bundled Google atlas must remain valid JSON")
});

pub fn atlas_stats() -> AtlasStats {
    ATLAS.stats
}

pub fn known_hosts() -> &'static [String] {
    &ATLAS.all_hosts
}

pub fn cdn_counts() -> &'static [(String, usize)] {
    &ATLAS.cdn_counts
}

pub fn framework_counts() -> &'static [(String, usize)] {
    &ATLAS.framework_counts
}

pub fn cdn_for_host(host: &str) -> Option<&'static str> {
    let host = host.to_ascii_lowercase();
    ATLAS
        .hosts_by_cdn
        .iter()
        .find(|(_, hosts)| hosts.iter().any(|candidate| candidate == &host))
        .map(|(cdn, _)| cdn.as_str())
}

pub fn framework_for_host(host: &str) -> Option<&'static str> {
    let host = host.to_ascii_lowercase();
    ATLAS
        .hosts_by_framework
        .iter()
        .filter(|(name, _)| name.as_str() != "unknown")
        .find(|(_, hosts)| hosts.iter().any(|candidate| candidate == &host))
        .or_else(|| {
            ATLAS
                .hosts_by_framework
                .get_key_value("unknown")
                .filter(|(_, hosts)| hosts.iter().any(|candidate| candidate == &host))
        })
        .map(|(framework, _)| framework.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_counts_and_specific_frameworks_are_available() {
        assert_eq!(atlas_stats().total_audits, 5637);
        assert_eq!(known_hosts().len(), atlas_stats().unique_hosts);
        assert_eq!(framework_for_host("WWW.GOOGLE.COM"), Some("wiz"));
        assert_eq!(framework_for_host("developers.google.com"), Some("angular"));
        assert_eq!(framework_for_host("io.google"), Some("lit"));
        assert_eq!(cdn_for_host("www.google.com"), Some("GFE"));
        assert_eq!(framework_for_host("not-an-audited-host.example"), None);
    }
}
