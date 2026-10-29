// SPDX-License-Identifier: Apache-2.0
//! Profile-scoped paths and namespaces for persistent agent services.
//!
//! Callers resolve the profile workspace once, then pass that explicit root to
//! [`ProfileServiceContext::new`].  This keeps database, cache, A2A, OCR and
//! Redis state in one namespace and prevents each service from independently
//! falling back to a process-global `~/.aphrody` path.

use std::path::{Path, PathBuf};

use aphrody_config::{
    Config, DatabaseCache, DatabaseConfig, DatabaseType, OcrConfig, OcrEngine, RedisConfig,
};

/// Invalid or unavailable profile service configuration.
#[derive(Debug, thiserror::Error)]
pub enum ServiceConfigError {
    /// A configured secret-bearing URL environment variable is absent.
    #[error("profile database environment variable `{name}` is not set")]
    MissingEnvironment {
        /// Environment variable named by `database.url_env`.
        name: String,
    },
    /// A relative state path tried to leave the selected profile workspace.
    #[error("profile service path `{path}` escapes its workspace")]
    EscapingPath {
        /// Rejected relative path.
        path: String,
    },
    /// A configured Redis prefix was empty and would expose global keys.
    #[error("profile redis.prefix cannot be empty")]
    EmptyRedisPrefix,
}

/// All durable paths and logical namespaces owned by one Home Agent profile.
///
/// Construction is pure: it does not create directories, open a database or
/// connect to Redis.  Consumers remain responsible for those operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileServiceContext {
    profile: Option<String>,
    namespace: String,
    root: PathBuf,
    database_type: Option<DatabaseType>,
    database_url: Option<String>,
    database_path: PathBuf,
    database_cache: Option<DatabaseCache>,
    sqlite_cache_path: PathBuf,
    ocr_engines: Vec<OcrEngine>,
    ocr_dir: PathBuf,
    redis_url: Option<String>,
    redis_prefix: String,
    postgres_schema: String,
}

impl ProfileServiceContext {
    /// Build a service context from an already resolved profile workspace.
    ///
    /// `root` is normally the value returned by [`crate::paths::resolve_workspace`].
    /// Accepting it explicitly makes tests and embedded API/desktop callers
    /// independent of process-wide environment variables.
    #[must_use]
    pub fn new(root: impl Into<PathBuf>, profile: Option<&str>) -> Self {
        let profile = profile
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        let namespace = profile
            .as_deref()
            .map_or_else(|| "aphrody".to_owned(), profile_namespace);
        let root = root.into();
        Self {
            profile,
            database_type: None,
            database_url: None,
            database_path: root.join("db").join("agent.db"),
            database_cache: None,
            sqlite_cache_path: root.join("cache").join("state.db"),
            ocr_engines: Vec::new(),
            ocr_dir: root.join("ocr"),
            redis_url: None,
            redis_prefix: format!("{namespace}:"),
            postgres_schema: format!("aphrody_{}", namespace.replace('-', "_")),
            namespace,
            root,
        }
    }

    /// Resolve all database, OCR and Redis values from an effective profile.
    ///
    /// Relative state paths are anchored inside `root`. `database.url_env` is
    /// dereferenced here, at the service boundary, so the secret never enters
    /// the serializable [`Config`].
    pub fn from_config(
        root: impl Into<PathBuf>,
        config: &Config,
    ) -> Result<Self, ServiceConfigError> {
        Self::from_components(
            root,
            config.active_profile.as_deref(),
            &config.database,
            &config.ocr,
            &config.redis,
            |name| std::env::var(name).ok(),
        )
    }

    /// Resolve service values with an explicit environment lookup.
    ///
    /// This variant is useful to embedded hosts which keep credentials outside
    /// the process environment and makes resolution deterministic in tests.
    pub fn from_components(
        root: impl Into<PathBuf>,
        profile: Option<&str>,
        database: &DatabaseConfig,
        ocr: &OcrConfig,
        redis: &RedisConfig,
        environment: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, ServiceConfigError> {
        let mut context = Self::new(root, profile);
        context.database_type = database.db_type;
        context.database_cache = database.cache;
        context.database_url = match database.url_env.as_deref() {
            Some(name) => Some(
                environment(name)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| ServiceConfigError::MissingEnvironment {
                        name: name.to_owned(),
                    })?,
            ),
            None => database.url.clone(),
        };
        if database.db_type == Some(DatabaseType::Sqlite)
            && let Some(raw) = context.database_url.as_deref()
        {
            context.database_path = resolve_sqlite_path(&context.root, raw)?;
        }
        if let Some(raw) = database.cache_path.as_deref() {
            context.sqlite_cache_path = resolve_profile_path(&context.root, raw)?;
        }
        if let Some(schema) = database
            .schema
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            schema.clone_into(&mut context.postgres_schema);
        }

        context.ocr_engines.clone_from(&ocr.engines);
        if let Some(raw) = ocr.state_path.as_deref() {
            context.ocr_dir = resolve_profile_path(&context.root, raw)?;
        }

        context.redis_url.clone_from(&redis.url);
        if let Some(prefix) = redis.prefix.as_deref() {
            if prefix.is_empty() {
                return Err(ServiceConfigError::EmptyRedisPrefix);
            }
            prefix.clone_into(&mut context.redis_prefix);
        }
        Ok(context)
    }

    /// Resolve the workspace with the canonical Home Agent path authority.
    ///
    /// # Errors
    ///
    /// Returns [`crate::HomeError::NoHome`] if no state directory is available.
    pub fn resolve(profile: Option<&str>) -> Result<Self, crate::HomeError> {
        let root = crate::paths::resolve_workspace(profile, None)?;
        Ok(Self::new(root, profile))
    }

    /// Selected profile name before filesystem/namespace normalization.
    #[must_use]
    pub fn profile(&self) -> Option<&str> {
        self.profile.as_deref()
    }

    /// Explicit root shared by every service in this profile.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Stable path-safe and Redis-safe namespace identifier.
    #[must_use]
    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    /// Profile-local primary `SQLite` database.
    #[must_use]
    pub fn database_path(&self) -> PathBuf {
        self.database_path.clone()
    }

    /// Configured database implementation.
    #[must_use]
    pub const fn database_type(&self) -> Option<DatabaseType> {
        self.database_type
    }

    /// Resolved database URL, including a value obtained from `url_env`.
    #[must_use]
    pub fn database_url(&self) -> Option<&str> {
        self.database_url.as_deref()
    }

    /// Local file the memory provider can actually open for this profile.
    ///
    /// A `PostgreSQL` authority only has a local memory store when its profile
    /// explicitly enables the `SQLite` WAL cache.
    #[must_use]
    pub fn local_memory_path(&self) -> Option<&Path> {
        match self.database_type {
            Some(DatabaseType::Postgres) => (self.database_cache == Some(DatabaseCache::SqliteWal))
                .then_some(self.sqlite_cache_path.as_path()),
            Some(DatabaseType::Sqlite) | None => Some(self.database_path.as_path()),
        }
    }

    /// Profile-local directory for caches of every backend.
    #[must_use]
    pub fn cache_dir(&self) -> PathBuf {
        self.root.join("cache")
    }

    /// Profile-local `SQLite` WAL cache used in front of remote databases.
    #[must_use]
    pub fn sqlite_cache_path(&self) -> PathBuf {
        self.sqlite_cache_path.clone()
    }

    /// Profile-local A2A mailbox directory.
    #[must_use]
    pub fn a2a_mailbox_dir(&self) -> PathBuf {
        self.root.join(".coord")
    }

    /// Profile-local OCR state directory.
    #[must_use]
    pub fn ocr_dir(&self) -> PathBuf {
        self.ocr_dir.clone()
    }

    /// Profile-local OCR corpus projection.
    #[must_use]
    pub fn ocr_database_path(&self) -> PathBuf {
        self.ocr_dir.join("corpus.db")
    }

    /// Profile-local OCR intermediate cache.
    #[must_use]
    pub fn ocr_cache_dir(&self) -> PathBuf {
        self.ocr_dir.join("cache")
    }

    /// Ordered OCR engines selected by this profile.
    #[must_use]
    pub fn ocr_engines(&self) -> &[OcrEngine] {
        &self.ocr_engines
    }

    /// Redis key prefix, including its trailing separator.
    #[must_use]
    pub fn redis_prefix(&self) -> String {
        self.redis_prefix.clone()
    }

    /// Qualify a Redis key so consumers cannot accidentally use a global key.
    #[must_use]
    pub fn redis_key(&self, key: &str) -> String {
        format!("{}{key}", self.redis_prefix)
    }

    /// Configured Redis URL for this profile.
    #[must_use]
    pub fn redis_url(&self) -> Option<&str> {
        self.redis_url.as_deref()
    }

    /// `PostgreSQL` schema identifier for this profile.
    #[must_use]
    pub fn postgres_schema(&self) -> String {
        self.postgres_schema.clone()
    }
}

fn resolve_sqlite_path(root: &Path, raw: &str) -> Result<PathBuf, ServiceConfigError> {
    let path = raw
        .strip_prefix("sqlite://")
        .or_else(|| raw.strip_prefix("sqlite:"))
        .unwrap_or(raw);
    resolve_profile_path(root, path)
}

fn resolve_profile_path(root: &Path, raw: &str) -> Result<PathBuf, ServiceConfigError> {
    let path = Path::new(raw);
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    if path
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(ServiceConfigError::EscapingPath {
            path: raw.to_owned(),
        });
    }
    Ok(root.join(path))
}

/// Preserve simple canonical profile names (`worker` -> `worker`) while
/// making arbitrary TOML profile keys collision-resistant and service-safe.
fn profile_namespace(profile: &str) -> String {
    let trimmed = profile.trim();
    let sanitized = crate::paths::sanitize_profile(trimmed);
    if !sanitized.is_empty() && trimmed == sanitized {
        return sanitized;
    }

    let stem = if sanitized.is_empty() {
        "profile"
    } else {
        sanitized.as_str()
    };
    let digest = blake3::hash(trimmed.as_bytes()).to_hex();
    format!("{stem}-{}", &digest[..12])
}

#[cfg(test)]
mod tests {
    use aphrody_config::{
        DatabaseCache, DatabaseConfig, DatabaseType, OcrConfig, OcrEngine, RedisConfig,
    };

    use super::*;

    #[test]
    fn two_profiles_share_no_durable_service_namespace() {
        let state = Path::new("/var/lib/aphrody");
        let worker = ProfileServiceContext::new(state.join("workspace-worker"), Some("worker"));
        let niers = ProfileServiceContext::new(state.join("workspace-niers"), Some("niers"));

        let worker_paths = [
            worker.database_path(),
            worker.sqlite_cache_path(),
            worker.a2a_mailbox_dir(),
            worker.ocr_database_path(),
            worker.ocr_cache_dir(),
        ];
        let niers_paths = [
            niers.database_path(),
            niers.sqlite_cache_path(),
            niers.a2a_mailbox_dir(),
            niers.ocr_database_path(),
            niers.ocr_cache_dir(),
        ];

        assert!(
            worker_paths
                .iter()
                .all(|path| path.starts_with(worker.root()))
        );
        assert!(
            niers_paths
                .iter()
                .all(|path| path.starts_with(niers.root()))
        );
        for left in &worker_paths {
            for right in &niers_paths {
                assert_ne!(left, right);
            }
        }
        assert_eq!(worker.redis_prefix(), "worker:");
        assert_eq!(worker.redis_key("rag:answer"), "worker:rag:answer");
        assert_eq!(niers.redis_prefix(), "niers:");
        assert_ne!(worker.postgres_schema(), niers.postgres_schema());
    }

    #[test]
    fn noncanonical_profile_names_cannot_collide_after_sanitizing() {
        let root = Path::new("/state/workspace");
        let slash = ProfileServiceContext::new(root, Some("a/b"));
        let question = ProfileServiceContext::new(root, Some("a?b"));
        let canonical = ProfileServiceContext::new(root, Some("a-b"));

        assert_ne!(slash.namespace(), question.namespace());
        assert_ne!(slash.namespace(), canonical.namespace());
        assert_ne!(question.redis_prefix(), canonical.redis_prefix());
        assert!(slash.namespace().starts_with("a-b-"));
    }

    #[test]
    fn construction_is_pure_and_does_not_create_the_root() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().join("missing").join("workspace-worker");
        let context = ProfileServiceContext::new(&root, Some("worker"));

        assert!(!root.exists());
        assert_eq!(context.a2a_mailbox_dir(), root.join(".coord"));
        assert_eq!(context.ocr_database_path(), root.join("ocr/corpus.db"));
    }

    #[test]
    fn resolved_components_drive_profile_specific_domain_values() {
        let root = Path::new("/state/workspace-worker");
        let database = DatabaseConfig {
            db_type: Some(DatabaseType::Postgres),
            url: None,
            url_env: Some("WORKER_DATABASE_URL".into()),
            schema: Some("worker_canon".into()),
            cache: Some(DatabaseCache::SqliteWal),
            cache_path: Some("cache/memory.db".into()),
        };
        let ocr = OcrConfig {
            engines: vec![OcrEngine::PpOcrV5, OcrEngine::DotsOcr3b],
            state_path: Some("ocr-state".into()),
        };
        let redis = RedisConfig {
            url: Some("redis://127.0.0.1:6379/1".into()),
            prefix: Some("worker:".into()),
        };
        let context = ProfileServiceContext::from_components(
            root,
            Some("worker"),
            &database,
            &ocr,
            &redis,
            |name| (name == "WORKER_DATABASE_URL").then(|| "postgres://db/worker".into()),
        )
        .unwrap();

        assert_eq!(context.database_url(), Some("postgres://db/worker"));
        assert_eq!(
            context.local_memory_path(),
            Some(root.join("cache/memory.db").as_path())
        );
        assert_eq!(context.postgres_schema(), "worker_canon");
        assert_eq!(
            context.ocr_database_path(),
            root.join("ocr-state/corpus.db")
        );
        assert_eq!(
            context.ocr_engines(),
            &[OcrEngine::PpOcrV5, OcrEngine::DotsOcr3b]
        );
        assert_eq!(context.redis_url(), Some("redis://127.0.0.1:6379/1"));
        assert_eq!(context.redis_key("rag:answer"), "worker:rag:answer");
    }

    #[test]
    fn relative_service_paths_cannot_escape_the_profile() {
        let database = DatabaseConfig {
            db_type: Some(DatabaseType::Sqlite),
            url: Some("../other/agent.db".into()),
            ..DatabaseConfig::default()
        };
        let error = ProfileServiceContext::from_components(
            "/state/workspace-a",
            Some("a"),
            &database,
            &OcrConfig::default(),
            &RedisConfig::default(),
            |_| None,
        )
        .unwrap_err();
        assert!(matches!(error, ServiceConfigError::EscapingPath { .. }));
    }
}
