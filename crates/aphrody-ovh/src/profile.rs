// SPDX-License-Identifier: Apache-2.0
//! Multi-account profile resolution for OVHcloud infrastructure.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

use crate::client::{AuthMode, OvhCredentials};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileInfo {
    pub id: String,
    pub name: String,
    pub region: String,
    pub domains: Vec<String>,
}

pub fn known_profiles() -> Vec<ProfileInfo> {
    vec![ProfileInfo {
        id: "aphrody.com".into(),
        name: "Aphrody Core".into(),
        region: "ovh-eu".into(),
        domains: vec!["aphrody.com".into()],
    }]
}

/// Per-user file (outside the repository) holding the service account as
/// `export OVH_CLIENT_ID=...` / `export OVH_CLIENT_SECRET=...` lines.
pub const SERVICE_ACCOUNT_ENV_FILE: &str = ".config/aphrody/ovh.env";

/// Parse bash exports, INI keys or certbot `dns_ovh_*` keys. Returns the credentials when at
/// least one authentication mode (OAuth2 pair or application key triplet) is complete.
pub fn parse_credentials_text(content: &str) -> Option<OvhCredentials> {
    let mut vars = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }

        // 1. Check export VAR="VAL" or VAR=VAL
        let stripped = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        if let Some((k, v)) = stripped.split_once('=') {
            let key = k
                .trim()
                .trim_start_matches("dns_ovh_")
                .trim_start_matches("OVH_")
                .to_lowercase();
            let val = v.trim().trim_matches('"').trim_matches('\'').trim();
            vars.insert(key, val.to_string());
        }
    }

    let text = |key: &str| vars.get(key).filter(|v| !v.is_empty()).cloned();
    let creds = OvhCredentials {
        application_key: text("application_key")
            .or_else(|| text("app_key"))
            .unwrap_or_default(),
        application_secret: text("application_secret")
            .or_else(|| text("app_secret"))
            .unwrap_or_default(),
        consumer_key: text("consumer_key").unwrap_or_default(),
        endpoint: text("endpoint").unwrap_or_else(|| "ovh-eu".into()),
        client_id: text("client_id"),
        client_secret: text("client_secret"),
    };
    creds.auth_mode().map(|_| creds)
}

/// Where credentials come from, for reporting (never contains secret values).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialSource {
    Environment,
    File(PathBuf),
}

impl std::fmt::Display for CredentialSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Environment => f.write_str("environment"),
            Self::File(path) => write!(f, "{}", path.display()),
        }
    }
}

fn is_aphrody_target(target: &str) -> bool {
    target.contains("aphrody") || target == "vps"
}

/// Candidate credential files for a profile/domain, most specific first.
fn candidate_files(home: &Path, profile_or_domain: Option<&str>) -> Vec<PathBuf> {
    let target = profile_or_domain.unwrap_or("aphrody.com").to_lowercase();
    let mut candidates = Vec::new();

    // Direct path check if profile_or_domain is a file path
    if let Some(p) = profile_or_domain {
        let explicit = Path::new(p);
        if explicit.exists() {
            candidates.push(explicit.to_path_buf());
        }
    }

    // rpbey.fr was sold and dropped from the aphrody.com account (docs/PLAN.md); its
    // credential-path match is gone too.
    if is_aphrody_target(&target) {
        candidates.push(home.join(SERVICE_ACCOUNT_ENV_FILE));
        candidates.push(home.join(".bash_secrets"));
        candidates.push(home.join(".config/ovh/aphrody.conf"));
    }

    candidates.push(home.join(".ovh.conf"));
    candidates
}

fn parse_candidates(candidates: &[PathBuf]) -> Vec<(PathBuf, OvhCredentials)> {
    candidates
        .iter()
        .filter(|path| path.exists())
        .filter_map(|path| {
            let content = std::fs::read_to_string(path).ok()?;
            parse_credentials_text(&content).map(|creds| (path.clone(), creds))
        })
        .collect()
}

fn environment_triplet(env: &dyn Fn(&str) -> Option<String>) -> Option<OvhCredentials> {
    let get = |key: &str| env(key).filter(|v| !v.is_empty());
    Some(OvhCredentials {
        application_key: get("OVH_APPLICATION_KEY").or_else(|| get("OVH_APP_KEY"))?,
        application_secret: get("OVH_APPLICATION_SECRET").or_else(|| get("OVH_APP_SECRET"))?,
        consumer_key: get("OVH_CONSUMER_KEY")?,
        endpoint: get("OVH_ENDPOINT").unwrap_or_else(|| "ovh-eu".into()),
        ..Default::default()
    })
}

/// Application key triplet only (OAuth2 ignored): needed by routes that refuse service accounts,
/// such as `/service/{id}/renew`. Profile files first, then the environment.
pub fn resolve_legacy_credentials(
    env: &dyn Fn(&str) -> Option<String>,
    home: &Path,
    profile_or_domain: Option<&str>,
) -> Option<OvhCredentials> {
    let candidates = candidate_files(home, profile_or_domain);
    parse_candidates(&candidates)
        .iter()
        .find_map(|(_, creds)| creds.legacy_only())
        .or_else(|| environment_triplet(env))
}

pub fn load_legacy_credentials(profile_or_domain: Option<&str>) -> Option<OvhCredentials> {
    resolve_legacy_credentials(&process_env, &home_dir(), profile_or_domain)
}

/// Pure resolution core. Priority: environment OAuth2 service account (aphrody account only),
/// profile file OAuth2 pair, environment triplet (no profile), profile file triplet, environment
/// triplet.
pub fn resolve_credentials(
    env: &dyn Fn(&str) -> Option<String>,
    home: &Path,
    profile_or_domain: Option<&str>,
) -> Result<(OvhCredentials, CredentialSource)> {
    let get = |key: &str| env(key).filter(|v| !v.is_empty());
    let endpoint = get("OVH_ENDPOINT").unwrap_or_else(|| "ovh-eu".into());
    let target = profile_or_domain.unwrap_or("aphrody.com").to_lowercase();

    // 1. Service account from the environment: it belongs to the aphrody account only.
    if is_aphrody_target(&target)
        && let (Some(id), Some(secret)) = (get("OVH_CLIENT_ID"), get("OVH_CLIENT_SECRET"))
    {
        let creds = OvhCredentials {
            endpoint,
            client_id: Some(id),
            client_secret: Some(secret),
            ..Default::default()
        };
        return Ok((creds, CredentialSource::Environment));
    }

    let candidates = candidate_files(home, profile_or_domain);
    let parsed = parse_candidates(&candidates);

    // 2. OAuth2 pair of a profile file.
    if let Some((path, creds)) = parsed
        .iter()
        .find(|(_, c)| c.auth_mode() == Some(AuthMode::OAuth2))
    {
        return Ok((creds.clone(), CredentialSource::File(path.clone())));
    }

    // 3. Application key triplet: environment (no explicit profile), then files, then environment.
    let env_triplet = environment_triplet(env);
    if profile_or_domain.is_none()
        && let Some(creds) = &env_triplet
    {
        return Ok((creds.clone(), CredentialSource::Environment));
    }
    if let Some((path, creds)) = parsed.first() {
        return Ok((creds.clone(), CredentialSource::File(path.clone())));
    }
    if let Some(creds) = env_triplet {
        return Ok((creds, CredentialSource::Environment));
    }

    bail!(
        "could not find valid OVH credentials for profile '{}': set OVH_CLIENT_ID and OVH_CLIENT_SECRET (service account) or the application key triplet. Checked paths: {:?}",
        profile_or_domain.unwrap_or("default"),
        candidates
    );
}

fn process_env(key: &str) -> Option<String> {
    std::env::var(key).ok()
}

fn home_dir() -> PathBuf {
    PathBuf::from(
        std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".into()),
    )
}

/// Credentials and their origin for a profile, domain or credentials file path.
pub fn load_profile_credentials_with_source(
    profile_or_domain: Option<&str>,
) -> Result<(OvhCredentials, CredentialSource)> {
    resolve_credentials(&process_env, &home_dir(), profile_or_domain)
}

pub fn load_profile_credentials(profile_or_domain: Option<&str>) -> Result<OvhCredentials> {
    load_profile_credentials_with_source(profile_or_domain).map(|(creds, _)| creds)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        move |key| map.get(key).cloned()
    }

    fn write(home: &Path, rel: &str, content: &str) {
        let path = home.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    const TRIPLET_FILE: &str = "export OVH_APPLICATION_KEY=\"ak_f\"\nexport OVH_APPLICATION_SECRET=\"as_f\"\nexport OVH_CONSUMER_KEY=\"ck_f\"\n";
    const OAUTH_INI: &str = "[ovh-eu]\napplication_key = ak_i\napplication_secret = as_i\nconsumer_key = ck_i\nclient_id = id_i\nclient_secret = secret_i\n";

    #[test]
    fn parses_oauth_pair_from_bash_and_ini() {
        let bash = parse_credentials_text(
            "export OVH_CLIENT_ID=id_b\nexport OVH_CLIENT_SECRET=secret_b\n",
        )
        .expect("oauth pair");
        assert_eq!(bash.auth_mode(), Some(AuthMode::OAuth2));
        assert_eq!(bash.client_id.as_deref(), Some("id_b"));

        let ini = parse_credentials_text(OAUTH_INI).expect("ini");
        assert_eq!(ini.auth_mode(), Some(AuthMode::OAuth2));
        assert_eq!(ini.application_key, "ak_i");
        assert!(parse_credentials_text("export OVH_CLIENT_ID=only_half\n").is_none());
    }

    #[test]
    fn environment_oauth_has_top_priority() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".bash_secrets", TRIPLET_FILE);
        let env = env_of(&[
            ("OVH_CLIENT_ID", "env-id"),
            ("OVH_CLIENT_SECRET", "env-secret"),
            ("OVH_APPLICATION_KEY", "a"),
            ("OVH_APPLICATION_SECRET", "b"),
            ("OVH_CONSUMER_KEY", "c"),
        ]);
        let (creds, source) = resolve_credentials(&env, home.path(), None).unwrap();
        assert_eq!(creds.auth_mode(), Some(AuthMode::OAuth2));
        assert_eq!(source, CredentialSource::Environment);
    }

    #[test]
    fn environment_oauth_never_serves_another_account() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".ovh.conf", TRIPLET_FILE);
        let env = env_of(&[
            ("OVH_CLIENT_ID", "env-id"),
            ("OVH_CLIENT_SECRET", "env-secret"),
        ]);
        let (creds, _) = resolve_credentials(&env, home.path(), Some("example.org")).unwrap();
        assert_eq!(creds.auth_mode(), Some(AuthMode::ApplicationKey));
    }

    #[test]
    fn profile_oauth_beats_a_triplet_listed_earlier() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".bash_secrets", TRIPLET_FILE);
        write(home.path(), ".config/ovh/aphrody.conf", OAUTH_INI);
        let (creds, source) = resolve_credentials(&no_env, home.path(), None).unwrap();
        assert_eq!(creds.auth_mode(), Some(AuthMode::OAuth2));
        assert_eq!(
            source,
            CredentialSource::File(home.path().join(".config/ovh/aphrody.conf"))
        );
    }

    #[test]
    fn service_account_env_file_is_a_credential_source() {
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            SERVICE_ACCOUNT_ENV_FILE,
            "export OVH_CLIENT_ID=file-id\nexport OVH_CLIENT_SECRET=file-secret\n",
        );
        let (creds, source) = resolve_credentials(&no_env, home.path(), None).unwrap();
        assert_eq!(creds.client_id.as_deref(), Some("file-id"));
        assert_eq!(
            source,
            CredentialSource::File(home.path().join(SERVICE_ACCOUNT_ENV_FILE))
        );
    }

    #[test]
    fn triplet_remains_the_last_resort() {
        let home = tempfile::tempdir().unwrap();
        let env = env_of(&[
            ("OVH_APPLICATION_KEY", "a"),
            ("OVH_APPLICATION_SECRET", "b"),
            ("OVH_CONSUMER_KEY", "c"),
        ]);
        let (creds, source) = resolve_credentials(&env, home.path(), None).unwrap();
        assert_eq!(creds.auth_mode(), Some(AuthMode::ApplicationKey));
        assert_eq!(source, CredentialSource::Environment);
        assert!(resolve_credentials(&no_env, home.path(), None).is_err());
    }

    #[test]
    fn legacy_resolution_skips_oauth_only_files() {
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            SERVICE_ACCOUNT_ENV_FILE,
            "export OVH_CLIENT_ID=file-id\nexport OVH_CLIENT_SECRET=file-secret\n",
        );
        assert!(resolve_legacy_credentials(&no_env, home.path(), None).is_none());
        write(home.path(), ".config/ovh/aphrody.conf", OAUTH_INI);
        let legacy = resolve_legacy_credentials(&no_env, home.path(), None).unwrap();
        assert_eq!(legacy.auth_mode(), Some(AuthMode::ApplicationKey));
        assert_eq!(legacy.application_key, "ak_i");
    }

    #[test]
    fn resolution_errors_carry_no_secret() {
        let home = tempfile::tempdir().unwrap();
        let env = env_of(&[("OVH_CLIENT_ID", "only-id")]);
        let error = resolve_credentials(&env, home.path(), None)
            .unwrap_err()
            .to_string();
        assert!(!error.contains("only-id"));
    }
}
