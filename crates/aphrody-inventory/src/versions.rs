// SPDX-License-Identifier: Apache-2.0
//! Version history of the crates.io crates (sparse index) and npm packages of the inventory, cached in a JSON file
//! outside the repository and refreshed after a day. Offline-safe: a failed lookup keeps the cached entry; without any
//! entry the member has no history.

use crate::Member;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

const DAY: u64 = 86_400;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    /// Newest first, at most 30.
    pub versions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest: Option<String>,
    pub total: usize,
    pub published: bool,
    pub checked: String,
}

#[derive(Debug, Default)]
pub struct Stats {
    pub jobs: usize,
    pub fetched: usize,
    pub cached: usize,
}

/// crates.io sparse index path of a crate name.
pub fn sparse_path(name: &str) -> String {
    let n = name.to_ascii_lowercase();
    match n.len() {
        0..=2 => format!("{}/{n}", n.len()),
        3 => format!("3/{}/{n}", &n[..1]),
        _ => format!("{}/{}/{n}", &n[..2], &n[2..4]),
    }
}

enum Lookup {
    Crate(String),
    Npm(String),
}

fn fetch(agent: &ureq::Agent, lookup: &Lookup) -> Option<VersionInfo> {
    let now = crate::text::now_rfc3339();
    let missing = || VersionInfo {
        versions: Vec::new(),
        latest: None,
        total: 0,
        published: false,
        checked: now.clone(),
    };
    match lookup {
        Lookup::Crate(name) => {
            let mut res = agent
                .get(&format!("https://index.crates.io/{}", sparse_path(name)))
                .call()
                .ok()?;
            match res.status().as_u16() {
                404 => return Some(missing()),
                200 => {}
                _ => return None,
            }
            let body = res.body_mut().read_to_string().ok()?;
            let mut all: Vec<String> = body
                .lines()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .filter(|v| v["yanked"] != json!(true))
                .filter_map(|v| v["vers"].as_str().map(str::to_string))
                .collect();
            all.reverse();
            Some(VersionInfo {
                latest: all.first().cloned(),
                total: all.len(),
                published: !all.is_empty(),
                versions: all.into_iter().take(30).collect(),
                checked: now,
            })
        }
        Lookup::Npm(name) => {
            let mut res = agent
                .get(&format!(
                    "https://registry.npmjs.org/{}",
                    name.replacen('/', "%2f", 1)
                ))
                .header("Accept", "application/vnd.npm.install-v1+json")
                .call()
                .ok()?;
            match res.status().as_u16() {
                404 => return Some(missing()),
                200 => {}
                _ => return None,
            }
            let doc: Value = serde_json::from_str(&res.body_mut().read_to_string().ok()?).ok()?;
            let mut all: Vec<String> = doc["versions"]
                .as_object()
                .map(|v| v.keys().cloned().collect())
                .unwrap_or_default();
            all.reverse();
            let latest = doc["dist-tags"]["latest"]
                .as_str()
                .map(str::to_string)
                .or_else(|| all.first().cloned());
            Some(VersionInfo {
                latest,
                total: all.len(),
                published: !all.is_empty(),
                versions: all.into_iter().take(30).collect(),
                checked: now,
            })
        }
    }
}

fn stale(info: &VersionInfo) -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    crate::text::parse_rfc3339(&info.checked).is_none_or(|t| now.saturating_sub(t) > DAY)
}

/// Attach `meta.history` to every crates.io crate and npm package; reads and rewrites the cache file.
pub fn attach(members: &mut [Member], cache_path: &Path) -> Stats {
    let cache: BTreeMap<String, VersionInfo> = std::fs::read(cache_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let mut jobs: Vec<(usize, String, Lookup)> = Vec::new();
    for (i, m) in members.iter().enumerate() {
        if m.kind == "crates" && m.tags.iter().any(|t| t == "crates.io") {
            let name = m
                .meta
                .get("crateName")
                .and_then(|v| v.as_str())
                .unwrap_or(&m.name)
                .to_string();
            jobs.push((i, format!("crate:{name}"), Lookup::Crate(name)));
        } else if m.kind == "packages" {
            if let Some(name) = m.meta.get("npm").and_then(|v| v.as_str()) {
                jobs.push((i, format!("npm:{name}"), Lookup::Npm(name.to_string())));
            }
        }
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(8)))
        .user_agent("aphrody-inventory (contact@aphrody.com)")
        .build()
        .into();
    let cache = Mutex::new(cache);
    let next = AtomicUsize::new(0);
    let fetched = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..12 {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some((_, key, lookup)) = jobs.get(i) else {
                        break;
                    };
                    let fresh = cache
                        .lock()
                        .ok()
                        .is_some_and(|c| c.get(key).is_some_and(|v| !stale(v)));
                    if fresh {
                        continue;
                    }
                    if let Some(info) = fetch(&agent, lookup) {
                        if let Ok(mut c) = cache.lock() {
                            c.insert(key.clone(), info);
                        }
                        fetched.fetch_add(1, Ordering::Relaxed);
                    }
                }
            });
        }
    });
    let cache = cache.into_inner().unwrap_or_default();
    let mut cached = 0;
    for (i, key, _) in &jobs {
        if let Some(info) = cache.get(key) {
            cached += 1;
            if let Ok(value) = serde_json::to_value(info) {
                members[*i].meta.insert("history".into(), value);
            }
        }
    }
    if let Some(parent) = cache_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(&cache) {
        let _ = std::fs::write(cache_path, bytes);
    }
    Stats {
        jobs: jobs.len(),
        fetched: fetched.into_inner(),
        cached,
    }
}
