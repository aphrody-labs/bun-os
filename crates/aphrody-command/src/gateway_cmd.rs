// SPDX-License-Identifier: Apache-2.0
//! CLI entry point for Aphrody's OpenAI-compatible AI Gateway (`aphrody gateway`).

use std::{net::SocketAddr, sync::Arc};

#[cfg(target_os = "windows")]
use aphrody_gateway::google_antigravity::ANTIGRAVITY_BASE_URL;
use aphrody_gateway::{
    GatewayAdapter, ModelClientAdapter,
    gemini_cli::GeminiCliAdapter,
    google_antigravity::{ANTIGRAVITY_MODEL_IDS, GoogleAntigravityAdapter},
    openai_proxy::OpenAiProxyAdapter,
    serve_gateway,
};
use clap::Subcommand;

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum GatewayAction {
    /// Start serving the OpenAI-compatible HTTP AI Gateway (default: 127.0.0.1:8786).
    Serve {
        /// Socket address to bind (e.g. 127.0.0.1:8786).
        #[arg(long, default_value = "127.0.0.1:8786")]
        addr: String,

        /// Provider: "configured" (canonical ModelClient), "mistralrs", "auto", "google-antigravity", "gemini-cli", or "openai".
        #[arg(long, default_value = "auto")]
        provider: String,
    },
    /// Query the status of a running gateway.
    Status {
        /// Socket address of the gateway to check.
        #[arg(long, default_value = "127.0.0.1:8786")]
        addr: String,
    },
    /// List models available through the gateway.
    Models {
        /// Socket address of the gateway to query, or query local provider if not running.
        #[arg(long, default_value = "127.0.0.1:8786")]
        addr: String,
    },
}

impl Default for GatewayAction {
    fn default() -> Self {
        Self::Serve {
            addr: "127.0.0.1:8786".to_string(),
            provider: "auto".to_string(),
        }
    }
}

pub(crate) async fn run(action: GatewayAction) -> miette::Result<()> {
    match action {
        GatewayAction::Serve { addr, provider } => {
            let socket_addr: SocketAddr = addr
                .parse()
                .map_err(|e| miette::miette!("invalid socket address {addr}: {e}"))?;

            let (adapter, models) = resolve_adapter(&provider)?;
            println!("aphrody gateway listening on http://{socket_addr} (provider: {provider})");
            println!("OpenAI-compatible endpoints:");
            println!("  POST http://{socket_addr}/v1/chat/completions");
            println!("  GET  http://{socket_addr}/v1/models");
            println!("  GET  http://{socket_addr}/health");

            serve_gateway(socket_addr, adapter, models)
                .await
                .map_err(|e| miette::miette!("gateway server error: {e}"))?;
        }
        GatewayAction::Status { addr } => {
            let client = gateway_http_client()?;
            let url = format!("http://{addr}/health");
            match client.get(&url).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    println!("Gateway at http://{addr}: {status}\n{text}");
                }
                Err(err) => {
                    return Err(miette::miette!(
                        "Failed to reach gateway at http://{addr}: {err}"
                    ));
                }
            }
        }
        GatewayAction::Models { addr } => {
            let client = gateway_http_client()?;
            let url = format!("http://{addr}/v1/models");
            let token = if let Some(path) = std::env::var_os("APHRODY_AI_HTTP_TOKEN_FILE") {
                Some(
                    aphrody_config::credential_file::read_credential_file(std::path::Path::new(
                        &path,
                    ))
                    .map_err(|error| miette::miette!("{error}"))?,
                )
            } else {
                aphrody_config::ai_env::HTTP_TOKEN.resolve().or_else(|| {
                    std::env::var("APHRODY_OS_AUTH_TOKEN")
                        .ok()
                        .filter(|token| !token.trim().is_empty())
                })
            };
            match gateway_models_request(&client, &url, token.as_deref()).await {
                Ok(text) => {
                    println!("{text}");
                }
                Err(error) if error.is_connect() => {
                    // Fall back to printing catalog models when server is not running
                    let models = advertised_models("local");
                    let data: Vec<_> = models
                        .into_iter()
                        .map(|id| serde_json::json!({ "id": id, "object": "model" }))
                        .collect();
                    println!(
                        "{}",
                        serde_json::to_string_pretty(
                            &serde_json::json!({ "object": "list", "data": data })
                        )
                        .unwrap_or_default()
                    );
                }
                Err(error) => {
                    return Err(miette::miette!("gateway model discovery failed: {error}"));
                }
            }
        }
    }
    Ok(())
}

fn gateway_http_client() -> miette::Result<reqwest::Client> {
    // Gateway addresses name a direct loopback/mesh service, not a public
    // proxy target. Bound discovery and liveness even while its host reboots.
    reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|error| miette::miette!("gateway HTTP client: {error}"))
}

async fn gateway_models_request(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
) -> reqwest::Result<String> {
    let mut request = client.get(url);
    if let Some(token) = token {
        request = request.bearer_auth(token.trim());
    }
    request.send().await?.error_for_status()?.text().await
}

fn resolve_adapter(provider: &str) -> miette::Result<(Arc<dyn GatewayAdapter>, Vec<String>)> {
    if matches!(provider, "configured" | "mistralrs") {
        // Reuse the same configuration/factory as the agent surfaces. A
        // custom Mistral.rs provider selects the actual declared Rust server;
        // discovery alone never starts an engine or allocates a GPU.
        let overrides = if provider == "configured" {
            Vec::new()
        } else {
            vec![format!("model_provider=\"{provider}\"")]
        };
        let profile = std::env::var("APHRODY_PROFILE").ok();
        let (config, warnings) =
            aphrody_diagnostics::config::resolve_config(profile, false, None, &overrides)?;
        for warning in warnings {
            eprintln!("warning: {warning}");
        }
        let client = aphrody_agent_runtime::ModelFactory::build(&config)
            .map_err(|error| miette::miette!("configured provider: {error}"))?;
        let models = vec![client.model_id().to_owned()];
        return Ok((Arc::new(ModelClientAdapter::new(client)), models));
    }

    if provider == "google-antigravity" || provider == "auto" {
        if let Ok(adapter) = GoogleAntigravityAdapter::from_env() {
            return Ok((Arc::new(adapter), advertised_models("google-antigravity")));
        }

        #[cfg(target_os = "windows")]
        {
            if let Ok(token) = aphrody_antigravity::auth::token_from_credential_manager()
                && let Ok(adapter) =
                    GoogleAntigravityAdapter::new(token.access_token, ANTIGRAVITY_BASE_URL)
            {
                return Ok((Arc::new(adapter), advertised_models("google-antigravity")));
            }
        }
    }

    if (provider == "openai" || provider == "auto")
        && let Ok(adapter) = OpenAiProxyAdapter::from_env()
    {
        return Ok((Arc::new(adapter), advertised_models("openai")));
    }

    if (provider == "gemini-cli" || provider == "auto")
        && let Ok(adapter) = GeminiCliAdapter::from_env()
    {
        return Ok((Arc::new(adapter), advertised_models("gemini-cli")));
    }

    if provider == "local" || provider == "auto" {
        return Err(miette::miette!(
            "Local gateway inference is not wired to a model execution backend. Installed/catalogued weights alone do not provide a chat engine; no response was generated."
        ));
    }

    Err(unconfigured_provider_error(provider))
}

fn advertised_models(provider: &str) -> Vec<String> {
    advertised_models_for(
        provider,
        aphrody_config::ai_env::CHAT_MODEL.resolve().as_deref(),
    )
}

fn advertised_models_for(provider: &str, configured_chat_model: Option<&str>) -> Vec<String> {
    match provider {
        "google-antigravity" => ANTIGRAVITY_MODEL_IDS
            .iter()
            .map(|id| (*id).to_owned())
            .collect(),
        "local" | "auto" => {
            let catalog = aphrody_models::Catalog::builtin();
            catalog.entries.iter().map(|e| e.id.clone()).collect()
        }
        "openai" => configured_chat_model
            .map(str::trim)
            .filter(|model| !model.is_empty())
            .map(|model| vec![model.to_owned()])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn unconfigured_provider_error(provider: &str) -> miette::Report {
    miette::miette!("requested provider '{provider}' could not be initialized from environment")
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;

    async fn authenticated_models_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let url = format!("http://{}/v1/models", listener.local_addr().expect("addr"));
        let server = tokio::spawn(async move {
            tokio::time::timeout(std::time::Duration::from_secs(5), async move {
                let (mut socket, _) = listener.accept().await.expect("accept");
                let mut headers = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !headers.ends_with(b"\r\n\r\n") {
                    let count = socket.read(&mut buffer).await.expect("read");
                    assert!(count > 0 && headers.len() + count <= 8192);
                    headers.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8(headers).expect("headers");
                assert!(request.starts_with("GET /v1/models HTTP/1.1\r\n"));
                let authorized = request.lines().any(|line| {
                    line.eq_ignore_ascii_case("authorization: Bearer gateway-test-only")
                });
                let (status, body) = if authorized {
                    ("200 OK", r#"{"object":"list","data":[{"id":"gemma4-e2b"}]}"#)
                } else {
                    ("401 Unauthorized", r#"{"error":"missing gateway credential"}"#)
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.expect("write");
            })
            .await
            .expect("bounded server");
        });
        (url, server)
    }

    #[tokio::test]
    async fn gateway_models_sends_bearer_and_refuses_http_auth_errors() {
        obscura_net::ensure_rustls_crypto_provider();
        let client = gateway_http_client().expect("client");
        let (url, server) = authenticated_models_server().await;
        let body = gateway_models_request(&client, &url, Some(" gateway-test-only "))
            .await
            .expect("authenticated models");
        assert!(body.contains("gemma4-e2b"));
        server.await.expect("server");

        let (url, server) = authenticated_models_server().await;
        let error = gateway_models_request(&client, &url, None)
            .await
            .expect_err("401 rejected");
        assert_eq!(error.status(), Some(reqwest::StatusCode::UNAUTHORIZED));
        server.await.expect("server");
    }

    #[test]
    fn local_gateway_refuses_to_fabricate_inference() {
        let result = resolve_adapter("local");
        assert!(result.is_err());
        assert!(
            result
                .err()
                .unwrap()
                .to_string()
                .contains("no response was generated")
        );
    }

    #[test]
    fn advertised_models_include_local_catalog() {
        let models = advertised_models("local");
        assert!(!models.is_empty());
    }

    #[test]
    fn advertised_models_are_provider_specific() {
        assert!(
            advertised_models("google-antigravity")
                .iter()
                .all(|id| id.starts_with("gemini-"))
        );
        assert_eq!(
            advertised_models_for("openai", Some("fixture-chat-v2")),
            ["fixture-chat-v2"]
        );
        assert!(advertised_models_for("openai", Some("  ")).is_empty());
        assert!(advertised_models_for("openai", None).is_empty());
        assert!(advertised_models("gemini-cli").is_empty());
    }
}
