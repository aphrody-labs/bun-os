// SPDX-License-Identifier: Apache-2.0
//! File-based A2A coordination + HTTP bridge for aphrody.
//!
//! - [`AiManifest`] — rich `ai.json` (peers: Claude Code, Grok, agy, bxc = `aphrody web search`)
//! - [`Envelope`] — JSONL mailbox format (v1)
//! - [`PeerInvoker`] — headless CLI dispatch with verified Grok flags
//! - [`CoordProxy`] — a `.coord` JSONL mailbox as an NDJSON/SSE snapshot or a `tail -f` stream
//! - [`listener::serve`] — `127.0.0.1:8788` with `/ping`, `/msg`, `/coord`, A2A JSON-RPC, agent
//!   card

#![forbid(unsafe_code)]

mod auth;
pub mod bridge;
pub mod card;
pub mod claims;
pub mod envelope;
pub mod executor;
pub mod hub;
pub mod listener;
pub mod mailbox;
pub mod manifest;
pub mod peer;
pub mod proxy;
pub mod registry;
mod run_trace;
pub mod task_api;

pub use bridge::{SendParams, a2a_router};
pub use card::agent_card_from_manifest;
pub use envelope::{Envelope, EnvelopeKind};
pub use executor::CoordPeerExecutor;
pub use hub::{HubClient, HubError, PeerRecord, SelfIdentity};
pub use listener::{
    ListenerConfig, ServeOptions, router_for_profile, serve, serve_profile, serve_with_options,
};
pub use manifest::{AiManifest, CoordConfig, PeerDef, find_repo_root};
pub use peer::{PeerId, PeerInvokeResult, PeerInvoker};
pub use proxy::{
    CoordBody, CoordError, CoordProxy, CoordResponseKind, DEFAULT_TAIL_INTERVAL,
    HttpResponse as CoordHttpResponse, NDJSON_CONTENT_TYPE, SSE_CONTENT_TYPE,
};
pub use registry::PeerRegistry;
