// SPDX-License-Identifier: Apache-2.0
//! Line/offset bookkeeping and the two generic packing algorithms every
//! chunker builds on:
//!
//! * [`pack_sentences_with_overlap`] — a faithful Rust port of the sentence-packing loop in
//!   the TypeScript reference's `_rag-chunk.ts` (`chunkDocument`'s `emitSectionChunks`, lines 45-96
//!   as read on 2026-09-19). Used directly by [`crate::prose_chunker::ProseChunker`] and,
//!   per-section, by [`crate::markdown_chunker::MarkdownChunker`].
//! * [`pack_lines_with_overlap`] — the same greedy/overlap shape applied to whole source lines
//!   instead of sentences, used to split an oversized code unit (an over-long Rust item, JS/TS
//!   declaration, or structural block) on blank-line/statement boundaries.
//!
//! Length is measured via [`measure`] in the caller-chosen
//! [`crate::chunk::LengthUnit`] — `Utf16` by default, matching JavaScript's
//! `.length` (and therefore the TypeScript reference's `maxChunkChars`), since the reference
//! corpus is French + Japanese and byte-sizing distorts both (see
//! [`crate::chunk::LengthUnit`]'s doc comment for the exact ratios). Every
//! packer below only ever compares/accumulates whole, already-valid
//! substrings (sentences, lines, paragraphs) — it never slices a string at a
//! `measure`d offset — so a chosen unit can never produce a chunk boundary
//! that lands off a `char` boundary.

use std::sync::LazyLock;

use regex::Regex;

use crate::chunk::LengthUnit;

/// Measure `s`'s length in `unit`. This is the single place every chunker
/// compares text against `ChunkOptions::max_chars`/`min_chars`/overlap.
#[must_use]
pub fn measure(s: &str, unit: LengthUnit) -> usize {
    match unit {
        LengthUnit::Bytes => s.len(),
        LengthUnit::Chars => s.chars().count(),
        LengthUnit::Utf16 => s.encode_utf16().count(),
    }
}

/// Normalise CRLF and lone-CR line endings to `\n`. Every chunker calls this
/// first so CRLF input yields byte-identical chunk `text` to LF input.
#[must_use]
pub fn normalize_newlines(source: &str) -> String {
    if source.contains('\r') {
        source.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        source.to_string()
    }
}

/// Maps byte offsets within a (already LF-normalised) text back to 1-based
/// line numbers, given the 1-based line number of the text's first line.
pub struct LineIndex {
    /// `starts[i]` = byte offset of the start of the `i`-th line (0-based)
    /// within the mapped text.
    starts: Vec<usize>,
    /// 1-based line number of `starts[0]`.
    base_line: u32,
}

impl LineIndex {
    /// Build an index over `text`, whose first line is numbered `base_line`
    /// (1-based) in the caller's original document.
    #[must_use]
    pub fn new(text: &str, base_line: u32) -> Self {
        let mut starts = Vec::with_capacity(text.lines().count().max(1));
        let mut offset = 0usize;
        starts.push(0);
        for line in text.split('\n') {
            offset += line.len() + 1;
            starts.push(offset);
        }
        // The loop above pushes one trailing sentinel past the last line;
        // callers only index with valid byte offsets into `text`, so it is
        // never observed as a line number on its own.
        Self { starts, base_line }
    }

    /// The 1-based source line number containing byte offset `at` (clamped
    /// to the text's line count).
    #[must_use]
    pub fn line_at(&self, at: usize) -> u32 {
        // `starts` is sorted ascending; find the last start <= at.
        let idx = self.starts.partition_point(|&s| s <= at).saturating_sub(1);
        self.base_line + u32::try_from(idx).unwrap_or(u32::MAX)
    }
}

/// A sentence extracted from prose, paired with the 1-based line range of
/// its (untrimmed) source span.
#[derive(Debug, Clone)]
pub struct Sentence {
    pub text: String,
    pub start_line: u32,
    pub end_line: u32,
}

/// Regex reproducing `text.split(/([.!?](?:\s+|$))/)` from `_rag-chunk.ts`.
/// A single sentence-ending punctuation mark followed by whitespace or the
/// end of the text.
static SENTENCE_END: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[.!?](?:\s+|$)").expect("static regex"));

/// The ASCII rule plus a CJK sentence terminator (`。！？．`). Unlike the
/// ASCII rule, no trailing whitespace is required — Japanese/Chinese prose
/// runs sentences together with no space — but a single immediately
/// following newline is consumed as part of the boundary (so it never
/// lingers as leading whitespace on the next sentence; `trim()` in
/// [`push_sentence`] would strip it either way, this only affects the
/// boundary's byte range and therefore its line mapping).
static SENTENCE_END_WITH_CJK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[.!?](?:\s+|$)|[。！？．]\n?").expect("static regex"));

/// Split `text` into sentences the same way `splitIntoSentences` in
/// `_rag-chunk.ts` does, but additionally returning each sentence's 1-based
/// line range (`base_line` numbers `text`'s first line) so callers can build
/// [`crate::chunk::Chunk::start_line`]/`end_line`.
///
/// Faithful to the TS source when `cjk_sentence_breaks` is `false`: a match
/// is a single `. ! ?` immediately followed by whitespace or end-of-string
/// (so `"..."` collapses to one boundary at its last dot, exactly as the JS
/// regex would), and a sentence is the text since the previous boundary up
/// to and including the match. The upstream algorithm does not special-case
/// Japanese `。！？`; pass `cjk_sentence_breaks = true` (aphrody's own
/// default, see [`crate::chunk::ChunkOptions::cjk_sentence_breaks`]) to also
/// split on those.
#[must_use]
pub fn split_sentences_with_offsets(
    text: &str,
    base_line: u32,
    cjk_sentence_breaks: bool,
) -> Vec<Sentence> {
    let index = LineIndex::new(text, base_line);
    let re: &Regex = if cjk_sentence_breaks {
        &SENTENCE_END_WITH_CJK
    } else {
        &SENTENCE_END
    };
    let mut sentences = Vec::new();
    let mut seg_start = 0usize;
    for m in re.find_iter(text) {
        push_sentence(&mut sentences, text, seg_start, m.end(), &index);
        seg_start = m.end();
    }
    if seg_start < text.len() {
        push_sentence(&mut sentences, text, seg_start, text.len(), &index);
    }
    sentences
}

fn push_sentence(out: &mut Vec<Sentence>, text: &str, start: usize, end: usize, index: &LineIndex) {
    let raw = &text[start..end];
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }
    out.push(Sentence {
        text: trimmed.to_string(),
        start_line: index.line_at(start),
        end_line: index.line_at(end.saturating_sub(1)),
    });
}

/// A packed run of sentences/lines ready to become one [`crate::chunk::Chunk`].
pub struct PackedUnit {
    pub text: String,
    pub start_line: u32,
    pub end_line: u32,
}

/// Greedy-pack `sentences` into `max_chars`-bounded runs with `overlap_pct`
/// trailing context carried into the next run — a direct port of
/// `emitSectionChunks`'s inner loop in `_rag-chunk.ts`. `prefix` is prepended
/// to every emitted chunk's text (the TS `contextPrefix`, e.g. `"[Install >
/// Linux] "`); pass `""` for none. Sentences are joined with a single space,
/// matching `currentChunkSentences.join(" ")`.
///
/// `exact_join_accounting` selects which of two budgets the overflow check
/// uses:
/// - `false` — the **faithful TS accounting**: `current_len` sums only each sentence's own length,
///   never the `" "` separators `emit` inserts between them. This is what `_rag-chunk.ts` does too
///   (`currentChunkLen += sLen`, no separator term), and for ASCII prose it is a harmless
///   approximation — the trailing space the sentence regex consumes and `trim()`s away roughly
///   cancels the space `join(" ")` re-inserts. Used by
///   [`crate::chunk::ChunkOptions::ts_parity`] so chunk boundaries match a `bun`-generated
///   golden bit-for-bit.
/// - `true` — **exact accounting**: `current_len` tracks the true length of `current.join(" ")`,
///   separators included. Required for CJK sentences (`。！？．`), which unlike `. ! ?` consume no
///   trailing whitespace — the cancellation above does not happen, so the faithful path can
///   overshoot `max_chars` by roughly one unit per sentence in the chunk (observed: 93 15-unit
///   Japanese sentences packed to 1487 units against a 1400 budget under the faithful accounting).
///   This is what [`crate::chunk::ChunkOptions::default`] (`cjk_sentence_breaks: true`) uses, and
///   it is O(1) amortised per sentence, not a re-measure of the whole run.
#[must_use]
pub fn pack_sentences_with_overlap(
    sentences: &[Sentence],
    max_chars: usize,
    overlap_pct: f32,
    prefix: &str,
    unit: LengthUnit,
    exact_join_accounting: bool,
) -> Vec<PackedUnit> {
    if sentences.is_empty() {
        return Vec::new();
    }
    let overlap_chars = ((max_chars as f32) * overlap_pct).floor() as usize;
    let mut out = Vec::new();
    let mut current: Vec<&Sentence> = Vec::new();
    let mut current_len = 0usize;
    // The `" "` `join` separator's length in `unit` — always 1 (a single
    // ASCII space is one byte, one char, one UTF-16 unit).
    let sep = usize::from(exact_join_accounting);

    let emit = |current: &[&Sentence], out: &mut Vec<PackedUnit>| {
        if current.is_empty() {
            return;
        }
        let start_line = current
            .iter()
            .map(|s| s.start_line)
            .min()
            .unwrap_or_default();
        let end_line = current.iter().map(|s| s.end_line).max().unwrap_or_default();
        let joined = current
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        out.push(PackedUnit {
            text: format!("{prefix}{joined}"),
            start_line,
            end_line,
        });
    };

    for sentence in sentences {
        let s_len = measure(&sentence.text, unit);
        let incremental = if current.is_empty() {
            s_len
        } else {
            s_len + sep
        };
        if current_len + incremental > max_chars && !current.is_empty() {
            emit(&current, &mut out);

            // Carry the trailing sentences whose cumulative (separator-
            // inclusive when `exact_join_accounting`) length fits the
            // overlap budget, exactly as the TS backward scan does.
            let mut overlap: Vec<&Sentence> = Vec::new();
            let mut overlap_len = 0usize;
            for s in current.iter().rev() {
                let len = measure(&s.text, unit);
                let candidate = if overlap.is_empty() { len } else { len + sep };
                if overlap_len + candidate <= overlap_chars {
                    overlap.insert(0, s);
                    overlap_len += candidate;
                } else {
                    break;
                }
            }
            current = overlap;
            current_len = overlap_len;
        }
        let push_incremental = if current.is_empty() {
            s_len
        } else {
            s_len + sep
        };
        current.push(sentence);
        current_len += push_incremental;
    }
    emit(&current, &mut out);
    out
}

/// Split an oversized code/structural unit on blank-line boundaries (falling
/// back to individual lines when a single paragraph still exceeds
/// `max_chars`), with `overlap_pct` trailing-line overlap into the next
/// chunk — the code-oriented sibling of [`pack_sentences_with_overlap`].
/// `lines` are 1-based-numbered starting at `base_line`. A single line that
/// alone exceeds `max_chars` is kept whole (the documented "unsplittable
/// line" escape hatch).
#[must_use]
pub fn pack_lines_with_overlap(
    lines: &[&str],
    base_line: u32,
    max_chars: usize,
    overlap_pct: f32,
    unit: LengthUnit,
) -> Vec<PackedUnit> {
    if lines.is_empty() {
        return Vec::new();
    }
    // Group into blank-line-delimited paragraphs first, each paragraph
    // carrying its own contiguous line range.
    struct Paragraph {
        text: String,
        start_line: u32,
        end_line: u32,
    }
    let mut paragraphs: Vec<Paragraph> = Vec::new();
    let mut buf: Vec<&str> = Vec::new();
    let mut buf_start = base_line;
    for (i, &line) in lines.iter().enumerate() {
        let lineno = base_line + u32::try_from(i).unwrap_or(u32::MAX);
        if line.trim().is_empty() {
            if !buf.is_empty() {
                paragraphs.push(Paragraph {
                    text: buf.join("\n"),
                    start_line: buf_start,
                    end_line: lineno - 1,
                });
                buf.clear();
            }
            buf_start = lineno + 1;
        } else {
            if buf.is_empty() {
                buf_start = lineno;
            }
            buf.push(line);
        }
    }
    if !buf.is_empty() {
        let end = base_line + u32::try_from(lines.len()).unwrap_or(u32::MAX) - 1;
        paragraphs.push(Paragraph {
            text: buf.join("\n"),
            start_line: buf_start,
            end_line: end,
        });
    }

    // A paragraph that alone exceeds max_chars is further split by line.
    let mut units: Vec<Paragraph> = Vec::new();
    for p in paragraphs {
        if measure(&p.text, unit) <= max_chars {
            units.push(p);
            continue;
        }
        for (line_no, line) in (p.start_line..).zip(p.text.split('\n')) {
            units.push(Paragraph {
                text: line.to_string(),
                start_line: line_no,
                end_line: line_no,
            });
        }
    }

    let overlap_chars = ((max_chars as f32) * overlap_pct).floor() as usize;
    let mut out = Vec::new();
    let mut current: Vec<&Paragraph> = Vec::new();
    let mut current_len = 0usize;
    let sep_len = 2usize; // "\n\n" between paragraphs, matching a Markdown-ish join

    let emit = |current: &[&Paragraph], out: &mut Vec<PackedUnit>| {
        if current.is_empty() {
            return;
        }
        let start_line = current
            .iter()
            .map(|p| p.start_line)
            .min()
            .unwrap_or_default();
        let end_line = current.iter().map(|p| p.end_line).max().unwrap_or_default();
        let text = current
            .iter()
            .map(|p| p.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        out.push(PackedUnit {
            text,
            start_line,
            end_line,
        });
    };

    for p in &units {
        let p_len = measure(&p.text, unit);
        let added = p_len + if current.is_empty() { 0 } else { sep_len };
        if current_len + added > max_chars && !current.is_empty() {
            emit(&current, &mut out);
            let mut overlap: Vec<&Paragraph> = Vec::new();
            let mut overlap_len = 0usize;
            for u in current.iter().rev() {
                let candidate =
                    measure(&u.text, unit) + if overlap.is_empty() { 0 } else { sep_len };
                if overlap_len + candidate <= overlap_chars {
                    overlap.insert(0, u);
                    overlap_len += candidate;
                } else {
                    break;
                }
            }
            current = overlap;
            current_len = overlap_len;
        }
        let add_len = p_len + if current.is_empty() { 0 } else { sep_len };
        current.push(p);
        current_len += add_len;
    }
    emit(&current, &mut out);
    out
}

/// Byte-range helper used by the Rust/JS-TS chunkers: extract full source
/// lines `[start_line, end_line]` (1-based, inclusive) from `lines`.
#[must_use]
pub fn slice_lines(lines: &[&str], start_line: u32, end_line: u32) -> String {
    let s = (start_line.saturating_sub(1)) as usize;
    let e = (end_line as usize).min(lines.len());
    if s >= e {
        return String::new();
    }
    lines[s..e].join("\n")
}

/// Extend a sorted, non-overlapping sequence of "natural" `(start_line,
/// end_line)` ranges so that every line in `1..=total_lines` is covered by
/// exactly one of them: gaps before the first, between two consecutive
/// ranges, and after the last are absorbed into the *following* range
/// (falling back to the last range for trailing gaps). Used by both the
/// Rust chunker (item spans) and the structural chunker (declaration
/// boundaries) so stray comments, blank lines, and file-leading doc
/// comments never fall outside every chunk.
#[must_use]
pub fn gap_fill_ranges(natural: &[(u32, u32)], total_lines: u32) -> Vec<(u32, u32)> {
    let mut out = Vec::with_capacity(natural.len());
    for (i, &(_, natural_end)) in natural.iter().enumerate() {
        let start = if i == 0 { 1 } else { natural[i - 1].1 + 1 };
        let end = if i + 1 < natural.len() {
            natural[i + 1].0.saturating_sub(1).max(start)
        } else {
            total_lines.max(start)
        };
        out.push((start, end.max(natural_end)));
    }
    out
}
