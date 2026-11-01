// SPDX-License-Identifier: Apache-2.0
//! DBFR-initiated, single-job pull of a closed Shenron native crawl artifact.

use anyhow::{Context, Result, bail, ensure};
use ring::digest::{Context as DigestContext, SHA256, digest as ring_digest};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output},
};

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};

const CONFIG_PATH: &str = "infra/config/host/crawl-artifact-pull.json";
const DOCUMENTS_FILE: &str = "shenron-documents.jsonl";
const MAX_ARTIFACT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DOCUMENTS: u64 = 10_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct PullConfig {
    schema_version: u32,
    dbfr: DbfrConfig,
    source_roots: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct DbfrConfig {
    user: String,
    staging_root: String,
    ssh_config: String,
    ssh_alias: String,
    vps_host_name: String,
    vps_user: String,
    identity_file: String,
    known_hosts_file: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullFilePlan {
    pub name: String,
    pub source: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullPlan {
    pub target: String,
    pub job_key: String,
    pub remote_id: String,
    pub source_dir: String,
    pub file: PullFilePlan,
    pub destination: String,
    pub partial: String,
    pub receipt: String,
    pub applied: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PullReceipt<'a> {
    schema: &'static str,
    version: u32,
    intent_key: &'a str,
    job_id: &'a str,
    host: &'static str,
    job_state: &'static str,
    host_affinity: &'static str,
    source_dir: &'a str,
    source_file: &'a PullFilePlan,
    document_records: u64,
    remote_job_status_verified: bool,
    export_manifest_present: bool,
    importable: bool,
    received_at: String,
}

fn safe_id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        && !value.contains("..")
}

fn valid_intent_key(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.bytes().any(|byte| byte.is_ascii_control())
}

fn path_entry_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn digest(bytes: &[u8]) -> String {
    ring_digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn load_config(root: &Path) -> Result<PullConfig> {
    let path = root.join(CONFIG_PATH);
    let metadata = fs::symlink_metadata(&path).context("read crawl pull allowlist")?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "crawl pull allowlist must be a regular file"
    );
    let config: PullConfig = serde_json::from_slice(&fs::read(path)?)?;
    ensure!(
        config.schema_version == 1,
        "unsupported crawl pull allowlist version"
    );
    ensure!(
        config.dbfr.user == "ubuntu"
            && config.dbfr.ssh_alias == "vps-wg"
            && config.dbfr.vps_host_name == "10.200.77.1"
            && config.dbfr.vps_user == "ubuntu",
        "DBFR-to-VPS SSH identity differs from the live-verified Infra contract"
    );
    ensure!(
        config.dbfr.ssh_config == "/home/ubuntu/.ssh/config"
            && config.dbfr.identity_file == "/home/ubuntu/.ssh/aphrody_fleet_vps"
            && config.dbfr.known_hosts_file == "/home/ubuntu/.ssh/known_hosts",
        "DBFR SSH file paths differ from the verified identity"
    );
    ensure!(
        Path::new(&config.dbfr.staging_root)
            == Path::new("/home/ubuntu/.aphrody/crawl-artifact-staging"),
        "DBFR staging root must remain the catalogued private path"
    );
    Ok(config)
}

fn run(command: &mut Command, description: &str) -> Result<Output> {
    let output = command
        .output()
        .with_context(|| format!("start {description}"))?;
    if !output.status.success() {
        bail!(
            "{description} failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output)
}

fn binary_path(name: &str) -> Result<PathBuf> {
    let path = std::env::var_os("PATH").context("PATH is unavailable")?;
    for directory in std::env::split_paths(&path) {
        let candidate = directory.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    bail!("required transfer executable {name} is not installed on DBFR")
}

#[cfg(unix)]
fn verify_private_regular(path: &Path, expected_uid: u32) -> Result<()> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("inspect {}", path.display()))?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "{} must be a regular non-symlink file",
        path.display()
    );
    ensure!(
        metadata.uid() == expected_uid && metadata.permissions().mode() & 0o077 == 0,
        "{} must be owned by ubuntu and private to its owner",
        path.display()
    );
    Ok(())
}

#[cfg(not(unix))]
fn verify_private_regular(_path: &Path, _expected_uid: u32) -> Result<()> {
    bail!("crawl artifact pull must run on DBFR Linux")
}

fn preflight_identity(config: &DbfrConfig) -> Result<(PathBuf, PathBuf)> {
    #[cfg(not(unix))]
    bail!("crawl artifact pull must run on DBFR Linux as ubuntu");
    #[cfg(unix)]
    {
        let username = run(Command::new("id").arg("-un"), "DBFR identity check")?;
        ensure!(
            String::from_utf8_lossy(&username.stdout).trim() == config.user,
            "crawl pull must run as DBFR user ubuntu"
        );
        let home = std::env::var("HOME").context("HOME is required")?;
        ensure!(
            home == "/home/ubuntu",
            "crawl pull HOME must be /home/ubuntu"
        );
        let uid_output = run(Command::new("id").arg("-u"), "DBFR UID check")?;
        let uid: u32 = String::from_utf8_lossy(&uid_output.stdout)
            .trim()
            .parse()
            .context("invalid DBFR UID")?;
        let ssh_config = Path::new(&config.ssh_config);
        let identity = Path::new(&config.identity_file);
        let known_hosts = Path::new(&config.known_hosts_file);
        for file in [ssh_config, identity, known_hosts] {
            let metadata = fs::symlink_metadata(file)
                .with_context(|| format!("inspect SSH prerequisite {}", file.display()))?;
            ensure!(
                metadata.is_file() && !metadata.file_type().is_symlink() && metadata.uid() == uid,
                "SSH prerequisite {} must be an ubuntu-owned regular file",
                file.display()
            );
        }
        verify_private_regular(identity, uid)?;
        let ssh_config_meta = fs::symlink_metadata(ssh_config)?;
        ensure!(
            ssh_config_meta.permissions().mode() & 0o077 == 0,
            "SSH config must be private to ubuntu"
        );
        let known_hosts_meta = fs::symlink_metadata(known_hosts)?;
        ensure!(
            known_hosts_meta.permissions().mode() & 0o077 == 0,
            "known_hosts must be private to ubuntu"
        );
        let ssh = binary_path("ssh")?;
        let scp = binary_path("scp")?;
        let resolved = run(
            Command::new(&ssh).args(["-G", "-F", &config.ssh_config, &config.ssh_alias]),
            "resolve DBFR SSH alias",
        )?;
        let config_text = String::from_utf8_lossy(&resolved.stdout);
        let value = |field: &str| {
            config_text
                .lines()
                .find_map(|line| line.strip_prefix(&format!("{field} ")))
                .map(str::trim)
        };
        ensure!(
            value("hostname") == Some(config.vps_host_name.as_str()),
            "vps-wg hostname differs from the verified DBFR-to-VPS peer"
        );
        ensure!(
            value("user") == Some(config.vps_user.as_str()),
            "vps-wg user differs from the verified DBFR-to-VPS identity"
        );
        ensure!(
            value("stricthostkeychecking") == Some("true"),
            "vps-wg must require strict host key checking"
        );
        ensure!(
            value("identityfile").is_some_and(|resolved| {
                resolved == config.identity_file.as_str() || resolved == "~/.ssh/aphrody_fleet_vps"
            }),
            "vps-wg identity file differs from the verified fleet key"
        );
        let known_hosts_entries = run(
            Command::new("ssh-keygen").args([
                "-F",
                &config.vps_host_name,
                "-f",
                &config.known_hosts_file,
            ]),
            "verify pinned VPS host key",
        )?;
        ensure!(
            !known_hosts_entries.stdout.is_empty(),
            "known_hosts has no pinned key for VPS tunnel address"
        );
        run(
            Command::new(&ssh).args([
                "-F",
                &config.ssh_config,
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=8",
                "-o",
                "ServerAliveInterval=10",
                "-o",
                "ServerAliveCountMax=2",
                "-T",
                &config.ssh_alias,
                "true",
            ]),
            "read-only DBFR-to-VPS SSH probe",
        )?;
        Ok((ssh, scp))
    }
}

fn remote(ssh: &Path, config: &DbfrConfig, command: &str, description: &str) -> Result<String> {
    let output = run(
        Command::new(ssh).args([
            "-F",
            &config.ssh_config,
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=8",
            "-o",
            "ServerAliveInterval=10",
            "-o",
            "ServerAliveCountMax=2",
            "-T",
            &config.ssh_alias,
            command,
        ]),
        description,
    )?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn valid_remote_source(roots: &[String], job_key: &str) -> Result<String> {
    ensure!(
        roots.len() == 1,
        "crawl artifact pull blocked: configure exactly one canonical VPS artifact source root"
    );
    for root in roots {
        ensure!(
            Path::new(root).is_absolute() && !root.split('/').any(|part| part == ".."),
            "configured VPS source root is invalid"
        );
        let key_hash = digest(job_key.as_bytes());
        return Ok(format!("{}/{key_hash}", root.trim_end_matches('/')));
    }
    unreachable!()
}

fn remote_inventory(ssh: &Path, config: &DbfrConfig, source_dir: &str) -> Result<PullFilePlan> {
    let dir = shell_quote(source_dir);
    let command = format!(
        "test -d {dir} && test ! -L {dir} && test \"$(readlink -f -- {dir})\" = {dir} && test \"$(find -- {dir} -mindepth 1 -maxdepth 1 -printf '%f\\n')\" = {name} && test -f {dir}/{name} && test ! -L {dir}/{name} && stat -c '%s' {dir}/{name} && sha256sum -- {dir}/{name}",
        name = DOCUMENTS_FILE,
    );
    let output = remote(
        ssh,
        config,
        &command,
        "inspect allowlisted per-job VPS JSONL",
    )?;
    let mut lines = output.lines();
    let size: u64 = lines
        .next()
        .context("VPS JSONL size is missing")?
        .parse()
        .context("VPS JSONL size is invalid")?;
    ensure!(
        size > 0 && size <= MAX_ARTIFACT_BYTES,
        "VPS JSONL exceeds 512 MiB limit"
    );
    let line = lines.next().context("VPS JSONL hash is missing")?;
    let mut parts = line.split_whitespace();
    let hash = parts.next().context("invalid sha256sum output")?;
    let source_name = parts
        .next()
        .context("invalid sha256sum path")?
        .trim_start_matches('*')
        .rsplit('/')
        .next()
        .unwrap_or_default();
    ensure!(
        is_hash(hash) && source_name == DOCUMENTS_FILE && lines.next().is_none(),
        "VPS JSONL source hash response is invalid"
    );
    Ok(PullFilePlan {
        name: DOCUMENTS_FILE.into(),
        source: format!("{source_dir}/{DOCUMENTS_FILE}"),
        size_bytes: size,
        sha256: hash.into(),
    })
}

fn hash_file(path: &Path, max_bytes: u64) -> Result<(u64, String)> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("inspect received file {}", path.display()))?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "received artifact must be a regular non-symlink file"
    );
    ensure!(
        metadata.len() > 0 && metadata.len() <= max_bytes,
        "received artifact exceeds its size limit"
    );
    let mut file = File::open(path)?;
    let mut state = DigestContext::new(&SHA256);
    let mut buffer = [0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size += read as u64;
        ensure!(
            size <= max_bytes,
            "received artifact exceeded its size limit during hashing"
        );
        state.update(&buffer[..read]);
    }
    ensure!(
        metadata.len() == size,
        "received artifact changed while hashing"
    );
    let hash = state
        .finish()
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((size, hash))
}

fn count_jsonl_rows(path: &Path, max_bytes: u64) -> Result<u64> {
    let metadata = fs::symlink_metadata(path)?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() <= max_bytes,
        "JSONL artifact is not a bounded regular file"
    );
    let mut file = File::open(path)?;
    let mut buffer = [0u8; 64 * 1024];
    let mut bytes = 0u64;
    let mut rows = 0u64;
    let mut line_has_content = false;
    let mut last_was_newline = false;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        bytes += read as u64;
        ensure!(
            bytes <= max_bytes,
            "JSONL artifact exceeded size bound while counting records"
        );
        for byte in &buffer[..read] {
            if *byte == b'\n' {
                ensure!(line_has_content, "JSONL artifact contains an empty record");
                rows += 1;
                line_has_content = false;
                last_was_newline = true;
            } else {
                if !byte.is_ascii_whitespace() {
                    line_has_content = true;
                }
                last_was_newline = false;
            }
        }
    }
    if !last_was_newline {
        ensure!(line_has_content, "JSONL artifact ends with an empty record");
        rows += 1;
    }
    Ok(rows)
}

struct Secret(Vec<u8>);

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

fn dbfr_bearer() -> Result<Secret> {
    #[cfg(unix)]
    {
        let path = Path::new("/etc/aphrody/shenron-web-crawl.env");
        let metadata =
            fs::symlink_metadata(path).context("DBFR crawl bearer file is not provisioned")?;
        let gid: u32 =
            String::from_utf8_lossy(&run(Command::new("id").arg("-g"), "DBFR GID check")?.stdout)
                .trim()
                .parse()
                .context("invalid DBFR group id")?;
        ensure!(
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.uid() == 0
                && metadata.gid() == gid
                && metadata.permissions().mode() & 0o777 == 0o640,
            "DBFR crawl bearer file must be root:ubuntu 0640 and a regular file"
        );
        let mut contents = Secret(fs::read(path)?);
        let text =
            std::str::from_utf8(&contents.0).context("DBFR bearer environment is not UTF-8")?;
        let mut token: Option<Secret> = None;
        let mut line_count = 0;
        for line in text.lines() {
            line_count += 1;
            if let Some(value) = line.strip_prefix("APHRODY_VPS_MCP_HTTP_TOKEN=") {
                ensure!(
                    token.is_none() && is_hash(value),
                    "DBFR bearer environment has an invalid or duplicate token"
                );
                token = Some(Secret(value.as_bytes().to_vec()));
            } else {
                ensure!(
                    line == "SHENRON_ADMIN_WEB_CONFIG=/run/aphrody/web-crawl/web.json",
                    "DBFR crawl environment contains an unsupported setting"
                );
            }
        }
        contents.0.fill(0);
        ensure!(
            (line_count == 1 || line_count == 2) && token.is_some(),
            "DBFR bearer environment is incomplete"
        );
        return Ok(token.unwrap());
    }
    #[cfg(not(unix))]
    bail!("authenticated VPS job verification must run on DBFR Linux")
}

fn bounded_crawl_job(
    job: &Value,
    expected_id: &str,
    expected_key: &str,
    expected_source_dir: &str,
) -> bool {
    if job["id"].as_str() != Some(expected_id)
        || job["kind"].as_str() != Some("web-pipeline")
        || job["idempotency_key"].as_str() != Some(expected_key)
        || job["state"].as_str() != Some("succeeded")
        || job["attempts"].as_u64() != Some(1)
        || job["max_attempts"].as_u64() != Some(1)
        || job["result"].is_null()
        || job["host_affinity"]["mode"].as_str() != Some("hosts")
        || job["host_affinity"]["hosts"]
            .as_array()
            .is_none_or(|hosts| hosts.len() != 1 || hosts[0].as_str() != Some("vps"))
    {
        return false;
    }
    let Some(args) = job["payload"]["args"].as_array() else {
        return false;
    };
    let args: Option<Vec<&str>> = args.iter().map(Value::as_str).collect();
    let Some(args) = args else { return false };
    if args.len() < 15 || args[..4] != ["dragon-ball", "crawl", "--profile", "shenron"] {
        return false;
    }
    let mut cursor = 4;
    if args.get(cursor) == Some(&"--source") {
        let Some(source) = args.get(cursor + 1) else {
            return false;
        };
        if ![
            "dragonballcn",
            "kanzenshuu",
            "official",
            "kanzentai,neoseeker-databooks,databook-other",
            "guides",
        ]
        .contains(source)
        {
            return false;
        }
        cursor += 2;
    }
    if args.get(cursor..cursor + 2) != Some(["--browser", "playwright"].as_slice())
        || args.get(cursor + 2..cursor + 4) != Some(["--output", expected_source_dir].as_slice())
        || args.get(cursor + 4) != Some(&"--max-requests")
        || args.get(cursor + 6) != Some(&"--max-depth")
        || args.get(cursor + 8) != Some(&"--render")
        || args.get(cursor + 9) != Some(&"--json")
        || args.get(cursor + 10) != Some(&"--index")
        || args.len() != cursor + 11
    {
        return false;
    }
    args[cursor + 5]
        .parse::<u64>()
        .is_ok_and(|value| (1..=100).contains(&value))
        && args[cursor + 7]
            .parse::<u64>()
            .is_ok_and(|value| value <= 2)
}

fn verified_job_status(
    staging_root: &Path,
    job_id: &str,
    job_key: &str,
    source_dir: &str,
) -> Result<Value> {
    let token = dbfr_bearer()?;
    let mut nonce_bytes = [0u8; 12];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| anyhow::anyhow!("generate ephemeral MCP config id"))?;
    let nonce = nonce_bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let config_path = staging_root.join(format!(".mcp-status-{nonce}.toml"));
    let config_bytes = b"[mcp_servers.aphrody]\nurl = \"http://10.200.77.1:8793/mcp\"\nbearer_token_env_var = \"APHRODY_VPS_MCP_HTTP_TOKEN\"\n";
    let result = (|| -> Result<Value> {
        let mut config_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&config_path)?;
        #[cfg(unix)]
        config_file.set_permissions(fs::Permissions::from_mode(0o600))?;
        config_file.write_all(config_bytes)?;
        config_file.sync_all()?;
        let args = serde_json::to_string(&serde_json::json!({"id": job_id, "log_tail": 0}))?;
        let mut command = Command::new("/home/ubuntu/.local/bin/aphrody");
        command
            .args([
                "mcp",
                "call",
                "aphrody",
                "aphrody_job_status",
                "--args",
                &args,
            ])
            .arg("--config")
            .arg(&config_path);
        command.env("APHRODY_VPS_MCP_HTTP_TOKEN", std::str::from_utf8(&token.0)?);
        let output = command
            .output()
            .context("start authenticated VPS job-status query")?;
        drop(command);
        ensure!(
            output.status.success(),
            "authenticated VPS job-status query failed (exit {:?}); response suppressed",
            output.status.code()
        );
        let envelope: Value = serde_json::from_slice(&output.stdout)
            .context("job-status MCP response is not JSON")?;
        let result = &envelope["result"];
        ensure!(
            result["isError"] != true && result["is_error"] != true,
            "VPS job-status MCP returned an error"
        );
        let content = result["content"]
            .as_array()
            .context("job-status MCP response has no content")?;
        let text = content
            .iter()
            .filter_map(|block| {
                (block["type"].as_str() == Some("text"))
                    .then(|| block["text"].as_str())
                    .flatten()
            })
            .collect::<Vec<_>>()
            .join("\n");
        let body: Value =
            serde_json::from_str(&text).context("job-status MCP content is not JSON")?;
        let job = body
            .get("job")
            .context("job-status MCP content has no job")?;
        ensure!(
            bounded_crawl_job(job, job_id, job_key, source_dir),
            "remote job receipt is not a successful bounded crawl assigned to VPS with this intent key and output directory"
        );
        Ok(job.clone())
    })();
    let cleanup = fs::remove_file(&config_path);
    match (result, cleanup) {
        (Ok(job), Ok(())) => Ok(job),
        (Ok(_), Err(error)) => {
            bail!("job status verified, but ephemeral MCP config cleanup failed: {error}")
        }
        (Err(error), _) => Err(error),
    }
}

pub fn plan(root: &Path, job_key: &str, remote_id: &str) -> Result<PullPlan> {
    ensure!(
        valid_intent_key(job_key) && safe_id(remote_id),
        "job key and remote id must be safe single-component identifiers"
    );
    let config = load_config(root)?;
    let (ssh, _) = preflight_identity(&config.dbfr)?;
    let source_dir = valid_remote_source(&config.source_roots, job_key)?;
    let file = remote_inventory(&ssh, &config.dbfr, &source_dir)?;
    let key_hash = digest(job_key.as_bytes());
    let final_path = Path::new(&config.dbfr.staging_root).join(&key_hash);
    ensure!(
        !path_entry_exists(&final_path),
        "a staged artifact already exists for this job key"
    );
    let mut nonce_bytes = [0u8; 12];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| anyhow::anyhow!("generate unique partial directory id"))?;
    let nonce = nonce_bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let partial = Path::new(&config.dbfr.staging_root).join(format!(".{key_hash}-{nonce}.partial"));
    let receipt = final_path.join("receipt.json");
    Ok(PullPlan {
        target: "dbfr".into(),
        job_key: job_key.into(),
        remote_id: remote_id.into(),
        source_dir,
        file,
        destination: final_path.display().to_string(),
        partial: partial.display().to_string(),
        receipt: receipt.display().to_string(),
        applied: false,
    })
}

pub fn apply(root: &Path, plan: &PullPlan) -> Result<PullPlan> {
    ensure!(
        plan.target == "dbfr" && !plan.applied,
        "crawl pull apply requires an unapplied DBFR plan"
    );
    let expected = self::plan(root, &plan.job_key, &plan.remote_id)?;
    ensure!(
        expected.file == plan.file
            && expected.source_dir == plan.source_dir
            && expected.destination == plan.destination
            && expected.receipt == plan.receipt,
        "crawl pull plan changed since preview"
    );
    let config = load_config(root)?;
    let (ssh, scp) = preflight_identity(&config.dbfr)?;
    let root_path = Path::new(&config.dbfr.staging_root);
    #[cfg(unix)]
    {
        let aphrody_home = Path::new("/home/ubuntu/.aphrody");
        let metadata =
            fs::symlink_metadata(aphrody_home).context("DBFR private Aphrody home is absent")?;
        let uid_output = run(Command::new("id").arg("-u"), "DBFR UID check")?;
        let uid: u32 = String::from_utf8_lossy(&uid_output.stdout).trim().parse()?;
        ensure!(
            metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && metadata.uid() == uid
                && metadata.permissions().mode() & 0o077 == 0,
            "DBFR Aphrody home must be ubuntu-owned, private, and a real directory"
        );
        if !path_entry_exists(root_path) {
            fs::create_dir(root_path)?;
            fs::set_permissions(root_path, fs::Permissions::from_mode(0o700))?;
        }
        let root_metadata = fs::symlink_metadata(root_path)?;
        ensure!(
            root_metadata.is_dir()
                && !root_metadata.file_type().is_symlink()
                && root_metadata.uid() == uid
                && root_metadata.permissions().mode() & 0o077 == 0,
            "DBFR artifact staging root must be ubuntu-owned, private, and a real directory"
        );
    }
    #[cfg(not(unix))]
    bail!("crawl artifact pull must run on DBFR Linux");
    let final_path = Path::new(&plan.destination);
    ensure!(
        !path_entry_exists(final_path),
        "final artifact destination appeared after planning"
    );
    let root_path = Path::new(&config.dbfr.staging_root);
    let partial_path = Path::new(&plan.partial);
    let partial_name = partial_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let prefix = format!(".{}-", digest(plan.job_key.as_bytes()));
    ensure!(
        partial_path.parent() == Some(root_path)
            && partial_name.starts_with(&prefix)
            && partial_name.ends_with(".partial")
            && partial_name.len() == prefix.len() + 24 + ".partial".len()
            && partial_name[prefix.len()..prefix.len() + 24]
                .bytes()
                .all(|b| b.is_ascii_hexdigit()),
        "planned partial path is outside the private staging root or has an invalid nonce"
    );
    ensure!(
        !path_entry_exists(partial_path),
        "unique partial path already exists"
    );
    let partial = Path::new(&plan.partial);
    fs::create_dir(partial).context("create unique .partial artifact directory")?;
    let artifact_dir = partial.join("artifact");
    let result = (|| -> Result<()> {
        #[cfg(unix)]
        fs::set_permissions(partial, fs::Permissions::from_mode(0o700))?;
        fs::create_dir(&artifact_dir)?;
        #[cfg(unix)]
        fs::set_permissions(&artifact_dir, fs::Permissions::from_mode(0o700))?;
        let job = verified_job_status(root_path, &plan.remote_id, &plan.job_key, &plan.source_dir)?;
        let before = remote_inventory(&ssh, &config.dbfr, &plan.source_dir)?;
        ensure!(
            before == plan.file,
            "VPS artifact changed after plan; refusing pull"
        );
        let remote_spec = format!("{}:{}", config.dbfr.ssh_alias, plan.file.source);
        let local_path = artifact_dir.join(DOCUMENTS_FILE);
        run(
            Command::new(&scp).args([
                "-F",
                &config.dbfr.ssh_config,
                "-B",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=8",
                "-o",
                "ServerAliveInterval=10",
                "-o",
                "ServerAliveCountMax=2",
                &remote_spec,
                local_path
                    .to_str()
                    .context("UTF-8 local artifact path required")?,
            ]),
            "copy one allowlisted crawl JSONL from VPS",
        )?;
        let (size, hash) = hash_file(&local_path, MAX_ARTIFACT_BYTES)?;
        ensure!(
            size == plan.file.size_bytes && hash == plan.file.sha256,
            "received JSONL size or SHA-256 differs from VPS inventory"
        );
        #[cfg(unix)]
        fs::set_permissions(&local_path, fs::Permissions::from_mode(0o600))?;
        let after = remote_inventory(&ssh, &config.dbfr, &plan.source_dir)?;
        ensure!(
            after == plan.file,
            "VPS source changed during pull; refusing to finalize"
        );
        let documents_path = artifact_dir.join(DOCUMENTS_FILE);
        let rows = count_jsonl_rows(&documents_path, MAX_ARTIFACT_BYTES)?;
        ensure!(
            rows > 0 && rows <= MAX_DOCUMENTS,
            "JSONL document count exceeds 10,000"
        );
        let receipt = PullReceipt {
            schema: "aphrody-crawl-pull-receipt",
            version: 1,
            intent_key: &plan.job_key,
            job_id: &plan.remote_id,
            host: "vps",
            job_state: "succeeded",
            host_affinity: "vps",
            source_dir: &plan.source_dir,
            source_file: &plan.file,
            document_records: rows,
            remote_job_status_verified: job["state"] == "succeeded",
            export_manifest_present: false,
            importable: false,
            received_at: chrono::Utc::now().to_rfc3339(),
        };
        let receipt_path = partial.join("receipt.json");
        let mut receipt_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&receipt_path)?;
        #[cfg(unix)]
        receipt_file.set_permissions(fs::Permissions::from_mode(0o600))?;
        receipt_file.write_all(&serde_json::to_vec_pretty(&receipt)?)?;
        receipt_file.sync_all()?;
        File::open(&documents_path)?.sync_all()?;
        File::open(&artifact_dir)?.sync_all()?;
        File::open(partial)?.sync_all()?;
        Ok(())
    })();
    if let Err(error) = result {
        return match fs::remove_dir_all(partial) {
            Ok(()) => Err(error)
                .context("crawl artifact pull did not finalize; partial files were removed"),
            Err(cleanup) => Err(error).context(format!(
                "crawl artifact pull failed and partial cleanup failed at {}: {cleanup}",
                partial.display()
            )),
        };
    }
    if let Err(error) = fs::rename(partial, &plan.destination) {
        let cleanup = fs::remove_dir_all(partial);
        return match cleanup {
            Ok(()) => Err(error)
                .context("atomic crawl artifact finalization failed; partial files were removed"),
            Err(cleanup) => Err(error).context(format!(
                "finalization and partial cleanup failed at {}: {cleanup}",
                partial.display()
            )),
        };
    }
    if let Err(error) = File::open(root_path).and_then(|directory| directory.sync_all()) {
        let cleanup = fs::remove_dir_all(&plan.destination);
        let _ = File::open(root_path).and_then(|directory| directory.sync_all());
        return match cleanup {
            Ok(()) => Err(error).context(
                "final artifact directory sync failed; the new final directory was rolled back",
            ),
            Err(cleanup) => Err(error).context(format!(
                "directory sync and rollback failed at {}: {cleanup}",
                plan.destination
            )),
        };
    }
    Ok(PullPlan {
        applied: true,
        ..plan.clone()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_path_uses_the_sha256_of_the_intent_key_under_one_allowlisted_root() {
        let roots = vec!["/home/ubuntu/crawl-export".to_owned()];
        let path = valid_remote_source(&roots, "job-123").unwrap();
        assert_eq!(
            path,
            format!("/home/ubuntu/crawl-export/{}", digest(b"job-123"))
        );
        assert!(valid_remote_source(&[], "job-123").is_err());
    }

    #[test]
    fn safe_ids_are_single_path_components() {
        assert!(safe_id("job-1:success"));
        assert!(!safe_id("../job-1"));
        assert!(!safe_id("job/1"));
        assert!(valid_intent_key(&"x".repeat(256)));
        assert!(!valid_intent_key(&"x".repeat(257)));
    }

    #[test]
    fn remote_job_must_be_successful_vps_crawl_with_key_derived_output() {
        let source_dir = format!(
            "/home/ubuntu/.aphrody/workspaces/dbfr/crawl/campaigns/{}",
            digest(b"intent-1")
        );
        let job = serde_json::json!({
            "id": "remote-1",
            "kind": "web-pipeline",
            "idempotency_key": "intent-1",
            "state": "succeeded",
            "max_attempts": 1,
            "attempts": 1,
            "result": {"exitCode": 0},
            "host_affinity": {"mode": "hosts", "hosts": ["vps"]},
            "payload": {"args": [
                "dragon-ball", "crawl", "--profile", "shenron", "--source", "official",
                "--browser", "playwright", "--output", source_dir,
                "--max-requests", "50", "--max-depth", "2",
                "--render", "--json", "--index"
            ]}
        });
        assert!(bounded_crawl_job(&job, "remote-1", "intent-1", &source_dir));
        assert!(!bounded_crawl_job(
            &job,
            "remote-1",
            "wrong-intent",
            &source_dir
        ));
        assert!(!bounded_crawl_job(
            &job,
            "remote-1",
            "intent-1",
            "/other/path"
        ));
        assert!(!bounded_crawl_job(
            &job,
            "remote-2",
            "intent-1",
            &source_dir
        ));
        let mut unlisted_source = job.clone();
        unlisted_source["payload"]["args"][5] = serde_json::json!("custom");
        assert!(!bounded_crawl_job(
            &unlisted_source,
            "remote-1",
            "intent-1",
            &source_dir
        ));
    }
}
