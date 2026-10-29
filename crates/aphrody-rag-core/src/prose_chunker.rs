// SPDX-License-Identifier: Apache-2.0
//! Plain-prose chunker: sentence-boundary splitting at `max_chars` with
//! `overlap_pct` trailing overlap, ported bit-for-bit (see
//! [`crate::text::split_sentences_with_offsets`] and
//! [`crate::text::pack_sentences_with_overlap`]) from the TypeScript reference's
//! `_rag-chunk.ts` `chunkDocument`. This is the whole-file
//! special case of that algorithm: one section, no heading prefix.

use crate::{
    chunk::{Chunk, ChunkKind, ChunkOptions, Chunker},
    text::{normalize_newlines, pack_sentences_with_overlap, split_sentences_with_offsets},
};

pub struct ProseChunker;

impl Chunker for ProseChunker {
    fn chunk(&self, _path: &str, source: &str, opts: &ChunkOptions) -> Vec<Chunk> {
        let normalized = normalize_newlines(source);
        if normalized.trim().is_empty() {
            return Vec::new();
        }
        let sentences = split_sentences_with_offsets(&normalized, 1, opts.cjk_sentence_breaks);
        let packed = pack_sentences_with_overlap(
            &sentences,
            opts.max_chars,
            opts.overlap_pct,
            "",
            opts.length_unit,
            opts.cjk_sentence_breaks,
        );
        let mut out = Vec::new();
        for (ord, p) in packed.into_iter().enumerate() {
            if p.text.trim().is_empty() {
                continue;
            }
            out.push(Chunk::new(
                u32::try_from(ord).unwrap_or(0),
                ChunkKind::Prose,
                None,
                p.start_line,
                p.end_line,
                p.text,
            ));
        }
        out
    }
}
