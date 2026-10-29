// SPDX-License-Identifier: Apache-2.0
//! The five operations an application runs on its local memory file, over any
//! [`MemoryProvider`] (in practice [`crate::SqliteLocalProvider`] on a file the
//! application owns): write, recall, list, delete, clear.
//!
//! They back `aphrody memory write|recall|list|delete|clear --db <file>
//! --agent-id <id>`, the JSON surface a Bun or Tauri host drives.
//!
//! Recall is lexical: the query is split into words (lower-cased, Unicode
//! aware, CJK characters taken one by one), each record scores the share of
//! query words it contains, and records sharing none are dropped. It needs no
//! embedding model, which a freshly installed desktop app may not have yet.

use std::collections::HashSet;

use serde::Serialize;

use crate::{
    provider::MemoryProvider,
    types::{MemoryError, MemoryQuery, MemoryRecord},
};

/// Default number of records returned by [`recall`] and [`list`].
pub const DEFAULT_LIMIT: u32 = 20;

/// A recalled record and how well it matched.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Recalled {
    /// The record.
    #[serde(flatten)]
    pub record: MemoryRecord,
    /// Share of the query words found in the record, in `0.0..=1.0`.
    pub score: f32,
}

/// Store one memory and return its id. An empty `id` gets a fresh UUID; an
/// existing id is replaced (an edit).
///
/// # Errors
///
/// [`MemoryError::Unexpected`] for an empty content or agent id; storage
/// errors propagate.
pub async fn write(
    provider: &dyn MemoryProvider,
    agent_id: &str,
    content: &str,
    tags: Vec<String>,
    metadata: Option<serde_json::Value>,
    id: Option<String>,
) -> Result<String, MemoryError> {
    require(agent_id, "agent id")?;
    require(content, "content")?;
    let mut record =
        MemoryRecord::new(id.unwrap_or_default(), agent_id, content.trim()).with_tags(tags);
    if let Some(metadata) = metadata {
        record = record.with_metadata(metadata);
    }
    provider.add(record).await
}

/// The records of `agent_id` that best match `query`, best first (newest
/// first among equals).
///
/// # Errors
///
/// Storage errors propagate.
pub async fn recall(
    provider: &dyn MemoryProvider,
    agent_id: &str,
    query: &str,
    tags: Vec<String>,
    limit: Option<u32>,
) -> Result<Vec<Recalled>, MemoryError> {
    require(agent_id, "agent id")?;
    let wanted = words(query);
    let records = provider
        .search(MemoryQuery {
            agent_id: agent_id.to_owned(),
            q: None,
            tags,
            limit: None,
        })
        .await?;
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let mut scored: Vec<Recalled> = records
        .into_iter()
        .filter_map(|record| {
            let have = words(&record.content);
            let hits = wanted.iter().filter(|word| have.contains(*word)).count();
            #[allow(clippy::cast_precision_loss)]
            let score = hits as f32 / wanted.len() as f32;
            (hits > 0).then_some(Recalled { record, score })
        })
        .collect();
    scored.sort_by(|a, b| {
        b.score.total_cmp(&a.score).then(
            b.record
                .created_at_unix_ms
                .cmp(&a.record.created_at_unix_ms),
        )
    });
    scored.truncate(limit.unwrap_or(DEFAULT_LIMIT) as usize);
    Ok(scored)
}

/// The records of `agent_id`, newest first.
///
/// # Errors
///
/// Storage errors propagate.
pub async fn list(
    provider: &dyn MemoryProvider,
    agent_id: &str,
    tags: Vec<String>,
    limit: Option<u32>,
) -> Result<Vec<MemoryRecord>, MemoryError> {
    require(agent_id, "agent id")?;
    provider
        .search(MemoryQuery {
            agent_id: agent_id.to_owned(),
            q: None,
            tags,
            limit: Some(limit.unwrap_or(DEFAULT_LIMIT)),
        })
        .await
}

/// Delete one record. With `agent_id`, a record owned by another agent is left
/// alone. Returns whether a record was deleted.
///
/// # Errors
///
/// Storage errors propagate.
pub async fn delete(
    provider: &dyn MemoryProvider,
    id: &str,
    agent_id: Option<&str>,
) -> Result<bool, MemoryError> {
    require(id, "id")?;
    let Some(record) = provider.get(id).await? else {
        return Ok(false);
    };
    if agent_id.is_some_and(|agent| agent != record.agent_id) {
        return Ok(false);
    }
    provider.delete(id).await?;
    Ok(true)
}

/// Delete every record of `agent_id`; returns how many were deleted.
///
/// # Errors
///
/// Storage errors propagate.
pub async fn clear(provider: &dyn MemoryProvider, agent_id: &str) -> Result<usize, MemoryError> {
    require(agent_id, "agent id")?;
    let records = provider.search(MemoryQuery::for_agent(agent_id)).await?;
    for record in &records {
        provider.delete(&record.id).await?;
    }
    Ok(records.len())
}

fn require(value: &str, what: &str) -> Result<(), MemoryError> {
    if value.trim().is_empty() {
        return Err(MemoryError::Unexpected(format!("{what} must not be empty")));
    }
    Ok(())
}

/// Lower-cased words; CJK ideographs, kana and hangul count one character each
/// (those scripts do not separate words with spaces).
fn words(text: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut current = String::new();
    for ch in text.chars() {
        if is_cjk(ch) {
            if !current.is_empty() {
                out.insert(std::mem::take(&mut current));
            }
            out.insert(ch.to_string());
        } else if ch.is_alphanumeric() {
            current.extend(ch.to_lowercase());
        } else if !current.is_empty() {
            out.insert(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        out.insert(current);
    }
    out
}

const fn is_cjk(ch: char) -> bool {
    matches!(ch as u32,
        0x3040..=0x30FF   // hiragana, katakana
        | 0x3400..=0x4DBF // CJK extension A
        | 0x4E00..=0x9FFF // CJK unified ideographs
        | 0xAC00..=0xD7AF // hangul syllables
        | 0xF900..=0xFAFF // compatibility ideographs
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SqliteLocalProvider;

    #[tokio::test]
    async fn write_recall_list_delete_clear_round_trip() {
        let store = SqliteLocalProvider::open_in_memory().unwrap();
        let goku = write(
            &store,
            "a",
            "Goku aime les nikuman",
            vec!["pref".into()],
            None,
            None,
        )
        .await
        .unwrap();
        write(
            &store,
            "a",
            "L'utilisateur lit le databook Daizenshuu 7",
            vec![],
            None,
            None,
        )
        .await
        .unwrap();
        write(&store, "b", "Goku est un Saiyan", vec![], None, None)
            .await
            .unwrap();
        write(&store, "a", "孫悟空のファン", vec![], None, None)
            .await
            .unwrap();

        let hits = recall(&store, "a", "Que mange Goku ?", vec![], None)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].record.id, goku);
        assert!(hits[0].score > 0.0);

        let ja = recall(&store, "a", "悟空", vec![], None).await.unwrap();
        assert_eq!(ja.len(), 1);
        assert!((ja[0].score - 1.0).abs() < f32::EPSILON);

        assert!(
            recall(&store, "a", "  ", vec![], None)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(list(&store, "a", vec![], None).await.unwrap().len(), 3);
        assert_eq!(
            list(&store, "a", vec!["pref".into()], None)
                .await
                .unwrap()
                .len(),
            1
        );

        assert!(!delete(&store, &goku, Some("b")).await.unwrap());
        assert!(delete(&store, &goku, Some("a")).await.unwrap());
        assert!(!delete(&store, &goku, None).await.unwrap());

        assert_eq!(clear(&store, "a").await.unwrap(), 2);
        assert!(list(&store, "a", vec![], None).await.unwrap().is_empty());
        assert_eq!(list(&store, "b", vec![], None).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn writing_an_existing_id_replaces_it() {
        let store = SqliteLocalProvider::open_in_memory().unwrap();
        let id = write(&store, "a", "first", vec![], None, None)
            .await
            .unwrap();
        let same = write(
            &store,
            "a",
            "second",
            vec![],
            Some(serde_json::json!({"k": 1})),
            Some(id.clone()),
        )
        .await
        .unwrap();
        assert_eq!(id, same);
        let all = list(&store, "a", vec![], None).await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].content, "second");
        assert_eq!(all[0].metadata["k"], 1);
        assert!(write(&store, "a", "   ", vec![], None, None).await.is_err());
        assert!(write(&store, "", "x", vec![], None, None).await.is_err());
    }

    #[test]
    fn words_split_latin_and_cjk() {
        let w = words("Végéta, le Prince! ベジータ");
        assert!(w.contains("végéta") && w.contains("prince") && w.contains("ベ"));
    }
}
