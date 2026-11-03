// SPDX-License-Identifier: Apache-2.0
//! Command line of the code graph: build, query, explain, path, report, export, delete, exec. JSON on
//! stdout for `build`, plain text for the readers. Offline, no model, no network.

use std::{ffi::OsString, fmt::Write as _, path::PathBuf};

use aphrody_store::{HomeDb, cli::StoreArgs, scan::ScanOptions};
use clap::{Parser, Subcommand};

use crate::{
    error::{GraphError, Result},
    graph::Graph,
    pipeline::build_graph,
    query::{PathOptions, QueryOptions},
};

/// Code graph tooling.
#[derive(Debug, Parser)]
#[command(name = "aphrody graph", version, about)]
pub struct Cli {
    #[command(flatten)]
    store: StoreArgs,
    /// Graph source label (default: the only graph of the database).
    #[arg(long, global = true)]
    source: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Scan a tree and (re)build its graph incrementally.
    Build {
        /// Tree root.
        root: PathBuf,
        /// Also write a Graphify-compatible `graph.json` here.
        #[arg(long)]
        json: Option<PathBuf>,
        /// Also write `GRAPH_REPORT.md` here.
        #[arg(long)]
        report: Option<PathBuf>,
    },
    /// Budgeted breadth-first retrieval for a question.
    Query {
        /// The question.
        question: String,
        /// Traversal depth.
        #[arg(long, default_value_t = 2)]
        depth: usize,
        /// Output budget in estimated tokens.
        #[arg(long, default_value_t = 2000)]
        budget: usize,
    },
    /// Describe a node and its connections.
    Explain {
        /// Node id or label.
        node: String,
    },
    /// Shortest path between two nodes (id, label or `file::symbol`).
    Path {
        /// Start node.
        from: String,
        /// End node.
        to: String,
        /// Follow edges from caller to callee / importer to imported only; without `--relation`,
        /// only `calls`, `imports` and `imports_from` edges.
        #[arg(long)]
        directed: bool,
        /// Keep only edges of this relation (repeatable).
        #[arg(long = "relation", value_name = "RELATION")]
        relations: Vec<String>,
    },
    /// Print the markdown report.
    Report,
    /// Write `graph.json`.
    Export {
        /// Output file.
        out: PathBuf,
    },
    /// Delete the graph named by `--source` (nodes, edges, communities, cache, scan rows).
    #[command(visible_alias = "drop")]
    Delete,
    /// Run one JSON worker request (`crate::api`) read from stdin; the JSON response goes to
    /// stdout. No home database is opened: this is the `bun:graph-native` route on upstream Bun.
    Exec,
}

fn exec() -> Result<String> {
    use std::io::Read as _;
    let mut input = Vec::new();
    std::io::stdin()
        .take(crate::api::MAX_JSON_BYTES as u64 + 1)
        .read_to_end(&mut input)
        .map_err(|e| GraphError::Json(serde_json::Error::io(e)))?;
    let output = crate::api::execute_json(&input, &std::sync::atomic::AtomicBool::new(false))?;
    String::from_utf8(output).map_err(|e| GraphError::Invalid(e.to_string()))
}

fn delete_source(db: &HomeDb, label: &str) -> Result<String> {
    let found: Option<(i64, String)> = db
        .conn()
        .query_row(
            "SELECT id, kind FROM sources WHERE label = ?1",
            [label],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((id, kind)) = found else {
        return Err(GraphError::UnknownSource(label.to_owned()));
    };
    let count = |table: &str| -> i64 {
        db.conn()
            .query_row(
                &format!("SELECT count(*) FROM {table} WHERE source_id = ?1"),
                [id],
                |r| r.get(0),
            )
            .unwrap_or(0)
    };
    let (nodes, edges) = (count("graph_nodes"), count("graph_edges"));
    db.conn()
        .execute("DELETE FROM sources WHERE id = ?1", [id])?;
    Ok(format!(
        "deleted {kind} source {label}: {nodes} nodes, {edges} edges"
    ))
}

fn pick_source(db: &HomeDb, wanted: Option<&str>) -> Result<String> {
    if let Some(label) = wanted {
        return Ok(label.to_owned());
    }
    let mut statement = db.conn().prepare(
        "SELECT label FROM sources WHERE kind IN ('code-graph', 'graphify') ORDER BY label",
    )?;
    let labels: Vec<String> = statement
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    match labels.as_slice() {
        [only] => Ok(only.clone()),
        [] => Err(GraphError::UnknownSource(
            "(no graph in this database)".into(),
        )),
        many => Err(GraphError::UnknownSource(format!(
            "several graphs, pass --source: {}",
            many.join(", ")
        ))),
    }
}

fn run(cli: &Cli) -> Result<String> {
    if matches!(cli.command, Command::Exec) {
        return exec();
    }
    let layout = cli.store.layout()?;
    if matches!(cli.command, Command::Delete) {
        let Some(label) = cli.source.as_deref() else {
            return Err(GraphError::UnknownSource(
                "delete needs --source <label>".into(),
            ));
        };
        let db = HomeDb::open(&layout)?;
        return delete_source(&db, label);
    }
    if let Command::Build { root, json, report } = &cli.command {
        let mut db = HomeDb::open(&layout)?;
        db.interrupt_stale_runs()?;
        let label = cli.source.clone().unwrap_or_else(|| {
            let name = std::fs::canonicalize(root)
                .ok()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
                .unwrap_or_else(|| "tree".to_owned());
            format!("graph:{name}")
        });
        let (graph, summary) = build_graph(&mut db, &label, root, &ScanOptions::default())?;
        if let Some(path) = json {
            graph.write_graph_json(
                std::io::BufWriter::new(
                    std::fs::File::create(path)
                        .map_err(|e| GraphError::Json(serde_json::Error::io(e)))?,
                ),
                None,
            )?;
        }
        if let Some(path) = report {
            std::fs::write(path, graph.report(&label, 15))
                .map_err(|e| GraphError::Json(serde_json::Error::io(e)))?;
        }
        let mut value = serde_json::to_value(&summary)?;
        value["source"] = label.into();
        return Ok(serde_json::to_string_pretty(&value)?);
    }
    let db = HomeDb::open_read_only(&layout.db_path)?;
    let label = pick_source(&db, cli.source.as_deref())?;
    let graph = Graph::load(&db, &label)?;
    Ok(match &cli.command {
        Command::Build { .. } | Command::Delete | Command::Exec => unreachable!("handled above"),
        Command::Query {
            question,
            depth,
            budget,
        } => {
            let result = graph.query(
                question,
                &QueryOptions {
                    depth: *depth,
                    budget_tokens: *budget,
                    ..QueryOptions::default()
                },
            );
            let mut out = result.text;
            if result.truncated > 0 {
                let _ = writeln!(
                    out,
                    "[truncated: {} more nodes within depth {depth}]",
                    result.truncated
                );
            }
            out
        }
        Command::Explain { node } => graph.explain(node)?.to_string(),
        Command::Path {
            from,
            to,
            directed,
            relations,
        } => {
            let relations = if *directed && relations.is_empty() {
                PathOptions::DEPENDENCY_RELATIONS
                    .iter()
                    .map(|r| (*r).to_owned())
                    .collect()
            } else {
                relations.clone()
            };
            let options = PathOptions {
                directed: *directed,
                relations,
            };
            match graph.shortest_path_with(from, to, &options)? {
                None => "no path".to_owned(),
                Some(path) => {
                    let mut out = String::new();
                    for hop in &path {
                        let n = &graph.nodes[hop.node];
                        match hop.via {
                            None => {
                                let _ = writeln!(out, "{}", n.label);
                            }
                            Some((e, forward)) => {
                                let edge = &graph.edges[e];
                                let arrow = if forward { "-->" } else { "<--" };
                                let _ = writeln!(out, "  {arrow} [{}] {}", edge.relation, n.label);
                            }
                        }
                    }
                    out
                }
            }
        }
        Command::Report => graph.report(&label, 15),
        Command::Export { out } => {
            graph.write_graph_json(
                std::io::BufWriter::new(
                    std::fs::File::create(out)
                        .map_err(|e| GraphError::Json(serde_json::Error::io(e)))?,
                ),
                None,
            )?;
            format!("wrote {}", out.display())
        }
    })
}

/// Entry point of `aphrody graph` (multi-call convention: `args[0]` is the invocation name).
#[must_use]
pub fn cli_main(args: Vec<OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            let _ = error.print();
            return i32::from(error.use_stderr());
        }
    };
    match run(&cli) {
        Ok(text) => {
            println!("{}", text.trim_end());
            0
        }
        Err(error) => {
            eprintln!("aphrody graph: {error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delete_removes_the_source_and_its_cascaded_rows() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("a.rs"),
            "fn run() { helper(); }\nfn helper() {}\n",
        )
        .unwrap();
        let mut db = HomeDb::open_in_memory().unwrap();
        build_graph(&mut db, "graph:gone", dir.path(), &ScanOptions::default()).unwrap();
        let text = delete_source(&db, "graph:gone").unwrap();
        assert!(
            text.starts_with("deleted code-graph source graph:gone: "),
            "{text}"
        );
        for table in ["graph_nodes", "graph_edges", "graph_file_cache", "files"] {
            let left: i64 = db
                .conn()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(left, 0, "{table}");
        }
        assert!(matches!(
            delete_source(&db, "graph:gone"),
            Err(GraphError::UnknownSource(_))
        ));
    }
}
