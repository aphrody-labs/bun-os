// SPDX-License-Identifier: Apache-2.0
//! Authenticated GitHub REST and GraphQL access through Octocrab.

use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, GitHubRepository};

/// HTTP verbs supported by the generic GitHub REST gateway.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ApiMethod {
    /// Read a resource.
    Get,
    /// Create a resource or invoke an action.
    Post,
    /// Partially update a resource.
    Patch,
    /// Replace a resource.
    Put,
    /// Delete a resource.
    Delete,
}

impl ApiMethod {
    /// Whether this method can mutate GitHub state.
    #[must_use]
    pub const fn is_mutating(self) -> bool {
        !matches!(self, Self::Get)
    }
}

impl std::fmt::Display for ApiMethod {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Patch => "PATCH",
            Self::Put => "PUT",
            Self::Delete => "DELETE",
        })
    }
}

impl FromStr for ApiMethod {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_uppercase().as_str() {
            "GET" => Ok(Self::Get),
            "POST" => Ok(Self::Post),
            "PATCH" => Ok(Self::Patch),
            "PUT" => Ok(Self::Put),
            "DELETE" => Ok(Self::Delete),
            _ => Err(Error::Git(format!("unsupported GitHub API method `{value}`"))),
        }
    }
}

/// Lossless response from the generic REST gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiResponse {
    /// HTTP status code.
    pub status: u16,
    /// Parsed JSON body, raw string, or `null` for an empty response.
    pub body: Value,
}

/// Native GitHub client. Its token is held inside Octocrab's secret auth state.
#[derive(Clone)]
pub struct GitHubClient {
    inner: octocrab::Octocrab,
    graphql: octocrab::Octocrab,
    api_base: String,
    graphql_base: String,
    authenticated: bool,
}

impl std::fmt::Debug for GitHubClient {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GitHubClient")
            .field("api_base", &self.api_base)
            .field("graphql_base", &self.graphql_base)
            .field("authenticated", &self.authenticated)
            .finish_non_exhaustive()
    }
}

impl GitHubClient {
    /// Build a client from `GH_TOKEN`/`GITHUB_TOKEN` and `GITHUB_API_URL`, falling back to
    /// the GitHub CLI login of `APHRODY_GITHUB_USER` (or its active account) for that host.
    /// Anonymous access remains available for public read-only endpoints.
    pub fn from_env() -> Result<Self, Error> {
        let api_base = std::env::var("GITHUB_API_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "https://api.github.com".to_owned());
        let token = env_value("GH_TOKEN")
            .or_else(|| env_value("GITHUB_TOKEN"))
            .or_else(|| gh_cli_token(&api_base, env_value("APHRODY_GITHUB_USER").as_deref()));
        let graphql_url =
            std::env::var("GITHUB_GRAPHQL_URL").ok().filter(|value| !value.trim().is_empty());
        Self::new_with_graphql_url(token, api_base, graphql_url.as_deref())
    }

    /// Build a client from an optional token and API base URL.
    pub fn new(token: Option<String>, api_base: impl Into<String>) -> Result<Self, Error> {
        let api_base = api_base.into().trim_end_matches('/').to_owned();
        Self::new_with_graphql_url(token, api_base, None)
    }

    #[allow(clippy::needless_pass_by_value)]
    fn new_with_graphql_url(
        token: Option<String>,
        api_base: impl Into<String>,
        graphql_url: Option<&str>,
    ) -> Result<Self, Error> {
        let api_base = api_base.into().trim_end_matches('/').to_owned();
        let graphql_url = graphql_url
            .map(|value| value.trim_end_matches('/').to_owned())
            .unwrap_or_else(|| default_graphql_url(&api_base));
        ensure_same_origin(&api_base, &graphql_url)?;
        let graphql_base = graphql_url
            .strip_suffix("/graphql")
            .ok_or_else(|| {
                Error::Git(format!("GitHub GraphQL URL must end with `/graphql`: `{graphql_url}`"))
            })?
            .to_owned();
        let authenticated = token.is_some();
        let mut builder = octocrab::Octocrab::builder().base_uri(&api_base)?;
        let mut graphql_builder = octocrab::Octocrab::builder().base_uri(&graphql_base)?;
        if let Some(token) = token.as_ref() {
            builder = builder.personal_token(token.clone());
            graphql_builder = graphql_builder.personal_token(token.clone());
        }
        Ok(Self {
            inner: builder.build()?,
            graphql: graphql_builder.build()?,
            api_base,
            graphql_base,
            authenticated,
        })
    }

    /// Whether a runtime token was configured.
    #[must_use]
    pub const fn is_authenticated(&self) -> bool {
        self.authenticated
    }

    /// Access the underlying Octocrab client for typed APIs not wrapped here.
    #[must_use]
    pub const fn octocrab(&self) -> &octocrab::Octocrab {
        &self.inner
    }

    /// Fetch the canonical repository resource.
    pub async fn repository(&self, repository: &GitHubRepository) -> Result<Value, Error> {
        let route = format!("/repos/{}/{}", repository.owner, repository.name);
        Ok(self.request(ApiMethod::Get, &route, None).await?.body)
    }

    /// Execute any GitHub REST endpoint with authentication, including 204 responses.
    pub async fn request(
        &self,
        method: ApiMethod,
        route: &str,
        body: Option<&Value>,
    ) -> Result<ApiResponse, Error> {
        let url = self.absolute_url(route)?;
        let response = match method {
            ApiMethod::Get => self.inner._get(url).await?,
            ApiMethod::Post => self.inner._post(url, body).await?,
            ApiMethod::Patch => self.inner._patch(url, body).await?,
            ApiMethod::Put => self.inner._put(url, body).await?,
            ApiMethod::Delete => self.inner._delete(url, body).await?,
        };
        let status = response.status().as_u16();
        let text = self.inner.body_to_string(response).await?;
        if !(200..300).contains(&status) {
            return Err(Error::GitHubStatus { status, body: text });
        }
        let body = if text.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text).unwrap_or(Value::String(text))
        };
        Ok(ApiResponse { status, body })
    }

    /// Execute a GitHub GraphQL query or mutation.
    pub async fn graphql(&self, payload: &Value) -> Result<Value, Error> {
        Ok(self.graphql.graphql(payload).await?)
    }

    fn absolute_url(&self, route: &str) -> Result<String, Error> {
        if route.starts_with("https://") {
            let base = url::Url::parse(&self.api_base)
                .map_err(|error| Error::Git(format!("invalid GitHub API base URL: {error}")))?;
            let candidate = url::Url::parse(route)
                .map_err(|error| Error::Git(format!("invalid GitHub API route: {error}")))?;
            let same_origin = candidate.scheme() == base.scheme()
                && candidate.host_str() == base.host_str()
                && candidate.port_or_known_default() == base.port_or_known_default()
                && candidate.username() == base.username()
                && candidate.password() == base.password();
            let base_path = base.path().trim_end_matches('/');
            let path_in_base = base_path.is_empty()
                || candidate.path() == base_path
                || candidate
                    .path()
                    .strip_prefix(base_path)
                    .is_some_and(|suffix| suffix.starts_with('/'));
            if !same_origin || !path_in_base {
                return Err(Error::Git(format!(
                    "GitHub API route must stay under `{}`",
                    self.api_base
                )));
            }
            return Ok(route.to_owned());
        }
        if !route.starts_with('/') {
            return Err(Error::Git(format!("GitHub API route must start with `/`: `{route}`")));
        }
        if route.starts_with("//") {
            return Err(Error::Git(format!(
                "GitHub API route must not be scheme-relative: `{route}`"
            )));
        }
        Ok(format!("{}{}", self.api_base, route))
    }
}

fn default_graphql_url(api_base: &str) -> String {
    if let Some(prefix) = api_base.strip_suffix("/api/v3") {
        format!("{prefix}/api/graphql")
    } else {
        format!("{}/graphql", api_base.trim_end_matches('/'))
    }
}

fn ensure_same_origin(api_base: &str, graphql_url: &str) -> Result<(), Error> {
    let api = url::Url::parse(api_base)
        .map_err(|error| Error::Git(format!("invalid GitHub API base URL: {error}")))?;
    let graphql = url::Url::parse(graphql_url)
        .map_err(|error| Error::Git(format!("invalid GitHub GraphQL URL: {error}")))?;
    let same_origin = api.scheme() == graphql.scheme()
        && api.host_str() == graphql.host_str()
        && api.port_or_known_default() == graphql.port_or_known_default()
        && api.username() == graphql.username()
        && api.password() == graphql.password();
    if !same_origin {
        return Err(Error::Git(
            "GitHub REST and GraphQL URLs must have the same origin".to_owned(),
        ));
    }
    Ok(())
}

fn env_value(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.trim().is_empty())
}

/// Token of a GitHub CLI login: read from `hosts.yml` when `gh` stored it there, otherwise asked
/// to `gh auth token` (keyring storage, the default on Windows and macOS).
fn gh_cli_token(api_base: &str, user: Option<&str>) -> Option<String> {
    let dir = env_value("GH_CONFIG_DIR").map(std::path::PathBuf::from).or_else(|| {
        env_value("XDG_CONFIG_HOME")
            .map(|base| std::path::PathBuf::from(base).join("gh"))
            .or_else(|| {
                env_value("APPDATA").map(|base| std::path::PathBuf::from(base).join("GitHub CLI"))
            })
            .or_else(|| {
                env_value("HOME").map(|home| std::path::PathBuf::from(home).join(".config/gh"))
            })
    });
    dir.and_then(|dir| std::fs::read_to_string(dir.join("hosts.yml")).ok())
        .and_then(|text| hosts_token(&text, api_base, user))
        .or_else(|| gh_keyring_token(api_base, user))
}

fn gh_keyring_token(api_base: &str, user: Option<&str>) -> Option<String> {
    let host = url::Url::parse(api_base).ok()?.host_str()?.to_owned();
    let host = if host == "api.github.com" { "github.com".to_owned() } else { host };
    let mut cmd = std::process::Command::new("gh");
    cmd.args(["auth", "token", "--hostname", &host]);
    if let Some(user) = user {
        cmd.args(["--user", user]);
    }
    let out =
        cmd.stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output().ok()?;
    let token = String::from_utf8(out.stdout).ok()?.trim().to_owned();
    (out.status.success() && !token.is_empty()).then_some(token)
}

fn hosts_token(hosts_yml: &str, api_base: &str, user: Option<&str>) -> Option<String> {
    let host = url::Url::parse(api_base).ok()?.host_str()?.to_owned();
    let host = if host == "api.github.com" { "github.com".to_owned() } else { host };
    let hosts: serde_yaml::Value = serde_yaml::from_str(hosts_yml).ok()?;
    let entry = hosts.get(host.as_str())?;
    let account = user.or_else(|| entry.get("user").and_then(serde_yaml::Value::as_str))?;
    let token = entry
        .get("users")
        .and_then(|users| users.get(account))
        .and_then(|login| login.get("oauth_token"))
        .and_then(serde_yaml::Value::as_str)
        .or_else(|| {
            (user.is_none() || entry.get("user").and_then(serde_yaml::Value::as_str) == user)
                .then(|| entry.get("oauth_token").and_then(serde_yaml::Value::as_str))
                .flatten()
        })?;
    (!token.trim().is_empty()).then(|| token.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOSTS: &str = "github.com:\n    users:\n        alice:\n            oauth_token: tok_alice\n        bob:\n            oauth_token: tok_bob\n    git_protocol: https\n    user: bob\n    oauth_token: tok_bob\n";

    #[test]
    fn gh_cli_token_follows_selected_or_active_account() {
        assert_eq!(hosts_token(HOSTS, "https://api.github.com", None).as_deref(), Some("tok_bob"));
        assert_eq!(
            hosts_token(HOSTS, "https://api.github.com", Some("alice")).as_deref(),
            Some("tok_alice")
        );
        assert_eq!(hosts_token(HOSTS, "https://api.github.com", Some("carol")), None);
        assert_eq!(hosts_token(HOSTS, "https://ghe.example/api/v3", None), None);
    }

    /// Install a rustls crypto provider once for this test binary.
    ///
    /// rustls 0.23 cannot pick between `ring` and `aws-lc-rs` on its own, and
    /// a unit-test binary runs none of the startup code where the real
    /// binaries install one — so the first client built here panics with
    /// "Could not automatically determine the process-level CryptoProvider"
    /// (CLAUDE.md §7).
    fn install_rustls_provider() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    #[test]
    fn method_mutability_is_explicit() {
        assert!(!ApiMethod::Get.is_mutating());
        assert!(ApiMethod::Post.is_mutating());
        assert!(ApiMethod::Delete.is_mutating());
    }

    #[tokio::test]
    async fn debug_never_contains_token() {
        install_rustls_provider();
        let client = GitHubClient::new(
            Some("ghp_never_print_this_value".to_owned()),
            "https://api.github.com",
        )
        .unwrap();
        let rendered = format!("{client:?}");
        assert!(!rendered.contains("never_print"));
        assert!(rendered.contains("authenticated: true"));
    }

    #[tokio::test]
    async fn rejects_routes_outside_configured_api() {
        install_rustls_provider();
        let client = GitHubClient::new(None, "https://api.github.com").unwrap();
        assert!(client.absolute_url("https://example.com/repos/a/b").is_err());
        assert!(client.absolute_url("https://api.github.com.evil.test/repos/a/b").is_err());
        assert!(client.absolute_url("//evil.example/repos/a/b").is_err());

        let enterprise = GitHubClient::new(None, "https://github.example/api/v3").unwrap();
        assert!(enterprise.absolute_url("https://github.example/api/v30/repos/a/b").is_err());
        assert_eq!(
            enterprise.absolute_url("https://github.example/api/v3/repos/a/b").unwrap(),
            "https://github.example/api/v3/repos/a/b"
        );
    }

    #[test]
    fn derives_saas_and_enterprise_graphql_urls() {
        assert_eq!(default_graphql_url("https://api.github.com"), "https://api.github.com/graphql");
        assert_eq!(
            default_graphql_url("https://github.example/api/v3"),
            "https://github.example/api/graphql"
        );
        assert!(
            ensure_same_origin("https://github.example/api/v3", "https://evil.example/api/graphql")
                .is_err()
        );
    }
}
