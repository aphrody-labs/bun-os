// SPDX-License-Identifier: Apache-2.0
//! Host disposition: ONE home per host (vps, dbfr), no `/srv`, no `/opt`. Read from the `[layout]` table of
//! `infra/config/host/host-policy.toml`, the single source of truth (TypeScript: `packages/engine/core/src/host/layout.ts`).

use std::collections::BTreeMap;
use std::sync::LazyLock;

use serde::Deserialize;

/// The shipped policy, embedded so a compiled binary needs no checkout.
pub const POLICY: &str = include_str!("../../../infra/config/host/host-policy.toml");

#[derive(Debug, Deserialize)]
struct PolicyFile {
    layout: RawLayout,
}

#[derive(Debug, Deserialize)]
struct RawLayout {
    home: String,
    src: String,
    apps: String,
    build: String,
    archive: String,
    state: String,
    compose: String,
    compose_project: String,
    releases_keep: u32,
    #[serde(default)]
    retired: BTreeMap<String, String>,
}

/// Every root expanded against `home`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostLayout {
    pub home: String,
    pub src: String,
    pub apps: String,
    pub build: String,
    pub archive: String,
    pub state: String,
    pub compose: String,
    pub compose_project: String,
    pub releases_keep: u32,
    /// Retired location -> replacement, longest prefix first.
    pub retired: Vec<(String, String)>,
}

fn expand(path: &str, home: &str) -> String {
    match path.strip_prefix('~') {
        Some("") => home.to_owned(),
        Some(rest) if rest.starts_with('/') => format!("{home}{rest}"),
        _ => path.to_owned(),
    }
}

impl HostLayout {
    /// Parse a host-policy document; `home` overrides the declared one.
    pub fn parse(policy: &str, home: Option<&str>) -> Result<Self, toml::de::Error> {
        let raw = toml::from_str::<PolicyFile>(policy)?.layout;
        let home = home.unwrap_or(&raw.home).to_owned();
        let mut retired: Vec<(String, String)> = raw
            .retired
            .iter()
            .map(|(from, to)| (expand(from, &home), expand(to, &home)))
            .collect();
        retired.sort_by_key(|r| std::cmp::Reverse(r.0.len()));
        Ok(Self {
            src: expand(&raw.src, &home),
            apps: expand(&raw.apps, &home),
            build: expand(&raw.build, &home),
            archive: expand(&raw.archive, &home),
            state: expand(&raw.state, &home),
            compose: expand(&raw.compose, &home),
            compose_project: raw.compose_project,
            releases_keep: raw.releases_keep,
            retired,
            home,
        })
    }

    /// `~/apps/<app>`.
    pub fn app(&self, app: &str) -> String {
        format!("{}/{app}", self.apps)
    }

    /// `~/src/<repo>`.
    pub fn repo(&self, repo: &str) -> String {
        format!("{}/{repo}", self.src)
    }

    /// The retired prefix `path` starts with (path-boundary aware).
    pub fn retired_prefix(&self, path: &str) -> Option<&str> {
        self.retired
            .iter()
            .map(|(from, _)| from.as_str())
            .find(|from| {
                path == *from || path.strip_prefix(from).is_some_and(|r| r.starts_with('/'))
            })
    }
}

/// The shipped layout.
pub static HOST_LAYOUT: LazyLock<HostLayout> = LazyLock::new(|| {
    HostLayout::parse(POLICY, None).expect("infra/config/host/host-policy.toml: invalid [layout]")
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shipped_layout_is_one_home_without_srv() {
        let l = &*HOST_LAYOUT;
        assert_eq!(l.home, "/home/ubuntu");
        assert_eq!(l.src, "/home/ubuntu/src");
        assert_eq!(l.app("aphrody"), "/home/ubuntu/apps/aphrody");
        assert_eq!(l.build, "/home/ubuntu/build");
        assert_eq!(l.compose, "/home/ubuntu/apps/compose.yaml");
        for root in [&l.src, &l.apps, &l.build, &l.archive, &l.state] {
            assert!(root.starts_with("/home/ubuntu/"), "{root}");
        }
        assert_eq!(
            l.retired_prefix("/srv/aphrody-build/cache"),
            Some("/srv/aphrody-build")
        );
        assert_eq!(l.retired_prefix("/srv/aphrody/shared"), Some("/srv"));
        assert_eq!(l.retired_prefix("/srvx"), None);
        assert_eq!(l.retired_prefix("/home/ubuntu/apps/aphrody"), None);
    }

    #[test]
    fn home_override() {
        let l = HostLayout::parse(POLICY, Some("/home/x")).unwrap();
        assert_eq!(l.repo("aphrody"), "/home/x/src/aphrody");
    }
}
