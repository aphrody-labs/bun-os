// SPDX-License-Identifier: Apache-2.0
//! Typed, scope-qualified and size-bounded JSON worker API over the code graph: `build` from
//! in-memory sources, then `query`, `path`, `explain`, `analyze` and `export` over a
//! Graphify-compatible document. Migrated from the aphrody-labs/bun fork (`bun_graph::api`, behind
//! `bun:graph-native`); upstream Bun reaches it through `aphrody-graph exec` (one JSON request on
//! stdin, one JSON response on stdout) from `@aphrody/bun-os-plugins` (`bun:graph-native`).
//! Cancellation is checked between the owner passes; a caller cancels a running pass by
//! terminating the `exec` process.

use std::{
    collections::{HashMap, HashSet},
    io::{self, Write},
    sync::atomic::AtomicBool,
};

use serde::{Deserialize, Serialize};

use crate::{
    Confidence, Edge, Graph, GraphError, Node, NodeKind, Result,
    error::check_cancel,
    extract::{
        self, Language,
        resolve::{AssembleContext, AssembleStats},
    },
    query::{Explanation, PathOptions, QueryOptions},
};

pub const MAX_JSON_BYTES: usize = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphScope {
    pub source: String,
    pub profile: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct GraphLimits {
    pub max_files: usize,
    pub max_file_bytes: usize,
    pub max_source_bytes: usize,
    pub max_nodes: usize,
    pub max_edges: usize,
    pub max_ast_depth: usize,
    pub max_output_bytes: usize,
}

impl Default for GraphLimits {
    fn default() -> Self {
        Self {
            max_files: 4096,
            max_file_bytes: 1024 * 1024,
            max_source_bytes: 32 * 1024 * 1024,
            max_nodes: 250_000,
            max_edges: 1_000_000,
            max_ast_depth: 128,
            max_output_bytes: 64 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PackageContext {
    pub package_of: HashMap<String, String>,
    pub package_dir: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    #[serde(default = "code_kind")]
    pub file_type: NodeKind,
    #[serde(default)]
    pub source_file: Option<String>,
    #[serde(default)]
    pub source_location: Option<String>,
    #[serde(default)]
    pub lang: Option<String>,
    #[serde(default)]
    pub community: Option<i64>,
    #[serde(default)]
    pub community_name: Option<String>,
    #[serde(default)]
    pub package: Option<String>,
}

fn code_kind() -> NodeKind {
    NodeKind::Code
}
fn unit() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphLink {
    pub source: String,
    pub target: String,
    pub relation: String,
    pub confidence: Confidence,
    #[serde(default = "unit")]
    pub confidence_score: f64,
    #[serde(default = "unit")]
    pub weight: f64,
    #[serde(default)]
    pub source_file: Option<String>,
    #[serde(default)]
    pub source_location: Option<String>,
    #[serde(default)]
    pub context: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphDocument {
    pub nodes: Vec<GraphNode>,
    #[serde(alias = "edges")]
    pub links: Vec<GraphLink>,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub built_at_commit: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GraphRequest {
    pub scope: GraphScope,
    #[serde(default)]
    pub limits: GraphLimits,
    #[serde(flatten)]
    pub operation: GraphOperation,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphOperation {
    Build {
        files: Vec<SourceFile>,
        #[serde(default)]
        packages: PackageContext,
        #[serde(default)]
        root: Option<String>,
        #[serde(default)]
        built_at_commit: Option<String>,
    },
    Query {
        graph: GraphDocument,
        question: String,
        #[serde(default = "query_depth")]
        depth: usize,
        #[serde(default = "query_budget")]
        budget_tokens: usize,
        #[serde(default = "query_starts")]
        starts: usize,
        #[serde(default)]
        relations: Vec<String>,
    },
    Path {
        graph: GraphDocument,
        from: String,
        to: String,
        #[serde(default)]
        directed: bool,
        #[serde(default)]
        relations: Vec<String>,
    },
    Explain {
        graph: GraphDocument,
        node: String,
    },
    Analyze {
        graph: GraphDocument,
        #[serde(default = "analysis_top")]
        top: usize,
    },
    Export {
        graph: GraphDocument,
    },
}

fn query_depth() -> usize {
    2
}
fn query_budget() -> usize {
    2000
}
fn query_starts() -> usize {
    4
}
fn analysis_top() -> usize {
    20
}

#[derive(Debug, Serialize)]
pub struct GraphResponse {
    pub scope: GraphScope,
    pub result: GraphResult,
}

#[derive(Debug, Serialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum GraphResult {
    Build {
        graph: GraphDocument,
        stats: AssembleStats,
        parse_errors: Vec<ParseError>,
    },
    Query {
        graph: GraphDocument,
        starts: Vec<String>,
        truncated: usize,
        text: String,
    },
    Path {
        hops: Option<Vec<PathHop>>,
    },
    Explain {
        explanation: Explanation,
    },
    Analyze {
        graph: GraphDocument,
        modularity: f64,
        god_nodes: Vec<RankedNode>,
    },
    Export {
        graph: GraphDocument,
    },
}

#[derive(Debug, Serialize)]
pub struct ParseError {
    pub path: String,
    pub error: String,
}
#[derive(Debug, Serialize)]
pub struct PathHop {
    pub node: String,
    pub edge: Option<GraphLink>,
    pub forward: Option<bool>,
}
#[derive(Debug, Serialize)]
pub struct RankedNode {
    pub id: String,
    pub degree: usize,
}

fn bounded(value: usize, maximum: usize, label: &'static str) -> Result<()> {
    if value == 0 || value > maximum {
        Err(GraphError::Limit(label))
    } else {
        Ok(())
    }
}

fn validate(scope: &GraphScope, limits: &GraphLimits) -> Result<()> {
    if !scope.source.starts_with("graph:")
        || scope.source.len() <= 6
        || scope.source.len() > 256
        || scope.source.chars().any(|c| c.is_control())
    {
        return Err(GraphError::Invalid("explicit graph source required".into()));
    }
    if scope.profile.is_empty()
        || scope.profile.len() > 64
        || !scope
            .profile
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err(GraphError::Invalid(
            "explicit domain profile required".into(),
        ));
    }
    bounded(limits.max_files, 65_536, "file count")?;
    bounded(limits.max_file_bytes, 16 * 1024 * 1024, "file bytes")?;
    bounded(limits.max_source_bytes, 256 * 1024 * 1024, "source bytes")?;
    bounded(limits.max_nodes, 2_000_000, "node count")?;
    bounded(limits.max_edges, 4_000_000, "edge count")?;
    bounded(limits.max_ast_depth, 256, "AST depth")?;
    bounded(limits.max_output_bytes, MAX_JSON_BYTES, "output bytes")
}

fn relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.contains(['\\', ':', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn count(graph: &Graph, limits: &GraphLimits) -> Result<()> {
    if graph.nodes.len() > limits.max_nodes {
        return Err(GraphError::Limit("node count"));
    }
    if graph.edges.len() > limits.max_edges {
        return Err(GraphError::Limit("edge count"));
    }
    Ok(())
}

impl GraphDocument {
    fn into_graph(self, limits: &GraphLimits, cancelled: &AtomicBool) -> Result<Graph> {
        if self.nodes.len() > limits.max_nodes {
            return Err(GraphError::Limit("node count"));
        }
        if self.links.len() > limits.max_edges {
            return Err(GraphError::Limit("edge count"));
        }
        let mut index = HashMap::with_capacity(self.nodes.len());
        let mut nodes = Vec::with_capacity(self.nodes.len());
        for n in self.nodes {
            check_cancel(cancelled)?;
            if n.id.is_empty() || index.insert(n.id.clone(), nodes.len()).is_some() {
                return Err(GraphError::Invalid("empty or duplicate node id".into()));
            }
            nodes.push(Node {
                id: n.id,
                norm_label: n.label.to_lowercase(),
                label: n.label,
                kind: n.file_type,
                file: n.source_file,
                loc: n.source_location,
                lang: n.lang,
                community: n.community,
                community_name: n.community_name,
                package: n.package,
            });
        }
        let mut edges = Vec::with_capacity(self.links.len());
        for e in self.links {
            check_cancel(cancelled)?;
            let src = index
                .get(&e.source)
                .copied()
                .ok_or_else(|| GraphError::Invalid("missing edge source".into()))?;
            let dst = index
                .get(&e.target)
                .copied()
                .ok_or_else(|| GraphError::Invalid("missing edge target".into()))?;
            if !e.confidence_score.is_finite()
                || !(0.0..=1.0).contains(&e.confidence_score)
                || !e.weight.is_finite()
                || e.weight <= 0.0
                || e.relation.is_empty()
            {
                return Err(GraphError::Invalid(
                    "invalid edge score, weight or relation".into(),
                ));
            }
            edges.push(Edge {
                src,
                dst,
                relation: e.relation,
                confidence: e.confidence,
                score: e.confidence_score,
                weight: e.weight,
                file: e.source_file,
                loc: e.source_location,
                context: e.context,
            });
        }
        let mut graph = Graph::from_parts(nodes, edges);
        graph.meta.root = self.root;
        graph.meta.built_at_commit = self.built_at_commit;
        Ok(graph)
    }
}

impl GraphNode {
    fn from_node(n: &Node) -> Self {
        Self {
            id: n.id.clone(),
            label: n.label.clone(),
            file_type: n.kind,
            source_file: n.file.clone(),
            source_location: n.loc.clone(),
            lang: n.lang.clone(),
            community: n.community,
            community_name: n.community_name.clone(),
            package: n.package.clone(),
        }
    }
}

impl GraphLink {
    fn from_edge(graph: &Graph, e: &Edge) -> Self {
        Self {
            source: graph.nodes[e.src].id.clone(),
            target: graph.nodes[e.dst].id.clone(),
            relation: e.relation.clone(),
            confidence: e.confidence,
            confidence_score: e.score,
            weight: e.weight,
            source_file: e.file.clone(),
            source_location: e.loc.clone(),
            context: e.context.clone(),
        }
    }
}

fn document(
    graph: &Graph,
    nodes: &[usize],
    edges: &[usize],
    cancelled: &AtomicBool,
) -> Result<GraphDocument> {
    let mut out = GraphDocument {
        root: graph.meta.root.clone(),
        built_at_commit: graph.meta.built_at_commit.clone(),
        ..GraphDocument::default()
    };
    for &i in nodes {
        check_cancel(cancelled)?;
        out.nodes.push(GraphNode::from_node(&graph.nodes[i]));
    }
    for &i in edges {
        check_cancel(cancelled)?;
        out.links.push(GraphLink::from_edge(graph, &graph.edges[i]));
    }
    Ok(out)
}

fn whole(graph: &Graph, cancelled: &AtomicBool) -> Result<GraphDocument> {
    document(
        graph,
        &(0..graph.nodes.len()).collect::<Vec<_>>(),
        &(0..graph.edges.len()).collect::<Vec<_>>(),
        cancelled,
    )
}

pub fn execute(request: GraphRequest, cancelled: &AtomicBool) -> Result<GraphResponse> {
    check_cancel(cancelled)?;
    validate(&request.scope, &request.limits)?;
    let limits = &request.limits;
    let result = match request.operation {
        GraphOperation::Build {
            files,
            packages,
            root,
            built_at_commit,
        } => {
            if files.len() > limits.max_files {
                return Err(GraphError::Limit("file count"));
            }
            let mut bytes = 0usize;
            let mut paths = HashSet::new();
            let mut extracts = Vec::with_capacity(files.len());
            let mut parse_errors = Vec::new();
            let mut node_count = 0usize;
            let mut edge_count = 0usize;
            for file in files {
                check_cancel(cancelled)?;
                if !relative(&file.path) || !paths.insert(file.path.clone()) {
                    return Err(GraphError::Invalid(
                        "source paths must be distinct relative paths".into(),
                    ));
                }
                if Language::of_path(&file.path).is_none() {
                    return Err(GraphError::Invalid(format!(
                        "unsupported native extractor: {}",
                        file.path
                    )));
                }
                if file.content.len() > limits.max_file_bytes {
                    return Err(GraphError::Limit("file bytes"));
                }
                bytes = bytes
                    .checked_add(file.content.len())
                    .ok_or(GraphError::Limit("source bytes"))?;
                if bytes > limits.max_source_bytes {
                    return Err(GraphError::Limit("source bytes"));
                }
                // The owner extractors bound their own recursion; `max_ast_depth` is validated as
                // part of the request contract.
                let extracted = extract::extract_file(&file.path, file.content.as_bytes());
                node_count += extracted.nodes.len();
                edge_count +=
                    extracted.edges.len() + extracted.calls.len() + extracted.imports.len();
                if node_count > limits.max_nodes {
                    return Err(GraphError::Limit("node count"));
                }
                if edge_count > limits.max_edges {
                    return Err(GraphError::Limit("edge count"));
                }
                if let Some(error) = &extracted.error {
                    parse_errors.push(ParseError {
                        path: file.path,
                        error: error.clone(),
                    });
                }
                extracts.push(extracted);
            }
            for (file, package) in &packages.package_of {
                if !paths.contains(file) || package.is_empty() || package.len() > 256 {
                    return Err(GraphError::Invalid(
                        "package map must name input files and nonempty packages".into(),
                    ));
                }
            }
            for dir in packages.package_dir.values() {
                if !dir.is_empty() && !relative(dir) {
                    return Err(GraphError::Invalid(
                        "package directories must be relative".into(),
                    ));
                }
            }
            check_cancel(cancelled)?;
            let (mut graph, stats) = extract::resolve::assemble_with(
                extracts,
                &AssembleContext {
                    package_of: packages.package_of,
                    package_dir: packages.package_dir,
                },
            );
            check_cancel(cancelled)?;
            count(&graph, limits)?;
            graph.meta.root = root;
            graph.meta.built_at_commit = built_at_commit;
            GraphResult::Build {
                graph: whole(&graph, cancelled)?,
                stats,
                parse_errors,
            }
        }
        GraphOperation::Query {
            graph,
            question,
            depth,
            budget_tokens,
            starts,
            relations,
        } => {
            bounded(depth, 64, "query depth")?;
            bounded(budget_tokens, 1_000_000, "query budget")?;
            bounded(starts, 1024, "query starts")?;
            if question.len() > 4096 || relations.len() > 128 {
                return Err(GraphError::Limit("query input"));
            }
            let graph = graph.into_graph(limits, cancelled)?;
            let query = graph.query(
                &question,
                &QueryOptions {
                    depth,
                    budget_tokens,
                    starts,
                    relations,
                },
            );
            check_cancel(cancelled)?;
            GraphResult::Query {
                graph: document(&graph, &query.nodes, &query.edges, cancelled)?,
                starts: query
                    .starts
                    .iter()
                    .map(|&i| graph.nodes[i].id.clone())
                    .collect(),
                truncated: query.truncated,
                text: query.text,
            }
        }
        GraphOperation::Path {
            graph,
            from,
            to,
            directed,
            relations,
        } => {
            if from.len() > 4096 || to.len() > 4096 || relations.len() > 128 {
                return Err(GraphError::Limit("path input"));
            }
            let graph = graph.into_graph(limits, cancelled)?;
            let path = graph.shortest_path_with(
                &from,
                &to,
                &PathOptions {
                    directed,
                    relations,
                },
            )?;
            check_cancel(cancelled)?;
            let hops = path.map(|path| {
                path.into_iter()
                    .map(|hop| PathHop {
                        node: graph.nodes[hop.node].id.clone(),
                        edge: hop
                            .via
                            .map(|(e, _)| GraphLink::from_edge(&graph, &graph.edges[e])),
                        forward: hop.via.map(|(_, forward)| forward),
                    })
                    .collect()
            });
            GraphResult::Path { hops }
        }
        GraphOperation::Explain { graph, node } => {
            if node.len() > 4096 {
                return Err(GraphError::Limit("node reference"));
            }
            GraphResult::Explain {
                explanation: graph.into_graph(limits, cancelled)?.explain(&node)?,
            }
        }
        GraphOperation::Analyze { graph, top } => {
            bounded(top, 10_000, "analysis top")?;
            let mut graph = graph.into_graph(limits, cancelled)?;
            let modularity = graph.detect_communities();
            check_cancel(cancelled)?;
            let god_nodes = graph
                .god_nodes(top)
                .into_iter()
                .map(|(i, degree)| RankedNode {
                    id: graph.nodes[i].id.clone(),
                    degree,
                })
                .collect();
            GraphResult::Analyze {
                graph: whole(&graph, cancelled)?,
                modularity,
                god_nodes,
            }
        }
        GraphOperation::Export { graph } => GraphResult::Export {
            graph: whole(&graph.into_graph(limits, cancelled)?, cancelled)?,
        },
    };
    check_cancel(cancelled)?;
    Ok(GraphResponse {
        scope: request.scope,
        result,
    })
}

struct Output<'a> {
    bytes: Vec<u8>,
    limit: usize,
    cancelled: &'a AtomicBool,
}
impl Write for Output<'_> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if self.cancelled.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "graph operation cancelled",
            ));
        }
        if buffer.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("graph output bytes exceeded"));
        }
        self.bytes.extend_from_slice(buffer);
        Ok(buffer.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub fn execute_json(input: &[u8], cancelled: &AtomicBool) -> Result<Vec<u8>> {
    check_cancel(cancelled)?;
    if input.len() > MAX_JSON_BYTES {
        return Err(GraphError::Limit("request bytes"));
    }
    let request: GraphRequest = serde_json::from_slice(input)?;
    let output_limit = request.limits.max_output_bytes;
    let response = execute(request, cancelled)?;
    let mut output = Output {
        bytes: Vec::new(),
        limit: output_limit,
        cancelled,
    };
    serde_json::to_writer(&mut output, &response)?;
    Ok(output.bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn scope() -> Value {
        json!({"source": "graph:bun", "profile": "aphrody"})
    }

    fn invoke(value: &Value) -> Result<Value> {
        let bytes = execute_json(&serde_json::to_vec(value).unwrap(), &AtomicBool::new(false))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    fn rust_build() -> Value {
        json!({"scope": scope(), "op": "build", "files": [{"path": "src/lib.rs", "content":
            "pub fn café() -> i32 { 42 }\npub fn run() -> i32 { café() }"}],
            "packages": {"package_of": {"src/lib.rs": "fixture"}, "package_dir": {"fixture": "src"}},
            "built_at_commit": "fixture-revision"})
    }

    #[test]
    fn native_unicode_extraction_path_query_and_explanation_share_one_graph() {
        let built = invoke(&rust_build()).unwrap();
        assert_eq!(built["scope"], scope());
        assert_eq!(built["result"]["parse_errors"], json!([]));
        let graph = built["result"]["graph"].clone();
        let nodes = graph["nodes"].as_array().unwrap();
        let from = &nodes.iter().find(|n| n["label"] == "run()").unwrap()["id"];
        let to = &nodes.iter().find(|n| n["label"] == "café()").unwrap()["id"];
        let call = graph["links"]
            .as_array()
            .unwrap()
            .iter()
            .find(|edge| {
                edge["source"] == *from && edge["target"] == *to && edge["relation"] == "calls"
            })
            .unwrap();
        assert_eq!(call["confidence"], "EXTRACTED");
        assert_eq!(call["source_file"], "src/lib.rs");
        assert_eq!(call["source_location"], "L2");
        assert_eq!(call["context"], "call");
        let path = invoke(&json!({"scope":scope(), "op":"path", "graph":graph, "from":from,"to":to,"directed":true,"relations":["calls"]})).unwrap();
        assert_eq!(path["result"]["hops"].as_array().unwrap().len(), 2);
        assert_eq!(path["result"]["hops"][1]["edge"]["confidence"], "EXTRACTED");
        assert_eq!(path["result"]["hops"][1]["forward"], true);
        let explained =
            invoke(&json!({"scope":scope(),"op":"explain","graph":graph,"node":to})).unwrap();
        assert_eq!(explained["result"]["explanation"]["label"], "café()");
        assert_eq!(explained["result"]["explanation"]["package"], "fixture");
        let queried = invoke(&json!({"scope":scope(),"op":"query","graph":graph,"question":"café","depth":2,"budget_tokens":1000})).unwrap();
        assert!(
            queried["result"]["text"]
                .as_str()
                .unwrap()
                .contains("café()")
        );
        let analyzed = invoke(&json!({"scope":scope(),"op":"analyze","graph":graph})).unwrap();
        assert!(analyzed["result"]["modularity"].is_number());
        assert!(
            !analyzed["result"]["god_nodes"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn sources_and_profiles_are_explicit_and_domain_scoped() {
        let mut request = rust_build();
        request.as_object_mut().unwrap().remove("scope");
        assert!(invoke(&request).is_err());
        for invalid in ["", "../aphrody", "dbfr/aphrody", "aphrody\0"] {
            let mut request = rust_build();
            request["scope"]["profile"] = json!(invalid);
            assert!(invoke(&request).is_err());
        }
        let mut request = rust_build();
        request["scope"]["profile"] = json!("dbfr");
        assert_eq!(invoke(&request).unwrap()["scope"]["profile"], "dbfr");
        let mut request = rust_build();
        request["scope"]["source"] = json!("");
        assert!(invoke(&request).is_err());
    }

    #[test]
    fn malformed_snapshot_never_drops_endpoints_or_rewires_duplicate_ids() {
        let graph = json!({"nodes":[{"id":"a","label":"A"}],"links":[{"source":"a","target":"missing","relation":"calls","confidence":"EXTRACTED"}]});
        assert!(matches!(
            invoke(&json!({"scope":scope(),"op":"export","graph":graph})),
            Err(GraphError::Invalid(_))
        ));
        let graph = json!({"nodes":[{"id":"a","label":"A"},{"id":"a","label":"B"}],"links":[]});
        assert!(invoke(&json!({"scope":scope(),"op":"export","graph":graph})).is_err());
        for score in [-1.0, 1.5] {
            let graph = json!({"nodes":[{"id":"a","label":"A"}],"links":[{"source":"a","target":"a","relation":"calls","confidence":"EXTRACTED","confidence_score":score}]});
            assert!(invoke(&json!({"scope":scope(),"op":"export","graph":graph})).is_err());
        }
    }

    #[test]
    fn file_paths_byte_counts_depth_and_output_are_bounded() {
        for path in [
            "../secret.rs",
            "C:/secret.rs",
            "/root.rs",
            "src\\file.rs",
            "src/../file.rs",
        ] {
            let mut request = rust_build();
            request["files"][0]["path"] = json!(path);
            assert!(invoke(&request).is_err());
        }
        let mut request = rust_build();
        request["limits"] = json!({"max_file_bytes": 2});
        assert!(matches!(
            invoke(&request),
            Err(GraphError::Limit("file bytes"))
        ));
        let mut request = rust_build();
        request["limits"] = json!({"max_output_bytes": 2});
        assert!(invoke(&request).is_err());
        for depth in [0, 257] {
            let mut request = rust_build();
            request["limits"] = json!({ "max_ast_depth": depth });
            assert!(matches!(
                invoke(&request),
                Err(GraphError::Limit("AST depth"))
            ));
        }
        let mut request = rust_build();
        request["files"][0]["path"] = json!("fixture.py");
        assert!(invoke(&request).is_err());
    }

    #[test]
    fn cancellation_is_checked_before_parsing_and_between_passes() {
        let cancelled = AtomicBool::new(true);
        assert!(matches!(
            execute_json(b"invalid json", &cancelled),
            Err(GraphError::Cancelled)
        ));
        let request = serde_json::to_vec(&rust_build()).unwrap();
        assert!(matches!(
            execute_json(&request, &cancelled),
            Err(GraphError::Cancelled)
        ));
    }

    #[test]
    fn native_typescript_import_resolution_preserves_confidence_and_external_calls() {
        let result = invoke(&json!({"scope":scope(),"op":"build","files":[
            {"path":"math.ts","content":"export function café() { return 42; }"},
            {"path":"main.ts","content":"import { café } from './math'; import { join } from 'node:path'; export function run() { café(); join('a','b'); }"}
        ]})).unwrap();
        assert_eq!(result["result"]["parse_errors"], json!([]));
        assert_eq!(result["result"]["stats"]["external"], 1);
        assert_eq!(result["result"]["stats"]["cross_file"], 1);
        assert!(
            result["result"]["graph"]["links"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["relation"] == "calls" && e["confidence"] == "EXTRACTED")
        );
    }
}
