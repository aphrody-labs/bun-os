// SPDX-License-Identifier: Apache-2.0
//! `explain`, `path` and `query`: node lookup, neighborhood description, shortest path and
//! budgeted breadth-first retrieval.

use std::{
    collections::{HashSet, VecDeque},
    fmt::Write as _,
};

use crate::{
    error::{GraphError, Result},
    graph::{Confidence, Graph},
};

/// Direction of a connection relative to the explained node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    /// The other node points at this node (`<--`).
    Incoming,
    /// This node points at the other node (`-->`).
    Outgoing,
}

/// One neighbor of an explained node.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Connection {
    /// Direction.
    pub direction: Direction,
    /// Neighbor label.
    pub other: String,
    /// Relation.
    pub relation: String,
    /// Confidence class.
    pub confidence: Confidence,
    /// `file:loc` of the reference, when known.
    pub at: Option<String>,
}

/// Result of [`Graph::explain`].
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Explanation {
    /// Node label.
    pub label: String,
    /// Node id.
    pub id: String,
    /// `file Lnn`.
    pub source: Option<String>,
    /// Kind label.
    pub kind: String,
    /// Package (crate or npm package).
    pub package: Option<String>,
    /// Community name.
    pub community: Option<String>,
    /// Degree.
    pub degree: usize,
    /// Connections.
    pub connections: Vec<Connection>,
}

impl std::fmt::Display for Explanation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Node: {}", self.label)?;
        writeln!(f, "  ID:        {}", self.id)?;
        if let Some(source) = &self.source {
            writeln!(f, "  Source:    {source}")?;
        }
        writeln!(f, "  Type:      {}", self.kind)?;
        if let Some(package) = &self.package {
            writeln!(f, "  Package:   {package}")?;
        }
        if let Some(c) = &self.community {
            writeln!(f, "  Community: {c}")?;
        }
        writeln!(f, "  Degree:    {}", self.degree)?;
        writeln!(f, "\nConnections ({}):", self.connections.len())?;
        for c in &self.connections {
            let arrow = if c.direction == Direction::Incoming {
                "<--"
            } else {
                "-->"
            };
            write!(
                f,
                "  {arrow} {} [{}] [{}]",
                c.other,
                c.relation,
                c.confidence.as_str()
            )?;
            if let Some(at) = &c.at {
                write!(f, " {at}")?;
            }
            writeln!(f)?;
        }
        Ok(())
    }
}

/// One step of a shortest path.
#[derive(Debug, Clone, PartialEq)]
pub struct Hop {
    /// Node reached.
    pub node: usize,
    /// Edge used to reach it (`None` for the start) and whether it was followed forwards.
    pub via: Option<(usize, bool)>,
}

/// Options of [`Graph::shortest_path_with`].
#[derive(Debug, Clone, Default)]
pub struct PathOptions {
    /// Follow edges only from source to target.
    pub directed: bool,
    /// Keep only edges with one of these relations (empty keeps all).
    pub relations: Vec<String>,
}

impl PathOptions {
    /// Relations of a dependency path: calls and imports.
    pub const DEPENDENCY_RELATIONS: &[&str] = &["calls", "imports", "imports_from"];
}

/// Options of [`Graph::query`].
#[derive(Debug, Clone)]
pub struct QueryOptions {
    /// Traversal depth from the start nodes.
    pub depth: usize,
    /// Output budget in estimated tokens (4 characters per token).
    pub budget_tokens: usize,
    /// Number of start nodes.
    pub starts: usize,
    /// Keep only edges with one of these relations (empty keeps all).
    pub relations: Vec<String>,
}

impl Default for QueryOptions {
    fn default() -> Self {
        Self {
            depth: 2,
            budget_tokens: 2000,
            starts: 4,
            relations: Vec::new(),
        }
    }
}

/// Result of [`Graph::query`].
#[derive(Debug, Clone, Default, PartialEq)]
pub struct QueryResult {
    /// Start node indices.
    pub starts: Vec<usize>,
    /// Visited node indices in discovery order, within the budget.
    pub nodes: Vec<usize>,
    /// Edge indices between kept nodes.
    pub edges: Vec<usize>,
    /// Nodes found but cut by the budget.
    pub truncated: usize,
    /// Rendered text (nodes then edges).
    pub text: String,
}

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "with", "that", "this", "what", "which", "where", "who", "how", "does",
    "are", "from", "into", "use", "used", "uses", "all", "any", "has", "have", "its", "not",
];

fn tokens(question: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in question.split(|c: char| !(c.is_alphanumeric() || c == '_')) {
        let token = raw.to_lowercase();
        if token.chars().count() >= 3
            && !STOPWORDS.contains(&token.as_str())
            && !out.contains(&token)
        {
            out.push(token);
        }
    }
    out
}

fn bare_label(label: &str) -> &str {
    label.trim_end_matches("()").trim_start_matches('.')
}

impl Graph {
    /// Node indices matching `text`: exact id, then exact label (`join` also matches
    /// `join()` and `.join()`; sourced nodes before stubs), then label containing it
    /// (case-insensitive), each tier ranked by degree. `path/to/file.rs::symbol` keeps the
    /// matches of that file.
    #[must_use]
    pub fn find(&self, text: &str) -> Vec<usize> {
        if let Some(i) = self.index_of(text) {
            return vec![i];
        }
        self.find_by_label(text)
    }

    fn find_by_label(&self, text: &str) -> Vec<usize> {
        let (file, symbol) = match text.rsplit_once("::") {
            Some((file, symbol)) if file.contains('.') || file.contains('/') => {
                (Some(file.replace('\\', "/")), symbol)
            }
            _ => (None, text),
        };
        let in_file = |i: usize| {
            file.as_deref().is_none_or(|wanted| {
                self.nodes[i]
                    .file
                    .as_deref()
                    .is_some_and(|f| f == wanted || f.ends_with(&format!("/{wanted}")))
            })
        };
        let needle = symbol.to_lowercase();
        let bare_needle = bare_label(&needle);
        let mut exact: Vec<usize> = (0..self.nodes.len())
            .filter(|&i| in_file(i))
            .filter(|&i| {
                let label = &self.nodes[i].norm_label;
                *label == needle || bare_label(label) == bare_needle
            })
            .collect();
        let mut partial: Vec<usize> = (0..self.nodes.len())
            .filter(|&i| {
                in_file(i) && !exact.contains(&i) && self.nodes[i].norm_label.contains(&needle)
            })
            .collect();
        exact.sort_by(|&a, &b| {
            self.nodes[b]
                .file
                .is_some()
                .cmp(&self.nodes[a].file.is_some())
                .then_with(|| self.degree(b).cmp(&self.degree(a)))
                .then_with(|| self.nodes[a].id.cmp(&self.nodes[b].id))
        });
        partial.sort_by(|&a, &b| {
            self.degree(b)
                .cmp(&self.degree(a))
                .then_with(|| self.nodes[a].id.cmp(&self.nodes[b].id))
        });
        exact.extend(partial);
        exact
    }

    /// The single node `text` names: an id, a unique exact label (sourced nodes win over
    /// stubs), a `file::symbol` reference or a unique partial match.
    ///
    /// # Errors
    ///
    /// [`GraphError::NoMatch`], or [`GraphError::Ambiguous`] listing the candidates with their
    /// file, location and id.
    pub fn resolve(&self, text: &str) -> Result<usize> {
        // An id names one node, unless it is a stub whose name sourced nodes also carry.
        let by_id = self.index_of(text);
        if let Some(i) = by_id
            && self.nodes[i].file.is_some()
        {
            return Ok(i);
        }
        let found = self.find_by_label(text);
        if found.is_empty() {
            return by_id.ok_or_else(|| GraphError::NoMatch(text.to_owned()));
        }
        let symbol = text
            .rsplit_once("::")
            .map_or(text, |(_, s)| s)
            .to_lowercase();
        let exact: Vec<usize> = found
            .iter()
            .copied()
            .filter(|&i| bare_label(&self.nodes[i].norm_label) == bare_label(&symbol))
            .collect();
        let tier = if exact.is_empty() { found } else { exact };
        let sourced: Vec<usize> = tier
            .iter()
            .copied()
            .filter(|&i| self.nodes[i].file.is_some())
            .collect();
        let tier = if sourced.is_empty() { tier } else { sourced };
        let literal: Vec<usize> = tier
            .iter()
            .copied()
            .filter(|&i| self.nodes[i].norm_label == symbol)
            .collect();
        let tier = if literal.is_empty() { tier } else { literal };
        if let [only] = tier.as_slice() {
            return Ok(*only);
        }
        let candidates = tier
            .iter()
            .take(15)
            .map(|&i| {
                let n = &self.nodes[i];
                let at = match (&n.file, &n.loc) {
                    (Some(f), Some(l)) => format!("{f}:{l}"),
                    (Some(f), None) => f.clone(),
                    _ => "(no source)".to_owned(),
                };
                format!(
                    "{} - {at} [id {}] ({} edges)",
                    n.label,
                    n.id,
                    self.degree(i)
                )
            })
            .collect();
        Err(GraphError::Ambiguous {
            text: text.to_owned(),
            total: tier.len(),
            candidates,
        })
    }

    /// Describe the best node matching `text` and its connections.
    ///
    /// # Errors
    ///
    /// [`GraphError::NoMatch`] when nothing matches.
    pub fn explain(&self, text: &str) -> Result<Explanation> {
        let node = self.resolve(text)?;
        let n = &self.nodes[node];
        let at = |e: &crate::graph::Edge| match (&e.file, &e.loc) {
            (Some(f), Some(l)) => Some(format!("{f}:{l}")),
            (Some(f), None) => Some(f.clone()),
            _ => None,
        };
        let mut connections = Vec::new();
        for &e in self.in_edges(node) {
            let edge = &self.edges[e];
            connections.push(Connection {
                direction: Direction::Incoming,
                other: self.nodes[edge.src].label.clone(),
                relation: edge.relation.clone(),
                confidence: edge.confidence,
                at: at(edge),
            });
        }
        for &e in self.out_edges(node) {
            let edge = &self.edges[e];
            connections.push(Connection {
                direction: Direction::Outgoing,
                other: self.nodes[edge.dst].label.clone(),
                relation: edge.relation.clone(),
                confidence: edge.confidence,
                at: at(edge),
            });
        }
        Ok(Explanation {
            label: n.label.clone(),
            id: n.id.clone(),
            source: n.file.as_ref().map(|f| match &n.loc {
                Some(l) => format!("{f} {l}"),
                None => f.clone(),
            }),
            kind: n.kind.as_str().to_owned(),
            package: n.package.clone(),
            community: n.community_name.clone(),
            degree: self.degree(node),
            connections,
        })
    }

    /// Shortest path between two nodes, edges followed in either direction.
    ///
    /// # Errors
    ///
    /// See [`Graph::resolve`].
    pub fn shortest_path(&self, from: &str, to: &str) -> Result<Option<Vec<Hop>>> {
        self.shortest_path_with(from, to, &PathOptions::default())
    }

    /// Shortest path between two nodes, restricted to some relations and optionally directed.
    ///
    /// # Errors
    ///
    /// See [`Graph::resolve`].
    pub fn shortest_path_with(
        &self,
        from: &str,
        to: &str,
        options: &PathOptions,
    ) -> Result<Option<Vec<Hop>>> {
        let a = self.resolve(from)?;
        let b = self.resolve(to)?;
        let keep = |e: usize| {
            options.relations.is_empty()
                || options
                    .relations
                    .iter()
                    .any(|r| *r == self.edges[e].relation)
        };
        let mut prev: Vec<Option<(usize, usize, bool)>> = vec![None; self.nodes.len()];
        let mut seen = vec![false; self.nodes.len()];
        let mut queue = VecDeque::from([a]);
        seen[a] = true;
        while let Some(u) = queue.pop_front() {
            if u == b {
                break;
            }
            let backwards: &[usize] = if options.directed {
                &[]
            } else {
                self.in_edges(u)
            };
            for (&e, forward) in self
                .out_edges(u)
                .iter()
                .map(|e| (e, true))
                .chain(backwards.iter().map(|e| (e, false)))
            {
                if !keep(e) {
                    continue;
                }
                let edge = &self.edges[e];
                let v = if forward { edge.dst } else { edge.src };
                if !seen[v] {
                    seen[v] = true;
                    prev[v] = Some((u, e, forward));
                    queue.push_back(v);
                }
            }
        }
        if !seen[b] {
            return Ok(None);
        }
        let mut path = vec![Hop { node: b, via: None }];
        let mut cursor = b;
        while let Some((u, e, forward)) = prev[cursor] {
            path.last_mut().expect("non-empty").via = Some((e, forward));
            path.push(Hop { node: u, via: None });
            cursor = u;
        }
        // Built from the target back to the start: after the reversal each hop's `via` is the
        // edge that was followed to reach it.
        path.reverse();
        Ok(Some(path))
    }

    /// Budgeted breadth-first retrieval around the nodes that best match the question.
    #[must_use]
    pub fn query(&self, question: &str, options: &QueryOptions) -> QueryResult {
        let words = tokens(question);
        if words.is_empty() {
            return QueryResult::default();
        }
        let mut scored: Vec<(usize, usize)> = (0..self.nodes.len())
            .filter_map(|i| {
                let n = &self.nodes[i];
                let file = n.file.as_deref().unwrap_or("").to_lowercase();
                let score = words
                    .iter()
                    .filter(|w| n.norm_label.contains(w.as_str()) || file.contains(w.as_str()))
                    .count();
                (score > 0).then_some((i, score))
            })
            .collect();
        scored.sort_by(|a, b| {
            b.1.cmp(&a.1)
                .then_with(|| self.degree(b.0).cmp(&self.degree(a.0)))
                .then_with(|| self.nodes[a.0].id.cmp(&self.nodes[b.0].id))
        });
        let starts: Vec<usize> = scored
            .iter()
            .take(options.starts)
            .map(|(i, _)| *i)
            .collect();
        let allowed = |relation: &str| {
            options.relations.is_empty() || options.relations.iter().any(|r| r == relation)
        };

        let mut order: Vec<usize> = Vec::new();
        let mut seen: HashSet<usize> = HashSet::new();
        let mut queue: VecDeque<(usize, usize)> = VecDeque::new();
        for &s in &starts {
            if seen.insert(s) {
                order.push(s);
                queue.push_back((s, 0));
            }
        }
        while let Some((u, depth)) = queue.pop_front() {
            if depth >= options.depth {
                continue;
            }
            for &e in self.out_edges(u).iter().chain(self.in_edges(u)) {
                let edge = &self.edges[e];
                if !allowed(&edge.relation) {
                    continue;
                }
                let v = if edge.src == u { edge.dst } else { edge.src };
                if seen.insert(v) {
                    order.push(v);
                    queue.push_back((v, depth + 1));
                }
            }
        }

        let mut text = String::new();
        let mut kept: Vec<usize> = Vec::new();
        let mut used = 0_usize;
        for &i in &order {
            let n = &self.nodes[i];
            let mut line = format!("NODE {}", n.label);
            let mut meta = Vec::new();
            if let Some(f) = &n.file {
                meta.push(format!("src={f}"));
            }
            if let Some(l) = &n.loc {
                meta.push(format!("loc={l}"));
            }
            if let Some(c) = &n.community_name {
                meta.push(format!("community={c}"));
            }
            if !meta.is_empty() {
                let _ = write!(line, " [{}]", meta.join(" "));
            }
            line.push('\n');
            let cost = line.len().div_ceil(4);
            if used + cost > options.budget_tokens && !kept.is_empty() {
                break;
            }
            used += cost;
            text.push_str(&line);
            kept.push(i);
        }
        let keep: HashSet<usize> = kept.iter().copied().collect();
        let mut edges: Vec<usize> = Vec::new();
        for &i in &kept {
            for &e in self.out_edges(i) {
                let edge = &self.edges[e];
                if keep.contains(&edge.dst) && allowed(&edge.relation) {
                    let line = format!(
                        "EDGE {} --{} [{}]--> {}\n",
                        self.nodes[edge.src].label,
                        edge.relation,
                        edge.confidence.as_str(),
                        self.nodes[edge.dst].label
                    );
                    let cost = line.len().div_ceil(4);
                    if used + cost > options.budget_tokens {
                        continue;
                    }
                    used += cost;
                    text.push_str(&line);
                    edges.push(e);
                }
            }
        }
        QueryResult {
            starts,
            truncated: order.len() - kept.len(),
            nodes: kept,
            edges,
            text,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::sample;

    #[test]
    fn find_prefers_id_then_exact_then_partial_by_degree() {
        let g = sample();
        assert_eq!(g.find("a"), vec![0]);
        assert_eq!(g.find("ragstore"), vec![0]);
        assert_eq!(g.find("o"), vec![2, 0, 1, 3, 4]);
        assert!(g.find("zzz").is_empty());
    }

    #[test]
    fn explain_lists_both_directions_with_confidence() {
        let g = sample();
        let e = g.explain(".upsert_doc()").unwrap();
        assert_eq!(e.degree, 3);
        assert_eq!(e.connections.len(), 3);
        let text = e.to_string();
        assert!(text.contains("<-- RagStore [contains] [EXTRACTED]"));
        assert!(text.contains("<-- .open() [calls] [INFERRED]"));
        assert!(text.contains("--> Connection [calls] [EXTRACTED]"));
        assert!(matches!(g.explain("nothing"), Err(GraphError::NoMatch(_))));
    }

    #[test]
    fn shortest_path_follows_edges_in_both_directions() {
        let g = sample();
        let path = g.shortest_path("Connection", "RagStore").unwrap().unwrap();
        let ids: Vec<&str> = path.iter().map(|h| g.nodes[h.node].id.as_str()).collect();
        assert_eq!(ids, ["d", "c", "a"]);
        assert!(path[0].via.is_none());
        assert_eq!(path[1].via.map(|v| v.1), Some(false)); // d <- c is traversed against the edge
        assert!(g.shortest_path("Lonely", "RagStore").unwrap().is_none());
        assert_eq!(
            g.shortest_path("RagStore", "RagStore")
                .unwrap()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn a_directed_path_follows_edges_forwards_only_and_filters_relations() {
        let g = sample();
        let directed = PathOptions {
            directed: true,
            relations: Vec::new(),
        };
        assert!(
            g.shortest_path_with("Connection", "RagStore", &directed)
                .unwrap()
                .is_none()
        );
        let path = g
            .shortest_path_with("RagStore", "Connection", &directed)
            .unwrap()
            .unwrap();
        assert!(path.iter().skip(1).all(|h| h.via.is_some_and(|v| v.1)));
        let calls_only = PathOptions {
            directed: true,
            relations: vec!["calls".into()],
        };
        assert!(
            g.shortest_path_with("RagStore", "Connection", &calls_only)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            g.shortest_path_with(".open()", "Connection", &calls_only)
                .unwrap()
                .unwrap()
                .len(),
            3
        );
    }

    #[test]
    fn ambiguous_names_list_candidates_and_file_qualified_names_pick_one() {
        let nodes = vec![
            crate::graph::Node::code("a_join", "join()", Some("src/a.ts")),
            crate::graph::Node::code("b_join", "join()", Some("src/b.ts")),
            crate::graph::Node::code("join", "join", None),
        ];
        let g = Graph::from_parts(nodes, Vec::new());
        match g.explain("join") {
            Err(GraphError::Ambiguous {
                candidates, total, ..
            }) => {
                assert_eq!(
                    total, 2,
                    "the stub is not a candidate when sourced nodes exist"
                );
                assert!(
                    candidates[0].contains("src/a.ts") && candidates[0].contains("[id a_join]"),
                    "{candidates:?}"
                );
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(g.explain("src/b.ts::join").unwrap().id, "b_join");
        assert_eq!(g.explain("b.ts::join()").unwrap().id, "b_join");
        let methods = Graph::from_parts(
            vec![
                crate::graph::Node::code("f", "open()", Some("lib.rs")),
                crate::graph::Node::code("m", ".open()", Some("lib.rs")),
            ],
            Vec::new(),
        );
        assert!(methods.explain("lib.rs::open").is_err());
        assert_eq!(methods.explain("lib.rs::open()").unwrap().id, "f");
        assert_eq!(methods.explain(".open()").unwrap().id, "m");
        assert_eq!(g.explain("a_join").unwrap().id, "a_join");
        assert!(g.explain("ambiguous").is_err());
    }

    #[test]
    fn query_expands_from_the_best_matches_within_the_budget() {
        let g = sample();
        let r = g.query("where is upsert_doc called?", &QueryOptions::default());
        assert_eq!(r.starts, vec![2]);
        assert!(r.nodes.len() >= 3);
        assert!(r.text.contains("NODE .upsert_doc()"));
        assert!(
            r.text
                .contains("EDGE .open() --calls [INFERRED]--> .upsert_doc()")
        );
        let tight = g.query(
            "upsert_doc",
            &QueryOptions {
                budget_tokens: 5,
                ..QueryOptions::default()
            },
        );
        assert_eq!(tight.nodes.len(), 1);
        assert!(tight.truncated > 0);
        let only_contains = g.query(
            "upsert_doc",
            &QueryOptions {
                relations: vec!["contains".into()],
                ..QueryOptions::default()
            },
        );
        assert!(
            only_contains
                .edges
                .iter()
                .all(|&e| g.edges[e].relation == "contains")
        );
        assert_eq!(
            g.query("the and", &QueryOptions::default()),
            QueryResult::default()
        );
    }
}
