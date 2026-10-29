// SPDX-License-Identifier: Apache-2.0
//! Resolve one effective config profile into an explicit tool snapshot.

use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

use aphrody_config::{Config, McpServerConfig};
use serde_json::Value;

use crate::{PluginToolSpec, RuntimeError, SkillSpec, ToolProfileSpec};

#[derive(Debug)]
struct PluginSource {
    id: String,
    skills_root: PathBuf,
    mcp_servers: BTreeMap<String, McpServerConfig>,
}

fn config_error(message: impl Into<String>) -> RuntimeError {
    RuntimeError::Config(format!("tool profile: {}", message.into()))
}

fn resolve_path(raw: &str, cwd: &Path) -> Result<PathBuf, RuntimeError> {
    if let Some(suffix) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        return Ok(aphrody_models::paths::home_dir()
            .map_err(|error| config_error(error.to_string()))?
            .join(suffix));
    }
    Ok(cwd.join(raw))
}

fn read_json(path: &Path) -> Result<Value, RuntimeError> {
    let bytes = std::fs::read(path)
        .map_err(|error| config_error(format!("cannot read {}: {error}", path.display())))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| config_error(format!("invalid JSON in {}: {error}", path.display())))
}

fn manifest(root: &Path) -> Result<Option<Value>, RuntimeError> {
    for relative in [
        ".codex-plugin/plugin.json",
        ".claude-plugin/plugin.json",
        "plugin.json",
    ] {
        let path = root.join(relative);
        if path.is_file() {
            return read_json(&path).map(Some);
        }
    }
    Ok(None)
}

fn identifier(kind: &str, value: &str) -> Result<String, RuntimeError> {
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err(config_error(format!(
            "{kind} `{value}` must contain only ASCII letters, digits, `_`, or `-`"
        )));
    }
    Ok(value.to_owned())
}

fn skill_identifier(value: &str) -> Result<String, RuntimeError> {
    if value.is_empty()
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
    {
        return Err(config_error(format!(
            "skill `{value}` must contain only ASCII letters, digits, `.`, `_`, or `-`"
        )));
    }
    identifier("skill", &value.replace('.', "_"))
}

fn mcp_servers(
    root: &Path,
    manifest: Option<&Value>,
) -> Result<BTreeMap<String, McpServerConfig>, RuntimeError> {
    let configured = manifest
        .and_then(|value| value.get("mcpServers"))
        .and_then(Value::as_str)
        .map(|relative| root.join(relative))
        .or_else(|| {
            root.join(".mcp.json")
                .is_file()
                .then(|| root.join(".mcp.json"))
        });
    let Some(path) = configured else {
        return Ok(BTreeMap::new());
    };
    let value = read_json(&path)?;
    let servers = value.get("mcpServers").cloned().unwrap_or(value);
    serde_json::from_value(servers)
        .map_err(|error| config_error(format!("invalid MCP map in {}: {error}", path.display())))
}

fn plugin_source(raw: &str, cwd: &Path) -> Result<PluginSource, RuntimeError> {
    let root = resolve_path(raw, cwd)?;
    if !root.is_dir() {
        return Err(config_error(format!(
            "plugin root does not exist: {}",
            root.display()
        )));
    }
    let manifest = manifest(&root)?;
    let fallback = root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            config_error(format!("plugin root has no valid name: {}", root.display()))
        })?;
    let id = manifest
        .as_ref()
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or(fallback);
    let id = identifier("plugin", id)?;
    let skills = manifest
        .as_ref()
        .and_then(|value| value.get("skills"))
        .and_then(Value::as_str)
        .unwrap_or("skills");
    let skills_root = root.join(skills);
    let mcp_servers = mcp_servers(&root, manifest.as_ref())?;
    Ok(PluginSource {
        id,
        skills_root,
        mcp_servers,
    })
}

/// Resolve only explicitly selected skills, plugin roots, and MCP servers.
///
/// Returns `None` when no profile/tool configuration exists, preserving the
/// historic built-in registry. Relative plugin paths resolve against `cwd`;
/// profile-owned skills resolve from `profile_root/skills/<name>/SKILL.md`.
///
/// # Errors
///
/// Fails on missing or ambiguous whitelisted skills, invalid plugin manifests,
/// invalid identifiers, or malformed plugin MCP configuration.
pub fn resolve_tool_profile(
    config: &Config,
    profile_root: &Path,
    cwd: &Path,
) -> Result<Option<ToolProfileSpec>, RuntimeError> {
    let enabled = config.active_profile.is_some()
        || !config.skills.whitelist.is_empty()
        || !config.plugins.paths.is_empty()
        || !config.mcp_servers.is_empty();
    if !enabled {
        return Ok(None);
    }

    let mut plugin_sources = Vec::with_capacity(config.plugins.paths.len());
    let mut plugin_ids = BTreeSet::new();
    for path in &config.plugins.paths {
        let source = plugin_source(path, cwd)?;
        if !plugin_ids.insert(source.id.clone()) {
            return Err(config_error(format!("duplicate plugin id `{}`", source.id)));
        }
        plugin_sources.push(source);
    }

    let mut direct_skills = Vec::new();
    let mut plugin_skills: BTreeMap<String, Vec<SkillSpec>> = BTreeMap::new();
    let mut exposed_names = BTreeSet::new();
    for name in &config.skills.whitelist {
        let exposed = skill_identifier(name)?;
        if !exposed_names.insert(exposed.clone()) {
            return Err(config_error(format!(
                "duplicate exposed skill id `{exposed}`"
            )));
        }
        let direct = profile_root.join("skills").join(name).join("SKILL.md");
        let mut matches = direct
            .is_file()
            .then_some((None, direct))
            .into_iter()
            .collect::<Vec<_>>();
        for plugin in &plugin_sources {
            let path = plugin.skills_root.join(name).join("SKILL.md");
            if path.is_file() {
                matches.push((Some(plugin.id.as_str()), path));
            }
        }
        match matches.as_slice() {
            [] => {
                return Err(config_error(format!(
                    "whitelisted skill `{name}` was not found under {} or configured plugins",
                    profile_root.join("skills").display()
                )));
            }
            [(..), _, ..] => {
                return Err(config_error(format!(
                    "whitelisted skill `{name}` is ambiguous across profile/plugin roots"
                )));
            }
            [(None, path)] => direct_skills.push(SkillSpec::new(exposed, path)),
            [(Some(plugin), path)] => plugin_skills
                .entry((*plugin).to_owned())
                .or_default()
                .push(SkillSpec::new(exposed, path)),
        }
    }

    let plugins = plugin_sources
        .into_iter()
        .map(|plugin| PluginToolSpec {
            skills: plugin_skills.remove(&plugin.id).unwrap_or_default(),
            id: plugin.id,
            mcp_servers: plugin.mcp_servers,
        })
        .collect();
    Ok(Some(ToolProfileSpec {
        builtin_tools: None,
        skills: direct_skills,
        mcp_servers: config.mcp_servers.clone(),
        plugins,
    }))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn config() -> Config {
        let layer = aphrody_config::ConfigLayer::new(
            aphrody_config::LayerSource::Builtin,
            aphrody_config::builtin_providers_layer_value(&|_| None),
        );
        aphrody_config::resolve(
            vec![layer],
            &aphrody_config::CliOverrides::default(),
            "llama",
            &BTreeMap::new(),
        )
        .unwrap()
        .0
    }

    #[test]
    fn resolves_exact_profile_and_plugin_skills() {
        let temp = tempfile::tempdir().unwrap();
        let profile = temp.path().join("workspace-worker");
        let direct = profile.join("skills/rag.canon");
        let plugin = temp.path().join("example-plugin");
        let plugin_skill = plugin.join("skills/docs-index");
        fs::create_dir_all(&direct).unwrap();
        fs::create_dir_all(&plugin_skill).unwrap();
        fs::write(direct.join("SKILL.md"), "# rag").unwrap();
        fs::write(plugin_skill.join("SKILL.md"), "# docs").unwrap();
        fs::write(plugin.join("plugin.json"), r#"{"name":"example-plugin"}"#).unwrap();

        let mut config = config();
        config.active_profile = Some("worker".into());
        config.skills.whitelist = vec!["rag.canon".into(), "docs-index".into()];
        config.plugins.paths = vec![plugin.display().to_string()];
        let spec = resolve_tool_profile(&config, &profile, temp.path())
            .unwrap()
            .unwrap();
        assert_eq!(spec.skills[0].name, "rag_canon");
        assert_eq!(spec.plugins[0].id, "example-plugin");
        assert_eq!(spec.plugins[0].skills[0].name, "docs-index");
    }

    #[test]
    fn missing_and_ambiguous_whitelist_entries_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let profile = temp.path().join("workspace-p");
        let mut config = config();
        config.active_profile = Some("p".into());
        config.skills.whitelist = vec!["missing".into()];
        assert!(resolve_tool_profile(&config, &profile, temp.path()).is_err());

        let plugin = temp.path().join("plugin");
        for root in [&profile, &plugin] {
            fs::create_dir_all(root.join("skills/same")).unwrap();
            fs::write(root.join("skills/same/SKILL.md"), "# same").unwrap();
        }
        config.skills.whitelist = vec!["same".into()];
        config.plugins.paths = vec![plugin.display().to_string()];
        assert!(resolve_tool_profile(&config, &profile, temp.path()).is_err());
    }
}
