// SPDX-License-Identifier: Apache-2.0
//! The Bun OS inventory: every member of the repository (apps, packages, crates, factory, OS packages, engines, games,
//! tools, infra, releases, pinned sources, root entries and collections) with the surface that serves it.
//!
//! [`generate`] reads a checkout (tracked files only), [`check`] is the coverage gate, [`write`] lays the inventory out as
//! JSON files (`inventory.json`, `<kind>.json`, `<kind>/<id>.json`) that the `server` feature serves from
//! `WEBOS_INVENTORY_DIR`. Documentation, templates, showcases and examples are not members. Private owner material
//! (DBXV2, iecode-docs) is listed with its content stripped.

pub mod repo;
pub mod text;
pub mod versions;
pub mod wasm;

#[cfg(feature = "server")]
pub mod server;
#[cfg(feature = "server")]
pub use server::{InventoryHealth, InventoryState, health, router};

use repo::{Entry, Repo};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use text::{first_paragraph, header_text, toml_desc};

/// Kinds of members, in display order: id, label, description.
pub const KINDS: &[(&str, &str, &str)] = &[
    (
        "apps",
        "Apps",
        "Every apps/ member: published builds, status and source.",
    ),
    (
        "packages",
        "Packages",
        "Every packages/ member with README, version and npm link.",
    ),
    (
        "crates",
        "Crates",
        "Every crates/ member with README, version, crates.io link and WebAssembly module.",
    ),
    (
        "factory",
        "Factory",
        "Images, compositions (Server, COSMIC, Gaming), pacman catalogs and build catalogs.",
    ),
    (
        "ospackages",
        "OS packages",
        "Pacman packages and recipes of the Omarchy, CachyOS and ChimeraOS catalogs.",
    ),
    (
        "engines",
        "Engines",
        "Bun Engine cores, consoles and emulators.",
    ),
    (
        "games",
        "Games",
        "Game owners of the repository: launchers and status, private-aware.",
    ),
    (
        "tools",
        "Tools",
        "Scripts, command-line tools and installers.",
    ),
    (
        "infra",
        "Infrastructure",
        "Hosts, routes, services and release configuration.",
    ),
    (
        "releases",
        "Releases",
        "Published release manifests and the live downloads catalogue.",
    ),
    (
        "sources",
        "Sources",
        "Pinned upstream source owners (Git submodules).",
    ),
    (
        "workspace",
        "Workspace",
        "Every top-level entry of the repository.",
    ),
    (
        "collections",
        "Collections",
        "Cross-cutting groups: Android owners, Material 3, engines, compositions.",
    ),
];

pub fn kind_ids() -> impl Iterator<Item = &'static str> {
    KINDS.iter().map(|k| k.0)
}

/// Public browse URL of the repository tree.
pub const SOURCE_URL: &str = "https://github.com/aphrody-labs/bun-os/tree/main";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Link {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Surface {
    /// app, wasm, viewer, download, api or info.
    #[serde(rename = "type")]
    pub kind: String,
    pub page: String,
    pub api: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    /// One sentence: how this member is reachable.
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub desc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run: Option<String>,
    pub tags: Vec<String>,
    pub links: Vec<Link>,
    pub surface: Surface,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_doc: Option<bool>,
    #[serde(skip_serializing_if = "Map::is_empty", default)]
    pub meta: Map<String, Value>,
    // Detail-only fields (absent from the index and the kind lists).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl Default for Surface {
    fn default() -> Self {
        Surface {
            kind: "info".into(),
            page: String::new(),
            api: String::new(),
            module: None,
            reason: String::new(),
        }
    }
}

impl Member {
    /// The member without README, text, files, members and data, for the index and the kind lists.
    pub fn summary(&self) -> Member {
        let mut m = self.clone();
        if let Some(listed) = m.members.take() {
            m.meta.insert("members".into(), json!(listed.len()));
        }
        m.readme = None;
        m.text = None;
        m.lang = None;
        m.files = None;
        m.data = None;
        m
    }
    pub fn key(&self) -> String {
        format!("{}/{}", self.kind, self.id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub schema_version: u32,
    pub generated: String,
    pub commit: String,
    pub counts: BTreeMap<String, usize>,
    pub total: usize,
    pub members: Vec<Member>,
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// Fetch crates.io and npm version history through the cache file.
    pub versions: bool,
    /// Cache file of the version history (default `<root>/build/webos-versions.json`).
    pub versions_cache: Option<std::path::PathBuf>,
    /// Member id of a crate -> URL of its served WebAssembly module.
    pub wasm_modules: HashMap<String, String>,
}

fn surface(kind: &str, id: &str, ty: &str, reason: impl Into<String>) -> Surface {
    Surface {
        kind: ty.into(),
        page: format!("/inventory/{kind}/{id}"),
        api: format!("/api/inventory/{kind}/{id}"),
        module: None,
        reason: reason.into(),
    }
}

fn source_link(path: &str) -> Link {
    Link {
        label: "Source".into(),
        url: format!("{SOURCE_URL}/{path}"),
    }
}

fn tags(list: &[&str]) -> Vec<String> {
    list.iter()
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect()
}

const MAX_TEXT: usize = 64 * 1024;
const MAX_DOC: usize = 160 * 1024;

/// Description from the entry files of a directory (lib.rs, main.rs, index.ts, ...) or its first source file.
fn source_description(repo: &Repo, dir: &str, files: &[String]) -> String {
    const ENTRY: &[&str] = &[
        "src/lib.rs",
        "src/main.rs",
        "src/index.ts",
        "src/mod.ts",
        "src/main.ts",
        "index.ts",
        "mod.ts",
        "main.ts",
        "index.js",
        "build.ts",
        "index.mjs",
        "src/index.tsx",
        "lib.rs",
        "main.rs",
        "src/lib.ts",
    ];
    let rank = |f: &String| -> usize {
        let rel = f
            .strip_prefix(dir)
            .map(|r| r.trim_start_matches('/'))
            .unwrap_or(f);
        ENTRY
            .iter()
            .position(|e| *e == rel)
            .unwrap_or(100 + rel.matches('/').count())
    };
    let mut candidates: Vec<&String> = files
        .iter()
        .filter(|f| {
            let source = [
                ".rs", ".ts", ".tsx", ".js", ".mjs", ".py", ".sh", ".ps1", ".just",
            ]
            .iter()
            .any(|e| f.ends_with(e));
            let skip = f.ends_with(".test.ts")
                || f.ends_with(".spec.ts")
                || f.ends_with(".d.ts")
                || f.contains("node_modules")
                || f.contains("/test/")
                || f.contains("/tests/");
            source && !skip
        })
        .collect();
    candidates.sort_by(|a, b| rank(a).cmp(&rank(b)).then(a.cmp(b)));
    for file in candidates.into_iter().take(6) {
        if let Some(text) = repo.read_text(file, 6000) {
            let header = header_text(&text, 240);
            if header.len() >= 12 {
                return header;
            }
        }
    }
    String::new()
}

fn readme_of(repo: &Repo, dir: &str, files: &[String]) -> Option<String> {
    files
        .iter()
        .find(|f| {
            let rel = f
                .strip_prefix(dir)
                .map(|r| r.trim_start_matches('/'))
                .unwrap_or(f)
                .to_ascii_lowercase();
            matches!(
                rel.as_str(),
                "readme" | "readme.md" | "readme.mdx" | "readme.markdown" | "readme.txt"
            )
        })
        .and_then(|f| repo.read_text(f, MAX_DOC))
}

/// Generated fallback text that says nothing about the member.
pub fn is_placeholder(desc: &str) -> bool {
    desc.trim().is_empty()
        || desc.starts_with("Bun OS package at ")
        || desc.starts_with("Bun OS crate at ")
        || desc.ends_with(" app at .")
}

/// Well-known file names, whatever directory they sit in (their meaning is fixed by the tool that reads them).
fn file_description(name: &str) -> Option<&'static str> {
    Some(match name {
        "LICENSE" => "License text of this repository.",
        "LICENSE-APACHE" => "Apache-2.0 license text of this repository.",
        "bun.lock" => {
            "Bun lockfile pinning every JavaScript and TypeScript dependency of the root workspace."
        }
        "Cargo.lock" => "Cargo lockfile pinning every Rust dependency of the root workspace.",
        "Cargo.toml" => "Root Cargo manifest: workspace members, shared dependencies and lints.",
        "package.json" => "Root package manifest of the Bun workspace.",
        "bunfig.toml" => "Bun configuration of the workspace.",
        "tsconfig.json" => "TypeScript project configuration.",
        "tsconfig.base.json" => {
            "Shared TypeScript compiler options extended by the workspace projects."
        }
        "turbo.json" => "Task pipeline definition for the workspace build orchestration.",
        "clippy.toml" => "Clippy lint configuration of the Rust workspace.",
        "rustfmt.toml" => "rustfmt formatting rules of the Rust workspace.",
        "rust-toolchain.toml" => "Pinned Rust toolchain of the workspace.",
        "justfile" => "just recipes of the workspace.",
        _ => return None,
    })
}

/// Facts read from the member itself when nothing describes it: the sections of a JSON file, the exports of a module,
/// the entries of a directory, the length of a file.
fn factual_description(m: &Member) -> String {
    let name = m
        .path
        .as_deref()
        .unwrap_or(&m.id)
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();
    if let Some(d) = file_description(&name) {
        return d.into();
    }
    if let (Some(text), Some(path)) = (&m.text, &m.path) {
        if path.ends_with(".json") {
            let keys: Vec<&str> = text
                .lines()
                .filter_map(|l| l.strip_prefix("  \""))
                .filter_map(|l| l.split_once("\":").map(|(k, _)| k))
                .take(8)
                .collect();
            if !keys.is_empty() {
                return format!("JSON file {path} with the sections {}.", keys.join(", "));
            }
        }
        if [".ts", ".tsx", ".js", ".mjs"]
            .iter()
            .any(|e| path.ends_with(e))
        {
            let mut names: Vec<String> = Vec::new();
            for line in text.lines() {
                let Some(rest) = line.strip_prefix("export ") else {
                    continue;
                };
                let rest = rest.strip_prefix("async ").unwrap_or(rest);
                for kw in [
                    "function* ",
                    "function ",
                    "const ",
                    "class ",
                    "interface ",
                    "type ",
                    "enum ",
                ] {
                    if let Some(after) = rest.strip_prefix(kw) {
                        let ident: String = after
                            .chars()
                            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                            .collect();
                        if !ident.is_empty() && !names.contains(&ident) {
                            names.push(ident);
                        }
                        break;
                    }
                }
            }
            if !names.is_empty() {
                return format!(
                    "Module {name} exporting {}.",
                    names.into_iter().take(8).collect::<Vec<_>>().join(", ")
                );
            }
            return format!("Script {name} ({} lines).", text.lines().count());
        }
        return format!("File {name} ({} lines).", text.lines().count());
    }
    if let (Some(files), Some(path)) = (&m.files, &m.path) {
        let prefix = format!("{path}/");
        let mut names: Vec<&str> = Vec::new();
        for f in files {
            let first = f
                .strip_prefix(&prefix)
                .unwrap_or(f)
                .split('/')
                .next()
                .unwrap_or("");
            if !first.is_empty() && !names.contains(&first) {
                names.push(first);
            }
        }
        if !names.is_empty() {
            let more = if names.len() > 10 {
                format!(" and {} more", names.len() - 10)
            } else {
                String::new()
            };
            return format!(
                "Directory {path} containing {}{more}.",
                names
                    .iter()
                    .take(10)
                    .copied()
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }
    String::new()
}

const NATIVE_RUN: &[&str] = &["native", "cli", "server", "android"];

fn app_members(repo: &Repo, out: &mut Vec<Member>) {
    for child in repo.children("apps") {
        if !child.dir {
            continue;
        }
        let path = format!("apps/{}", child.name);
        let pkg = repo.read_json(&format!("{path}/package.json"));
        let cargo = repo.read_text(&format!("{path}/Cargo.toml"), 1 << 20);
        let mut desc = pkg
            .as_ref()
            .and_then(|p| p["description"].as_str())
            .unwrap_or("")
            .to_string();
        if desc.is_empty() {
            if let Some(c) = &cargo {
                desc = toml_desc(c);
            }
        }
        let id = child.name.clone();
        let run = if id.ends_with("-cli") {
            "cli"
        } else if id.ends_with("-server") {
            "server"
        } else if id.contains("android") {
            "android"
        } else if repo.has(&format!("{path}/index.html"))
            || repo.has(&format!("{path}/Trunk.toml"))
            || id.ends_with("-web")
        {
            "web"
        } else {
            "native"
        };
        let readme = readme_of(repo, &path, &child.files);
        if desc.is_empty() {
            desc = readme.as_deref().map(first_paragraph).unwrap_or_default();
        }
        if desc.is_empty() {
            desc = source_description(repo, &path, &child.files);
        }
        let download = NATIVE_RUN.contains(&run);
        let reason = if download {
            format!(
                "A {run} app: its page lists published builds from the downloads service, its README and source."
            )
        } else {
            "A web build: its page carries README, source and published builds.".to_string()
        };
        let mut meta = Map::new();
        meta.insert("files".into(), json!(child.files.len()));
        out.push(Member {
            kind: "apps".into(),
            id: id.clone(),
            name: id.clone(),
            desc,
            path: Some(path.clone()),
            version: pkg
                .as_ref()
                .and_then(|p| p["version"].as_str())
                .map(str::to_string),
            license: pkg
                .as_ref()
                .and_then(|p| p["license"].as_str())
                .map(str::to_string),
            run: Some(run.into()),
            tags: tags(&[run]),
            links: vec![
                source_link(&path),
                Link {
                    label: "Downloads".into(),
                    url: "/api/downloads".into(),
                },
            ],
            surface: surface(
                "apps",
                &id,
                if download { "download" } else { "viewer" },
                reason,
            ),
            has_doc: Some(readme.is_some()),
            meta,
            files: readme
                .is_none()
                .then(|| child.files.iter().take(200).cloned().collect()),
            readme,
            ..Default::default()
        });
    }
}

fn package_members(repo: &Repo, out: &mut Vec<Member>) {
    for child in repo.children("packages") {
        let path = format!("packages/{}", child.name);
        let pkg = repo.read_json(&format!("{path}/package.json"));
        let readme = readme_of(repo, &path, &child.files);
        let name = pkg
            .as_ref()
            .and_then(|p| p["name"].as_str())
            .unwrap_or(&child.name)
            .to_string();
        let publishable = pkg
            .as_ref()
            .is_some_and(|p| p["private"] != json!(true) && p["name"].is_string());
        let bin: Vec<String> = match pkg.as_ref().map(|p| &p["bin"]) {
            Some(Value::String(_)) => vec![name.clone()],
            Some(Value::Object(o)) => o.keys().cloned().collect(),
            _ => Vec::new(),
        };
        let mut desc = pkg
            .as_ref()
            .and_then(|p| p["description"].as_str())
            .unwrap_or("")
            .to_string();
        if desc.is_empty() {
            desc = readme.as_deref().map(first_paragraph).unwrap_or_default();
        }
        if desc.is_empty() {
            desc = source_description(repo, &path, &child.files);
        }
        let mut links = vec![source_link(&path)];
        if publishable {
            links.push(Link {
                label: "npm".into(),
                url: format!("https://www.npmjs.com/package/{name}"),
            });
        }
        let mut meta = Map::new();
        if publishable {
            meta.insert("npm".into(), json!(name));
        }
        meta.insert("bin".into(), json!(bin));
        meta.insert("files".into(), json!(child.files.len()));
        meta.insert(
            "dependencies".into(),
            json!(
                pkg.as_ref()
                    .and_then(|p| p["dependencies"].as_object())
                    .map_or(0, |d| d.len())
            ),
        );
        out.push(Member {
            kind: "packages".into(),
            id: child.name.clone(),
            name,
            desc,
            path: Some(path),
            version: pkg
                .as_ref()
                .and_then(|p| p["version"].as_str())
                .map(str::to_string),
            license: pkg
                .as_ref()
                .and_then(|p| p["license"].as_str())
                .map(str::to_string),
            run: Some(if bin.is_empty() { "library" } else { "cli" }.into()),
            tags: tags(&[
                if bin.is_empty() { "library" } else { "cli" },
                if publishable { "npm" } else { "unpublished" },
                if pkg.is_none() { "no-manifest" } else { "" },
            ]),
            links,
            surface: surface(
                "packages",
                &child.name,
                "viewer",
                "README, manifest, versions and links on its page.",
            ),
            has_doc: Some(readme.is_some()),
            meta,
            files: readme
                .is_none()
                .then(|| child.files.iter().take(200).cloned().collect()),
            readme,
            ..Default::default()
        });
    }
}

fn dep_summary(v: &toml::Value) -> String {
    match v {
        toml::Value::String(s) => s.clone(),
        toml::Value::Table(t) => {
            if let Some(toml::Value::String(s)) = t.get("version") {
                s.clone()
            } else if t.contains_key("path") {
                "path".into()
            } else if t.contains_key("workspace") {
                "workspace".into()
            } else {
                "git".into()
            }
        }
        _ => String::new(),
    }
}

fn crate_members(repo: &Repo, out: &mut Vec<Member>, wasm_modules: &HashMap<String, String>) {
    let root_manifest: toml::Table = repo
        .read_text("Cargo.toml", 4 << 20)
        .and_then(|t| t.parse().ok())
        .unwrap_or_default();
    let inherited = root_manifest
        .get("workspace")
        .and_then(|w| w.get("package"))
        .cloned()
        .unwrap_or(toml::Value::Table(Default::default()));
    for child in repo.children("crates") {
        let path = format!("crates/{}", child.name);
        let text = repo.read_text(&format!("{path}/Cargo.toml"), 1 << 20);
        let manifest: toml::Table = text
            .as_deref()
            .and_then(|t| t.parse().ok())
            .unwrap_or_default();
        let pk = manifest
            .get("package")
            .and_then(|p| p.as_table())
            .cloned()
            .unwrap_or_default();
        let pick = |key: &str| -> Option<String> {
            match pk.get(key) {
                Some(toml::Value::String(s)) => Some(s.clone()),
                Some(toml::Value::Table(t))
                    if t.get("workspace").and_then(|w| w.as_bool()) == Some(true) =>
                {
                    inherited
                        .get(key)
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                }
                _ => None,
            }
        };
        let name = pk
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or(&child.name)
            .to_string();
        let publish = !matches!(pk.get("publish"), Some(toml::Value::Boolean(false)))
            && !matches!(pk.get("publish"), Some(toml::Value::Array(a)) if a.is_empty())
            && text.is_some();
        let deps = manifest
            .get("dependencies")
            .and_then(|d| d.as_table())
            .cloned()
            .unwrap_or_default();
        let build_deps = manifest
            .get("build-dependencies")
            .and_then(|d| d.as_table())
            .cloned()
            .unwrap_or_default();
        let types: Vec<String> = manifest
            .get("lib")
            .and_then(|l| l.get("crate-type"))
            .and_then(|t| t.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let has_dep = |d: &str| deps.contains_key(d) || build_deps.contains_key(d);
        let wasm_target = manifest
            .get("target")
            .and_then(|t| t.as_table())
            .is_some_and(|t| t.keys().any(|k| k.contains("wasm32")));
        let capable = wasm_target
            || [
                "wasm-bindgen",
                "js-sys",
                "web-sys",
                "wasm-bindgen-futures",
                "gloo",
            ]
            .iter()
            .any(|d| has_dep(d))
            || child.name.split(['-', '_']).any(|p| p == "wasm");
        // A wasm-bindgen cdylib: the factory builds it into a WebAssembly module (aphrody-inventory wasm-build).
        let wasm = types.iter().any(|t| t == "cdylib") && has_dep("wasm-bindgen");
        let readme_file = pk
            .get("readme")
            .and_then(|r| r.as_str())
            .map(|r| format!("{path}/{r}"));
        let readme = match readme_file {
            Some(f) if repo.has(&f) => repo.read_text(&f, MAX_DOC),
            _ => readme_of(repo, &path, &child.files),
        };
        let module = wasm_modules.get(&child.name).cloned();
        let mut desc = pk
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or("")
            .to_string();
        if desc.is_empty() {
            desc = readme.as_deref().map(first_paragraph).unwrap_or_default();
        }
        if desc.is_empty() {
            desc = source_description(repo, &path, &child.files);
        }
        let mut links = vec![source_link(&path)];
        if publish {
            links.push(Link {
                label: "crates.io".into(),
                url: format!("https://crates.io/crates/{name}"),
            });
            links.push(Link {
                label: "docs.rs".into(),
                url: format!("https://docs.rs/{name}"),
            });
        }
        let mut s = if wasm {
            surface(
                "crates",
                &child.name,
                "wasm",
                if module.is_some() {
                    "Built into a WebAssembly module by the VPS factory and served by this deployment."
                } else {
                    "A wasm-bindgen crate: the factory builds it into a module; until that build succeeds its page shows metadata, README and the API."
                },
            )
        } else {
            surface(
                "crates",
                &child.name,
                "api",
                format!(
                    "{}: metadata, dependencies, README and versions on its page, /api/inventory/crates/<id> and the /api/rpc methods.",
                    if capable {
                        "A library that compiles for WebAssembly but exports no module of its own"
                    } else {
                        "Native crate reachable through the API"
                    }
                ),
            )
        };
        s.module = module.clone();
        let mut meta = Map::new();
        meta.insert("crateName".into(), json!(name));
        meta.insert("publish".into(), json!(publish));
        meta.insert("crateType".into(), json!(types));
        meta.insert("wasm".into(), json!(wasm));
        meta.insert("wasmCapable".into(), json!(capable));
        meta.insert("wasmModule".into(), json!(module.is_some()));
        if let Some(e) = pick("edition") {
            meta.insert("edition".into(), json!(e));
        }
        meta.insert("dependencies".into(), json!(deps.len()));
        meta.insert("files".into(), json!(child.files.len()));
        let features: Vec<&String> = manifest
            .get("features")
            .and_then(|f| f.as_table())
            .map(|f| f.keys().collect())
            .unwrap_or_default();
        let bins: Vec<&str> = manifest
            .get("bin")
            .and_then(|b| b.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|b| b.get("name").and_then(|n| n.as_str()))
                    .collect()
            })
            .unwrap_or_default();
        let data = json!({
            "dependencies": deps.iter().map(|(k, v)| (k.clone(), json!(dep_summary(v)))).collect::<Map<String, Value>>(),
            "features": features,
            "bins": bins,
            "libCrateTypes": types,
        });
        let tag_wasm = if wasm {
            "wasm"
        } else if capable {
            "wasm-capable"
        } else {
            "native"
        };
        out.push(Member {
            kind: "crates".into(),
            id: child.name.clone(),
            name,
            desc,
            path: Some(path),
            version: pick("version"),
            license: pick("license").or_else(|| {
                pk.get("license-file")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            }),
            run: Some(if wasm { "wasm" } else { "library" }.into()),
            tags: tags(&[
                tag_wasm,
                if publish { "crates.io" } else { "unpublished" },
                if text.is_none() { "no-manifest" } else { "" },
            ]),
            links,
            surface: s,
            has_doc: Some(readme.is_some()),
            meta,
            files: readme
                .is_none()
                .then(|| child.files.iter().take(200).cloned().collect()),
            readme,
            data: Some(data),
            ..Default::default()
        });
    }
}

/// One directory or file member of a generic listing (factory, tools, infra, releases, workspace, engine cores).
fn entry_member(
    repo: &Repo,
    kind: &str,
    prefix: &str,
    dir: &str,
    entry: &Entry,
    extra: &[&str],
) -> Member {
    let path = if dir.is_empty() {
        entry.name.clone()
    } else {
        format!("{dir}/{}", entry.name)
    };
    let id = format!("{prefix}{}", entry.name);
    let mut desc = String::new();
    let mut readme = None;
    let mut text = None;
    let mut lang = None;
    let mut version = None;
    let mut license = None;
    let mut files = None;
    if entry.dir {
        readme = readme_of(repo, &path, &entry.files);
        let pkg = repo.read_json(&format!("{path}/package.json"));
        desc = pkg
            .as_ref()
            .and_then(|p| p["description"].as_str())
            .unwrap_or("")
            .to_string();
        if desc.is_empty() {
            desc = readme.as_deref().map(first_paragraph).unwrap_or_default();
        }
        version = pkg
            .as_ref()
            .and_then(|p| p["version"].as_str())
            .map(str::to_string);
        license = pkg
            .as_ref()
            .and_then(|p| p["license"].as_str())
            .map(str::to_string);
        if desc.is_empty() {
            desc = source_description(repo, &path, &entry.files);
        }
        if readme.is_none() {
            files = Some(entry.files.iter().take(400).cloned().collect::<Vec<_>>());
        }
    } else if text::is_text_name(&entry.name) {
        let ext = entry
            .name
            .rsplit_once('.')
            .map(|(_, e)| e.to_ascii_lowercase())
            .unwrap_or_default();
        if let Some(t) = repo.read_text(&path, MAX_TEXT) {
            if ext == "md" || ext == "mdx" {
                desc = first_paragraph(&t);
                readme = Some(t);
            } else {
                if ext == "json" {
                    if let Ok(j) = serde_json::from_str::<Value>(&t) {
                        desc = j["description"]
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_default();
                        if desc.is_empty() {
                            desc = j["$comment"]
                                .as_str()
                                .map(|c| c.chars().take(240).collect())
                                .unwrap_or_default();
                        }
                        if desc.is_empty() {
                            if let Some(k) = j["kind"].as_str() {
                                desc = match j["schemaVersion"].as_u64() {
                                    Some(v) => format!("{k} (schema {v})"),
                                    None => k.to_string(),
                                };
                            }
                        }
                    }
                } else {
                    desc = header_text(&t, 240);
                }
                lang = Some(if ext.is_empty() {
                    "text".to_string()
                } else {
                    ext
                });
                text = Some(t);
            }
        }
    }
    let mut meta = Map::new();
    meta.insert("files".into(), json!(entry.files.len()));
    let mut t = vec![if entry.dir { "directory" } else { "file" }];
    t.extend_from_slice(extra);
    Member {
        kind: kind.into(),
        id: id.clone(),
        name: entry.name.clone(),
        desc,
        path: Some(path.clone()),
        version,
        license,
        run: Some("data".into()),
        tags: tags(&t),
        links: vec![source_link(&path)],
        surface: surface(
            kind,
            &id,
            if kind == "releases" {
                "download"
            } else {
                "viewer"
            },
            if entry.dir {
                "Directory page: README, file listing and source link."
            } else {
                "File page: content, source link and the JSON record through the API."
            },
        ),
        has_doc: Some(readme.is_some()),
        meta,
        readme,
        text,
        lang,
        files,
        ..Default::default()
    }
}

fn directory_kind(
    repo: &Repo,
    out: &mut Vec<Member>,
    kind: &str,
    specs: &[(&str, &str)],
    extra: &[&str],
) {
    for (dir, prefix) in specs {
        for entry in repo.children(dir) {
            if kind == "workspace" && entry.name == "node_modules" {
                continue;
            }
            out.push(entry_member(repo, kind, prefix, dir, &entry, extra));
        }
    }
}

fn data_member(
    kind: &str,
    id: String,
    name: String,
    desc: String,
    path: &str,
    tag: &[&str],
    ty: &str,
    reason: &str,
    data: Value,
) -> Member {
    Member {
        kind: kind.into(),
        surface: surface(kind, &id, ty, reason),
        id,
        name,
        desc,
        path: Some(path.into()),
        run: Some("data".into()),
        tags: tags(tag),
        links: vec![source_link(path)],
        data: Some(data),
        ..Default::default()
    }
}

fn composition_members(repo: &Repo, out: &mut Vec<Member>) {
    if let Some(d) = repo.read_json("distribution.json") {
        if let Some(profiles) = d["profiles"].as_object() {
            for (id, p) in profiles {
                let desc = p["description"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        format!("Bun OS distribution profile {id} of distribution.json.")
                    });
                out.push(data_member(
                    "factory",
                    format!("composition/{id}"),
                    format!("Composition {id}"),
                    desc,
                    "distribution.json",
                    &["composition"],
                    "viewer",
                    "Distribution profile page with its declared components.",
                    p.clone(),
                ));
            }
        }
    }
    if let Some(m) = repo.read_json("factory/images/manifest.json") {
        if let Some(images) = m["images"].as_object() {
            for (id, image) in images {
                let desc = image["description"]
                    .as_str()
                    .or(image["purpose"].as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        format!("Bun OS image {id} of factory/images/manifest.json.")
                    });
                out.push(data_member(
                    "factory",
                    format!("image/{id}"),
                    format!("Image {id}"),
                    desc,
                    "factory/images/manifest.json",
                    &["image"],
                    "viewer",
                    "Image page: manifest entry, build recipe and downloads.",
                    image.clone(),
                ));
            }
        }
    }
}

fn os_package_members(repo: &Repo, out: &mut Vec<Member>) {
    let mut seen = BTreeSet::new();
    let mut add = |catalog: &str, name: &str, list: &str, data: Value, desc: String| {
        let id = format!("{catalog}/{name}");
        if name.is_empty() || !seen.insert(id.clone()) {
            return;
        }
        let path = format!("factory/arch/{catalog}");
        out.push(Member {
            kind: "ospackages".into(),
            surface: surface(
                "ospackages",
                &id,
                "info",
                "Package page: catalog, list and upstream search link.",
            ),
            id,
            name: name.into(),
            desc,
            path: Some(path.clone()),
            run: Some("data".into()),
            tags: tags(&[catalog, list]),
            links: vec![
                Link {
                    label: "Arch package search".into(),
                    url: format!("https://archlinux.org/packages/?q={name}"),
                },
                source_link(&path),
            ],
            data: Some(data),
            ..Default::default()
        });
    };
    if let Some(o) = repo.read_json("factory/arch/omarchy/packages.json") {
        for list in o["lists"].as_array().into_iter().flatten() {
            let lid = list["id"].as_str().unwrap_or("");
            for p in list["packages"].as_array().into_iter().flatten() {
                if let Some(p) = p.as_str() {
                    add(
                        "omarchy",
                        p,
                        lid,
                        json!({ "list": lid, "source": list["source"] }),
                        format!("Pacman package of the Omarchy list {lid}."),
                    );
                }
            }
        }
    }
    if let Some(c) = repo.read_json("factory/arch/chimeraos/catalog.json") {
        for key in [
            "packages",
            "buildPackages",
            "installerPackages",
            "installerBuildPackages",
            "bootstrapPackages",
        ] {
            for p in c[key].as_array().into_iter().flatten() {
                if let Some(p) = p.as_str() {
                    add(
                        "chimeraos",
                        p,
                        key,
                        json!({ "list": key }),
                        format!("Pacman package of the ChimeraOS {key} list."),
                    );
                }
            }
        }
        for p in c["aurPackages"]
            .as_array()
            .into_iter()
            .flatten()
            .chain(c["localPackages"].as_array().into_iter().flatten())
        {
            let name = p["name"].as_str().unwrap_or("");
            let aur = p["repository"].is_string();
            let version = p["version"]
                .as_str()
                .map(|v| format!(" {v}"))
                .unwrap_or_default();
            add(
                "chimeraos",
                name,
                if aur { "aur" } else { "local" },
                p.clone(),
                format!(
                    "ChimeraOS {} package{version}.",
                    if aur { "AUR" } else { "local" }
                ),
            );
        }
    }
    if let Some(c) = repo.read_json("factory/arch/cachyos/catalog.json") {
        for catalog in c["catalogs"].as_array().into_iter().flatten() {
            let cid = catalog["id"].as_str().unwrap_or("");
            let repository = catalog["repository"].as_str().unwrap_or("");
            for r in catalog["recipes"].as_array().into_iter().flatten() {
                let name = r["recipe"]
                    .as_str()
                    .unwrap_or("")
                    .trim_end_matches("/PKGBUILD");
                if !name.is_empty() {
                    add(
                        "cachyos",
                        &format!("{cid}/{name}"),
                        cid,
                        r.clone(),
                        format!("CachyOS PKGBUILD recipe {name} of {repository}."),
                    );
                }
            }
        }
    }
}

fn engine_members(repo: &Repo, out: &mut Vec<Member>) {
    if let Some(c) = repo.read_json("scripts/emulation/consoles.json") {
        for console in c["consoles"].as_array().into_iter().flatten() {
            let id = console["id"].as_str().unwrap_or("");
            if id.is_empty() {
                continue;
            }
            let s = |k: &str| console[k].as_str().unwrap_or("").to_string();
            out.push(data_member(
                "engines",
                format!("console/{id}"),
                s("name"),
                format!(
                    "{} via {} (route {}, needs {}).",
                    s("name"),
                    s("core"),
                    s("route"),
                    s("needs")
                ),
                "scripts/emulation/consoles.json",
                &["console", console["route"].as_str().unwrap_or("")],
                "info",
                "Status page: core, route, required content and qualification state.",
                console.clone(),
            ));
        }
    }
    for entry in repo.children("packages/bun-engine/src") {
        out.push(entry_member(
            repo,
            "engines",
            "core/",
            "packages/bun-engine/src",
            &entry,
            &["core"],
        ));
    }
    for entry in repo.children("packages/bun-engine/web-emulation") {
        out.push(entry_member(
            repo,
            "engines",
            "web/",
            "packages/bun-engine/web-emulation",
            &entry,
            &["web-emulation"],
        ));
    }
}

fn game_members(out: &mut Vec<Member>) {
    struct Owner {
        id: &'static str,
        name: &'static str,
        desc: &'static str,
        tags: &'static [&'static str],
        test: fn(&Member) -> bool,
    }
    let owners = [
        Owner {
            id: "ievr",
            name: "Inazuma Eleven: Victory Road (IEVR)",
            desc: "IEVR tooling: the IECODE web, .NET and C++ owners, the ieverse and inagle libraries and the aphrody-nie engine crates. The game is read from your own install; no game files are hosted.",
            tags: &["launcher", "level5"],
            test: |m| {
                [
                    "iecode-web",
                    "iecode-dotnet",
                    "iecode-cpp",
                    "iecode-homebrew",
                    "iecode-scripts",
                    "ieverse",
                    "inagle",
                    "aphrody-nie-",
                ]
                .iter()
                .any(|p| m.id.starts_with(p))
                    && m.kind != "ospackages"
            },
        },
        Owner {
            id: "dbxv2",
            name: "Dragon Ball Xenoverse 2 (DBXV2)",
            desc: "DBXV2 tooling: the unified streamed asset layer and the reverse engineering crates shared with IEVR. Private owner material: only the owners are listed, no game content or corpus is published.",
            tags: &["launcher", "private"],
            test: |m| {
                m.kind == "crates"
                    && (m.id == "re" || m.id == "aphrody-re" || m.id.starts_with("re-"))
            },
        },
        Owner {
            id: "ctr",
            name: "Nintendo 3DS (ctr)",
            desc: "The aphrody-ctr 3DS emulator crates and their desktop host.",
            tags: &["emulator"],
            test: |m| m.kind == "crates" && m.id.starts_with("aphrody-ctr"),
        },
        Owner {
            id: "nds",
            name: "Nintendo DS (Dust)",
            desc: "The Dust Nintendo DS emulator crates of Bun Engine and the NDS SDK.",
            tags: &["emulator"],
            test: |m| {
                m.kind == "crates"
                    && (m.id.starts_with("aphrody-dust") || m.id.starts_with("aphrody-nds"))
            },
        },
        Owner {
            id: "steam",
            name: "Steam and game streaming",
            desc: "Steam client integration and game streaming owners: bun-steam, bun-gamestream and the emulator host.",
            tags: &["launcher", "steam"],
            test: |m| {
                m.kind == "packages"
                    && ["bun-steam", "bun-gamestream", "bun-emu-host"].contains(&m.id.as_str())
            },
        },
        Owner {
            id: "nie-play",
            name: "NIE play",
            desc: "The aphrody-nie game and play crates: the Inazuma Eleven engine runtime and match simulation.",
            tags: &["engine"],
            test: |m| {
                m.kind == "crates"
                    && [
                        "aphrody-nie-game",
                        "aphrody-nie-play",
                        "aphrody-nie-runtime",
                    ]
                    .iter()
                    .any(|p| m.id.starts_with(p))
            },
        },
    ];
    let mut games = Vec::new();
    for o in owners {
        let members: Vec<String> = out
            .iter()
            .filter(|m| m.kind != "games" && m.kind != "collections" && (o.test)(m))
            .map(Member::key)
            .collect();
        let private = o.tags.contains(&"private");
        let mut meta = Map::new();
        meta.insert("owners".into(), json!(members.len()));
        let mut t = vec!["game"];
        t.extend_from_slice(o.tags);
        games.push(Member {
            kind: "games".into(),
            id: o.id.into(),
            name: o.name.into(),
            desc: o.desc.into(),
            run: Some("data".into()),
            tags: tags(&t),
            surface: surface(
                "games",
                o.id,
                "info",
                if private {
                    "Private-aware info page: owners and status only, no game content."
                } else {
                    "Launcher page: owners, status and how to run it from your own install."
                },
            ),
            members: Some(members),
            meta,
            ..Default::default()
        });
    }
    out.extend(games);
}

fn source_members(repo: &Repo, out: &mut Vec<Member>) {
    let modules = repo.read_text(".gitmodules", 2 << 20).unwrap_or_default();
    let locks = repo.read_json("sources.lock.json");
    let revisions: HashMap<String, String> = locks
        .as_ref()
        .and_then(|l| l["repositories"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|r| {
            Some((
                r["mount"].as_str()?.to_string(),
                r["revision"].as_str()?.to_string(),
            ))
        })
        .collect();
    for block in modules.split("[submodule ").skip(1) {
        let field = |k: &str| {
            block.lines().find_map(|l| {
                let (key, value) = l.split_once('=')?;
                (key.trim() == k).then(|| value.trim().to_string())
            })
        };
        let (Some(path), Some(url)) = (field("path"), field("url")) else {
            continue;
        };
        if path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
        {
            continue;
        }
        let repository = url.trim_end_matches(".git").to_string();
        let mut meta = Map::new();
        meta.insert("url".into(), json!(url));
        if let Some(r) = revisions.get(&path) {
            meta.insert("revision".into(), json!(r));
        }
        let on_demand = field("update").as_deref() == Some("none");
        out.push(Member {
            kind: "sources".into(),
            surface: surface(
                "sources",
                &path,
                "info",
                "Source page: upstream repository, pinned revision, checkout policy and links.",
            ),
            id: path.clone(),
            name: path.rsplit('/').next().unwrap_or(&path).to_string(),
            desc: format!(
                "Pinned upstream source {} mounted at {path}.",
                repository.trim_start_matches("https://github.com/")
            ),
            path: Some(path.clone()),
            run: Some("data".into()),
            tags: tags(&["submodule", if on_demand { "on-demand" } else { "" }]),
            links: vec![
                Link {
                    label: "Repository".into(),
                    url: repository,
                },
                source_link(&path),
            ],
            meta,
            ..Default::default()
        });
    }
    if let Some(ws) = repo.read_json("infra/source-workspace.json") {
        for c in ws["components"].as_array().into_iter().flatten() {
            let cid = c["id"].as_str().unwrap_or("");
            let checkout = c["checkout"]
                .as_str()
                .filter(|c| *c != "." && !c.is_empty());
            let id = checkout
                .map(str::to_string)
                .unwrap_or_else(|| format!("component/{cid}"));
            if cid.is_empty() || out.iter().any(|m| m.kind == "sources" && m.id == id) {
                continue;
            }
            let repository = c["repository"].as_str();
            let mut meta = Map::new();
            if let Some(r) = c["integratedRevision"].as_str() {
                meta.insert("revision".into(), json!(r));
            }
            out.push(Member {
                kind: "sources".into(),
                surface: surface(
                    "sources",
                    &id,
                    "info",
                    "Source page: owner, integration state and pinned revision.",
                ),
                id,
                name: cid.into(),
                desc: format!(
                    "{}: {}.",
                    repository.unwrap_or(cid),
                    c["owner"]
                        .as_str()
                        .or(c["integration"].as_str())
                        .unwrap_or("source owner")
                ),
                path: checkout.map(str::to_string),
                run: Some("data".into()),
                tags: tags(&[c["integration"].as_str().unwrap_or("component")]),
                links: repository
                    .map(|r| {
                        vec![Link {
                            label: "Repository".into(),
                            url: format!("https://github.com/{r}"),
                        }]
                    })
                    .unwrap_or_default(),
                meta,
                data: Some(c.clone()),
                ..Default::default()
            });
        }
    }
}

fn release_members(repo: &Repo, out: &mut Vec<Member>) {
    out.push(Member {
        kind: "releases".into(),
        id: "downloads".into(),
        name: "Downloads catalogue".into(),
        desc: "Live release catalogue of the downloads service: every published native build with size and SHA-256.".into(),
        run: Some("data".into()),
        tags: tags(&["live"]),
        links: vec![Link { label: "Catalogue (JSON)".into(), url: "/api/downloads".into() }],
        surface: surface("releases", "downloads", "download", "The page lists the live downloads catalogue."),
        ..Default::default()
    });
    for entry in repo.children("infra/releases") {
        out.push(entry_member(
            repo,
            "releases",
            "manifest/",
            "infra/releases",
            &entry,
            &["manifest"],
        ));
    }
}

fn collection_members(out: &mut Vec<Member>) {
    let by = |out: &[Member], kind: &str, test: &dyn Fn(&Member) -> bool| -> Vec<String> {
        out.iter()
            .filter(|m| m.kind == kind && test(m))
            .map(Member::key)
            .collect()
    };
    const ANDROID: &[&str] = &[
        "apps/bun-android",
        "apps/java-ffi",
        "crates/android-native",
        "packages/bun-android",
        "packages/android-pipeline",
        "packages/android-web",
    ];
    let groups: Vec<(&str, &str, &str, Vec<String>)> = vec![
        (
            "android",
            "Android",
            "Android owners: apps/bun-android, apps/java-ffi, crates/android-native, packages/bun-android, packages/android-pipeline and packages/android-web, with AOSP and Waydroid.",
            [
                out.iter()
                    .filter(|m| m.path.as_deref().is_some_and(|p| ANDROID.contains(&p)))
                    .map(Member::key)
                    .collect::<Vec<_>>(),
                by(out, "packages", &|m| {
                    m.id.contains("waydroid") || m.id.contains("android")
                }),
                by(out, "factory", &|m| {
                    m.id.contains("aosp") || m.id.contains("google")
                }),
            ]
            .concat(),
        ),
        (
            "material-3",
            "Material 3",
            "The Material 3 design system: tokens, components, icons and themes.",
            [
                by(out, "packages", &|m| {
                    m.id.split('-').any(|p| p == "m3")
                        || m.id.starts_with("libm3")
                        || m.id.contains("material")
                        || m.id == "themes"
                }),
                by(out, "apps", &|m| m.id.contains("m3")),
                by(out, "workspace", &|m| m.id == "design-system"),
            ]
            .concat(),
        ),
        (
            "engines",
            "Engines and emulators",
            "Bun Engine cores, consoles, emulator hosts, game streaming and loaders.",
            [
                by(out, "engines", &|_| true),
                by(out, "games", &|_| true),
                by(out, "packages", &|m| {
                    [
                        "bun-engine",
                        "bun-emu-host",
                        "bun-gamestream",
                        "bun-loaders",
                        "bun-steam",
                    ]
                    .contains(&m.id.as_str())
                }),
            ]
            .concat(),
        ),
        (
            "compositions",
            "Compositions: Server, COSMIC Desktop, Gaming",
            "The separate distribution compositions and the images and catalogs they are assembled from.",
            by(out, "factory", &|m| {
                m.id.starts_with("composition/")
                    || m.id.starts_with("image/")
                    || [
                        "gaming", "omarchy", "hyprland", "alpine", "ubuntu", "disk", "desktop",
                        "distro",
                    ]
                    .iter()
                    .any(|k| m.id.contains(k))
            }),
        ),
        (
            "craft",
            "Craft apps",
            "The Craft creative suite: every craft app, library, CLI and web build.",
            [
                by(out, "apps", &|m| m.id.contains("craft")),
                by(out, "packages", &|m| m.id.contains("craft")),
                by(out, "crates", &|m| m.id.contains("craft")),
            ]
            .concat(),
        ),
    ];
    for (id, title, desc, members) in groups {
        let mut unique: Vec<String> = Vec::new();
        for m in members {
            if !unique.contains(&m) {
                unique.push(m);
            }
        }
        let mut meta = Map::new();
        meta.insert("members".into(), json!(unique.len()));
        out.push(Member {
            kind: "collections".into(),
            id: id.into(),
            name: title.into(),
            desc: desc.into(),
            run: Some("data".into()),
            tags: tags(&["collection"]),
            surface: surface(
                "collections",
                id,
                "viewer",
                "Collection page listing every member with its surface.",
            ),
            members: Some(unique),
            meta,
            ..Default::default()
        });
    }
}

/// Private owner material (DBXV2, iecode-docs) is listed for completeness but its content never leaves the repository.
fn is_private(m: &Member) -> bool {
    let hay = format!("{} {}", m.path.as_deref().unwrap_or(""), m.id).to_ascii_lowercase();
    hay.contains("dbxv2")
        || m.path
            .as_deref()
            .is_some_and(|p| p == "packages/iecode-docs" || p.starts_with("packages/iecode-docs/"))
}

fn privatize(m: &mut Member) {
    if m.kind == "games" || m.kind == "collections" || !is_private(m) {
        return;
    }
    m.desc = format!(
        "Private owner material ({}): listed for completeness, content is not published.",
        m.kind
    );
    m.readme = None;
    m.text = None;
    m.files = None;
    m.data = None;
    m.lang = None;
    m.has_doc = Some(false);
    m.links.clear();
    m.meta.clear();
    if !m.tags.iter().any(|t| t == "private") {
        m.tags.push("private".into());
    }
    m.surface = surface(
        &m.kind,
        &m.id,
        "info",
        "Private owner material: the member is listed, its content is not published.",
    );
}

/// Read every member of the checkout at `root`.
pub fn generate(root: &Path, options: &Options) -> std::io::Result<Inventory> {
    let repo = Repo::open(root)?;
    let mut members = Vec::new();
    app_members(&repo, &mut members);
    package_members(&repo, &mut members);
    crate_members(&repo, &mut members, &options.wasm_modules);
    directory_kind(
        &repo,
        &mut members,
        "factory",
        &[("factory", "")],
        &["factory"],
    );
    composition_members(&repo, &mut members);
    os_package_members(&repo, &mut members);
    engine_members(&repo, &mut members);
    game_members(&mut members);
    directory_kind(
        &repo,
        &mut members,
        "tools",
        &[
            ("scripts", "scripts/"),
            ("tools/aphrody", "tools/"),
            ("bin", "bin/"),
            ("install", "install/"),
        ],
        &[],
    );
    directory_kind(
        &repo,
        &mut members,
        "infra",
        &[
            ("infra", ""),
            ("infra/config", "config/"),
            ("infra/config/host", "host/"),
        ],
        &[],
    );
    release_members(&repo, &mut members);
    source_members(&repo, &mut members);
    directory_kind(&repo, &mut members, "workspace", &[("", "")], &[]);
    collection_members(&mut members);
    if options.versions {
        let cache = options
            .versions_cache
            .clone()
            .unwrap_or_else(|| root.join("build/webos-versions.json"));
        let stats = versions::attach(&mut members, &cache);
        eprintln!(
            "versions: {} lookups, {} fetched, {} cached",
            stats.jobs, stats.fetched, stats.cached
        );
    }
    for m in &mut members {
        privatize(m);
        if is_placeholder(&m.desc) {
            let fact = factual_description(m);
            if !fact.is_empty() {
                m.desc = fact;
            }
        }
    }
    let mut counts = BTreeMap::new();
    for kind in kind_ids() {
        counts.insert(
            kind.to_string(),
            members.iter().filter(|m| m.kind == kind).count(),
        );
    }
    Ok(Inventory {
        schema_version: 1,
        generated: text::now_rfc3339(),
        commit: std::env::var("WEBOS_COMMIT")
            .ok()
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| repo.head()),
        total: members.len(),
        counts,
        members,
    })
}

/// A member id is a URL path and a file name of the release: no backslash, colon, NUL, ?, #, % or dot segments.
pub fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && !id.split('/').any(|p| {
            p.is_empty() || p == "." || p == ".." || p.contains(['\\', ':', '\0', '?', '#', '%'])
        })
}

/// The coverage gate. Errors: a member without a surface or description, an unsafe or duplicate id, a tracked
/// directory missing from the inventory, an empty kind; with `dist`, a missing JSON record or WebAssembly module.
pub fn check(root: &Path, inv: &Inventory, dist: Option<&Path>) -> std::io::Result<Vec<String>> {
    let repo = Repo::open(root)?;
    let mut errors = Vec::new();
    let mut seen = BTreeSet::new();
    let kinds: BTreeSet<&str> = kind_ids().collect();
    for m in &inv.members {
        let key = m.key();
        if !kinds.contains(m.kind.as_str()) {
            errors.push(format!("{key}: unknown kind"));
        }
        if !safe_id(&m.id) {
            errors.push(format!("{key}: id is not a safe path"));
        }
        if !seen.insert(key.clone()) {
            errors.push(format!("{key}: duplicate member"));
        }
        let s = &m.surface;
        if s.kind.is_empty()
            || s.reason.is_empty()
            || s.page != format!("/inventory/{key}")
            || s.api != format!("/api/inventory/{key}")
        {
            errors.push(format!(
                "{key}: no surface (type, page, api and reason matching the member)"
            ));
        }
        if is_placeholder(&m.desc) {
            errors.push(format!("{key}: no description (add a manifest description, a README or a header comment to the member)"));
        }
    }
    for (kind, dir) in [
        ("apps", "apps"),
        ("packages", "packages"),
        ("crates", "crates"),
    ] {
        for child in repo.children(dir) {
            if child.dir && !seen.contains(&format!("{kind}/{}", child.name)) {
                errors.push(format!(
                    "{dir}/{}: tracked member is missing from the inventory",
                    child.name
                ));
            }
        }
    }
    for child in repo.children("") {
        if child.name != "node_modules" && !seen.contains(&format!("workspace/{}", child.name)) {
            errors.push(format!(
                "{}: root entry is missing from the inventory",
                child.name
            ));
        }
    }
    for child in repo.children("factory") {
        if !seen.contains(&format!("factory/{}", child.name)) {
            errors.push(format!(
                "factory/{}: missing from the inventory",
                child.name
            ));
        }
    }
    for kind in kind_ids() {
        if inv.counts.get(kind).copied().unwrap_or(0) == 0 {
            errors.push(format!("{kind}: kind has no members"));
        }
    }
    if let Some(dist) = dist {
        if !dist.join("inventory.json").is_file() {
            errors.push("inventory.json: not written".into());
        }
        let missing: Vec<String> = inv
            .members
            .iter()
            .filter(|m| !dist.join(&m.kind).join(format!("{}.json", m.id)).is_file())
            .map(Member::key)
            .collect();
        if !missing.is_empty() {
            errors.push(format!(
                "{} members have no JSON record, first {}",
                missing.len(),
                missing
                    .iter()
                    .take(5)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    Ok(errors)
}

/// One line of counts per kind and the total.
pub fn counts_line(inv: &Inventory) -> String {
    let mut parts: Vec<String> = inv.counts.iter().map(|(k, v)| format!("{k} {v}")).collect();
    parts.push(format!("total {}", inv.total));
    parts.join(", ")
}

/// Write `inventory.json` (index with counts and kinds), `<kind>.json` and `<kind>/<id>.json` under `dir`.
pub fn write(dir: &Path, inv: &Inventory) -> std::io::Result<()> {
    use std::fs;
    fs::create_dir_all(dir)?;
    let light: Vec<Member> = inv.members.iter().map(Member::summary).collect();
    let kinds: Vec<Value> = KINDS
        .iter()
        .map(|(id, label, desc)| json!({ "id": id, "label": label, "desc": desc }))
        .collect();
    let index = json!({
        "schemaVersion": inv.schema_version,
        "generated": inv.generated,
        "commit": inv.commit,
        "counts": inv.counts,
        "total": inv.total,
        "kinds": kinds,
        "members": light,
    });
    fs::write(dir.join("inventory.json"), serde_json::to_vec(&index)?)?;
    for (id, label, desc) in KINDS {
        let list: Vec<&Member> = light.iter().filter(|m| m.kind == *id).collect();
        let body = json!({ "kind": id, "label": label, "desc": desc, "count": list.len(), "members": list });
        fs::write(dir.join(format!("{id}.json")), serde_json::to_vec(&body)?)?;
    }
    for m in &inv.members {
        let file = dir.join(&m.kind).join(format!("{}.json", m.id));
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(file, serde_json::to_vec(m)?)?;
    }
    Ok(())
}
