// SPDX-License-Identifier: Apache-2.0
//! The chunk data model shared by every chunker, plus extension-based
//! dispatch (`chunker_for_path`) and language detection.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// A single retrieval-sized unit of source text extracted from a document.
///
/// `start_line`/`end_line` are 1-based and inclusive, and always refer to
/// lines of the *normalised* (LF-only) source the chunker was given — see
/// [`crate::text::normalize_newlines`]. `hash` is the BLAKE3 digest of
/// `text`, letting a caller detect an unchanged chunk without re-embedding
/// it (the incremental-index use case described in `docs/plans/codex-oss.md`
/// phase P8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chunk {
    /// 0-based emission order within the file (stable, deterministic).
    pub ord: u32,
    /// What kind of content this chunk represents.
    pub kind: ChunkKind,
    /// A human-addressable symbol path, e.g. `Supervisor::ensure` for a Rust
    /// impl method, or `Install > Linux` for a Markdown heading trail.
    /// `None` when the chunker cannot name the unit (plain prose, imports…).
    pub symbol: Option<String>,
    /// 1-based, inclusive first line of the chunk in the source.
    pub start_line: u32,
    /// 1-based, inclusive last line of the chunk in the source.
    pub end_line: u32,
    /// The chunk's literal text (LF-normalised).
    pub text: String,
    /// BLAKE3 digest of `text`.
    pub hash: [u8; 32],
}

impl Chunk {
    /// Build a chunk, deriving `hash` from `text`. `ord` is assigned by the
    /// caller (the chunker keeps a running counter).
    #[must_use]
    pub fn new(
        ord: u32,
        kind: ChunkKind,
        symbol: Option<String>,
        start_line: u32,
        end_line: u32,
        text: String,
    ) -> Self {
        let hash = *blake3::hash(text.as_bytes()).as_bytes();
        Self {
            ord,
            kind,
            symbol,
            start_line,
            end_line,
            text,
            hash,
        }
    }
}

/// The broad category a chunk falls into. Consumers use this to weight
/// retrieval (code vs. prose) and to pick a display renderer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChunkKind {
    /// A function, method, class, struct, module, or other program unit.
    Code,
    /// A documentation section (Markdown, docstring blocks, doc comments
    /// large enough to be split out on their own).
    Doc,
    /// Free-running natural-language text with no structural markers.
    Prose,
    /// A Markdown heading section, keyed by its heading trail.
    Heading,
    /// A configuration block (front-matter, TOML table, YAML top-level key,
    /// JSON top-level key…).
    Config,
}

/// The unit `max_chars`/`min_chars`/overlap budgets are measured in. See
/// [`crate::text::measure`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum LengthUnit {
    /// UTF-16 code units — what JavaScript's `String.prototype.length`
    /// counts, and therefore what the TypeScript reference's `maxChunkChars = 1400` actually
    /// measures. **Default**: the reference corpus (`docs/plans/
    /// codex-oss.md` P9) is French + Japanese, and byte-sizing cuts Japanese
    /// passages roughly 3x too early (each kana/kanji is ~3 UTF-8 bytes but
    /// 1 UTF-16 unit) and French ones ~10% too early (each accented letter
    /// is 2 bytes but 1 unit).
    #[default]
    Utf16,
    /// Unicode scalar values (`char::count`). Diverges from `Utf16` only
    /// inside astral-plane characters (each counts 1 here, 2 in UTF-16).
    Chars,
    /// UTF-8 bytes (`str::len`). Provided for callers with a genuine
    /// byte-budget constraint (e.g. a fixed-size storage cell); not
    /// recommended for sizing against a `max_chars` inherited from a
    /// JS-authored corpus.
    Bytes,
}

/// Tunable knobs shared by every chunker.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChunkOptions {
    /// Soft cap on a chunk's length, measured in `length_unit`. A single
    /// unsplittable line/sentence is the only thing allowed to exceed it.
    pub max_chars: usize,
    /// Fraction of `max_chars` carried over as trailing context into the next
    /// chunk when an oversized unit is split.
    pub overlap_pct: f32,
    /// Trailing chunks shorter than this (same unit as `max_chars`) are
    /// merged into their predecessor instead of being emitted as a
    /// near-empty fragment.
    pub min_chars: usize,
    /// Unit `max_chars`/`min_chars`/overlap are measured in.
    pub length_unit: LengthUnit,
    /// When `true` (the default), the prose/Markdown sentence splitter also
    /// treats a CJK sentence terminator (`。`, `！`, `？`, `．`) as a boundary
    /// — no trailing space required, unlike the ASCII `. ! ?` rule — so a
    /// Japanese/Chinese passage without ASCII punctuation still splits at
    /// `max_chars` instead of becoming one oversized "unsplittable
    /// sentence". Set to `false` for bit-for-bit parity with the TypeScript reference's
    /// `_rag-chunk.ts`, which has no CJK support (see
    /// [`ChunkOptions::ts_parity`]).
    pub cjk_sentence_breaks: bool,
}

impl Default for ChunkOptions {
    fn default() -> Self {
        Self {
            max_chars: 1400,
            overlap_pct: 0.15,
            min_chars: 64,
            length_unit: LengthUnit::Utf16,
            cjk_sentence_breaks: true,
        }
    }
}

impl ChunkOptions {
    /// Options reproducing the TypeScript reference's `_rag-chunk.ts` `chunkDocument` exactly:
    /// `max_chars = 1400`, `overlap_pct = 0.15`, lengths measured the way JS
    /// measures them (`LengthUnit::Utf16`), and no CJK sentence-boundary
    /// extension (upstream has none). Every TS-parity test in this crate
    /// runs under this profile.
    #[must_use]
    pub fn ts_parity() -> Self {
        Self {
            max_chars: 1400,
            overlap_pct: 0.15,
            min_chars: 64,
            length_unit: LengthUnit::Utf16,
            cjk_sentence_breaks: false,
        }
    }
}

/// Source language detected from a path's extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    Rust,
    JavaScript,
    TypeScript,
    Markdown,
    Python,
    Go,
    Java,
    CSharp,
    C,
    Cpp,
    Kotlin,
    Swift,
    Shell,
    Toml,
    Yaml,
    Json,
    PlainText,
    /// Recognised as source-like but not given a dedicated declaration
    /// pattern; falls back to the brace/indent structural splitter.
    Unknown,
}

/// Guess a [`Language`] from a file path's extension. Extension-only, no I/O.
#[must_use]
pub fn detect_language(path: &str) -> Language {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "rs" => Language::Rust,
        "js" | "mjs" | "cjs" | "jsx" => Language::JavaScript,
        "ts" | "tsx" | "mts" | "cts" => Language::TypeScript,
        "md" | "markdown" | "mdx" => Language::Markdown,
        "py" | "pyi" => Language::Python,
        "go" => Language::Go,
        "java" => Language::Java,
        "cs" => Language::CSharp,
        "c" | "h" => Language::C,
        "cpp" | "cc" | "cxx" | "hpp" | "hh" | "hxx" => Language::Cpp,
        "kt" | "kts" => Language::Kotlin,
        "swift" => Language::Swift,
        "sh" | "bash" | "zsh" => Language::Shell,
        "toml" => Language::Toml,
        "yaml" | "yml" => Language::Yaml,
        "json" | "jsonc" => Language::Json,
        "txt" | "" => Language::PlainText,
        _ => Language::Unknown,
    }
}

/// A pluggable source-to-chunks splitter.
pub trait Chunker {
    /// Split `source` (as read from `path`) into ordered, line-addressed
    /// chunks. Implementations normalise CRLF to LF internally so callers
    /// never have to.
    fn chunk(&self, path: &str, source: &str, opts: &ChunkOptions) -> Vec<Chunk>;
}

/// Pick a [`Chunker`] for `path` by extension. Always returns something
/// usable — worst case, the structural or prose fallback — so a caller never
/// has to special-case "unknown file type".
#[must_use]
pub fn chunker_for_path(path: &str) -> Box<dyn Chunker> {
    match detect_language(path) {
        Language::Rust => Box::new(crate::rust_chunker::RustChunker),
        #[cfg(feature = "oxc")]
        Language::JavaScript | Language::TypeScript => Box::new(crate::jsts_chunker::JsTsChunker),
        #[cfg(not(feature = "oxc"))]
        lang @ (Language::JavaScript | Language::TypeScript) => {
            Box::new(crate::structural_chunker::StructuralChunker::new(lang))
        }
        Language::Markdown => Box::new(crate::markdown_chunker::MarkdownChunker),
        Language::PlainText => Box::new(crate::prose_chunker::ProseChunker),
        lang => Box::new(crate::structural_chunker::StructuralChunker::new(lang)),
    }
}
