// SPDX-License-Identifier: Apache-2.0
//! Rename an Agent Home (for example `local` to `user:<id>`), migrating its
//! memories and the references that point at it.
//!
//! The new identifier is kept verbatim as the home `agent_id`; the directory
//! becomes `<homes root>/<sanitised id>`.
//!
//! ## What is migrated
//!
//! * the directory itself, moved with one `rename` (atomic on one filesystem; a cross-device move
//!   is refused rather than copied half-way). Memories (`MEMORY.md`, `memory/`), the home database
//!   and every other file travel with it;
//! * inside the home, every UTF-8 text content file (`.md`, `.txt`, `.json`, `.jsonl`, `.toml`,
//!   `.yaml`, `.yml`): absolute references to the old directory are rewritten to the new one, and
//!   an `agent_id:` frontmatter value equal to the old identifier (in `USER.md`, `MEMORY.md` and
//!   `memory/**`) becomes the new identifier;
//! * outside the home, `<state>/config.toml` and `<state>/aphrody.json`: absolute references to
//!   the old directory are rewritten;
//! * `USER.md` gets `agent_id` = new identifier and a fresh `updated_at`.
//!
//! Path references are only replaced on a path boundary (end of string, `/`, `\`, a quote,
//! whitespace, `,`, `]`, `}`, `)`, or `.`/`;`/`:` ending a sentence), so `workspaces/ab` never
//! rewrites `workspaces/abc` nor `workspaces/ab.bak`.
//!
//! Dry run unless [`RenameOptions::apply`]. When applying, every rewritten file
//! is replaced atomically; on any failure the original contents are written
//! back and the directory is moved back, so the rename is all-or-nothing.
//!
//! Profile service namespaces (Redis prefix, `PostgreSQL` schema) derive from
//! the profile name; the report carries the old and new namespace so external
//! stores can be migrated by their owner.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{
    HomeError,
    filenames::{MEMORY_DIRNAME, MEMORY_FILENAME, USER_FILENAME},
    frontmatter,
    fsutil::write_atomic,
    homes::HomesRoot,
    revision::content_files,
    services::ProfileServiceContext,
    user::UserProfile,
};

/// Text extensions rewritten inside the home.
pub const REWRITE_EXTENSIONS: &[&str] = &["md", "txt", "json", "jsonl", "toml", "yaml", "yml"];

/// State-level files whose path references are rewritten.
pub const STATE_REFERENCE_FILES: &[&str] = &["config.toml", "aphrody.json"];

/// Options for [`rename_home`].
#[derive(Debug, Clone)]
pub struct RenameOptions {
    /// Homes root (and state directory) the home lives in.
    pub root: HomesRoot,
    /// Current home name or identifier (resolved with [`HomesRoot::home`]).
    pub from: String,
    /// New identifier (kept verbatim as `agent_id`, sanitised for the directory).
    pub to: String,
    /// Write (otherwise dry run).
    pub apply: bool,
}

/// One rewritten file.
#[derive(Debug, Clone, Serialize)]
pub struct Rewrite {
    /// Absolute path after the rename.
    pub path: PathBuf,
    /// Number of replaced occurrences.
    pub replacements: usize,
}

/// Outcome of [`rename_home`].
#[derive(Debug, Clone, Serialize)]
pub struct RenameReport {
    /// Old directory.
    pub from_path: PathBuf,
    /// New directory.
    pub to_path: PathBuf,
    /// Old identifier.
    pub from_id: String,
    /// New identifier.
    pub to_id: String,
    /// Whether the rename was applied.
    pub applied: bool,
    /// Rewritten files inside the home (memories included).
    pub home_rewrites: Vec<Rewrite>,
    /// Rewritten state-level reference files.
    pub reference_rewrites: Vec<Rewrite>,
    /// Profile service namespace before the rename.
    pub namespace_before: String,
    /// Profile service namespace after the rename.
    pub namespace_after: String,
}

/// Whether the text right after a match ends the path: end of text, a path
/// separator, a quote, a closing bracket, whitespace, or sentence punctuation
/// (`.`, `;`, `:`) itself followed by the end of text, whitespace or a quote.
fn is_boundary(after: &str) -> bool {
    let mut chars = after.chars();
    match chars.next() {
        None => true,
        Some(c)
            if matches!(c, '/' | '\\' | '"' | '\'' | ',' | ']' | '}' | ')')
                || c.is_whitespace() =>
        {
            true
        }
        Some('.' | ';' | ':') => chars
            .next()
            .is_none_or(|n| n.is_whitespace() || matches!(n, '"' | '\'')),
        Some(_) => false,
    }
}

/// Replace `old` by `new` wherever it is followed by a path boundary.
/// Returns the new text and the number of replacements.
#[must_use]
pub fn replace_path_refs(text: &str, old: &str, new: &str) -> (String, usize) {
    if old.is_empty() {
        return (text.to_string(), 0);
    }
    let mut out = String::with_capacity(text.len());
    let mut count = 0;
    let mut rest = text;
    while let Some(at) = rest.find(old) {
        let after = &rest[at + old.len()..];
        out.push_str(&rest[..at]);
        if is_boundary(after) {
            out.push_str(new);
            count += 1;
        } else {
            out.push_str(old);
        }
        rest = after;
    }
    out.push_str(rest);
    (out, count)
}

fn rewrite_agent_id(text: &str, old_id: &str, new_id: &str) -> Option<String> {
    let (fm, _) = frontmatter::split(text);
    let current = frontmatter::parse(fm?)
        .into_iter()
        .find_map(|(k, v)| match (k.as_str(), v) {
            ("agent_id", frontmatter::FmValue::Scalar(s)) => Some(s),
            _ => None,
        })?;
    (current.trim() == old_id)
        .then(|| frontmatter::upsert_scalars(text, &[("agent_id", Some(new_id))]))
}

fn is_memory_or_user(rel: &str) -> bool {
    rel == USER_FILENAME || rel == MEMORY_FILENAME || rel.starts_with(&format!("{MEMORY_DIRNAME}/"))
}

/// Planned rewrite: path (in the old home for home files), original, new.
struct Planned {
    rel_or_abs: PathBuf,
    in_home: bool,
    original: Vec<u8>,
    updated: String,
    replacements: usize,
}

fn plan_home(
    from: &Path,
    to: &Path,
    old_id: &str,
    new_id: &str,
) -> Result<Vec<Planned>, HomeError> {
    let old_s = from.display().to_string();
    let new_s = to.display().to_string();
    let mut out = Vec::new();
    for file in content_files(from)? {
        let text_ext = Path::new(&file.path)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| REWRITE_EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)));
        if !text_ext {
            continue;
        }
        let original = std::fs::read(&file.abs).map_err(|e| HomeError::io(&file.abs, e))?;
        let Ok(text) = std::str::from_utf8(&original) else {
            continue;
        };
        let (mut updated, mut replacements) = replace_path_refs(text, &old_s, &new_s);
        if is_memory_or_user(&file.path)
            && let Some(rewritten) = rewrite_agent_id(&updated, old_id, new_id)
        {
            updated = rewritten;
            replacements += 1;
        }
        if replacements > 0 {
            out.push(Planned {
                rel_or_abs: PathBuf::from(&file.path),
                in_home: true,
                original,
                updated,
                replacements,
            });
        }
    }
    Ok(out)
}

fn plan_state(state: &Path, from: &Path, to: &Path) -> Result<Vec<Planned>, HomeError> {
    let old_s = from.display().to_string();
    let new_s = to.display().to_string();
    let mut out = Vec::new();
    for name in STATE_REFERENCE_FILES {
        let path = state.join(name);
        let original = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(HomeError::io(&path, e)),
        };
        let Ok(text) = std::str::from_utf8(&original) else {
            continue;
        };
        // JSON escapes backslashes: rewrite the escaped form too (Windows paths).
        let (updated, a) = replace_path_refs(text, &old_s, &new_s);
        let (updated, b) = if old_s.contains('\\') {
            replace_path_refs(
                &updated,
                &old_s.replace('\\', "\\\\"),
                &new_s.replace('\\', "\\\\"),
            )
        } else {
            (updated, 0)
        };
        if a + b > 0 {
            out.push(Planned {
                rel_or_abs: path,
                in_home: false,
                original,
                updated,
                replacements: a + b,
            });
        }
    }
    Ok(out)
}

/// Write every planned rewrite and the new profile, recording what to restore.
fn apply_rewrites(
    home_plan: &[Planned],
    state_plan: &[Planned],
    to_path: &Path,
    to_id: &str,
    done: &mut Vec<(PathBuf, Option<Vec<u8>>)>,
) -> Result<(), HomeError> {
    for p in home_plan.iter().chain(state_plan) {
        let path = if p.in_home {
            to_path.join(&p.rel_or_abs)
        } else {
            p.rel_or_abs.clone()
        };
        write_atomic(&path, p.updated.as_bytes())?;
        done.push((path, Some(p.original.clone())));
    }
    let user_path = to_path.join(USER_FILENAME);
    let user_original = match std::fs::read(&user_path) {
        Ok(b) => Some(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(HomeError::io(&user_path, e)),
    };
    let mut profile = UserProfile::load(to_path)?;
    profile.agent_id = Some(to_id.to_string());
    profile.write_profile_fields(to_path)?;
    done.push((user_path, user_original));
    Ok(())
}

/// Rename a home (see module docs).
///
/// # Errors
/// [`HomeError::HomeNotFound`] when the home does not exist,
/// [`HomeError::InvalidHomeName`] for an unusable new identifier,
/// [`HomeError::HomeExists`] when the destination exists, and
/// [`HomeError::Io`] on filesystem failure (after rolling back).
pub fn rename_home(opts: &RenameOptions) -> Result<RenameReport, HomeError> {
    let from_path = opts.root.home(&opts.from);
    if !from_path.is_dir() {
        return Err(HomeError::HomeNotFound(from_path));
    }
    let to_id = opts.to.trim().to_string();
    let to_path = opts.root.new_home_path(&to_id)?;
    if to_path == from_path {
        return Err(HomeError::InvalidHomeName(format!(
            "{to_id} resolves to the current home"
        )));
    }
    if to_path.exists() {
        return Err(HomeError::HomeExists(to_path));
    }
    let from_id = UserProfile::load(&from_path)?
        .agent_id
        .unwrap_or_else(|| opts.from.trim().to_string());

    let home_plan = plan_home(&from_path, &to_path, &from_id, &to_id)?;
    let state_plan = plan_state(&opts.root.state, &from_path, &to_path)?;
    let dir_name = |p: &Path| {
        p.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    let mut report = RenameReport {
        from_path: from_path.clone(),
        to_path: to_path.clone(),
        from_id: from_id.clone(),
        to_id: to_id.clone(),
        applied: false,
        home_rewrites: home_plan
            .iter()
            .map(|p| Rewrite {
                path: to_path.join(&p.rel_or_abs),
                replacements: p.replacements,
            })
            .collect(),
        reference_rewrites: state_plan
            .iter()
            .map(|p| Rewrite {
                path: p.rel_or_abs.clone(),
                replacements: p.replacements,
            })
            .collect(),
        namespace_before: ProfileServiceContext::new(
            &from_path,
            Some(dir_name(&from_path).as_str()),
        )
        .namespace()
        .to_string(),
        namespace_after: ProfileServiceContext::new(&to_path, Some(dir_name(&to_path).as_str()))
            .namespace()
            .to_string(),
    };
    if !opts.apply {
        return Ok(report);
    }

    if let Some(parent) = to_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| HomeError::io(parent, e))?;
    }
    std::fs::rename(&from_path, &to_path).map_err(|e| HomeError::io(&from_path, e))?;

    // (path, bytes to restore; `None` = the file did not exist).
    let mut done: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::new();
    let result = apply_rewrites(&home_plan, &state_plan, &to_path, &to_id, &mut done);
    if let Err(e) = result {
        for (path, original) in done.iter().rev() {
            let _ = match original {
                Some(bytes) => write_atomic(path, bytes),
                None => std::fs::remove_file(path).map_err(|e| HomeError::io(path, e)),
            };
        }
        let _ = std::fs::rename(&to_path, &from_path);
        return Err(e);
    }
    report.applied = true;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn replaces_only_on_path_boundaries() {
        let (s, n) = replace_path_refs(
            "/h/ab /h/abc \"/h/ab\" /h/ab/x /h/ab.bak /h/ab.",
            "/h/ab",
            "/h/z",
        );
        assert_eq!(s, "/h/z /h/abc \"/h/z\" /h/z/x /h/ab.bak /h/z.");
        assert_eq!(n, 4);
    }

    fn setup() -> (tempfile::TempDir, HomesRoot, PathBuf) {
        let state = tempfile::tempdir().unwrap();
        let root = HomesRoot::resolve_with(state.path(), None, None);
        let home = root.path.join("local");
        let hs = home.display().to_string();
        write(
            &home,
            "USER.md",
            "---\nname: Sam\nagent_id: local\n---\n\nNotes.\n",
        );
        write(
            &home,
            "MEMORY.md",
            &format!("---\nagent_id: local\n---\n\nSee {hs}/memory.\n"),
        );
        write(
            &home,
            "memory/2026-10-06.md",
            "---\nagent_id: local\n---\n\nfact\n",
        );
        write(
            &home,
            "memory/other.md",
            "---\nagent_id: someone-else\n---\n\nkeep\n",
        );
        write(&home, "avatar.png", "binary local");
        write(
            state.path(),
            "config.toml",
            &format!("[profiles.local]\ninstructions = \"Use {hs}.\"\nother = \"{hs}x\"\n"),
        );
        write(
            state.path(),
            "aphrody.json",
            &format!("{{\"workspace\": \"{hs}\"}}"),
        );
        (state, root, home)
    }

    #[test]
    fn dry_run_reports_and_changes_nothing() {
        let (state, root, home) = setup();
        let r = rename_home(&RenameOptions {
            root,
            from: "local".into(),
            to: "user:42".into(),
            apply: false,
        })
        .unwrap();
        assert!(!r.applied);
        assert!(home.is_dir());
        assert_eq!(r.to_path, state.path().join("workspaces/user-42"));
        assert_eq!(r.from_id, "local");
        assert_eq!(r.home_rewrites.len(), 3);
        assert_eq!(r.reference_rewrites.len(), 2);
        assert_ne!(r.namespace_before, r.namespace_after);
    }

    #[test]
    fn apply_moves_migrates_memories_and_references() {
        let (state, root, home) = setup();
        let r = rename_home(&RenameOptions {
            root,
            from: "local".into(),
            to: "user:42".into(),
            apply: true,
        })
        .unwrap();
        assert!(r.applied && !home.exists());
        let new = r.to_path.clone();
        let ns = new.display().to_string();
        let user = UserProfile::load(&new).unwrap();
        assert_eq!(user.agent_id.as_deref(), Some("user:42"));
        assert_eq!(user.address_as.as_deref(), Some("Sam"));
        let memory = std::fs::read_to_string(new.join("MEMORY.md")).unwrap();
        assert!(
            memory.contains("agent_id: user:42")
                && memory.contains(&format!("See {ns}/memory."))
        );
        let note = std::fs::read_to_string(new.join("memory/2026-10-06.md")).unwrap();
        assert!(note.contains("agent_id: user:42") && note.contains("fact"));
        let other = std::fs::read_to_string(new.join("memory/other.md")).unwrap();
        assert!(other.contains("agent_id: someone-else"));
        assert_eq!(
            std::fs::read_to_string(new.join("avatar.png")).unwrap(),
            "binary local"
        );
        let cfg = std::fs::read_to_string(state.path().join("config.toml")).unwrap();
        assert!(cfg.contains(&format!("Use {ns}.")));
        // Not a path boundary: untouched.
        assert!(cfg.contains(&format!("{}x", home.display())));
        let json = std::fs::read_to_string(state.path().join("aphrody.json")).unwrap();
        assert!(json.contains(&ns));
    }

    #[test]
    fn refuses_existing_destination_missing_home_and_empty_id() {
        let (_state, root, _home) = setup();
        std::fs::create_dir_all(root.path.join("taken")).unwrap();
        let mk = |from: &str, to: &str| RenameOptions {
            root: root.clone(),
            from: from.into(),
            to: to.into(),
            apply: true,
        };
        assert!(matches!(
            rename_home(&mk("local", "taken")),
            Err(HomeError::HomeExists(_))
        ));
        assert!(matches!(
            rename_home(&mk("ghost", "x")),
            Err(HomeError::HomeNotFound(_))
        ));
        assert!(matches!(
            rename_home(&mk("local", "::")),
            Err(HomeError::InvalidHomeName(_))
        ));
        assert!(matches!(
            rename_home(&mk("local", "LOCAL")),
            Err(HomeError::InvalidHomeName(_))
        ));
    }
}
