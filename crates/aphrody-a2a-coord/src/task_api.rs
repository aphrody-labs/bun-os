// SPDX-License-Identifier: Apache-2.0
//! Namespaced durable task and envelope API used by serverless A2A consumers.

use std::{path::PathBuf, sync::Arc};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;

use crate::envelope::Envelope;

#[derive(Clone)]
struct ApiState {
    root: PathBuf,
    token: Option<String>,
    write_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    target: Option<String>,
    limit: Option<usize>,
}

/// Routes for durable agent-scoped tasks and coordination envelopes.
///
/// `root` is the Aphrody coordination directory. Records are stored beneath
/// `agents/<namespace>/`, keeping product agents isolated from one another.
pub fn task_api_router(root: PathBuf, token: Option<String>) -> Router {
    let state = ApiState {
        root,
        token,
        write_lock: Arc::new(Mutex::new(())),
    };
    Router::new()
        .route(
            "/coord/{namespace}/tasks",
            get(list_tasks).post(create_task),
        )
        .route(
            "/coord/{namespace}/tasks/{task_id}",
            get(get_task)
                .put(put_task)
                .patch(patch_task)
                .delete(delete_task),
        )
        .route(
            "/coord/{namespace}/envelopes",
            get(list_envelopes).post(append_envelope),
        )
        .with_state(state)
}

fn authorized(headers: &HeaderMap, state: &ApiState) -> bool {
    let Some(expected) = state.token.as_deref() else {
        return true;
    };
    let Some(value) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    value
        .split_once(' ')
        .is_some_and(|(scheme, actual)| scheme.eq_ignore_ascii_case("Bearer") && actual == expected)
}

// Keep handler results compact; materialize the HTTP body at the boundary.
struct ApiResponse {
    status: StatusCode,
    value: Value,
}

impl IntoResponse for ApiResponse {
    fn into_response(self) -> axum::response::Response {
        (self.status, Json(self.value)).into_response()
    }
}

fn auth_error() -> ApiResponse {
    response(StatusCode::UNAUTHORIZED, json!({"error":"unauthorized"}))
}

fn valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

fn agent_dir(state: &ApiState, namespace: &str) -> Result<PathBuf, StatusCode> {
    if !valid_segment(namespace) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(state.root.join("agents").join(namespace))
}

fn task_path(state: &ApiState, namespace: &str, task_id: &str) -> Result<PathBuf, StatusCode> {
    if !valid_segment(task_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(agent_dir(state, namespace)?
        .join("tasks")
        .join(format!("{task_id}.json")))
}

fn response(status: StatusCode, value: Value) -> ApiResponse {
    ApiResponse { status, value }
}

async fn read_task(path: PathBuf) -> Result<Option<Value>, StatusCode> {
    match tokio::fs::read(&path).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn write_task(path: PathBuf, value: &Value) -> Result<(), StatusCode> {
    let parent = path.parent().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(value).map_err(|_| StatusCode::BAD_REQUEST)?;
    tokio::fs::write(&temp, bytes)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tokio::fs::rename(temp, path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn list_tasks(
    State(state): State<ApiState>,
    Path(namespace): Path<String>,
    Query(query): Query<ListQuery>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiResponse> {
    if !authorized(&headers, &state) {
        return Err(auth_error());
    }
    let dir = agent_dir(&state, &namespace)
        .map_err(|status| response(status, json!({"error":"invalid namespace"})))?
        .join("tasks");
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Json(json!({"tasks":[],"total":0})));
        }
        Err(_) => {
            return Err(response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error":"task listing failed"}),
            ));
        }
    };
    let mut tasks = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.path().extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        if let Ok(bytes) = tokio::fs::read(entry.path()).await
            && let Ok(task) = serde_json::from_slice::<Value>(&bytes)
            && query
                .target
                .as_deref()
                .is_none_or(|target| task.get("target").and_then(Value::as_str) == Some(target))
        {
            tasks.push(task);
        }
    }
    tasks.sort_by(|a, b| {
        b.get("createdAt")
            .and_then(Value::as_str)
            .cmp(&a.get("createdAt").and_then(Value::as_str))
    });
    let total = tasks.len();
    tasks.truncate(query.limit.unwrap_or(1000).clamp(1, 5000));
    Ok(Json(json!({"tasks":tasks,"total":total})))
}

async fn create_task(
    State(state): State<ApiState>,
    Path(namespace): Path<String>,
    headers: HeaderMap,
    Json(task): Json<Value>,
) -> Result<ApiResponse, ApiResponse> {
    if !authorized(&headers, &state) {
        return Err(auth_error());
    }
    let Some(id) = task.get("id").and_then(Value::as_str) else {
        return Err(response(
            StatusCode::BAD_REQUEST,
            json!({"error":"task id required"}),
        ));
    };
    let path = task_path(&state, &namespace, id)
        .map_err(|status| response(status, json!({"error":"invalid namespace or task id"})))?;
    let _guard = state.write_lock.lock().await;
    if read_task(path.clone())
        .await
        .map_err(|status| response(status, json!({"error":"task read failed"})))?
        .is_some()
    {
        return Err(response(
            StatusCode::CONFLICT,
            json!({"error":"task already exists"}),
        ));
    }
    write_task(path, &task)
        .await
        .map_err(|status| response(status, json!({"error":"task write failed"})))?;
    Ok(response(StatusCode::CREATED, task))
}

async fn get_task(
    State(state): State<ApiState>,
    Path((namespace, task_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<ApiResponse, ApiResponse> {
    if !authorized(&headers, &state) {
        return Err(auth_error());
    }
    let path = task_path(&state, &namespace, &task_id)
        .map_err(|status| response(status, json!({"error":"invalid namespace or task id"})))?;
    match read_task(path)
        .await
        .map_err(|status| response(status, json!({"error":"task read failed"})))?
    {
        Some(task) => Ok(response(StatusCode::OK, task)),
        None => Err(response(
            StatusCode::NOT_FOUND,
            json!({"error":"task not found"}),
        )),
    }
}

async fn put_task(
    State(state): State<ApiState>,
    Path((namespace, task_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(task): Json<Value>,
) -> Result<ApiResponse, ApiResponse> {
    save_task(state, namespace, task_id, headers, task, false).await
}

async fn patch_task(
    State(state): State<ApiState>,
    Path((namespace, task_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(patch): Json<Value>,
) -> Result<ApiResponse, ApiResponse> {
    save_task(state, namespace, task_id, headers, patch, true).await
}

async fn save_task(
    state: ApiState,
    namespace: String,
    task_id: String,
    headers: HeaderMap,
    mut task: Value,
    merge: bool,
) -> Result<ApiResponse, ApiResponse> {
    if !authorized(&headers, &state) {
        return Err(auth_error());
    }
    let path = task_path(&state, &namespace, &task_id)
        .map_err(|status| response(status, json!({"error":"invalid namespace or task id"})))?;
    let _guard = state.write_lock.lock().await;
    let Some(current) = read_task(path.clone())
        .await
        .map_err(|status| response(status, json!({"error":"task read failed"})))?
    else {
        return Err(response(
            StatusCode::NOT_FOUND,
            json!({"error":"task not found"}),
        ));
    };
    if merge {
        let (Some(current), Some(patch)) = (current.as_object(), task.as_object_mut()) else {
            return Err(response(
                StatusCode::BAD_REQUEST,
                json!({"error":"task and patch must be objects"}),
            ));
        };
        let mut merged = current.clone();
        for (key, value) in std::mem::take(patch) {
            merged.insert(key, value);
        }
        task = Value::Object(merged);
    }
    let Some(object) = task.as_object_mut() else {
        return Err(response(
            StatusCode::BAD_REQUEST,
            json!({"error":"task must be an object"}),
        ));
    };
    object.insert("id".into(), Value::String(task_id));
    write_task(path, &task)
        .await
        .map_err(|status| response(status, json!({"error":"task write failed"})))?;
    Ok(response(StatusCode::OK, task))
}

async fn delete_task(
    State(state): State<ApiState>,
    Path((namespace, task_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<ApiResponse, ApiResponse> {
    if !authorized(&headers, &state) {
        return Err(auth_error());
    }
    let path = task_path(&state, &namespace, &task_id)
        .map_err(|status| response(status, json!({"error":"invalid namespace or task id"})))?;
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(response(
            StatusCode::OK,
            json!({"deleted":true,"id":task_id}),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(response(
            StatusCode::NOT_FOUND,
            json!({"error":"task not found"}),
        )),
        Err(_) => Err(response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error":"task deletion failed"}),
        )),
    }
}

async fn list_envelopes(
    State(state): State<ApiState>,
    Path(namespace): Path<String>,
    Query(query): Query<ListQuery>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiResponse> {
    if !authorized(&headers, &state) {
        return Err(auth_error());
    }
    let dir = agent_dir(&state, &namespace)
        .map_err(|status| response(status, json!({"error":"invalid namespace"})))?
        .join("mailbox");
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Json(json!({"envelopes":[],"total":0})));
        }
        Err(_) => {
            return Err(response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error":"mailbox listing failed"}),
            ));
        }
    };
    let mut envelopes = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.path().extension().is_none_or(|ext| ext != "jsonl") {
            continue;
        }
        if let Ok(text) = tokio::fs::read_to_string(entry.path()).await {
            for line in text.lines().filter(|line| !line.trim().is_empty()) {
                if let Ok(envelope) = serde_json::from_str::<Value>(line) {
                    envelopes.push(envelope);
                }
            }
        }
    }
    envelopes.sort_by(|a, b| {
        b.get("ts")
            .and_then(Value::as_str)
            .cmp(&a.get("ts").and_then(Value::as_str))
    });
    let total = envelopes.len();
    envelopes.truncate(query.limit.unwrap_or(100).clamp(1, 5000));
    Ok(Json(json!({"envelopes":envelopes,"total":total})))
}

async fn append_envelope(
    State(state): State<ApiState>,
    Path(namespace): Path<String>,
    headers: HeaderMap,
    Json(envelope): Json<Envelope>,
) -> Result<ApiResponse, ApiResponse> {
    if !authorized(&headers, &state) {
        return Err(auth_error());
    }
    let dir = agent_dir(&state, &namespace)
        .map_err(|status| response(status, json!({"error":"invalid namespace"})))?
        .join("mailbox");
    let source = envelope.from.split('@').next().unwrap_or("unknown");
    if !valid_segment(source) {
        return Err(response(
            StatusCode::BAD_REQUEST,
            json!({"error":"invalid envelope source"}),
        ));
    }
    let _guard = state.write_lock.lock().await;
    tokio::fs::create_dir_all(&dir).await.map_err(|_| {
        response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error":"mailbox write failed"}),
        )
    })?;
    let path = dir.join(format!("inbox-from-{source}.jsonl"));
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .map_err(|_| {
            response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error":"mailbox write failed"}),
            )
        })?;
    use tokio::io::AsyncWriteExt;
    let line = serde_json::to_vec(&envelope)
        .map_err(|_| response(StatusCode::BAD_REQUEST, json!({"error":"invalid envelope"})))?;
    file.write_all(&line).await.map_err(|_| {
        response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error":"mailbox write failed"}),
        )
    })?;
    file.write_all(b"\n").await.map_err(|_| {
        response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error":"mailbox write failed"}),
        )
    })?;
    Ok(response(
        StatusCode::CREATED,
        json!({"ok":true,"id":envelope.id}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt as _;
    use tower::ServiceExt as _;

    async fn request(
        app: &Router,
        method: &str,
        path: &str,
        value: Option<Value>,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(token) = token {
            req = req.header("authorization", format!("Bearer {token}"));
        }
        let body = if let Some(value) = value {
            req = req.header("content-type", "application/json");
            Body::from(value.to_string())
        } else {
            Body::empty()
        };
        let result = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = result.status();
        let bytes = result.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn task_response_contract_preserves_auth_crud_and_namespace_isolation() {
        let dir = tempfile::tempdir().unwrap();
        let app = task_api_router(dir.path().to_path_buf(), Some("test-token".into()));
        let tasks = "/coord/aphrody/tasks";
        let task = "/coord/aphrody/tasks/task-1";
        assert_eq!(
            request(&app, "GET", tasks, None, None).await,
            (StatusCode::UNAUTHORIZED, json!({"error":"unauthorized"}))
        );
        let doc = json!({"id":"task-1","target":"codex","status":"queued"});
        assert_eq!(
            request(&app, "POST", tasks, Some(doc.clone()), Some("test-token")).await,
            (StatusCode::CREATED, doc.clone())
        );
        assert_eq!(
            request(&app, "GET", task, None, Some("test-token")).await,
            (StatusCode::OK, doc.clone())
        );
        assert_eq!(
            request(&app, "POST", tasks, Some(doc), Some("test-token"))
                .await
                .0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            request(&app, "GET", "/coord/ie/tasks", None, Some("test-token")).await,
            (StatusCode::OK, json!({"tasks":[],"total":0}))
        );
        let updated = request(
            &app,
            "PATCH",
            task,
            Some(json!({"status":"done"})),
            Some("test-token"),
        )
        .await;
        assert_eq!(
            updated,
            (
                StatusCode::OK,
                json!({"id":"task-1","target":"codex","status":"done"})
            )
        );
        assert_eq!(
            request(
                &app,
                "GET",
                "/coord/aphrody/tasks?target=claude",
                None,
                Some("test-token")
            )
            .await,
            (StatusCode::OK, json!({"tasks":[],"total":0}))
        );
        let listed = request(
            &app,
            "GET",
            "/coord/aphrody/tasks?target=codex",
            None,
            Some("test-token"),
        )
        .await;
        assert_eq!(
            listed,
            (StatusCode::OK, json!({"tasks":[updated.1],"total":1}))
        );
        assert_eq!(
            request(&app, "DELETE", task, None, Some("test-token")).await,
            (StatusCode::OK, json!({"deleted":true,"id":"task-1"}))
        );
        assert_eq!(
            request(&app, "GET", task, None, Some("test-token")).await,
            (StatusCode::NOT_FOUND, json!({"error":"task not found"}))
        );
    }

    #[tokio::test]
    async fn mailbox_response_contract_preserves_envelopes_and_validation() {
        let dir = tempfile::tempdir().unwrap();
        let app = task_api_router(dir.path().to_path_buf(), None);
        let path = "/coord/aphrody/envelopes";
        let envelope = Envelope::new(
            "codex@aphrody",
            "claude@aphrody",
            crate::envelope::EnvelopeKind::Ping,
            "qualification",
            "fixture",
        );
        let value = serde_json::to_value(&envelope).unwrap();
        assert_eq!(
            request(&app, "POST", path, Some(value.clone()), None).await,
            (StatusCode::CREATED, json!({"ok":true,"id":envelope.id}))
        );
        assert_eq!(
            request(&app, "GET", path, None, None).await,
            (StatusCode::OK, json!({"envelopes":[value],"total":1}))
        );
        assert_eq!(
            request(&app, "GET", "/coord/invalid.namespace/tasks", None, None).await,
            (
                StatusCode::BAD_REQUEST,
                json!({"error":"invalid namespace"})
            )
        );
    }
}
