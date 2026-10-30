// SPDX-License-Identifier: Apache-2.0
//! Instantiate an Agent Home from an external template directory.
//!
//! A template is any directory holding home content (the bootstrap Markdown
//! files, `memory/`, `skills/`, an avatar image...). Instantiation:
//!
//! 1. computes the template revision ([`crate::revision`], `sha256-v1`);
//! 2. copies the template content set (same exclusions as the revision: no `.git`, state, databases
//!    or temp files; symbolic links are skipped) into a staging directory next to the destination;
//! 3. substitutes placeholders in text files (`.md`, `.txt`, `.json`, `.toml`, `.yaml`, `.yml`):
//!    `{{agent_id}}`, `{{home_name}}`, `{{date}}` (UTC `YYYY-MM-DD`) and `{{user.<key>}}` for each
//!    user field; unknown placeholders are left untouched;
//! 4. seeds the canonical files the template does not provide from the embedded templates;
//! 5. writes the user fields into `USER.md` frontmatter, then the profile metadata (`agent_id`,
//!    `avatar`, `template_revision`, `updated_at`);
//! 6. renames the staging directory onto the destination (atomic on one filesystem). With `force`,
//!    an existing destination is first moved aside to `.<name>.replaced-<stamp>` (kept and
//!    reported), so the swap never loses data.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{
    HomeError,
    onboard::{OnboardOptions, seed_workspace},
    revision::{content_files, home_revision},
    user::UserProfile,
};

/// Text file extensions that receive placeholder substitution.
pub const TEXT_EXTENSIONS: &[&str] = &["md", "txt", "json", "toml", "yaml", "yml"];

/// Options for [`instantiate_template`].
#[derive(Debug, Clone, Default)]
pub struct TemplateOptions {
    /// Template directory.
    pub template: PathBuf,
    /// Destination home directory (created).
    pub destination: PathBuf,
    /// Agent identifier recorded in `USER.md` (`agent_id`). Defaults to the
    /// template's own `agent_id`, else the destination directory name.
    pub agent_id: Option<String>,
    /// Avatar (home-relative path or URL). Defaults to the template's.
    pub avatar: Option<String>,
    /// User frontmatter fields written into `USER.md` (for example
    /// `address_as`, `language`, `timezone`, `pronouns`).
    pub user_fields: Vec<(String, String)>,
    /// Replace an existing, non-empty destination (moved aside, not deleted).
    pub force: bool,
}

/// Outcome of [`instantiate_template`].
#[derive(Debug, Clone, Serialize)]
pub struct TemplateReport {
    /// Created home.
    pub destination: PathBuf,
    /// `sha256-v1` revision of the template.
    pub template_revision: String,
    /// Files copied from the template.
    pub copied: Vec<String>,
    /// Text files where at least one placeholder was substituted.
    pub substituted: Vec<String>,
    /// Canonical files seeded from the embedded templates.
    pub seeded: Vec<String>,
    /// Where a replaced destination was moved (`force`).
    pub replaced_backup: Option<PathBuf>,
    /// Final profile.
    pub profile: UserProfile,
    /// `sha256-v1` revision of the new home.
    pub revision: String,
}

fn is_text(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| TEXT_EXTENSIONS.iter().any(|t| t.eq_ignore_ascii_case(e)))
}

/// Replace `{{key}}` placeholders (whitespace inside the braces tolerated).
/// Returns `None` when nothing changed.
#[must_use]
pub fn substitute(input: &str, vars: &[(String, String)]) -> Option<String> {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    let mut changed = false;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        };
        let key = after[..end].trim();
        if let Some((_, value)) = vars.iter().find(|(k, _)| k == key) {
            out.push_str(value);
            changed = true;
        } else {
            out.push_str(&rest[start..start + 2 + end + 2]);
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    changed.then_some(out)
}

fn file_name_of(path: &Path) -> Result<String, HomeError> {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| HomeError::InvalidHomeName(path.display().to_string()))
}

fn dir_is_empty(path: &Path) -> Result<bool, HomeError> {
    let mut it = std::fs::read_dir(path).map_err(|e| HomeError::io(path, e))?;
    Ok(it.next().is_none())
}

/// Instantiate `opts.template` into `opts.destination` (see module docs).
///
/// # Errors
/// [`HomeError::HomeNotFound`] for a missing template,
/// [`HomeError::HomeExists`] for a non-empty destination without `force`,
/// [`HomeError::PathEscape`] for an avatar outside the home, and
/// [`HomeError::Io`] on filesystem failures (the staging directory is removed).
pub fn instantiate_template(opts: &TemplateOptions) -> Result<TemplateReport, HomeError> {
    if !opts.template.is_dir() {
        return Err(HomeError::HomeNotFound(opts.template.clone()));
    }
    let dest = &opts.destination;
    let name = file_name_of(dest)?;
    let parent = dest
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let dest_exists = dest.exists();
    if dest_exists && !dir_is_empty(dest)? && !opts.force {
        return Err(HomeError::HomeExists(dest.clone()));
    }
    std::fs::create_dir_all(&parent).map_err(|e| HomeError::io(&parent, e))?;
    let stamp = crate::time::file_stamp();
    let staging = parent.join(format!(".{name}.instantiate-{stamp}"));

    let built = build_staging(opts, &staging, &name);
    let (template_revision, copied, substituted, seeded) = match built {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(e);
        }
    };

    let mut replaced_backup = None;
    if dest_exists {
        if dir_is_empty(dest)? {
            std::fs::remove_dir(dest).map_err(|e| HomeError::io(dest, e))?;
        } else {
            let aside = parent.join(format!(".{name}.replaced-{stamp}"));
            std::fs::rename(dest, &aside).map_err(|e| HomeError::io(dest, e))?;
            replaced_backup = Some(aside);
        }
    }
    if let Err(e) = std::fs::rename(&staging, dest) {
        if let Some(aside) = &replaced_backup {
            let _ = std::fs::rename(aside, dest);
        }
        let _ = std::fs::remove_dir_all(&staging);
        return Err(HomeError::io(dest, e));
    }
    let profile = UserProfile::load(dest)?;
    let revision = home_revision(dest)?.revision;
    Ok(TemplateReport {
        destination: dest.clone(),
        template_revision,
        copied,
        substituted,
        seeded,
        replaced_backup,
        profile,
        revision,
    })
}

type Built = (String, Vec<String>, Vec<String>, Vec<String>);

fn build_staging(opts: &TemplateOptions, staging: &Path, name: &str) -> Result<Built, HomeError> {
    let template_revision = home_revision(&opts.template)?.revision;
    std::fs::create_dir_all(staging).map_err(|e| HomeError::io(staging, e))?;

    let template_profile = UserProfile::load(&opts.template)?;
    let agent_id = opts
        .agent_id
        .clone()
        .or_else(|| template_profile.agent_id.clone())
        .unwrap_or_else(|| name.to_string());
    let today = crate::time::now_iso8601()[..10].to_string();
    let mut vars: Vec<(String, String)> = vec![
        ("agent_id".into(), agent_id.clone()),
        ("home_name".into(), name.to_string()),
        ("date".into(), today),
    ];
    vars.extend(
        opts.user_fields
            .iter()
            .map(|(k, v)| (format!("user.{k}"), v.clone())),
    );

    let mut copied = Vec::new();
    let mut substituted = Vec::new();
    for file in content_files(&opts.template)? {
        let bytes = std::fs::read(&file.abs).map_err(|e| HomeError::io(&file.abs, e))?;
        let target = staging.join(&file.path);
        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir).map_err(|e| HomeError::io(dir, e))?;
        }
        let rewritten = if is_text(&file.path) {
            std::str::from_utf8(&bytes)
                .ok()
                .and_then(|text| substitute(text, &vars))
        } else {
            None
        };
        let body = match &rewritten {
            Some(text) => {
                substituted.push(file.path.clone());
                text.as_bytes()
            }
            None => &bytes[..],
        };
        std::fs::write(&target, body).map_err(|e| HomeError::io(&target, e))?;
        copied.push(file.path);
    }

    let seed = seed_workspace(&OnboardOptions::new(staging))?;
    let seeded = seed.created;

    UserProfile::write_user_fields(staging, &opts.user_fields)?;
    let mut profile = UserProfile::load(staging)?;
    profile.agent_id = Some(agent_id);
    if let Some(avatar) = &opts.avatar {
        profile.avatar = Some(avatar.clone());
    }
    profile.template_revision = Some(template_revision.clone());
    profile.write_profile_fields(staging)?;
    Ok((template_revision, copied, substituted, seeded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filenames::{AGENTS_FILENAME, SOUL_FILENAME, USER_FILENAME};

    fn write(root: &Path, rel: &str, body: &[u8]) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    fn template(root: &Path) {
        write(
            root,
            SOUL_FILENAME,
            b"# Soul\n\nTu es {{agent_id}} pour {{user.address_as}}.\n",
        );
        write(
            root,
            USER_FILENAME,
            b"---\nlanguage: fr\navatar: avatar.png\n---\n\nNotes {{ home_name }}.\n",
        );
        write(root, "avatar.png", b"\x89PNG{{agent_id}}");
        write(root, "memory/seed.md", b"Created {{date}} {{unknown}}\n");
        write(root, ".git/HEAD", b"ref\n");
    }

    #[test]
    fn substitute_replaces_known_and_keeps_unknown() {
        let vars = vec![("a".to_string(), "1".to_string())];
        assert_eq!(
            substitute("x {{a}} {{ a }} {{b}} {{", &vars).unwrap(),
            "x 1 1 {{b}} {{"
        );
        assert!(substitute("nothing", &vars).is_none());
    }

    #[test]
    fn instantiates_with_user_fields_profile_and_seeds() {
        let tpl = tempfile::tempdir().unwrap();
        template(tpl.path());
        let homes = tempfile::tempdir().unwrap();
        let dest = homes.path().join("user-42");
        let report = instantiate_template(&TemplateOptions {
            template: tpl.path().to_path_buf(),
            destination: dest.clone(),
            agent_id: Some("user:42".into()),
            user_fields: vec![("address_as".into(), "Sam".into())],
            ..TemplateOptions::default()
        })
        .unwrap();
        let soul = std::fs::read_to_string(dest.join(SOUL_FILENAME)).unwrap();
        assert!(soul.contains("Tu es user:42 pour Sam."), "{soul}");
        // Binary files are copied verbatim.
        assert_eq!(
            std::fs::read(dest.join("avatar.png")).unwrap(),
            b"\x89PNG{{agent_id}}"
        );
        let seed = std::fs::read_to_string(dest.join("memory/seed.md")).unwrap();
        assert!(seed.contains("{{unknown}}") && !seed.contains("{{date}}"));
        assert!(!dest.join(".git").exists());
        // Missing canonical files were seeded; template files were not overwritten.
        assert!(report.seeded.contains(&AGENTS_FILENAME.to_string()));
        assert!(!report.seeded.contains(&SOUL_FILENAME.to_string()));
        let user = UserProfile::load(&dest).unwrap();
        assert_eq!(user.address_as.as_deref(), Some("Sam"));
        assert_eq!(user.language.as_deref(), Some("fr"));
        assert_eq!(user.avatar.as_deref(), Some("avatar.png"));
        assert_eq!(user.agent_id.as_deref(), Some("user:42"));
        assert_eq!(
            user.template_revision.as_deref(),
            Some(report.template_revision.as_str())
        );
        assert!(user.updated_at.is_some());
        assert!(user.body.contains("Notes user-42."));
        // No staging directory left behind.
        let leftovers: Vec<_> = std::fs::read_dir(homes.path()).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn refuses_non_empty_destination_and_force_keeps_the_old_one_aside() {
        let tpl = tempfile::tempdir().unwrap();
        template(tpl.path());
        let homes = tempfile::tempdir().unwrap();
        let dest = homes.path().join("me");
        write(&dest, "MEMORY.md", b"precious\n");
        let mut opts = TemplateOptions {
            template: tpl.path().to_path_buf(),
            destination: dest.clone(),
            ..TemplateOptions::default()
        };
        assert!(matches!(
            instantiate_template(&opts),
            Err(HomeError::HomeExists(_))
        ));
        opts.force = true;
        let report = instantiate_template(&opts).unwrap();
        let aside = report.replaced_backup.unwrap();
        assert_eq!(
            std::fs::read(aside.join("MEMORY.md")).unwrap(),
            b"precious\n"
        );
        assert!(!dest.join("MEMORY.md").exists());
        assert_eq!(
            UserProfile::load(&dest).unwrap().agent_id.as_deref(),
            Some("me")
        );
    }

    #[test]
    fn missing_template_or_escaping_avatar_leaves_nothing() {
        let homes = tempfile::tempdir().unwrap();
        let dest = homes.path().join("x");
        let err = instantiate_template(&TemplateOptions {
            template: homes.path().join("nope"),
            destination: dest.clone(),
            ..TemplateOptions::default()
        })
        .unwrap_err();
        assert!(matches!(err, HomeError::HomeNotFound(_)));
        let tpl = tempfile::tempdir().unwrap();
        template(tpl.path());
        let err = instantiate_template(&TemplateOptions {
            template: tpl.path().to_path_buf(),
            destination: dest.clone(),
            avatar: Some("../../outside.png".into()),
            ..TemplateOptions::default()
        })
        .unwrap_err();
        assert!(matches!(err, HomeError::PathEscape { .. }));
        assert_eq!(std::fs::read_dir(homes.path()).unwrap().count(), 0);
    }
}
