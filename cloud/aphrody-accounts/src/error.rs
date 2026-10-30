//! Error type shared by the accounts layer and the cloud clients built on it.

/// Result alias.
pub type Result<T> = std::result::Result<T, Error>;

/// Everything that can go wrong between "open the browser" and "a bearer token".
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Network or TLS failure below HTTP.
    #[error("http transport: {0}")]
    Transport(String),
    /// The authorization server answered with an OAuth error object.
    #[error("oauth error `{code}`: {description}")]
    OAuth {
        /// RFC 6749 error code (`invalid_grant`, `access_denied`, ...).
        code: String,
        /// `error_description`, possibly empty.
        description: String,
    },
    /// A resource server answered with a non-success status.
    #[error("api error {status}: {message}")]
    Api {
        /// HTTP status.
        status: u16,
        /// Server message (already truncated, never contains tokens).
        message: String,
    },
    /// The user declined consent or the loopback redirect carried `error=`.
    #[error("authorization denied: {0}")]
    Denied(String),
    /// Device code or loopback wait exceeded its deadline.
    #[error("timed out waiting for the user")]
    Timeout,
    /// `state` parameter of the redirect did not match the one we issued.
    #[error("state mismatch on the redirect (possible CSRF)")]
    StateMismatch,
    /// The stored refresh token is no longer accepted; the user must sign in again.
    #[error("account `{0}` needs to sign in again")]
    ReauthRequired(String),
    /// The account has not granted every requested scope; run the consent flow again.
    #[error("account `{account}` has not granted: {missing:?}")]
    MissingScopes {
        /// Account id.
        account: String,
        /// Scopes that are not covered by the stored grant.
        missing: Vec<String>,
    },
    /// Unknown account id.
    #[error("unknown account `{0}`")]
    UnknownAccount(String),
    /// No OAuth client is registered for this provider.
    #[error("no OAuth client registered for {0}")]
    NoClient(&'static str),
    /// Credential store failure (keyring, encrypted file, ...).
    #[error("credential store: {0}")]
    Vault(String),
    /// Malformed JSON or token.
    #[error("invalid data: {0}")]
    Invalid(String),
    /// The provider has no API for this operation (documented per provider in docs/GOOGLE.md and docs/MICROSOFT-ACCOUNTS.md).
    #[error("unsupported: {0}")]
    Unsupported(&'static str),
    /// Optimistic-concurrency failure: the remote changed since the version we edited.
    #[error("conflict: remote version changed")]
    Conflict,
    /// Local I/O.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Invalid(e.to_string())
    }
}
