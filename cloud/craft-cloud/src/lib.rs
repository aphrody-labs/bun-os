//! Cloud files and documents for the craft apps and the OS shell.
//!
//! * [`CloudFiles`]: one trait over Google Drive ([`drive::GoogleDrive`]) and OneDrive / SharePoint
//!   ([`onedrive::OneDrive`], Microsoft Graph): list, stat, download, export, create, optimistic
//!   update with conflict detection, trash, change feeds, sharing, revisions, comments.
//! * [`offline::OfflineCache`]: content cache keyed by (id, version) with change-feed invalidation.
//! * Work in progress (not yet written): docs, sheets, slides, excel, photos, services, play, gemini.
//!
//! Every client takes an [`aphrody_accounts::HttpTransport`] and a [`aphrody_accounts::TokenSource`], so
//! tests run on recorded fixtures and production runs on `ureq` with silently refreshed tokens.

pub mod api;
pub mod drive;
pub mod model;
pub mod offline;
pub mod onedrive;

pub use aphrody_accounts::{Error, Result};
pub use model::*;
