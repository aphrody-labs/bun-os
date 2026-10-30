// SPDX-License-Identifier: Apache-2.0
//! The inventory routes merged at the root of `crates/aphrody-webos-server`:
//!
//! - `GET /api/inventory` (index and counts), `/api/inventory/<kind>`, `/api/inventory/<kind>/<id>`
//! - the kind aliases `/api/<kind>[/<id>]` (apps, packages, crates, factory, ospackages, engines, games, tools, infra,
//!   releases, sources, workspace, collections)
//! - `GET|POST /api/rpc`: JSON-RPC 2.0 (inventory.counts, inventory.list, inventory.search, inventory.get,
//!   crate.dependencies, crate.features, wasm.modules)
//! - `GET /wasm/modules/<id>/<file>`: the WebAssembly modules built by `aphrody-inventory wasm-build`
//!
//! Health is the server's: it includes [`health`] in `/api/health`.

use crate::{KINDS, safe_id};
use axum::body::{Body, Bytes};
use axum::extract::{Path as UrlPath, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

struct Inner {
    dir: PathBuf,
    wasm_dir: Option<PathBuf>,
    index: Value,
}

/// The generated inventory directory (written by `aphrody-inventory write`), its index held in memory.
#[derive(Clone)]
pub struct InventoryState {
    inner: Arc<Inner>,
}

impl InventoryState {
    /// Open `dir` (holding `inventory.json`); `wasm_dir` holds the staged modules (`<id>/<file>.wasm`).
    pub fn open(dir: impl Into<PathBuf>, wasm_dir: Option<PathBuf>) -> std::io::Result<InventoryState> {
        let dir = dir.into();
        let index: Value = serde_json::from_slice(&std::fs::read(dir.join("inventory.json"))?).map_err(std::io::Error::other)?;
        Ok(InventoryState { inner: Arc::new(Inner { dir, wasm_dir, index }) })
    }

    /// `WEBOS_INVENTORY_DIR` (default `inventory`, relative to the working directory, the release root) and
    /// `WEBOS_WASM_DIR` (default `<inventory dir>/../wasm/modules` when it exists).
    pub fn from_env() -> std::io::Result<InventoryState> {
        let dir = std::env::var_os("WEBOS_INVENTORY_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("inventory"));
        let wasm = std::env::var_os("WEBOS_WASM_DIR").map(PathBuf::from).or_else(|| {
            let guess = dir.join("../wasm/modules");
            guess.is_dir().then_some(guess)
        });
        InventoryState::open(dir, wasm)
    }

    fn members(&self) -> &[Value] {
        self.inner.index["members"].as_array().map(Vec::as_slice).unwrap_or(&[])
    }
}

/// Inventory part of `/api/health`.
#[derive(Debug, Clone, Serialize)]
pub struct InventoryHealth {
    pub ok: bool,
    pub total: u64,
    pub commit: String,
    pub generated: String,
    pub counts: BTreeMap<String, u64>,
}

pub fn health(state: &InventoryState) -> InventoryHealth {
    let index = &state.inner.index;
    let counts: BTreeMap<String, u64> = index["counts"].as_object().map(|c| c.iter().map(|(k, v)| (k.clone(), v.as_u64().unwrap_or(0))).collect()).unwrap_or_default();
    let total = index["total"].as_u64().unwrap_or(0);
    InventoryHealth {
        ok: total > 0 && counts.values().all(|n| *n > 0),
        total,
        commit: index["commit"].as_str().unwrap_or("").into(),
        generated: index["generated"].as_str().unwrap_or("").into(),
        counts,
    }
}

fn json_bytes(bytes: Vec<u8>) -> Response {
    let mut res = Response::new(Body::from(bytes));
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    res
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "No such inventory member" }))).into_response()
}

/// Serve `<dir>/<rel>.json`, where `rel` is `<kind>` or `<kind>/<id>`.
async fn record(state: &InventoryState, rel: &str) -> Response {
    let rel = rel.trim_matches('/');
    let kind = rel.split('/').next().unwrap_or("");
    if !KINDS.iter().any(|k| k.0 == kind) || !safe_id(rel) {
        return not_found();
    }
    match tokio::fs::read(state.inner.dir.join(format!("{rel}.json"))).await {
        Ok(bytes) => json_bytes(bytes),
        Err(_) => not_found(),
    }
}

async fn index(State(state): State<InventoryState>) -> Response {
    match tokio::fs::read(state.inner.dir.join("inventory.json")).await {
        Ok(bytes) => json_bytes(bytes),
        Err(_) => not_found(),
    }
}

async fn inventory_path(State(state): State<InventoryState>, UrlPath(rest): UrlPath<String>) -> Response {
    record(&state, &rest).await
}

async fn wasm_module(State(state): State<InventoryState>, UrlPath(rest): UrlPath<String>) -> Response {
    let Some(dir) = state.inner.wasm_dir.as_ref() else { return StatusCode::NOT_FOUND.into_response() };
    if !safe_id(&rest) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = dir.join(&rest);
    let Ok(bytes) = tokio::fs::read(&path).await else { return StatusCode::NOT_FOUND.into_response() };
    let ty = match Path::new(&rest).extension().and_then(|e| e.to_str()) {
        Some("wasm") => "application/wasm",
        Some("js") => "text/javascript; charset=utf-8",
        Some("ts") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    let mut res = Response::new(Body::from(bytes));
    res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(ty));
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    res.headers_mut().insert(header::CROSS_ORIGIN_RESOURCE_POLICY, HeaderValue::from_static("same-origin"));
    res
}

const METHODS: &[(&str, &str)] = &[
    ("inventory.counts", "Member counts per kind and the source commit."),
    ("inventory.list", "{kind?, query?, offset?, limit?} Members of a kind filtered by the words of the query (limit at most 200)."),
    ("inventory.search", "{query, offset?, limit?} Members of every kind ranked by name, id, tags and description."),
    ("inventory.get", "{kind, id} One member with its README, text, data and members."),
    ("crate.dependencies", "{id} Direct dependencies of a crate with their version requirements."),
    ("crate.features", "{id} Cargo features of a crate."),
    ("wasm.modules", "Crates served as WebAssembly modules with the module URL."),
];

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn words(s: &str) -> Vec<String> {
    s.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

fn haystack(m: &Value) -> String {
    let tags = m["tags"].as_array().map(|t| t.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default();
    format!("{} {} {} {} {}", m["name"].as_str().unwrap_or(""), m["id"].as_str().unwrap_or(""), m["desc"].as_str().unwrap_or(""), tags, m["path"].as_str().unwrap_or("")).to_lowercase()
}

fn page(hits: Vec<&Value>, params: &Map<String, Value>) -> Value {
    let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(50).clamp(1, 200) as usize;
    json!({ "total": hits.len(), "offset": offset, "members": hits.into_iter().skip(offset).take(limit).collect::<Vec<_>>() })
}

async fn read_member(state: &InventoryState, kind: &str, id: &str) -> Option<Value> {
    let rel = format!("{kind}/{id}");
    if !KINDS.iter().any(|k| k.0 == kind) || !safe_id(&rel) {
        return None;
    }
    let bytes = tokio::fs::read(state.inner.dir.join(format!("{rel}.json"))).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

async fn call(state: &InventoryState, method: &str, params: &Map<String, Value>) -> Result<Option<Value>, (i64, &'static str)> {
    let s = |k: &str| params.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Ok(match method {
        "inventory.counts" => {
            let i = &state.inner.index;
            Some(json!({ "counts": i["counts"], "total": i["total"], "commit": i["commit"], "generated": i["generated"], "kinds": KINDS.iter().map(|k| k.0).collect::<Vec<_>>() }))
        }
        "inventory.list" => {
            let kind = s("kind");
            let terms = words(&s("query"));
            let hits: Vec<&Value> = state
                .members()
                .iter()
                .filter(|m| kind.is_empty() || m["kind"].as_str() == Some(kind.as_str()))
                .filter(|m| {
                    let hay = haystack(m);
                    terms.iter().all(|t| hay.contains(t.as_str()))
                })
                .collect();
            Some(page(hits, params))
        }
        "inventory.search" => {
            let terms = words(&s("query"));
            if terms.is_empty() {
                return Err((-32602, "query is required"));
            }
            let mut scored: Vec<(u32, &Value)> = state
                .members()
                .iter()
                .filter_map(|m| {
                    let hay = haystack(m);
                    let name = m["name"].as_str().unwrap_or("").to_lowercase();
                    let mut score = 0;
                    for t in &terms {
                        if !hay.contains(t.as_str()) {
                            return None;
                        }
                        score += if name == *t { 20 } else if name.starts_with(t.as_str()) { 10 } else if name.contains(t.as_str()) { 5 } else { 1 };
                    }
                    Some((score, m))
                })
                .collect();
            scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1["name"].as_str().cmp(&b.1["name"].as_str())));
            Some(page(scored.into_iter().map(|(_, m)| m).collect(), params))
        }
        "inventory.get" => read_member(state, &s("kind"), &s("id")).await,
        "crate.dependencies" | "crate.features" => {
            let member = read_member(state, "crates", &s("id")).await;
            member.map(|m| if method == "crate.features" { m["data"]["features"].clone() } else { m["data"]["dependencies"].clone() })
        }
        "wasm.modules" => Some(Value::Array(
            state
                .members()
                .iter()
                .filter(|m| m["kind"] == "crates" && m["surface"]["module"].is_string())
                .map(|m| json!({ "crate": m["id"], "module": m["surface"]["module"] }))
                .collect(),
        )),
        _ => return Err((-32601, "Method not found")),
    })
}

async fn rpc_get() -> Response {
    let methods: Map<String, Value> = METHODS.iter().map(|(k, v)| (k.to_string(), json!(v))).collect();
    let mut res = Json(json!({ "jsonrpc": "2.0", "endpoint": "/api/rpc", "methods": methods })).into_response();
    res.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    res
}

async fn rpc_post(State(state): State<InventoryState>, body: Bytes) -> Response {
    let reply = |v: Value| {
        let mut res = Json(v).into_response();
        res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        res.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
        res
    };
    if body.len() > 16 * 1024 {
        return reply(rpc_error(&Value::Null, -32600, "Request too large"));
    }
    let Ok(request) = serde_json::from_slice::<Value>(&body) else { return reply(rpc_error(&Value::Null, -32700, "Parse error")) };
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let Some(method) = request.get("method").and_then(Value::as_str) else { return reply(rpc_error(&id, -32600, "Invalid request")) };
    let params = request.get("params").and_then(Value::as_object).cloned().unwrap_or_default();
    match call(&state, method, &params).await {
        Ok(Some(result)) => reply(json!({ "jsonrpc": "2.0", "id": id, "result": result })),
        Ok(None) => reply(rpc_error(&id, -32602, "No such member or invalid params")),
        Err((code, message)) => reply(rpc_error(&id, code, message)),
    }
}

/// The inventory routes, with their absolute paths, ready to `.merge()` into the server's root router.
pub fn router(state: InventoryState) -> Router {
    let mut router: Router<InventoryState> = Router::new()
        .route("/api/inventory", get(index))
        .route("/api/inventory/{*rest}", get(inventory_path))
        .route("/api/rpc", get(rpc_get).post(rpc_post))
        .route("/wasm/modules/{*rest}", get(wasm_module));
    for &(kind, _, _) in KINDS {
        router = router
            .route(&format!("/api/{kind}"), get(move |State(s): State<InventoryState>| async move { record(&s, kind).await }))
            .route(
                &format!("/api/{kind}/{{*rest}}"),
                get(move |State(s): State<InventoryState>, UrlPath(rest): UrlPath<String>| async move { record(&s, &format!("{kind}/{rest}")).await }),
            );
    }
    router.with_state(state)
}
