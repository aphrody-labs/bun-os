// SPDX-License-Identifier: Apache-2.0
//! Complete async Awesome-list parsing, discovery, search, and digest engine.
//!
//! Models and parses canonical lists such as sindresorhus/awesome,
//! oven-sh/awesome-bun, rust-unofficial/awesome-rust, and tauri-apps/awesome-tauri.
//! Supports live GitHub fetching, category extraction, item search, repository
//! enrichment, and prompt-ready LLM digest generation.

use serde::{Deserialize, Serialize};

use crate::{Error, GitHubClient, GitHubRepository};

/// Known canonical Awesome repository presets.
pub const PRESETS: &[(&str, &str, &str, &str)] = &[
    (
        "awesome",
        "sindresorhus/awesome",
        "main",
        "Curated list of awesome lists (the canonical meta-index)",
    ),
    (
        "bun",
        "oven-sh/awesome-bun",
        "main",
        "Curated list of awesome things related to Bun runtime",
    ),
    (
        "rust",
        "rust-unofficial/awesome-rust",
        "main",
        "Curated list of Rust code and resources",
    ),
    (
        "tauri",
        "tauri-apps/awesome-tauri",
        "dev",
        "Curated list of awesome things related to Tauri framework",
    ),
    (
        "llm",
        "Hannibal046/Awesome-LLM",
        "main",
        "Curated list of Large Language Models, training, fine-tuning and evaluation",
    ),
    (
        "open-llms",
        "eugeneyan/open-llms",
        "main",
        "Curated list of open-source and commercially permissive LLMs",
    ),
    (
        "inference",
        "xlite-dev/Awesome-LLM-Inference",
        "main",
        "Curated list of LLM inference engines, optimizations, quantization, and serving",
    ),
    (
        "agents",
        "e2b-dev/awesome-ai-agents",
        "main",
        "Curated list of autonomous AI agents, tool frameworks, and sandboxes",
    ),
    (
        "coding",
        "jamesmurdza/awesome-ai-devtools",
        "main",
        "Curated list of AI-powered coding assistants, CLI agents, and development tools",
    ),
    (
        "mlops",
        "EthicalML/awesome-production-machine-learning",
        "master",
        "Curated list of open-source libraries for production ML, deployment, and serving",
    ),
    (
        "rust-ml",
        "e-tornike/best-of-ml-rust",
        "main",
        "Curated list of Rust machine learning, tensor runtimes, and deep learning",
    ),
];

/// A single item in an Awesome list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AwesomeItem {
    pub title: String,
    pub url: String,
    pub description: String,
    pub category: String,
    pub github_repo: Option<String>,
    pub has_llms_txt: Option<bool>,
    pub stars: Option<u64>,
}

/// A category in an Awesome list containing curated items.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwesomeCategory {
    pub name: String,
    pub items: Vec<AwesomeItem>,
}

/// An entire parsed Awesome list index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwesomeIndex {
    pub name: String,
    pub repository: String,
    pub categories: Vec<AwesomeCategory>,
    pub total_items: usize,
    pub raw_markdown_excerpt: Option<String>,
}

impl AwesomeIndex {
    /// Search items within this Awesome list by query string.
    pub fn search(&self, query: &str) -> Vec<AwesomeItem> {
        let q = query.to_lowercase();
        let mut matches = Vec::new();
        for cat in &self.categories {
            for item in &cat.items {
                if item.title.to_lowercase().contains(&q)
                    || item.description.to_lowercase().contains(&q)
                    || item.category.to_lowercase().contains(&q)
                    || item
                        .github_repo
                        .as_deref()
                        .map(|r| r.to_lowercase().contains(&q))
                        .unwrap_or(false)
                {
                    matches.push(item.clone());
                }
            }
        }
        matches
    }

    /// Renders a summary table or markdown report of the index.
    pub fn to_markdown(&self) -> String {
        let mut md = format!("# Awesome List: {}\n\n", self.name);
        md.push_str(&format!("**Repository**: `{}`\n", self.repository));
        md.push_str(&format!(
            "**Total categories**: {}\n",
            self.categories.len()
        ));
        md.push_str(&format!("**Total items**: {}\n\n", self.total_items));

        for cat in &self.categories {
            if cat.items.is_empty() {
                continue;
            }
            md.push_str(&format!("## {}\n\n", cat.name));
            for item in &cat.items {
                md.push_str(&format!("- [{}]({})", item.title, item.url));
                if !item.description.is_empty() {
                    md.push_str(&format!(" — {}", item.description));
                }
                if let Some(stars) = item.stars {
                    md.push_str(&format!(" (⭐ {stars})"));
                }
                if let Some(true) = item.has_llms_txt {
                    md.push_str(" `[llms.txt]`");
                }
                md.push('\n');
            }
            md.push('\n');
        }
        md
    }
}

/// Extracts a GitHub owner/repo from a URL if it points to github.com.
fn extract_github_repo(url: &str) -> Option<String> {
    let clean = url.trim();
    let path = if let Some(stripped) = clean.strip_prefix("https://github.com/") {
        stripped
    } else {
        clean.strip_prefix("http://github.com/")?
    };

    let without_hash = path.split('#').next().unwrap_or(path);
    let without_query = without_hash.split('?').next().unwrap_or(without_hash);
    let parts: Vec<&str> = without_query.split('/').filter(|s| !s.is_empty()).collect();

    if parts.len() >= 2 {
        let owner = parts[0];
        let repo = parts[1].trim_end_matches(".git");
        Some(format!("{owner}/{repo}"))
    } else {
        None
    }
}

/// Parses a single markdown list item line into title, url, description.
fn parse_list_item(line: &str) -> Option<(String, String, String)> {
    let trimmed = line.trim();
    let rest = if let Some(s) = trimmed.strip_prefix('-') {
        s.trim_start()
    } else {
        let s = trimmed.strip_prefix('*')?;
        s.trim_start()
    };

    let open_bracket = rest.find('[')?;
    let close_bracket = rest[open_bracket..].find("](")? + open_bracket;
    let paren_close = rest[close_bracket..].find(')')? + close_bracket;

    let title = rest[open_bracket + 1..close_bracket].trim().to_string();
    let url = rest[close_bracket + 2..paren_close].trim().to_string();

    let raw_desc = rest[paren_close + 1..].trim();
    let desc = raw_desc
        .trim_start_matches(['-', '—', ':', ' '])
        .trim()
        .trim_end_matches('.')
        .to_string();

    Some((title, url, desc))
}

/// Parse raw Awesome markdown text into a structured `AwesomeIndex`.
pub fn parse_awesome_markdown(name: &str, repository: &str, markdown: &str) -> AwesomeIndex {
    let mut categories: Vec<AwesomeCategory> = Vec::new();
    let mut current_category = "General".to_string();
    let mut current_items = Vec::new();

    for line in markdown.lines() {
        let trimmed = line.trim();

        // Check for headers (Categories)
        if trimmed.starts_with("## ") {
            let cat_name = trimmed.trim_start_matches("##").trim();
            let lower = cat_name.to_lowercase();
            if lower == "contents"
                || lower == "table of contents"
                || lower == "license"
                || lower == "contributing"
            {
                continue;
            }

            if !current_items.is_empty() {
                categories.push(AwesomeCategory {
                    name: current_category,
                    items: std::mem::take(&mut current_items),
                });
            }
            current_category = cat_name.to_string();
            continue;
        }

        if trimmed.starts_with("### ") {
            let sub_name = trimmed.trim_start_matches("###").trim();
            let lower = sub_name.to_lowercase();
            if lower == "contents" || lower == "contributing" {
                continue;
            }

            if !current_items.is_empty() {
                categories.push(AwesomeCategory {
                    name: current_category,
                    items: std::mem::take(&mut current_items),
                });
            }
            current_category = sub_name.to_string();
            continue;
        }

        // Check for list items
        if let Some((title, url, description)) = parse_list_item(line) {
            // Ignore internal anchor links like `#something`
            if url.starts_with('#') {
                continue;
            }

            let github_repo = extract_github_repo(&url);

            current_items.push(AwesomeItem {
                title,
                url,
                description,
                category: current_category.clone(),
                github_repo,
                has_llms_txt: None,
                stars: None,
            });
        }
    }

    if !current_items.is_empty() {
        categories.push(AwesomeCategory {
            name: current_category,
            items: current_items,
        });
    }

    let total_items = categories.iter().map(|c| c.items.len()).sum();

    AwesomeIndex {
        name: name.to_string(),
        repository: repository.to_string(),
        categories,
        total_items,
        raw_markdown_excerpt: Some(markdown.chars().take(500).collect()),
    }
}

/// Resolves a preset keyword (e.g. "bun", "rust", "tauri", "awesome") or an "owner/repo" specifier.
pub fn resolve_preset(preset_or_repo: &str) -> (String, String, String) {
    let lower = preset_or_repo.to_lowercase();
    for (name, repo, branch, _) in PRESETS {
        if *name == lower || *repo == lower {
            let parts: Vec<&str> = repo.split('/').collect();
            return (
                parts[0].to_string(),
                parts[1].to_string(),
                (*branch).to_string(),
            );
        }
    }

    if let Some((owner, repo)) = preset_or_repo.split_once('/') {
        (owner.to_string(), repo.to_string(), "main".to_string())
    } else {
        (
            preset_or_repo.to_string(),
            format!("awesome-{preset_or_repo}"),
            "main".to_string(),
        )
    }
}

impl GitHubClient {
    /// Fetch and parse an Awesome repository from GitHub asynchronously.
    pub async fn fetch_awesome_list(&self, preset_or_repo: &str) -> Result<AwesomeIndex, Error> {
        let (owner, repo, default_branch) = resolve_preset(preset_or_repo);

        // Try branches in order: specified branch, main, master, dev
        let branches = [default_branch.as_str(), "main", "master", "dev"];
        let filenames = ["README.md", "readme.md", "Readme.md"];

        let mut content = None;

        'outer: for branch in branches {
            for filename in filenames {
                if let Ok(raw) = self.fetch_raw_file(&owner, &repo, branch, filename).await {
                    content = Some(raw);
                    break 'outer;
                }
            }
        }

        let markdown = content.ok_or_else(|| {
            Error::Git(format!(
                "could not find README.md in repository {owner}/{repo} on common branches"
            ))
        })?;

        let repo_identifier = format!("{owner}/{repo}");
        let index = parse_awesome_markdown(&repo, &repo_identifier, &markdown);
        Ok(index)
    }

    /// Search across multiple canonical Awesome lists simultaneously.
    pub async fn search_awesome_ecosystem(
        &self,
        query: &str,
        presets: &[&str],
    ) -> Result<Vec<AwesomeItem>, Error> {
        let mut all_matches = Vec::new();
        for preset in presets {
            if let Ok(idx) = self.fetch_awesome_list(preset).await {
                let matches = idx.search(query);
                all_matches.extend(matches);
            }
        }
        Ok(all_matches)
    }

    /// Enrich items by probing for `llms.txt` and GitHub star counts.
    pub async fn enrich_awesome_items(&self, items: &mut [AwesomeItem], max_probe: usize) {
        let limit = items.len().min(max_probe);
        for item in items[..limit].iter_mut() {
            if let Some(ref repo_full) = item.github_repo
                && let Ok(gh_repo) = GitHubRepository::parse(repo_full)
            {
                // Check llms.txt
                let has_llms = self
                    .fetch_raw_file(&gh_repo.owner, &gh_repo.name, "main", "llms.txt")
                    .await
                    .is_ok()
                    || self
                        .fetch_raw_file(&gh_repo.owner, &gh_repo.name, "main", ".github/llms.txt")
                        .await
                        .is_ok();
                item.has_llms_txt = Some(has_llms);

                // Fetch metadata for stars
                if let Ok(repo_meta) = self.repository(&gh_repo).await
                    && let Some(stars) = repo_meta.get("stargazers_count").and_then(|v| v.as_u64())
                {
                    item.stars = Some(stars);
                }
            }
        }
    }
}

/// Convenience free function to fetch an Awesome list using default environment credentials.
pub async fn fetch_awesome_list(preset_or_repo: &str) -> Result<AwesomeIndex, Error> {
    let client = GitHubClient::from_env()?;
    client.fetch_awesome_list(preset_or_repo).await
}

/// Convenience free function to search across canonical Awesome lists.
pub async fn search_awesome_ecosystem(
    query: &str,
    presets: &[&str],
) -> Result<Vec<AwesomeItem>, Error> {
    let client = GitHubClient::from_env()?;
    client.search_awesome_ecosystem(query, presets).await
}
