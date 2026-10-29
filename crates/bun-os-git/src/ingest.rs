// SPDX-License-Identifier: Apache-2.0
//! Native GitIngest engine for Aphrody Git.
//!
//! Transforms any local directory or remote Git repository into a prompt-ready
//! LLM text digest (metadata summary, ASCII tree, and delimited file contents),
//! matching the https://gitingest.com/llms.txt standard.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::{Deserialize, Serialize};

use crate::Error;

/// 48-character separator line specified by GitIngest / Tiktoken token-optimal delimiters.
pub const SEPARATOR: &str = "================================================";

/// Default ignore patterns matching GitIngest specifications.
pub static DEFAULT_IGNORE_PATTERNS: &[&str] = &[
    // Version Control
    ".git",
    ".svn",
    ".hg",
    ".gitattributes",
    ".gitmodules",
    // Python
    "*.pyc",
    "*.pyo",
    "*.pyd",
    "__pycache__",
    ".pytest_cache",
    ".coverage",
    ".tox",
    ".nox",
    ".mypy_cache",
    ".ruff_cache",
    ".hypothesis",
    "poetry.lock",
    "Pipfile.lock",
    // JavaScript / TypeScript / Node / Bun
    "node_modules",
    "bower_components",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    ".npm",
    ".yarn",
    ".pnpm-store",
    "bun.lock",
    "bun.lockb",
    // Rust
    "Cargo.lock",
    "target",
    "**/*.rs.bk",
    // Go
    "pkg",
    // Java / Kotlin / Gradle
    "*.class",
    "*.jar",
    "*.war",
    "*.ear",
    "*.nar",
    ".gradle",
    "build",
    ".settings",
    ".classpath",
    "gradle-app.setting",
    // C / C++ / Native
    "*.o",
    "*.obj",
    "*.dll",
    "*.dylib",
    "*.so",
    "*.exe",
    "*.lib",
    "*.out",
    "*.a",
    "*.pdb",
    // .NET / C#
    "obj",
    "bin",
    "*.suo",
    "*.user",
    "*.nupkg",
    // Apple / Xcode
    ".build",
    "*.xcodeproj",
    "*.xcworkspace",
    "xcuserdata",
    ".DS_Store",
    // IDEs & Editor metadata
    ".idea",
    ".vscode",
    ".project",
    // Binary & Media
    "*.bin",
    "*.iso",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.ico",
    "*.svg",
    "*.webp",
    "*.bmp",
    "*.mp4",
    "*.mp3",
    "*.wav",
    "*.ogg",
    "*.flac",
    "*.avi",
    "*.mov",
    "*.webm",
    "*.zip",
    "*.tar",
    "*.tar.gz",
    "*.tgz",
    "*.rar",
    "*.7z",
    "*.pdf",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
];

/// Options for configuring repository ingestion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestOptions {
    /// Maximum allowed file size in bytes (default: 10 MB).
    pub max_file_size: u64,
    /// Wildcard patterns of files to include (e.g. `["*.rs", "*.py"]`).
    pub include_patterns: Vec<String>,
    /// Wildcard patterns of files to exclude (e.g. `["tests/*"]`).
    pub exclude_patterns: Vec<String>,
    /// Git branch to ingest.
    pub branch: Option<String>,
    /// Git tag to ingest.
    pub tag: Option<String>,
    /// Specific subdirectory or subpath within the repository to focus on.
    pub subpath: Option<String>,
    /// GitHub / Git personal access token for private repositories.
    pub token: Option<String>,
    /// If true, include files that would normally be ignored by .gitignore.
    pub include_gitignored: bool,
    /// If true, recursively clone and include submodules.
    pub include_submodules: bool,
}

impl Default for IngestOptions {
    fn default() -> Self {
        Self {
            max_file_size: 10 * 1024 * 1024, // 10 MB
            include_patterns: Vec::new(),
            exclude_patterns: Vec::new(),
            branch: None,
            tag: None,
            subpath: None,
            token: None,
            include_gitignored: false,
            include_submodules: false,
        }
    }
}

/// The result of ingesting a repository or directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestResult {
    /// Summary prefix containing repository name, file count, and estimated tokens.
    pub summary: String,
    /// Hierarchical ASCII tree of the analyzed repository.
    pub tree: String,
    /// Concatenated contents of all included files with SEPARATOR lines.
    pub content: String,
    /// Total number of files analyzed.
    pub file_count: usize,
    /// Estimated number of tokens for LLMs.
    pub estimated_tokens: usize,
    /// Human-friendly formatted token count (e.g. "15.2k", "1.2M").
    pub formatted_tokens: String,
}

impl IngestResult {
    /// Combines summary, tree and content into the full prompt-ready context string.
    pub fn full_context(&self) -> String {
        format!("{}\n\n{}\n\n{}", self.summary, self.tree, self.content)
    }

    /// Renders the complete digest as Markdown.
    pub fn to_markdown(&self) -> String {
        self.full_context()
    }
}

/// Node representing a file or directory in the ingested tree.
#[derive(Debug, Clone)]
enum TreeNode {
    File {
        name: String,
    },
    Directory {
        name: String,
        children: BTreeMap<String, TreeNode>,
    },
}

impl TreeNode {
    fn name(&self) -> &str {
        match self {
            Self::File { name, .. } => name,
            Self::Directory { name, .. } => name,
        }
    }

    fn sort_rank(&self) -> (u8, String) {
        let name_lower = self.name().to_ascii_lowercase();
        match self {
            Self::File { .. } => {
                if name_lower == "readme" || name_lower.starts_with("readme.") {
                    (0, name_lower)
                } else if !name_lower.starts_with('.') {
                    (1, name_lower)
                } else {
                    (2, name_lower)
                }
            }
            Self::Directory { .. } => {
                if !name_lower.starts_with('.') {
                    (3, name_lower)
                } else {
                    (4, name_lower)
                }
            }
        }
    }
}

/// Build a GlobSet from a list of patterns.
fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, Error> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        let glob =
            Glob::new(p).map_err(|e| Error::Git(format!("invalid glob pattern '{p}': {e}")))?;
        builder.add(glob);
    }
    let set = builder
        .build()
        .map_err(|e| Error::Git(format!("failed to compile globs: {e}")))?;
    Ok(Some(set))
}

/// Check if a byte slice appears to be binary.
fn is_binary(bytes: &[u8]) -> bool {
    let probe = &bytes[..bytes.len().min(8192)];
    probe.contains(&0)
}

/// Format token count into a human-friendly string (e.g. "1.2k", "2.5M").
pub fn format_token_count(tokens: usize) -> String {
    if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.1}k", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}

/// Estimate tokens using the standard ~3.8 chars per token heuristic (tiktoken o200k_base proxy).
pub fn estimate_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    let chars = text.chars().count();
    ((chars as f64) / 3.8).ceil() as usize
}

/// Process a Jupyter notebook (`.ipynb`) into clean code / markdown cells.
fn extract_notebook_content(raw_json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(raw_json).ok()?;
    let cells = v.get("cells")?.as_array()?;
    let mut out = String::new();

    for cell in cells {
        let cell_type = cell
            .get("cell_type")
            .and_then(|s| s.as_str())
            .unwrap_or("code");
        let source_val = cell.get("source")?;
        let source_text = if let Some(arr) = source_val.as_array() {
            arr.iter()
                .filter_map(|line| line.as_str())
                .collect::<Vec<_>>()
                .join("")
        } else if let Some(s) = source_val.as_str() {
            s.to_string()
        } else {
            continue;
        };

        if !source_text.trim().is_empty() {
            out.push_str(&format!("# %% [{cell_type}]\n{source_text}\n\n"));
        }
    }

    if out.is_empty() { None } else { Some(out) }
}

/// Parse a remote repository URL or slug into (repo_url, inferred_branch, inferred_subpath).
pub fn parse_repo_source(source: &str) -> (String, Option<String>, Option<String>) {
    let trimmed = source.trim().trim_end_matches('/');

    // Handle URLs like https://github.com/owner/repo/tree/branch/subpath
    if let Ok(parsed_url) = url::Url::parse(trimmed) {
        let path_segments: Vec<&str> = parsed_url
            .path_segments()
            .map(|c| c.collect())
            .unwrap_or_default();
        if path_segments.len() >= 4 && (path_segments[2] == "tree" || path_segments[2] == "blob") {
            let branch = path_segments[3].to_string();
            let subpath = if path_segments.len() > 4 {
                Some(path_segments[4..].join("/"))
            } else {
                None
            };
            let base_url = format!(
                "{}://{}{}/{}/{}",
                parsed_url.scheme(),
                parsed_url.host_str().unwrap_or("github.com"),
                parsed_url
                    .port()
                    .map(|p| format!(":{p}"))
                    .unwrap_or_default(),
                path_segments[0],
                path_segments[1]
            );
            return (base_url, Some(branch), subpath);
        }
    }

    (trimmed.to_string(), None, None)
}

/// Ingest a local filesystem directory into a prompt-ready digest.
fn ingest_path(root_path: &Path, options: &IngestOptions) -> Result<IngestResult, Error> {
    let root = root_path
        .canonicalize()
        .unwrap_or_else(|_| root_path.to_path_buf());
    if !root.exists() {
        return Err(Error::Git(format!(
            "directory does not exist: {}",
            root.display()
        )));
    }

    let include_set = build_globset(&options.include_patterns)?;
    let exclude_set = build_globset(&options.exclude_patterns)?;

    let mut default_ignore_builder = GlobSetBuilder::new();
    for p in DEFAULT_IGNORE_PATTERNS {
        if let Ok(glob) = Glob::new(p) {
            default_ignore_builder.add(glob);
        }
    }
    let default_ignore_set = default_ignore_builder.build().ok();

    let target_dir = if let Some(sub) = &options.subpath {
        root.join(sub)
    } else {
        root.clone()
    };

    let mut walker = ignore::WalkBuilder::new(&target_dir);
    walker.hidden(false); // We want hidden files/dirs checked through our own filter
    walker.git_ignore(!options.include_gitignored);
    walker.git_global(!options.include_gitignored);
    walker.git_exclude(!options.include_gitignored);

    let mut file_entries: Vec<(String, String)> = Vec::new(); // (rel_path, content)

    for result in walker.build() {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let rel_path = match path.strip_prefix(&root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => path.to_string_lossy().replace('\\', "/"),
        };

        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        // Check default ignore patterns
        if !options.include_gitignored
            && let Some(ref set) = default_ignore_set
            && (set.is_match(file_name) || set.is_match(&rel_path))
        {
            continue;
        }

        // Check exclude patterns
        if let Some(ref set) = exclude_set
            && (set.is_match(file_name) || set.is_match(&rel_path))
        {
            continue;
        }

        // Check include patterns
        if let Some(ref set) = include_set
            && !set.is_match(file_name)
            && !set.is_match(&rel_path)
        {
            continue;
        }

        // Check file size
        if let Ok(meta) = fs::metadata(path)
            && meta.len() > options.max_file_size
        {
            continue;
        }

        // Read file bytes
        let raw_bytes = match fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };

        if is_binary(&raw_bytes) {
            continue;
        }

        let content_str = if path.extension().and_then(|e| e.to_str()) == Some("ipynb") {
            if let Ok(raw_text) = std::str::from_utf8(&raw_bytes) {
                extract_notebook_content(raw_text).unwrap_or_else(|| raw_text.to_string())
            } else {
                continue;
            }
        } else {
            match String::from_utf8(raw_bytes) {
                Ok(s) => s,
                Err(e) => String::from_utf8_lossy(&e.into_bytes()).to_string(),
            }
        };

        file_entries.push((rel_path, content_str));
    }

    // Sort files by rel_path
    file_entries.sort_by(|a, b| a.0.cmp(&b.0));
    let file_count = file_entries.len();

    // Build directory tree
    let slug = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();

    let mut root_children: BTreeMap<String, TreeNode> = BTreeMap::new();

    for (rel_path, _content) in &file_entries {
        let parts: Vec<&str> = rel_path.split('/').collect();
        insert_tree_node(&mut root_children, &parts, 0);
    }

    let mut tree_builder = format!("Directory structure:\n└── {slug}/\n");
    render_ascii_tree(&root_children, &mut tree_builder, "    ");

    // Build file contents with standard delimiters
    let mut content_builder = String::new();
    for (rel_path, content) in &file_entries {
        content_builder.push_str(SEPARATOR);
        content_builder.push('\n');
        content_builder.push_str(&format!("FILE: {rel_path}\n"));
        content_builder.push_str(SEPARATOR);
        content_builder.push('\n');
        content_builder.push_str(content);
        if !content.ends_with('\n') {
            content_builder.push('\n');
        }
        content_builder.push('\n');
    }

    // Build summary prefix
    let estimated_tokens = estimate_tokens(&format!("{}\n\n{}", tree_builder, content_builder));
    let formatted_tokens = format_token_count(estimated_tokens);

    let mut summary = String::new();
    summary.push_str(&format!("Directory: {slug}\n"));
    if let Some(sub) = &options.subpath {
        summary.push_str(&format!("Subpath: {sub}\n"));
    }
    summary.push_str(&format!("Files analyzed: {file_count}\n"));
    summary.push_str(&format!("Estimated tokens: {formatted_tokens}"));

    Ok(IngestResult {
        summary,
        tree: tree_builder.trim_end().to_string(),
        content: content_builder,
        file_count,
        estimated_tokens,
        formatted_tokens,
    })
}

fn insert_tree_node(current: &mut BTreeMap<String, TreeNode>, parts: &[&str], index: usize) {
    if index >= parts.len() {
        return;
    }
    let part = parts[index].to_string();
    if index == parts.len() - 1 {
        // Leaf file
        current.insert(part.clone(), TreeNode::File { name: part });
    } else {
        // Directory
        let entry = current
            .entry(part.clone())
            .or_insert_with(|| TreeNode::Directory {
                name: part,
                children: BTreeMap::new(),
            });
        if let TreeNode::Directory { children, .. } = entry {
            insert_tree_node(children, parts, index + 1);
        }
    }
}

fn render_ascii_tree(children: &BTreeMap<String, TreeNode>, out: &mut String, prefix: &str) {
    let mut sorted_children: Vec<&TreeNode> = children.values().collect();
    sorted_children.sort_by_key(|node| node.sort_rank());

    let count = sorted_children.len();
    for (i, node) in sorted_children.into_iter().enumerate() {
        let is_last = i == count - 1;
        let connector = if is_last { "└── " } else { "├── " };

        match node {
            TreeNode::File { name, .. } => {
                out.push_str(&format!("{prefix}{connector}{name}\n"));
            }
            TreeNode::Directory { name, children, .. } => {
                out.push_str(&format!("{prefix}{connector}{name}/\n"));
                let next_prefix = if is_last {
                    format!("{prefix}    ")
                } else {
                    format!("{prefix}│   ")
                };
                render_ascii_tree(children, out, &next_prefix);
            }
        }
    }
}

/// Ingest a remote Git repository by cloning shallowly to a temporary directory.
pub fn ingest_remote(repo_url: &str, options: &IngestOptions) -> Result<IngestResult, Error> {
    let temp_dir = tempfile::tempdir().map_err(|e| Error::Io {
        operation: "create temp directory",
        path: PathBuf::from("tempdir"),
        source: e,
    })?;

    let (clean_url, inferred_branch, inferred_subpath) = parse_repo_source(repo_url);
    let mut effective_options = options.clone();
    if effective_options.branch.is_none() {
        effective_options.branch = inferred_branch;
    }
    if effective_options.subpath.is_none() {
        effective_options.subpath = inferred_subpath;
    }

    // Authenticated URL injection if token provided
    let clone_url = if let Some(ref token) = effective_options.token {
        if let Ok(mut u) = url::Url::parse(&clean_url) {
            let _ = u.set_username("x-access-token");
            let _ = u.set_password(Some(token));
            u.to_string()
        } else {
            clean_url.clone()
        }
    } else {
        clean_url.clone()
    };

    let mut git_cmd = Command::new("git");
    git_cmd.args(["clone", "--depth", "1"]);

    if let Some(ref branch) = effective_options.branch {
        git_cmd.args(["--branch", branch]);
    }

    if effective_options.include_submodules {
        git_cmd.args(["--recurse-submodules", "--shallow-submodules"]);
    }

    git_cmd.arg(&clone_url).arg(temp_dir.path());

    let output = git_cmd
        .output()
        .map_err(|e| Error::Git(format!("failed to run git clone: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Git(format!("git clone failed: {stderr}")));
    }

    let mut result = ingest_path(temp_dir.path(), &effective_options)?;

    // Rewrite repository summary to reflect remote URL
    let repo_name = clean_url
        .trim_end_matches(".git")
        .split('/')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .iter()
        .rev()
        .take(2)
        .rev()
        .cloned()
        .collect::<Vec<_>>()
        .join("/");

    let mut summary = String::new();
    summary.push_str(&format!("Repository: {repo_name}\n"));
    if let Some(ref b) = effective_options.branch {
        summary.push_str(&format!("Branch: {b}\n"));
    }
    if let Some(ref sub) = effective_options.subpath {
        summary.push_str(&format!("Subpath: {sub}\n"));
    }
    summary.push_str(&format!("Files analyzed: {}\n", result.file_count));
    summary.push_str(&format!("Estimated tokens: {}", result.formatted_tokens));
    result.summary = summary;

    Ok(result)
}

/// True when `source` designates a remote Git repository rather than a local path.
pub fn is_remote_source(source: &str) -> bool {
    let t = source.trim();
    t.starts_with("http://")
        || t.starts_with("https://")
        || t.starts_with("git@")
        || t.ends_with(".git")
}

#[cfg(test)]
mod local_tests {
    use super::*;
    use std::fs;

    #[test]
    fn ingest_local_path() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let root = dir.path();
        fs::write(
            root.join("README.md"),
            "# Project Test
Description here
",
        )
        .expect("readme");
        fs::create_dir_all(root.join("src")).expect("src");
        fs::write(
            root.join("src/main.rs"),
            "fn main() {
    println!(\"hello\");
}
",
        )
        .expect("main.rs");
        fs::write(
            root.join("src/lib.rs"),
            "pub fn add(a: i32, b: i32) -> i32 { a + b }
",
        )
        .expect("lib.rs");
        fs::create_dir_all(root.join("target")).expect("target");
        fs::write(root.join("target/dummy.o"), [0u8, 1, 2, 3]).expect("dummy");
        fs::write(root.join("test.png"), [0u8, 1, 2, 3]).expect("binary");

        let result = ingest_path(root, &IngestOptions::default()).expect("ingest local path");
        assert_eq!(result.file_count, 3);
        assert!(result.summary.contains("Files analyzed: 3"));
        assert!(result.tree.contains("src/"));
        assert!(result.content.contains("FILE: README.md"));
        assert!(result.content.contains("FILE: src/main.rs"));
        assert!(result.content.contains("println!(\"hello\");"));
        assert!(!result.content.contains("dummy.o"));
        assert!(!result.content.contains("test.png"));
        let full = result.full_context();
        assert!(full.contains(&result.summary) && full.contains(&result.content));
    }

    #[test]
    fn ingest_include_filter() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let root = dir.path();
        fs::write(
            root.join("README.md"),
            "# Title
",
        )
        .unwrap();
        fs::write(
            root.join("script.py"),
            "print('py')
",
        )
        .unwrap();
        fs::write(
            root.join("main.rs"),
            "fn main() {}
",
        )
        .unwrap();
        let options = IngestOptions {
            include_patterns: vec!["*.rs".to_string()],
            ..IngestOptions::default()
        };
        let result = ingest_path(root, &options).expect("ingest filter");
        assert_eq!(result.file_count, 1);
        assert!(result.content.contains("FILE: main.rs"));
        assert!(!result.content.contains("script.py"));
    }

    #[test]
    fn remote_detection() {
        assert!(is_remote_source("https://github.com/a/b"));
        assert!(is_remote_source("git@github.com:a/b.git"));
        assert!(!is_remote_source("C:/work/dir"));
    }
}
