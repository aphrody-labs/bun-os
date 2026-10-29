// SPDX-License-Identifier: Apache-2.0
//! Bun documentation as an Aphrody OS subsystem.
//!
//! The corpus is the `docs/` tree of the oven-sh/bun, read in place; Aphrody keeps
//! no copy of it. It is indexed once, in memory, the first time a tool runs. The n2b registry
//! supplies the Node-to-Bun equivalents (`node:*` modules, npm packages, API call patterns).
//!
//! Tools: `bun_docs_search`, `bun_docs_read`, `bun_docs_list`, `bun_node_equivalent`.
//! Skill: `bun_docs_lookup` (search and return the best page in one call).
//!
//! Root resolution ([`resolve_root`]): `APHRODY_BUN_DOCS`, the upstream checkout
//! (`APHRODY_BUN_CHECKOUT`, else a sibling of the configured workspace), installed corpora, then a previous
//! versioned download. When none exists, [`BunDocsSubsystem::index`] downloads `docs/` of upstream Bun
//! at the commit pinned in `data/SOURCE.json` ([`download_root`], a partial
//! `git` clone, reported in `bun_docs_list`); `APHRODY_BUN_DOCS_FETCH=0` turns that into an error.

use aphrody_proc::NoWindow as _;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use aphrody_n2b_registry::{APIS, MODULES, PACKAGES};
use aphrody_subsystem::{
    SkillManifest, SkillStep, SubsystemError, SystemSubsystem, ToolDefinition,
};
use async_trait::async_trait;
use serde_json::{Value, json};

/// Canonical site the Bun docs are published to.
pub const DOCS_BASE_URL: &str = "https://bun.com/docs";
/// Environment variable overriding the docs root.
pub const ROOT_ENV: &str = "APHRODY_BUN_DOCS";
/// Environment variable naming upstream Bun checkout (oven-sh/bun) whose `docs/` is read.
pub const CHECKOUT_ENV: &str = "APHRODY_BUN_CHECKOUT";
/// Set to `0` to forbid the versioned download fallback.
pub const FETCH_ENV: &str = "APHRODY_BUN_DOCS_FETCH";
/// Commit or branch downloaded by the fallback instead of the pinned commit.
pub const REF_ENV: &str = "APHRODY_BUN_DOCS_REF";
/// Git URL of upstream Bun.
pub const FORK_URL: &str = "https://github.com/oven-sh/bun.git";
/// Paths of upstream Bun checked out by the download: `docs/` without its image directories.
const SPARSE_PATTERNS: [&str; 5] = [
    "/docs/",
    "!/docs/images/",
    "!/docs/icons/",
    "!/docs/logo/",
    "/LICENSE.md",
];
/// `data/SOURCE.json`: the upstream commit Aphrody is pinned to.
const PIN: &str = include_str!("../data/SOURCE.json");

/// Upstream commit pinned by `bun run docs:bun:update`.
#[must_use]
pub fn pinned_commit() -> Option<String> {
    serde_json::from_str::<Value>(PIN)
        .ok()?
        .get("commit")?
        .as_str()
        .map(str::to_owned)
}

const DEFAULT_LIMIT: usize = 8;
const MAX_LIMIT: usize = 50;
const DEFAULT_MAX_CHARS: usize = 24_000;
const SNIPPET_CHARS: usize = 240;

/// One documentation page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocPage {
    /// Path relative to the docs root, without extension, `/`-separated (`runtime/file-io`).
    pub slug: String,
    pub title: String,
    pub description: String,
    /// Markdown heading texts, in order.
    pub headings: Vec<String>,
    /// Page body without its front matter.
    pub body: String,
}

impl DocPage {
    /// Parse a page from its slug and raw `.md`/`.mdx` source.
    #[must_use]
    pub fn parse(slug: &str, source: &str) -> Self {
        let source = source.replace("\r\n", "\n");
        let (front, body) = split_front_matter(&source);
        let field = |key: &str| {
            front
                .lines()
                .find_map(|line| line.strip_prefix(key)?.strip_prefix(':'))
                .map(|value| value.trim().trim_matches(['"', '\'']).to_owned())
                .unwrap_or_default()
        };
        let headings = headings(body)
            .map(|(_, text)| text.to_owned())
            .collect::<Vec<_>>();
        let mut title = field("title");
        if title.is_empty() {
            title = headings.first().cloned().unwrap_or_else(|| slug.to_owned());
        }
        Self {
            slug: slug.to_owned(),
            title,
            description: field("description"),
            headings,
            body: body.trim_start().to_owned(),
        }
    }

    /// Public URL of the page.
    #[must_use]
    pub fn url(&self) -> String {
        let slug = self.slug.strip_suffix("/index").unwrap_or(&self.slug);
        if slug == "index" {
            DOCS_BASE_URL.to_owned()
        } else {
            format!("{DOCS_BASE_URL}/{slug}")
        }
    }

    /// The body, or only the section whose heading contains `section` (case-insensitive):
    /// that heading down to the next heading of the same or a higher level.
    #[must_use]
    pub fn section(&self, section: &str) -> Option<&str> {
        let needle = section.to_lowercase();
        let mut start: Option<(usize, usize)> = None;
        let mut offset = 0;
        let mut in_code = false;
        for line in self.body.split_inclusive('\n') {
            if line.trim_start().starts_with("```") {
                in_code = !in_code;
            } else if !in_code && let Some((level, text)) = heading(line) {
                match start {
                    Some((from, open)) if level <= open => return Some(&self.body[from..offset]),
                    None if text.to_lowercase().contains(&needle) => start = Some((offset, level)),
                    _ => {}
                }
            }
            offset += line.len();
        }
        start.map(|(from, _)| &self.body[from..])
    }
}

fn split_front_matter(source: &str) -> (&str, &str) {
    if let Some(rest) = source.strip_prefix("---\n")
        && let Some(end) = rest.find("\n---")
    {
        let after = &rest[end + 4..];
        return (&rest[..end], after.strip_prefix('\n').unwrap_or(after));
    }
    ("", source)
}

fn heading(line: &str) -> Option<(usize, &str)> {
    let hashes = line.bytes().take_while(|byte| *byte == b'#').count();
    let text = line[hashes..].strip_prefix(' ')?;
    (1..=6).contains(&hashes).then(|| (hashes, text.trim()))
}

fn headings(body: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut in_code = false;
    body.lines().filter_map(move |line| {
        if line.trim_start().starts_with("```") {
            in_code = !in_code;
            return None;
        }
        if in_code { None } else { heading(line) }
    })
}

fn terms(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|term| !term.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn count(haystack: &str, term: &str) -> usize {
    haystack.match_indices(term).count()
}

fn truncate(text: &str, max: usize) -> (&str, bool) {
    if text.len() <= max {
        return (text, false);
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}

/// A search result.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit<'a> {
    pub page: &'a DocPage,
    pub score: f64,
    pub snippet: String,
}

/// The in-memory index of every page under a docs root.
#[derive(Debug, Clone, Default)]
pub struct DocsIndex {
    root: PathBuf,
    pages: Vec<DocPage>,
    lower: Vec<Lowered>,
}

#[derive(Debug, Clone, Default)]
struct Lowered {
    slug: String,
    title: String,
    description: String,
    headings: String,
    body: String,
}

impl DocsIndex {
    /// Index every `.md`/`.mdx` file under `root`.
    ///
    /// # Errors
    /// The root cannot be read, or it holds no page.
    pub fn load(root: &Path) -> Result<Self, String> {
        let mut files = Vec::new();
        collect(root, &mut files).map_err(|error| format!("{}: {error}", root.display()))?;
        let mut pages = Vec::with_capacity(files.len());
        for file in files {
            let source = std::fs::read_to_string(&file)
                .map_err(|error| format!("{}: {error}", file.display()))?;
            let relative = file.strip_prefix(root).unwrap_or(&file).with_extension("");
            let slug = relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            pages.push(DocPage::parse(&slug, &source));
        }
        if pages.is_empty() {
            return Err(format!("no Bun docs page under {}", root.display()));
        }
        Ok(Self::from_pages(root.to_path_buf(), pages))
    }

    /// Build an index from already parsed pages.
    #[must_use]
    pub fn from_pages(root: PathBuf, mut pages: Vec<DocPage>) -> Self {
        pages.sort_by(|a, b| a.slug.cmp(&b.slug));
        let lower = pages
            .iter()
            .map(|page| Lowered {
                slug: page.slug.to_lowercase(),
                title: page.title.to_lowercase(),
                description: page.description.to_lowercase(),
                headings: page.headings.join("\n").to_lowercase(),
                body: page.body.to_lowercase(),
            })
            .collect();
        Self { root, pages, lower }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn pages(&self) -> &[DocPage] {
        &self.pages
    }

    /// Page by slug; also accepts a `bun.com/docs` URL, a leading `/` or a file extension.
    #[must_use]
    pub fn get(&self, slug: &str) -> Option<&DocPage> {
        let slug = slug.trim();
        let slug = slug
            .split_once("/docs/")
            .filter(|_| slug.contains("://"))
            .map_or(slug, |(_, rest)| rest);
        let slug = slug.trim_matches('/');
        let slug = slug
            .strip_suffix(".mdx")
            .or_else(|| slug.strip_suffix(".md"))
            .unwrap_or(slug);
        let slug = slug.split(['#', '?']).next().unwrap_or(slug);
        self.pages
            .iter()
            .find(|page| page.slug == slug)
            .or_else(|| {
                self.pages
                    .iter()
                    .find(|page| page.slug == format!("{slug}/index"))
            })
    }

    /// Rank pages for `query`: title, slug, headings and description weigh more than the
    /// body, and rare terms (inverse document frequency) more than common ones.
    #[must_use]
    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit<'_>> {
        let terms = terms(query);
        if terms.is_empty() {
            return Vec::new();
        }
        let total = self.pages.len() as f64;
        let idf: HashMap<&str, f64> = terms
            .iter()
            .map(|term| {
                let df = self
                    .lower
                    .iter()
                    .filter(|page| page.body.contains(term.as_str()))
                    .count();
                (term.as_str(), (1.0 + total / (1.0 + df as f64)).ln())
            })
            .collect();
        let phrase = query.trim().to_lowercase();
        let mut hits: Vec<Hit<'_>> = self
            .lower
            .iter()
            .zip(&self.pages)
            .filter_map(|(lower, page)| {
                let mut score = 0.0;
                let mut matched = 0;
                for term in &terms {
                    let fields = 8.0 * count(&lower.title, term) as f64
                        + 5.0 * count(&lower.slug, term) as f64
                        + 3.0 * count(&lower.headings, term) as f64
                        + 3.0 * count(&lower.description, term) as f64
                        + (1.0 + count(&lower.body, term) as f64).ln();
                    if fields > 0.0 {
                        matched += 1;
                        score += fields * idf[term.as_str()];
                    }
                }
                if matched == 0 {
                    return None;
                }
                // Pages covering every term beat pages repeating one of them.
                score *= f64::from(matched) / terms.len() as f64;
                if terms.len() > 1
                    && (lower.title.contains(&phrase) || lower.body.contains(&phrase))
                {
                    score *= 1.5;
                }
                Some(Hit {
                    page,
                    score,
                    snippet: snippet(&page.body, &terms),
                })
            })
            .collect();
        hits.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a.page.slug.cmp(&b.page.slug))
        });
        hits.truncate(limit);
        hits
    }
}

fn collect(dir: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
    let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(std::fs::DirEntry::path);
    for entry in entries {
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect(&path, files)?;
        } else if matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("md" | "mdx")
        ) {
            files.push(path);
        }
    }
    Ok(())
}

fn snippet(body: &str, terms: &[String]) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('<') && !line.starts_with("```"))
        .find(|line| {
            let lower = line.to_lowercase();
            terms.iter().any(|term| lower.contains(term.as_str()))
        })
        .unwrap_or_default();
    let (text, cut) = truncate(line, SNIPPET_CHARS);
    if cut {
        format!("{text}…")
    } else {
        text.to_owned()
    }
}

/// Docs root: `APHRODY_BUN_DOCS`, the upstream checkout's `docs/`, installed corpora, then a previous
/// versioned download ([`download_root`]).
///
/// Install a corpus at `<executable-directory>/bun-docs`,
/// `<installation-prefix>/share/aphrody/bun/docs`, or
/// `$XDG_DATA_HOME/aphrody/bun/docs` (`$HOME/.local/share` by default).
/// On Windows the user data directory is `%APPDATA%` instead.
/// An explicit override remains authoritative, including when it is invalid.
#[must_use]
pub fn resolve_root() -> Option<PathBuf> {
    let configured = std::env::var_os(ROOT_ENV).map(PathBuf::from);
    let executable = std::env::current_exe().ok();
    let data = data_dir();
    let mut candidates: Vec<PathBuf> = fork_docs(
        std::env::var_os(CHECKOUT_ENV)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .as_deref(),
        std::env::var_os("APHRODY_WORKSPACE_ROOT")
            .filter(|value| !value.is_empty())
            .or_else(|| std::env::var_os("APHRODY_ROOT").filter(|value| !value.is_empty()))
            .map(PathBuf::from)
            .as_deref(),
    )
    .into_iter()
    .collect();
    candidates.extend(installed_roots(executable.as_deref(), data.as_deref()));
    if let Some(data) = &data {
        candidates.extend(
            Some(download_dir(data, &download_ref()).join("docs"))
                .filter(|docs| docs.join("docs.json").is_file()),
        );
    }
    resolve_root_from(configured.as_deref(), &candidates)
}

/// User data directory: `%APPDATA%` on Windows, else `$XDG_DATA_HOME` or `$HOME/.local/share`.
fn data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let data = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    data
}

/// `APHRODY_BUN_DOCS_REF`, else the pinned commit, else `main`.
fn download_ref() -> String {
    std::env::var(REF_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(pinned_commit)
        .unwrap_or_else(|| "main".to_owned())
}

/// `<data>/aphrody/bun/docs-<ref, 12 characters>`: one checkout per downloaded revision.
fn download_dir(data: &Path, reference: &str) -> PathBuf {
    let name: String = reference
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .take(12)
        .collect();
    data.join("aphrody/bun").join(format!("docs-{name}"))
}

/// Versioned download fallback: a partial `git` clone of `docs/` of upstream Bun at `APHRODY_BUN_DOCS_REF`
/// (else the pinned commit) under the user data directory. Returns the downloaded docs root.
///
/// # Errors
/// The download is disabled (`APHRODY_BUN_DOCS_FETCH=0`), no data directory is known, or `git` fails.
pub fn download_root() -> Result<PathBuf, String> {
    if std::env::var(FETCH_ENV).is_ok_and(|value| value == "0") {
        return Err(format!("{FETCH_ENV}=0 forbids downloading the Bun docs"));
    }
    let data = data_dir().ok_or("no user data directory (APPDATA, XDG_DATA_HOME or HOME)")?;
    let reference = download_ref();
    download_into(FORK_URL, &reference, &download_dir(&data, &reference))
}

fn git(cwd: Option<&Path>, args: &[&str]) -> Result<(), String> {
    let mut command = std::process::Command::new("git").no_window();
    if let Some(cwd) = cwd {
        command.arg("-C").arg(cwd);
    }
    let output = command
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("git {}: {error}", args.join(" ")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn download_into(url: &str, reference: &str, dest: &Path) -> Result<PathBuf, String> {
    let docs = dest.join("docs");
    if docs.join("docs.json").is_file() {
        return Ok(docs);
    }
    let parent = dest.parent().ok_or("download directory has no parent")?;
    std::fs::create_dir_all(parent).map_err(|error| format!("{}: {error}", parent.display()))?;
    let staging = dest.with_extension(format!("partial-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    let staging_str = staging.to_string_lossy().into_owned();
    let result = git(
        None,
        &[
            "clone",
            "--quiet",
            "--no-checkout",
            "--depth",
            "1",
            "--filter=blob:none",
            "--sparse",
            url,
            &staging_str,
        ],
    )
    .and_then(|()| {
        let mut args = vec!["sparse-checkout", "set", "--no-cone"];
        args.extend(SPARSE_PATTERNS);
        git(Some(&staging), &args)
    })
    .and_then(|()| {
        git(
            Some(&staging),
            &["fetch", "--quiet", "--depth", "1", "origin", reference],
        )
    })
    .and_then(|()| {
        git(
            Some(&staging),
            &["checkout", "--quiet", "--detach", "FETCH_HEAD"],
        )
    })
    .and_then(|()| {
        if staging.join("docs/docs.json").is_file() {
            Ok(())
        } else {
            Err(format!("{url} @ {reference} has no docs/docs.json"))
        }
    });
    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    let _ = std::fs::remove_dir_all(dest);
    std::fs::rename(&staging, dest).map_err(|error| format!("{}: {error}", dest.display()))?;
    Ok(docs)
}

/// Read a configured upstream checkout or its sibling layout without assuming any host drive.
fn fork_docs(checkout: Option<&Path>, workspace: Option<&Path>) -> Option<PathBuf> {
    let checkout = checkout.map(Path::to_path_buf).or_else(|| {
        workspace
            .and_then(Path::parent)
            .map(|parent| parent.join("bun"))
    })?;
    let docs = checkout.join("docs");
    docs.join("docs.json").is_file().then_some(docs)
}

fn installed_roots(executable: Option<&Path>, data: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(bin) = executable.and_then(Path::parent) {
        roots.push(bin.join("bun-docs"));
        if let Some(prefix) = bin.parent() {
            roots.push(prefix.join("share/aphrody/bun/docs"));
        }
    }
    if let Some(data) = data {
        roots.push(data.join("aphrody/bun/docs"));
    }
    roots
}

fn resolve_root_from(configured: Option<&Path>, candidates: &[PathBuf]) -> Option<PathBuf> {
    if let Some(root) = configured {
        return Some(root.to_path_buf());
    }
    candidates.iter().find(|root| root.is_dir()).cloned()
}

/// Node modules, npm packages and Node API call patterns from the n2b registry that match
/// `query` (case-insensitive; a `node:` prefix is ignored), with their Bun equivalent.
#[must_use]
pub fn node_equivalents(query: &str, limit: usize) -> Vec<Value> {
    let needle = query.trim().to_lowercase();
    let needle = needle.strip_prefix("node:").unwrap_or(&needle).to_owned();
    if needle.is_empty() {
        return Vec::new();
    }
    let module_name = |module: &str| {
        module
            .strip_prefix("node:")
            .unwrap_or(module)
            .to_lowercase()
    };
    let mut out = Vec::new();
    let mut modules = MODULES
        .iter()
        .filter(|entry| module_name(&entry.module).contains(&needle))
        .collect::<Vec<_>>();
    // An exact module (`fs`) before its sub-paths (`fs/promises`).
    modules.sort_by_key(|entry| module_name(&entry.module) != needle);
    out.extend(modules.into_iter().map(|entry| {
        json!({
            "kind": "module",
            "id": entry.id,
            "node": entry.module,
            "compat": format!("{:?}", entry.compat).to_lowercase(),
            "bun": entry.equivalent,
            "missing_apis": entry.missing_apis,
            "hint": entry.rewrite_hint,
            "notes": entry.docs,
        })
    }));
    out.extend(
        PACKAGES
            .iter()
            .filter(|entry| entry.package.to_lowercase().contains(&needle))
            .map(|entry| {
                json!({
                    "kind": "package",
                    "id": entry.id,
                    "node": entry.package,
                    "bun": entry.replacement,
                    "strategy": entry.strategy.map(|s| format!("{s:?}").to_lowercase()),
                    "apis": entry.apis,
                    "hint": entry.note,
                    "notes": entry.docs,
                })
            }),
    );
    out.extend(
        APIS.iter()
            .filter(|entry| {
                entry.id.to_lowercase().contains(&needle)
                    || entry.message.to_lowercase().contains(&needle)
            })
            .map(|entry| {
                json!({
                    "kind": "api",
                    "id": entry.id,
                    "node": entry.pattern,
                    "bun": entry.replacement,
                    "import_from": entry.import_from,
                    "hint": entry.message,
                })
            }),
    );
    out.truncate(limit);
    out
}

/// The `bun_docs` subsystem.
#[derive(Debug, Default)]
pub struct BunDocsSubsystem {
    root: Option<PathBuf>,
    index: OnceLock<Result<DocsIndex, String>>,
}

impl BunDocsSubsystem {
    /// A subsystem whose docs root is resolved by [`resolve_root`] on first use.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A subsystem reading an explicit docs root.
    #[must_use]
    pub fn with_root(root: impl Into<PathBuf>) -> Self {
        Self {
            root: Some(root.into()),
            index: OnceLock::new(),
        }
    }

    /// The index, built on first call.
    ///
    /// # Errors
    /// [`SubsystemError::Unavailable`] when no docs root is found or it cannot be read.
    pub fn index(&self) -> Result<&DocsIndex, SubsystemError> {
        self.index
            .get_or_init(|| {
                let root = match self.root.clone().or_else(resolve_root) {
                    Some(root) => root,
                    None => download_root().map_err(|error| {
                        format!(
                            "Bun docs not found and not downloaded ({error}): set {CHECKOUT_ENV} \
                             to the oven-sh/bun checkout, {ROOT_ENV} to a docs directory, or \
                             install the corpus in the user data directory at aphrody/bun/docs"
                        )
                    })?,
                };
                DocsIndex::load(&root)
            })
            .as_ref()
            .map_err(|error| SubsystemError::Unavailable(error.clone()))
    }
}

fn text_arg<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, SubsystemError> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| SubsystemError::InvalidArguments(format!("`{key}` is required")))
}

fn usize_arg(arguments: &Value, key: &str, default: usize, max: usize) -> usize {
    arguments
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(default)
        .clamp(1, max)
}

fn page_content(
    page: &DocPage,
    section: Option<&str>,
    max_chars: usize,
) -> Result<Value, SubsystemError> {
    let content = match section {
        Some(section) => page.section(section).ok_or_else(|| {
            SubsystemError::InvalidArguments(format!(
                "no section matching `{section}` in {}; headings: {}",
                page.slug,
                page.headings.join(" | ")
            ))
        })?,
        None => page.body.as_str(),
    };
    let (content, truncated) = truncate(content, max_chars);
    Ok(json!({
        "slug": page.slug,
        "title": page.title,
        "description": page.description,
        "url": page.url(),
        "headings": page.headings,
        "content": content,
        "truncated": truncated,
    }))
}

#[async_trait]
impl SystemSubsystem for BunDocsSubsystem {
    fn name(&self) -> &str {
        "bun_docs"
    }

    fn description(&self) -> &str {
        "Offline Bun documentation (docs/ of oven-sh/bun) and n2b Node-to-Bun equivalents."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "bun_docs_search",
                "Search the Bun docs of oven-sh/bun (checkout APHRODY_BUN_CHECKOUT, else a versioned download of its docs/): runtime, bundler, package manager, test runner, guides. Returns ranked pages with slug, url and a snippet; set include_content to also return the best page.",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Words or an API name, e.g. `Bun.file stream` or `bun test snapshot`." },
                        "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": DEFAULT_LIMIT },
                        "include_content": { "type": "boolean", "default": false, "description": "Also return the Markdown of the top hit." },
                        "max_chars": { "type": "integer", "minimum": 1, "default": DEFAULT_MAX_CHARS }
                    },
                    "required": ["query"]
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "bun_docs_read",
                "Read one page of oven-sh/bun docs as Markdown by slug (`runtime/file-io`) or bun.com/docs URL, optionally only the section under a heading.",
                json!({
                    "type": "object",
                    "properties": {
                        "slug": { "type": "string" },
                        "section": { "type": "string", "description": "Case-insensitive heading substring." },
                        "max_chars": { "type": "integer", "minimum": 1, "default": DEFAULT_MAX_CHARS }
                    },
                    "required": ["slug"]
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "bun_docs_list",
                "List oven-sh/bun docs pages (slug, title, description, url), optionally under a slug prefix such as `runtime/` or `guides/test/`.",
                json!({
                    "type": "object",
                    "properties": { "prefix": { "type": "string" } }
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "bun_node_equivalent",
                "Bun equivalent of a Node module (`fs`, `node:child_process`), npm package (`dotenv`, `jest`) or Node API, from the n2b registry, with matching Bun docs pages.",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": DEFAULT_LIMIT }
                    },
                    "required": ["query"]
                }),
            )
            .read_only(),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "bun_docs_search" => {
                let index = self.index()?;
                let query = text_arg(&arguments, "query")?;
                let limit = usize_arg(&arguments, "limit", DEFAULT_LIMIT, MAX_LIMIT);
                let max_chars = usize_arg(&arguments, "max_chars", DEFAULT_MAX_CHARS, usize::MAX);
                let hits = index.search(query, limit);
                let top = match hits.first() {
                    Some(hit)
                        if arguments.get("include_content").and_then(Value::as_bool)
                            == Some(true) =>
                    {
                        Some(page_content(hit.page, None, max_chars)?)
                    }
                    _ => None,
                };
                Ok(json!({
                    "query": query,
                    "results": hits.iter().map(|hit| json!({
                        "slug": hit.page.slug,
                        "title": hit.page.title,
                        "description": hit.page.description,
                        "url": hit.page.url(),
                        "score": (hit.score * 100.0).round() / 100.0,
                        "snippet": hit.snippet,
                    })).collect::<Vec<_>>(),
                    "top": top,
                }))
            }
            "bun_docs_read" => {
                let index = self.index()?;
                let slug = text_arg(&arguments, "slug")?;
                let page = index.get(slug).ok_or_else(|| {
                    let near = index
                        .search(slug, 5)
                        .iter()
                        .map(|hit| hit.page.slug.clone())
                        .collect::<Vec<_>>();
                    SubsystemError::InvalidArguments(format!(
                        "no Bun docs page `{slug}`; closest: {}",
                        near.join(", ")
                    ))
                })?;
                let section = arguments
                    .get("section")
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty());
                page_content(
                    page,
                    section,
                    usize_arg(&arguments, "max_chars", DEFAULT_MAX_CHARS, usize::MAX),
                )
            }
            "bun_docs_list" => {
                let index = self.index()?;
                let prefix = arguments
                    .get("prefix")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim_start_matches('/');
                let pages = index
                    .pages()
                    .iter()
                    .filter(|page| page.slug.starts_with(prefix))
                    .map(|page| json!({ "slug": page.slug, "title": page.title, "description": page.description, "url": page.url() }))
                    .collect::<Vec<_>>();
                Ok(
                    json!({ "root": index.root().display().to_string(), "count": pages.len(), "pages": pages }),
                )
            }
            "bun_node_equivalent" => {
                let query = text_arg(&arguments, "query")?;
                let limit = usize_arg(&arguments, "limit", DEFAULT_LIMIT, MAX_LIMIT);
                let equivalents = node_equivalents(query, limit);
                // Docs are a bonus here: the registry answer stands without the submodule.
                let docs = self.index().map_or_else(
                    |_| Vec::new(),
                    |index| {
                        let bare = query.trim().trim_start_matches("node:");
                        index
                            .search(&format!("node {bare}"), 3)
                            .iter()
                            .map(|hit| json!({ "slug": hit.page.slug, "title": hit.page.title, "url": hit.page.url() }))
                            .collect()
                    },
                );
                Ok(json!({ "query": query, "equivalents": equivalents, "docs": docs }))
            }
            other => Err(SubsystemError::UnknownTool(other.to_owned())),
        }
    }

    fn skills(&self) -> Vec<SkillManifest> {
        vec![SkillManifest {
            name: "bun_docs_lookup".into(),
            description: "Answer a Bun question from oven-sh/bun docs: ranked pages plus the \
                          best page's Markdown."
                .into(),
            parameters: vec!["query".into()],
            steps: vec![SkillStep {
                tool: "bun_docs_search".into(),
                arguments: json!({ "query": "{{query}}", "limit": 5, "include_content": true }),
            }],
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "---\r\ntitle: File I/O\r\ndescription: \"Read and write \
                        files.\"\r\n---\r\n\r\nIntro about Bun.file.\r\n\r\n## Reading \
                        files\r\n\r\nUse `Bun.file(path)`.\r\n\r\n```ts\r\n# not a \
                        heading\r\n```\r\n\r\n### Streams\r\n\r\nStream it.\r\n\r\n## Writing \
                        files\r\n\r\nUse `Bun.write`.\r\n";

    fn fixture() -> DocsIndex {
        DocsIndex::from_pages(
            PathBuf::from("docs"),
            vec![
                DocPage::parse("runtime/file-io", PAGE),
                DocPage::parse(
                    "test/snapshots",
                    "---\ntitle: Snapshots\n---\n\n`bun test` supports snapshot testing with \
                 toMatchSnapshot.\n",
                ),
                DocPage::parse("index", "# Welcome\n\nBun is a runtime.\n"),
            ],
        )
    }

    #[test]
    fn front_matter_headings_and_code_fences() {
        let page = DocPage::parse("runtime/file-io", PAGE);
        assert_eq!(page.title, "File I/O");
        assert_eq!(page.description, "Read and write files.");
        assert_eq!(page.headings, ["Reading files", "Streams", "Writing files"]);
        assert!(page.body.starts_with("Intro"));
        assert_eq!(page.url(), "https://bun.com/docs/runtime/file-io");
        assert_eq!(
            fixture().get("index").map(DocPage::url).as_deref(),
            Some(DOCS_BASE_URL)
        );
        assert_eq!(
            fixture().get("index").map(|p| p.title.as_str()),
            Some("Welcome")
        );
    }

    #[test]
    fn section_stops_at_the_next_sibling_heading() {
        let page = DocPage::parse("runtime/file-io", PAGE);
        let reading = page.section("reading").expect("section");
        assert!(reading.contains("Streams") && reading.contains("# not a heading"));
        assert!(!reading.contains("Writing files"));
        assert!(page.section("writing").expect("last").contains("Bun.write"));
        assert!(page.section("nope").is_none());
    }

    #[test]
    fn search_ranks_title_matches_and_ignores_misses() {
        let index = fixture();
        let hits = index.search("snapshot testing", 5);
        assert_eq!(hits[0].page.slug, "test/snapshots");
        assert!(hits[0].snippet.contains("toMatchSnapshot"));
        assert_eq!(index.search("Bun.file", 1)[0].page.slug, "runtime/file-io");
        assert!(index.search("zzzz", 5).is_empty());
        assert!(index.search("  ", 5).is_empty());
    }

    #[test]
    fn get_accepts_urls_extensions_and_anchors() {
        let index = fixture();
        for key in [
            "runtime/file-io",
            "/runtime/file-io.mdx",
            "https://bun.com/docs/runtime/file-io#streams",
        ] {
            assert_eq!(
                index.get(key).map(|p| p.slug.as_str()),
                Some("runtime/file-io"),
                "{key}"
            );
        }
        assert!(index.get("runtime/nope").is_none());
    }

    #[test]
    fn registry_equivalents_cover_modules_and_packages() {
        let fs = node_equivalents("node:fs", 50);
        assert!(!fs.is_empty());
        assert_eq!(fs[0]["kind"], "module");
        assert!(
            node_equivalents("dotenv", 10)
                .iter()
                .any(|e| e["kind"] == "package")
        );
        assert!(node_equivalents("", 10).is_empty());
    }

    #[test]
    fn installed_corpus_is_found_outside_a_checkout() {
        let temp = tempfile::tempdir().expect("temporary install");
        let data = temp.path().join("data");
        let root = data.join("aphrody/bun/docs");
        std::fs::create_dir_all(root.join("runtime")).expect("corpus directory");
        std::fs::write(root.join("runtime/file-io.mdx"), PAGE).expect("corpus page");
        let installed = installed_roots(Some(&temp.path().join("bin/aphrody-kernel")), Some(&data));
        let resolved = resolve_root_from(None, &installed).expect("installed corpus");
        assert_eq!(resolved, root);
        let docs = DocsIndex::load(&resolved).expect("load installed corpus");
        assert_eq!(docs.search("Bun.file", 1)[0].page.slug, "runtime/file-io");
    }

    #[test]
    fn executable_bundle_is_preferred_over_user_data() {
        let temp = tempfile::tempdir().expect("temporary install");
        let executable = temp.path().join("prefix/bin/aphrody-kernel");
        let data = temp.path().join("data");
        let installed = installed_roots(Some(&executable), Some(&data));
        for root in &installed {
            std::fs::create_dir_all(root).expect("bundle directory");
        }
        assert_eq!(
            resolve_root_from(None, &installed),
            Some(installed[0].clone())
        );
        std::fs::remove_dir(&installed[0]).expect("remove portable bundle");
        assert_eq!(
            resolve_root_from(None, &installed),
            Some(installed[1].clone())
        );
        assert_eq!(
            installed[1],
            temp.path().join("prefix/share/aphrody/bun/docs")
        );
        assert!(resolve_root_from(None, &[temp.path().join("absent")]).is_none());
    }

    #[test]
    fn fork_checkout_docs_need_a_corpus() {
        let temp = tempfile::tempdir().expect("temporary checkout");
        assert_eq!(fork_docs(Some(temp.path()), None), None);
        std::fs::create_dir_all(temp.path().join("docs")).expect("docs directory");
        std::fs::write(temp.path().join("docs/docs.json"), "{}").expect("docs.json");
        assert_eq!(
            fork_docs(Some(temp.path()), None),
            Some(temp.path().join("docs"))
        );
        assert_eq!(fork_docs(None, None), None);
    }

    #[test]
    fn explicit_corpus_override_does_not_fall_back_when_invalid() {
        let temp = tempfile::tempdir().expect("temporary corpus");
        let missing = temp.path().join("missing-configured-corpus");
        let configured = resolve_root_from(Some(&missing), &[temp.path().to_owned()]);
        assert_eq!(configured, Some(missing.clone()));
        assert!(DocsIndex::load(&missing).is_err());
    }

    #[test]
    fn download_is_pinned_and_versioned() {
        let commit = pinned_commit().expect("SOURCE.json pins a commit");
        assert!(
            commit.len() == 40 && commit.bytes().all(|b| b.is_ascii_hexdigit()),
            "{commit}"
        );
        let data = Path::new("data");
        assert_eq!(
            download_dir(data, &commit),
            data.join(format!("aphrody/bun/docs-{}", &commit[..12]))
        );
        assert_eq!(
            download_dir(data, "feature/x"),
            data.join("aphrody/bun/docs-feature_x")
        );
    }

    #[test]
    fn download_fetches_only_the_docs_of_the_requested_commit() {
        let temp = tempfile::tempdir().expect("temporary repositories");
        let fork = temp.path().join("fork");
        for (path, text) in [
            ("docs/docs.json", "{}"),
            ("docs/runtime/file-io.mdx", PAGE),
            ("docs/images/logo.svg", "<svg/>"),
            ("LICENSE.md", "MIT"),
            ("src/main.rs", "fn main() {}"),
        ] {
            let file = fork.join(path);
            std::fs::create_dir_all(file.parent().expect("parent")).expect("fork directory");
            std::fs::write(file, text).expect("fork file");
        }
        let id = [
            "-c",
            "user.name=bun-docs",
            "-c",
            "user.email=bun-docs@example.invalid",
            "-c",
            "commit.gpgsign=false",
        ];
        git(Some(&fork), &["init", "--quiet"]).expect("init");
        git(Some(&fork), &["config", "uploadpack.allowFilter", "true"]).expect("filter");
        git(
            Some(&fork),
            &["config", "uploadpack.allowAnySHA1InWant", "true"],
        )
        .expect("want");
        git(Some(&fork), &["add", "."]).expect("add");
        git(
            Some(&fork),
            &[&id[..], &["commit", "--quiet", "-m", "docs"]].concat(),
        )
        .expect("commit");
        let head = std::process::Command::new("git")
            .arg("-C")
            .arg(&fork)
            .args(["rev-parse", "HEAD"])
            .output()
            .expect("rev-parse");
        let head = String::from_utf8_lossy(&head.stdout).trim().to_owned();
        let path = fork.to_string_lossy().replace('\\', "/");
        let url = if path.starts_with('/') {
            format!("file://{path}")
        } else {
            format!("file:///{path}")
        };
        let dest = download_dir(&temp.path().join("data"), &head);
        let docs = download_into(&url, &head, &dest).expect("download");
        assert_eq!(docs, dest.join("docs"));
        assert!(docs.join("runtime/file-io.mdx").is_file());
        assert!(dest.join("LICENSE.md").is_file());
        assert!(!docs.join("images").exists() && !dest.join("src").exists());
        assert_eq!(
            DocsIndex::load(&docs).expect("index").search("Bun.file", 1)[0]
                .page
                .slug,
            "runtime/file-io"
        );
        assert_eq!(
            download_into("file:///absent", &head, &dest).expect("cached"),
            docs
        );
        let failed = download_into(
            "file:///absent-fork",
            "main",
            &temp.path().join("other/docs-x"),
        );
        assert!(failed.is_err_and(|error| error.contains("git clone")));
        assert!(
            !temp
                .path()
                .join("other")
                .read_dir()
                .expect("parent")
                .any(|_| true)
        );
    }

    #[tokio::test]
    async fn fork_corpus_answers_real_queries() {
        let Some(root) = resolve_root() else {
            eprintln!("no Bun docs corpus (fork checkout, installed or downloaded); skipping");
            return;
        };
        let docs = BunDocsSubsystem::with_root(root);
        let found = docs
            .call(
                "bun_docs_search",
                json!({"query": "Bun.file write", "include_content": true}),
            )
            .await
            .expect("search");
        let slugs: Vec<&str> = found["results"]
            .as_array()
            .expect("results")
            .iter()
            .filter_map(|r| r["slug"].as_str())
            .collect();
        assert!(slugs.contains(&"runtime/file-io"), "{slugs:?}");
        assert!(
            found["top"]["content"]
                .as_str()
                .is_some_and(|c| !c.is_empty())
        );
        let read = docs
            .call(
                "bun_docs_read",
                json!({"slug": "runtime/file-io", "section": "Writing files"}),
            )
            .await
            .expect("read");
        assert!(
            read["content"]
                .as_str()
                .expect("content")
                .contains("Bun.write")
        );
        let list = docs
            .call("bun_docs_list", json!({"prefix": "runtime/"}))
            .await
            .expect("list");
        assert!(list["count"].as_u64().expect("count") > 20);
        let eq = docs
            .call("bun_node_equivalent", json!({"query": "child_process"}))
            .await
            .expect("eq");
        assert!(!eq["equivalents"].as_array().expect("eq").is_empty());
        let err = docs
            .call("bun_docs_read", json!({"slug": "runtime/nope"}))
            .await
            .expect_err("missing");
        assert!(matches!(err, SubsystemError::InvalidArguments(_)));
    }

    #[test]
    fn skill_targets_a_published_tool() {
        let docs = BunDocsSubsystem::new();
        let tools = docs.tools();
        assert_eq!(tools.len(), 4);
        assert!(
            tools
                .iter()
                .all(|tool| tool.read_only && tool.name.starts_with("bun_"))
        );
        for skill in docs.skills() {
            assert!(
                skill
                    .steps
                    .iter()
                    .all(|step| tools.iter().any(|t| t.name == step.tool))
            );
        }
    }
}
