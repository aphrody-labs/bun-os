// SPDX-License-Identifier: Apache-2.0
//! Canonical app-ui HTTP and shared assets. Runtime capabilities remain in the Bun fork.
#![forbid(unsafe_code)]

pub mod assets;
pub mod catalog;
pub mod docs;
pub mod m3;
pub mod reference;
pub mod search;
pub mod templates;
pub mod ui;
pub use catalog::{Catalog, CatalogView, SearchFilter};

use aphrody_http_error::api::{Op, Service};
use axum::{
    Router,
    extract::{Query, State},
    http::{StatusCode, Uri},
    response::{IntoResponse, Redirect, Response},
    routing::get,
};
use serde_json::Value;
use std::{io, net::SocketAddr, path::Path, sync::Arc};

/// Public API of the site: https://api.aphrody.com/v1/site/ (mounted at `/api`; docs/ops/API.md).
pub const API: Service = Service {
    name: "site",
    title: "Aphrody site",
    version: env!("CARGO_PKG_VERSION"),
    description: "Read-only product site APIs: documentation and template catalog, web search, the Material 3 design reference (tokens, specs, documents, assets) and generated M3 stylesheets.",
    ops: &[
        Op::get("/docs", "Search documentation")
            .tag("catalog")
            .query(&["q", "category", "id"]),
        Op::get("/templates", "Template catalog").tag("catalog"),
        Op::get("/search", "Web search")
            .tag("search")
            .query(&["query", "vertical", "hl", "safe", "start"]),
        Op::get("/design", "Design reference summary").tag("design"),
        Op::get("/design/tokens", "M3 design tokens").tag("design"),
        Op::get("/design/tokens/high-contrast", "High-contrast tokens").tag("design"),
        Op::get("/design/style-tokens", "Style tokens").tag("design"),
        Op::get("/design/assets", "Design assets").tag("design"),
        Op::get("/design/specs", "Component specs").tag("design"),
        Op::get("/design/specs/{slug*}", "One component spec").tag("design"),
        Op::get("/design/docs", "Design documents").tag("design"),
        Op::get("/design/docs/{slug*}", "One design document").tag("design"),
        Op::get("/design/google", "Google design catalog").tag("design"),
        Op::get("/design/google/docs/{slug*}", "One Google design document").tag("design"),
        Op::get("/m3/css", "Generated M3 stylesheet")
            .tag("design")
            .content("text/css")
            .query(&["sheet", "seed", "variant", "dark", "contrast"]),
    ],
};

async fn health() -> Response {
    aphrody_http_error::api::health(
        API.name,
        API.version,
        option_env!("APHRODY_COMMIT"),
        option_env!("APHRODY_CHANNEL"),
        &[],
        Value::Null,
    )
}

struct Site {
    catalog: Arc<Catalog>,
    webos_url: Option<String>,
    ui: ui::AppUi,
}

/// Build a read-only site from an explicit repository root. No host execution,
/// mutable filesystem endpoints, provider cookies or implicit privileged proxy.
pub fn router(root: &Path, webos_url: Option<&str>) -> io::Result<Router> {
    Ok(router_with_ui(
        Arc::new(Catalog::load(root)?),
        webos_url,
        ui::AppUi::for_workspace(root)?,
    )?
    .merge(assets::SharedAssets::for_workspace(root)?.router())
    .merge(reference::ReferenceCorpus::for_workspace(root)?.router())
    .merge(m3::router()))
}

/// Compose these product routes into the app/API server using the same snapshot.
pub fn router_from_catalog(catalog: Arc<Catalog>, webos_url: Option<&str>) -> io::Result<Router> {
    let root = std::env::current_dir()?;
    Ok(
        router_with_ui(catalog, webos_url, ui::AppUi::for_workspace(&root)?)?
            .merge(assets::SharedAssets::for_workspace(&root)?.router())
            .merge(reference::ReferenceCorpus::for_workspace(&root)?.router())
            .merge(m3::router()),
    )
}

fn router_with_ui(
    catalog: Arc<Catalog>,
    webos_url: Option<&str>,
    ui: ui::AppUi,
) -> io::Result<Router> {
    let webos_url = webos_url
        .map(|value| {
            let url = url::Url::parse(value)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid WebOS URL",
                ));
            }
            Ok(url.to_string())
        })
        .transpose()?;
    let site = Arc::new(Site {
        catalog,
        webos_url,
        ui,
    });
    Ok(Router::new()
        .route("/api/docs", get(documents))
        .route("/api/templates", get(template_catalog))
        .route("/api/search", get(search::search))
        .route("/webos", get(webos))
        .route("/health", get(health))
        .route("/api/health", get(health))
        .merge(API.routes_at("/api"))
        .fallback(app_ui)
        .with_state(site))
}

/// Shared standalone/CLI entrypoint. App and MCP consume the library directly.
pub async fn serve(root: &Path, bind: SocketAddr, webos_url: Option<&str>) -> io::Result<()> {
    let app = router(root, webos_url)?;
    let listener = tokio::net::TcpListener::bind(bind).await?;
    println!("Aphrody site: http://{}", listener.local_addr()?);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
}

/// Join server work on both terminal interrupt and container/platform termination.
pub async fn shutdown_signal() {
    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {},
                    _ = terminate.recv() => {},
                }
            }
            Err(_) => {
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

async fn app_ui(State(site): State<Arc<Site>>, uri: Uri) -> Response {
    site.ui.response(uri.path()).await
}

async fn documents(
    State(site): State<Arc<Site>>,
    Query(filter): Query<SearchFilter>,
) -> axum::Json<Value> {
    axum::Json(site.catalog.search_docs(&filter))
}

async fn template_catalog(State(site): State<Arc<Site>>) -> axum::Json<Value> {
    axum::Json(site.catalog.templates.clone())
}

async fn webos(State(site): State<Arc<Site>>) -> Response {
    site.webos_url.as_ref().map_or_else(
        || (StatusCode::SERVICE_UNAVAILABLE, "WebOS indisponible").into_response(),
        |url| Redirect::temporary(url).into_response(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::{Request, header},
    };
    use tower::ServiceExt;

    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("packages/m3-templates")).unwrap();
        std::fs::write(root.path().join("packages/m3-templates/stack.toml"), "").unwrap();
        let ui = root.path().join("packages/app-ui/dist");
        std::fs::create_dir_all(ui.join("fonts")).unwrap();
        std::fs::write(ui.join("index.html"), "<div id=\"root\">canonical app-ui</div><script type=\"module\" src=\"/app.js\"></script>").unwrap();
        std::fs::write(ui.join("app.js"), "canonical_bundle").unwrap();
        std::fs::write(ui.join("app.css"), "canonical_theme").unwrap();
        std::fs::write(ui.join("fonts/icon.svg"), "<svg></svg>").unwrap();
        root
    }

    #[test]
    fn openapi_snapshot_is_current() {
        API.check_snapshot(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."));
    }

    #[tokio::test]
    async fn serves_the_api_contract() {
        let root = fixture();
        let app = router(root.path(), None).unwrap();
        for path in ["/api/openapi.json", "/api/health", "/health"] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            let body: Value =
                serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                    .unwrap();
            assert!(
                body.get("openapi").is_some() || body["status"] == "ok",
                "{path}"
            );
        }
    }

    #[tokio::test]
    async fn every_product_surface_serves_the_same_canonical_app_ui() {
        let root = fixture();
        let app = router(root.path(), None).unwrap();
        for path in [
            "/",
            "/docs",
            "/templates",
            "/material-3",
            "/api/docs",
            "/api/templates",
            "/showcase",
            "/app",
            "/settings/appearance",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            let body = to_bytes(response.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap();
            if path.starts_with("/api/") {
                assert!(serde_json::from_slice::<Value>(&body).unwrap().is_array());
            } else {
                assert_eq!(
                    body.as_ref(),
                    std::fs::read(root.path().join("packages/app-ui/dist/index.html")).unwrap()
                );
            }
        }
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/os/processes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn serves_real_assets_and_refuses_missing_files_and_traversal() {
        let root = fixture();
        let app = router(root.path(), None).unwrap();
        for (path, expected, mime) in [
            (
                "/app.js",
                "canonical_bundle",
                "text/javascript; charset=utf-8",
            ),
            ("/app.css", "canonical_theme", "text/css; charset=utf-8"),
            ("/fonts/icon.svg", "<svg></svg>", "image/svg+xml"),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()[header::CONTENT_TYPE], mime);
            assert_eq!(
                response.headers()[header::X_CONTENT_TYPE_OPTIONS],
                "nosniff"
            );
            assert_eq!(
                to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
                expected.as_bytes()
            );
        }
        for path in [
            "/Cargo.toml",
            "/missing.js",
            "/../Cargo.toml",
            "/%2e%2e/Cargo.toml",
            "/fonts/%2e%2e/%2e%2e/Cargo.toml",
            "/rpc",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }
    }

    #[test]
    fn missing_canonical_artifact_is_an_explicit_error() {
        let root = fixture();
        std::fs::remove_file(root.path().join("packages/app-ui/dist/app.js")).unwrap();
        assert!(router(root.path(), None).is_err());
    }

    #[tokio::test]
    async fn webos_redirect_does_not_proxy_host_capabilities() {
        let root = fixture();
        assert!(router(root.path(), Some("file:///etc/passwd")).is_err());
        assert!(router(root.path(), Some("http://user:password@localhost")).is_err());
        let app = router(root.path(), Some("http://127.0.0.1:3001")).unwrap();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/webos")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            response.headers()[header::LOCATION],
            "http://127.0.0.1:3001/"
        );
    }
}
