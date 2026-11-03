// SPDX-License-Identifier: Apache-2.0
//! The `tweak_*` tool handlers: thin JSON adapters over [`super`] so the engine is reachable as aphrody MCP /
//! `aphrody` CLI tools and from the Bun side, with the same catalog as `bunos-win11`.

use serde_json::{json, Value};

use super::{Catalog, Profile};
use crate::SubsystemError;

fn bad(msg: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::InvalidArguments(msg.to_string())
}

fn profile_from(args: &Value) -> Result<Profile, SubsystemError> {
    if let Some(text) = args.get("profileToml").and_then(Value::as_str) {
        Profile::parse(text).map_err(bad)
    } else if let Some(path) = args.get("profilePath").and_then(Value::as_str) {
        let text = std::fs::read_to_string(path).map_err(bad)?;
        Profile::parse(&text).map_err(bad)
    } else {
        Ok(Profile::default())
    }
}

/// `tweak_catalog`: the catalog, optionally filtered to one module.
pub fn catalog(args: &Value) -> Result<Value, SubsystemError> {
    let catalog = Catalog::embedded().map_err(bad)?;
    let only = args.get("module").and_then(Value::as_str);
    let tweaks: Vec<Value> = catalog
        .tweaks
        .iter()
        .filter(|t| only.is_none_or(|m| t.module == m))
        .map(|t| {
            json!({
                "id": t.id,
                "module": t.module,
                "title": t.title,
                "level": t.level,
                "targets": t.targets,
                "ops": t.ops().map(|o| o.len()).unwrap_or(0),
            })
        })
        .collect();
    Ok(json!({
        "schema": catalog.schema,
        "modules": catalog.modules,
        "tweaks": tweaks,
        "count": tweaks.len(),
    }))
}

#[cfg(windows)]
mod win {
    use super::{json, profile_from, Value};
    use crate::tweaks::{live::LiveBackend, runner, Plan};
    use crate::SubsystemError;

    fn err(msg: impl std::fmt::Display) -> SubsystemError {
        SubsystemError::Failed(msg.to_string())
    }

    fn plan_summary(plan: &Plan, plan_path: &std::path::Path) -> Value {
        json!({
            "target": plan.target,
            "planPath": plan_path.to_string_lossy(),
            "changes": plan.changes(),
            "summary": plan.summary(),
            "refused": plan.steps.iter().filter(|s| s.action == "refused")
                .map(|s| json!({"tweak": s.tweak, "reason": s.reason})).collect::<Vec<_>>(),
        })
    }

    pub fn plan(args: &Value) -> Result<Value, SubsystemError> {
        let profile = profile_from(args)?;
        let mut backend = LiveBackend;
        let (plan, path) = runner::make_plan(&profile, &mut backend).map_err(err)?;
        Ok(plan_summary(&plan, &path))
    }

    pub fn apply(args: &Value) -> Result<Value, SubsystemError> {
        if args.get("confirm").and_then(Value::as_bool) != Some(true) {
            return Err(SubsystemError::InvalidArguments("tweak_apply requires confirm=true".into()));
        }
        let plan: Plan = if let Some(path) = args.get("planPath").and_then(Value::as_str) {
            serde_json::from_slice(&std::fs::read(path).map_err(err)?).map_err(err)?
        } else {
            let profile = profile_from(args)?;
            let mut backend = LiveBackend;
            runner::make_plan(&profile, &mut backend).map_err(err)?.0
        };
        let (journal, path) = runner::apply_live(&plan, "Bun OS Tweaks").map_err(err)?;
        let changed = journal.entries.iter().filter(|e| e.result == "applied").count();
        let failed: Vec<_> = journal.entries.iter().filter(|e| e.result != "applied")
            .map(|e| json!({"tweak": e.tweak, "result": e.result, "error": e.error})).collect();
        Ok(json!({
            "journalPath": path.to_string_lossy(),
            "restorePoint": journal.restore_point,
            "registryExports": journal.registry_exports.len(),
            "applied": changed,
            "notApplied": failed,
        }))
    }

    pub fn verify(args: &Value) -> Result<Value, SubsystemError> {
        let path = journal_path(args)?;
        let journal = serde_json::from_slice(&std::fs::read(&path).map_err(err)?).map_err(err)?;
        Ok(json!({"journalPath": path.to_string_lossy(), "drift": runner::verify_journal(&journal)}))
    }

    pub fn undo(args: &Value) -> Result<Value, SubsystemError> {
        let path = journal_path(args)?;
        let report = runner::undo_journal(&path).map_err(err)?;
        Ok(json!({"journalPath": path.to_string_lossy(), "report": report}))
    }

    fn journal_path(args: &Value) -> Result<std::path::PathBuf, SubsystemError> {
        match args.get("journalPath").and_then(Value::as_str) {
            Some(p) => Ok(p.into()),
            None => runner::latest_journal().ok_or_else(|| SubsystemError::Failed("no journal found".into())),
        }
    }
}

#[cfg(not(windows))]
mod win {
    use super::Value;
    use crate::SubsystemError;
    fn unsupported() -> SubsystemError {
        SubsystemError::Unavailable("live tweaks are Windows-only".into())
    }
    pub fn plan(_: &Value) -> Result<Value, SubsystemError> {
        Err(unsupported())
    }
    pub fn apply(_: &Value) -> Result<Value, SubsystemError> {
        Err(unsupported())
    }
    pub fn verify(_: &Value) -> Result<Value, SubsystemError> {
        Err(unsupported())
    }
    pub fn undo(_: &Value) -> Result<Value, SubsystemError> {
        Err(unsupported())
    }
}

/// Dispatch a `tweak_*` tool. Returns `None` when `tool` is not one of them.
pub fn call(tool: &str, args: &Value) -> Option<Result<Value, SubsystemError>> {
    Some(match tool {
        "tweak_catalog" => catalog(args),
        "tweak_plan" => win::plan(args),
        "tweak_apply" => win::apply(args),
        "tweak_verify" => win::verify(args),
        "tweak_undo" => win::undo(args),
        _ => return None,
    })
}
