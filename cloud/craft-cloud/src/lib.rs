//! Cloud files and documents for the craft apps and the OS shell.
//!
//! * [`CloudFiles`]: one trait over Google Drive ([`drive::GoogleDrive`]) and OneDrive / SharePoint
//!   ([`onedrive::OneDrive`], Microsoft Graph): list, stat, download, export, create, optimistic
//!   update with conflict detection, trash, change feeds, sharing, revisions, comments.
//! * [`offline::OfflineCache`]: content cache keyed by (id, version) with change-feed invalidation.
//! * [`graph::Graph`]: Microsoft Graph mail, calendar, contacts and To Do.
//! * Work in progress (not yet written): docs, sheets, slides, excel, photos, Google services, play, gemini
//!   (the backend Google services live in `bun-os-google`, feature `cloud`).
//!
//! Every client takes an [`aphrody_accounts::HttpTransport`] and a [`aphrody_accounts::TokenSource`], so
//! tests run on recorded fixtures and production runs on `ureq` with silently refreshed tokens.

pub mod api;
pub mod drive;
pub mod graph;
pub mod model;
pub mod offline;
pub mod onedrive;

pub use aphrody_accounts::{Error, Result};
pub use model::*;
