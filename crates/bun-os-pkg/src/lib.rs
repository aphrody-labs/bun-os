// Leaf crate on std, outside the event loop (like `bun_host`): std I/O and strings are intended.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
// SPDX-License-Identifier: Apache-2.0
//! Package contracts, verified content-addressed blob store, bounded HTTP ingestion and the store command line.
//! One crate, four layers: `metadata` (pure, no I/O) <- `store` <- `net` <- `cli`.
#![forbid(unsafe_code)]

pub mod cli;
pub mod metadata;
pub mod net;
pub mod store;
