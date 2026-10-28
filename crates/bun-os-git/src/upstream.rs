// SPDX-License-Identifier: Apache-2.0
//! Upstream catalogue and live, read-only access to it.
//!
//! `tools/config/upstream-sources.json` lists the few upstreams that stay checked out (`sources`, tier
//! `vital`) and the many that do not (`reference`, tier `reference` or `build`). This module reads that
//! catalogue and answers questions about any entry straight from the GitHub API, so nothing has to be
//! cloned: repository facts, a directory listing, one file, or a code search.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::source::MANIFEST_PATH;
use crate::{ApiMethod, Error, GitHubClient, git_error, io_error};

/// Largest file body returned by [`read`]; the rest is cut and flagged as truncated.
pub const MAX_READ_BYTES: usize = 256 * 1024;

/// Why an upstream is in the catalogue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpstreamTier {
    /// Kept checked out: a build input (Cargo path dependency with local patches).
    Vital,
    /// Restored under the source root only for the WSL build.
    Build,
    /// Never cloned by default; read live.
    Reference,
}

/// One catalogue entry.
#[derive(Debug, Clone, Serialize)]
pub struct Upstream {
    /// Manifest id.
    pub id: String,
    /// Catalogue tier.
    pub tier: UpstreamTier,
    /// Repository URL.
    pub url: String,
    /// Branch or tag the entry follows, when the manifest names one.
    pub git_ref: Option<String>,
    /// Head recorded when the entry was last observed or pinned.
    pub observed_commit: Option<String>,
    /// What it is for.
    pub purpose: String,
    /// What reads it.
    pub consumers: String,
    /// Licence expression recorded in the manifest.
    pub license: Option<String>,
    /// Local checkout (`checkout` in the manifest, relative to the repository root), when it exists.
    pub checkout: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct RawManifest {
    #[serde(default)]
    sources: Vec<RawSource>,
    #[serde(default)]
    integrated: Vec<RawSource>,
    #[serde(default)]
    reference: Vec<RawReference>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSource {
    id: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    upstream_url: Option<String>,
    #[serde(default, rename = "ref")]
    git_ref: Option<String>,
    #[serde(default)]
    upstream_tag: Option<String>,
    #[serde(default)]
    commit: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawReference {
    id: String,
    url: String,
    tier: String,
    #[serde(default, rename = "ref")]
    git_ref: Option<String>,
    #[serde(default)]
    observed_commit: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    purpose: String,
    #[serde(default)]
    consumers: String,
    #[serde(default)]
    checkout: Option<String>,
}

/// Parses the catalogue out of the manifest text.
pub fn parse_catalogue(text: &str) -> Result<Vec<Upstream>, Error> {
    let raw: RawManifest = serde_json::from_str(text)?;
    let mut entries =
        Vec::with_capacity(raw.sources.len() + raw.integrated.len() + raw.reference.len());
    for source in raw.sources.into_iter().chain(raw.integrated) {
        let Some(url) = source.url.or(source.upstream_url) else { continue };
        entries.push(Upstream {
            id: source.id,
            tier: UpstreamTier::Vital,
            url,
            git_ref: source.git_ref.or(source.upstream_tag),
            observed_commit: source.commit,
            purpose: source.note.unwrap_or_else(|| "Cargo path dependency".to_owned()),
            consumers: "Cargo.toml path dependency".to_owned(),
            license: source.license,
            checkout: None,
        });
    }
    for reference in raw.reference {
        let tier = match reference.tier.as_str() {
            "build" => UpstreamTier::Build,
            "reference" => UpstreamTier::Reference,
            other => return Err(git_error(format!("{}: unknown tier `{other}`", reference.id))),
        };
        entries.push(Upstream {
            id: reference.id,
            tier,
            url: reference.url,
            git_ref: reference.git_ref,
            observed_commit: reference.observed_commit,
            purpose: reference.purpose,
            consumers: reference.consumers,
            license: reference.license,
            checkout: reference.checkout.map(PathBuf::from),
        });
    }
    Ok(entries)
}

/// Reads the catalogue of the repository rooted at `repository`; a `checkout` is resolved against
/// that root and kept only when the directory exists.
pub fn catalogue(repository: impl AsRef<Path>) -> Result<Vec<Upstream>, Error> {
    let repository = repository.as_ref();
    let path = repository.join(MANIFEST_PATH);
    let text =
        std::fs::read_to_string(&path).map_err(|error| io_error("read manifest", &path, error))?;
    let mut entries = parse_catalogue(&text)?;
    for entry in &mut entries {
        entry.checkout = entry
            .checkout
            .take()
            .map(|checkout| repository.join(checkout))
            .filter(|checkout| checkout.is_dir())
            .map(|checkout| checkout.canonicalize().map_or(checkout, strip_verbatim));
    }
    Ok(entries)
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|text| text.strip_prefix(r"\\?\")) {
        Some(rest) if !rest.starts_with(r"UNC\") => PathBuf::from(rest),
        _ => path,
    }
}

/// Finds one entry by id.
pub fn find<'a>(entries: &'a [Upstream], id: &str) -> Result<&'a Upstream, Error> {
    entries.iter().find(|entry| entry.id == id).ok_or_else(|| {
        let ids = entries.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>().join(", ");
        git_error(format!("unknown upstream `{id}`; known: {ids}"))
    })
}

/// `owner/name` of a GitHub repository URL.
pub fn slug(url: &str) -> Result<String, Error> {
    let trimmed = url
        .strip_prefix("https://github.com/")
        .map(|rest| rest.trim_end_matches('/').trim_end_matches(".git"))
        .filter(|rest| rest.split('/').count() == 2 && rest.split('/').all(|part| !part.is_empty()))
        .ok_or_else(|| Error::InvalidRepository(url.to_owned()))?;
    Ok(trimmed.to_owned())
}

/// Percent-encodes a repository path or ref, keeping `/` as a separator.
fn encode_path(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/') {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn clean_path(path: &str) -> Result<String, Error> {
    let trimmed = path.trim_matches('/');
    if trimmed.split('/').any(|part| part == "..") || trimmed.contains(['\0', '?', '#']) {
        return Err(git_error(format!("invalid repository path `{path}`")));
    }
    Ok(trimmed.to_owned())
}

fn contents_route(entry: &Upstream, path: &str) -> Result<String, Error> {
    let slug = slug(&entry.url)?;
    let path = clean_path(path)?;
    let mut route = format!("/repos/{slug}/contents");
    if !path.is_empty() {
        route.push('/');
        route.push_str(&encode_path(&path));
    }
    if let Some(git_ref) = &entry.git_ref {
        route.push_str("?ref=");
        route.push_str(&encode_path(git_ref));
    }
    Ok(route)
}

async fn get(client: &GitHubClient, route: &str) -> Result<Value, Error> {
    Ok(client.request(ApiMethod::Get, route, None).await?.body)
}

/// Live facts: repository metadata, head of the followed ref, latest release, and the gap to the observed commit.
pub async fn info(client: &GitHubClient, entry: &Upstream) -> Result<Value, Error> {
    let slug = slug(&entry.url)?;
    let repo = get(client, &format!("/repos/{slug}")).await?;
    let branch = entry
        .git_ref
        .clone()
        .or_else(|| repo["default_branch"].as_str().map(str::to_owned))
        .unwrap_or_else(|| "HEAD".to_owned());
    let head = get(client, &format!("/repos/{slug}/commits/{}", encode_path(&branch))).await;
    let release = match get(client, &format!("/repos/{slug}/releases/latest")).await {
        Ok(body) => json!({
            "tag": body["tag_name"],
            "published_at": body["published_at"],
            "prerelease": body["prerelease"],
        }),
        Err(Error::GitHubStatus { status: 404, .. }) => Value::Null,
        Err(error) => return Err(error),
    };
    let (head_sha, head_json) = match &head {
        Ok(body) => (
            body["sha"].as_str().map(str::to_owned),
            json!({
                "sha": body["sha"],
                "date": body["commit"]["committer"]["date"],
                "subject": body["commit"]["message"].as_str().and_then(|m| m.lines().next()),
            }),
        ),
        Err(error) => (None, json!({ "error": error.to_string() })),
    };
    let moved = match (&head_sha, &entry.observed_commit) {
        (Some(head), Some(observed)) => Some(head != observed),
        _ => None,
    };
    Ok(json!({
        "id": entry.id,
        "tier": entry.tier,
        "repository": slug,
        "purpose": entry.purpose,
        "consumers": entry.consumers,
        "ref": branch,
        "description": repo["description"],
        "license": repo["license"]["spdx_id"].as_str().map(str::to_owned).or_else(|| entry.license.clone()),
        "archived": repo["archived"],
        "stars": repo["stargazers_count"],
        "pushed_at": repo["pushed_at"],
        "default_branch": repo["default_branch"],
        "head": head_json,
        "observed_commit": entry.observed_commit,
        "moved_since_observed": moved,
        "latest_release": release,
    }))
}

/// Directory listing of `path` at the followed ref.
pub async fn tree(client: &GitHubClient, entry: &Upstream, path: &str) -> Result<Value, Error> {
    let body = get(client, &contents_route(entry, path)?).await?;
    let Some(items) = body.as_array() else {
        return Err(git_error(format!("`{path}` is a file; use `read`")));
    };
    let entries: Vec<Value> = items
        .iter()
        .map(|item| json!({ "name": item["name"], "path": item["path"], "type": item["type"], "size": item["size"] }))
        .collect();
    Ok(json!({ "id": entry.id, "path": path, "entries": entries }))
}

/// One file at the followed ref, decoded as UTF-8 (lossy) and cut at [`MAX_READ_BYTES`].
pub async fn read(client: &GitHubClient, entry: &Upstream, path: &str) -> Result<Value, Error> {
    if clean_path(path)?.is_empty() {
        return Err(git_error("`read` needs a file path"));
    }
    let body = get(client, &contents_route(entry, path)?).await?;
    if body.is_array() {
        return Err(git_error(format!("`{path}` is a directory; use `tree`")));
    }
    let Some(encoded) = body["content"].as_str().filter(|content| !content.is_empty()) else {
        return Err(git_error(format!(
            "`{path}` has no inline content (over 1 MB or a submodule); use `aphrody-update upstream fetch {}`",
            entry.id
        )));
    };
    let compact: String = encoded.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(compact.as_bytes())
        .map_err(|error| git_error(format!("decode `{path}`: {error}")))?;
    let truncated = bytes.len() > MAX_READ_BYTES;
    let shown = if truncated { &bytes[..MAX_READ_BYTES] } else { &bytes[..] };
    Ok(json!({
        "id": entry.id,
        "path": path,
        "size": bytes.len(),
        "truncated": truncated,
        "text": String::from_utf8_lossy(shown),
    }))
}

/// Hits returned by [`search`].
pub const SEARCH_HITS: usize = 20;
/// Files larger than this are skipped by [`local_search`].
const LOCAL_SEARCH_MAX_FILE: u64 = 1024 * 1024;

/// Code search restricted to this upstream. GitHub code search needs a token: without one, or when
/// GitHub refuses it (401/403), the local checkout is searched instead; an entry without one answers
/// `degraded` with the way to enable the search instead of failing.
pub async fn search(client: &GitHubClient, entry: &Upstream, query: &str) -> Result<Value, Error> {
    if query.trim().is_empty() {
        return Err(git_error("`search` needs a query"));
    }
    let refused = if client.is_authenticated() {
        match github_search(client, entry, query).await {
            Err(Error::GitHubStatus { status: status @ (401 | 403), .. }) => {
                format!("GitHub code search refused the token (HTTP {status})")
            },
            other => return other,
        }
    } else {
        "GitHub code search needs a token (GH_TOKEN, GITHUB_TOKEN or `gh auth login`)".to_owned()
    };
    match &entry.checkout {
        Some(checkout) => {
            let mut found = local_search(checkout, query)?;
            found["id"] = json!(entry.id);
            found["degraded"] = json!(refused);
            Ok(found)
        },
        None => Ok(json!({
            "id": entry.id,
            "query": query,
            "total": Value::Null,
            "items": [],
            "degraded": refused,
            "hint": "set GH_TOKEN, or give this entry a `checkout` in tools/config/upstream-sources.json",
        })),
    }
}

/// Files of `checkout` (`.gitignore` honoured, `.git` skipped) containing every word of `query`,
/// case-insensitively, with the first line holding the first word; at most [`SEARCH_HITS`] items.
pub fn local_search(checkout: &Path, query: &str) -> Result<Value, Error> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    let Some(first) = words.first().cloned() else {
        return Err(git_error("`search` needs a query"));
    };
    let walker = ignore::WalkBuilder::new(checkout)
        .require_git(false)
        .filter_entry(|entry| entry.file_name() != ".git")
        .build();
    let mut items = Vec::new();
    let mut truncated = false;
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file())
            || entry.metadata().map_or(true, |meta| meta.len() > LOCAL_SEARCH_MAX_FILE)
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else { continue };
        if bytes.contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let lower = text.to_lowercase();
        if !words.iter().all(|word| lower.contains(word.as_str())) {
            continue;
        }
        if items.len() == SEARCH_HITS {
            truncated = true;
            break;
        }
        let line = text
            .lines()
            .enumerate()
            .find(|(_, line)| line.to_lowercase().contains(first.as_str()))
            .map(|(index, line)| (index + 1, line.trim().chars().take(200).collect::<String>()));
        let relative = entry.path().strip_prefix(checkout).unwrap_or_else(|_| entry.path());
        items.push(json!({
            "path": relative.to_string_lossy().replace('\\', "/"),
            "line": line.as_ref().map(|(number, _)| *number),
            "text": line.map(|(_, text)| text),
        }));
    }
    Ok(json!({
        "query": query,
        "source": "local checkout",
        "checkout": checkout.to_string_lossy(),
        "total": if truncated { Value::Null } else { json!(items.len()) },
        "truncated": truncated,
        "items": items,
    }))
}

async fn github_search(
    client: &GitHubClient,
    entry: &Upstream,
    query: &str,
) -> Result<Value, Error> {
    let slug = slug(&entry.url)?;
    let q: String = url::form_urlencoded::byte_serialize(query.trim().as_bytes()).collect();
    let body =
        get(client, &format!("/search/code?q={q}+repo:{slug}&per_page={SEARCH_HITS}")).await?;
    let items: Vec<Value> = body["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| json!({ "path": item["path"], "url": item["html_url"] }))
                .collect()
        })
        .unwrap_or_default();
    Ok(json!({ "id": entry.id, "query": query, "total": body["total_count"], "items": items }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{
        "schemaVersion": 1,
        "root": "../source",
        "sources": [
            {"id":"mcp-server-tauri","kind":"git","url":"https://github.com/hypothesi/mcp-server-tauri","ref":"main","commit":"4451b2b1d1eb3a817674f60957e148224c24d3a8","license":"MIT"},
            {"id":"simdutf-rio","kind":"crate","crate":"simdutf","version":"0.7.0","upstreamUrl":"https://github.com/Nugine/simdutf-rs","upstreamTag":"v0.7.0"}
        ],
        "reference": [
            {"id":"codex","kind":"git","tier":"reference","url":"https://github.com/openai/codex.git","ref":"main","purpose":"Codex CLI","consumers":"docs"},
            {"id":"wslg","kind":"git","tier":"build","url":"https://github.com/microsoft/wslg.git","purpose":"WSLg","consumers":"wsl build"}
        ]
    }"#;

    #[test]
    fn catalogue_merges_vital_and_reference_entries() {
        let entries = parse_catalogue(MANIFEST).unwrap();
        let ids: Vec<_> = entries.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, ["mcp-server-tauri", "simdutf-rio", "codex", "wslg"]);
        assert_eq!(entries[1].url, "https://github.com/Nugine/simdutf-rs");
        assert_eq!(entries[1].git_ref.as_deref(), Some("v0.7.0"));
        assert_eq!(entries[2].tier, UpstreamTier::Reference);
        assert_eq!(entries[3].tier, UpstreamTier::Build);
    }

    #[tokio::test]
    async fn search_without_token_reads_the_checkout_or_degrades() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let root = tempfile::tempdir().unwrap();
        let checkout = root.path().join("bun");
        std::fs::create_dir_all(checkout.join("src/bundler")).unwrap();
        std::fs::create_dir_all(checkout.join("build")).unwrap();
        std::fs::write(checkout.join(".gitignore"), "build/\n").unwrap();
        std::fs::write(
            checkout.join("src/bundler/linker.rs"),
            "fn a() {}\n// Merge Small chunks\n",
        )
        .unwrap();
        std::fs::write(checkout.join("src/other.rs"), "merge only\n").unwrap();
        std::fs::write(checkout.join("build/linker.rs"), "merge small\n").unwrap();
        let repository = root.path().join("aphrody");
        let manifest = repository.join(MANIFEST_PATH);
        std::fs::create_dir_all(manifest.parent().unwrap()).unwrap();
        std::fs::write(
            &manifest,
            r#"{"reference":[
                {"id":"bun","tier":"reference","url":"https://github.com/oven-sh/bun","checkout":"../bun"},
                {"id":"codex","tier":"reference","url":"https://github.com/openai/codex","checkout":"../missing"}
            ]}"#,
        )
        .unwrap();
        let entries = catalogue(&repository).unwrap();
        let bun = find(&entries, "bun").unwrap();
        assert!(bun.checkout.as_ref().is_some_and(|path| path.ends_with("bun")));
        let codex = find(&entries, "codex").unwrap();
        assert_eq!(codex.checkout, None);

        let client = GitHubClient::new(None, "http://127.0.0.1:9").unwrap();
        let found = search(&client, bun, "merge SMALL").await.unwrap();
        assert_eq!(found["source"], "local checkout");
        assert_eq!(found["total"], 1);
        assert_eq!(found["items"][0]["path"], "src/bundler/linker.rs");
        assert_eq!(found["items"][0]["line"], 2);
        assert!(found["degraded"].as_str().unwrap().contains("token"));

        let degraded = search(&client, codex, "merge").await.unwrap();
        assert_eq!(degraded["items"], json!([]));
        assert!(degraded["hint"].as_str().unwrap().contains("GH_TOKEN"));
        assert!(search(&client, bun, "  ").await.is_err());
    }

    #[test]
    fn unknown_tier_and_unknown_id_are_errors() {
        let bad = MANIFEST.replace("\"tier\":\"build\"", "\"tier\":\"cache\"");
        assert!(parse_catalogue(&bad).is_err());
        let entries = parse_catalogue(MANIFEST).unwrap();
        assert!(find(&entries, "codex").is_ok());
        let error = find(&entries, "nope").unwrap_err().to_string();
        assert!(error.contains("codex") && error.contains("nope"));
    }

    #[test]
    fn slug_accepts_github_urls_only() {
        assert_eq!(slug("https://github.com/openai/codex.git").unwrap(), "openai/codex");
        assert_eq!(slug("https://github.com/openai/codex/").unwrap(), "openai/codex");
        assert!(slug("https://gitlab.com/a/b").is_err());
        assert!(slug("https://github.com/a").is_err());
        assert!(slug("https://github.com/a/b/c").is_err());
    }

    #[test]
    fn routes_encode_paths_and_refuse_traversal() {
        let entries = parse_catalogue(MANIFEST).unwrap();
        let codex = find(&entries, "codex").unwrap();
        assert_eq!(
            contents_route(codex, "codex-rs/some dir/a#b.rs").unwrap_err().to_string(),
            "git operation failed: invalid repository path `codex-rs/some dir/a#b.rs`"
        );
        assert_eq!(
            contents_route(codex, "/codex-rs/some dir/").unwrap(),
            "/repos/openai/codex/contents/codex-rs/some%20dir?ref=main"
        );
        assert_eq!(contents_route(codex, "").unwrap(), "/repos/openai/codex/contents?ref=main");
        assert!(contents_route(codex, "a/../b").is_err());
    }
}
