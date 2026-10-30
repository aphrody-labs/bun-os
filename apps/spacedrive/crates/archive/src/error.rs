//! Error types for adapter-backed sources.

/// Everything that can go wrong registering, syncing or searching a source.
/// Store failures pass through from [`sd_store::Error`].
#[derive(Debug, thiserror::Error)]
pub enum Error {
	#[error(transparent)]
	Store(#[from] sd_store::Error),

	#[error("database error: {0}")]
	Database(#[from] sqlx::Error),

	#[error("schema parse error: {0}")]
	SchemaParse(String),

	#[error("source not found: {0}")]
	SourceNotFound(String),

	#[error("adapter not found: {0}")]
	AdapterNotFound(String),

	#[error("adapter sync error: {0}")]
	AdapterSync(String),

	#[error("already exists: {0}")]
	AlreadyExists(String),

	#[error("io error: {0}")]
	Io(#[from] std::io::Error),

	#[error("json error: {0}")]
	Json(#[from] serde_json::Error),

	#[error("{0}")]
	Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;
