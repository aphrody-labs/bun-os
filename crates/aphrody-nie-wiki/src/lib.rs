//! `aphrody-nie-wiki` — IEVR game-data exploration over the read-only SQLite mirror.
//!
//! Ports the `chara`, `skill`, `item`, `team`, `compare`, `search`, `db`,
//! `random-team`, `team-builder`, `status`, `redis`, `audit` and `dialogue`
//! operations from the Azalee CLI to Rust, reading the local `inagle_*` mirror.
//!
//! ## Compatibility rules retained from the original implementation
//!
//! - Null `category_id`/`element_id` values fall back to localized text columns.
//! - `data` and `sheet_data` are merged, with non-empty `sheet_data` taking precedence.
//! - Missing `*_clean` views are represented with a `GROUP BY name_fr` query.
//! - Search filters preserve underscores because aura IDs contain them.
//! - `random-team` uses an explicit `SmallRng::seed_from_u64` seed.
//! - `db [sql]` accepts read-only statements only.
//!
//! The native IEVR wiki surface is split by source truth. The mirror-backed
//! aura, tactic and passive APIs live in [`auras`], [`tactics`] and [`passives`].
//! Static TypeScript enrichments, CDN URLs, GLB manifests and network-only joins
//! are not present in this crate and are never represented as fabricated Rust data.
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

pub mod auras;
pub mod auxiliary;
pub mod cards;
pub mod catalog;
pub mod cross;
/// Origin of the NIE asset CDN: `NIE_CDN_BASE` (no trailing slash), else the public default.
pub(crate) fn cdn_base() -> String {
    std::env::var("NIE_CDN_BASE")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "https://cdn.rosegriffon.fr".to_string())
}

pub mod desktop;
pub mod entities;
pub mod episodes;
pub mod gallery;
pub mod legacy;
pub mod legacy_entities;
pub mod legacy_equipment;
pub mod legacy_gallery;
pub mod legacy_locations;
pub mod legacy_teams;
pub mod mirror;
pub mod model;
pub mod models;
pub mod names;
pub mod passives;
pub mod query;
pub mod render;
pub mod tactics;
