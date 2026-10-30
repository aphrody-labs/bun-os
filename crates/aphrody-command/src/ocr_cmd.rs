// SPDX-License-Identifier: Apache-2.0
//! `aphrody ocr …` — read images with a local vision-language model.
//!
//! Built only with `--features ocr`. Drives a GGUF vision model through
//! llama.cpp (resolved by `aphrody-infer`) and turns each page into markdown,
//! or into an explicit "no text" verdict.
//!
//! # Why JSONL for batches
//!
//! `batch` streams one JSON object per line as each page finishes, flushing as
//! it goes. A run over ten thousand plates takes hours; a format that is only
//! valid once complete would mean losing everything to one interruption, and
//! would make resuming impossible. With JSONL the already-read pages are on
//! disk and `--skip-done` can pick the run back up.

use std::{
    io::{BufRead as _, Read as _, Write as _},
    path::{Path, PathBuf},
    time::Instant,
};

use aphrody_ocr::{
    DEFAULT_DATABOOKS_MODEL, DEFAULT_PPOCR_MODEL, DEFAULT_VLM_MODEL, OcrOptions, PageResult,
    ServerRunner, VlmRunner,
};
use sha2::{Digest as _, Sha256};

/// Below this content score a PP-OCR page is held for review instead of
/// deposited.
///
/// Measured on two lots: the caption plates of databook 28 score eight and
/// above, while the drawings of databook 29 that yield one stray glyph score
/// one. Four sits between them with room on both sides; it is a threshold on
/// measured data, not a round number picked for looking reasonable.
const THIN_PAGE_SCORE: usize = 4;

use crate::model_cmd::OutputOpts;

/// Which backend reads a batch.
#[derive(clap::ValueEnum, Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Engine {
    /// A vision-language model through llama.cpp: document structure, markdown.
    #[default]
    Vlm,
    /// PP-OCRv5 through ONNX Runtime: deterministic detection, geometry, CTC.
    Ppocr,
}

/// Where a read is deposited, shared by every producing command.
///
/// Depositing is the default: a page read and then left only in a terminal
/// scrollback is a page that has to be read again. `--no-db` is for the case
/// where the run is a probe and must not touch the corpus.
#[derive(clap::Args, Debug, Clone, Default)]
pub(crate) struct DepositOpts {
    /// Corpus database. Defaults to `<state>/ocr/results.db`.
    #[arg(long, global = true)]
    db: Option<PathBuf>,
    /// Do not deposit this run into the corpus database.
    #[arg(long, global = true)]
    no_db: bool,
}

impl DepositOpts {
    /// Open the corpus, unless the caller opted out.
    fn open(&self) -> miette::Result<Option<aphrody_ocr::ocr_core::store::OcrStore>> {
        if self.no_db {
            return Ok(None);
        }
        open_store(self.db.as_deref()).map(Some)
    }
}

/// Actions for the `ocr` subcommand.
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum OcrAction {
    /// Read one image and print its markdown transcription.
    ///
    /// Example: aphrody ocr page plate.jpg
    Page {
        /// Image to read.
        image: PathBuf,
        /// Catalog id of the vision model.
        #[arg(long, default_value = DEFAULT_VLM_MODEL)]
        model: String,
        /// Override the prompt handed to the model.
        #[arg(long)]
        prompt: Option<String>,
        /// Token budget for the page.
        #[arg(long, default_value_t = 1024)]
        max_tokens: u32,
        /// Include the model's raw output.
        #[arg(long)]
        raw: bool,
        /// Emit the shared aphrody.ocr.result/v2 contract in JSON output.
        #[arg(long)]
        result_v2: bool,
        #[command(flatten)]
        deposit: DepositOpts,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Read one image with local PP-OCRv5 and emit text regions plus geometry.
    ///
    /// Unlike `page`, this is deterministic CTC OCR rather than document
    /// markdown reconstruction. It never downloads weights: install the model
    /// first with `aphrody model pull ppocr-v5-mobile`.
    ///
    /// Example: aphrody ocr ppocr plate.jpg --json
    Ppocr {
        /// Image to read.
        image: PathBuf,
        /// Catalog id containing paired PP-OCR detector and recognizer weights.
        #[arg(long, default_value = DEFAULT_PPOCR_MODEL)]
        model: String,
        #[command(flatten)]
        deposit: DepositOpts,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Audit a JSONL for defects before depositing it anywhere.
    ///
    /// A deposit is hard to undo: writing four hundred plates of degenerate
    /// output into a corpus costs far more than the second this takes. Exits
    /// non-zero when a blocking defect is found (control token, stuck
    /// generation, surviving markup); watermarks are reported but do not fail.
    ///
    /// Example: aphrody ocr audit lot-001.jsonl --json
    Audit {
        /// JSONL produced by `aphrody ocr batch`.
        input: PathBuf,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Re-run the text cleanup over an existing JSONL, in place.
    ///
    /// The model output is not touched — the images are not read again. Only
    /// the parsing and filtering are redone, which is what changes when a
    /// cleanup rule is added. Use it to bring results produced before a rule
    /// existed up to the current pipeline instead of re-reading them.
    ///
    /// Example: aphrody ocr clean lot-001.jsonl --out lot-001-clean.jsonl
    Clean {
        /// JSONL produced by `aphrody ocr batch --raw`.
        input: PathBuf,
        /// Where to write the cleaned JSONL. Defaults to overwriting `input`.
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Read every image in a directory, streaming one JSON object per line.
    ///
    /// Example: aphrody ocr batch ./lot-001/images --out lot-001.jsonl
    Batch {
        /// Directory of images.
        dir: PathBuf,
        /// JSONL file to append results to. Without it, results go to stdout.
        #[arg(long)]
        out: Option<PathBuf>,
        /// Stop after this many images.
        #[arg(long)]
        limit: Option<usize>,
        /// Skip images already present in `--out`, so an interrupted run can
        /// be resumed without redoing work.
        #[arg(long)]
        skip_done: bool,
        /// Emit the shared aphrody.ocr.result/v2 JSONL contract for VLM runs.
        /// PP-OCR emits v2 already. Legacy VLM output remains the default for
        /// existing transcription cleanup tools.
        #[arg(long)]
        result_v2: bool,
        /// Which backend reads the pages.
        ///
        /// `vlm` reconstructs document structure; `ppocr` detects and decodes
        /// text regions. They fail differently: a VLM shown a page of
        /// illustrations with sparse captions can return nothing at all, which
        /// reads as "no text" while the captions are right there. Measured on
        /// databook 28 (Toriyama illustration book): dots.ocr returned an
        /// empty turn on every plate, PP-OCRv5 read the captions.
        #[arg(long, value_enum, default_value_t = Engine::Vlm)]
        engine: Engine,
        /// Catalog id of the model. Defaults per engine when left unset.
        #[arg(long)]
        model: Option<String>,
        /// Override the prompt handed to the model. `vlm` only.
        #[arg(long)]
        prompt: Option<String>,
        /// Token budget per page. `vlm` only.
        #[arg(long, default_value_t = 1024)]
        max_tokens: u32,
        /// Keep each page's raw model output in the JSONL. Costs disk, but it
        /// is what makes `aphrody ocr clean` able to re-apply a cleanup rule
        /// later without reading the images again.
        #[arg(long)]
        raw: bool,
        /// EXPERIMENTAL — keep the model resident behind a llama-server
        /// instead of spawning one process per page.
        ///
        /// Measured on this hardware with dots.ocr: the server starts and
        /// answers /health in three seconds, then no page completes. The
        /// per-process backend is what is known to work end to end, and stays
        /// the default. Do not use this for a real batch until the stall is
        /// understood.
        #[arg(long)]
        server: bool,
        /// Loopback port for --server.
        #[arg(long, default_value_t = 8791)]
        server_port: u16,
        #[command(flatten)]
        deposit: DepositOpts,
    },
    /// Query and fill the local OCR corpus database.
    ///
    /// Every read is deposited there as it happens; this is how an existing
    /// JSONL — including one produced before the database existed — is brought
    /// in, and how the corpus is queried without re-parsing every line.
    ///
    /// Example: aphrody ocr db ingest lot-001.jsonl
    Db {
        #[command(subcommand)]
        action: DbAction,
    },
    /// Transcribe a lot of Japanese reference-book scans with the safe preset.
    ///
    /// This is deliberately separate from generic `batch`: granite-docling is
    /// useful for general layout, but reads Japanese databook text as pictures.
    /// Such scans require dots.ocr and raw output so cleanup can be
    /// replayed without spending GPU time on the same scans again.
    Databooks {
        /// Directory containing one exported lot's images.
        dir: PathBuf,
        /// JSONL file to append results to. Without it, results go to stdout.
        #[arg(long)]
        out: Option<PathBuf>,
        /// Stop after this many previously unread images.
        #[arg(long)]
        limit: Option<usize>,
        /// Resume an interrupted JSONL without reading completed pages again.
        #[arg(long)]
        skip_done: bool,
        /// Emit the shared aphrody.ocr.result/v2 JSONL contract for review
        /// candidates; legacy lines remain the default.
        #[arg(long)]
        result_v2: bool,
        /// Token budget per page. Dense Japanese reference sheets need room.
        #[arg(long, default_value_t = 2048)]
        max_tokens: u32,
        /// Keep dots.ocr resident behind llama-server (experimental).
        #[arg(long)]
        server: bool,
        /// Loopback port for --server.
        #[arg(long, default_value_t = 8791)]
        server_port: u16,
        #[command(flatten)]
        deposit: DepositOpts,
    },
}

/// Actions for `aphrody ocr db`.
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum DbAction {
    /// Deposit one or more JSONL files into the corpus database.
    ///
    /// Historical lines written before the v2 contract are accepted: their
    /// path, text and explicit "no text" verdict are preserved, and no
    /// provenance is invented for them. A line that is neither shape is
    /// counted and reported, never dropped in silence.
    Ingest {
        /// JSONL files produced by `aphrody ocr batch` or `databooks`.
        #[arg(required = true)]
        inputs: Vec<PathBuf>,
        /// Database file. Defaults to `<state>/ocr/results.db`.
        #[arg(long)]
        db: Option<PathBuf>,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Report how many pages the corpus holds, per final status.
    Stats {
        /// Database file. Defaults to `<state>/ocr/results.db`.
        #[arg(long)]
        db: Option<PathBuf>,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// List stored pages, newest deposit first.
    List {
        /// Only pages in this status: `text`, `no-text`, `unreadable`,
        /// `needs-review` or `processing-error`.
        #[arg(long)]
        status: Option<String>,
        /// Cap the number of rows.
        #[arg(long, default_value_t = 50)]
        limit: u32,
        /// Database file. Defaults to `<state>/ocr/results.db`.
        #[arg(long)]
        db: Option<PathBuf>,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Print the full stored record for one page.
    Show {
        /// Page identity, as listed by `aphrody ocr db list`.
        page_id: String,
        /// Image digest, when several reads of that page id are stored.
        #[arg(long)]
        sha256: Option<String>,
        /// Database file. Defaults to `<state>/ocr/results.db`.
        #[arg(long)]
        db: Option<PathBuf>,
        #[command(flatten)]
        output: OutputOpts,
    },
}

/// Run an `ocr` action.
///
/// # Errors
///
/// Returns a `miette` report when the model or the llama.cpp runner is
/// missing, or when the output file cannot be written.
pub(crate) async fn run(action: OcrAction) -> miette::Result<()> {
    // Every action is synchronous end to end (llama.cpp runs in a child process).
    run_blocking(action)
}

/// Every `ocr` action, run on the calling thread.
///
/// This is what the pre-runtime `--server` batch path calls: it must stay
/// callable with no tokio runtime in sight.
fn run_blocking(action: OcrAction) -> miette::Result<()> {
    match action {
        OcrAction::Page {
            image,
            model,
            prompt,
            max_tokens,
            raw,
            result_v2,
            deposit,
            output,
        } => page(
            &image,
            &model,
            prompt.as_deref(),
            max_tokens,
            raw,
            result_v2,
            &deposit,
            &output,
        ),
        OcrAction::Ppocr {
            image,
            model,
            deposit,
            output,
        } => ppocr_page(&image, &model, &deposit, &output),
        OcrAction::Audit { input, output } => audit(&input, &output),
        OcrAction::Db { action } => db(action),
        OcrAction::Clean { input, out } => clean(&input, out.as_deref()),
        OcrAction::Batch {
            dir,
            out,
            limit,
            skip_done,
            result_v2,
            model,
            prompt,
            max_tokens,
            raw,
            server,
            server_port,
            engine,
            deposit,
        } => match engine {
            Engine::Vlm => batch(
                &dir,
                out.as_deref(),
                limit,
                skip_done,
                result_v2,
                model.as_deref().unwrap_or(DEFAULT_VLM_MODEL),
                prompt.as_deref(),
                max_tokens,
                raw,
                server.then_some(server_port),
                &deposit,
            ),
            Engine::Ppocr => batch_ppocr(
                &dir,
                out.as_deref(),
                limit,
                skip_done,
                model.as_deref().unwrap_or(DEFAULT_PPOCR_MODEL),
                &deposit,
            ),
        },
        OcrAction::Databooks {
            dir,
            out,
            limit,
            skip_done,
            result_v2,
            max_tokens,
            server,
            server_port,
            deposit,
        } => {
            // Same PageResult JSONL as `batch`, accepted directly by downstream tools.
            // Raw output is forced: later deterministic cleanup must not require
            // re-reading a long GPU batch.
            batch(
                &dir,
                out.as_deref(),
                limit,
                skip_done,
                result_v2,
                DEFAULT_DATABOOKS_MODEL,
                None,
                max_tokens,
                true,
                server.then_some(server_port),
                &deposit,
            )
        }
    }
}

/// Where the corpus lives when the caller names no file.
fn default_db_path() -> miette::Result<PathBuf> {
    Ok(aphrody_models::paths::ocr_dir()
        .map_err(|e| miette::miette!("locate the aphrody state directory: {e}"))?
        .join("results.db"))
}

/// Open the corpus, creating it on first use.
fn open_store(db: Option<&Path>) -> miette::Result<aphrody_ocr::ocr_core::store::OcrStore> {
    let path = match db {
        Some(path) => path.to_path_buf(),
        None => default_db_path()?,
    };
    aphrody_ocr::ocr_core::store::OcrStore::open(&path)
        .map_err(|e| miette::miette!("open {}: {e}", path.display()))
}

/// Deposit one record, reporting a failure without losing the run.
///
/// A database that cannot be written must not cost the pages already read: the
/// JSONL is the durable stream, and the store is its projection. So a deposit
/// failure is loud on stderr and non-fatal.
fn deposit(
    store: Option<&mut aphrody_ocr::ocr_core::store::OcrStore>,
    result: &aphrody_ocr::ocr_core::OcrResult,
    source: Option<&str>,
) {
    if let Some(store) = store
        && let Err(e) = store.deposit(result, source)
    {
        eprintln!("deposit failed ({}): {e}", result.page_id);
    }
}

/// Fingerprint the bytes on disk before OCR and require the same digest after
/// the backend returns. A changing scan must not acquire a false provenance.
fn image_identity(path: &Path) -> miette::Result<aphrody_ocr::ocr_core::ImageIdentity> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| miette::miette!("open {}: {error}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| miette::miette!("read {}: {error}", path.display()))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(aphrody_ocr::ocr_core::ImageIdentity {
        path: path.to_path_buf(),
        sha256: Some(
            digest
                .finalize()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
        ),
        media_type: None,
    })
}

fn ensure_unchanged_image(before: &aphrody_ocr::ocr_core::ImageIdentity) -> miette::Result<()> {
    let after = image_identity(&before.path)?;
    if after.sha256 != before.sha256 {
        return Err(miette::miette!(
            "image changed during OCR: {}",
            before.path.display()
        ));
    }
    Ok(())
}

/// Promote a VLM page result to the v2 contract, with its real provenance.
fn v2_from_page(
    result: &PageResult,
    model: &str,
    image: aphrody_ocr::ocr_core::ImageIdentity,
) -> aphrody_ocr::ocr_core::OcrResult {
    use aphrody_ocr::ocr_core::{
        Attempt, AttemptStatus, OcrResult, OcrStatus, Quality, RESULT_SCHEMA_V2, RunProvenance,
    };

    let markdown = result.text.markdown().map(ToOwned::to_owned);
    OcrResult {
        schema: RESULT_SCHEMA_V2.into(),
        page_id: result.image.to_string_lossy().into_owned(),
        image,
        attempts: vec![Attempt {
            run: RunProvenance {
                model_id: model.to_owned(),
                backend: "llama-cpp".into(),
                // The VLM path reports no execution provider of its own; a
                // guess here would be provenance the run never produced.
                provider: None,
                model_digest: None,
                prompt_digest: None,
            },
            status: AttemptStatus::Completed,
            elapsed_ms: result.elapsed_ms,
            // A generative backend returns no recognition score. Leaving this
            // empty is the contract's rule: a VLM must never claim an OCR
            // confidence it did not compute.
            quality: Quality::default(),
            error: None,
        }],
        status: if markdown.is_some() {
            OcrStatus::Text
        } else {
            OcrStatus::NoText
        },
        markdown,
        blocks: Vec::new(),
        quality: Quality::default(),
        raw: result.raw.clone(),
    }
}

/// Run an `ocr db` action.
fn db(action: DbAction) -> miette::Result<()> {
    match action {
        DbAction::Ingest { inputs, db, output } => ingest(&inputs, db.as_deref(), &output),
        DbAction::Stats { db, output } => stats(db.as_deref(), &output),
        DbAction::List {
            status,
            limit,
            db,
            output,
        } => list(status.as_deref(), limit, db.as_deref(), &output),
        DbAction::Show {
            page_id,
            sha256,
            db,
            output,
        } => show(&page_id, sha256.as_deref(), db.as_deref(), &output),
    }
}

fn ingest(inputs: &[PathBuf], db: Option<&Path>, output: &OutputOpts) -> miette::Result<()> {
    use aphrody_ocr::ocr_core::OcrResult;

    let mut store = open_store(db)?;
    let mut table = aphrody_models::Report::new(
        "OCR ingest",
        &["FILE", "READ", "INSERTED", "REPLACED", "REFUSED"],
    );
    let mut totals = (0_u64, 0_u64, 0_u64, 0_u64);

    for input in inputs {
        let file = std::fs::File::open(input)
            .map_err(|e| miette::miette!("read {}: {e}", input.display()))?;
        let mut records = Vec::new();
        let mut refused = 0_u64;
        for line in std::io::BufReader::new(file).lines() {
            let line = line.map_err(|e| miette::miette!("read {}: {e}", input.display()))?;
            if line.trim().is_empty() {
                continue;
            }
            match OcrResult::from_jsonl_line(&line) {
                Some(record) => records.push(record),
                // Counted, not skipped in silence: a line the reader cannot
                // parse is an audit anomaly, not a page without text.
                None => refused += 1,
            }
        }
        let source = input.to_string_lossy().into_owned();
        let report = store
            .deposit_all(&records, Some(&source))
            .map_err(|e| miette::miette!("deposit {}: {e}", input.display()))?;
        totals.0 += report.total();
        totals.1 += report.inserted;
        totals.2 += report.replaced;
        totals.3 += refused;
        table.push(vec![
            source,
            report.total().to_string(),
            report.inserted.to_string(),
            report.replaced.to_string(),
            refused.to_string(),
        ]);
    }

    let stats = store.stats().map_err(|e| miette::miette!("{e}"))?;
    let table = table.with_summary(format!(
        "{} record(s) deposited, {} new, {} replaced, {} refused — corpus holds {}",
        totals.0,
        totals.1,
        totals.2,
        totals.3,
        stats.total()
    ));
    let json = serde_json::json!({
        "deposited": totals.0,
        "inserted": totals.1,
        "replaced": totals.2,
        "refused": totals.3,
        "corpus": stats,
        "db": store.path().map(|path| path.display().to_string()),
    });
    output.emit_report(&table, &json)
}

fn stats(db: Option<&Path>, output: &OutputOpts) -> miette::Result<()> {
    let store = open_store(db)?;
    let stats = store.stats().map_err(|e| miette::miette!("{e}"))?;
    let mut table = aphrody_models::Report::new("OCR corpus", &["STATUS", "PAGES"])
        .with_summary(format!(
            "{} page(s), {} depositable",
            stats.total(),
            stats.depositable()
        ))
        .with_footer(
            store
                .path()
                .map_or_else(|| "in-memory".to_owned(), |path| path.display().to_string()),
        );
    table.push(vec!["text".into(), stats.text.to_string()]);
    table.push(vec!["no-text".into(), stats.no_text.to_string()]);
    table.push(vec!["unreadable".into(), stats.unreadable.to_string()]);
    table.push(vec!["needs-review".into(), stats.needs_review.to_string()]);
    table.push(vec![
        "processing-error".into(),
        stats.processing_error.to_string(),
    ]);
    let json = serde_json::to_value(stats).map_err(|e| miette::miette!("serialise stats: {e}"))?;
    output.emit_report(&table, &json)
}

fn list(
    status: Option<&str>,
    limit: u32,
    db: Option<&Path>,
    output: &OutputOpts,
) -> miette::Result<()> {
    use aphrody_ocr::ocr_core::{OcrStatus, store::ListFilter};

    let mut filter = ListFilter::default().limit(limit);
    if let Some(status) = status {
        filter.status = Some(match status {
            "text" => OcrStatus::Text,
            "no-text" => OcrStatus::NoText,
            "unreadable" => OcrStatus::Unreadable,
            "needs-review" => OcrStatus::NeedsReview,
            "processing-error" => OcrStatus::ProcessingError,
            other => {
                return Err(miette::miette!(
                    "unknown status `{other}`: expected text, no-text, unreadable, needs-review \
                     or processing-error"
                ));
            }
        });
    }
    let store = open_store(db)?;
    let pages = store.list(&filter).map_err(|e| miette::miette!("{e}"))?;
    let mut table = aphrody_models::Report::new(
        "OCR pages",
        &["PAGE", "STATUS", "BLOCKS", "CONFIDENCE", "RECORDED"],
    )
    .with_summary(format!("{} page(s)", pages.len()));
    for page in &pages {
        table.push(vec![
            page.page_id.clone(),
            format!("{:?}", page.status),
            page.blocks.to_string(),
            page.mean_confidence
                .map_or_else(|| "-".to_owned(), |confidence| format!("{confidence:.2}")),
            page.recorded_at.clone(),
        ]);
    }
    let json = serde_json::to_value(&pages).map_err(|e| miette::miette!("serialise pages: {e}"))?;
    output.emit_report(&table, &json)
}

fn show(
    page_id: &str,
    sha256: Option<&str>,
    db: Option<&Path>,
    output: &OutputOpts,
) -> miette::Result<()> {
    let store = open_store(db)?;
    let record = store
        .record(page_id, sha256)
        .map_err(|e| miette::miette!("{e}"))?
        .ok_or_else(|| miette::miette!("no stored record for `{page_id}`"))?;
    let mut table = aphrody_models::Report::new(format!("OCR {page_id}"), &["FIELD", "VALUE"]);
    table.push(vec!["status".into(), format!("{:?}", record.status)]);
    table.push(vec!["blocks".into(), record.blocks.len().to_string()]);
    table.push(vec!["path".into(), record.image.path.display().to_string()]);
    table.push(vec![
        "text".into(),
        record.markdown.clone().unwrap_or_else(|| {
            record
                .blocks
                .iter()
                .map(|block| block.text.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        }),
    ]);
    let json =
        serde_json::to_value(&record).map_err(|e| miette::miette!("serialise record: {e}"))?;
    output.emit_report(&table, &json)
}

fn ppocr_page(
    image: &Path,
    model: &str,
    deposit_opts: &DepositOpts,
    output: &OutputOpts,
) -> miette::Result<()> {
    use aphrody_ocr::ocr_core::{
        Attempt, AttemptStatus, OcrResult, OcrStatus, Quality, RESULT_SCHEMA_V2, RunProvenance,
    };

    let identity = image_identity(image)?;
    let config = aphrody_infer::SessionConfig::from_profile(&aphrody_models::accel::probe());
    let started = Instant::now();
    let run = |session: &aphrody_infer::SessionConfig| {
        let mut runner = aphrody_ocr::PpOcr::load(model, session)?;
        let regions = runner.recognise_path(image)?;
        Ok::<_, aphrody_ocr::onnx::OnnxOcrError>((regions, runner.providers()))
    };
    let (regions, providers, fallback_reason) = match run(&config) {
        Ok((regions, providers)) => (regions, providers, None),
        Err(error)
            if config
                .providers
                .first()
                .is_some_and(|provider| *provider != aphrody_models::Accelerator::Cpu) =>
        {
            let requested = config.providers[0].as_str();
            let cpu = aphrody_infer::SessionConfig::with_only(aphrody_models::Accelerator::Cpu);
            let (regions, providers) = run(&cpu).map_err(|fallback| {
                miette::miette!(
                    "PP-OCR failed on {requested} ({error}); CPU retry also failed: {fallback}"
                )
            })?;
            (
                regions,
                providers,
                Some(format!("provider fallback: {requested} failed: {error}")),
            )
        }
        Err(error) => return Err(miette::miette!("{error}")),
    };
    ensure_unchanged_image(&identity)?;
    let provider = (providers[0] == providers[1]).then(|| providers[0].as_str().to_owned());
    let blocks = regions
        .into_iter()
        .map(aphrody_ocr::PpOcr::block)
        .filter(|block| !block.text.is_empty())
        .collect::<Vec<_>>();
    let confidences = blocks
        .iter()
        .filter_map(|block| block.confidence)
        .collect::<Vec<_>>();
    let mean_confidence = (!confidences.is_empty())
        .then(|| confidences.iter().sum::<f32>() / confidences.len() as f32);
    let elapsed_ms = started.elapsed().as_millis();
    let status = if blocks.is_empty() {
        OcrStatus::NoText
    } else {
        OcrStatus::Text
    };
    let reasons = fallback_reason.into_iter().collect::<Vec<_>>();
    let result = OcrResult {
        schema: RESULT_SCHEMA_V2.into(),
        page_id: image.to_string_lossy().into_owned(),
        image: identity,
        attempts: vec![Attempt {
            run: RunProvenance {
                model_id: model.into(),
                backend: "onnx-runtime".into(),
                provider,
                model_digest: None,
                prompt_digest: None,
            },
            status: AttemptStatus::Completed,
            elapsed_ms,
            quality: Quality {
                mean_confidence,
                reasons: reasons.clone(),
            },
            error: None,
        }],
        status,
        markdown: None,
        blocks,
        quality: Quality {
            mean_confidence,
            reasons,
        },
        raw: None,
    };
    deposit(
        deposit_opts.open()?.as_mut(),
        &result,
        Some("aphrody ocr ppocr"),
    );

    let mut report =
        aphrody_models::Report::new(format!("PP-OCR {}", image.display()), &["FIELD", "VALUE"]);
    report.push(vec!["model".into(), model.into()]);
    report.push(vec!["elapsed".into(), format!("{elapsed_ms} ms")]);
    report.push(vec!["regions".into(), result.blocks.len().to_string()]);
    report.push(vec![
        "text".into(),
        result
            .blocks
            .iter()
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>()
            .join("\\n"),
    ]);
    let json = serde_json::to_value(&result)
        .map_err(|e| miette::miette!("serialise PP-OCR result: {e}"))?;
    output.emit_report(&report, &json)
}

fn options(model: &str, prompt: Option<&str>, max_tokens: u32, raw: bool) -> OcrOptions {
    // Start from the model's own defaults so the trained prompt follows the
    // model choice; an explicit --prompt still wins.
    let mut options = OcrOptions {
        max_tokens,
        keep_raw: raw,
        ..OcrOptions::for_model(model)
    };
    if let Some(prompt) = prompt {
        options.prompt = prompt.to_owned();
    }
    options
}

#[allow(clippy::too_many_arguments)] // one positional per CLI flag of `ocr page`
fn page(
    image: &Path,
    model: &str,
    prompt: Option<&str>,
    max_tokens: u32,
    raw: bool,
    result_v2: bool,
    deposit_opts: &DepositOpts,
    output: &OutputOpts,
) -> miette::Result<()> {
    let identity = image_identity(image)?;
    let runner = VlmRunner::new(options(model, prompt, max_tokens, raw))
        .map_err(|e| miette::miette!("{e}"))?;
    let result = runner.read(image).map_err(|e| miette::miette!("{e}"))?;
    ensure_unchanged_image(&identity)?;

    let record = v2_from_page(&result, model, identity);
    deposit(
        deposit_opts.open()?.as_mut(),
        &record,
        Some("aphrody ocr page"),
    );

    let json = if result_v2 {
        serde_json::to_value(&record)
    } else {
        serde_json::to_value(&result)
    }
    .map_err(|e| miette::miette!("serialise result: {e}"))?;

    let mut report =
        aphrody_models::Report::new(format!("OCR {}", image.display()), &["FIELD", "VALUE"]);
    report.push(vec!["model".into(), model.to_owned()]);
    report.push(vec!["elapsed".into(), format!("{} ms", result.elapsed_ms)]);
    report.push(vec![
        "text".into(),
        result
            .text
            .markdown()
            .map_or_else(|| "(none)".to_owned(), ToOwned::to_owned),
    ]);

    output.emit_report(&report, &json)
}

#[allow(clippy::too_many_arguments)] // one positional per CLI flag of `ocr batch`/`databooks`
fn batch(
    dir: &Path,
    out: Option<&Path>,
    limit: Option<usize>,
    skip_done: bool,
    result_v2: bool,
    model: &str,
    prompt: Option<&str>,
    max_tokens: u32,
    keep_raw: bool,
    server_port: Option<u16>,
    deposit_opts: &DepositOpts,
) -> miette::Result<()> {
    let opts = options(model, prompt, max_tokens, keep_raw);
    let mut store = deposit_opts.open()?;

    // Two backends, one loop: a resident server for throughput, a process per
    // page for isolation. The reader closure is the only thing that differs.
    let resident = match server_port {
        Some(port) => {
            eprintln!("starting llama-server on 127.0.0.1:{port} (loading {model})…");
            Some(ServerRunner::start(opts.clone(), port).map_err(|e| miette::miette!("{e}"))?)
        }
        None => None,
    };
    let runner = if resident.is_some() {
        None
    } else {
        Some(VlmRunner::new(opts.clone()).map_err(|e| miette::miette!("{e}"))?)
    };

    let done = if skip_done {
        out.map(already_done).transpose()?.unwrap_or_default()
    } else {
        std::collections::BTreeSet::new()
    };

    // Append, never truncate: resuming must not destroy the earlier pages.
    let mut sink: Box<dyn std::io::Write> = match out {
        Some(path) => {
            if let Some(parent) = path.parent()
                && !parent.as_os_str().is_empty()
            {
                std::fs::create_dir_all(parent)
                    .map_err(|e| miette::miette!("create {}: {e}", parent.display()))?;
            }
            Box::new(
                std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .map_err(|e| miette::miette!("open {}: {e}", path.display()))?,
            )
        }
        None => Box::new(std::io::stdout()),
    };

    eprintln!("reading {} with {model}", dir.display());
    if !done.is_empty() {
        eprintln!(
            "skipping {} page(s) already in {}",
            done.len(),
            out.unwrap_or(Path::new("-")).display()
        );
    }

    let mut read = 0_usize;
    let mut with_text = 0_usize;
    let mut failed = 0_usize;
    let started = std::time::Instant::now();

    // One loop over both backends: the file selection and its order have to be
    // identical, or a resumed run would skip different pages than it recorded.
    let images = aphrody_ocr::list_images_sorted(dir).map_err(|e| miette::miette!("{e}"))?;
    let pending: Vec<PathBuf> = images
        .into_iter()
        .filter(|p| !is_done_path(p, &done))
        .collect();
    let total = pending.len();

    for image in pending.into_iter().take(limit.unwrap_or(usize::MAX)) {
        let identity = match image_identity(&image) {
            Ok(identity) => identity,
            Err(error) => {
                failed += 1;
                eprintln!("page failed ({}): {error}", image.display());
                continue;
            }
        };
        let outcome = match (&resident, &runner) {
            (Some(server), _) => server.read(&image),
            (None, Some(cli)) => cli.read(&image),
            // `batch` builds exactly one of the two above.
            (None, None) => unreachable!("no OCR backend was constructed"),
        };

        match outcome {
            Ok(result) => {
                if let Err(error) = ensure_unchanged_image(&identity) {
                    failed += 1;
                    eprintln!("page failed ({}): {error}", image.display());
                    continue;
                }
                read += 1;
                if result.text.has_text() {
                    with_text += 1;
                }
                let record = v2_from_page(&result, model, identity);
                let written = if result_v2 {
                    write_line(&mut sink, &record)
                } else {
                    write_line(&mut sink, &result)
                };
                if let Err(e) = written {
                    eprintln!("write failed: {e}");
                }
                // The JSONL is written first: it is the durable stream, and a
                // store that cannot be written must never cost a read page.
                deposit(store.as_mut(), &record, Some("aphrody ocr batch"));
                if read.is_multiple_of(10) {
                    let rate = started.elapsed().as_secs_f64()
                        / f64::from(u32::try_from(read).unwrap_or(u32::MAX));
                    eprintln!(
                        "  {read}/{total} read, {with_text} with text, {failed} failed, \
                         {rate:.1}s/page"
                    );
                }
            }
            Err(e) => {
                // One unreadable plate must not cost the other 399.
                failed += 1;
                eprintln!("page failed ({}): {e}", image.display());
            }
        }
    }

    let _ = sink.flush();
    eprintln!(
        "\n{read}/{total} page(s) read in {:.1}s — {with_text} with text, {} textless, {failed} \
         failed",
        started.elapsed().as_secs_f64(),
        read.saturating_sub(with_text)
    );
    Ok(())
}

/// Read a directory with PP-OCRv5, writing v2 records one line at a time.
///
/// The model is loaded once for the whole lot — unlike the VLM path, which
/// spawns one llama.cpp process per page for crash isolation. An ONNX session
/// stays in this process, so there is no per-page load to amortise away.
fn batch_ppocr(
    dir: &Path,
    out: Option<&Path>,
    limit: Option<usize>,
    skip_done: bool,
    model: &str,
    deposit_opts: &DepositOpts,
) -> miette::Result<()> {
    let config = aphrody_infer::SessionConfig::from_profile(&aphrody_models::accel::probe());
    let mut runner = match aphrody_ocr::PpOcr::load(model, &config) {
        Ok(runner) => runner,
        Err(error)
            if config
                .providers
                .first()
                .is_some_and(|provider| *provider != aphrody_models::Accelerator::Cpu) =>
        {
            // The provider that failed is named in the warning rather than
            // swallowed: a silent CPU fallback turns a broken GPU install into
            // a mysteriously slow run.
            let requested = config.providers[0].as_str();
            eprintln!("PP-OCR could not start on {requested} ({error}); retrying on CPU");
            let cpu = aphrody_infer::SessionConfig::with_only(aphrody_models::Accelerator::Cpu);
            aphrody_ocr::PpOcr::load(model, &cpu).map_err(|e| miette::miette!("{e}"))?
        }
        Err(error) => return Err(miette::miette!("{error}")),
    };
    let providers = runner.providers();
    let mut provider = (providers[0] == providers[1]).then(|| providers[0].as_str().to_owned());

    let done = if skip_done {
        out.map(already_done).transpose()?.unwrap_or_default()
    } else {
        std::collections::BTreeSet::new()
    };

    let mut sink: Box<dyn std::io::Write> = match out {
        Some(path) => {
            if let Some(parent) = path.parent()
                && !parent.as_os_str().is_empty()
            {
                std::fs::create_dir_all(parent)
                    .map_err(|e| miette::miette!("create {}: {e}", parent.display()))?;
            }
            Box::new(
                std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .map_err(|e| miette::miette!("open {}: {e}", path.display()))?,
            )
        }
        None => Box::new(std::io::stdout()),
    };
    let mut store = deposit_opts.open()?;

    let images = aphrody_ocr::list_images_sorted(dir).map_err(|e| miette::miette!("{e}"))?;
    let pending: Vec<PathBuf> = images
        .into_iter()
        .filter(|p| !is_done_path(p, &done))
        .collect();
    let total = pending.len();
    eprintln!("reading {} with {model} (PP-OCR)", dir.display());

    let (mut read, mut with_text, mut failed) = (0_usize, 0_usize, 0_usize);
    let started = std::time::Instant::now();

    // A session that loads on the GPU can still fail on every inference: the
    // CUDA 13 ONNX Runtime build ships without cuDNN, and the missing kernel
    // only surfaces when a Conv node runs. Falling back at load time is
    // therefore not enough — measured on databook 28, where all 65 plates
    // failed one after another with the model happily loaded.
    let mut fell_back = provider.as_deref() == Some("cpu");

    for image in pending.into_iter().take(limit.unwrap_or(usize::MAX)) {
        let identity = match image_identity(&image) {
            Ok(identity) => identity,
            Err(error) => {
                failed += 1;
                eprintln!("page failed ({}): {error}", image.display());
                continue;
            }
        };
        let page_started = Instant::now();
        let mut outcome = runner.recognise_path(&image);
        if outcome.is_err() && !fell_back {
            let reason = outcome
                .as_ref()
                .err()
                .map_or_else(String::new, ToString::to_string);
            eprintln!("PP-OCR inference failed on the accelerator ({reason}); moving to CPU");
            let cpu = aphrody_infer::SessionConfig::with_only(aphrody_models::Accelerator::Cpu);
            match aphrody_ocr::PpOcr::load(model, &cpu) {
                Ok(cpu_runner) => {
                    runner = cpu_runner;
                    provider = Some("cpu".to_owned());
                    fell_back = true;
                    outcome = runner.recognise_path(&image);
                }
                Err(e) => eprintln!("CPU session could not be created either: {e}"),
            }
        }
        let regions = match outcome {
            Ok(regions) => regions,
            Err(e) => {
                // One unreadable plate must not cost the rest of the lot.
                failed += 1;
                eprintln!("page failed ({}): {e}", image.display());
                continue;
            }
        };
        if let Err(error) = ensure_unchanged_image(&identity) {
            failed += 1;
            eprintln!("page failed ({}): {error}", image.display());
            continue;
        }
        let result = ppocr_result(
            &image,
            identity,
            model,
            provider.clone(),
            regions,
            page_started,
        );
        read += 1;
        if result.status == aphrody_ocr::ocr_core::OcrStatus::Text {
            with_text += 1;
        }
        match serde_json::to_string(&result) {
            Ok(line) => {
                if let Err(e) = writeln!(sink, "{line}").and_then(|()| sink.flush()) {
                    eprintln!("write failed: {e}");
                }
            }
            Err(e) => eprintln!("serialise failed ({}): {e}", result.page_id),
        }
        deposit(
            store.as_mut(),
            &result,
            Some("aphrody ocr batch --engine ppocr"),
        );
        if read % 10 == 0 {
            eprintln!("  {read}/{total} read, {with_text} with text, {failed} failed");
        }
    }

    eprintln!(
        "\n{read}/{total} page(s) read in {:.1}s — {with_text} with text, {} textless, {failed} \
         failed",
        started.elapsed().as_secs_f64(),
        read.saturating_sub(with_text)
    );
    Ok(())
}

/// Build one v2 record from PP-OCR regions.
fn ppocr_result(
    image: &Path,
    identity: aphrody_ocr::ocr_core::ImageIdentity,
    model: &str,
    provider: Option<String>,
    regions: Vec<aphrody_ocr::RecognisedRegion>,
    started: Instant,
) -> aphrody_ocr::ocr_core::OcrResult {
    use aphrody_ocr::ocr_core::{
        Attempt, AttemptStatus, OcrResult, OcrStatus, Quality, RESULT_SCHEMA_V2, RunProvenance,
    };

    let blocks = regions
        .into_iter()
        .map(aphrody_ocr::PpOcr::block)
        .filter(|block| !block.text.is_empty())
        .collect::<Vec<_>>();
    let confidences = blocks
        .iter()
        .filter_map(|block| block.confidence)
        .collect::<Vec<_>>();
    let mean_confidence = (!confidences.is_empty())
        .then(|| confidences.iter().sum::<f32>() / confidences.len() as f32);
    let elapsed_ms = started.elapsed().as_millis();
    let mut result = OcrResult {
        schema: RESULT_SCHEMA_V2.into(),
        page_id: image.to_string_lossy().into_owned(),
        image: identity,
        attempts: vec![Attempt {
            run: RunProvenance {
                model_id: model.to_owned(),
                backend: "onnx-runtime".into(),
                provider,
                model_digest: None,
                prompt_digest: None,
            },
            status: AttemptStatus::Completed,
            elapsed_ms,
            quality: Quality {
                mean_confidence,
                reasons: Vec::new(),
            },
            error: None,
        }],
        status: if blocks.is_empty() {
            OcrStatus::NoText
        } else {
            OcrStatus::Text
        },
        markdown: None,
        blocks,
        quality: Quality {
            mean_confidence,
            reasons: Vec::new(),
        },
        raw: None,
    };
    // Detector noise goes before the furniture test, so a plate whose only
    // remaining blocks are a folio and a stray glyph is judged on what it
    // actually says. The count of dropped blocks stays on the record.
    result.drop_noise_blocks();
    // A plate of pure illustration still carries its folio. Measured on
    // databook 29: PP-OCR returns `["004", "-"]` for a full-page drawing.
    // Depositing that as the plate's text would be a wrong claim, so the
    // status says so — and the reason stays on the record, because a page
    // reclassified without a trace is a page nobody can audit.
    if result.is_page_furniture() {
        result.status = OcrStatus::NoText;
        result.quality.reasons.push("page-furniture-only".into());
    } else if result.status == OcrStatus::Text && result.content_score() < THIN_PAGE_SCORE {
        // Between a caption and a drawing lies a plate holding one stray glyph
        // — `006` and a single `公`, measured on databook 29. It is neither
        // clearly text nor clearly empty, so it goes to review rather than
        // into a public corpus, and it stays visible in the store either way.
        result.status = OcrStatus::NeedsReview;
        result.quality.reasons.push(format!(
            "thin-page: content score {}",
            result.content_score()
        ));
    }
    result
}

/// Audit a JSONL and refuse a batch that carries blocking defects.
fn audit_page(line: &str) -> Option<(PathBuf, Option<String>, bool)> {
    use aphrody_ocr::ocr_core::{OcrResult, OcrStatus};

    let record = OcrResult::from_jsonl_line(line)?;
    let text = if record.status == OcrStatus::NoText {
        None
    } else {
        record.markdown.or_else(|| {
            let joined = record
                .blocks
                .iter()
                .map(|block| block.text.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            (!joined.trim().is_empty()).then_some(joined)
        })
    };
    let blocked = matches!(
        record.status,
        OcrStatus::Unreadable | OcrStatus::NeedsReview | OcrStatus::ProcessingError
    ) || (record.status == OcrStatus::Text
        && text.as_deref().is_none_or(|text| text.trim().is_empty()));
    Some((record.image.path, text, blocked))
}

/// Audit both current OCR v2 records and historical page results.
fn audit(input: &Path, output: &OutputOpts) -> miette::Result<()> {
    let file =
        std::fs::File::open(input).map_err(|e| miette::miette!("read {}: {e}", input.display()))?;

    let mut pages: Vec<(PathBuf, Option<String>)> = Vec::new();
    let mut invalid = 0_usize;
    let mut blocked_status = 0_usize;
    for line in std::io::BufReader::new(file).lines() {
        let line = line.map_err(|e| miette::miette!("read {}: {e}", input.display()))?;
        if line.trim().is_empty() {
            continue;
        }
        if let Some((image, text, blocked)) = audit_page(&line) {
            blocked_status += usize::from(blocked);
            pages.push((image, text));
        } else {
            invalid += 1;
        }
    }

    let report = aphrody_ocr::audit::audit_batch(
        pages
            .iter()
            .map(|(image, text)| (image.clone(), text.as_deref())),
    );

    let blocking = report.has_blocking() || invalid > 0 || blocked_status > 0;
    let mut table = aphrody_models::Report::new(
        format!("Audit {}", input.display()),
        &["PAGE", "DEFECT", "DETAIL"],
    )
    .with_summary(format!(
        "{} with text, {} textless, {} finding(s) on {} page(s), {invalid} invalid, \
         {blocked_status} held by status",
        report.examined,
        report.textless,
        report.finding_count(),
        report.flagged.len()
    ))
    .with_footer(if blocking {
        "blocking defects found — do not deposit this batch".to_owned()
    } else {
        "no blocking defect".to_owned()
    });

    for page in &report.flagged {
        let name = page.image.file_name().map_or_else(
            || page.image.display().to_string(),
            |n| n.to_string_lossy().into_owned(),
        );
        for finding in &page.findings {
            let (kind, detail) = describe(finding);
            table.push(vec![name.clone(), kind.to_owned(), detail]);
        }
    }

    let mut json =
        serde_json::to_value(&report).map_err(|e| miette::miette!("serialise audit: {e}"))?;
    json["invalid"] = serde_json::json!(invalid);
    json["blocked_status"] = serde_json::json!(blocked_status);
    output.emit_report(&table, &json)?;

    if blocking {
        // Refusing here is the whole point: a deposit is hard to undo.
        return Err(miette::miette!(
            "OCR audit blocked: {} finding page(s), {invalid} invalid record(s), {blocked_status} \
             unsafe status(es)",
            report
                .flagged
                .iter()
                .filter(|p| p
                    .findings
                    .iter()
                    .any(aphrody_ocr::audit::Finding::is_blocking))
                .count()
        ));
    }
    Ok(())
}

/// Render one finding as `(kind, detail)`.
fn describe(finding: &aphrody_ocr::audit::Finding) -> (&'static str, String) {
    use aphrody_ocr::audit::Finding;
    match finding {
        Finding::ControlToken { token } => ("control-token", token.clone()),
        Finding::Loop { word, repeats } => ("loop", format!("{word} x{repeats}")),
        Finding::Markup { sample } => ("markup", sample.clone()),
        Finding::Watermark { line } => ("watermark", line.clone()),
        // `Finding` is `#[non_exhaustive]`: a new defect kind added upstream
        // must still be reported, not silently dropped from the table.
        other => ("other", format!("{other:?}")),
    }
}

/// Re-run the cleanup rules over an existing JSONL.
///
/// Only lines that kept their raw model output can be recleaned: everything
/// else has already lost the text the rules act on. Those lines pass through
/// untouched rather than being dropped, so the file stays complete and a
/// caller never silently loses pages to a maintenance command.
fn clean(input: &Path, out: Option<&Path>) -> miette::Result<()> {
    let file =
        std::fs::File::open(input).map_err(|e| miette::miette!("read {}: {e}", input.display()))?;

    let mut lines = Vec::new();
    let mut recleaned = 0_usize;
    let mut changed = 0_usize;
    let mut passthrough = 0_usize;

    for line in std::io::BufReader::new(file).lines() {
        let Ok(line) = line else { continue };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&line) else {
            // A torn last line from a killed run: keep it out rather than
            // writing back something unparseable.
            continue;
        };

        let Some(raw) = value.get("raw").and_then(serde_json::Value::as_str) else {
            passthrough += 1;
            lines.push(value);
            continue;
        };

        let before = value
            .get("text")
            .and_then(|t| t.get("markdown"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned();

        let document = aphrody_ocr::Document::parse(raw);
        let after = document.to_markdown();
        if after.as_deref().unwrap_or_default() != before {
            changed += 1;
        }
        value["text"] = match &after {
            Some(markdown) => serde_json::json!({ "kind": "text", "markdown": markdown }),
            None => serde_json::json!({ "kind": "none" }),
        };
        recleaned += 1;
        lines.push(value);
    }

    let target = out.unwrap_or(input);
    let body = lines
        .iter()
        .map(|v| serde_json::to_string(v).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(target, format!("{body}\n"))
        .map_err(|e| miette::miette!("write {}: {e}", target.display()))?;

    eprintln!(
        "{recleaned} page(s) recleaned ({changed} changed), {passthrough} without raw output kept \
         as-is -> {}",
        target.display()
    );
    if passthrough > 0 && recleaned == 0 {
        eprintln!(
            "note: no line carried `raw`; re-run the batch with --raw to make cleaning possible"
        );
    }
    Ok(())
}

/// Image paths already recorded in a JSONL file.
fn already_done(path: &Path) -> miette::Result<std::collections::BTreeSet<PathBuf>> {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        // No file yet simply means nothing is done.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(std::collections::BTreeSet::new());
        }
        Err(e) => return Err(miette::miette!("read {}: {e}", path.display())),
    };

    let mut done = std::collections::BTreeSet::new();
    for line in std::io::BufReader::new(file).lines() {
        let Ok(line) = line else { continue };
        // A run killed mid-write leaves a partial last line; skipping it is
        // correct — that page will simply be read again.
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        // Two shapes share this file: the historical `"image": "path"` and the
        // v2 record's `"image": { "path": … }`. A reader that knew only the
        // first would resume a v2 run by reading every page again.
        let recorded = match value.get("image") {
            Some(serde_json::Value::String(path)) => Some(path.clone()),
            Some(image) => image
                .get("path")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
            None => None,
        };
        if let Some(image) = recorded {
            done.insert(PathBuf::from(image));
        }
    }
    Ok(done)
}

/// Match both the absolute paths emitted by the OCR command and portable
/// basename-only records produced by downstream normalizers.
///
/// JSONL results are intentionally portable between machines, so a normalized
/// `image: "page-001.jpg"` must still resume a run whose input path is
/// `C:\\...\\images\\page-001.jpg`. Exact paths win; the basename fallback is
/// safe here because the image list is flat and a batch cannot contain two
/// different files with the same basename.
fn is_done_path(image: &Path, done: &std::collections::BTreeSet<PathBuf>) -> bool {
    if done.contains(image) {
        return true;
    }
    // Recorded paths may come from either platform: split basenames on both separators.
    portable_name(image).is_some_and(|name| {
        done.iter()
            .any(|recorded| portable_name(recorded) == Some(name))
    })
}

/// Basename of a path recorded on Linux or Windows, whatever the current platform.
fn portable_name(path: &Path) -> Option<&std::ffi::OsStr> {
    path.to_str()
        .and_then(|text| text.rsplit(['/', '\\']).next())
        .filter(|name| !name.is_empty())
        .map(std::ffi::OsStr::new)
        .or_else(|| path.file_name())
}

/// Write one result as a JSONL line and flush it.
///
/// Flushing per line is what makes `--skip-done` trustworthy after a kill.
fn write_line<T: serde::Serialize>(
    sink: &mut Box<dyn std::io::Write>,
    result: &T,
) -> std::io::Result<()> {
    let line = serde_json::to_string(result)?;
    sink.write_all(line.as_bytes())?;
    sink.write_all(b"\n")?;
    sink.flush()
}

/// Dit si `argv` désigne exactement `aphrody ocr batch --server`.
///
/// Ce chemin est entièrement synchrone : il bloque sur un processus fils et
/// sur des sockets loopback, sans toucher une seule API async. Le faire tourner
/// dans un runtime tokio ne serait pas seulement inutile — le runtime finit
/// par être détruit depuis un contexte où bloquer est interdit, ce qui panique.
/// Il est donc aiguillé AVANT qu'un runtime n'existe.
pub(crate) fn is_synchronous_server_batch(argv: &[std::ffi::OsString]) -> bool {
    let words: Vec<String> = argv
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let Some(ocr) = words.iter().position(|w| w == "ocr") else {
        return false;
    };
    words.get(ocr + 1).is_some_and(|w| w == "batch") && words.iter().any(|w| w == "--server")
}

/// Exécute `ocr batch --server` sans aucun runtime async.
///
/// Renvoie le code de sortie du processus : les échecs sont imprimés plutôt que
/// propagés, puisque le rapport d'erreurs habituel de la CLI n'est pas encore
/// en place à ce stade.
pub(crate) fn run_sync_server_batch(argv: &[std::ffi::OsString]) -> i32 {
    use clap::Parser as _;

    #[derive(clap::Parser)]
    struct Shim {
        #[command(subcommand)]
        command: Wrapper,
    }
    #[derive(clap::Subcommand)]
    enum Wrapper {
        Ocr {
            #[command(subcommand)]
            action: OcrAction,
        },
    }

    // On ne parse que le sous-ensemble accepté ici ; le reste a déjà été écarté
    // par `is_synchronous_server_batch`.
    let parsed = match Shim::try_parse_from(argv) {
        Ok(parsed) => parsed,
        Err(e) => {
            let _ = e.print();
            return 2;
        }
    };
    let Wrapper::Ocr { action } = parsed.command;

    match run_blocking(action) {
        Ok(()) => 0,
        Err(report) => {
            eprintln!("aphrody: {report:?}");
            70 // EX_SOFTWARE (sysexits.h)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_reads_v2_text_and_holds_uncertain_status() {
        let text = serde_json::json!({
            "schema": "aphrody.ocr.result/v2",
            "page_id": "42/0001.jpg",
            "image": {"path": "42/0001.jpg"},
            "status": "text",
            "markdown": "悟空",
            "blocks": [],
            "quality": {"mean_confidence": 0.9, "reasons": []}
        });
        let (path, content, blocked) = audit_page(&text.to_string()).unwrap();
        assert_eq!(path, PathBuf::from("42/0001.jpg"));
        assert_eq!(content.as_deref(), Some("悟空"));
        assert!(!blocked);

        let mut uncertain = text;
        uncertain["status"] = serde_json::json!("needs-review");
        assert!(audit_page(&uncertain.to_string()).unwrap().2);
    }

    #[test]
    fn options_carry_the_overrides_through() {
        let opts = options("dots-ocr", Some("read it"), 512, true);
        assert_eq!(opts.model_id, "dots-ocr");
        assert_eq!(opts.prompt, "read it");
        assert_eq!(opts.max_tokens, 512);
        assert!(opts.keep_raw);
    }

    #[test]
    fn options_without_a_prompt_keep_the_trained_instruction() {
        let opts = options("granite-docling-258m", None, 1024, false);
        assert!(opts.prompt.contains("docling"), "{}", opts.prompt);
    }

    #[test]
    fn databooks_preset_uses_the_japanese_ocr_model_contract() {
        let opts = options("dots-ocr", None, 2048, true);
        assert_eq!(opts.model_id, "dots-ocr");
        assert_eq!(opts.max_tokens, 2048);
        assert!(opts.keep_raw);
        assert_eq!(opts.prompt, "Extract all text from this image.");
    }

    #[test]
    fn resume_reads_back_the_images_already_recorded() {
        let dir = tempfile::tempdir().unwrap();
        let jsonl = dir.path().join("out.jsonl");
        std::fs::write(
            &jsonl,
            "{\"image\":\"a.jpg\",\"text\":{\"kind\":\"none\"}}\n{\"image\":\"b.jpg\",\"text\":{\"\
             kind\":\"text\",\"markdown\":\"hi\"}}\n",
        )
        .unwrap();

        let done = already_done(&jsonl).unwrap();
        assert_eq!(done.len(), 2);
        assert!(done.contains(&PathBuf::from("a.jpg")));
        assert!(done.contains(&PathBuf::from("b.jpg")));
    }

    #[test]
    fn a_truncated_last_line_is_skipped_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let jsonl = dir.path().join("out.jsonl");
        // Exactly what a process killed mid-write leaves behind.
        std::fs::write(&jsonl, "{\"image\":\"a.jpg\"}\n{\"image\":\"b.jp").unwrap();
        let done = already_done(&jsonl).unwrap();
        assert_eq!(done, [PathBuf::from("a.jpg")].into_iter().collect());
    }

    #[test]
    fn resume_matches_portable_basenames_against_input_paths() {
        let done = [PathBuf::from("a.jpg")].into_iter().collect();
        assert!(is_done_path(Path::new(r"C:\images\a.jpg"), &done));
        assert!(!is_done_path(Path::new(r"C:\images\b.jpg"), &done));
    }

    #[test]
    fn an_absent_resume_file_means_nothing_is_done() {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            already_done(&dir.path().join("absent.jsonl"))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn cleaning_reapplies_the_rules_to_lines_that_kept_their_raw_output() {
        let dir = tempfile::tempdir().unwrap();
        let jsonl = dir.path().join("in.jsonl");
        // A watermark that predates the rule: `text` still carries it, `raw`
        // is what the rule can act on.
        std::fs::write(
            &jsonl,
            "{\"image\":\"a.jpg\",\"raw\":\"宿敵\\ncapsulecommentary.com\",\"text\":{\"kind\":\"\
             text\",\"markdown\":\"宿敵\\ncapsulecommentary.com\"}}\n",
        )
        .unwrap();

        let out = dir.path().join("out.jsonl");
        clean(&jsonl, Some(&out)).unwrap();

        let written = std::fs::read_to_string(&out).unwrap();
        let value: serde_json::Value = serde_json::from_str(written.trim()).unwrap();
        let markdown = value["text"]["markdown"].as_str().unwrap();
        assert!(markdown.contains("宿敵"), "{markdown}");
        assert!(!markdown.contains("capsulecommentary"), "{markdown}");
    }

    #[test]
    fn cleaning_keeps_lines_without_raw_output_instead_of_dropping_them() {
        let dir = tempfile::tempdir().unwrap();
        let jsonl = dir.path().join("in.jsonl");
        std::fs::write(
            &jsonl,
            "{\"image\":\"a.jpg\",\"text\":{\"kind\":\"text\",\"markdown\":\"gardé\"}}\n{\"image\"\
             :\"b.jpg\",\"text\":{\"kind\":\"none\"}}\n",
        )
        .unwrap();

        let out = dir.path().join("out.jsonl");
        clean(&jsonl, Some(&out)).unwrap();

        // A maintenance command must never silently lose pages.
        let written = std::fs::read_to_string(&out).unwrap();
        assert_eq!(written.lines().count(), 2, "{written}");
        assert!(written.contains("gardé"), "{written}");
    }

    #[test]
    fn cleaning_defaults_to_rewriting_the_input() {
        let dir = tempfile::tempdir().unwrap();
        let jsonl = dir.path().join("in.jsonl");
        std::fs::write(&jsonl, "{\"image\":\"a.jpg\",\"raw\":\"texte réel\"}\n").unwrap();
        clean(&jsonl, None).unwrap();
        let written = std::fs::read_to_string(&jsonl).unwrap();
        assert!(written.contains("texte réel"), "{written}");
    }
}
