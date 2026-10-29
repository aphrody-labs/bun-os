// SPDX-License-Identifier: Apache-2.0
//! Resolve this machine's local AI environment and publish it under the
//! canonical `APHRODY_AI_*` names ([`aphrody_config::ai_env`]).
//!
//! Writer side of the root `tools/aphrody/config/local-ai.json` contract: never
//! an alias and never a secret value.

use std::path::PathBuf;

use aphrody_config::ai_env::{self, CanonicalEnv};
use aphrody_llama_server::{Role, discover_running};
use aphrody_models::{Catalog, LocalRole};
use miette::IntoDiagnostic;

/// One canonical variable's resolved value.
pub struct ResolvedVar {
    pub canonical: &'static str,
    pub value: Option<String>,
    /// `true` for gateway and chat credentials: [`Self::value`] is always `None`
    /// for a secret, and [`Self::note`] explains where the real value lives.
    pub secret: bool,
    pub note: Option<String>,
}

fn plain(canonical: CanonicalEnv, value: Option<String>) -> ResolvedVar {
    ResolvedVar {
        canonical: canonical.canonical,
        value,
        secret: false,
        note: None,
    }
}

/// The binary reachable from this running process: an explicit env override,
/// else the executable currently running (for [`ai_env::BIN`]) or a same-named
/// sibling of it (for [`ai_env::MCP_BIN`]), else `PATH` — the lookup order
/// `tools/aphrody/config/local-ai.json`'s `binaries.*.lookup` documents.
fn resolve_binary(
    canonical: CanonicalEnv,
    sibling_name: &str,
    self_is_current_exe: bool,
) -> ResolvedVar {
    let value = canonical
        .resolve()
        .or_else(|| {
            if self_is_current_exe {
                std::env::current_exe()
                    .ok()
                    .map(|path| path.display().to_string())
            } else {
                sibling_binary(sibling_name)
            }
        })
        .or_else(|| {
            which::which(sibling_name)
                .ok()
                .map(|path| path.display().to_string())
        });
    plain(canonical, value)
}

/// A same-named binary next to the currently running executable, e.g.
/// `aphrody-mcp[.exe]` beside `aphrody[.exe]`.
fn sibling_binary(name: &str) -> Option<String> {
    let current = std::env::current_exe().ok()?;
    let filename = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let candidate = current.with_file_name(filename);
    candidate.is_file().then(|| candidate.display().to_string())
}

/// A capability's base URL: the canonical name or an alias, else a currently
/// running managed `llama-server` instance for `role`
/// ([`aphrody_llama_server::discover_running`] — the one fallback this
/// contract allows in place of a hardcoded port, CLAUDE.md §7). `None` when
/// neither resolves: never a guessed literal.
fn base_url_for(role: Role, canonical: CanonicalEnv) -> Option<String> {
    canonical
        .resolve()
        .or_else(|| discover_running(role).map(|state| state.base_url()))
}

/// A role's model id: the canonical name or an alias, else the local
/// catalog's default for `role`.
fn role_model(role: LocalRole, canonical: CanonicalEnv) -> String {
    canonical
        .resolve()
        .unwrap_or_else(|| role.default_model().to_owned())
}

/// The vector width of `model`: an explicit override
/// ([`ai_env::EMBED_DIMENSIONS`]) when present (a disagreement with the
/// catalog is reported on stderr, not silently resolved — this command only
/// reports the current environment, it does not enforce
/// [`aphrody_rag::resolve_embed`]'s stricter contract), else the catalog's
/// own dimension for `model`.
fn embed_dimensions(model: &str) -> Option<String> {
    let catalog_dim = Catalog::builtin().dimensions(model).ok().flatten();
    if let Some(env_dim) = ai_env::EMBED_DIMENSIONS.resolve() {
        if let (Ok(parsed), Some(catalog_dim)) = (env_dim.parse::<u32>(), catalog_dim)
            && parsed != catalog_dim
        {
            eprintln!(
                "warning: {} (or its alias) is set to {env_dim}, but model `{model}` is \
                 catalogued at {catalog_dim} dimensions; reporting the override as-is",
                ai_env::EMBED_DIMENSIONS.canonical
            );
        }
        return Some(env_dim);
    }
    catalog_dim.map(|dim| dim.to_string())
}

/// Resolve every canonical variable, in [`ai_env::ALL`]'s order.
pub fn resolve() -> Vec<ResolvedVar> {
    let embed_model = role_model(LocalRole::Embed, ai_env::EMBED_MODEL);
    let rerank_model = role_model(LocalRole::Rerank, ai_env::RERANK_MODEL);

    vec![
        resolve_binary(ai_env::BIN, "aphrody", true),
        resolve_binary(ai_env::MCP_BIN, "aphrody-mcp", false),
        plain(ai_env::HTTP_URL, ai_env::HTTP_URL.resolve()),
        ResolvedVar {
            canonical: ai_env::HTTP_TOKEN.canonical,
            value: None,
            secret: true,
            note: Some(if ai_env::HTTP_TOKEN.resolve().is_some() {
                format!(
                    "set via {}",
                    ai_env::HTTP_TOKEN.resolve_source().unwrap_or_default()
                )
            } else {
                "not configured on this machine (vps-only capability); see \
                 the AI gateway environment file on the vps target"
                    .to_owned()
            }),
        },
        plain(
            ai_env::CHAT_BASE_URL,
            base_url_for(Role::Chat, ai_env::CHAT_BASE_URL),
        ),
        plain(
            ai_env::CHAT_MODEL,
            Some(role_model(LocalRole::Chat, ai_env::CHAT_MODEL)),
        ),
        ResolvedVar {
            canonical: ai_env::CHAT_API_KEY.canonical,
            value: None,
            secret: true,
            note: Some(
                if let Some(source) = ai_env::CHAT_API_KEY.resolve_source() {
                    format!("set via {source}")
                } else {
                    "not configured; keep upstream credentials in the host's protected environment store"
                    .to_owned()
                },
            ),
        },
        plain(
            ai_env::CODE_MODEL,
            Some(role_model(LocalRole::Code, ai_env::CODE_MODEL)),
        ),
        plain(
            ai_env::REASONING_MODEL,
            Some(role_model(LocalRole::Reasoning, ai_env::REASONING_MODEL)),
        ),
        plain(
            ai_env::SMALL_MODEL,
            Some(role_model(LocalRole::Small, ai_env::SMALL_MODEL)),
        ),
        // No `Role::Vision` exists in `aphrody-llama-server` (only Chat / Embed
        // / Rerank instances are supervised): a running chat-role instance is
        // not reliably vision-capable, so this is environment-only, never a
        // guess at what the current chat instance happens to be serving.
        plain(ai_env::VISION_BASE_URL, ai_env::VISION_BASE_URL.resolve()),
        plain(
            ai_env::VISION_MODEL,
            Some(role_model(LocalRole::Vision, ai_env::VISION_MODEL)),
        ),
        plain(
            ai_env::OCR_MODEL,
            Some(role_model(LocalRole::Ocr, ai_env::OCR_MODEL)),
        ),
        plain(
            ai_env::STT_MODEL,
            Some(role_model(LocalRole::Stt, ai_env::STT_MODEL)),
        ),
        plain(
            ai_env::EMBED_BASE_URL,
            base_url_for(Role::Embed, ai_env::EMBED_BASE_URL),
        ),
        plain(ai_env::EMBED_MODEL, Some(embed_model.clone())),
        plain(ai_env::EMBED_DIMENSIONS, embed_dimensions(&embed_model)),
        plain(
            ai_env::RERANK_BASE_URL,
            base_url_for(Role::Rerank, ai_env::RERANK_BASE_URL),
        ),
        plain(ai_env::RERANK_MODEL, Some(rerank_model)),
    ]
}

/// `hostname:port` and friends may leak in error paths; this only ever names
/// a *resolution target*, never a credential.
fn host_label() -> String {
    if let Ok(distro) = std::env::var("WSL_DISTRO_NAME").map(|v| v.to_ascii_lowercase()) {
        return format!("wsl-{distro}");
    }
    if cfg!(target_os = "windows") {
        "windows-local".to_owned()
    } else if cfg!(target_os = "linux") {
        "linux-local".to_owned()
    } else if cfg!(target_os = "macos") {
        "macos-local".to_owned()
    } else {
        "local".to_owned()
    }
}

pub fn to_env_lines(resolved: &[ResolvedVar]) -> String {
    let mut out = String::new();
    out.push_str(
        "# Generated by `aphrody ai env`. Resolved for this machine only — do not commit.\n",
    );
    for var in resolved {
        match (&var.value, var.secret) {
            (Some(value), false) => out.push_str(&format!("{}={value}\n", var.canonical)),
            (_, true) => out.push_str(&format!(
                "# {}=  # secret: {}\n",
                var.canonical,
                var.note.as_deref().unwrap_or("never written here")
            )),
            (None, false) => out.push_str(&format!(
                "# {}=  # {}\n",
                var.canonical,
                var.note
                    .as_deref()
                    .unwrap_or("not configured on this machine")
            )),
        }
    }
    out
}

pub fn to_nu_lines(resolved: &[ResolvedVar]) -> String {
    let mut out = String::new();
    for var in resolved {
        match (&var.value, var.secret) {
            (Some(value), false) => {
                out.push_str(&format!(
                    "$env.{} = \"{}\"\n",
                    var.canonical,
                    value.replace('"', "\\\"")
                ));
            }
            _ => out.push_str(&format!("# {} not set\n", var.canonical)),
        }
    }
    out
}

pub fn to_pwsh_lines(resolved: &[ResolvedVar]) -> String {
    let mut out = String::new();
    for var in resolved {
        match (&var.value, var.secret) {
            (Some(value), false) => {
                out.push_str(&format!(
                    "$env:{} = \"{}\"\n",
                    var.canonical,
                    value.replace('"', "`\"")
                ));
            }
            _ => out.push_str(&format!("# {} not set\n", var.canonical)),
        }
    }
    out
}

pub fn to_json(resolved: &[ResolvedVar]) -> serde_json::Value {
    let mut env = serde_json::Map::new();
    let mut notes = serde_json::Map::new();
    for var in resolved {
        env.insert(
            var.canonical.to_owned(),
            var.value
                .clone()
                .map_or(serde_json::Value::Null, serde_json::Value::String),
        );
        if let Some(note) = &var.note {
            notes.insert(
                var.canonical.to_owned(),
                serde_json::Value::String(note.clone()),
            );
        }
    }
    serde_json::json!({
        "schemaVersion": 1,
        "generatedBy": "aphrody ai env",
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "host": host_label(),
        "env": env,
        "notes": notes,
    })
}

pub fn ai_dir() -> miette::Result<PathBuf> {
    let state = aphrody_models::paths::state_dir().map_err(|e| miette::miette!("{e}"))?;
    Ok(state.join("ai"))
}

/// The resolved variables and the document written next to them.
pub struct Published {
    pub vars: Vec<ResolvedVar>,
    pub json: serde_json::Value,
}

/// Resolve the environment and write `~/.aphrody/ai/local-ai.{json,env}`.
///
/// # Errors
/// Fails when the state directory cannot be resolved or written.
pub fn publish() -> miette::Result<Published> {
    let resolved = resolve();

    let dir = ai_dir()?;
    std::fs::create_dir_all(&dir).into_diagnostic()?;
    let json_path = dir.join("local-ai.json");
    let env_path = dir.join("local-ai.env");
    let json = to_json(&resolved);
    std::fs::write(
        &json_path,
        serde_json::to_string_pretty(&json).into_diagnostic()?,
    )
    .into_diagnostic()?;
    std::fs::write(&env_path, to_env_lines(&resolved)).into_diagnostic()?;
    eprintln!("wrote {}", json_path.display());
    eprintln!("wrote {}", env_path.display());
    Ok(Published {
        vars: resolved,
        json,
    })
}

/// `aphrody ai env` as a JSON document (also writes the files).
///
/// # Errors
/// See [`publish`].
pub fn ai_env() -> miette::Result<serde_json::Value> {
    Ok(publish()?.json)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    #[test]
    fn resolved_names_are_exactly_the_canonical_names() {
        let resolved = resolve();
        let names: BTreeSet<&str> = resolved.iter().map(|var| var.canonical).collect();
        let expected: BTreeSet<&str> = ai_env::ALL.iter().map(|v| v.canonical).collect();
        assert_eq!(names, expected);
        assert_eq!(resolved.len(), ai_env::ALL.len());
    }

    #[test]
    fn gateway_and_chat_credentials_never_carry_values() {
        let resolved = resolve();
        for credential in [ai_env::HTTP_TOKEN, ai_env::CHAT_API_KEY] {
            let token = resolved
                .iter()
                .find(|var| var.canonical == credential.canonical)
                .unwrap();
            assert!(token.secret);
            assert_eq!(token.value, None);
            assert!(token.note.is_some());
        }
    }

    #[test]
    fn env_rendering_names_every_canonical_variable_once() {
        let resolved = resolve();
        let rendered = to_env_lines(&resolved);
        for var in &resolved {
            assert!(
                rendered.contains(var.canonical),
                "{} missing from rendered .env",
                var.canonical
            );
        }
    }

    #[test]
    fn json_rendering_never_inlines_gateway_or_chat_credential_values() {
        let resolved = resolve();
        let json = to_json(&resolved);
        assert_eq!(
            json["env"][ai_env::HTTP_TOKEN.canonical],
            serde_json::Value::Null
        );
        assert_eq!(
            json["env"][ai_env::CHAT_API_KEY.canonical],
            serde_json::Value::Null
        );
        assert_eq!(json["schemaVersion"], 1);
    }

    /// Cross-checks the emitted names against the repository's canonical
    /// `tools/aphrody/config/local-ai.json` contract.
    #[test]
    fn matches_the_root_local_ai_contract() {
        let candidate = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tools/aphrody/config/local-ai.json");
        let raw = std::fs::read_to_string(&candidate).expect("root local AI contract exists");
        let contract: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");
        let mut expected = BTreeSet::new();
        for section in ["binaries", "gateways", "capabilities"] {
            let Some(table) = contract.get(section).and_then(serde_json::Value::as_object) else {
                continue;
            };
            for entry in table.values() {
                let Some(vars) = entry.get("env").and_then(serde_json::Value::as_array) else {
                    continue;
                };
                for var in vars {
                    if let Some(name) = var.get("canonical").and_then(serde_json::Value::as_str) {
                        expected.insert(name.to_owned());
                    }
                }
            }
        }
        let actual: BTreeSet<String> = resolve()
            .into_iter()
            .map(|var| var.canonical.to_owned())
            .collect();
        assert_eq!(actual, expected);
    }
}
