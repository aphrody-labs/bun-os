// SPDX-License-Identifier: Apache-2.0
//! In-process persistent Web ingestion into the existing home retrieval pipeline.

use std::fmt::Write as _;
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use aphrody_rag::home::{HomeLayout, HomeScope};
use aphrody_web_crawl::{
    AddRequest, BunBrowserTransport, CrawlOptions, CrawlTransport, Frontier, FrontierOptions,
};
use clap::Args;
use miette::{IntoDiagnostic, miette};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Args)]
pub(crate) struct CrawlIndexArgs {
    /// HTTP(S) seed URLs, without embedded credentials
    #[arg(required = true, num_args = 1..)]
    urls: Vec<String>,
    /// Persistent job identifier (lowercase letters, digits and hyphens)
    #[arg(long)]
    label: String,
    /// Domain home; no reads from other profiles
    #[arg(long, default_value = "aphrody")]
    profile: String,
    /// State root (default: APHRODY_HOME or ~/.aphrody)
    #[arg(long)]
    state: Option<PathBuf>,
    /// Existing private job directory, for resuming a previously installed frontier
    #[arg(long)]
    job_dir: Option<PathBuf>,
    /// Maximum attempted requests in this run
    #[arg(long, default_value_t = 25, value_parser = clap::value_parser!(u32).range(1..=5000))]
    max_requests: u32,
    /// Maximum link depth from seeds
    #[arg(long, default_value_t = 2, value_parser = clap::value_parser!(u32).range(0..=10))]
    max_depth: u32,
    /// Overall crawl deadline in seconds; persisted pages are still indexed afterward
    #[arg(long, default_value_t = 1800, value_parser = clap::value_parser!(u64).range(1..=86400))]
    timeout: u64,
    /// Delay between requests to one host, in milliseconds
    #[arg(long, default_value_t = 1000, value_parser = clap::value_parser!(u32).range(0..=60000))]
    per_host_delay_ms: u32,
}

#[derive(Debug, Serialize)]
pub(super) struct CrawlIndexReport {
    profile: String,
    label: String,
    attempts: Option<usize>,
    pages: usize,
    written: usize,
    crawl_errors: Option<usize>,
    timed_out: bool,
    complete: bool,
    frontier: FrontierCounts,
    index: aphrody_rag::pipeline::PipelineReport,
}

#[derive(Debug, Serialize)]
struct FrontierCounts {
    pending: u64,
    locked: u64,
    done: u64,
    failed: u64,
}

fn validate(args: &CrawlIndexArgs) -> miette::Result<Vec<String>> {
    let label = args.label.as_bytes();
    if label.is_empty()
        || label.len() > 64
        || !label[0].is_ascii_alphanumeric()
        || !label
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
    {
        return Err(miette!(
            "--label must be a lowercase slug of 1..64 characters"
        ));
    }
    if args.urls.is_empty() || args.urls.len() > 25 {
        return Err(miette!("provide 1..25 seed URLs"));
    }
    let mut domains = Vec::new();
    for raw in &args.urls {
        let url = reqwest::Url::parse(raw).into_diagnostic()?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(miette!("seed URLs must be HTTP(S) without credentials"));
        }
        let domain = url
            .host_str()
            .ok_or_else(|| miette!("seed URL has no host"))?;
        if !domains.iter().any(|known| known == domain) {
            domains.push(domain.to_owned());
        }
    }
    Ok(domains)
}

pub(super) fn private_directory(path: &Path) -> miette::Result<()> {
    std::fs::create_dir_all(path).into_diagnostic()?;
    if std::fs::symlink_metadata(path)
        .into_diagnostic()?
        .file_type()
        .is_symlink()
    {
        return Err(miette!(
            "private job directories must not be symbolic links"
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).into_diagnostic()?;
    }
    Ok(())
}

fn private_file(path: &Path) -> miette::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).into_diagnostic()
}

pub(super) fn write_private(path: &Path, bytes: &[u8]) -> miette::Result<()> {
    let temporary = path.with_extension("new");
    let mut file = private_file(&temporary)?;
    file.write_all(bytes).into_diagnostic()?;
    file.sync_all().into_diagnostic()?;
    drop(file);
    std::fs::rename(temporary, path).into_diagnostic()
}

pub(super) fn job_lock(root: &Path) -> miette::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(root.join("job.lock")).into_diagnostic()?;
    file.try_lock()
        .map_err(|error| miette!("crawl job is already locked: {error}"))?;
    // The operating system releases the lock on exit, including a crash; no stale PID recovery.
    Ok(file)
}

pub(super) async fn run(args: CrawlIndexArgs) -> miette::Result<CrawlIndexReport> {
    obscura_net::ensure_rustls_crypto_provider();
    let transport =
        BunBrowserTransport::scoped(obscura_net::BunBrowserHttpClient::new(), &validate(&args)?)
            .await
            .map_err(|error| miette!("crawl transport scope: {error}"))?;
    run_with_transport(args, &transport).await
}

fn document_name(url: &str) -> miette::Result<String> {
    let mut digest = String::with_capacity(64);
    for byte in Sha256::digest(url.as_bytes()) {
        write!(&mut digest, "{byte:02x}").into_diagnostic()?;
    }
    Ok(format!("{digest}.md"))
}

fn validate_persisted_scope(
    frontier: &Frontier,
    documents: &Path,
    domains: &[String],
) -> miette::Result<()> {
    let policy = obscura_net::interceptor::DomainAllowlistInterceptor::new(domains)
        .map_err(|error| miette!("invalid persisted crawl scope: {error}"))?;
    let mut documents_by_name = std::collections::HashMap::new();
    for raw in frontier.known_urls().into_diagnostic()? {
        let url = reqwest::Url::parse(&raw).into_diagnostic()?;
        if !policy.allows(&url) {
            return Err(miette!(
                "persisted crawl URL is outside the requested domain scope"
            ));
        }
        if let Some((title, markdown)) = frontier.page(&raw).into_diagnostic()?
            && !markdown.trim().is_empty()
        {
            documents_by_name.insert(
                document_name(&raw)?,
                format!("# {title}\nSource: {raw}\n\n{markdown}"),
            );
        }
    }
    for entry in std::fs::read_dir(documents).into_diagnostic()? {
        let entry = entry.into_diagnostic()?;
        if !entry.file_type().into_diagnostic()?.is_file()
            || !documents_by_name.contains_key(&entry.file_name().to_string_lossy().into_owned())
        {
            return Err(miette!(
                "unrecognized persisted crawl document preserved; index refused"
            ));
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if std::fs::read(entry.path()).into_diagnostic()? != documents_by_name[&name].as_bytes() {
            return Err(miette!(
                "modified persisted crawl document preserved; index refused"
            ));
        }
    }
    Ok(())
}

async fn run_with_transport(
    args: CrawlIndexArgs,
    transport: &impl CrawlTransport,
) -> miette::Result<CrawlIndexReport> {
    let domains = validate(&args)?;
    let scope = HomeScope::from_profile(Some(&args.profile));
    let layout = match &args.state {
        Some(state) => HomeLayout::in_state(state, &scope),
        None => HomeLayout::resolve(&scope),
    }
    .into_diagnostic()?;
    let root = args
        .job_dir
        .unwrap_or_else(|| layout.home.join("private/web/jobs").join(&args.label));
    private_directory(&root)?;
    let _lock = job_lock(&root)?;
    let documents = root.join("documents");
    private_directory(&documents)?;
    let now_ms = i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .into_diagnostic()?
            .as_millis(),
    )
    .unwrap_or(i64::MAX);
    let frontier_path = root.join("frontier.sqlite");
    let mut policy_domains = domains.clone();
    policy_domains.sort();
    let policy = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 1,
        "profile": args.profile,
        "label": args.label,
        "allowedDomains": policy_domains,
        "anonymous": true,
    }))
    .into_diagnostic()?;
    let policy_path = root.join("crawl-policy.json");
    match std::fs::symlink_metadata(&policy_path) {
        Ok(metadata) => {
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || std::fs::read(&policy_path).into_diagnostic()? != policy
            {
                return Err(miette!("persisted crawl policy differs; state preserved"));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Legacy pages do not retain final redirect URLs or the transport policy.
            // Refuse before opening SQLite, which can recover leases and change state.
            let persisted_frontier = match std::fs::symlink_metadata(&frontier_path) {
                Ok(_) => true,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                Err(error) => return Err(error).into_diagnostic(),
            };
            if persisted_frontier
                || std::fs::read_dir(&documents)
                    .into_diagnostic()?
                    .next()
                    .is_some()
            {
                return Err(miette!(
                    "legacy crawl state has no transport policy; state preserved"
                ));
            }
            write_private(&policy_path, &policy)?;
        }
        Err(error) => return Err(error).into_diagnostic(),
    }
    let mut frontier = Frontier::open(
        &frontier_path,
        FrontierOptions {
            per_host_delay_ms: i64::from(args.per_host_delay_ms),
            max_in_flight_per_host: 1,
            max_retries: 2,
            ..FrontierOptions::default()
        },
        now_ms,
    )
    .into_diagnostic()?;
    validate_persisted_scope(&frontier, &documents, &domains)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&frontier_path, std::fs::Permissions::from_mode(0o600))
            .into_diagnostic()?;
    }
    for seed in &args.urls {
        frontier
            .enqueue(AddRequest::seed(seed), now_ms)
            .into_diagnostic()?;
    }
    let options = CrawlOptions {
        max_requests: usize::try_from(args.max_requests).into_diagnostic()?,
        max_depth: args.max_depth,
        max_concurrency: 2,
        allowed_domains: domains,
        obey_robots: true,
        user_agent: aphrody_web_service::fetch::USER_AGENT.to_owned(),
        ..CrawlOptions::default()
    };
    let crawl = tokio::time::timeout(
        Duration::from_secs(args.timeout),
        aphrody_web_crawl::crawl_bounded(&mut frontier, transport, &options),
    )
    .await;
    let (attempts, errors, timed_out) = match crawl {
        Ok(result) => {
            let report = result.into_diagnostic()?;
            (Some(report.attempts), Some(report.errors.len()), false)
        }
        Err(_) => (None, None, true),
    };
    // Read persisted pages, not just the latest report: a crash between crawl and index resumes.
    let mut written = 0;
    let mut pages = 0;
    for url in frontier.known_urls().into_diagnostic()? {
        let Some((title, markdown)) = frontier.page(&url).into_diagnostic()? else {
            continue;
        };
        if markdown.trim().is_empty() {
            continue;
        }
        pages += 1;
        let name = document_name(&url)?;
        let content = format!("# {title}\nSource: {url}\n\n{markdown}");
        let path = documents.join(name);
        if std::fs::read(&path).ok().as_deref() != Some(content.as_bytes()) {
            write_private(&path, content.as_bytes())?;
            written += 1;
        }
    }
    let stats = frontier.stats().into_diagnostic()?;
    if stats.done == 0
        && written == 0
        && std::fs::read_dir(&documents)
            .into_diagnostic()?
            .next()
            .is_none()
    {
        return Err(miette!("crawl yielded no indexable pages"));
    }
    let index = {
        validate_persisted_scope(&frontier, &documents, &options.allowed_domains)?;
        aphrody_rag::pipeline::run_pipeline(&layout, &format!("web:{}", args.label), &documents)
            .await
            .into_diagnostic()?
    };
    let report = CrawlIndexReport {
        profile: args.profile,
        label: args.label,
        attempts,
        pages,
        written,
        crawl_errors: errors,
        timed_out,
        complete: !timed_out
            && stats.pending == 0
            && stats.locked == 0
            && stats.failed == 0
            && errors == Some(0)
            && index.errors.is_empty(),
        frontier: FrontierCounts {
            pending: stats.pending,
            locked: stats.locked,
            done: stats.done,
            failed: stats.failed,
        },
        index,
    };
    write_private(
        &root.join("summary.json"),
        &serde_json::to_vec_pretty(&report).into_diagnostic()?,
    )?;
    if !report.index.errors.is_empty() {
        return Err(miette!(
            "home indexing reported errors; inspect the private summary"
        ));
    }
    if report.timed_out {
        return Err(miette!(
            "crawl deadline elapsed; persisted pages indexed; rerun the job to resume"
        ));
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aphrody_web_crawl::FetchResult;

    struct Fixture;
    struct HangingFixture;
    impl CrawlTransport for HangingFixture {
        async fn fetch(&self, url: &reqwest::Url) -> Result<FetchResult, String> {
            if url.path() == "/hanging" {
                return std::future::pending().await;
            }
            Ok(FetchResult {
                url: url.clone(),
                status: 200,
                content_type: Some("text/html".into()),
                body: if url.path() == "/robots.txt" {
                    "User-agent: *\nAllow: /".into()
                } else {
                    "<html><title>Partial crawl</title><h1>Native partial crawl</h1><a href='/hanging'>next</a></html>".into()
                },
            })
        }
    }
    impl CrawlTransport for Fixture {
        async fn fetch(&self, url: &reqwest::Url) -> Result<FetchResult, String> {
            Ok(FetchResult {
                url: url.clone(),
                status: 200,
                content_type: Some("text/html".into()),
                body: if url.path() == "/robots.txt" {
                    "User-agent: *\nDisallow: /private".into()
                } else {
                    "<html><head><title>Native ingestion</title></head><body><h1>Aphrody native ingestion</h1><a href='/private'>private</a></body></html>".into()
                },
            })
        }
    }
    fn args(state: &Path) -> CrawlIndexArgs {
        CrawlIndexArgs {
            urls: vec!["https://example.test/".into()],
            label: "native-test".into(),
            profile: "aphrody".into(),
            state: Some(state.into()),
            job_dir: None,
            max_requests: 2,
            max_depth: 1,
            timeout: 5,
            per_host_delay_ms: 0,
        }
    }
    #[test]
    fn rejects_traversal_and_credentials_before_writing() {
        let state = tempfile::tempdir().unwrap();
        let mut input = args(state.path());
        input.label = "../other".into();
        assert!(validate(&input).is_err());
        input.label = "safe".into();
        input.urls = vec!["https://user:secret@example.test".into()];
        assert!(validate(&input).is_err());
        input.urls = vec!["file:///etc/passwd".into()];
        assert!(validate(&input).is_err());
    }
    #[test]
    fn operating_system_lock_prevents_concurrent_jobs_and_releases() {
        let root = tempfile::tempdir().unwrap();
        let guard = job_lock(root.path()).unwrap();
        assert!(job_lock(root.path()).is_err());
        drop(guard);
        assert!(job_lock(root.path()).is_ok());
    }
    #[tokio::test]
    async fn deadline_indexes_persisted_pages_and_reports_incomplete_work() {
        let state = tempfile::tempdir().unwrap();
        let mut input = args(state.path());
        input.timeout = 1;
        assert!(run_with_transport(input, &HangingFixture).await.is_err());
        let layout =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("aphrody".into())).unwrap();
        let summary: serde_json::Value = serde_json::from_slice(
            &std::fs::read(
                layout
                    .home
                    .join("private/web/jobs/native-test/summary.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(summary["timed_out"], true);
        assert_eq!(summary["index"]["indexed"], 1);
        assert_eq!(summary["attempts"], serde_json::Value::Null);
    }
    #[tokio::test]
    async fn refuses_modified_documents_and_changed_scope_without_indexing() {
        let state = tempfile::tempdir().unwrap();
        run_with_transport(args(state.path()), &Fixture)
            .await
            .unwrap();
        let layout =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("aphrody".into())).unwrap();
        let root = layout.home.join("private/web/jobs/native-test");
        let documents = root.join("documents");
        let document = std::fs::read_dir(&documents)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let original = std::fs::read(&document).unwrap();
        let summary = std::fs::read(root.join("summary.json")).unwrap();
        std::fs::write(&document, b"foreign document preserved").unwrap();
        let error = run_with_transport(args(state.path()), &Fixture)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("modified persisted"));
        assert_eq!(
            std::fs::read(&document).unwrap(),
            b"foreign document preserved"
        );
        assert_eq!(std::fs::read(root.join("summary.json")).unwrap(), summary);
        std::fs::write(&document, original).unwrap();
        let mut changed = args(state.path());
        changed.urls = vec!["https://other.test/".into()];
        let error = run_with_transport(changed, &Fixture).await.unwrap_err();
        assert!(error.to_string().contains("persisted crawl policy differs"));
        assert_eq!(std::fs::read(root.join("summary.json")).unwrap(), summary);
        let foreign = documents.join("foreign.md");
        std::fs::write(&foreign, b"preserved").unwrap();
        let error = run_with_transport(args(state.path()), &Fixture)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("unrecognized persisted"));
        assert_eq!(std::fs::read(foreign).unwrap(), b"preserved");
    }

    #[tokio::test]
    async fn legacy_frontier_is_preserved_without_implicit_policy_certification() {
        let state = tempfile::tempdir().unwrap();
        let layout =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("aphrody".into())).unwrap();
        let root = layout.home.join("private/web/jobs/native-test");
        private_directory(&root).unwrap();
        let path = root.join("frontier.sqlite");
        let mut frontier = Frontier::open(&path, FrontierOptions::default(), 0).unwrap();
        frontier
            .enqueue(AddRequest::seed("https://example.test/"), 0)
            .unwrap();
        drop(frontier);
        let original = std::fs::read(&path).unwrap();
        let error = run_with_transport(args(state.path()), &Fixture)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("legacy crawl state"));
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert!(!root.join("crawl-policy.json").exists());
        assert!(!layout.db_path.exists());
    }

    #[tokio::test]
    async fn crawls_indexes_and_recovers_documents_from_persisted_frontier() {
        let state = tempfile::tempdir().unwrap();
        let layout =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("aphrody".into())).unwrap();
        let root = layout.home.join("private/web/jobs/native-test");
        // Establish the native owner's policy and index, then simulate missing
        // materialized documents without changing the indexed page content.
        run_with_transport(args(state.path()), &Fixture)
            .await
            .unwrap();
        let documents = root.join("documents");
        for entry in std::fs::read_dir(&documents).unwrap() {
            std::fs::remove_file(entry.unwrap().path()).unwrap();
        }
        let mut frontier =
            Frontier::open(root.join("frontier.sqlite"), FrontierOptions::default(), 0).unwrap();
        frontier
            .enqueue(AddRequest::seed("https://example.test/"), 0)
            .unwrap();
        aphrody_web_crawl::crawl_bounded(
            &mut frontier,
            &Fixture,
            &CrawlOptions {
                max_requests: 2,
                max_depth: 1,
                allowed_domains: vec!["example.test".into()],
                obey_robots: true,
                ..CrawlOptions::default()
            },
        )
        .await
        .unwrap();
        drop(frontier);
        let first = run_with_transport(args(state.path()), &Fixture)
            .await
            .unwrap();
        assert_eq!(first.attempts, Some(0));
        assert_eq!(first.written, 1);
        assert_eq!(first.index.indexed, 0); // Existing home pipeline skips unchanged content.
        assert_eq!(first.frontier.done, 1);
        let layout =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("aphrody".into())).unwrap();
        let root = layout.home.join("private/web/jobs/native-test");
        let document = std::fs::read_dir(root.join("documents"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        std::fs::remove_file(document).unwrap();
        let second = run_with_transport(args(state.path()), &Fixture)
            .await
            .unwrap();
        assert_eq!(second.attempts, Some(0));
        assert_eq!(second.written, 1);
        let db = aphrody_rag::home::HomeDb::open_read_only(&layout.db_path).unwrap();
        let hits = aphrody_rag::home::unified_search(&db, "native ingestion", &Default::default())
            .unwrap();
        assert!(!hits.is_empty());
        let other = HomeLayout::in_state(state.path(), &HomeScope::Profile("docs".into())).unwrap();
        assert!(!other.db_path.exists());
    }
}
