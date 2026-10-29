// SPDX-License-Identifier: Apache-2.0
//! Studio backend: typed commands for the native Studio screens (local AI, Drive, A2A, MCP tools),
//! returned as structured JSON.

use serde_json::Value;

fn main_window_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Studio commands are only available from the main window".into())
    }
}

/// Local models served by the managed `llama-server` (chat, embed, rerank) that are ready now.
#[tauri::command]
pub fn studio_native_ai_status() -> Value {
    use aphrody_llama_server::{Role, discover_running};
    let role = |role: Role| {
        discover_running(role).map_or_else(
            || serde_json::json!({"ready": false}),
            |state| serde_json::json!({"ready": state.ready, "model": state.alias, "port": state.port}),
        )
    };
    serde_json::json!({
        "chat": role(Role::Chat),
        "embed": role(Role::Embed),
        "rerank": role(Role::Rerank),
    })
}

/// Chat completion on the local chat model (OpenAI-compatible `/v1/chat/completions`).
#[tauri::command]
pub async fn studio_native_chat(
    messages: Vec<Value>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
) -> Result<Value, String> {
    use aphrody_llama_server::{Role, discover_running};
    let state = discover_running(Role::Chat)
        .filter(|state| state.ready)
        .ok_or_else(|| {
            "aucun modèle de chat local prêt : en charger un depuis Modèles".to_string()
        })?;
    let body = serde_json::json!({
        "model": state.alias,
        "messages": messages,
        "temperature": temperature.unwrap_or(0.4),
        "max_tokens": max_tokens.unwrap_or(1024),
        "stream": false,
    });
    let response = reqwest::Client::new()
        .post(format!(
            "http://127.0.0.1:{}/v1/chat/completions",
            state.port
        ))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("modèle local injoignable : {error}"))?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|error| format!("réponse invalide : {error}"))?;
    if status.is_success() {
        Ok(value)
    } else {
        Err(format!("modèle local : HTTP {status} {value}"))
    }
}

/// Google OAuth "installed app" loopback flow with the existing Aphrody OAuth client
/// (`~/.aphrody/private/google/aphrody-oauth-client.json`). The browser asks for consent once; the
/// tokens are kept in the private store (`drive-oauth-token.json`, mode 0600) and returned so the
/// Drive daemon can mount the folder (`volumes.add_cloud`, OpenDAL `gdrive`).
#[tauri::command]
pub async fn studio_google_drive_authorize(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    use tauri_plugin_opener::OpenerExt;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    main_window_only(&window)?;
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or("HOME absent")?;
    let private = home.join(".aphrody/private/google");
    let client: Value = serde_json::from_str(
        &std::fs::read_to_string(private.join("aphrody-oauth-client.json"))
            .map_err(|error| format!("client OAuth Google introuvable : {error}"))?,
    )
    .map_err(|error| format!("client OAuth illisible : {error}"))?;
    let installed = &client["installed"];
    let field = |name: &str| {
        installed[name]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| format!("client OAuth : `{name}` absent"))
    };
    let (client_id, client_secret) = (field("client_id")?, field("client_secret")?);
    let (auth_uri, token_uri) = (field("auth_uri")?, field("token_uri")?);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| error.to_string())?;
    let redirect = format!(
        "http://localhost:{}",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let state = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    let mut consent = reqwest::Url::parse(&auth_uri).map_err(|error| error.to_string())?;
    consent
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", "https://www.googleapis.com/auth/drive")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &state);
    app.opener()
        .open_url(consent.as_str(), None::<&str>)
        .map_err(|error| error.to_string())?;

    let accept = async {
        let (mut stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let mut buffer = vec![0_u8; 8192];
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|error| error.to_string())?;
        let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
        let target = request.split_whitespace().nth(1).unwrap_or("/").to_owned();
        let page = "<!doctype html><meta charset=utf-8><title>Aphrody</title><p>Autorisation reçue, vous pouvez revenir dans Aphrody.</p>";
        let _ = stream
            .write_all(format!("HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{page}", page.len()).as_bytes())
            .await;
        Ok::<String, String>(target)
    };
    let target = tokio::time::timeout(std::time::Duration::from_secs(300), accept)
        .await
        .map_err(|_| "délai d'autorisation Google dépassé (5 min)".to_string())??;
    let url =
        reqwest::Url::parse(&format!("{redirect}{target}")).map_err(|error| error.to_string())?;
    let query: std::collections::HashMap<String, String> = url.query_pairs().into_owned().collect();
    if query.get("state") != Some(&state) {
        return Err("réponse OAuth refusée : état inattendu".into());
    }
    if let Some(error) = query.get("error") {
        return Err(format!("autorisation Google refusée : {error}"));
    }
    let code = query.get("code").ok_or("réponse OAuth sans code")?;
    let tokens: Value = reqwest::Client::new()
        .post(&token_uri)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|error| format!("échange du code : {error}"))?
        .json()
        .await
        .map_err(|error| format!("réponse de jeton invalide : {error}"))?;
    let access_token = tokens["access_token"]
        .as_str()
        .ok_or_else(|| format!("jeton absent : {tokens}"))?;
    let refresh_token = tokens["refresh_token"]
        .as_str()
        .ok_or("refresh_token absent (consentement hors ligne refusé)")?;
    let stored = serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "scope": tokens["scope"],
        "obtained_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs(),
    });
    let path = private.join("drive-oauth-token.json");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&stored).map_err(|e| e.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }))
}

/// Retrieve native A2A fleet status, active claims and mailbox envelopes from `.coord`.
#[tauri::command]
pub async fn studio_a2a_fleet_status() -> Result<Value, String> {
    let repo_root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let coord_dir = repo_root.join(".coord");

    // Read active claims
    let claims_dir = coord_dir.join("claims");
    let mut claims = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&claims_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json")
                && let Ok(content) = tokio::fs::read_to_string(&path).await
                && let Ok(parsed) = serde_json::from_str::<Value>(&content)
            {
                claims.push(parsed);
            }
        }
    }

    // Read envelopes from mailboxes
    let mut envelopes = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&coord_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name.ends_with(".jsonl")
                && let Ok(content) = tokio::fs::read_to_string(&path).await
            {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty()
                        && let Ok(env) = serde_json::from_str::<Value>(trimmed)
                    {
                        envelopes.push(env);
                    }
                }
            }
        }
    }

    // Peers: every agent named by a claim (`owner`) or an envelope (`from`/`to`); nothing
    // is listed that the coordination directory does not show.
    let mut ids = std::collections::BTreeSet::new();
    for claim in &claims {
        if let Some(owner) = claim["owner"].as_str() {
            ids.insert(owner.to_owned());
        }
    }
    for envelope in &envelopes {
        for key in ["from", "to"] {
            if let Some(id) = envelope[key].as_str() {
                ids.insert(id.to_owned());
            }
        }
    }
    let peers: Vec<Value> = ids
        .into_iter()
        .map(|id| {
            let active: Vec<&str> = claims
                .iter()
                .filter(|claim| {
                    claim["owner"].as_str() == Some(id.as_str())
                        && claim["state"].as_str() == Some("active")
                })
                .filter_map(|claim| claim["task"].as_str())
                .collect();
            serde_json::json!({
                "id": id,
                "status": if active.is_empty() { "idle" } else { "busy" },
                "activeClaims": active,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "peers": peers,
        "claims": claims,
        "envelopes": envelopes,
        "coordDir": coord_dir.to_string_lossy(),
    }))
}

/// Send an A2A envelope directly to a peer mailbox in `.coord`.
#[tauri::command]
pub async fn studio_a2a_send_envelope(envelope: Value) -> Result<Value, String> {
    use tokio::io::AsyncWriteExt;
    let repo_root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let coord_dir = repo_root.join(".coord");
    tokio::fs::create_dir_all(&coord_dir)
        .await
        .map_err(|e| e.to_string())?;

    let to = envelope["to"].as_str().unwrap_or("codex");
    let filename = format!("inbox-to-{to}.jsonl");
    let target = coord_dir.join(filename);

    let mut line = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    line.push('\n');

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&target)
        .await
        .map_err(|e| e.to_string())?;

    file.write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "sent": true, "path": target.to_string_lossy(), "envelope": envelope }))
}

/// List the canonical app-server tools; no generative UI capability is implied.
#[tauri::command]
pub async fn studio_mcp_tools_list(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, crate::broker::AppServerBroker>,
) -> Result<Value, String> {
    main_window_only(&window)?;
    let response = broker
        .call(serde_json::json!({"id": 0, "method": "tools/list", "params": {}}))
        .await?;
    tools_inventory_from_response(&response)
}

fn tools_inventory_from_response(response: &Value) -> Result<Value, String> {
    if let Some(error) = response.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Tool inventory unavailable")
            .to_owned());
    }
    let data = response
        .get("result")
        .and_then(|result| result.get("data"))
        .and_then(Value::as_array)
        .ok_or("Invalid app-server tool inventory")?;
    let tools = data
        .iter()
        .map(|tool| {
            let name = tool
                .get("name")
                .and_then(Value::as_str)
                .ok_or("Invalid tool name")?;
            let description = tool
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("");
            Ok(serde_json::json!({"name": name, "description": description, "ui": null}))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(serde_json::json!({
        "tools": tools,
        "source": "aphrody-app-server/tools/list",
        "protocol": "JSON-RPC 2.0",
        "m3Parity": false
    }))
}

#[cfg(test)]
mod tool_inventory_tests {
    use super::tools_inventory_from_response;
    use serde_json::json;

    #[test]
    fn lists_only_tools_returned_by_the_owner_without_fabricated_ui_support() {
        let inventory = tools_inventory_from_response(&json!({"result": {"data": [
            {"type": "function", "name": "synthetic_tool", "description": "Synthetic fixture", "parameters": {}}
        ]}})).unwrap();
        assert_eq!(inventory["tools"].as_array().unwrap().len(), 1);
        assert_eq!(inventory["tools"][0]["name"], "synthetic_tool");
        assert!(inventory["tools"][0]["ui"].is_null());
        assert_eq!(inventory["m3Parity"], false);
        assert!(!inventory.to_string().contains("chart_generator"));
    }

    #[test]
    fn errors_and_malformed_responses_never_appear_as_successful_empty_registry() {
        assert_eq!(
            tools_inventory_from_response(&json!({"error": {"message": "fixture unavailable"}}))
                .unwrap_err(),
            "fixture unavailable"
        );
        assert!(tools_inventory_from_response(&json!({})).is_err());
        assert!(tools_inventory_from_response(&json!({"result": {"data": [{}]}})).is_err());
        assert!(tools_inventory_from_response(&json!({"result": {"data": []}})).is_ok());
    }
}
