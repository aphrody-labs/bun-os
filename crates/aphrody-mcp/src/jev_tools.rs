// SPDX-License-Identifier: Apache-2.0
//! `aphrody_jev_decide`: Jev typed decisions over MCP.
//!
//! The router is built once from the environment (`TYPESAFE_API_KEY`,
//! `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, `JEFF_BASE_URL`); routing,
//! failover and response validation live in `aphrody-jev`.

use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

use aphrody_jev::{DEFAULT_MODEL, JevRouter, Question, Request};
use rmcp::schemars;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub(crate) struct JevDecideRequest {
    #[schemars(description = "Content to judge: a string, or a JSON object/array.")]
    pub(crate) state: serde_json::Value,
    #[schemars(description = "Named typed questions. Each value is one of \
                              {\"type\":\"noul\",\"instructions\":\"...\"}, \
                              {\"type\":\"choice\",\"instructions\":\"...\",\"criteria\":{\"\
                              option\":\"meaning\"}} (two options or more), or \
                              {\"type\":\"score\",\"instructions\":\"...\",\"criteria\":[\"\
                              lowest\",\"...\",\"highest\"]}.")]
    pub(crate) questions: BTreeMap<String, serde_json::Value>,
    #[schemars(description = "Model id; defaults to jev-latest.")]
    pub(crate) model: Option<String>,
    #[schemars(
        description = "Optional Choice confidence threshold in [0, 1]; below it selections abstain without removing raw answers."
    )]
    pub(crate) minimum_confidence: Option<f64>,
}

fn router() -> Result<&'static Arc<JevRouter>, String> {
    static ROUTER: OnceLock<Arc<JevRouter>> = OnceLock::new();
    configured_router(&ROUTER, || {
        let endpoint = aphrody_config::ai_env::CHAT_BASE_URL.resolve();
        JevRouter::from_env_with_native_endpoint(endpoint.as_deref())
    })
}

fn configured_router(
    cache: &OnceLock<Arc<JevRouter>>,
    build: impl FnOnce() -> Result<JevRouter, aphrody_jev::JevError>,
) -> Result<&Arc<JevRouter>, String> {
    if cache.get().is_none() {
        let router = build().map_err(|error| error.to_string())?;
        let _ = cache.set(Arc::new(router));
    }
    cache
        .get()
        .ok_or_else(|| "Jev router initialization failed".into())
}

/// Run one decision and render the result (or error) as JSON text.
pub(crate) async fn jev_decide(request: JevDecideRequest) -> String {
    if let Some(threshold) = request.minimum_confidence
        && let Err(error) = aphrody_jev::validate_confidence_threshold(threshold)
    {
        return error_json(&error.to_string());
    }
    let minimum_confidence = request.minimum_confidence;
    let questions = match request
        .questions
        .into_iter()
        .map(|(name, value)| {
            serde_json::from_value::<Question>(value)
                .map(|question| (name.clone(), question))
                .map_err(|error| format!("question `{name}`: {error}"))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()
    {
        Ok(questions) => questions,
        Err(error) => return error_json(&error),
    };
    let request = Request {
        state: request.state,
        model: request.model.unwrap_or_else(|| DEFAULT_MODEL.to_owned()),
        questions,
    };
    if let Err(error) = aphrody_jev::check_request(&request) {
        return error_json(&error.to_string());
    }
    let router = match router() {
        Ok(router) => router,
        Err(error) => return error_json(&error),
    };
    decide_with_router(&request, minimum_confidence, router).await
}

async fn decide_with_router(
    request: &Request,
    minimum_confidence: Option<f64>,
    router: &JevRouter,
) -> String {
    match router.decide(request).await {
        Ok(decision) => {
            match aphrody_jev::decision_output(request, &decision, minimum_confidence) {
                Ok(output) => output.to_string(),
                Err(error) => error_json(&error.to_string()),
            }
        }
        Err(error) => error_json(&error.to_string()),
    }
}

fn error_json(message: &str) -> String {
    serde_json::json!({ "error": message }).to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn empty_questions_are_rejected_before_backend_configuration() {
        let out = jev_decide(JevDecideRequest {
            state: json!("synthetic fixture"),
            questions: BTreeMap::new(),
            model: None,
            minimum_confidence: None,
        })
        .await;
        let output: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(
            output["error"]
                .as_str()
                .unwrap()
                .contains("1 to 64 named questions")
        );
    }

    #[tokio::test]
    async fn confidence_threshold_is_rejected_before_router_initialization() {
        let out = jev_decide(JevDecideRequest {
            state: json!("synthetic fixture"),
            questions: BTreeMap::new(),
            model: None,
            minimum_confidence: Some(f64::NAN),
        })
        .await;
        let output: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(
            output["error"]
                .as_str()
                .unwrap()
                .contains("confidence threshold")
        );
    }

    #[tokio::test]
    async fn mcp_selections_share_the_http_policy_and_preserve_raw_answers() {
        use axum::{Json, Router, routing::post};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new().route("/v1/systemone", post(|| async {
            Json(json!({"model":"fixture","usage":null,"answers":{"tool":{"type":"choice","choice":"read","confidence":0.7,"probabilities":{"read":0.7,"search":0.3}}}}))
        }));
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let router = JevRouter::new(
            None,
            None,
            Some(aphrody_jev::Endpoint::local(&base, None).unwrap()),
            aphrody_jev::RoutingPolicy::default(),
        )
        .unwrap();
        let request = Request::new("synthetic routing fixture").question(
            "tool",
            Question::choice("Select a tool", [("read", "Read"), ("search", "Search")]),
        );
        for (threshold, selected) in [(0.8, serde_json::Value::Null), (0.6, json!("read"))] {
            let output: serde_json::Value =
                serde_json::from_str(&decide_with_router(&request, Some(threshold), &router).await)
                    .unwrap();
            assert!(output.get("selections").is_some());
            assert_eq!(output["selections"]["tool"], selected);
            assert_eq!(output["answers"]["tool"]["confidence"], 0.7);
        }
        let output: serde_json::Value =
            serde_json::from_str(&decide_with_router(&request, None, &router).await).unwrap();
        assert!(output.get("selections").is_none());
        task.abort();
    }

    #[test]
    fn unavailable_configuration_can_recover_without_rebuilding_a_valid_router() {
        let cache = OnceLock::new();
        assert!(configured_router(&cache, || Err(aphrody_jev::JevError::NoBackend)).is_err());
        assert!(cache.get().is_none());
        let router = configured_router(&cache, || {
            JevRouter::new(
                None,
                None,
                Some(aphrody_jev::Endpoint::local("http://127.0.0.1:8790", None)?),
                aphrody_jev::RoutingPolicy::default(),
            )
        })
        .unwrap();
        let cached =
            configured_router(&cache, || panic!("a valid router must stay shared")).unwrap();
        assert!(Arc::ptr_eq(router, cached));
    }

    #[tokio::test]
    async fn untyped_question_is_rejected_before_routing() {
        let out = jev_decide(JevDecideRequest {
            state: json!("text"),
            questions: BTreeMap::from([(
                "q".to_owned(),
                json!({ "type": "free", "instructions": "x" }),
            )]),
            model: None,
            minimum_confidence: None,
        })
        .await;
        let value: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(
            value["error"].as_str().unwrap().contains("question `q`"),
            "{out}"
        );
    }
}
