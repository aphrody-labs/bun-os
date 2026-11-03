// SPDX-License-Identifier: Apache-2.0
//! # aphrody-code-graph
//!
//! Native code graph for the agent home: the in-memory [`Graph`] (loaded from, and saved to, the
//! graph tables of `aphrody-store`), graph analysis (god nodes, Louvain communities, modularity),
//! the `query`, `path` and `explain` operations, a markdown report and the Graphify-compatible
//! `graph.json` export. Everything is offline and deterministic.

#![deny(unsafe_code)]

pub mod analyze;
pub mod api;
pub mod cli;
pub mod error;
pub mod export;
pub mod extract;
pub mod graph;
pub mod pipeline;
pub mod query;
pub mod report;

pub use crate::{
    api::{GraphRequest, GraphResponse, execute, execute_json},
    error::{GraphError, Result},
    graph::{Confidence, Edge, Graph, Node, NodeKind},
};
