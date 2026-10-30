// SPDX-License-Identifier: Apache-2.0
//! `aphrody agent-home`: management of the Agent Home directories (homes root,
//! revision, profile, template instantiation, merge / sync, rename). JSON on
//! stdout. Every writing verb is a dry run unless `--apply` (merge, sync,
//! rename); `new` and `profile --set...` write directly because they are
//! additive (a replaced home is moved aside, never deleted).

use std::{ffi::OsString, path::PathBuf};

use clap::{Parser, Subcommand, ValueEnum};
use serde_json::{Value, json};

use crate::{
    HomeError,
    homes::HomesRoot,
    merge::{ConflictPolicy, MergeOptions, merge_homes, restore_backup, sync_homes},
    rename::{RenameOptions, rename_home},
    revision::home_revision,
    template::{TemplateOptions, instantiate_template},
    user::UserProfile,
};

/// Agent Home management.
#[derive(Debug, Parser)]
#[command(name = "aphrody agent-home", version, about)]
struct Cli {
    /// State directory (default: `$APHRODY_HOME` or `~/.aphrody`).
    #[arg(long, global = true)]
    state: Option<PathBuf>,
    /// Homes root override (default: `$APHRODY_HOMES_DIR`, `[agent_home] homes_dir`, then
    /// `<state>/workspaces`).
    #[arg(long, global = true)]
    homes_dir: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum PolicyArg {
    Lww,
    KeepTarget,
    TakeSource,
}

impl From<PolicyArg> for ConflictPolicy {
    fn from(p: PolicyArg) -> Self {
        match p {
            PolicyArg::Lww => Self::LastWriterWins,
            PolicyArg::KeepTarget => Self::KeepTarget,
            PolicyArg::TakeSource => Self::TakeSource,
        }
    }
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Print the resolved homes root and the homes it holds.
    Roots,
    /// Print the `sha256-v1` content revision of a home.
    Revision {
        /// Home name or path.
        home: String,
        /// Include the per-file manifest.
        #[arg(long)]
        files: bool,
    },
    /// Print (and optionally update) the profile fields of a home.
    Profile {
        /// Home name or path.
        home: String,
        /// Avatar (home-relative path or URL).
        #[arg(long)]
        avatar: Option<String>,
        /// Agent identifier.
        #[arg(long)]
        agent_id: Option<String>,
        /// Extra `USER.md` frontmatter field `key=value` (repeatable).
        #[arg(long = "set", value_parser = parse_kv)]
        set: Vec<(String, String)>,
    },
    /// Instantiate a new home from a template directory.
    New {
        /// New home name or identifier (sanitised for the directory).
        name: String,
        /// Template directory.
        #[arg(long)]
        template: PathBuf,
        /// Agent identifier (default: the name).
        #[arg(long)]
        agent_id: Option<String>,
        /// Avatar (home-relative path or URL).
        #[arg(long)]
        avatar: Option<String>,
        /// User field `key=value` written into `USER.md` (repeatable).
        #[arg(long = "set", value_parser = parse_kv)]
        set: Vec<(String, String)>,
        /// Replace an existing home (moved aside, not deleted).
        #[arg(long)]
        force: bool,
    },
    /// Merge SOURCE into TARGET (dry run unless `--apply`).
    Merge {
        /// Source home name or path.
        source: String,
        /// Target home name or path.
        target: String,
        /// Conflict policy for non-memory files.
        #[arg(long, value_enum, default_value = "lww")]
        policy: PolicyArg,
        /// Apply the policy to memory files too instead of the paragraph union.
        #[arg(long)]
        no_memory_union: bool,
        /// Write (takes a verified backup first).
        #[arg(long)]
        apply: bool,
    },
    /// Two-way last-writer-wins sync of two homes (dry run unless `--apply`).
    Sync {
        /// First home name or path.
        a: String,
        /// Second home name or path.
        b: String,
        /// Conflict policy for non-memory files.
        #[arg(long, value_enum, default_value = "lww")]
        policy: PolicyArg,
        /// Write (takes a verified backup of each side first).
        #[arg(long)]
        apply: bool,
    },
    /// Restore a verified merge backup into a home.
    Restore {
        /// Backup directory (holds `manifest.json` and `files/`).
        backup: PathBuf,
        /// Home name or path.
        home: String,
    },
    /// Rename a home and migrate its memories and references (dry run unless `--apply`).
    Rename {
        /// Current home name or identifier.
        from: String,
        /// New identifier (for example `user:123`).
        to: String,
        /// Write.
        #[arg(long)]
        apply: bool,
    },
}

fn parse_kv(raw: &str) -> Result<(String, String), String> {
    let (k, v) = raw
        .split_once('=')
        .ok_or_else(|| format!("expected key=value, got {raw:?}"))?;
    let k = k.trim();
    if k.is_empty() || !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("invalid field name {k:?}"));
    }
    Ok((k.to_string(), v.to_string()))
}

fn homes_root(cli: &Cli) -> Result<HomesRoot, HomeError> {
    let state = match &cli.state {
        Some(s) => s.clone(),
        None => crate::paths::state_dir()?,
    };
    match &cli.homes_dir {
        Some(dir) => Ok(HomesRoot::explicit(&state, dir)),
        None => HomesRoot::resolve_in(&state),
    }
}

/// A home argument: an explicit path (absolute, or containing a separator, or
/// starting with `.`) is used as-is; anything else is a home name.
fn home_arg(root: &HomesRoot, raw: &str) -> PathBuf {
    let p = PathBuf::from(raw);
    if p.is_absolute() || raw.starts_with('.') || raw.contains(['/', '\\']) {
        p
    } else {
        root.home(raw)
    }
}

fn run(cli: &Cli) -> Result<Value, HomeError> {
    let root = homes_root(cli)?;
    match &cli.command {
        Command::Roots => Ok(json!({ "root": root, "homes": root.list()? })),
        Command::Revision { home, files } => {
            let path = home_arg(&root, home);
            if !path.is_dir() {
                return Err(HomeError::HomeNotFound(path));
            }
            let rev = home_revision(&path)?;
            let mut out = json!({
                "home": path,
                "algorithm": rev.algorithm,
                "revision": rev.revision,
                "file_count": rev.files.len(),
            });
            if *files {
                out["files"] = serde_json::to_value(&rev.files)?;
            }
            Ok(out)
        }
        Command::Profile {
            home,
            avatar,
            agent_id,
            set,
        } => {
            let path = home_arg(&root, home);
            if !path.is_dir() {
                return Err(HomeError::HomeNotFound(path));
            }
            let writes = avatar.is_some() || agent_id.is_some() || !set.is_empty();
            if writes {
                UserProfile::write_user_fields(&path, set)?;
                let mut profile = UserProfile::load(&path)?;
                if let Some(a) = avatar {
                    profile.avatar = Some(a.clone());
                }
                if let Some(id) = agent_id {
                    profile.agent_id = Some(id.clone());
                }
                profile.write_profile_fields(&path)?;
            }
            let profile = UserProfile::load(&path)?;
            Ok(json!({
                "home": path,
                "written": writes,
                "profile": profile,
                "avatar_path": profile.avatar_path(&path)?,
            }))
        }
        Command::New {
            name,
            template,
            agent_id,
            avatar,
            set,
            force,
        } => {
            let destination = root.new_home_path(name)?;
            let report = instantiate_template(&TemplateOptions {
                template: template.clone(),
                destination,
                agent_id: agent_id.clone().or_else(|| Some(name.clone())),
                avatar: avatar.clone(),
                user_fields: set.clone(),
                force: *force,
            })?;
            Ok(serde_json::to_value(report)?)
        }
        Command::Merge {
            source,
            target,
            policy,
            no_memory_union,
            apply,
        } => {
            let opts = MergeOptions {
                policy: (*policy).into(),
                memory_union: !no_memory_union,
                apply: *apply,
                ..MergeOptions::new(home_arg(&root, source), home_arg(&root, target))
            };
            Ok(serde_json::to_value(merge_homes(&opts)?)?)
        }
        Command::Sync {
            a,
            b,
            policy,
            apply,
        } => {
            let report = sync_homes(
                &home_arg(&root, a),
                &home_arg(&root, b),
                (*policy).into(),
                *apply,
            )?;
            Ok(serde_json::to_value(report)?)
        }
        Command::Restore { backup, home } => {
            let path = home_arg(&root, home);
            let restored = restore_backup(backup, &path)?;
            Ok(json!({
                "home": path,
                "restored_revision": restored.revision,
                "files": restored.files.len(),
            }))
        }
        Command::Rename { from, to, apply } => {
            let report = rename_home(&RenameOptions {
                root,
                from: from.clone(),
                to: to.clone(),
                apply: *apply,
            })?;
            Ok(serde_json::to_value(report)?)
        }
    }
}

/// Entry point of `aphrody agent-home` (multi-call convention: `args[0]` is
/// the invocation name). Prints JSON on stdout; errors go to stderr with exit
/// code 1 (2 for usage errors).
#[must_use]
pub fn cli_main(args: Vec<OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(e) => {
            let code = if e.use_stderr() { 2 } else { 0 };
            let _ = e.print();
            return code;
        }
    };
    match run(&cli) {
        Ok(value) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
            );
            0
        }
        Err(e) => {
            eprintln!("aphrody agent-home: {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_args(rest: &[&str]) -> Result<Value, HomeError> {
        let mut argv = vec!["aphrody-agent-home"];
        argv.extend_from_slice(rest);
        run(&Cli::try_parse_from(argv).unwrap())
    }

    #[test]
    fn end_to_end_new_profile_revision_merge_rename() {
        let state = tempfile::tempdir().unwrap();
        let s = state.path().to_str().unwrap();
        let tpl = state.path().join("tpl");
        std::fs::create_dir_all(&tpl).unwrap();
        std::fs::write(tpl.join("SOUL.md"), "# Soul\n\nTu es {{agent_id}}.\n").unwrap();
        let t = tpl.to_str().unwrap();

        let made = run_args(&[
            "--state",
            s,
            "--homes-dir",
            "users",
            "new",
            "local",
            "--template",
            t,
            "--set",
            "address_as=Sam",
        ])
        .unwrap();
        assert!(
            made["destination"]
                .as_str()
                .unwrap()
                .ends_with("users/local")
        );
        let other = run_args(&[
            "--state",
            s,
            "--homes-dir",
            "users",
            "new",
            "other",
            "--template",
            t,
        ])
        .unwrap();
        assert!(
            other["revision"]
                .as_str()
                .unwrap()
                .starts_with("sha256-v1:")
        );

        let profile = run_args(&[
            "--state",
            s,
            "--homes-dir",
            "users",
            "profile",
            "local",
            "--avatar",
            "a.png",
        ])
        .unwrap();
        assert_eq!(profile["profile"]["avatar"], "a.png");
        assert_eq!(profile["profile"]["address_as"], "Sam");

        let rev = run_args(&[
            "--state",
            s,
            "--homes-dir",
            "users",
            "revision",
            "local",
            "--files",
        ])
        .unwrap();
        assert!(rev["file_count"].as_u64().unwrap() >= 7);

        let roots = run_args(&["--state", s, "--homes-dir", "users", "roots"]).unwrap();
        assert_eq!(roots["root"]["source"], "explicit");
        assert_eq!(roots["homes"].as_array().unwrap().len(), 2);

        let plan = run_args(&[
            "--state",
            s,
            "--homes-dir",
            "users",
            "merge",
            "local",
            "other",
        ])
        .unwrap();
        assert_eq!(plan["applied"], false);
        let sync = run_args(&[
            "--state",
            s,
            "--homes-dir",
            "users",
            "sync",
            "local",
            "other",
            "--apply",
        ])
        .unwrap();
        assert_eq!(sync["a_to_b"]["applied"], true);

        let renamed = run_args(&[
            "--state",
            s,
            "--homes-dir",
            "users",
            "rename",
            "local",
            "user:7",
            "--apply",
        ])
        .unwrap();
        assert_eq!(renamed["applied"], true);
        assert!(state.path().join("users/user-7/USER.md").is_file());
        assert!(run_args(&["--state", s, "--homes-dir", "users", "revision", "local"]).is_err());
    }

    #[test]
    fn kv_parser_rejects_bad_fields() {
        assert!(parse_kv("novalue").is_err());
        assert!(parse_kv("a b=c").is_err());
        assert_eq!(
            parse_kv("tz=Europe/Paris").unwrap(),
            ("tz".into(), "Europe/Paris".into())
        );
    }
}
