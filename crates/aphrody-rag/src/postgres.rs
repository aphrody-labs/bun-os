// SPDX-License-Identifier: Apache-2.0

//! PostgreSQL ingestion for web documents consumed from Aphrody OS.
//! The public AI HTTP RAG query reads this same `aphrody_rag_documents` table.

use std::time::Duration;

use aphrody_sql::pg::Client;
use serde::Serialize;
use serde_json::{Value, json};

const DB_TIMEOUT: Duration = Duration::from_secs(5);
const CORPUS: &str = "bxc_crawl";
const MAX_CONTENT_BYTES: usize = 512 * 1024;
const METADATA: &str = r#"{"source":"aphrody-web","retrieval":"lexical"}"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgWebIngestResult {
    pub document_id: String,
    pub corpus: &'static str,
    pub created: bool,
    pub unchanged: bool,
    pub retrieval: &'static str,
}

fn document_title(markdown: &str, url: &str) -> String {
    markdown
        .lines()
        .find_map(|line| {
            let title = line.trim().strip_prefix("# ")?.trim();
            (!title.is_empty()).then(|| title.chars().take(1024).collect())
        })
        .unwrap_or_else(|| url.to_owned())
}

/// Checks a connection out of the process-wide `aphrody-sql` pool for `database_url`
/// (TLS for non-loopback hosts, recycled connections verified before reuse).
async fn connect(database_url: &str) -> Result<Client, &'static str> {
    let pool = aphrody_sql::shared_pool(database_url).map_err(|_| "RAG PostgreSQL unavailable")?;
    tokio::time::timeout(DB_TIMEOUT, pool.get())
        .await
        .map_err(|_| "RAG PostgreSQL unavailable")?
        .map_err(|_| "RAG PostgreSQL unavailable")
}

/// Idempotently writes an OS-scraped page into the AI PostgreSQL RAG corpus.
///
/// This path is explicitly lexical. No synthetic vector is stored in
/// `aphrody_rag_chunks`; semantic indexing requires a configured real model
/// and a separately verified chunk schema.
pub async fn ingest_web_document(
    database_url: &str,
    url: &str,
    markdown: &str,
    force: bool,
) -> Result<PgWebIngestResult, &'static str> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "invalid web document URL")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("invalid web document URL");
    }
    if markdown.trim().is_empty() || markdown.len() > MAX_CONTENT_BYTES || url.len() > 2048 {
        return Err("invalid web document content");
    }
    let title = document_title(markdown, url);
    let mut client = connect(database_url).await?;

    let operation = async {
        let tx = client.transaction().await?;
        let lock_key = format!("{CORPUS}:{url}");
        tx.query_one("SELECT pg_advisory_xact_lock(hashtext($1))", &[&lock_key])
            .await?;
        let existing = tx
            .query_opt(
                "SELECT id::text, content::text FROM aphrody_rag_documents WHERE corpus = \
                 'bxc_crawl' AND entity_id = $1 ORDER BY updated_at DESC LIMIT 1 FOR UPDATE",
                &[&url],
            )
            .await?;
        let (id, created, unchanged) = if let Some(row) = existing {
            let id: String = row.get(0);
            let old_content: String = row.get(1);
            if old_content == markdown && !force {
                (id, false, true)
            } else {
                tx.execute(
                    "UPDATE aphrody_rag_documents SET title = $2, url = $3, content = $4, \
                     metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb, updated_at = now() \
                     WHERE id = $1::uuid",
                    &[&id, &title, &url, &markdown, &METADATA],
                )
                .await?;
                (id, false, false)
            }
        } else {
            let row = tx
                .query_one(
                    "INSERT INTO aphrody_rag_documents (corpus, entity_id, title, url, content, \
                     metadata) VALUES ('bxc_crawl', $1, $2, $3, $4, $5::jsonb) RETURNING id::text",
                    &[&url, &title, &url, &markdown, &METADATA],
                )
                .await?;
            (row.get::<_, String>(0), true, false)
        };
        tx.commit().await?;
        Ok::<_, tokio_postgres::Error>((id, created, unchanged))
    };
    let (document_id, created, unchanged) = tokio::time::timeout(DB_TIMEOUT, operation)
        .await
        .map_err(|_| "RAG PostgreSQL unavailable")?
        .map_err(|_| "RAG PostgreSQL unavailable")?;
    Ok(PgWebIngestResult {
        document_id,
        corpus: CORPUS,
        created,
        unchanged,
        retrieval: "lexical",
    })
}

/// Runs the same lexical document query as the public AI HTTP RAG endpoint.
pub async fn search_documents(
    database_url: &str,
    query: &str,
    limit: usize,
) -> Result<Value, &'static str> {
    if query.trim().is_empty() || !(1..=100).contains(&limit) {
        return Err("invalid RAG query or limit");
    }
    let client = connect(database_url).await?;
    let pattern = format!("%{}%", query.trim().to_lowercase());
    let row_limit = limit as i64;
    let rows = tokio::time::timeout(
        DB_TIMEOUT,
        client.query(
            "SELECT title::text, url::text, corpus::text, content::text FROM \
             aphrody_rag_documents WHERE title ILIKE $1 OR content ILIKE $1 LIMIT $2",
            &[&pattern, &row_limit],
        ),
    )
    .await
    .map_err(|_| "RAG PostgreSQL unavailable")?
    .map_err(|_| "RAG PostgreSQL unavailable")?;
    let results = rows
        .iter()
        .map(|row| {
            let content = row
                .try_get::<_, Option<String>>(3)
                .ok()
                .flatten()
                .unwrap_or_default();
            let mut chars = content.chars();
            let snippet = chars.by_ref().take(180).collect::<String>();
            let snippet = if chars.next().is_some() {
                format!("{snippet}...")
            } else {
                snippet
            };
            json!({
                "title": row.try_get::<_, Option<String>>(0).ok().flatten(),
                "url": row.try_get::<_, Option<String>>(1).ok().flatten(),
                "corpus": row.try_get::<_, Option<String>>(2).ok().flatten(),
                "snippet": snippet,
                "match": "keyword"
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "query": query,
        "total_matches": results.len(),
        "limit": limit,
        "source": "postgresql_rag",
        "status": "ok",
        "results": results
    }))
}

/// Reads the same document and chunk counts as the public AI HTTP endpoint.
pub async fn stats(database_url: &str) -> Result<Value, &'static str> {
    let client = connect(database_url).await?;
    let (documents, chunks) = tokio::time::timeout(DB_TIMEOUT, async {
        let documents = client
            .query_one("SELECT count(*) FROM aphrody_rag_documents", &[])
            .await?;
        let chunks = client
            .query_one("SELECT count(*) FROM aphrody_rag_chunks", &[])
            .await?;
        Ok::<_, tokio_postgres::Error>((documents.get::<_, i64>(0), chunks.get::<_, i64>(0)))
    })
    .await
    .map_err(|_| "RAG PostgreSQL unavailable")?
    .map_err(|_| "RAG PostgreSQL unavailable")?;
    Ok(json!({
        "status": "active",
        "total_documents_indexed": documents,
        "total_vector_chunks": chunks,
        "vector_dimensions": null,
        "vector_index": null,
        "database": "PostgreSQL",
        "cache": null,
        "corpora": null
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_comes_from_real_markdown_or_url() {
        assert_eq!(
            document_title("intro\n# Actual title\nbody", "https://example.com"),
            "Actual title"
        );
        assert_eq!(
            document_title("plain body", "https://example.com"),
            "https://example.com"
        );
    }

    #[tokio::test]
    async fn invalid_input_never_connects_to_postgres() {
        assert_eq!(
            ingest_web_document("", "file:///tmp/a", "content", false)
                .await
                .unwrap_err(),
            "invalid web document URL"
        );
        assert_eq!(
            ingest_web_document("", "https://example.com", " ", false)
                .await
                .unwrap_err(),
            "invalid web document content"
        );
    }
}
