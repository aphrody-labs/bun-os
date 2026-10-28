// SPDX-License-Identifier: Apache-2.0
//! Intelligent GitHub search and documentation extraction engine.
//!
//! Searches repositories via GitHub API, probes for prompt-ready `llms.txt`
//! specifications, extracts READMEs, and optionally executes GitIngest on
//! documentation subpaths to yield complete prompt-ready LLM context.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    ApiMethod, Error, GitHubClient,
    ingest::{IngestOptions, IngestResult, ingest_remote},
};

/// Summary of a GitHub repository returned by search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoSearchResult {
    pub name: String,
    pub full_name: String,
    pub owner: String,
    pub html_url: String,
    pub description: Option<String>,
    pub stars: u64,
    pub language: Option<String>,
    pub topics: Vec<String>,
    pub default_branch: String,
}

/// Extracted documentation for a GitHub repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepoDoc {
    pub full_name: String,
    pub html_url: String,
    pub description: Option<String>,
    pub stars: u64,
    pub language: Option<String>,
    pub default_branch: String,
    pub has_llms_txt: bool,
    pub llms_txt: Option<String>,
    pub readme_excerpt: Option<String>,
    pub digest: Option<IngestResult>,
}

/// Fused documentation report aggregating intelligent GitHub search results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubDocsReport {
    pub query: String,
    pub repositories: Vec<GitHubRepoDoc>,
    pub formatted_markdown: String,
}

impl GitHubDocsReport {
    pub fn to_markdown(&self) -> &str {
        &self.formatted_markdown
    }
}

impl GitHubClient {
    /// Search public GitHub repositories ordered by popularity/relevance.
    pub async fn search_repositories(
        &self,
        query: &str,
        limit: u8,
    ) -> Result<Vec<RepoSearchResult>, Error> {
        let encoded_query: String =
            url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
        let limit = limit.clamp(1, 30);
        let route = format!(
            "/search/repositories?q={encoded_query}&sort=stars&order=desc&per_page={limit}"
        );

        let resp = self.request(ApiMethod::Get, &route, None).await?;
        let items =
            resp.body.get("items").and_then(Value::as_array).ok_or_else(|| {
                Error::Git("missing items array in GitHub search response".into())
            })?;

        let mut results = Vec::new();
        for item in items {
            let name = item.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let full_name = item.get("full_name").and_then(Value::as_str).unwrap_or("").to_string();
            let owner =
                item.pointer("/owner/login").and_then(Value::as_str).unwrap_or("").to_string();
            let html_url = item.get("html_url").and_then(Value::as_str).unwrap_or("").to_string();
            let description = item.get("description").and_then(Value::as_str).map(str::to_string);
            let stars = item.get("stargazers_count").and_then(Value::as_u64).unwrap_or(0);
            let language = item.get("language").and_then(Value::as_str).map(str::to_string);
            let topics: Vec<String> = item
                .get("topics")
                .and_then(Value::as_array)
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            let default_branch =
                item.get("default_branch").and_then(Value::as_str).unwrap_or("main").to_string();

            if !name.is_empty() && !full_name.is_empty() {
                results.push(RepoSearchResult {
                    name,
                    full_name,
                    owner,
                    html_url,
                    description,
                    stars,
                    language,
                    topics,
                    default_branch,
                });
            }
        }

        Ok(results)
    }

    /// Fetch raw file content using GitHub Contents API (decoding base64 content).
    pub async fn fetch_raw_file(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        path: &str,
    ) -> Result<String, Error> {
        let route = format!("/repos/{owner}/{repo}/contents/{path}?ref={branch}");
        let resp = self.request(ApiMethod::Get, &route, None).await?;
        if let Some(content_b64) = resp.body.get("content").and_then(Value::as_str) {
            let clean = content_b64.replace(['\n', '\r'], "");
            let decoded =
                base64::engine::general_purpose::STANDARD.decode(clean.as_bytes()).map_err(
                    |e| Error::Git(format!("base64 decode failed for {owner}/{repo}/{path}: {e}")),
                )?;
            return Ok(String::from_utf8_lossy(&decoded).to_string());
        }
        Err(Error::Git(format!("no content field found for {owner}/{repo}/{path}")))
    }

    /// Search GitHub repositories, probe for `llms.txt` and documentation, and generate a prompt-ready markdown report.
    pub async fn search_github_docs(
        &self,
        query: &str,
        limit: u8,
        include_digest: bool,
    ) -> Result<GitHubDocsReport, Error> {
        let repos = self.search_repositories(query, limit).await?;
        let mut repo_docs = Vec::new();
        let mut markdown = format!("# GitHub Documentation Search — `{query}`\n\n");

        if repos.is_empty() {
            markdown.push_str("No repositories found matching query.\n");
            return Ok(GitHubDocsReport {
                query: query.to_string(),
                repositories: Vec::new(),
                formatted_markdown: markdown,
            });
        }

        for (idx, repo) in repos.iter().enumerate() {
            let mut has_llms_txt = false;
            let mut llms_txt = None;
            let mut readme_excerpt = None;

            // Probe for llms.txt at root or .github/llms.txt
            if let Ok(content) =
                self.fetch_raw_file(&repo.owner, &repo.name, &repo.default_branch, "llms.txt").await
            {
                has_llms_txt = true;
                llms_txt = Some(content);
            } else if let Ok(content) = self
                .fetch_raw_file(&repo.owner, &repo.name, &repo.default_branch, ".github/llms.txt")
                .await
            {
                has_llms_txt = true;
                llms_txt = Some(content);
            }

            // Probe for README.md if llms.txt is absent
            if llms_txt.is_none()
                && let Ok(content) = self
                    .fetch_raw_file(&repo.owner, &repo.name, &repo.default_branch, "README.md")
                    .await
            {
                let lines: Vec<&str> = content.lines().take(60).collect();
                readme_excerpt = Some(lines.join("\n"));
            }

            // Optionally run GitIngest focused on docs or headers if requested on the top repository
            let digest = if include_digest && idx == 0 {
                let options = IngestOptions {
                    max_file_size: 512 * 1024,
                    include_patterns: vec!["*.md".into(), "docs/*".into(), "doc/*".into()],
                    exclude_patterns: vec!["tests/*".into(), "test/*".into()],
                    branch: Some(repo.default_branch.clone()),
                    ..Default::default()
                };
                ingest_remote(&repo.html_url, &options).ok()
            } else {
                None
            };

            markdown.push_str(&format!(
                "### {}. [{}]({}) ⭐ {}\n",
                idx + 1,
                repo.full_name,
                repo.html_url,
                repo.stars
            ));

            if let Some(ref desc) = repo.description {
                markdown.push_str(&format!("*{desc}*\n\n"));
            }

            if let Some(ref lang) = repo.language {
                markdown.push_str(&format!(
                    "**Language:** `{lang}` | **Branch:** `{}`\n\n",
                    repo.default_branch
                ));
            }

            if let Some(ref l_txt) = llms_txt {
                markdown.push_str("#### 🤖 Official `llms.txt`\n\n```text\n");
                let snippet = if l_txt.len() > 3000 {
                    format!("{}...\n[truncated]", &l_txt[..3000])
                } else {
                    l_txt.clone()
                };
                markdown.push_str(&snippet);
                markdown.push_str("\n```\n\n");
            } else if let Some(ref r_text) = readme_excerpt {
                markdown.push_str("#### 📖 README Excerpt\n\n");
                markdown.push_str(r_text);
                markdown.push_str("\n\n");
            }

            if let Some(ref dig) = digest {
                markdown.push_str("#### 📦 GitIngest Documentation Digest\n\n");
                markdown.push_str(&format!(
                    "*Files analyzed: {} | Estimated tokens: {}*\n\n",
                    dig.file_count, dig.formatted_tokens
                ));
                markdown.push_str("```text\n");
                let snippet = if dig.content.len() > 4000 {
                    format!("{}...\n[truncated]", &dig.content[..4000])
                } else {
                    dig.content.clone()
                };
                markdown.push_str(&snippet);
                markdown.push_str("\n```\n\n");
            }

            repo_docs.push(GitHubRepoDoc {
                full_name: repo.full_name.clone(),
                html_url: repo.html_url.clone(),
                description: repo.description.clone(),
                stars: repo.stars,
                language: repo.language.clone(),
                default_branch: repo.default_branch.clone(),
                has_llms_txt,
                llms_txt,
                readme_excerpt,
                digest,
            });
        }

        Ok(GitHubDocsReport {
            query: query.to_string(),
            repositories: repo_docs,
            formatted_markdown: markdown,
        })
    }
}

/// Convenience function to search GitHub documentation using default or environment credentials.
pub async fn search_github_docs(
    query: &str,
    limit: usize,
    include_digest: bool,
) -> Result<GitHubDocsReport, Error> {
    let client = GitHubClient::from_env()?;
    client.search_github_docs(query, limit.min(10) as u8, include_digest).await
}

/// Convenience function to search GitHub repositories using default or environment credentials.
pub async fn search_repositories(
    query: &str,
    limit: usize,
) -> Result<Vec<RepoSearchResult>, Error> {
    let client = GitHubClient::from_env()?;
    client.search_repositories(query, limit.min(10) as u8).await
}
