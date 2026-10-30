// SPDX-License-Identifier: Apache-2.0
//! `USER.md` -> typed [`UserProfile`] (AH-3).
//!
//! Captures who the agent serves and how to address them. The display name is
//! resolved at runtime from `USER.md` (CLAUDE.md anonymisation rule: the
//! crate ships no real person's name; templates use a neutral placeholder).

use serde::{Deserialize, Serialize};

use std::path::{Path, PathBuf};

use crate::{
    HomeError,
    filenames::USER_FILENAME,
    frontmatter::{self, FmValue},
    guard::WorkspaceGuard,
};

/// Whether an avatar value is a URL rather than a home-relative path.
fn is_url(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("data:")
}

/// Parsed `USER.md`: the human the agent serves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct UserProfile {
    /// How to address the user (e.g. their first name or a handle).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address_as: Option<String>,
    /// Pronouns to use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pronouns: Option<String>,
    /// Timezone (IANA name, e.g. `Europe/Paris`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    /// Preferred working language.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Free-form preferences the agent should honour.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preferences: Vec<String>,
    /// Avatar: a home-relative image path (resolved through the workspace
    /// guard by [`UserProfile::avatar_path`]) or an `https:` / `data:` URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
    /// Stable identifier of the agent bound to this home (for example
    /// `local` or `user:<id>`). Kept verbatim; the directory name is its
    /// sanitised form ([`crate::paths::sanitize_profile`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// ISO-8601 UTC instant of the last profile write (instantiation, profile
    /// update, merge, rename).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Revision ([`crate::revision`], `sha256-v1:`) of the template the home was
    /// instantiated from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_revision: Option<String>,
    /// Residual markdown body.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub body: String,
}

impl UserProfile {
    /// Parse `USER.md` content. Never fails; missing fields stay `None`.
    #[must_use]
    pub fn parse(content: &str) -> Self {
        let (fm, body) = frontmatter::split(content);
        let mut user = UserProfile {
            body: body.to_string(),
            ..UserProfile::default()
        };
        if let Some(fm) = fm {
            for (key, val) in frontmatter::parse(fm) {
                match (key.as_str(), val) {
                    ("address_as" | "name" | "call_me", FmValue::Scalar(s))
                        if !s.trim().is_empty() =>
                    {
                        user.address_as = Some(s.trim().to_string());
                    }
                    ("pronouns", FmValue::Scalar(s)) if !s.trim().is_empty() => {
                        user.pronouns = Some(s.trim().to_string());
                    }
                    ("timezone" | "tz", FmValue::Scalar(s)) if !s.trim().is_empty() => {
                        user.timezone = Some(s.trim().to_string());
                    }
                    ("language" | "lang", FmValue::Scalar(s)) if !s.trim().is_empty() => {
                        user.language = Some(s.trim().to_string());
                    }
                    ("preferences", FmValue::List(v)) => user.preferences = v,
                    ("preferences", FmValue::Scalar(s)) if !s.trim().is_empty() => {
                        user.preferences = vec![s.trim().to_string()];
                    }
                    ("avatar", FmValue::Scalar(s)) if !s.trim().is_empty() => {
                        user.avatar = Some(s.trim().to_string());
                    }
                    ("agent_id", FmValue::Scalar(s)) if !s.trim().is_empty() => {
                        user.agent_id = Some(s.trim().to_string());
                    }
                    ("updated_at", FmValue::Scalar(s)) if !s.trim().is_empty() => {
                        user.updated_at = Some(s.trim().to_string());
                    }
                    ("template_revision", FmValue::Scalar(s)) if !s.trim().is_empty() => {
                        user.template_revision = Some(s.trim().to_string());
                    }
                    _ => {}
                }
            }
        }
        user
    }

    /// Resolve a home-relative avatar to an absolute path inside `home`.
    ///
    /// Returns `Ok(None)` when no avatar is set or when it is a URL
    /// (`https:`, `http:`, `data:`), which callers display as-is.
    ///
    /// # Errors
    /// [`HomeError::PathEscape`] when the relative path leaves the home.
    pub fn avatar_path(&self, home: &Path) -> Result<Option<PathBuf>, HomeError> {
        let Some(avatar) = self.avatar.as_deref() else {
            return Ok(None);
        };
        if is_url(avatar) {
            return Ok(None);
        }
        WorkspaceGuard::new(home).resolve(avatar).map(Some)
    }

    /// Profile metadata as frontmatter pairs, in canonical key order.
    fn profile_pairs(&self) -> [(&'static str, Option<&str>); 4] {
        [
            ("agent_id", self.agent_id.as_deref()),
            ("avatar", self.avatar.as_deref()),
            ("template_revision", self.template_revision.as_deref()),
            ("updated_at", self.updated_at.as_deref()),
        ]
    }

    /// Write the profile metadata (`agent_id`, `avatar`, `template_revision`,
    /// `updated_at`) into `USER.md` of `home`, preserving every other key and
    /// the body. `updated_at` is stamped with the current UTC instant. The file
    /// is replaced atomically (temp file + rename).
    ///
    /// # Errors
    /// [`HomeError::Io`] on filesystem failure, [`HomeError::PathEscape`] for
    /// an avatar path that leaves the home.
    pub fn write_profile_fields(&mut self, home: &Path) -> Result<(), HomeError> {
        self.avatar_path(home)?;
        self.updated_at = Some(crate::time::now_iso8601());
        let path = home.join(USER_FILENAME);
        let current = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(HomeError::io(&path, e)),
        };
        let updated = frontmatter::upsert_scalars(&current, &self.profile_pairs());
        crate::fsutil::write_atomic(&path, updated.as_bytes())
    }

    /// Set user-facing scalar fields (`address_as`, `pronouns`, `timezone`,
    /// `language`) in `USER.md` of `home` from `fields`, keeping everything
    /// else. Unknown keys are written verbatim as additional scalars.
    ///
    /// # Errors
    /// [`HomeError::Io`] on filesystem failure.
    pub fn write_user_fields(home: &Path, fields: &[(String, String)]) -> Result<(), HomeError> {
        if fields.is_empty() {
            return Ok(());
        }
        let path = home.join(USER_FILENAME);
        let current = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(HomeError::io(&path, e)),
        };
        let pairs: Vec<(&str, Option<&str>)> = fields
            .iter()
            .map(|(k, v)| (k.as_str(), Some(v.as_str())))
            .collect();
        let updated = frontmatter::upsert_scalars(&current, &pairs);
        crate::fsutil::write_atomic(&path, updated.as_bytes())
    }

    /// Load `USER.md` from `home` (default profile when absent).
    ///
    /// # Errors
    /// [`HomeError::Io`] on read failure other than not-found.
    pub fn load(home: &Path) -> Result<Self, HomeError> {
        let path = home.join(USER_FILENAME);
        match std::fs::read_to_string(&path) {
            Ok(s) => Ok(Self::parse(&s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(HomeError::io(path, e)),
        }
    }

    /// Render the profile as a directive block for the system prompt.
    #[must_use]
    pub fn render_directives(&self) -> String {
        let mut out = String::new();
        if let Some(a) = &self.address_as {
            out.push_str("Address the user as ");
            out.push_str(a);
            if let Some(p) = &self.pronouns {
                out.push_str(" (");
                out.push_str(p);
                out.push(')');
            }
            out.push_str(".\n");
        } else if let Some(p) = &self.pronouns {
            out.push_str("User pronouns: ");
            out.push_str(p);
            out.push_str(".\n");
        }
        if let Some(tz) = &self.timezone {
            out.push_str("User timezone: ");
            out.push_str(tz);
            out.push_str(".\n");
        }
        if let Some(lang) = &self.language {
            out.push_str("Preferred language: ");
            out.push_str(lang);
            out.push_str(".\n");
        }
        if !self.preferences.is_empty() {
            out.push_str("Preferences:\n");
            for p in &self.preferences {
                out.push_str("- ");
                out.push_str(p);
                out.push('\n');
            }
        }
        if !self.body.is_empty() {
            out.push_str(self.body.trim_end());
            out.push('\n');
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_fields() {
        let src = "---\naddress_as: Sam\npronouns: they/them\ntimezone: Europe/Paris\nlanguage: \
                   French\npreferences:\n  - metric units\n  - no emoji\n---\nNotes.\n";
        let u = UserProfile::parse(src);
        assert_eq!(u.address_as.as_deref(), Some("Sam"));
        assert_eq!(u.pronouns.as_deref(), Some("they/them"));
        assert_eq!(u.timezone.as_deref(), Some("Europe/Paris"));
        assert_eq!(u.language.as_deref(), Some("French"));
        assert_eq!(
            u.preferences,
            vec!["metric units".to_string(), "no emoji".to_string()]
        );
        assert_eq!(u.body.trim(), "Notes.");
    }

    #[test]
    fn empty_yields_default() {
        assert_eq!(UserProfile::parse(""), UserProfile::default());
    }

    #[test]
    fn render_directives_addresses_user() {
        let u = UserProfile {
            address_as: Some("Sam".into()),
            pronouns: Some("they/them".into()),
            timezone: Some("UTC".into()),
            language: None,
            preferences: vec!["metric".into()],
            body: String::new(),
            ..UserProfile::default()
        };
        let d = u.render_directives();
        assert!(d.contains("Address the user as Sam (they/them)."));
        assert!(d.contains("User timezone: UTC."));
        assert!(d.contains("- metric"));
    }

    #[test]
    fn parses_profile_metadata_without_injecting_it() {
        let src = "---\nname: Sam\navatar: img/me.png\nagent_id: user:42\nupdated_at: \
                   2026-10-06T10:00:00Z\ntemplate_revision: sha256-v1:ab\n---\n";
        let u = UserProfile::parse(src);
        assert_eq!(u.avatar.as_deref(), Some("img/me.png"));
        assert_eq!(u.agent_id.as_deref(), Some("user:42"));
        assert_eq!(u.updated_at.as_deref(), Some("2026-10-06T10:00:00Z"));
        assert_eq!(u.template_revision.as_deref(), Some("sha256-v1:ab"));
        // Metadata is not prompt material.
        let d = u.render_directives();
        assert!(!d.contains("img/me.png") && !d.contains("user:42"), "{d}");
    }

    #[test]
    fn write_profile_fields_round_trips_and_keeps_body() {
        let td = tempfile::tempdir().unwrap();
        std::fs::write(
            td.path().join(USER_FILENAME),
            "---\nname: Sam\n---\n\nNotes.\n",
        )
        .unwrap();
        let mut u = UserProfile::load(td.path()).unwrap();
        u.avatar = Some("avatar.png".into());
        u.agent_id = Some("local".into());
        u.write_profile_fields(td.path()).unwrap();
        let back = UserProfile::load(td.path()).unwrap();
        assert_eq!(back.address_as.as_deref(), Some("Sam"));
        assert_eq!(back.avatar.as_deref(), Some("avatar.png"));
        assert_eq!(back.agent_id.as_deref(), Some("local"));
        assert!(back.updated_at.as_deref().is_some_and(|t| t.ends_with('Z')));
        assert_eq!(back.body.trim(), "Notes.");
        let avatar = back.avatar_path(td.path()).unwrap().unwrap();
        assert_eq!(avatar.file_name().unwrap(), "avatar.png");
    }

    #[test]
    fn avatar_cannot_escape_the_home_but_urls_pass() {
        let td = tempfile::tempdir().unwrap();
        let mut u = UserProfile {
            avatar: Some("../../outside.png".into()),
            ..UserProfile::default()
        };
        assert!(matches!(
            u.write_profile_fields(td.path()),
            Err(HomeError::PathEscape { .. })
        ));
        u.avatar = Some("https://example.invalid/a.png".into());
        assert!(u.avatar_path(td.path()).unwrap().is_none());
        u.write_profile_fields(td.path()).unwrap();
    }

    #[test]
    fn name_alias_maps_to_address_as() {
        let u = UserProfile::parse("---\nname: Alex\n---\n");
        assert_eq!(u.address_as.as_deref(), Some("Alex"));
    }
}
