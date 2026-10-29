// SPDX-License-Identifier: Apache-2.0
//! Pure `aphrody pure ...` sub-commands: parsing and execution without network, processes, tokio,
//! git or ssh, so the same code runs in the native `aphrody-command` and on wasm32.
//!
//! Every command reads its inputs through a [`PureIo`] (standard files and stdin natively, an
//! in-memory map in the browser) and returns text. No command declares a capability of its own:
//! `rag` forwards to `aphrody_rag_core::api` (the single source shared with the wasm and FFI
//! bindings), `toolcall` to `aphrody-toolcall-repair`, `html` to `aphrody-web-extract`, `text` to
//! `aphrody-translate-core`.
//!
//! ```
//! use aphrody_command_pure::{MemoryIo, run_args};
//!
//! let mut io = MemoryIo::default();
//! io.stdin = "{'a': 1,}".into();
//! let out = run_args(&["toolcall".into(), "repair".into(), "-".into()], &mut io);
//! assert_eq!(out.code, 0);
//! assert!(out.stdout.contains("\"a\""));
//! ```

use std::{collections::BTreeMap, fmt};

use clap::{Args, Parser, Subcommand};
use serde_json::{Value, json};

/// Where a command reads its inputs. `"-"` is standard input.
pub trait PureIo {
    /// Read the text behind `source`.
    ///
    /// # Errors
    /// A message when the source cannot be read.
    fn read(&mut self, source: &str) -> Result<String, String>;
}

/// Process standard input and the file system (native hosts, wasm32-wasip1).
#[derive(Debug, Default, Clone, Copy)]
pub struct StdIo;

impl PureIo for StdIo {
    fn read(&mut self, source: &str) -> Result<String, String> {
        if source == "-" {
            let mut text = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut text)
                .map_err(|e| format!("cannot read standard input: {e}"))?;
            Ok(text)
        } else {
            std::fs::read_to_string(source).map_err(|e| format!("cannot read {source}: {e}"))
        }
    }
}

/// In-memory inputs (browser, tests): a stdin text and a map of named files.
#[derive(Debug, Default, Clone)]
pub struct MemoryIo {
    pub stdin: String,
    pub files: BTreeMap<String, String>,
}

impl PureIo for MemoryIo {
    fn read(&mut self, source: &str) -> Result<String, String> {
        if source == "-" {
            Ok(self.stdin.clone())
        } else {
            self.files
                .get(source)
                .cloned()
                .ok_or_else(|| format!("no such file: {source}"))
        }
    }
}

/// A command failure: the message goes to stderr and the process exits with code 1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PureError(pub String);

impl fmt::Display for PureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PureError {}

impl From<String> for PureError {
    fn from(message: String) -> Self {
        Self(message)
    }
}

/// `aphrody pure <command>`: embedded by `aphrody-command` as one top-level command.
#[derive(Debug, Args)]
pub struct PureArgs {
    #[command(subcommand)]
    pub command: PureCommand,
}

/// Stand-alone parser for hosts that do not embed the full CLI (wasm packages).
#[derive(Debug, Parser)]
#[command(
    name = "aphrody pure",
    about = "Pure aphrody commands: no network, no processes."
)]
pub struct PureCli {
    #[command(subcommand)]
    pub command: PureCommand,
}

#[derive(Debug, Subcommand)]
pub enum PureCommand {
    /// RAG core: chunking, rank fusion, MMR, source weighting, retrieval eval.
    Rag {
        #[command(subcommand)]
        command: RagCommand,
    },
    /// Tool-call JSON repair, validation and inline extraction.
    Toolcall {
        #[command(subcommand)]
        command: ToolcallCommand,
    },
    /// HTML main-content extraction, Markdown conversion and SimHash.
    Html {
        #[command(subcommand)]
        command: HtmlCommand,
    },
    /// Comment extraction, AI-marker scrubbing, Aphrody style and language detection.
    Text {
        #[command(subcommand)]
        command: TextCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum RagCommand {
    /// Manifest of the RAG call surface: ABI and every operation name.
    Ops,
    /// Run a structured operation: `rag call rrf '{"lists":[[1,2],[2,3]]}'`.
    Call {
        /// Operation name (see `rag ops`).
        op: String,
        /// JSON input: a literal, `-` for stdin or `@file`. Defaults to `{}`.
        input: Option<String>,
    },
    /// Split a source file into line-addressed chunks.
    Chunk {
        /// File to chunk, or `-` for stdin.
        file: String,
        /// Path used to pick the chunker (defaults to the file name).
        #[arg(long)]
        path: Option<String>,
        /// Options profile: `default` or `ts_parity`.
        #[arg(long)]
        profile: Option<String>,
        #[arg(long)]
        max_chars: Option<usize>,
        #[arg(long)]
        min_chars: Option<usize>,
        #[arg(long)]
        overlap_pct: Option<f32>,
    },
}

#[derive(Debug, Subcommand)]
pub enum ToolcallCommand {
    /// Repair malformed model-emitted JSON; prints `{"value", "repairs"}`.
    Repair {
        /// File, or `-` for stdin.
        file: String,
    },
    /// Validate arguments against a JSON-Schema subset; prints `{"violations"}`.
    Validate {
        /// Schema file.
        #[arg(long)]
        schema: String,
        /// Arguments file, or `-` for stdin.
        file: String,
    },
    /// Extract inline tool calls (Hermes, Qwen XML, Mistral, OpenAI, bare JSON).
    Extract {
        /// File, or `-` for stdin.
        file: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum HtmlCommand {
    /// Source-aware Dragon Ball projection as JSON, shared with native Web.
    DragonBall {
        file: String,
        /// catalogue, gallery, inventory, toei, jump, translation or official.
        #[arg(long)]
        kind: String,
        #[arg(long)]
        base_url: String,
        #[arg(long, default_value = "")]
        slug: String,
    },
    /// Main-content extraction as JSON (title, byline, Markdown, blocks, SimHash).
    Extract {
        /// File, or `-` for stdin.
        file: String,
        /// Page URL used to resolve relative links.
        #[arg(long)]
        base_url: Option<String>,
    },
    /// Whole-document HTML to GitHub-flavoured Markdown.
    Markdown {
        file: String,
        #[arg(long)]
        base_url: Option<String>,
    },
    /// 64-bit SimHash of the text, as 16 hex digits.
    Simhash { file: String },
}

#[derive(Debug, Subcommand)]
pub enum TextCommand {
    /// Comments of a source file as JSON.
    Comments {
        file: String,
        /// Path used to detect the language (defaults to the file name).
        #[arg(long)]
        path: Option<String>,
    },
    /// Remove AI markers and emoji from a comment body.
    Scrub { file: String },
    /// Apply the Aphrody prose style.
    Aphrodify { file: String },
    /// Print `true` when the text contains Japanese characters.
    IsJapanese { file: String },
}

/// Result of [`run_args`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Parse `args` (without the program name) and run the command.
///
/// Usage errors give code 2 with the clap message on stderr; `--help` gives code 0 on stdout;
/// a failing command gives code 1.
pub fn run_args(args: &[String], io: &mut dyn PureIo) -> Outcome {
    let parsed = PureCli::try_parse_from(
        std::iter::once("aphrody pure").chain(args.iter().map(String::as_str)),
    );
    match parsed {
        Ok(cli) => match run(&cli.command, io) {
            Ok(stdout) => Outcome {
                code: 0,
                stdout,
                stderr: String::new(),
            },
            Err(e) => Outcome {
                code: 1,
                stdout: String::new(),
                stderr: format!("{e}\n"),
            },
        },
        Err(e) => {
            let text = e.render().to_string();
            if e.use_stderr() {
                Outcome {
                    code: e.exit_code(),
                    stdout: String::new(),
                    stderr: text,
                }
            } else {
                Outcome {
                    code: 0,
                    stdout: text,
                    stderr: String::new(),
                }
            }
        }
    }
}

/// Execute one parsed command; the output ends with a newline.
///
/// # Errors
/// An unreadable input or a failing operation.
pub fn run(command: &PureCommand, io: &mut dyn PureIo) -> Result<String, PureError> {
    let (mut out, is_json) = match command {
        PureCommand::Rag { command } => (rag(command, io)?, true),
        PureCommand::Toolcall { command } => (toolcall(command, io)?, true),
        PureCommand::Html { command } => (
            html(command, io)?,
            matches!(command, HtmlCommand::Extract { .. }),
        ),
        PureCommand::Text { command } => (
            text(command, io)?,
            matches!(command, TextCommand::Comments { .. }),
        ),
    };
    if is_json {
        out = canonical_json(&out);
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
    Ok(out)
}

/// Re-serialise a JSON document with object keys in sorted order, so the output is the same on every
/// target whatever `serde_json` features the build graph unified (`preserve_order` differs between
/// the native binary and the wasm module). Text that is not JSON is returned unchanged.
fn canonical_json(text: &str) -> String {
    fn sorted(value: Value) -> Value {
        match value {
            Value::Object(map) => {
                let mut entries: Vec<(String, Value)> = map.into_iter().collect();
                entries.sort_by(|a, b| a.0.cmp(&b.0));
                Value::Object(entries.into_iter().map(|(k, v)| (k, sorted(v))).collect())
            }
            Value::Array(items) => Value::Array(items.into_iter().map(sorted).collect()),
            other => other,
        }
    }
    serde_json::from_str::<Value>(text).map_or_else(|_| text.to_string(), |v| sorted(v).to_string())
}

/// A JSON input: a literal, `-` for stdin or `@file`.
fn json_input(io: &mut dyn PureIo, input: Option<&str>) -> Result<String, PureError> {
    match input {
        None => Ok("{}".into()),
        Some("-") => Ok(io.read("-")?),
        Some(path) if path.starts_with('@') => Ok(io.read(&path[1..])?),
        Some(literal) => Ok(literal.to_string()),
    }
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn rag(command: &RagCommand, io: &mut dyn PureIo) -> Result<String, PureError> {
    match command {
        RagCommand::Ops => Ok(aphrody_rag_core::api::manifest()),
        RagCommand::Call { op, input } => {
            let input = json_input(io, input.as_deref())?;
            Ok(aphrody_rag_core::api::call_json(op, &input)?)
        }
        RagCommand::Chunk {
            file,
            path,
            profile,
            max_chars,
            min_chars,
            overlap_pct,
        } => {
            let text = io.read(file)?;
            let path = path.clone().unwrap_or_else(|| {
                if file == "-" {
                    "input.txt".into()
                } else {
                    file_name(file).to_string()
                }
            });
            let mut options = serde_json::Map::new();
            if let Some(v) = profile {
                options.insert("profile".into(), json!(v));
            }
            if let Some(v) = max_chars {
                options.insert("max_chars".into(), json!(v));
            }
            if let Some(v) = min_chars {
                options.insert("min_chars".into(), json!(v));
            }
            if let Some(v) = overlap_pct {
                options.insert("overlap_pct".into(), json!(v));
            }
            let input = json!({ "path": path, "text": text, "options": options });
            Ok(aphrody_rag_core::api::call_json(
                "chunk",
                &input.to_string(),
            )?)
        }
    }
}

fn parse_json(label: &str, text: &str) -> Result<Value, PureError> {
    serde_json::from_str(text).map_err(|e| PureError(format!("{label} is not valid JSON: {e}")))
}

fn toolcall(command: &ToolcallCommand, io: &mut dyn PureIo) -> Result<String, PureError> {
    match command {
        ToolcallCommand::Repair { file } => {
            let report = aphrody_toolcall_repair::repair_json_with_report(&io.read(file)?)
                .map_err(|e| PureError(e.to_string()))?;
            let repairs: Vec<String> = report.repairs.iter().map(|k| format!("{k:?}")).collect();
            Ok(json!({ "value": report.value, "repairs": repairs }).to_string())
        }
        ToolcallCommand::Validate { schema, file } => {
            let schema = parse_json("schema", &io.read(schema)?)?;
            let args = parse_json("arguments", &io.read(file)?)?;
            let violations: Vec<Value> =
                aphrody_toolcall_repair::validate_arguments(&args, &schema)
                    .iter()
                    .map(|v| json!({ "pointer": v.pointer, "message": v.message }))
                    .collect();
            Ok(json!({ "violations": violations }).to_string())
        }
        ToolcallCommand::Extract { file } => {
            let calls: Vec<Value> = aphrody_toolcall_repair::extract_any(&io.read(file)?)
                .into_iter()
                .map(|c| json!({ "name": c.name, "arguments": c.arguments, "span": [c.span.start, c.span.end] }))
                .collect();
            Ok(Value::Array(calls).to_string())
        }
    }
}

fn html(command: &HtmlCommand, io: &mut dyn PureIo) -> Result<String, PureError> {
    match command {
        HtmlCommand::DragonBall {
            file,
            kind,
            base_url,
            slug,
        } => Ok(aphrody_web_extract::dragon_ball::project_json(
            kind,
            &io.read(file)?,
            base_url,
            slug,
        )?),
        HtmlCommand::Extract { file, base_url } => Ok(aphrody_web_extract::extract_main_json(
            &io.read(file)?,
            base_url.as_deref(),
        )),
        HtmlCommand::Markdown { file, base_url } => Ok(aphrody_web_extract::html_to_markdown(
            &io.read(file)?,
            base_url.as_deref(),
        )),
        HtmlCommand::Simhash { file } => Ok(format!(
            "{:016x}",
            aphrody_web_extract::simhash64(&io.read(file)?)
        )),
    }
}

fn text(command: &TextCommand, io: &mut dyn PureIo) -> Result<String, PureError> {
    use aphrody_translate_core as core;
    match command {
        TextCommand::Comments { file, path } => {
            let source = io.read(file)?;
            let name = path.clone().unwrap_or_else(|| file_name(file).to_string());
            let lang = core::Lang::from_path(std::path::Path::new(&name));
            let comments: Vec<Value> = core::extract::extract(&source, lang)
                .into_iter()
                .map(|c| json!({ "style": format!("{:?}", c.style), "start": c.start, "end": c.end, "body": c.body }))
                .collect();
            Ok(Value::Array(comments).to_string())
        }
        TextCommand::Scrub { file } => Ok(core::ai_patterns::scrub(&io.read(file)?)),
        TextCommand::Aphrodify { file } => Ok(core::aphrodify::aphrodify(&io.read(file)?)),
        TextCommand::IsJapanese { file } => Ok(core::is_japanese(&io.read(file)?).to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_with(args: &[&str], stdin: &str, files: &[(&str, &str)]) -> Outcome {
        let mut io = MemoryIo {
            stdin: stdin.to_string(),
            files: files
                .iter()
                .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                .collect(),
        };
        let args: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
        run_args(&args, &mut io)
    }

    fn json_of(out: &Outcome) -> Value {
        assert_eq!(out.code, 0, "stderr: {}", out.stderr);
        serde_json::from_str(&out.stdout).expect("json output")
    }

    #[test]
    fn rag_ops_lists_the_shared_manifest() {
        let m = json_of(&run_with(&["rag", "ops"], "", &[]));
        assert_eq!(m["abi"], aphrody_rag_core::api::ABI_VERSION);
        assert!(m["json"].as_array().is_some_and(|ops| ops.len() > 20));
    }

    #[test]
    fn rag_call_goes_through_the_single_api() {
        let direct =
            aphrody_rag_core::api::call_json("rrf", r#"{"lists":[["a","b"],["b"]]}"#).unwrap();
        let out = run_with(
            &["rag", "call", "rrf", r#"{"lists":[["a","b"],["b"]]}"#],
            "",
            &[],
        );
        assert_eq!(out.stdout.trim(), direct);
        let stdin = run_with(
            &["rag", "call", "rrf", "-"],
            r#"{"lists":[["a","b"],["b"]]}"#,
            &[],
        );
        assert_eq!(stdin.stdout.trim(), direct);
        let file = run_with(
            &["rag", "call", "rrf", "@in.json"],
            "",
            &[("in.json", r#"{"lists":[["a","b"],["b"]]}"#)],
        );
        assert_eq!(file.stdout.trim(), direct);
        let bad = run_with(&["rag", "call", "nope"], "", &[]);
        assert_eq!(
            (bad.code, bad.stderr.contains("unknown json operation")),
            (1, true)
        );
    }

    #[test]
    fn rag_chunk_picks_the_chunker_from_the_file_name() {
        let src = "fn greet() {\n    println!(\"hi\");\n}\n";
        let v = json_of(&run_with(
            &["rag", "chunk", "src/lib.rs"],
            "",
            &[("src/lib.rs", src)],
        ));
        assert_eq!(v[0]["symbol"], "greet");
        let stdin = json_of(&run_with(
            &[
                "rag",
                "chunk",
                "-",
                "--path",
                "a.rs",
                "--profile",
                "ts_parity",
            ],
            src,
            &[],
        ));
        assert_eq!(stdin[0]["symbol"], "greet");
        let long = "# T\n\nFirst sentence is here. Second sentence follows it. Third sentence closes it. Fourth one adds more words. Fifth one ends.\n";
        let md = json_of(&run_with(
            &["rag", "chunk", "-", "--path", "a.md", "--max-chars", "50"],
            long,
            &[],
        ));
        assert!(md.as_array().is_some_and(|c| c.len() > 1), "{md}");
    }

    #[test]
    fn json_output_has_sorted_keys() {
        // The manifest inserts `version` before `oxc`; the canonical output sorts them.
        let out = run_with(&["rag", "ops"], "", &[]).stdout;
        assert!(
            out.find("\"oxc\"").unwrap() < out.find("\"version\"").unwrap(),
            "{out}"
        );
    }

    #[test]
    fn toolcall_commands() {
        let repaired = json_of(&run_with(
            &["toolcall", "repair", "-"],
            "```json\n{'a': 1,}\n```",
            &[],
        ));
        assert_eq!(repaired["value"], json!({"a": 1}));
        assert!(
            repaired["repairs"]
                .as_array()
                .is_some_and(|r| !r.is_empty())
        );
        assert_eq!(run_with(&["toolcall", "repair", "-"], "  ", &[]).code, 1);
        let v = json_of(&run_with(
            &["toolcall", "validate", "--schema", "s.json", "-"],
            r#"{"n": "x"}"#,
            &[(
                "s.json",
                r#"{"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}"#,
            )],
        ));
        assert_eq!(v["violations"].as_array().map(Vec::len), Some(1));
        let calls = json_of(&run_with(
            &["toolcall", "extract", "-"],
            r#"go <tool_call>{"name": "read", "arguments": {"path": "a"}}</tool_call>"#,
            &[],
        ));
        assert_eq!(calls[0]["name"], "read");
    }

    #[test]
    fn html_commands() {
        let page = "<html><head><title>T</title></head><body><article><h1>Guide</h1><p>A long enough paragraph with substantial content for extraction, long enough to be kept as the main content.</p></article></body></html>";
        let md = run_with(
            &["html", "markdown", "-", "--base-url", "https://x.test/"],
            page,
            &[],
        );
        assert!(md.stdout.contains("# Guide"), "{}", md.stdout);
        let v = json_of(&run_with(&["html", "extract", "-"], page, &[]));
        assert_eq!(v["title"], "T");
        let hash = run_with(&["html", "simhash", "-"], "same text here", &[]);
        assert_eq!(hash.stdout.trim().len(), 16);
        assert_eq!(
            hash,
            run_with(&["html", "simhash", "-"], "same text here", &[])
        );
    }

    #[test]
    fn dragon_ball_projection_uses_shared_source_parser() {
        let result = run_with(
            &[
                "html",
                "dragon-ball",
                "-",
                "--kind",
                "official",
                "--base-url",
                "https://dragon-ball-official.com/news/01_1.html",
            ],
            "<h3 class='news-post__title'>Interview</h3><time datetime='2026-10-07'></time>",
            &[],
        );
        let value = json_of(&result);
        assert_eq!(value[0]["title"], "Interview");
        assert_eq!(value[0]["date"], "2026-10-07");
        assert_eq!(
            run_with(
                &[
                    "html",
                    "dragon-ball",
                    "-",
                    "--kind",
                    "unknown",
                    "--base-url",
                    "https://example.org"
                ],
                "",
                &[]
            )
            .code,
            1
        );
    }

    #[test]
    fn text_commands() {
        let c = json_of(&run_with(
            &["text", "comments", "-", "--path", "a.rs"],
            "// hello world\nfn f() {}\n",
            &[],
        ));
        assert_eq!(c[0]["body"], "hello world");
        assert_eq!(
            run_with(&["text", "scrub", "-"], "note \u{1F916} here", &[])
                .stdout
                .trim(),
            "note here"
        );
        assert_eq!(
            run_with(&["text", "is-japanese", "-"], "こんにちは", &[])
                .stdout
                .trim(),
            "true"
        );
        assert_eq!(
            run_with(&["text", "is-japanese", "-"], "Hello", &[])
                .stdout
                .trim(),
            "false"
        );
        assert!(
            !run_with(&["text", "aphrodify", "-"], "Let's just do it", &[])
                .stdout
                .is_empty()
        );
    }

    #[test]
    fn usage_errors_help_and_missing_files() {
        assert_eq!(run_with(&["nope"], "", &[]).code, 2);
        let help = run_with(&["--help"], "", &[]);
        assert_eq!(help.code, 0);
        assert!(help.stdout.contains("toolcall"));
        let missing = run_with(&["html", "markdown", "gone.html"], "", &[]);
        assert_eq!(
            (missing.code, missing.stderr.contains("no such file")),
            (1, true)
        );
    }
}
