// SPDX-License-Identifier: Apache-2.0
//! The Bun OS HTTP API contract for axum services (`docs/ops/API.md`), the Rust twin of
//! `packages/bun-os-platform/src/api`:
//!
//! - a typed route table ([`Service`] of [`Op`]s) is the single source of the service's OpenAPI 3.1
//!   document, served at `GET /openapi.json` by [`Service::routes`];
//! - `GET /health` answers [`health`]: `{ status, service, version, commit, channel, uptimeSeconds, checks }`;
//! - errors are `application/problem+json` (RFC 9457) through [`problem`].
//!
//! Paths in the table are relative to the public base `https://api.aphrody.com/v1/<service>`.
//! [`Service::check_snapshot`] keeps `docs/generated/openapi/<service>.json` in step with the table
//! (`APHRODY_OPENAPI_WRITE=1 cargo test` rewrites it), so `scripts/service-map.ts --check` can
//! validate every document without building the service.

use std::{sync::OnceLock, time::Instant};

use axum::{
    Router,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Map, Value, json};

/// Public origin of the API gateway.
pub const API_ORIGIN: &str = "https://api.aphrody.com";

/// One operation of a service.
#[derive(Debug, Clone, Copy)]
pub struct Op {
    /// HTTP method, upper case.
    pub method: &'static str,
    /// Path relative to the public base; `{name}` segments, `{name*}` for a rest-of-path.
    pub path: &'static str,
    /// One-line summary.
    pub summary: &'static str,
    /// Tag grouping operations.
    pub tag: &'static str,
    /// Requires a bearer token.
    pub auth: bool,
    /// `sse` or `websocket` for long-lived responses.
    pub stream: Option<&'static str>,
    /// Media type of the success response.
    pub content: &'static str,
    /// Query parameter names.
    pub query: &'static [&'static str],
    /// Media type of the request body, if any.
    pub body: Option<&'static str>,
    /// A protocol error body (`jsonrpc`, `openai`, ...) instead of problem+json.
    pub error_format: Option<&'static str>,
    /// Kept for existing consumers only.
    pub deprecated: bool,
}

impl Op {
    const fn new(method: &'static str, path: &'static str, summary: &'static str) -> Self {
        Self {
            method,
            path,
            summary,
            tag: "",
            auth: false,
            stream: None,
            content: "application/json",
            query: &[],
            body: None,
            error_format: None,
            deprecated: false,
        }
    }
    /// `GET path`.
    #[must_use]
    pub const fn get(path: &'static str, summary: &'static str) -> Self {
        Self::new("GET", path, summary)
    }
    /// `POST path` with a JSON body.
    #[must_use]
    pub const fn post(path: &'static str, summary: &'static str) -> Self {
        Self::new("POST", path, summary).body("application/json")
    }
    /// `DELETE path`.
    #[must_use]
    pub const fn delete(path: &'static str, summary: &'static str) -> Self {
        Self::new("DELETE", path, summary)
    }
    /// Group under `tag`.
    #[must_use]
    pub const fn tag(mut self, tag: &'static str) -> Self {
        self.tag = tag;
        self
    }
    /// Requires the bearer token.
    #[must_use]
    pub const fn auth(mut self) -> Self {
        self.auth = true;
        self
    }
    /// Answers Server-Sent Events.
    #[must_use]
    pub const fn sse(mut self) -> Self {
        self.stream = Some("sse");
        self.content = "text/event-stream";
        self
    }
    /// Upgrades to a WebSocket.
    #[must_use]
    pub const fn websocket(mut self) -> Self {
        self.stream = Some("websocket");
        self
    }
    /// Success media type.
    #[must_use]
    pub const fn content(mut self, content: &'static str) -> Self {
        self.content = content;
        self
    }
    /// Query parameters.
    #[must_use]
    pub const fn query(mut self, query: &'static [&'static str]) -> Self {
        self.query = query;
        self
    }
    /// Request body media type.
    #[must_use]
    pub const fn body(mut self, body: &'static str) -> Self {
        self.body = Some(body);
        self
    }
    /// Protocol error body instead of problem+json.
    #[must_use]
    pub const fn errors(mut self, format: &'static str) -> Self {
        self.error_format = Some(format);
        self
    }
    /// Deprecated alias.
    #[must_use]
    pub const fn deprecated(mut self) -> Self {
        self.deprecated = true;
        self
    }
}

/// A service: gateway name, identity and route table.
#[derive(Debug, Clone, Copy)]
pub struct Service {
    /// `<service>` of `/v1/<service>/` in `infra/fleet/api.toml`.
    pub name: &'static str,
    /// Document title.
    pub title: &'static str,
    /// Release version.
    pub version: &'static str,
    /// Description.
    pub description: &'static str,
    /// Operations besides the standard ones.
    pub ops: &'static [Op],
}

fn operation_id(method: &str, path: &str) -> String {
    let mut id = method.to_ascii_lowercase();
    for part in path.split('/').filter(|p| !p.is_empty()) {
        let part = part
            .strip_prefix('{')
            .and_then(|p| p.strip_suffix('}'))
            .map_or_else(
                || part.to_owned(),
                |name| format!("by-{}", name.trim_end_matches('*')),
            );
        for word in part
            .split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|w| !w.is_empty())
        {
            let mut chars = word.chars();
            if let Some(first) = chars.next() {
                id.push(first.to_ascii_uppercase());
                id.push_str(chars.as_str());
            }
        }
    }
    id
}

fn standard_ops() -> [(Op, &'static str); 2] {
    [
        (Op::get("/health", "Health").tag("contract"), "getHealth"),
        (
            Op::get("/openapi.json", "OpenAPI document").tag("contract"),
            "getOpenapi",
        ),
    ]
}

fn problem_content() -> Value {
    json!({ "application/problem+json": { "schema": { "$ref": "#/components/schemas/Problem" } } })
}

impl Service {
    /// The OpenAPI 3.1 document of this service.
    #[must_use]
    pub fn openapi(&self) -> Value {
        let mut paths: Map<String, Value> = Map::new();
        let mut secured = false;
        let ops = standard_ops()
            .into_iter()
            .map(|(op, id)| (op, Some(id)))
            .chain(self.ops.iter().map(|op| (*op, None)));
        for (op, fixed_id) in ops {
            let path = op.path.replace("*}", "}");
            let mut parameters: Vec<Value> = path
                .split('/')
                .filter_map(|p| p.strip_prefix('{').and_then(|p| p.strip_suffix('}')))
                .map(|name| json!({ "name": name, "in": "path", "required": true, "schema": { "type": "string" } }))
                .collect();
            parameters.extend(op.query.iter().map(
                |name| json!({ "name": name, "in": "query", "schema": { "type": "string" } }),
            ));
            let mut responses = Map::new();
            let success = if matches!(op.path, "/health") {
                json!({ "$ref": "#/components/schemas/Health" })
            } else {
                json!({})
            };
            if op.stream == Some("websocket") {
                responses.insert("101".into(), json!({ "description": "WebSocket upgrade" }));
            } else {
                responses.insert(
                    "200".into(),
                    json!({ "description": "OK", "content": { op.content: { "schema": success } } }),
                );
            }
            if op.path == "/health" {
                responses.insert(
                    "503".into(),
                    json!({ "description": "A required check failed", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Health" } } } }),
                );
            }
            if op.auth {
                secured = true;
                responses.insert(
                    "401".into(),
                    json!({ "$ref": "#/components/responses/Unauthorized" }),
                );
            }
            responses.insert(
                "default".into(),
                json!({ "$ref": "#/components/responses/Problem" }),
            );
            let mut operation = json!({
                "operationId": fixed_id.map_or_else(|| operation_id(op.method, &path), str::to_owned),
                "summary": op.summary,
                "tags": [if op.tag.is_empty() { self.name } else { op.tag }],
                "responses": responses,
            });
            let object = operation.as_object_mut().expect("operation object");
            if !parameters.is_empty() {
                object.insert("parameters".into(), Value::Array(parameters));
            }
            if let Some(body) = op.body {
                object.insert(
                    "requestBody".into(),
                    json!({ "required": true, "content": { body: { "schema": {} } } }),
                );
            }
            if op.auth {
                object.insert("security".into(), json!([{ "bearer": [] }]));
            }
            if let Some(stream) = op.stream {
                object.insert("x-stream".into(), json!(stream));
            }
            if let Some(format) = op.error_format {
                object.insert("x-error-format".into(), json!(format));
            }
            if op.deprecated {
                object.insert("deprecated".into(), json!(true));
            }
            paths
                .entry(path)
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .expect("path item")
                .insert(op.method.to_ascii_lowercase(), operation);
        }
        let mut components = json!({
            "schemas": {
                "Problem": {
                    "type": "object",
                    "description": "RFC 9457 problem details",
                    "required": ["type", "title", "status"],
                    "properties": {
                        "type": { "type": "string", "format": "uri-reference", "default": "about:blank" },
                        "title": { "type": "string" },
                        "status": { "type": "integer", "minimum": 100, "maximum": 599 },
                        "detail": { "type": "string" },
                        "instance": { "type": "string", "format": "uri-reference" }
                    }
                },
                "Health": {
                    "type": "object",
                    "required": ["status", "service", "version"],
                    "properties": {
                        "status": { "type": "string", "enum": ["ok", "degraded", "down"] },
                        "service": { "type": "string" },
                        "version": { "type": "string" },
                        "commit": { "type": ["string", "null"] },
                        "channel": { "type": ["string", "null"] },
                        "uptimeSeconds": { "type": "integer", "minimum": 0 },
                        "checks": { "type": "object", "additionalProperties": { "$ref": "#/components/schemas/Check" } }
                    }
                },
                "Check": {
                    "type": "object",
                    "required": ["ok"],
                    "properties": { "ok": { "type": "boolean" }, "optional": { "type": "boolean" }, "detail": { "type": "string" } }
                }
            },
            "responses": {
                "Problem": { "description": "Error", "content": problem_content() },
                "Unauthorized": { "description": "Missing or invalid bearer token", "content": problem_content() }
            }
        });
        if secured {
            components["securitySchemes"] =
                json!({ "bearer": { "type": "http", "scheme": "bearer" } });
        }
        let mut info = json!({
            "title": self.title,
            "version": self.version,
            "license": { "name": "Apache-2.0", "identifier": "Apache-2.0" },
        });
        if !self.description.is_empty() {
            info["description"] = json!(self.description);
        }
        json!({
            "openapi": "3.1.0",
            "info": info,
            "servers": [{ "url": format!("{API_ORIGIN}/v1/{}", self.name), "description": "Bun OS API gateway" }],
            "paths": paths,
            "components": components,
            "x-service": self.name,
        })
    }

    /// `GET /openapi.json` at the root.
    pub fn routes<S: Clone + Send + Sync + 'static>(&self) -> Router<S> {
        self.routes_at("")
    }

    /// `GET <prefix>/openapi.json`, where `prefix` is the mount of the public base (`/api`, ...).
    pub fn routes_at<S: Clone + Send + Sync + 'static>(&self, prefix: &str) -> Router<S> {
        let body = self.openapi().to_string();
        Router::new().route(
            &format!("{prefix}/openapi.json"),
            get(move || {
                let body = body.clone();
                async move {
                    (
                        [
                            (
                                header::CONTENT_TYPE,
                                HeaderValue::from_static("application/json"),
                            ),
                            (
                                header::CACHE_CONTROL,
                                HeaderValue::from_static("public, max-age=60"),
                            ),
                            (
                                header::X_CONTENT_TYPE_OPTIONS,
                                HeaderValue::from_static("nosniff"),
                            ),
                        ],
                        body,
                    )
                }
            }),
        )
    }

    /// Compare the document with `docs/generated/openapi/<name>.json` under `workspace`; rewrite it when
    /// `APHRODY_OPENAPI_WRITE` is set. Call from a unit test of the service crate.
    ///
    /// # Panics
    /// When the committed document is missing or differs.
    pub fn check_snapshot(&self, workspace: &std::path::Path) {
        let path = workspace
            .join("docs/generated/openapi")
            .join(format!("{}.json", self.name));
        let text = format!(
            "{}\n",
            serde_json::to_string_pretty(&self.openapi()).expect("serialize OpenAPI")
        );
        if std::env::var_os("APHRODY_OPENAPI_WRITE").is_some() {
            std::fs::create_dir_all(path.parent().expect("parent"))
                .expect("create docs/generated/openapi");
            std::fs::write(&path, &text).expect("write OpenAPI snapshot");
            return;
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_default();
        let parse = |s: &str| serde_json::from_str::<Value>(s).ok();
        assert!(
            parse(&committed).is_some() && parse(&committed) == parse(&text),
            "{} is stale: run APHRODY_OPENAPI_WRITE=1 cargo test -p <crate> openapi",
            path.display()
        );
    }
}

/// One health check.
#[derive(Debug, Clone)]
pub struct Check {
    /// Name in `checks`.
    pub name: &'static str,
    /// Passed.
    pub ok: bool,
    /// A failed optional check degrades instead of taking the service down.
    pub optional: bool,
    /// Detail.
    pub detail: Option<String>,
}

fn started() -> Instant {
    static START: OnceLock<Instant> = OnceLock::new();
    *START.get_or_init(Instant::now)
}

/// The standard health body and its status code; `extra` fields are merged in (kept for existing consumers).
#[must_use]
pub fn health_body(
    service: &str,
    version: &str,
    commit: Option<&str>,
    channel: Option<&str>,
    checks: &[Check],
    extra: Value,
) -> (StatusCode, Value) {
    let down = checks.iter().any(|c| !c.ok && !c.optional);
    let degraded = checks.iter().any(|c| !c.ok);
    let status = if down {
        "down"
    } else if degraded {
        "degraded"
    } else {
        "ok"
    };
    let mut body = json!({
        "status": status,
        "service": service,
        "version": version,
        "commit": commit,
        "channel": channel,
        "uptimeSeconds": started().elapsed().as_secs(),
    });
    if !checks.is_empty() {
        let mut map = Map::new();
        for c in checks {
            let mut check = json!({ "ok": c.ok });
            if c.optional {
                check["optional"] = json!(true);
            }
            if let Some(detail) = &c.detail {
                check["detail"] = json!(detail);
            }
            map.insert(c.name.into(), check);
        }
        body["checks"] = Value::Object(map);
    }
    if let (Some(target), Value::Object(extra)) = (body.as_object_mut(), extra) {
        for (k, v) in extra {
            target.entry(k).or_insert(v);
        }
    }
    (
        if down {
            StatusCode::SERVICE_UNAVAILABLE
        } else {
            StatusCode::OK
        },
        body,
    )
}

/// The standard health response.
#[must_use]
pub fn health(
    service: &str,
    version: &str,
    commit: Option<&str>,
    channel: Option<&str>,
    checks: &[Check],
    extra: Value,
) -> Response {
    // Start the uptime clock at the first probe at the latest.
    let (status, body) = health_body(service, version, commit, channel, checks, extra);
    (
        status,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            ),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
        body.to_string(),
    )
        .into_response()
}

/// Start the uptime clock (call once at startup).
pub fn mark_started() {
    let _ = started();
}

/// An RFC 9457 problem response.
#[must_use]
pub fn problem(status: StatusCode, detail: impl Into<String>) -> Response {
    problem_with(status, detail, Value::Null)
}

/// An RFC 9457 problem response with extension members (`extra` object fields, e.g. a legacy `error`).
#[must_use]
pub fn problem_with(status: StatusCode, detail: impl Into<String>, extra: Value) -> Response {
    let detail = detail.into();
    let mut body = json!({
        "type": "about:blank",
        "title": status.canonical_reason().unwrap_or("Error"),
        "status": status.as_u16(),
    });
    if !detail.is_empty() {
        body["detail"] = json!(detail);
    }
    if let (Some(target), Value::Object(extra)) = (body.as_object_mut(), extra) {
        for (k, v) in extra {
            target.entry(k).or_insert(v);
        }
    }
    (
        status,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/problem+json"),
            ),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            (
                header::X_CONTENT_TYPE_OPTIONS,
                HeaderValue::from_static("nosniff"),
            ),
        ],
        body.to_string(),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SVC: Service = Service {
        name: "demo",
        title: "Demo",
        version: "1.0.0",
        description: "",
        ops: &[
            Op::get("/items/{id}", "Item").auth(),
            Op::get("/files/{path*}", "File").content("application/octet-stream"),
        ],
    };

    #[test]
    fn document_has_standard_routes_and_parameters() {
        let doc = SVC.openapi();
        assert_eq!(doc["openapi"], "3.1.0");
        assert_eq!(doc["servers"][0]["url"], "https://api.aphrody.com/v1/demo");
        assert_eq!(doc["paths"]["/health"]["get"]["operationId"], "getHealth");
        assert_eq!(
            doc["paths"]["/items/{id}"]["get"]["operationId"],
            "getItemsById"
        );
        assert_eq!(
            doc["paths"]["/files/{path}"]["get"]["parameters"][0]["name"],
            "path"
        );
        assert_eq!(
            doc["components"]["securitySchemes"]["bearer"]["scheme"],
            "bearer"
        );
    }

    #[test]
    fn health_degrades_on_optional_and_fails_on_required() {
        let optional = Check {
            name: "a",
            ok: false,
            optional: true,
            detail: None,
        };
        let (code, body) = health_body("demo", "1", None, None, &[optional], json!({ "ok": true }));
        assert_eq!(
            (code, body["status"].as_str()),
            (StatusCode::OK, Some("degraded"))
        );
        assert_eq!(body["ok"], true);
        let required = Check {
            name: "b",
            ok: false,
            optional: false,
            detail: None,
        };
        let (code, body) = health_body("demo", "1", None, None, &[required], Value::Null);
        assert_eq!(
            (code, body["status"].as_str()),
            (StatusCode::SERVICE_UNAVAILABLE, Some("down"))
        );
    }
}
