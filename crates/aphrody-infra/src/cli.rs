//! `aphrody infra` (former `aphrody-infra` binary): unified infra/workflow orchestrator CLI.

use crate::{ServiceAction, devenv, reclaim, validate};
use anyhow::{Context, Result, bail};
use aphrody_proc::NoWindow as _;
use clap::{Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Parser)]
#[command(
    name = "bunos-infra",
    version,
    about = "Bun OS unified infrastructure and workflow orchestrator"
)]
struct Cli {
    #[arg(long, env = "APHRODY_INFRA_ROOT", default_value = ".")]
    root: PathBuf,
    #[command(subcommand)]
    command: CommandKind,
}

#[derive(Debug, Subcommand)]
enum CommandKind {
    /// Show target, repository and runtime state without mutation.
    Status {
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Run the existing deep resource inventory through the canonical Bun adapter.
    Inventory {
        #[arg(long)]
        json: bool,
    },
    /// Inspect or maintain first-party Cargo workspaces from the Rust control plane.
    Maintenance {
        #[arg(value_enum, default_value_t = MaintenanceAction::Scan)]
        action: MaintenanceAction,
        /// Catalogued sibling repository. Required for mutating actions.
        #[arg(long)]
        repo: Option<String>,
        /// Apply update, fix or clean after printing the exact command.
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        json: bool,
    },
    /// Resolve and run declared Bun quality scripts from the Rust control plane.
    Quality {
        #[arg(value_enum, default_value_t = QualityStage::Plan)]
        stage: QualityStage,
        /// Catalogued sibling repository. Required when running a stage.
        #[arg(long)]
        repo: Option<String>,
        /// Execute the resolved package script; without it, print the plan only.
        #[arg(long)]
        run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Check the local development toolchain and repository contracts.
    Doctor {
        #[arg(long)]
        json: bool,
        /// Exit non-zero when a required pinned tool or Aphrody executable is unavailable.
        #[arg(long)]
        strict: bool,
    },
    /// Print the actions that a synchronization would perform.
    Sync {
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        apply: bool,
    },
    /// Run a deploy adapter. Mutation requires --apply and an explicit target.
    Deploy {
        #[arg(long)]
        target: String,
        /// Existing stack adapter, or one verified application bound to its catalog id.
        #[arg(long, value_enum, default_value_t = DeployStack::Aphrody)]
        stack: DeployStack,
        /// Release directory on the target, below the stack's release root.
        #[arg(long)]
        release: Option<String>,
        /// Canonical service id for --stack app.
        #[arg(long, requires = "source")]
        id: Option<String>,
        /// Source checkout providing the existing application artifact validator.
        #[arg(long)]
        source: Option<PathBuf>,
        /// Successful application build report, interpreted by its artifact owner.
        #[arg(long)]
        build_report: Option<PathBuf>,
        /// Qualified native Bun executable on the selected execution host.
        #[arg(long, default_value = "bun")]
        bun: String,
        /// Run the application adapter on this explicitly selected target host.
        #[arg(long)]
        local: bool,
        #[arg(long)]
        apply: bool,
    },
    /// Check cross-catalog invariants (services, nginx routes, port policy).
    Validate {
        #[arg(long)]
        json: bool,
    },
    /// Reclaim allowlisted disk/tmpfs space on a target; root-level steps run through sudo -n
    /// (infra/config/disk-reclaim.json).
    Reclaim {
        #[arg(long)]
        target: String,
        #[arg(long)]
        apply: bool,
    },
    /// Validate or provision the declared development environment.
    DevEnv {
        /// Inspect/install the optional developer CLI catalog on this host.
        #[arg(long)]
        developer_cli: bool,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        apply: bool,
        /// Run on this Linux host instead of over ssh/docker (package set: vps, dbfr or wsl).
        #[arg(long, value_name = "HOST")]
        local: Option<String>,
    },
    /// Manage cataloged services lifecycle (catalog, status, start, stop, restart, journal).
    Service {
        #[arg(value_enum)]
        action: crate::lifecycle::ServiceAction,
        /// Workload id from infra/config/service-catalog.json (or all if omitted).
        #[arg(long)]
        id: Option<String>,
        /// Remote target (default: "vps" or "local" if on Linux).
        #[arg(long, default_value = "vps")]
        target: String,
        #[arg(long)]
        json: bool,
    },
    /// Persistence at boot: plan, apply or audit the unified desired state (systemd, Docker, Windows tasks and services).
    Boot {
        #[arg(value_enum)]
        action: crate::boot::BootAction,
        /// Host of the desired state (vps, dbfr, local); all hosts when omitted.
        #[arg(long)]
        host: Option<String>,
        /// Only this entry, by name (`Container`, `nginx.service`) or label (`local:Container`).
        #[arg(long)]
        entry: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Probe an HTTP or TCP endpoint health.
    Probe {
        /// Target URL or address (e.g. http://127.0.0.1:8083/healthz or tcp://127.0.0.1:15433).
        endpoint: String,
        /// Timeout in seconds (default: 5).
        #[arg(long, default_value_t = 5)]
        timeout: u64,
        /// Optional remote target host (e.g. "vps"). If omitted, probes locally.
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Execute declared monorepo validation stages.
    Pipeline {
        /// Target stage from infra/config/pipeline.json, or plan/check.
        #[arg(long, default_value = "plan")]
        stage: String,
        #[arg(long)]
        json: bool,
    },
    /// Launch the embedded HTTP API daemon.
    Serve {
        #[arg(long, default_value_t = 8787)]
        port: u16,
        #[arg(long, default_value = "vps")]
        target: String,
    },
    /// Remote SSH operator: execute commands, audit host health, sysctl kernel tuning, port inspection.
    Ssh {
        #[arg(long, global = true, default_value_t = false)]
        json: bool,
        #[command(subcommand)]
        command: aphrody_ssh::Commands,
    },
    /// Inspect local or remote Git repository status, remotes and commits.
    Git {
        /// Path to target repository (default: current directory).
        #[arg(long, default_value = ".")]
        repo: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Audit local workspace Git state and GitHub forks, branches, PRs, commits, releases and packages.
    WorkspaceGitAudit {
        /// Sibling source workspace; defaults to the parent of --root.
        #[arg(long)]
        workspace_root: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Ecosystem CI workflow distribution and audit across repositories.
    Ci {
        /// Target repository or path (default: current directory).
        #[arg(long, default_value = ".")]
        repo: PathBuf,
        /// Source ref or immutable commit SHA (default: main).
        #[arg(long, default_value = "main")]
        source_ref: String,
        /// Apply changes (default: plan only).
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        json: bool,
    },
    /// Native WireGuard (wg, wg-quick, WireGuardNT) for the private tunnel.
    Wg {
        #[arg(long, global = true)]
        json: bool,
        #[command(subcommand)]
        command: crate::tunnel::WgCommand,
    },
    /// Remote control over the private tunnel: desktop (WebSocket + VNC), VNC client, status, credentials.
    Remote {
        #[command(subcommand)]
        command: crate::remote::RemoteCommand,
    },
    /// Render or check nginx configuration from the typed model (`nginx.rs`); writes no run manifest.
    Nginx {
        #[command(subcommand)]
        command: NginxCommand,
    },
    /// Native Mullvad VPN controller and auto-proxy geo-unblock driver.
    Vpn {
        #[command(subcommand)]
        command: VpnCommand,
    },
    /// Unified ecosystem workflow execution and stage orchestration.
    Workflow {
        /// Target workflow stage (plan, format, lint, types, unit-and-ui, build, release, live).
        #[arg(default_value = "plan")]
        stage: String,
        #[arg(long)]
        json: bool,
    },
    /// Sovereign autonomous YOLO engine (polyglot verification, mapper, doctor, plan).
    Yolo {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Virtual Distributed Filesystem (VDFS) engine: mounts, ls, tree, cat, git overview.
    Drive {
        #[command(subcommand)]
        command: DriveCommand,
    },
    /// Native OVHcloud management: DNS zones & records, email deliverability, VPS operations.
    Ovh {
        #[command(subcommand)]
        command: aphrody_ovh::OvhCommand,
    },
    /// Sovereign secret management: audit leaks, contract check, envelope encrypt/decrypt, systemd render.
    Secrets {
        #[command(subcommand)]
        command: crate::secrets::SecretsCommand,
    },
    /// Idempotent provisioning of the Bun OS repositories on the owned Gitea forge.
    Gitea {
        #[command(subcommand)]
        command: GiteaCommand,
    },
}

#[derive(Debug, Subcommand)]
enum GiteaCommand {
    /// Ensure declared repositories, Actions, account key and VPS deploy keys exist.
    Provision {
        #[arg(long)]
        apply: bool,
        /// Restrict provisioning to one repository declared in the plan.
        #[arg(long)]
        repository: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Idempotently admit and synchronize one bounded public Aphrody Labs mirror batch.
    Mirrors {
        #[arg(long)]
        apply: bool,
        #[arg(long, default_value = "wave-1")]
        batch: String,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum QualityStage {
    Plan,
    Format,
    Lint,
    Typecheck,
    Test,
    Build,
    Audit,
    Fix,
    Export,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum MaintenanceAction {
    Scan,
    Update,
    Fix,
    Clean,
}

#[derive(Debug, Subcommand)]
enum NginxCommand {
    /// Render a JSON `NginxConfig` (upstreams, servers, locations) to nginx syntax on stdout.
    Render {
        /// JSON file, or `-` for stdin.
        #[arg(default_value = "-")]
        config: String,
        /// Lines written first as `# ` comments.
        #[arg(long)]
        comment: Vec<String>,
    },
    /// Check a configuration file with `nginx -t -c <path> -q`, or with `--docker` a server
    /// file (`conf.d` content) in a disposable nginx container (no bind mount) with its
    /// includes from the parent of its directory (repository mirror of `/etc/nginx`) and
    /// throwaway `/etc/letsencrypt` stand-ins, on any host with Docker.
    Test {
        path: PathBuf,
        /// Container image for the check (`nginx:alpine` when the flag has no value).
        #[arg(long, num_args = 0..=1, default_missing_value = "nginx:alpine", value_name = "IMAGE")]
        docker: Option<String>,
    },
}

#[derive(Debug, Subcommand)]
enum VpnCommand {
    /// Show current Mullvad VPN connection status and egress details.
    Status {
        #[arg(long)]
        json: bool,
    },
    /// Connect the VPN tunnel, optionally setting relay location (e.g. us, ch, se).
    Connect {
        /// Country or relay location code (e.g. us, ch, se).
        location: Option<String>,
    },
    /// Disconnect the VPN tunnel.
    Disconnect,
    /// Print resolved SOCKS5 proxy target for VPS tunnel routing.
    ProxyTarget {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Subcommand)]
enum DriveCommand {
    /// List active virtual mounts in the VDFS engine.
    Mounts {
        #[arg(long)]
        json: bool,
    },
    /// List directory contents of a virtual mount URI (e.g. vdfs://vps/var/www or vdfs://local/crates).
    Ls {
        /// URI to list (e.g. vdfs://vps/var/www, vdfs://local/crates, local:src).
        uri: String,
        #[arg(long)]
        json: bool,
    },
    /// Display recursive tree of a virtual mount URI.
    Tree {
        /// URI to inspect (e.g. vdfs://vps/var/www, vdfs://local/crates).
        uri: String,
        /// Maximum traversal depth.
        #[arg(long, default_value_t = 3)]
        depth: usize,
        #[arg(long)]
        json: bool,
    },
    /// Read/cat file content from a virtual mount URI.
    Cat {
        /// URI of the file to display.
        uri: String,
    },
    /// Inspect consolidated Git status, commit graph and worktrees for a Git mount.
    Git {
        /// Mount identifier (default: "git").
        #[arg(long, default_value = "git")]
        mount: String,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ValueEnum)]
#[serde(rename_all = "kebab-case")]
enum DeployStack {
    /// One verified native application using the canonical service and ingress catalogs.
    App,
    /// Five-service Aphrody stack (site, Web API, A2A, AI HTTP, E5).
    Aphrody,
    /// Internal compute only (AI HTTP, E5, managed llama companion).
    AphrodyCompute,
}

impl DeployStack {
    /// Directory below which qualified hosts keep stack releases.
    fn release_root(self) -> String {
        let layout = &*crate::layout::HOST_LAYOUT;
        match self {
            Self::App => format!("{}/releases/", layout.app("bun-os")),
            Self::Aphrody | Self::AphrodyCompute => format!("{}/releases/", layout.app("aphrody")),
        }
    }

    /// Adapter installed by `scripts/tools/install-vps-adapter.sh`.
    fn adapter(self) -> &'static str {
        match self {
            Self::App => "",
            Self::Aphrody | Self::AphrodyCompute => "/usr/local/sbin/aphrody-infra-deploy-aphrody",
        }
    }

    /// Environment variable overriding the adapter path (tests, staging hosts).
    fn adapter_env(self) -> &'static str {
        match self {
            Self::App => "",
            Self::Aphrody | Self::AphrodyCompute => "APHRODY_REMOTE_DEPLOY_ADAPTER",
        }
    }

    /// What the adapter verifies before it switches anything.
    fn requires(self) -> &'static [&'static str] {
        match self {
            Self::App => &[
                "catalog id, host and listener declared by Aphrody Infra",
                "artifact owner verifies build report, manifest, executable digests and native doctor",
                "protected app environment, isolated persistent data and payload cache",
                "native service health before public ingress activation",
            ],
            Self::Aphrody => &[
                "explicit --apply",
                "SMOKE.json attestation matching the release SHA256SUMS",
                "0600 /etc/aphrody env files (provision-aphrody-stack-env.sh)",
                "preloaded E5 weights, Gemini Web cookie, aphrody.com TLS",
                "live health proof, rollback to the previous current",
            ],
            Self::AphrodyCompute => &[
                "explicit --apply",
                "aphrody-compute-smoke/v1 attestation bound to RELEASE_ID and SHA256SUMS",
                "fresh E5 vectors, Recall@5 >= 0.8, zero retrieval errors",
                "0600 /etc/aphrody/aphrody-ai-http.env, real managed model and readable LoRA",
                "only aphrody-ai-http and the E5 embedding service; site, Web and A2A inactive",
                "live private API, embedding and LLM proof; rollback of the selected services",
            ],
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Matrix {
    schema_version: u32,
    generated_at: String,
    targets: Vec<Target>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Target {
    id: String,
    kind: String,
    os: String,
    #[serde(default)]
    root: Option<String>,
    #[serde(default)]
    roots: Vec<String>,
    #[serde(default)]
    application_roots: Vec<String>,
    #[serde(default)]
    consumers: Vec<String>,
    #[serde(default)]
    authority: String,
    #[serde(default)]
    toolchain: Vec<String>,
    #[serde(default)]
    gui_policy: Option<String>,
    #[serde(default)]
    revision: Option<String>,
}

struct Run {
    root: PathBuf,
    dir: PathBuf,
    actions: Vec<Value>,
}

impl Run {
    fn start(root: &Path, scope: &str) -> Result<Self> {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
        let dir = root
            .join("var")
            .join("runs")
            .join(format!("{stamp}-{}", std::process::id()));
        for child in ["pending", "results", "logs", "evidence"] {
            fs::create_dir_all(dir.join(child))?;
        }
        let manifest = json!({
            "run_id": dir.file_name().and_then(|v| v.to_str()).unwrap_or("unknown"),
            "requested_scope": scope,
            "tool_versions": {},
            "inputs": [],
            "actions": [],
            "outputs": [],
            "status": "running",
            "evidence": []
        });
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        Ok(Self {
            root: root.to_path_buf(),
            dir,
            actions: Vec::new(),
        })
    }

    fn action(&mut self, name: &str, status: &str, detail: impl Into<Value>) {
        self.actions
            .push(json!({ "name": name, "status": status, "detail": detail.into() }));
    }

    fn finish(self, status: &str, outputs: Vec<Value>) -> Result<()> {
        let path = self.dir.join("manifest.json");
        let mut manifest: Value = serde_json::from_slice(&fs::read(&path)?)?;
        manifest["actions"] = Value::Array(self.actions);
        manifest["outputs"] = Value::Array(outputs);
        manifest["status"] = Value::String(status.to_owned());
        fs::write(path, serde_json::to_vec_pretty(&manifest)?)?;
        Ok(())
    }
}

fn command(root: &Path, program: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(program)
        .no_window()
        .args(args)
        .current_dir(root)
        .output()
        .with_context(|| format!("exécution impossible: {program}"))?;
    if !output.status.success() {
        bail!(
            "{} {:?} a échoué (code {:?}): {}",
            program,
            args,
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// Use the same selected source root as the run, including explicit `--root`.
fn load_matrix(root: &Path) -> Result<Matrix> {
    let path = root.join("infra/config/host/inventory/targets.json");
    let bytes = fs::read(&path).with_context(|| format!("manifest absent: {}", path.display()))?;
    serde_json::from_slice(&bytes).with_context(|| format!("{} invalide", path.display()))
}

/// Local Linux build/test container (Ubuntu 26.04, glibc 2.43); replaces the removed WSL Ubuntu-24.04.
const LINUX_BUILD_IMAGE: &str = "aphrody/build-linux:26.04";

fn selected<'a>(matrix: &'a Matrix, id: Option<&str>) -> Result<Vec<&'a Target>> {
    let targets: Vec<_> = matrix
        .targets
        .iter()
        .filter(|t| id.is_none_or(|wanted| t.id == wanted))
        .collect();
    if targets.is_empty() {
        bail!("cible inconnue: {}", id.unwrap_or("<aucune>"));
    }
    Ok(targets)
}

fn git_revision(path: &Path) -> Option<String> {
    let repo = gix::discover(path).ok()?;
    let head = repo.head_id().ok()?;
    head.shorten().ok().map(|prefix| prefix.to_string())
}

fn live_status(target: &Target) -> Option<Value> {
    let (program, args): (&str, Vec<&str>) = match target.id.as_str() {
        "vps" => (
            "ssh",
            vec![
                "vps",
                "systemctl list-units --type=service --state=running --no-legend --plain | wc -l; systemctl --failed --no-legend | wc -l; df -P / /tmp | tail -n +2",
            ],
        ),
        "dbfr" => (
            "ssh",
            vec![
                "dbfr",
                "systemctl list-units --type=service --state=running --no-legend | grep -Ei 'nier|nie|web' || true",
            ],
        ),
        "linux-container-26.04" => (
            "docker",
            vec![
                "run",
                "--rm",
                "--cpus",
                "6",
                "--memory",
                "6g",
                LINUX_BUILD_IMAGE,
                "bash",
                "-lc",
                "rustc --version; bun --version; uv --version",
            ],
        ),
        _ => return None,
    };
    let output = Command::new(program).no_window().args(args).output().ok()?;
    Some(json!({
        "ok": output.status.success(),
        "stdout": String::from_utf8_lossy(&output.stdout).trim(),
        "stderr": String::from_utf8_lossy(&output.stderr).trim()
    }))
}

fn local_target(target: &Target) -> Value {
    let paths = target
        .roots
        .iter()
        .chain(target.root.iter())
        .map(PathBuf::from)
        .chain(target.application_roots.iter().map(PathBuf::from));
    let roots: Vec<_> = paths.map(|path| json!({ "path": path, "exists": path.exists(), "revision": git_revision(&path) })).collect();
    json!({ "id": target.id, "kind": target.kind, "os": target.os, "roots": roots, "authority": target.authority })
}

fn status(target_id: Option<&str>, as_json: bool, run: &mut Run) -> Result<()> {
    let matrix = load_matrix(&run.root)?;
    let targets: Vec<Value> = selected(&matrix, target_id)?.into_iter().map(|target| {
        let result = if matches!(target.id.as_str(), "windows-local" | "nie-local-data" | "nie-repo") {
            local_target(target)
        } else {
            json!({ "id": target.id, "kind": target.kind, "os": target.os, "roots": target.roots, "applicationRoots": target.application_roots, "authority": target.authority, "toolchain": target.toolchain, "guiPolicy": target.gui_policy, "revision": target.revision, "live": live_status(target) })
        };
        run.action("status", "observed", result.clone());
        result
    }).collect();
    let observed_at = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let result = json!({ "schemaVersion": matrix.schema_version, "sourceGeneratedAt": matrix.generated_at, "observedAtEpoch": observed_at, "targets": targets });
    if as_json {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        println!(
            "observed at epoch {observed_at} (source {})",
            matrix.generated_at
        );
        for target in &targets {
            let field = |key: &str| {
                target
                    .get(key)
                    .and_then(Value::as_str)
                    .unwrap_or("-")
                    .to_owned()
            };
            let live = target
                .get("live")
                .map_or_else(|| "-".to_owned(), Value::to_string);
            println!(
                "{:<20} {:<12} {:<10} {live}",
                field("id"),
                field("kind"),
                field("os")
            );
        }
    }
    Ok(())
}

fn quality_script(stage: QualityStage, scripts: &serde_json::Map<String, Value>) -> Option<String> {
    let candidates: &[&str] = match stage {
        QualityStage::Format => &["format:check", "fmt:check", "format", "fmt"],
        QualityStage::Lint => &["lint"],
        QualityStage::Typecheck => &["typecheck", "type-check", "check"],
        QualityStage::Test => &["test"],
        QualityStage::Build => &["build"],
        QualityStage::Audit => &[
            "audit:imports",
            "audit:scripts",
            "audit:architecture",
            "monorepo:audit",
            "deps:audit",
        ],
        QualityStage::Fix => &["lint:fix", "bun:fix", "fix"],
        QualityStage::Export => &["manga:ocr:export"],
        QualityStage::Plan => &[],
    };
    candidates
        .iter()
        .find_map(|name| scripts.contains_key(*name).then(|| (*name).to_owned()))
}

fn quality(
    root: &Path,
    stage: QualityStage,
    repo: Option<&str>,
    execute: bool,
    as_json: bool,
    run: &mut Run,
) -> Result<()> {
    if execute && matches!(stage, QualityStage::Plan) {
        bail!("plan ne peut pas être exécuté");
    }
    if execute && repo.is_none() {
        bail!("--repo est requis avec --run");
    }
    let repositories = workspace_repositories(root, repo)?;
    let mut rows = Vec::new();
    for (name, path) in repositories {
        let manifest_path = path.join("package.json");
        if !manifest_path.is_file() {
            continue;
        }
        let manifest: Value = serde_json::from_slice(&fs::read(&manifest_path)?)?;
        let scripts = manifest["scripts"].as_object().cloned().unwrap_or_default();
        let script = quality_script(stage, &scripts);
        let available = [
            QualityStage::Format,
            QualityStage::Lint,
            QualityStage::Typecheck,
            QualityStage::Test,
            QualityStage::Build,
            QualityStage::Audit,
            QualityStage::Fix,
            QualityStage::Export,
        ]
        .iter()
        .filter_map(|kind| quality_script(*kind, &scripts))
        .collect::<Vec<_>>();
        let mut row =
            json!({ "repo": name, "path": path, "available": available, "selected": script });
        if execute {
            let Some(script) = script else {
                bail!("{} ne déclare pas de script pour {:?}", row["repo"], stage);
            };
            let output = Command::new("bun")
                .no_window()
                .args(["run", &script])
                .current_dir(&path)
                .output()
                .with_context(|| format!("bun run {script} dans {}", path.display()))?;
            row["executed"] = Value::Bool(true);
            row["success"] = Value::Bool(output.status.success());
            if !output.status.success() {
                bail!(
                    "bun run {script} a échoué dans {}: {}",
                    path.display(),
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
        }
        rows.push(row);
    }
    let workspace_count = rows.len();
    let available_scripts = rows
        .iter()
        .map(|row| row["available"].as_array().map_or(0, Vec::len))
        .sum::<usize>();
    let output = json!({ "stage": format!("{stage:?}").to_lowercase(), "run": execute, "summary": { "workspaces": workspace_count, "managedScripts": available_scripts }, "repositories": rows });
    if as_json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        for row in output["repositories"].as_array().unwrap_or(&vec![]) {
            println!(
                "{}: {}",
                row["repo"].as_str().unwrap_or("-"),
                row["selected"].as_str().unwrap_or("-")
            );
        }
    }
    run.action("quality", "success", output);
    Ok(())
}

/// Resolve the first-party workspace without treating former source repo names as
/// aliases for a consolidated root (maintenance may mutate the selected repo).
fn workspace_repositories(root: &Path, requested: Option<&str>) -> Result<Vec<(String, PathBuf)>> {
    if root.join("crates/infra/infra/Cargo.toml").is_file() {
        let manifest: Value = serde_json::from_slice(&fs::read(root.join("package.json"))?)?;
        let name = manifest["name"]
            .as_str()
            .context("root package.json has no name")?;
        if requested.is_some_and(|wanted| wanted != name) {
            bail!(
                "dépôt non catalogué: {} (workspace consolidé: {name})",
                requested.unwrap()
            );
        }
        return Ok(vec![(name.to_owned(), root.to_path_buf())]);
    }
    let workspace = root
        .parent()
        .context("le dépôt Infra doit avoir une racine workspace parente")?;
    let catalog_path = [
        root.join("docs/ecosystem/ecosystem.json"),
        root.join("docs/reference/infra/ecosystem/ecosystem.json"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .context("catalogue ecosystem.json introuvable")?;
    let catalog: Value = serde_json::from_slice(&fs::read(&catalog_path)?)?;
    let known: std::collections::BTreeSet<String> = catalog["repos"]
        .as_array()
        .context("catalogue ecosystem.json sans repos")?
        .iter()
        .filter_map(|entry| entry["name"].as_str().map(str::to_owned))
        .collect();
    if requested.is_some_and(|wanted| !known.contains(wanted)) {
        bail!("dépôt non catalogué: {}", requested.unwrap());
    }
    Ok(known
        .into_iter()
        .filter(|name| requested.is_none_or(|wanted| wanted == name))
        .map(|name| {
            let path = workspace.join(&name);
            (name, path)
        })
        .collect())
}

fn maintenance_repositories(
    root: &Path,
    requested: Option<&str>,
) -> Result<Vec<(String, PathBuf)>> {
    Ok(workspace_repositories(root, requested)?
        .into_iter()
        .filter(|(_, path)| path.join("Cargo.toml").is_file())
        .collect())
}

fn maintenance(
    root: &Path,
    action: MaintenanceAction,
    repo: Option<&str>,
    apply: bool,
    as_json: bool,
    run: &mut Run,
) -> Result<()> {
    if !matches!(action, MaintenanceAction::Scan) && repo.is_none() {
        bail!("--repo est requis pour update, fix et clean");
    }
    let repositories = maintenance_repositories(root, repo)?;
    if repositories.is_empty() {
        bail!("aucun workspace Cargo catalogué trouvé");
    }
    let mut rows = Vec::new();
    for (name, path) in repositories {
        let dirty = Command::new("git")
            .no_window()
            .args(["status", "--porcelain=v1"])
            .current_dir(&path)
            .output()
            .map(|output| !output.stdout.is_empty())
            .unwrap_or(true);
        let lockfile = path.join("Cargo.lock");
        let mut row =
            json!({ "repo": name, "path": path, "dirty": dirty, "lockfile": lockfile.is_file() });
        match action {
            MaintenanceAction::Scan => {
                let output = Command::new("cargo")
                    .no_window()
                    .args(["metadata", "--locked", "--no-deps", "--format-version=1"])
                    .current_dir(&path)
                    .output();
                let metadata_ok = output.as_ref().is_ok_and(|result| result.status.success());
                row["metadataOk"] = Value::Bool(metadata_ok);
                if let Ok(result) = output {
                    row["metadataBytes"] = json!(result.stdout.len());
                }
            }
            MaintenanceAction::Update | MaintenanceAction::Fix | MaintenanceAction::Clean => {
                if dirty {
                    bail!("{name} est sale; maintenance refusée");
                }
                let args: Vec<&str> = match action {
                    MaintenanceAction::Update => {
                        if apply {
                            vec!["update"]
                        } else {
                            vec!["update", "--dry-run"]
                        }
                    }
                    MaintenanceAction::Fix => {
                        if apply {
                            vec!["fix", "--workspace", "--all-targets"]
                        } else {
                            vec!["fix", "--workspace", "--all-targets", "--allow-no-vcs"]
                        }
                    }
                    MaintenanceAction::Clean => {
                        if apply {
                            vec!["clean", "--workspace"]
                        } else {
                            vec!["clean", "--workspace", "--dry-run"]
                        }
                    }
                    MaintenanceAction::Scan => unreachable!(),
                };
                row["command"] = json!(format!("cargo {}", args.join(" ")));
                row["applied"] = Value::Bool(apply);
                if apply {
                    let output = Command::new("cargo")
                        .no_window()
                        .args(&args)
                        .current_dir(&path)
                        .output()
                        .with_context(|| format!("cargo maintenance {name}"))?;
                    if !output.status.success() {
                        bail!(
                            "cargo {} a échoué pour {name}: {}",
                            args.join(" "),
                            String::from_utf8_lossy(&output.stderr).trim()
                        );
                    }
                }
            }
        }
        rows.push(row);
    }
    let output = json!({ "action": format!("{action:?}").to_lowercase(), "apply": apply, "repositories": rows });
    if as_json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        for row in output["repositories"].as_array().unwrap_or(&vec![]) {
            println!(
                "{} {}",
                row["repo"].as_str().unwrap_or("-"),
                row["command"].as_str().unwrap_or("scanned")
            );
        }
    }
    run.action("maintenance", "success", output);
    Ok(())
}

fn observed_command(tool: &str, args: &[&str]) -> Value {
    match Command::new(tool).no_window().args(args).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let version = stdout
                .lines()
                .chain(stderr.lines())
                .find(|line| !line.trim().is_empty())
                .unwrap_or("")
                .trim()
                .to_owned();
            json!({ "tool": tool, "available": output.status.success(), "version": version })
        }
        Err(error) => {
            json!({ "tool": tool, "available": false, "error": error.kind().to_string() })
        }
    }
}

fn local_binary_check(name: &str) -> Value {
    let Some(home) = std::env::var_os("HOME") else {
        return json!({ "name": name, "available": false, "path": null });
    };
    let path = PathBuf::from(home).join(".local/bin").join(name);
    json!({ "name": name, "available": path.is_file(), "path": path })
}

fn user_unit_check(name: &str) -> Value {
    let enabled = Command::new("systemctl")
        .no_window()
        .args(["--user", "is-enabled", name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    let active = Command::new("systemctl")
        .no_window()
        .args(["--user", "is-active", name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    json!({ "name": name, "enabled": enabled, "active": active })
}

fn doctor(root: &Path, as_json: bool, strict: bool, run: &mut Run) -> Result<()> {
    let pins = devenv::load(root, "wsl")?;
    let expected = [
        (
            "rustc",
            vec!["--version"],
            Some(format!("rustc {}", pins.rust_channel)),
        ),
        ("bun", vec!["--version"], Some(pins.bun)),
        ("uv", vec!["--version"], Some(pins.uv)),
        ("nu", vec!["--version"], None),
        ("git", vec!["--version"], None),
        ("cargo", vec!["--version"], None),
        ("ssh", vec!["-V"], None),
        ("gh", vec!["--version"], None),
    ];
    let tools: Vec<_> = expected
        .iter()
        .map(|(tool, args, wanted)| {
            let mut check = observed_command(tool, args);
            let version = check["version"].as_str().unwrap_or("");
            let matches_pin = wanted.as_ref().is_none_or(|pin| version.contains(pin));
            check["expected"] = wanted.as_ref().map_or(Value::Null, |pin| json!(pin));
            check["matchesPin"] = Value::Bool(matches_pin);
            check
        })
        .collect();
    let executables: Vec<_> = [
        "aphrody",
        "aphrody-mcp",
        "aphrody-kernel",
        "aphrody-google",
        "aphrody-infra",
        "aphrody-ssh",
        "aphrody-yolo",
        "n2b",
    ]
    .iter()
    .map(|name| local_binary_check(name))
    .collect();
    let codex = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(".codex/config.toml"))
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|config| {
            json!({
                "configPresent": true,
                "approvalNever": config.contains("approval_policy = \"never\""),
                "unrestrictedFilesystem": config.contains("sandbox_mode = \"danger-full-access\""),
                "aphrodyPluginEnabled": config.contains("[plugins.\"aphrody@aphrody-ai\"]\nenabled = true"),
            })
        })
        .unwrap_or_else(|| json!({ "configPresent": false }));
    let source_sync = user_unit_check("aphrody-source-sync.service");
    let matrix = load_matrix(&run.root)?;
    let failures = tools.iter().any(|tool| {
        !tool["available"].as_bool().unwrap_or(false)
            || !tool["matchesPin"].as_bool().unwrap_or(false)
    }) || executables
        .iter()
        .any(|binary| !binary["available"].as_bool().unwrap_or(false));
    let result = json!({
        "root": root,
        "manifest": "ok",
        "tools": tools,
        "executables": executables,
        "codex": codex,
        "userServices": [source_sync],
        "targets": matrix.targets.len(),
        "healthy": !failures,
    });
    run.action("doctor", "observed", result.clone());
    println!("{}", serde_json::to_string_pretty(&result)?);
    if !as_json {
        println!("doctor: manifestes, pins, exécutables, Codex et unités utilisateur inspectés");
    }
    if strict && failures {
        bail!("doctor strict: outil requis, pin ou exécutable Aphrody indisponible");
    }
    Ok(())
}

fn sync(root: &Path, target_id: Option<&str>, apply: bool, run: &mut Run) -> Result<()> {
    let matrix = load_matrix(&run.root)?;
    let targets = selected(&matrix, target_id)?;
    for target in targets {
        let detail = json!({ "target": target.id, "mode": if apply { "apply" } else { "plan" }, "policy": "preserve-dirty-worktrees" });
        if apply && target.id == "windows-local" {
            for path in target.roots.iter().map(PathBuf::from) {
                if path.join(".git").exists() {
                    let state = command(
                        root,
                        "git",
                        &["-C", path.to_str().unwrap_or("."), "status", "--short"],
                    )?;
                    run.action(
                        "sync.git.status",
                        "observed",
                        json!({ "path": path, "dirty": !state.is_empty() }),
                    );
                }
            }
        }
        run.action(
            "sync",
            if apply { "applied" } else { "planned" },
            detail.clone(),
        );
        println!("{}", serde_json::to_string(&detail)?);
    }
    Ok(())
}

fn gh_count(value: &Value) -> usize {
    value.as_array().map_or_else(
        || {
            value
                .get("total_count")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize
        },
        Vec::len,
    )
}

async fn gh_surfaces(
    client: &aphrody_git::GitHubClient,
    repo: &aphrody_git::GitHubRepository,
) -> Value {
    let base = format!("/repos/{}", repo.full_name());
    let routes = [
        ("metadata", base.clone()),
        ("forks", format!("{base}/forks?per_page=100&sort=newest")),
        ("branches", format!("{base}/branches?per_page=100")),
        (
            "pulls",
            format!("{base}/pulls?state=all&sort=updated&direction=desc&per_page=100"),
        ),
        ("commits", format!("{base}/commits?per_page=20")),
        ("releases", format!("{base}/releases?per_page=100")),
    ];
    let mut surfaces = serde_json::Map::new();
    for (name, route) in routes {
        let result = match client
            .request(aphrody_git::ApiMethod::Get, &route, None)
            .await
        {
            Ok(response) if name == "metadata" => json!({
                "status": response.status,
                "data": {
                    "full_name": response.body["full_name"], "default_branch": response.body["default_branch"],
                    "fork": response.body["fork"], "forks_count": response.body["forks_count"],
                    "open_issues_count": response.body["open_issues_count"], "watchers_count": response.body["watchers_count"],
                    "stargazers_count": response.body["stargazers_count"], "pushed_at": response.body["pushed_at"],
                    "license": response.body["license"]["spdx_id"], "html_url": response.body["html_url"]
                }
            }),
            Ok(response) => {
                let body = response.body;
                let mut data = json!({ "returned": gh_count(&body) });
                if name == "pulls" {
                    data["open_in_returned_page"] = body
                        .as_array()
                        .map(|rows| rows.iter().filter(|row| row["state"] == "open").count())
                        .map_or(Value::Null, |n| json!(n));
                    data["sample"] = body.as_array().map(|rows| rows.iter().take(5).map(|row| json!({"number":row["number"],"title":row["title"],"state":row["state"],"url":row["html_url"]})).collect::<Vec<_>>()).map_or(Value::Null, |v| json!(v));
                } else if name == "branches" {
                    data["sample"] = body.as_array().map(|rows| rows.iter().take(20).map(|row| json!({"name":row["name"],"sha":row["commit"]["sha"],"protected":row["protected"]})).collect::<Vec<_>>()).map_or(Value::Null, |v| json!(v));
                } else if name == "forks" {
                    data["sample"] = body.as_array().map(|rows| rows.iter().take(20).map(|row| json!({"full_name":row["full_name"],"url":row["html_url"],"updated_at":row["updated_at"]})).collect::<Vec<_>>()).map_or(Value::Null, |v| json!(v));
                } else if name == "commits" {
                    data["sample"] = body.as_array().map(|rows| rows.iter().take(10).map(|row| json!({"sha":row["sha"],"date":row["commit"]["committer"]["date"],"message":row["commit"]["message"],"url":row["html_url"]})).collect::<Vec<_>>()).map_or(Value::Null, |v| json!(v));
                } else if name == "releases" {
                    data["sample"] = body.as_array().map(|rows| rows.iter().take(20).map(|row| json!({"tag":row["tag_name"],"name":row["name"],"published_at":row["published_at"],"url":row["html_url"],"assets":row["assets"].as_array().map_or(0, Vec::len)})).collect::<Vec<_>>()).map_or(Value::Null, |v| json!(v));
                }
                json!({"status":response.status,"data":data})
            }
            Err(error) => json!({"error":error.to_string()}),
        };
        surfaces.insert(name.to_owned(), result);
    }
    json!({"repository":repo.full_name(),"surfaces":surfaces})
}

async fn workspace_git_audit(
    root: &Path,
    workspace_root: Option<&Path>,
    as_json: bool,
    run: &mut Run,
) -> Result<()> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let workspace = workspace_root
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.parent().unwrap_or(root).to_path_buf());
    let base_client = aphrody_git::GitHubClient::from_env().context("create GitHub client")?;
    let client = if base_client.is_authenticated() {
        base_client
    } else {
        let token = Command::new("gh")
            .no_window()
            .args(["auth", "token"])
            .output()
            .ok()
            .filter(|out| out.status.success())
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .map(|token| token.trim().to_owned())
            .filter(|token| !token.is_empty());
        if token.is_some() {
            aphrody_git::GitHubClient::new(
                token,
                std::env::var("GITHUB_API_URL")
                    .unwrap_or_else(|_| "https://api.github.com".to_owned()),
            )
            .context("create authenticated GitHub client")?
        } else {
            base_client
        }
    };
    let mut report = json!({"workspace":workspace,"authenticated":client.is_authenticated(),"repositories":[],"submodules":[],"github_packages":{},"awesome_rust":null,"graphql":null,"notes":[]});
    let entries = fs::read_dir(&workspace)
        .with_context(|| format!("lire le workspace {}", workspace.display()))?;
    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "aphrody-ui" || !(name.starts_with("aphrody-") || name == "bun") {
            continue;
        }
        let path = entry.path();
        if path.is_dir() && (path.join(".git").exists() || path.join("Cargo.toml").exists()) {
            paths.push((name, path));
        }
    }
    paths.sort_by(|a, b| a.0.cmp(&b.0));
    let mut module_rows = Vec::new();
    for (name, path) in paths {
        let local = match aphrody_git::inspect_repository(&path) {
            Ok(value) => value,
            Err(error) => {
                report["notes"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"repository":name,"error":error.to_string()}));
                continue;
            }
        };
        let branches = aphrody_git::list_branches(&path).unwrap_or_default();
        let commits = aphrody_git::commit_log(&path, 20).unwrap_or_default();
        let graph = aphrody_git::commit_graph(&path, 30).ok();
        let worktrees = aphrody_git::list_worktrees(&path).unwrap_or_default();
        let mut row = json!({"name":name,"path":path,"branch":local.branch,"head":local.head,"dirty":local.dirty,"changes":local.changes.len(),"remotes":local.remotes,"local_branches":branches.iter().filter(|b|!b.is_remote).count(),"cached_remote_branches":branches.iter().filter(|b|b.is_remote).count(),"branches":branches,"recent_commits":commits,"commit_graph_nodes":graph.map_or(0,|g|g.commits.len()),"worktrees":worktrees});
        if let Some(repo) = local.github.as_ref() {
            row["github"] = gh_surfaces(&client, repo).await;
        }
        if let Ok(modules) = fs::read_to_string(path.join(".gitmodules")) {
            let mut section = String::new();
            let mut module_path = String::new();
            let mut url = String::new();
            let mut parsed = Vec::new();
            let flush = |parsed: &mut Vec<(String, String, String)>,
                         section: &str,
                         module_path: &str,
                         url: &str| {
                if !module_path.is_empty() {
                    parsed.push((section.to_owned(), module_path.to_owned(), url.to_owned()));
                }
            };
            for line in modules.lines() {
                let line = line.trim();
                if line.starts_with("[submodule ") {
                    flush(&mut parsed, &section, &module_path, &url);
                    section = line
                        .trim_start_matches("[submodule ")
                        .trim_end_matches(']')
                        .trim_matches('"')
                        .to_owned();
                    module_path.clear();
                    url.clear();
                } else if let Some(value) = line.strip_prefix("path = ") {
                    module_path = value.to_owned();
                } else if let Some(value) = line.strip_prefix("url = ") {
                    url = value.to_owned();
                }
            }
            flush(&mut parsed, &section, &module_path, &url);
            for (module_name, module_path, url) in parsed {
                let checkout = aphrody_git::inspect_repository(path.join(&module_path)).ok();
                let parent = Path::new(&module_path)
                    .parent()
                    .and_then(Path::to_str)
                    .unwrap_or("");
                let leaf = Path::new(&module_path)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let gitlink = aphrody_git::list_tree_at(
                    &path,
                    local.head.as_deref(),
                    if parent.is_empty() {
                        None
                    } else {
                        Some(parent)
                    },
                )
                .ok()
                .and_then(|nodes| {
                    nodes
                        .into_iter()
                        .find(|node| node.name == leaf && node.mode == 0o160000)
                });
                let parsed_repo = aphrody_git::GitHubRepository::parse(&url).ok();
                let mut module = json!({"parent":name,"name":module_name,"path":module_path,"url":url,"gitlink":gitlink.map(|node|node.oid),"initialized":checkout.is_some(),"head":checkout.as_ref().and_then(|value|value.head.clone()),"dirty":checkout.as_ref().map(|value|value.dirty)});
                if let Some(repo) = parsed_repo.as_ref() {
                    module["github"] = gh_surfaces(&client, repo).await;
                }
                module_rows.push(module);
            }
        }
        report["repositories"].as_array_mut().unwrap().push(row);
    }
    report["submodules"] = json!(module_rows);
    for kind in ["container", "docker", "maven", "npm", "nuget", "rubygems"] {
        let route = format!("/users/aphrody-code/packages?package_type={kind}&per_page=100");
        let value = match client
            .request(aphrody_git::ApiMethod::Get, &route, None)
            .await
        {
            Ok(response) => {
                json!({"status":response.status,"count":gh_count(&response.body),"packages":response.body})
            }
            Err(error) => json!({"error":error.to_string()}),
        };
        report["github_packages"][kind] = value;
    }
    match aphrody_git::fetch_awesome_list("rust").await {
        Ok(index) => {
            let matches = index
                .search("cargo")
                .into_iter()
                .take(100)
                .collect::<Vec<_>>();
            report["awesome_rust"] = json!({"repository":index.repository,"categories":index.categories.len(),"total_items":index.total_items,"cargo_matches":matches});
        }
        Err(error) => report["notes"]
            .as_array_mut()
            .unwrap()
            .push(json!({"awesome_rust_error":error.to_string()})),
    }
    let query = json!({"query":"query { viewer { login repositories(first: 100, ownerAffiliations: OWNER, orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { name url isFork isPrivate defaultBranchRef { name } } } } }"});
    match client.graphql(&query).await {
        Ok(value) => {
            report["graphql"] = json!({"login":value.pointer("/viewer/login"),"owned_repository_count":value.pointer("/viewer/repositories/totalCount"),"repositories":value.pointer("/viewer/repositories/nodes")})
        }
        Err(error) => report["notes"]
            .as_array_mut()
            .unwrap()
            .push(json!({"graphql_error":error.to_string()})),
    }
    let output = root.join("target/research/github-audit.json");
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&output, serde_json::to_vec_pretty(&report)?)?;
    run.action("workspace-github-audit","observed",json!({"workspace":workspace,"report":output,"repositories":report["repositories"].as_array().map_or(0,Vec::len),"submodules":report["submodules"].as_array().map_or(0,Vec::len),"authenticated":client.is_authenticated()}));
    if as_json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!("Audit GitHub écrit dans {}", output.display());
        println!(
            "Dépôts : {}; sous-modules : {}; auth : {}",
            report["repositories"].as_array().map_or(0, Vec::len),
            report["submodules"].as_array().map_or(0, Vec::len),
            client.is_authenticated()
        );
    }
    Ok(())
}

fn dev_env_local(root: &Path, host: &str, apply: bool, run: &mut Run) -> Result<()> {
    if !matches!(host, "vps" | "dbfr" | "wsl") {
        bail!("--local attend vps, dbfr ou wsl: {host}");
    }
    let report = run_remote(
        "bash",
        &["-s"],
        &devenv::script(&devenv::load(root, host)?, apply)?,
    )?;
    print!("{report}");
    run.action(
        "dev-env",
        if apply { "applied" } else { "checked" },
        json!({ "target": format!("local:{host}"), "report": report }),
    );
    Ok(())
}

fn dev_env(root: &Path, target_id: Option<&str>, apply: bool, run: &mut Run) -> Result<()> {
    let matrix = load_matrix(&run.root)?;
    let targets = selected(&matrix, target_id)?;
    for target in targets {
        let (host, program, args): (&str, &str, Vec<&str>) = match target.id.as_str() {
            "vps" => (
                "vps",
                "ssh",
                vec!["-o", "BatchMode=yes", "vps", "bash", "-s"],
            ),
            "dbfr" => (
                "dbfr",
                "ssh",
                vec!["-o", "BatchMode=yes", "dbfr", "bash", "-s"],
            ),
            "linux-container-26.04" => (
                "wsl",
                "docker",
                vec![
                    "run",
                    "--rm",
                    "-i",
                    "--cpus",
                    "6",
                    "--memory",
                    "6g",
                    LINUX_BUILD_IMAGE,
                    "bash",
                    "-s",
                ],
            ),
            _ => {
                if target_id.is_some() {
                    bail!(
                        "dev-env ne provisionne que les hôtes Linux natifs (vps, dbfr, linux-container-26.04): {}",
                        target.id
                    );
                }
                continue;
            }
        };
        let pins = devenv::load(root, host)?;
        let report = run_remote(program, &args, &devenv::script(&pins, apply)?)?;
        println!("== {}", target.id);
        print!("{report}");
        run.action(
            "dev-env",
            if apply { "applied" } else { "checked" },
            json!({ "target": target.id, "report": report }),
        );
    }
    Ok(())
}

/// A release below the stack root whose path segments are plain names: the path is
/// forwarded to a remote shell by ssh, so `.`, `..`, spaces and metacharacters are refused.
fn release_path_is_valid(release: &str, stack: DeployStack) -> bool {
    release
        .strip_prefix(stack.release_root().as_str())
        .is_some_and(|id| {
            !id.is_empty()
                && id.split('/').all(|part| {
                    !part.is_empty()
                        && part != "."
                        && part != ".."
                        && part
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
                })
        })
}

fn deploy_target_is_supported(target: &str, stack: DeployStack) -> bool {
    stack != DeployStack::App && target == "vps"
}

/// `ssh` arguments running the selected host's adapter as root, never prompting.
fn remote_adapter_args<'a>(target: &'a str, adapter: &'a str, release: &'a str) -> [&'a str; 7] {
    [
        "-o",
        "BatchMode=yes",
        target,
        "sudo",
        "-n",
        adapter,
        release,
    ]
}

/// Select the existing adapter's compute mode without activating the full stack.
fn remote_stack_adapter_args<'a>(
    target: &'a str,
    stack: DeployStack,
    adapter: &'a str,
    release: &'a str,
) -> Vec<&'a str> {
    let mut args = remote_adapter_args(target, adapter, release).to_vec();
    if stack == DeployStack::AphrodyCompute {
        args.insert(args.len() - 1, "--compute-only");
    }
    args
}

fn deploy(
    target: &str,
    stack: DeployStack,
    release: Option<&str>,
    apply: bool,
    run: &mut Run,
) -> Result<()> {
    if stack == DeployStack::App {
        bail!("Application deployment uses the native catalog-bound owner");
    }
    let matrix = load_matrix(&run.root)?;
    let _ = selected(&matrix, Some(target))?;
    let adapter = std::env::var(stack.adapter_env()).unwrap_or_else(|_| stack.adapter().to_owned());
    let detail = json!({ "target": target, "stack": stack, "release": release, "releaseRoot": stack.release_root(), "mode": if apply { "apply" } else { "plan" }, "adapter": adapter, "requires": stack.requires() });
    run.action(
        "deploy",
        if apply { "delegated" } else { "planned" },
        detail.clone(),
    );
    println!("{}", serde_json::to_string_pretty(&detail)?);
    if apply {
        if !deploy_target_is_supported(target, stack) {
            bail!(
                "déploiement refusé: adaptateur non qualifié pour la cible {target} et la pile {stack:?}"
            );
        }
        let release = release.context("--release est obligatoire avec --apply")?;
        if !release_path_is_valid(release, stack) {
            bail!("release refusée: chemin hors de la racine de la pile ou contenant '.'/'..'");
        }
        // Each adapter re-verifies its preconditions (the Aphrody one its SMOKE.json
        // attestation) and rolls its stack back on failure.
        let output = Command::new("ssh")
            .no_window()
            .args(remote_stack_adapter_args(target, stack, &adapter, release))
            .output()
            .with_context(|| format!("ssh {target} indisponible"))?;
        if !output.status.success() {
            bail!(
                "déploiement distant échoué: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        run.action(
            "deploy.remote",
            "success",
            json!({ "target": target, "release": release, "stdout": String::from_utf8_lossy(&output.stdout).trim() }),
        );
        println!("{}", String::from_utf8_lossy(&output.stdout).trim());
    }
    Ok(())
}

fn nginx_command(command: &NginxCommand) -> Result<()> {
    match command {
        NginxCommand::Render { config, comment } => {
            let raw = if config == "-" {
                let mut raw = String::new();
                std::io::Read::read_to_string(&mut std::io::stdin(), &mut raw)?;
                raw
            } else {
                fs::read_to_string(config).with_context(|| format!("lecture de {config}"))?
            };
            print!("{}", render_nginx(&raw, comment)?);
            Ok(())
        }
        NginxCommand::Test { path, docker: None } => {
            crate::NginxConfig::test_syntax(path).map_err(|error| anyhow::anyhow!(error))
        }
        NginxCommand::Test {
            path,
            docker: Some(image),
        } => {
            let report =
                crate::nginx::test_in_container(path, image).map_err(anyhow::Error::msg)?;
            eprintln!("{report}");
            Ok(())
        }
    }
}

fn render_nginx(raw: &str, comment: &[String]) -> Result<String> {
    let config: crate::NginxConfig =
        serde_json::from_str(raw).context("configuration nginx JSON invalide")?;
    let mut out = String::new();
    for line in comment {
        out.push_str(&format!("# {line}\n"));
    }
    out.push_str(&config.render());
    Ok(out)
}

fn validate_catalogs(root: &Path, as_json: bool, run: &mut Run) -> Result<()> {
    let mut report = validate::run(root)?;
    let catalog = crate::catalog::load_service_catalog(root)?;
    report.errors.extend(validate::check_unit_templates(
        &root.join("infra/config/host/systemd"),
        &catalog,
    ));
    run.action(
        "validate",
        if report.errors.is_empty() {
            "success"
        } else {
            "failed"
        },
        json!(&report),
    );
    if as_json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!("{} services, {} routes", report.services, report.routes);
        for error in &report.errors {
            println!("error: {error}");
        }
        for warning in &report.warnings {
            println!("warning: {warning}");
        }
    }
    if !report.errors.is_empty() {
        bail!("{} invariant(s) violé(s)", report.errors.len());
    }
    Ok(())
}

/// Pipe `script` to a remote shell's stdin and return its stdout.
fn run_remote(program: &str, args: &[&str], script: &str) -> Result<String> {
    let output = Command::new(program)
        .no_window()
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .expect("stdin piped")
                .write_all(script.as_bytes())?;
            child.wait_with_output()
        })
        .with_context(|| format!("{program} {args:?} indisponible"))?;
    if !output.status.success() {
        bail!(
            "exécution distante échouée ({program}): {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn reclaim_disk(root: &Path, target_id: &str, apply: bool, run: &mut Run) -> Result<()> {
    let config = reclaim::load(root)?;
    let target = config
        .targets
        .get(target_id)
        .with_context(|| format!("cible absente de infra/config/disk-reclaim.json: {target_id}"))?;
    let script = reclaim::script(target, apply)?;
    let stdout = run_remote(
        "ssh",
        &["-o", "BatchMode=yes", &target.ssh_alias, "sh", "-s"],
        &script,
    )?;
    let mut total = 0u64;
    let mut entries = Vec::new();
    for line in stdout.lines() {
        let Some((bytes, label)) = line.split_once('\t') else {
            continue;
        };
        let bytes: u64 = bytes.trim().parse().unwrap_or(0);
        total += bytes;
        let system_paths = target.system.iter().flat_map(|s| s.paths.iter());
        let fallback = if label.starts_with("system:") {
            "root-level cleanup through sudo -n"
        } else {
            "tmpfs entries older than the threshold"
        };
        let reason = target
            .paths
            .iter()
            .chain(system_paths)
            .find(|e| e.path == label)
            .map_or(fallback, |e| e.reason.as_str());
        println!(
            "{:>8.2} GiB  {label}  ({reason})",
            bytes as f64 / 1024f64.powi(3)
        );
        entries.push(json!({ "path": label, "bytes": bytes }));
    }
    let mode = if apply {
        "reclaimed"
    } else {
        "reclaimable (plan, rerun with --apply)"
    };
    println!("{:>8.2} GiB  total {mode}", total as f64 / 1024f64.powi(3));
    run.action(
        "reclaim",
        if apply { "applied" } else { "planned" },
        json!({ "target": target_id, "totalBytes": total, "entries": entries }),
    );
    Ok(())
}

fn service_probe(
    target_id: &str,
    url: &str,
    timeout_secs: u32,
) -> Result<crate::probe::ProbeResult> {
    if crate::lifecycle::is_local_target(target_id) {
        Ok(crate::probe::probe_url(
            url,
            std::time::Duration::from_secs(u64::from(timeout_secs)),
        ))
    } else {
        crate::probe::probe_remote(target_id, url, timeout_secs)
    }
}

fn service_health(
    root: &Path,
    id: Option<&str>,
    target_id: &str,
    as_json: bool,
    run: &mut Run,
) -> Result<()> {
    let catalog = crate::catalog::load_service_catalog(root)?;
    let mut results: Vec<Value> = Vec::new();
    for service in catalog
        .services
        .iter()
        .filter(|service| !service.is_retired())
        .filter(|service| id.is_none_or(|wanted| wanted == service.id))
    {
        if let Some(url) = service.health.as_deref() {
            let probe = service_probe(target_id, url, 8)?;
            results.push(
                json!({ "id": service.id, "required": service.is_required(), "probe": probe }),
            );
        }
    }
    if results.is_empty() {
        bail!("aucun service actif avec health correspondant");
    }
    let failed = results.iter().any(|result| {
        result["required"] == Value::Bool(true) && result["probe"]["ok"] == Value::Bool(false)
    });
    if as_json {
        println!("{}", serde_json::to_string_pretty(&results)?);
    } else {
        for result in &results {
            println!(
                "{} {}",
                result["id"].as_str().unwrap_or("-"),
                if result["probe"]["ok"] == Value::Bool(true) {
                    "UP"
                } else {
                    "DOWN"
                }
            );
        }
    }
    run.action(
        "service.health",
        if failed { "failed" } else { "success" },
        json!({ "target": target_id, "results": results }),
    );
    if failed {
        bail!("au moins un service requis est indisponible");
    }
    Ok(())
}

fn service_prewarm(root: &Path, target_id: &str, as_json: bool, run: &mut Run) -> Result<()> {
    let catalog = crate::catalog::load_service_catalog(root)?;
    let service = catalog
        .services
        .iter()
        .find(|service| service.id == "nie-model-serve")
        .context("nie-model-serve absent du catalogue")?;
    if service.is_retired() {
        bail!("nie-model-serve est retiré du catalogue actif");
    }
    let base = service
        .health
        .as_deref()
        .context("health nie-model-serve absente")?
        .trim_end_matches("/health");
    let codes = [
        "c01000010",
        "c01000020",
        "c01000030",
        "c01000040",
        "c01000050",
        "c01000060",
        "k000010",
        "ka001901",
    ];
    let health = service_probe(target_id, &format!("{base}/health"), 8)?;
    if !health.ok {
        bail!(
            "nie-model-serve indisponible: {}",
            health.error.unwrap_or_default()
        );
    }
    let items: Vec<Value> = codes.iter().map(|code| {
        let probe = service_probe(target_id, &format!("{base}/model-full/{code}.glb"), 15)?;
        Ok(json!({ "code": code, "ok": probe.ok, "status": probe.status, "durationMs": probe.duration_ms }))
    }).collect::<Result<Vec<_>>>()?;
    let success = items
        .iter()
        .filter(|item| item["ok"] == Value::Bool(true))
        .count();
    let output =
        json!({ "target": base, "success": success, "total": items.len(), "items": items });
    if as_json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("prewarm {success}/{}", codes.len());
    }
    run.action(
        "service.prewarm",
        if success == codes.len() {
            "success"
        } else {
            "failed"
        },
        output,
    );
    if success != codes.len() {
        bail!("préchargement incomplet");
    }
    Ok(())
}

fn service_lifecycle(
    root: &Path,
    action: ServiceAction,
    id: Option<&str>,
    target_id: &str,
    as_json: bool,
    run: &mut Run,
) -> Result<()> {
    match action {
        ServiceAction::Catalog => {
            let catalog_path = root.join("infra/config/service-catalog.json");
            let content = fs::read_to_string(&catalog_path)
                .with_context(|| format!("lecture {}", catalog_path.display()))?;
            if as_json {
                let parsed: Value = serde_json::from_str(&content)?;
                println!("{}", serde_json::to_string_pretty(&parsed)?);
            } else {
                println!("{}", content.trim());
            }
            run.action("service.catalog", "success", json!({ "target": target_id }));
            Ok(())
        }
        ServiceAction::Health => service_health(root, id, target_id, as_json, run),
        ServiceAction::Prewarm => service_prewarm(root, target_id, as_json, run),
        ServiceAction::Status => {
            let statuses = crate::lifecycle::get_service_statuses(root, target_id, id)?;
            if as_json {
                println!("{}", serde_json::to_string_pretty(&statuses)?);
            } else {
                for s in &statuses {
                    println!(
                        "- {:<24} {:<6} {}",
                        s.id,
                        if s.active { "UP" } else { "DOWN" },
                        s.state
                    );
                }
            }
            run.action(
                "service.status",
                "success",
                json!({ "target": target_id, "results": statuses }),
            );
            Ok(())
        }
        _ => {
            let results = crate::lifecycle::execute_lifecycle(root, action, id, target_id)?;
            if as_json {
                println!("{}", serde_json::to_string_pretty(&results)?);
            } else {
                for r in &results {
                    let msg = r.message.as_deref().unwrap_or("");
                    if r.success {
                        println!("ok: {} {} ({}) {}", r.action, r.unit, r.id, msg);
                    } else {
                        eprintln!("fail: {} {} ({}) {}", r.action, r.unit, r.id, msg);
                    }
                }
            }
            let all_ok = results.iter().all(|r| r.success);
            run.action(
                "service.action",
                if all_ok { "success" } else { "failed" },
                json!({ "target": target_id, "results": results }),
            );
            if !all_ok {
                bail!("échec de l'action de cycle de vie sur {target_id}");
            }
            Ok(())
        }
    }
}

fn probe_endpoint(
    _root: &Path,
    endpoint: &str,
    timeout_secs: u64,
    target: Option<&str>,
    as_json: bool,
    run: &mut Run,
) -> Result<()> {
    let result = match target {
        Some(t) => crate::probe::probe_remote(t, endpoint, timeout_secs as u32)?,
        None => crate::probe::probe_url(endpoint, std::time::Duration::from_secs(timeout_secs)),
    };

    if as_json {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        println!(
            "[{}] {} -> status: {} ({}ms){}",
            if result.ok { "UP" } else { "DOWN" },
            result.url,
            result.status,
            result.duration_ms,
            result
                .error
                .as_ref()
                .map(|e| format!(" error: {e}"))
                .unwrap_or_default()
        );
    }

    run.action(
        "probe",
        if result.ok { "success" } else { "failed" },
        json!({ "result": result }),
    );
    if !result.ok {
        bail!(
            "probe a échoué: {}",
            result.error.unwrap_or_else(|| "code non-2xx".to_string())
        );
    }
    Ok(())
}

fn check_pipeline_workspace(
    config: &crate::pipeline::PipelineConfig,
    workspace: &Path,
) -> Vec<String> {
    let mut errors = Vec::new();
    let mut package_catalogs = std::collections::BTreeMap::new();
    for stage in &config.stages {
        for step in &stage.steps {
            let repo = workspace.join(&step.repo);
            let manifests = step.runner.manifests();
            if !repo.is_dir() {
                errors.push(format!("{}: dépôt absent", step.repo));
                continue;
            }
            let Some(manifest) = manifests
                .iter()
                .map(|name| repo.join(name))
                .find(|path| path.is_file())
            else {
                errors.push(format!(
                    "{}: manifeste {} absent",
                    step.repo,
                    manifests.join(" / ")
                ));
                continue;
            };
            if step.runner == crate::pipeline::Runner::Bun
                && step.command.first().is_some_and(|command| command == "run")
            {
                match step.command.as_slice() {
                    [_, script] => {
                        let scripts = fs::read(&manifest)
                            .ok()
                            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                            .and_then(|value| value["scripts"].as_object().cloned())
                            .unwrap_or_default();
                        if !scripts.contains_key(script) {
                            errors.push(format!("{}: script Bun {} absent", step.repo, script));
                        }
                    }
                    [_, filter, package, script] if filter == "--filter" => {
                        let catalog = package_catalogs
                            .entry(repo.clone())
                            .or_insert_with(|| workspace_package_scripts(&repo));
                        match catalog.get(package) {
                            Some(scripts) if scripts.contains(script) => {}
                            Some(_) => errors.push(format!(
                                "{}: package {} sans script Bun {}",
                                step.repo, package, script
                            )),
                            None => errors
                                .push(format!("{}: package Bun {} absent", step.repo, package)),
                        }
                    }
                    _ => errors.push(format!(
                        "{}: commande Bun run non prise en charge: {:?}",
                        step.repo, step.command
                    )),
                }
            }
            if step.runner == crate::pipeline::Runner::Just {
                let recipe = step.command.first().map(String::as_str).unwrap_or("");
                let present = fs::read_to_string(&manifest).ok().is_some_and(|source| {
                    source.lines().any(|line| {
                        let line = line.trim_start().trim_start_matches('@');
                        line.starts_with(recipe)
                            && line[recipe.len()..].trim_start().starts_with(':')
                    })
                });
                if recipe.is_empty() || !present {
                    errors.push(format!(
                        "{}: recette Just {} absente",
                        step.repo,
                        if recipe.is_empty() { "<vide>" } else { recipe }
                    ));
                }
            }
        }
    }
    errors
}

fn workspace_package_scripts(
    root: &Path,
) -> std::collections::BTreeMap<String, std::collections::BTreeSet<String>> {
    let mut packages = std::collections::BTreeMap::new();
    for domain in ["apps", "packages"] {
        let path = root.join(domain);
        if !path.is_dir() {
            continue;
        }
        let walker = ignore::WalkBuilder::new(path)
            .hidden(false)
            .git_ignore(false)
            .max_depth(Some(7))
            .filter_entry(|entry| {
                !matches!(
                    entry.file_name().to_str(),
                    Some(".git" | "node_modules" | "target" | "dist" | ".next")
                )
            })
            .build();
        for entry in walker.flatten() {
            if entry.file_name() != "package.json" {
                continue;
            }
            let Ok(bytes) = fs::read(entry.path()) else {
                continue;
            };
            let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            let Some(name) = value["name"].as_str() else {
                continue;
            };
            let scripts = value["scripts"]
                .as_object()
                .map(|scripts| scripts.keys().cloned().collect())
                .unwrap_or_default();
            packages.insert(name.to_owned(), scripts);
        }
    }
    packages
}

fn run_pipeline_stage(root: &Path, stage_name: &str, as_json: bool, run: &mut Run) -> Result<()> {
    let config = crate::pipeline::load_pipeline_config(root)?;
    let workspace_root = match &config.workspace_root {
        Some(rel) => root
            .join(rel)
            .canonicalize()
            .unwrap_or_else(|_| root.to_path_buf()),
        None => root.parent().unwrap_or(root).to_path_buf(),
    };

    if stage_name == "check" {
        let mut errors = crate::pipeline::check_pipeline(&config);
        errors.extend(check_pipeline_workspace(&config, &workspace_root));
        let output = json!({ "steps": config.stages.iter().map(|stage| stage.steps.len()).sum::<usize>(), "errors": errors });
        if as_json {
            println!("{}", serde_json::to_string_pretty(&output)?);
        } else {
            println!(
                "pipeline check: {} erreur(s)",
                output["errors"].as_array().map_or(0, Vec::len)
            );
            for error in output["errors"].as_array().into_iter().flatten() {
                eprintln!("✗ {}", error.as_str().unwrap_or("erreur"));
            }
        }
        run.action(
            "pipeline.check",
            if output["errors"].as_array().is_none_or(Vec::is_empty) {
                "success"
            } else {
                "failed"
            },
            output.clone(),
        );
        if !output["errors"].as_array().is_none_or(Vec::is_empty) {
            bail!("pipeline invalide");
        }
        return Ok(());
    }

    if stage_name == "plan" {
        if as_json {
            println!("{}", serde_json::to_string_pretty(&config)?);
        } else {
            println!("Pipeline: {} (autorité: {})", config.name, config.authority);
            println!("Racine workspace: {}", workspace_root.display());
            println!("Étapes déclarées:");
            for stage in &config.stages {
                println!(
                    "  - [{}] parallel: {}, steps: {}",
                    stage.id,
                    stage.parallel,
                    stage.steps.len()
                );
                for step in &stage.steps {
                    println!("      repo: {:<17} cmd: {}", step.repo, step.display());
                }
            }
        }
        run.action(
            "pipeline.plan",
            "success",
            json!({ "stages": config.stages.len() }),
        );
        return Ok(());
    }

    let stage = config
        .stages
        .iter()
        .find(|s| s.id == stage_name)
        .with_context(|| {
            format!(
                "étape de pipeline inconnue: {stage_name} (disponibles: plan, {})",
                config
                    .stages
                    .iter()
                    .map(|s| s.id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;

    println!("Exécution de l'étape de pipeline: {}...", stage.id);
    let result = crate::pipeline::run_stage(&workspace_root, stage);

    if as_json {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        for step in &result.step_results {
            println!(
                "[{}] {:<16} {} ({}ms)",
                if step.success { "OK" } else { "FAIL" },
                step.repo,
                step.command,
                step.duration_ms
            );
            if !step.success {
                eprintln!("--- Sortie {} ---\n{}", step.repo, step.output);
            }
        }
    }

    run.action(
        &format!("pipeline.{}", stage.id),
        if result.success { "success" } else { "failed" },
        json!({ "result": result }),
    );
    if !result.success {
        bail!("l'étape {} du pipeline a échoué", stage.id);
    }
    Ok(())
}

async fn execute_ssh(cmd: &aphrody_ssh::Commands, json: bool, run: &mut Run) -> Result<()> {
    run.action(
        "ssh",
        "dispatched",
        json!({ "command": format!("{:?}", cmd) }),
    );
    aphrody_ssh::run(aphrody_ssh::Cli {
        json,
        command: cmd.clone(),
    })
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))
}

fn execute_git(repo_path: &Path, as_json: bool, run: &mut Run) -> Result<()> {
    let repo = aphrody_git::inspect_repository(repo_path)
        .map_err(|e| anyhow::anyhow!("inspection git échouée: {e}"))?;
    let val = serde_json::to_value(&repo)?;
    run.action("git", "inspected", val.clone());
    if as_json {
        println!("{}", serde_json::to_string_pretty(&val)?);
    } else {
        println!("dépôt: {}", repo.root.display());
        println!(
            "branche: {}",
            repo.branch.as_deref().unwrap_or("<detached>")
        );
        println!("commit HEAD: {}", repo.head.as_deref().unwrap_or("<aucun>"));
        println!("dirty: {}", repo.dirty);
        println!("remotes: {}", repo.remotes.len());
        for remote in &repo.remotes {
            println!(
                "  - {} -> {}",
                remote.name,
                remote.fetch_url.as_deref().unwrap_or("-")
            );
        }
        println!("modifications ({}) :", repo.changes.len());
        for change in &repo.changes {
            println!("  [{}] {}", change.layer, change.path);
        }
    }
    Ok(())
}

fn execute_ci(
    repo_path: &Path,
    source_ref: &str,
    apply: bool,
    as_json: bool,
    run: &mut Run,
) -> Result<()> {
    let mode = if apply {
        aphrody_git::InstallMode::Apply
    } else {
        aphrody_git::InstallMode::Plan
    };
    let outcome = aphrody_git::install_consumer_workflow(repo_path, source_ref, mode)
        .map_err(|e| anyhow::anyhow!("distribution CI échouée: {e}"))?;
    let val = serde_json::to_value(&outcome)?;
    run.action("ci", if apply { "applied" } else { "planned" }, val.clone());
    if as_json {
        println!("{}", serde_json::to_string_pretty(&val)?);
    } else {
        println!("dépôt: {}", repo_path.display());
        println!("mode: {}", if apply { "APPLY" } else { "PLAN" });
        println!("écrit: {}", outcome.written);
        println!("inchangé: {}", outcome.unchanged);
        println!("source ref: {}", outcome.source_ref);
        println!("chemin workflow: {}", outcome.path.display());
    }
    Ok(())
}

async fn execute_vpn(cmd: &VpnCommand, run: &mut Run) -> Result<()> {
    match cmd {
        VpnCommand::Status { json } => {
            let ctrl =
                aphrody_vpn::MullvadController::discover().map_err(|e| anyhow::anyhow!("{e}"))?;
            let status = ctrl.status().await.map_err(|e| anyhow::anyhow!("{e}"))?;
            let val = serde_json::to_value(&status)?;
            run.action("vpn", "status", val.clone());
            if *json {
                println!("{}", serde_json::to_string_pretty(&val)?);
            } else {
                match status {
                    aphrody_vpn::TunnelState::Connected {
                        relay,
                        location,
                        ipv4,
                        ipv6,
                    } => {
                        println!("état: Connecté");
                        println!("relais: {relay} ({location})");
                        if let Some(ip) = ipv4 {
                            println!("ipv4: {ip}");
                        }
                        if let Some(ip) = ipv6 {
                            println!("ipv6: {ip}");
                        }
                    }
                    aphrody_vpn::TunnelState::Connecting => println!("état: Connexion en cours..."),
                    aphrody_vpn::TunnelState::Disconnected => println!("état: Déconnecté"),
                    aphrody_vpn::TunnelState::Blocked(reason) => {
                        println!("état: Bloqué ({reason})")
                    }
                    aphrody_vpn::TunnelState::Unknown(raw) => println!("état: Inconnu ({raw})"),
                }
            }
        }
        VpnCommand::Connect { location } => {
            let ctrl =
                aphrody_vpn::MullvadController::discover().map_err(|e| anyhow::anyhow!("{e}"))?;
            ctrl.connect(location.as_deref())
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            println!("connexion mullvad initiée (location: {:?})", location);
            run.action(
                "vpn",
                "connect",
                json!({ "ok": true, "location": location }),
            );
        }
        VpnCommand::Disconnect => {
            let ctrl =
                aphrody_vpn::MullvadController::discover().map_err(|e| anyhow::anyhow!("{e}"))?;
            ctrl.disconnect()
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            println!("déconnexion mullvad effectuée");
            run.action("vpn", "disconnect", json!({ "ok": true }));
        }
        VpnCommand::ProxyTarget { json } => {
            let host = std::env::var(aphrody_vpn::PROXY_HOST_ENV).ok();
            let remote = std::env::var(aphrody_vpn::PROXY_REMOTE_ENV).ok();
            match aphrody_vpn::vps_proxy_target(host, remote) {
                Ok((h, r)) => {
                    let val = json!({ "host": h, "remote": r });
                    run.action("vpn", "proxy_target", val.clone());
                    if *json {
                        println!("{}", serde_json::to_string_pretty(&val)?);
                    } else {
                        println!("hôte SSH proxy: {h}");
                        println!("endpoint distant SOCKS5: {r}");
                    }
                }
                Err(e) => {
                    bail!("{e}");
                }
            }
        }
    }
    Ok(())
}

async fn execute_drive(cmd: &DriveCommand, run: &mut Run) -> Result<()> {
    let engine = crate::drive::VirtualDriveEngine::new()
        .context("échec de l'initialisation du moteur VDFS")?;

    match cmd {
        DriveCommand::Mounts { json } => {
            let mounts = engine.list_mounts();
            let val = serde_json::to_value(&mounts)?;
            run.action("drive", "mounts", val.clone());
            if *json {
                println!("{}", serde_json::to_string_pretty(&val)?);
            } else {
                println!("{:<12} {:<28} {:<18} RO", "ID", "NOM", "TYPE");
                println!("{:-<12} {:-<28} {:-<18} {:-<4}", "", "", "", "");
                for m in &mounts {
                    let type_str = match &m.kind {
                        crate::drive::MountKind::LocalFs { .. } => "LocalFs".to_owned(),
                        crate::drive::MountKind::RemoteSftp { host, .. } => {
                            format!("RemoteSftp({})", host.alias())
                        }
                        crate::drive::MountKind::GitRepo { .. } => "GitRepo".to_owned(),
                        crate::drive::MountKind::OpenDalFs { .. } => "OpenDalFs".to_owned(),
                    };
                    println!(
                        "{:<12} {:<28} {:<18} {}",
                        m.id,
                        m.name,
                        type_str,
                        if m.read_only { "oui" } else { "non" }
                    );
                }
            }
        }
        DriveCommand::Ls { uri, json } => {
            let nodes = engine
                .list_dir(uri)
                .await
                .with_context(|| format!("échec de listage pour URI '{uri}'"))?;
            let val = serde_json::to_value(&nodes)?;
            run.action("drive", "ls", json!({ "uri": uri, "count": nodes.len() }));
            if *json {
                println!("{}", serde_json::to_string_pretty(&val)?);
            } else {
                for node in &nodes {
                    let kind_indicator = if node.is_dir { "DIR " } else { "FILE" };
                    println!(
                        "[{kind_indicator}] {:>10} o  {:04o}  {}",
                        node.size, node.permissions, node.name
                    );
                }
            }
        }
        DriveCommand::Tree { uri, depth, json } => {
            let tree = engine
                .tree(uri, *depth)
                .await
                .with_context(|| format!("échec du parcours d'arbre pour URI '{uri}'"))?;
            let val = serde_json::to_value(&tree)?;
            run.action("drive", "tree", json!({ "uri": uri, "depth": depth }));
            if *json {
                println!("{}", serde_json::to_string_pretty(&val)?);
            } else {
                fn print_node(node: &crate::drive::DriveTreeNode, indent: usize) {
                    let pad = "  ".repeat(indent);
                    let indicator = if node.node.is_dir { "/" } else { "" };
                    println!("{}{}{}", pad, node.node.name, indicator);
                    for child in &node.children {
                        print_node(child, indent + 1);
                    }
                }
                print_node(&tree, 0);
            }
        }
        DriveCommand::Cat { uri } => {
            let content = engine
                .read_file(uri)
                .await
                .with_context(|| format!("échec de lecture pour URI '{uri}'"))?;
            run.action(
                "drive",
                "cat",
                json!({ "uri": uri, "bytes": content.len() }),
            );
            std::io::Write::write_all(&mut std::io::stdout(), &content)?;
        }
        DriveCommand::Git { mount, json } => {
            let overview = engine
                .git_overview(mount)
                .with_context(|| format!("échec de l'inspection git pour le point '{mount}'"))?;
            let val = serde_json::to_value(&overview)?;
            run.action("drive", "git", json!({ "mount": mount }));
            if *json {
                println!("{}", serde_json::to_string_pretty(&val)?);
            } else {
                println!(
                    "branche: {}",
                    overview.branch.as_deref().unwrap_or("<detached>")
                );
                println!(
                    "commit HEAD: {}",
                    overview.head.as_deref().unwrap_or("<aucun>")
                );
                println!("dirty: {}", overview.dirty);
                println!("branches ({}):", overview.branches.len());
                for b in &overview.branches {
                    let mark = if b.is_head { "*" } else { " " };
                    let target = b.target_commit.as_deref().unwrap_or("-");
                    println!("  {} {} [{}]", mark, b.name, &target[..8.min(target.len())]);
                }
                println!("derniers commits ({}):", overview.recent_commits.len());
                for c in overview.recent_commits.iter().take(5) {
                    println!("  [{}] {}", c.short_id, c.summary);
                }
                println!("worktrees ({}):", overview.worktrees.len());
                for w in &overview.worktrees {
                    println!(
                        "  - {} ({})",
                        w.path.display(),
                        if w.is_main { "principal" } else { "lié" }
                    );
                }
            }
        }
    }
    Ok(())
}

/// Entry point of the former `aphrody-infra` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn cli_main(args: Vec<std::ffi::OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            let _ = error.print();
            return error.exit_code();
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Error: {error}");
            return 1;
        }
    };
    match runtime.block_on(run_cli(cli)) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error:?}");
            1
        }
    }
}

async fn run_cli(cli: Cli) -> Result<()> {
    if let CommandKind::Nginx { command } = &cli.command {
        return nginx_command(command);
    }
    let root = fs::canonicalize(&cli.root).context("racine infra introuvable")?;
    // The default root is the enclosing work tree, so a call from a subdirectory neither misses
    // `config/` nor drops run manifests under that subdirectory.
    let root = if cli.root == Path::new(".") {
        root.ancestors()
            .find(|dir| dir.join(".git").exists())
            .map_or(root.clone(), Path::to_path_buf)
    } else {
        root
    };
    let scope = format!("{:?}", cli.command);
    let mut run = Run::start(&root, &scope)?;
    let result = match &cli.command {
        CommandKind::Status { target, json } => status(target.as_deref(), *json, &mut run),
        CommandKind::Quality {
            stage,
            repo,
            run: execute,
            json,
        } => quality(&root, *stage, repo.as_deref(), *execute, *json, &mut run),
        CommandKind::Maintenance {
            action,
            repo,
            apply,
            json,
        } => maintenance(&root, *action, repo.as_deref(), *apply, *json, &mut run),
        CommandKind::Inventory { json } => {
            let args = if *json {
                vec!["run", "infra:inventory"]
            } else {
                vec!["run", "infra:status"]
            };
            let output = command(&root, "bun", &args)?;
            run.action(
                "inventory.bun",
                "success",
                json!({ "outputBytes": output.len() }),
            );
            println!("{output}");
            Ok(())
        }
        CommandKind::Doctor { json, strict } => doctor(&root, *json, *strict, &mut run),
        CommandKind::Sync { target, apply } => sync(&root, target.as_deref(), *apply, &mut run),
        CommandKind::Deploy {
            target,
            stack,
            release,
            id,
            source,
            build_report,
            bun,
            local,
            apply,
        } => {
            if *stack == DeployStack::App {
                let plan = crate::app::deploy_app(
                    &root,
                    &crate::app::AppDeployOptions {
                        target,
                        id: id.as_deref().context("--id is required for --stack app")?,
                        source: source
                            .as_deref()
                            .context("--source is required for --stack app")?,
                        build_report: build_report
                            .as_deref()
                            .context("--build-report is required for --stack app")?,
                        bun,
                        local: *local,
                        apply: *apply,
                    },
                )?;
                run.action(
                    "deploy.app",
                    if plan.applied { "applied" } else { "planned" },
                    json!(&plan),
                );
                println!("{}", serde_json::to_string_pretty(&plan)?);
                Ok(())
            } else {
                if id.is_some() || source.is_some() || build_report.is_some() || *local {
                    bail!("Application options require --stack app");
                }
                deploy(target, *stack, release.as_deref(), *apply, &mut run)
            }
        }
        CommandKind::Boot {
            action,
            host,
            entry,
            json,
        } => {
            let drift =
                crate::boot::run_boot(&root, *action, host.as_deref(), entry.as_deref(), *json)?;
            run.action("boot", if drift { "drift" } else { "conforme" }, json!({}));
            if drift && *action == crate::boot::BootAction::Audit {
                bail!("dérive de persistance au boot");
            }
            Ok(())
        }
        CommandKind::Validate { json } => validate_catalogs(&root, *json, &mut run),
        CommandKind::Reclaim { target, apply } => reclaim_disk(&root, target, *apply, &mut run),
        CommandKind::DevEnv {
            target,
            apply,
            local,
            developer_cli,
        } => match (developer_cli, local) {
            (true, _) => {
                let report =
                    run_remote("bash", &["-s"], &devenv::developer_script(&root, *apply)?)?;
                print!("{report}");
                run.action(
                    "developer-cli",
                    if *apply { "applied" } else { "checked" },
                    json!({ "report": report }),
                );
                Ok(())
            }
            (false, Some(host)) => dev_env_local(&root, host, *apply, &mut run),
            (false, None) => dev_env(&root, target.as_deref(), *apply, &mut run),
        },
        CommandKind::Service {
            action,
            id,
            target,
            json,
        } => service_lifecycle(&root, *action, id.as_deref(), target, *json, &mut run),
        CommandKind::Probe {
            endpoint,
            timeout,
            target,
            json,
        } => probe_endpoint(
            &root,
            endpoint,
            *timeout,
            target.as_deref(),
            *json,
            &mut run,
        ),
        CommandKind::Pipeline { stage, json } => run_pipeline_stage(&root, stage, *json, &mut run),
        CommandKind::Serve { port, target } => {
            crate::api::ApiServer::new(root.clone(), *port, target.clone()).run()
        }
        CommandKind::Ssh { json, command } => execute_ssh(command, *json, &mut run).await,
        CommandKind::Git { repo, json } => execute_git(repo, *json, &mut run),
        CommandKind::WorkspaceGitAudit {
            workspace_root,
            json,
        } => workspace_git_audit(&root, workspace_root.as_deref(), *json, &mut run).await,
        CommandKind::Ci {
            repo,
            source_ref,
            apply,
            json,
        } => execute_ci(repo, source_ref, *apply, *json, &mut run),
        CommandKind::Vpn { command } => execute_vpn(command, &mut run).await,
        CommandKind::Nginx { command } => nginx_command(command),
        CommandKind::Wg { json, command } => crate::tunnel::execute(&root, command, *json)
            .await
            .map(|v| run.action("wg", "done", v)),
        CommandKind::Remote { command } => crate::remote::execute_remote(&root, command)
            .await
            .map(|v| run.action("remote", "done", v)),
        CommandKind::Workflow { stage, json } => run_pipeline_stage(&root, stage, *json, &mut run),
        CommandKind::Yolo { args } => execute_yolo(&root, args, &mut run),
        CommandKind::Drive { command } => execute_drive(command, &mut run).await,
        CommandKind::Ovh { command } => execute_ovh(command, &mut run).await,
        CommandKind::Secrets { command } => {
            run.action(
                "secrets",
                "exec",
                json!({ "command": format!("{:?}", command) }),
            );
            command.execute(&root)
        }
        CommandKind::Gitea {
            command:
                GiteaCommand::Provision {
                    apply,
                    repository,
                    json: as_json,
                },
        } => {
            let report = crate::gitea::provision(&root, *apply, repository.as_deref())?;
            run.action(
                "gitea.provision",
                if *apply { "applied" } else { "planned" },
                json!(&report),
            );
            if *as_json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                println!("{}", serde_json::to_string(&report)?);
            }
            Ok(())
        }
        CommandKind::Gitea {
            command:
                GiteaCommand::Mirrors {
                    apply,
                    batch,
                    json: as_json,
                },
        } => {
            let report = crate::gitea::mirrors(&root, *apply, batch)?;
            run.action(
                "gitea.mirrors",
                if *apply { "applied" } else { "planned" },
                json!(&report),
            );
            if *as_json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                println!("{}", serde_json::to_string(&report)?);
            }
            Ok(())
        }
    };
    match result {
        Ok(()) => run.finish("success", vec![]),
        Err(error) => {
            let message = error.to_string();
            run.action("error", "failed", json!({ "message": message }));
            run.finish("failed", vec![])?;
            Err(error)
        }
    }
}

fn execute_yolo(root: &Path, args: &[String], run: &mut Run) -> Result<()> {
    run.action("yolo", "exec", json!({ "args": args }));
    let mut argv: Vec<std::ffi::OsString> = vec![
        "aphrody-yolo".into(),
        "--root".into(),
        root.as_os_str().to_owned(),
    ];
    argv.extend(args.iter().map(std::ffi::OsString::from));
    // The yolo CLI builds its own runtime: run it on a thread outside the caller's runtime.
    let code = std::thread::scope(|scope| scope.spawn(|| aphrody_yolo::cli_main(argv)).join())
        .map_err(|_| anyhow::anyhow!("aphrody-yolo panicked"))?;
    if code != 0 {
        bail!("aphrody-yolo exited with code {code}");
    }
    Ok(())
}

async fn execute_ovh(command: &aphrody_ovh::OvhCommand, run: &mut Run) -> Result<()> {
    run.action(
        "ovh",
        "dispatch",
        json!({ "command": format!("{:?}", command) }),
    );
    command.execute().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::assert_matches;

    #[test]
    fn nginx_render_prefixes_comments_and_rejects_bad_json() {
        let rendered = render_nginx(
            r#"{ "servers": [{ "listen_ports": ["80"], "locations": [{ "path": "/" }] }] }"#,
            &["generated".to_string()],
        )
        .unwrap();
        assert_eq!(
            rendered,
            "# generated\nserver {\n    listen 80;\n\n    location / {\n    }\n}\n\n"
        );
        assert!(render_nginx("{ \"servers\": 1 }", &[]).is_err());
    }

    #[test]
    fn pipeline_check_resolves_filtered_monorepo_scripts() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path();
        let root = workspace.join("aphrody");
        fs::create_dir_all(root.join("packages/infra/workspace")).unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"name":"aphrody","scripts":{"monorepo:layout":"true"}}"#,
        )
        .unwrap();
        fs::write(
            root.join("packages/infra/workspace/package.json"),
            r#"{"name":"@aphrody/workspace","scripts":{"lint":"oxlint"}}"#,
        )
        .unwrap();
        let mut config: crate::pipeline::PipelineConfig = serde_json::from_value(json!({
            "schemaVersion": 1,
            "name": "test",
            "authority": "@aphrody/workspace",
            "stages": [{"id":"bun-infra","parallel":false,"steps":[
                {"repo":"aphrody","command":["run","monorepo:layout"]},
                {"repo":"aphrody","command":["run","--filter","@aphrody/workspace","lint"]}
            ]}]
        }))
        .unwrap();
        assert!(check_pipeline_workspace(&config, workspace).is_empty());

        config.stages[0].steps[1].command[3] = "missing".into();
        assert!(
            check_pipeline_workspace(&config, workspace)[0].contains("sans script Bun missing")
        );
        config.stages[0].steps[1].command[2] = "@aphrody/unknown".into();
        assert!(
            check_pipeline_workspace(&config, workspace)[0]
                .contains("package Bun @aphrody/unknown absent")
        );
    }

    #[test]
    fn consolidated_quality_and_maintenance_select_the_actual_root() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().join("consolidated workspace");
        fs::create_dir_all(root.join("crates/infra/infra")).unwrap();
        fs::write(root.join("crates/infra/infra/Cargo.toml"), "").unwrap();
        fs::write(root.join("Cargo.toml"), "[workspace]\n").unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"name":"aphrody","scripts":{"lint":"oxlint"}}"#,
        )
        .unwrap();
        let expected = vec![("aphrody".to_owned(), root.clone())];
        assert_eq!(workspace_repositories(&root, None).unwrap(), expected);
        assert_eq!(
            maintenance_repositories(&root, Some("aphrody")).unwrap(),
            expected
        );
        assert!(workspace_repositories(&root, Some("aphrody-ai")).is_err());
    }

    #[test]
    fn legacy_catalog_keeps_explicit_source_repo_selection() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().join("aphrody-infra");
        fs::create_dir_all(root.join("docs/ecosystem")).unwrap();
        fs::write(
            root.join("docs/ecosystem/ecosystem.json"),
            r#"{"repos":[{"name":"aphrody-ai"},{"name":"aphrody-infra"}]}"#,
        )
        .unwrap();
        let peer = fixture.path().join("aphrody-ai");
        fs::create_dir_all(&peer).unwrap();
        fs::write(peer.join("Cargo.toml"), "[workspace]\n").unwrap();
        assert_eq!(
            maintenance_repositories(&root, Some("aphrody-ai")).unwrap(),
            vec![("aphrody-ai".to_owned(), peer)]
        );
        assert_eq!(workspace_repositories(&root, None).unwrap().len(), 2);
        assert!(workspace_repositories(&root, Some("unknown")).is_err());
    }

    #[test]
    fn parses_target_matrix_shape() {
        let matrix: Matrix = serde_json::from_str(r#"{"schemaVersion":1,"generatedAt":"now","targets":[{"id":"x","kind":"host","os":"test","consumers":[]}] }"#).unwrap();
        assert_eq!(matrix.targets[0].id, "x");
    }

    #[test]
    fn release_path_rejects_traversal_and_empty_ids() {
        assert!(release_path_is_valid(
            "/home/ubuntu/apps/aphrody/releases/20260923-abc",
            DeployStack::Aphrody
        ));
        assert!(!release_path_is_valid(
            "/home/ubuntu/apps/aphrody/releases/",
            DeployStack::Aphrody
        ));
        assert!(!release_path_is_valid(
            "/home/ubuntu/apps/aphrody/releases/../etc",
            DeployStack::Aphrody
        ));
        assert!(!release_path_is_valid(
            "/home/ubuntu/apps/aphrody/releases/a/./b",
            DeployStack::Aphrody
        ));
        assert!(!release_path_is_valid(
            "/home/ubuntu/apps/aphrody/current",
            DeployStack::Aphrody
        ));
        assert!(!release_path_is_valid(
            "/home/ubuntu/apps/other/releases/a",
            DeployStack::Aphrody
        ));
        assert!(!release_path_is_valid(
            "/home/ubuntu/apps/aphrody/releases/x;reboot",
            DeployStack::Aphrody
        ));
        assert!(!release_path_is_valid(
            "/home/ubuntu/apps/aphrody/releases/a b",
            DeployStack::Aphrody
        ));
    }

    #[test]
    fn every_stack_has_its_own_adapter_root_and_override() {
        for stack in [DeployStack::Aphrody, DeployStack::AphrodyCompute] {
            assert!(
                stack
                    .adapter()
                    .starts_with("/usr/local/sbin/aphrody-infra-deploy-")
            );
            assert!(stack.release_root().ends_with('/'));
            assert!(!stack.requires().is_empty());
        }
        // The Aphrody stack is the multi-service adapter, never the retired site-only one.
        assert_eq!(
            DeployStack::Aphrody.adapter(),
            "/usr/local/sbin/aphrody-infra-deploy-aphrody"
        );
        assert!(
            DeployStack::Aphrody
                .requires()
                .iter()
                .any(|item| item.contains("SMOKE.json"))
        );
        assert_eq!(
            remote_adapter_args(
                "vps",
                "/usr/local/sbin/x",
                "/home/ubuntu/apps/aphrody/releases/a"
            ),
            [
                "-o",
                "BatchMode=yes",
                "vps",
                "sudo",
                "-n",
                "/usr/local/sbin/x",
                "/home/ubuntu/apps/aphrody/releases/a"
            ]
        );
    }

    #[test]
    fn deploy_cli_preserves_aphrody_default_and_routes_explicit_stacks() {
        let default = Cli::try_parse_from(["aphrody-infra", "deploy", "--target", "vps"]).unwrap();
        assert_matches!(
            default.command,
            CommandKind::Deploy {
                stack: DeployStack::Aphrody,
                ..
            }
        );
        for (name, expected) in [
            ("aphrody-compute", DeployStack::AphrodyCompute),
            ("app", DeployStack::App),
        ] {
            let parsed = Cli::try_parse_from([
                "aphrody-infra",
                "deploy",
                "--target",
                "vps",
                "--stack",
                name,
            ])
            .unwrap();
            assert!(
                matches!(parsed.command, CommandKind::Deploy { stack, .. } if stack == expected)
            );
        }
        assert!(
            Cli::try_parse_from([
                "aphrody-infra",
                "deploy",
                "--target",
                "vps",
                "--stack",
                "unknown-stack",
            ])
            .is_err()
        );
    }

    #[test]
    fn compute_deployment_selects_only_the_existing_adapters_compute_mode() {
        let compute = DeployStack::AphrodyCompute;
        assert_eq!(serde_json::to_value(compute).unwrap(), "aphrody-compute");
        let release = "/home/ubuntu/apps/aphrody/releases/qualified-compute";
        assert_eq!(compute.adapter(), DeployStack::Aphrody.adapter());
        assert_eq!(compute.adapter_env(), DeployStack::Aphrody.adapter_env());
        assert!(release_path_is_valid(release, compute));
        assert!(!release_path_is_valid(
            "/home/ubuntu/apps/other/releases/a",
            compute
        ));
        assert_eq!(
            remote_stack_adapter_args("vps", compute, compute.adapter(), release),
            [
                "-o",
                "BatchMode=yes",
                "vps",
                "sudo",
                "-n",
                compute.adapter(),
                "--compute-only",
                release,
            ]
        );
        let stack = DeployStack::Aphrody;
        assert_eq!(
            remote_stack_adapter_args("vps", stack, stack.adapter(), release),
            remote_adapter_args("vps", stack.adapter(), release)
        );
    }

    #[test]
    fn deploy_targets_are_limited_to_the_vps() {
        for stack in [
            DeployStack::App,
            DeployStack::Aphrody,
            DeployStack::AphrodyCompute,
        ] {
            assert_eq!(
                deploy_target_is_supported("vps", stack),
                stack != DeployStack::App
            );
            for target in ["", "omar", "aphro-pc", "unknown", "dbfr", "dbfr;reboot"] {
                assert!(!deploy_target_is_supported(target, stack));
            }
        }
    }

    #[test]
    fn deploy_plans_preserve_unqualified_targets_but_apply_rejects_before_ssh() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        fs::create_dir_all(root.join("infra/config/host/inventory")).unwrap();
        fs::write(
            root.join("infra/config/host/inventory/targets.json"),
            r#"{"schemaVersion":1,"generatedAt":"fixture","targets":[{"id":"dbfr","kind":"host","os":"linux"}]}"#,
        )
        .unwrap();
        let mut run = Run::start(root, "deploy fixture").unwrap();
        assert!(deploy("dbfr", DeployStack::Aphrody, None, false, &mut run).is_ok());
        let error = deploy(
            "dbfr",
            DeployStack::Aphrody,
            Some("/home/ubuntu/apps/aphrody/releases/fixture"),
            true,
            &mut run,
        )
        .unwrap_err();
        assert!(error.to_string().contains("adaptateur non qualifié"));
        assert!(
            !run.actions
                .iter()
                .any(|action| action["name"] == "deploy.remote")
        );
    }

    #[test]
    fn drive_cli_routes_mounts_and_ls() {
        let mounts = Cli::try_parse_from(["aphrody-infra", "drive", "mounts", "--json"]).unwrap();
        assert_matches!(
            mounts.command,
            CommandKind::Drive {
                command: DriveCommand::Mounts { json: true }
            }
        );
        let ls =
            Cli::try_parse_from(["aphrody-infra", "drive", "ls", "vdfs://vps/var/www"]).unwrap();
        assert_matches!(
            ls.command,
            CommandKind::Drive {
                command: DriveCommand::Ls { ref uri, json: false }
            } if uri == "vdfs://vps/var/www"
        );
        let tree = Cli::try_parse_from([
            "aphrody-infra",
            "drive",
            "tree",
            "vdfs://local/crates",
            "--depth",
            "2",
        ])
        .unwrap();
        assert_matches!(
            tree.command,
            CommandKind::Drive {
                command: DriveCommand::Tree {
                    ref uri,
                    depth: 2,
                    json: false,
                }
            } if uri == "vdfs://local/crates"
        );
    }

    #[test]
    fn ovh_cli_routes_profiles_and_dns() {
        let profiles = Cli::try_parse_from(["aphrody-infra", "ovh", "profiles"]).unwrap();
        assert_matches!(
            profiles.command,
            CommandKind::Ovh {
                command: aphrody_ovh::OvhCommand::Profiles
            }
        );

        let dns = Cli::try_parse_from([
            "aphrody-infra",
            "ovh",
            "dns",
            "records",
            "aphrody.com",
            "--type",
            "A",
        ])
        .unwrap();
        assert_matches!(
            dns.command,
            CommandKind::Ovh {
                command: aphrody_ovh::OvhCommand::Dns {
                    subcommand: aphrody_ovh::OvhDnsSubcommand::Records { ref zone, ref r#type, .. }
                }
            } if zone == "aphrody.com" && r#type.as_deref() == Some("A")
        );

        let vps = Cli::try_parse_from(["aphrody-infra", "ovh", "vps", "list"]).unwrap();
        assert_matches!(
            vps.command,
            CommandKind::Ovh {
                command: aphrody_ovh::OvhCommand::Vps {
                    subcommand: aphrody_ovh::OvhVpsSubcommand::List { .. }
                }
            }
        );
    }

    #[test]
    fn secrets_cli_routes_audit_and_check() {
        let audit = Cli::try_parse_from(["aphrody-infra", "secrets", "audit", "--json"]).unwrap();
        assert_matches!(
            audit.command,
            CommandKind::Secrets {
                command: crate::secrets::SecretsCommand::Audit { json: true, .. }
            }
        );

        let check =
            Cli::try_parse_from(["aphrody-infra", "secrets", "check", "--service", "rg-api"])
                .unwrap();
        assert_matches!(
            check.command,
            CommandKind::Secrets {
                command: crate::secrets::SecretsCommand::Check { ref service, .. }
            } if service == "rg-api"
        );
    }
}
