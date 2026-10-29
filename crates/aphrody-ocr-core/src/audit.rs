// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// Quality audit over a batch of transcriptions.
//
// The filters in `doctags` run per page, at read time. This module asks the
// question a whole batch raises: is anything here obviously wrong before it is
// deposited into a corpus that other people will read?
//
// It exists because a deposit is hard to undo. Writing four hundred plates of
// degenerate output into a public database costs far more than the second it
// takes to check them, and "the filters ran" is not the same claim as "the
// output is clean" — a filter that silently stopped matching would leave both
// statements looking identical from the outside.
//
// Every finding names its page, so a caller can act on one plate rather than
// discarding a batch.

use std::path::PathBuf;

/// What is wrong with one transcription.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
#[non_exhaustive]
pub enum Finding {
    /// A chat control token survived into the text.
    ControlToken {
        /// The token that was found.
        token: String,
    },
    /// The same word repeats far past anything natural: a generation that got
    /// stuck and was not caught at read time.
    Loop {
        /// The repeated word.
        word: String,
        /// How many times in a row.
        repeats: usize,
    },
    /// Markup survived into what should be plain text.
    Markup {
        /// A sample of the offending text.
        sample: String,
    },
    /// A line that is nothing but a URL — a watermark that got through.
    Watermark {
        /// The line.
        line: String,
    },
    /// A script with no business in this corpus, found alongside CJK text.
    ///
    /// Cyrillic, Arabic, Thai and Hangul are never a real reading of a
    /// Japanese or Chinese databook page — a fragment in one of them is the
    /// model inventing a plausible-looking glyph, not transcribing one.
    /// Mirrors an external reference `ETRANGER` rule
    /// so a page that passes one judge's alphabet check passes the other's for the same reason.
    ForeignScript {
        /// A short sample of text around the offending character.
        sample: String,
    },
}

impl Finding {
    /// Whether this finding should block a deposit.
    ///
    /// Control tokens, loops and markup are always defects. A watermark is
    /// noise rather than corruption: worth reporting, not worth refusing a
    /// batch over.
    #[must_use]
    pub const fn is_blocking(&self) -> bool {
        !matches!(self, Self::Watermark { .. })
    }
}

/// One page's findings.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PageFindings {
    /// The image the transcription came from.
    pub image: PathBuf,
    /// What was found.
    pub findings: Vec<Finding>,
}

/// The result of auditing a batch.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct AuditReport {
    /// Pages carrying text that were examined.
    pub examined: usize,
    /// Pages reported as having no text.
    pub textless: usize,
    /// Pages with at least one finding.
    pub flagged: Vec<PageFindings>,
}

impl AuditReport {
    /// Whether anything blocking was found.
    #[must_use]
    pub fn has_blocking(&self) -> bool {
        self.flagged
            .iter()
            .any(|p| p.findings.iter().any(Finding::is_blocking))
    }

    /// Total findings across every page.
    #[must_use]
    pub fn finding_count(&self) -> usize {
        self.flagged.iter().map(|p| p.findings.len()).sum()
    }
}

/// Examine one transcription.
///
/// Returns every defect found, in a stable order so a report does not churn
/// between runs over the same input.
#[must_use]
pub fn audit_text(text: &str) -> Vec<Finding> {
    let mut findings = Vec::new();

    for token in ["<|endofassistant|>", "<|im_end|>", "<|end|>", "<|eot_id|>"] {
        if text.contains(token) {
            findings.push(Finding::ControlToken {
                token: token.to_owned(),
            });
        }
    }

    // `longest_run` already applies its own threshold per segment length —
    // repeating it here would either double-gate the multi-character case
    // (rejecting a genuine 3-4x loop that already cleared the real bar) or do
    // nothing for the single-character case (whose bar is 40, well past 5).
    if let Some((word, repeats)) = longest_run(text) {
        findings.push(Finding::Loop { word, repeats });
    }

    if let Some(sample) = markup_sample(text) {
        findings.push(Finding::Markup { sample });
    }

    if let Some(sample) = foreign_script_sample(text) {
        findings.push(Finding::ForeignScript { sample });
    }

    for line in text.lines() {
        let trimmed = line.trim();
        if crate::doctags::strip_watermarks(trimmed).is_empty() && !trimmed.is_empty() {
            findings.push(Finding::Watermark {
                line: trimmed.to_owned(),
            });
        }
    }

    findings
}

/// Audit a whole batch of `(image, text)` pairs.
///
/// `None` text means the page was reported textless, which is a verdict rather
/// than a defect and is only counted.
pub fn audit_batch<'a>(pages: impl IntoIterator<Item = (PathBuf, Option<&'a str>)>) -> AuditReport {
    let mut report = AuditReport::default();
    for (image, text) in pages {
        let Some(text) = text else {
            report.textless += 1;
            continue;
        };
        report.examined += 1;
        let findings = audit_text(text);
        if !findings.is_empty() {
            report.flagged.push(PageFindings { image, findings });
        }
    }
    report
}

/// The longest run of one repeated segment, and its repeat count.
///
/// Whitespace does not separate words in Japanese or Chinese, so a detector
/// that only compares whitespace-delimited tokens is blind to exactly the
/// failure this corpus produces most: `可…可…可…可…` (measured on a live
/// deposit) is one unbroken run with no spaces at all, and a stuck generation
/// on CJK text always looks like this, never like repeated Latin words.
///
/// This instead scans at the character level, mirroring an external reference's
/// `BOUCLE` rule exactly, floor included: a segment of 4 to 40 characters,
/// containing at least two distinct characters, repeated three times or more.
/// The floor of 4 is not arbitrary — a 2- or 3-character floor was tried
/// first and found two false positives on real Traditional Chinese prose in
/// this same corpus: `非常非常非常` ("very very very", emphatic tripling, a
/// normal Chinese intensifier) and a vertical "我我我" shout in a stylised
/// panel layout. the reference's comment on `BOUCLE` explains the same
/// reasoning; this rule adopts its already-tuned floor rather than
/// re-discovering it by trial. A single character repeated at length is
/// handled separately and needs a much longer run before it counts —
/// `★★★★★★★★` is a rating widget, `　　　　　　` is a form's answer
/// boxes, and neither is a defect.
fn longest_run(text: &str) -> Option<(String, usize)> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    // (segment, repeats, total span) — span picks the winner when several
    // segments qualify, so the finding reported is the one that actually
    // dominates the text rather than the first one scanned.
    let mut best: Option<(String, usize, usize)> = None;
    let mut consider = |segment: &[char], repeats: usize| {
        let span = segment.len() * repeats;
        if best
            .as_ref()
            .is_none_or(|(_, _, best_span)| span > *best_span)
        {
            best = Some((segment.iter().collect(), repeats, span));
        }
    };

    // Length 1 (the monosigne case, threshold 40) plus 4..=40 (the multi-sign
    // case, threshold 3) — lengths 2 and 3 are deliberately absent, see above.
    let lengths = std::iter::once(1).chain(4..=40.min(n));
    for len in lengths {
        let mut start = 0;
        while start + len <= n {
            let segment = &chars[start..start + len];
            let mut repeats = 1;
            let mut next = start + len;
            while next + len <= n && chars[next..next + len] == *segment {
                repeats += 1;
                next += len;
            }
            let distinct = segment
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len();
            let threshold = if len == 1 { 40 } else { 3 };
            if repeats >= threshold && (len == 1 || distinct >= 2) {
                consider(segment, repeats);
            }
            // Skip past this run entirely rather than re-scanning inside it:
            // a run of `repeats` copies contains no *longer* run of the same
            // period starting one character later.
            start = if repeats > 1 { next } else { start + 1 };
        }
    }
    best.map(|(segment, repeats, _)| (segment, repeats))
}

/// Whether `c` belongs to a script that has no business in this corpus.
///
/// Same ranges as the reference `ETRANGER` regex: Cyrillic, Arabic, Thai,
/// Hangul. Deliberately narrow — Latin (credits, ISBNs) and every CJK range
/// are never flagged, so an actually multilingual page is untouched.
fn is_foreign_script(c: char) -> bool {
    matches!(c,
        '\u{0400}'..='\u{04FF}'   // Cyrillic
        | '\u{0600}'..='\u{06FF}' // Arabic
        | '\u{0E00}'..='\u{0E7F}' // Thai
        | '\u{AC00}'..='\u{D7A3}' // Hangul syllables
    )
}

/// A short sample around the first foreign-script character, if the text
/// otherwise carries CJK content.
///
/// The check only fires alongside CJK: a page legitimately written in one of
/// these scripts (none appear in this corpus today, but the rule should not
/// assume that stays true forever) is not itself the defect — a *fragment* of
/// one, embedded in Japanese or Chinese prose, is.
fn foreign_script_sample(text: &str) -> Option<String> {
    let has_cjk = text.chars().any(|c| {
        matches!(c,
            '\u{3040}'..='\u{30FF}'   // hiragana + katakana
            | '\u{4E00}'..='\u{9FFF}' // han
        )
    });
    if !has_cjk {
        return None;
    }
    let chars: Vec<char> = text.chars().collect();
    let index = chars.iter().position(|&c| is_foreign_script(c))?;
    let start = index.saturating_sub(8);
    let end = (index + 8).min(chars.len());
    Some(chars[start..end].iter().collect())
}

/// A sample of surviving markup, if any.
///
/// Looks for a complete `<tag>` rather than a bare `<`, so a legitimate
/// `5 < 10` in a transcription is not reported.
fn markup_sample(text: &str) -> Option<String> {
    let start = text.find('<')?;
    let rest = &text[start + 1..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    // A tag name has no spaces; `a < b > c` is arithmetic, not markup.
    if tag.is_empty() || tag.contains(char::is_whitespace) {
        return None;
    }
    // `<|endofassistant|>` is a chat control token and already has its own
    // finding; reporting it twice would double-count one defect.
    if tag.starts_with('|') {
        return None;
    }
    Some(format!("<{tag}>"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_japanese_text_raises_nothing() {
        // A real transcription from the databook corpus.
        let text =
            "宿敵ベジータが悟空を認める!\nブウと闘う悟空を見て、素直に悟空が上だと認めるベジータ。";
        assert!(audit_text(text).is_empty(), "{:?}", audit_text(text));
    }

    #[test]
    fn a_surviving_control_token_is_blocking() {
        let findings = audit_text("読めた<|endofassistant|>");
        assert_eq!(findings.len(), 1);
        assert!(findings[0].is_blocking());
        assert!(
            matches!(&findings[0], Finding::ControlToken { token } if token.contains("endofassistant"))
        );
    }

    #[test]
    fn a_stuck_generation_is_caught_with_its_word_and_count() {
        let findings = audit_text("bon début ふるさ ふるさ ふるさ ふるさ ふるさ ふるさ ふるさ");
        let loop_finding = findings
            .iter()
            .find(|f| matches!(f, Finding::Loop { .. }))
            .expect("no loop found");
        let Finding::Loop { word, repeats } = loop_finding else {
            unreachable!()
        };
        // The repeating unit is "ふるさ " (the trailing space belongs to the
        // repeated pattern too) — what matters is the word is in it and the
        // count clears any reasonable bar.
        assert!(word.contains("ふるさ"), "{word}");
        assert!(*repeats >= 6, "{repeats}");
        assert!(loop_finding.is_blocking());
    }

    #[test]
    fn a_cjk_loop_with_no_whitespace_is_caught() {
        // Measured on a live deposit: dots.ocr got stuck on a single ideogram
        // separated by ellipses, with no spaces anywhere — the exact shape a
        // whitespace-based detector cannot see. The real deposit repeated
        // "可…" roughly 930 times; a smaller multiple here is enough to prove
        // the shape is caught without tying the assertion to exactly how the
        // 2-character unit gets grouped into a >=4-character segment.
        let text = "可…".repeat(50);
        let findings = audit_text(&text);
        let loop_finding = findings
            .iter()
            .find(|f| matches!(f, Finding::Loop { .. }))
            .expect("no loop found");
        let Finding::Loop { word, repeats } = loop_finding else {
            unreachable!()
        };
        assert!(word.contains('可'), "{word}");
        // Whatever segment length won, it must cover most of the 100-char
        // input — a real stuck generation, not a short coincidental echo.
        assert!(word.chars().count() * *repeats >= 80, "{word:?} x{repeats}");
        assert!(loop_finding.is_blocking());
    }

    #[test]
    fn a_long_run_of_form_boxes_is_not_a_loop() {
        // Answer-sheet boxes and rating stars are layout, not corruption —
        // the reference BOUCLE rule carries the same exemption.
        let boxes = "　".repeat(30);
        assert!(
            !audit_text(&boxes)
                .iter()
                .any(|f| matches!(f, Finding::Loop { .. }))
        );
        let stars = "★".repeat(30);
        assert!(
            !audit_text(&stars)
                .iter()
                .any(|f| matches!(f, Finding::Loop { .. }))
        );
    }

    #[test]
    fn emphatic_chinese_tripling_is_not_a_loop() {
        // Measured on a live deposit, flagged by an earlier, looser version of
        // this rule: "我已經變得非常非常非常厲害了" ("I have become very
        // very very strong") is a normal Chinese intensifier, not a stuck
        // generation.
        assert!(
            !audit_text("我已經變得非常非常非常厲害了!!!")
                .iter()
                .any(|f| matches!(f, Finding::Loop { .. }))
        );
    }

    #[test]
    fn a_vertical_shout_of_three_is_not_a_loop() {
        // Measured on a live deposit: a stylised panel layout, one character
        // per line, ending in a triple "我我我" shout — genuine content, not
        // a model stuck on one glyph.
        assert!(
            !audit_text("我\n「\n贏\n了\n...\n我\n贏\n了\n!!!」\n我\n我\n我")
                .iter()
                .any(|f| matches!(f, Finding::Loop { .. }))
        );
    }

    #[test]
    fn a_very_long_single_character_run_is_still_a_loop() {
        let text = "あ".repeat(50);
        assert!(
            audit_text(&text)
                .iter()
                .any(|f| matches!(f, Finding::Loop { .. }))
        );
    }

    #[test]
    fn ordinary_repetition_is_not_a_loop() {
        // A table with a repeated value is normal text.
        let text = "Nom Goku Nom Vegeta Nom Piccolo Nom Krilin Nom Yamcha Nom Tenshinhan";
        assert!(
            !audit_text(text)
                .iter()
                .any(|f| matches!(f, Finding::Loop { .. }))
        );
    }

    #[test]
    fn surviving_markup_is_reported() {
        let findings = audit_text("<td>cellule</td>");
        assert!(
            findings.iter().any(|f| matches!(f, Finding::Markup { .. })),
            "{findings:?}"
        );
    }

    #[test]
    fn arithmetic_is_not_markup() {
        // `5 < 10 > 3` must not be read as a tag.
        assert!(
            !audit_text("5 < 10 > 3 toujours")
                .iter()
                .any(|f| matches!(f, Finding::Markup { .. }))
        );
    }

    #[test]
    fn a_watermark_is_reported_but_does_not_block() {
        let findings = audit_text("宿敵\ncapsulecommentary.com");
        let watermark = findings
            .iter()
            .find(|f| matches!(f, Finding::Watermark { .. }))
            .expect("watermark not found");
        // Noise, not corruption: worth saying, not worth refusing a batch for.
        assert!(!watermark.is_blocking());
    }

    #[test]
    fn a_cyrillic_fragment_mid_japanese_is_caught() {
        // Measured on a live deposit: dots.ocr inserted a Cyrillic verb
        // ending into an otherwise correct, long Japanese interview
        // transcription — "会社を辞めатьすることがなく" ("without quitting
        // the company"), where "ать" is a Russian infinitive suffix that has
        // no reading in Japanese at all.
        let findings = audit_text("会社を辞めатьすることがなく、応募してみたんです。");
        let finding = findings
            .iter()
            .find(|f| matches!(f, Finding::ForeignScript { .. }))
            .expect("no foreign script found");
        assert!(finding.is_blocking());
    }

    #[test]
    fn an_arabic_fragment_mid_japanese_is_caught() {
        let findings = audit_text("ふふわふすすいすماん まん と満足度120%超大作");
        assert!(
            findings
                .iter()
                .any(|f| matches!(f, Finding::ForeignScript { .. }))
        );
    }

    #[test]
    fn pure_latin_credits_are_not_foreign_script() {
        // ISBNs, romanised names, English series titles: normal content that
        // must never trip this rule, and it never sees CJK to trigger on
        // anyway.
        assert!(
            !audit_text("DRAGON BALL Z © Akira Toriyama / Shueisha")
                .iter()
                .any(|f| matches!(f, Finding::ForeignScript { .. }))
        );
    }

    #[test]
    fn traditional_chinese_alone_is_not_foreign_script() {
        // Dragon Ball Landmark/Forever are genuinely Traditional Chinese
        // editions — Han characters are never flagged by this rule (unlike
        // a separate, narrower `han-sans-kana` heuristic).
        assert!(
            !audit_text(
                "狂怒的菲利殘殺無限！聽到無限的最後叫喊，悟空體內沉睡的超級撒亞人之血覺醒了。"
            )
            .iter()
            .any(|f| matches!(f, Finding::ForeignScript { .. }))
        );
    }

    #[test]
    fn a_batch_separates_textless_pages_from_defects() {
        let report = audit_batch(vec![
            (PathBuf::from("a.jpg"), Some("texte propre")),
            (PathBuf::from("b.jpg"), None),
            (PathBuf::from("c.jpg"), Some("cassé<|im_end|>")),
        ]);
        assert_eq!(report.examined, 2);
        assert_eq!(report.textless, 1);
        assert_eq!(report.flagged.len(), 1);
        assert_eq!(report.flagged[0].image, PathBuf::from("c.jpg"));
        assert!(report.has_blocking());
        assert_eq!(report.finding_count(), 1);
    }

    #[test]
    fn a_clean_batch_has_nothing_blocking() {
        let report = audit_batch(vec![
            (PathBuf::from("a.jpg"), Some("DRAGON BALL 大全集")),
            (PathBuf::from("b.jpg"), None),
        ]);
        assert!(!report.has_blocking());
        assert_eq!(report.finding_count(), 0);
        assert!(report.flagged.is_empty());
    }

    #[test]
    fn an_empty_batch_audits_cleanly() {
        let report = audit_batch(Vec::new());
        assert_eq!(report.examined, 0);
        assert!(!report.has_blocking());
    }
}
