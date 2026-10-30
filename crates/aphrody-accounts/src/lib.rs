//! Aphrody OS identity layer: Google and Microsoft accounts for the whole OS.
//!
//! * Google OAuth 2.0: authorization code + PKCE over a loopback redirect, device grant (limited
//!   scopes), incremental authorization, refresh, revocation.
//! * Microsoft identity platform (Entra): same flows for personal (`consumers`), work (`organizations`),
//!   mixed (`common`) and single-tenant accounts, with rotating refresh tokens.
//! * Several accounts at once; secrets live in the OS keyring (or `aphrody-secrets`), metadata in a
//!   JSON index that never contains token material.
//! * [`TokenSource`] is the seam every cloud client (`craft-cloud`, Spacedrive volumes, webos
//!   services) uses to get a valid bearer token.
//!
//! Nothing here stores or logs a client secret, refresh token or access token outside the vault;
//! `Debug` impls redact them.

pub mod error;
pub mod flow;
pub mod http;
pub mod loopback;
pub mod manager;
pub mod pkce;
pub mod provider;
pub mod scopes;
pub mod testing;
pub mod token;
pub mod vault;

pub use error::{Error, Result};
pub use http::{Body, HttpRequest, HttpResponse, HttpTransport, UreqTransport};
pub use manager::{Account, AccountManager, StaticToken, TokenSource};
pub use provider::{Endpoints, Provider, ProviderConfig, Tenant};
pub use token::{IdClaims, TokenSet};
#[cfg(feature = "os-keyring")]
pub use vault::KeyringVault;
#[cfg(feature = "secrets")]
pub use vault::SecretStoreVault;
pub use vault::{MemoryVault, TokenVault};
