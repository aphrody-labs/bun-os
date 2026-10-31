// SPDX-License-Identifier: Apache-2.0
//! Environment and integration diagnostics (`aphrody doctor`).

use serde_json::Value;

/// Canonical TTL (seconds) for the peer heartbeat file, as declared in the
/// `etiquette.ttl_seconds` block of `C:/winclean/.coord/ai.json`.
const HEARTBEAT_TTL_SECS: u64 = 600;

/// Absolute path to the winclean-side inbox watched by aphrody.
const WINCLEAN_INBOX_PATH: &str = "C:/winclean/.coord/inbox-from-winclean.jsonl";

/// Absolute path to the peer heartbeat file written by winclean.
const WINCLEAN_HEARTBEAT_PATH: &str = "C:/winclean/.coord/heartbeat-winclean.txt";

/// Environment variable overriding the winclean root (a Windows path such as `D:/winclean`).
const WINCLEAN_ROOT_ENV: &str = "APHRODY_WINCLEAN_ROOT";

/// Winclean path for `default` (a `C:/winclean/...` path), honouring the root override.
fn winclean_path(default: &str) -> String {
    match std::env::var(WINCLEAN_ROOT_ENV) {
        Ok(root) if !root.trim().is_empty() => {
            format!(
                "{}{}",
                root.trim().trim_end_matches(['/', '\\']),
                &default["C:/winclean".len()..]
            )
        }
        _ => default.to_string(),
    }
}

/// Host locations of a Windows path: itself on Windows, else the `/x/` and `/mnt/x/` drive mounts.
fn host_candidates(windows_path: &str) -> Vec<std::path::PathBuf> {
    let bytes = windows_path.as_bytes();
    if cfg!(target_os = "windows") || bytes.len() < 3 || bytes[1] != b':' {
        return vec![std::path::PathBuf::from(windows_path)];
    }
    let drive = (bytes[0] as char).to_ascii_lowercase();
    let rest = windows_path[2..].replace('\\', "/");
    vec![
        std::path::PathBuf::from(format!("/{drive}{rest}")),
        std::path::PathBuf::from(format!("/mnt/{drive}{rest}")),
    ]
}

/// Outcome of a single diagnostic check.
pub enum CheckResult {
    Ok(String),
    Warn(String),
    Err(String),
}

impl CheckResult {
    pub fn line(&self, key: &str) -> String {
        match self {
            CheckResult::Ok(v) => format!("  {key}: {v}"),
            CheckResult::Warn(v) => format!("  {key}: {v}"),
            CheckResult::Err(v) => format!("  {key}: {v}"),
        }
    }

    pub fn is_critical_failure(&self) -> bool {
        matches!(self, CheckResult::Err(_))
    }

    pub fn value(&self) -> &str {
        match self {
            CheckResult::Ok(v) | CheckResult::Warn(v) | CheckResult::Err(v) => v.as_str(),
        }
    }
}

/// Collected diagnostics passed to both text and JSON output paths.
pub struct DoctorReport {
    pub binary_version: String,
    pub rustls_provider: String,
    pub reqwest_tls: &'static str,
    pub allocator: &'static str,
    pub tokio_runtime: &'static str,
    pub ai_json: CheckResult,
    pub well_known_ai_json: CheckResult,
    pub peer_heartbeat: CheckResult,
    pub inbox: CheckResult,
    pub http_listener: CheckResult,
    pub cargo_vet: CheckResult,
    pub workspace: CheckResult,
    pub env_vars: Vec<(String, String)>,
}

impl DoctorReport {
    #[must_use]
    pub fn verdict(&self) -> &'static str {
        let has_error = self.ai_json.is_critical_failure() || self.cargo_vet.is_critical_failure();
        let has_warn = matches!(self.well_known_ai_json, CheckResult::Warn(_))
            || matches!(self.peer_heartbeat, CheckResult::Warn(_))
            || matches!(self.inbox, CheckResult::Warn(_))
            || matches!(self.http_listener, CheckResult::Warn(_))
            || matches!(self.cargo_vet, CheckResult::Warn(_))
            || matches!(self.workspace, CheckResult::Warn(_));
        if has_error {
            "UNHEALTHY"
        } else if has_warn {
            "DEGRADED"
        } else {
            "HEALTHY"
        }
    }

    #[must_use]
    pub fn to_json(&self) -> Value {
        let r = self;
        // Build structured JSON without deriving Serialize on internal types, to
        // keep the data model self-contained in this function.
        let env_obj: serde_json::Map<String, Value> = r
            .env_vars
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();

        // Extract heartbeat age_s and is_stale from the peer_heartbeat check value.
        // The text carries "N s ago" — parse it back for the JSON field.
        let (heartbeat_age_s, heartbeat_is_stale) = parse_age_from_result(&r.peer_heartbeat);

        // Extract HTTP listener status code if present.
        let http_status_code = r
            .http_listener
            .value()
            .split("-> ")
            .nth(1)
            .and_then(|s| s.trim_end_matches(')').parse::<u16>().ok());

        let doc = serde_json::json!({
            "runtime": {
                "binary_version": r.binary_version,
                "rustls_provider": r.rustls_provider,
                "reqwest_tls": r.reqwest_tls,
                "allocator": r.allocator,
                "tokio_runtime": r.tokio_runtime,
                "ai_json": r.ai_json.value(),
                "well_known_ai_json": r.well_known_ai_json.value(),
            },
            "peer_a2a": {
                "heartbeat_age_s": heartbeat_age_s,
                "is_stale": heartbeat_is_stale,
                "heartbeat_detail": r.peer_heartbeat.value(),
                "http_listener_status": http_status_code,
                "http_listener_detail": r.http_listener.value(),
                "inbox_detail": r.inbox.value(),
            },
            "supply_chain": {
                "cargo_deny": "not present at runtime — use the dev tool for CI",
                "cargo_vet_audits": r.cargo_vet.value(),
            },
            "agent_workspace": {
                "detail": r.workspace.value(),
            },
            "environment": serde_json::Value::Object(env_obj),
            "verdict": r.verdict(),
        });

        doc
    }
}

/// Run every check and render the report as the `aphrody doctor --json` document.
///
/// `binary_version` is the caller's build description (version, commit, date, target).
pub async fn diagnostics(binary_version: String) -> Value {
    collect_diagnostics(binary_version).await.to_json()
}

pub async fn collect_diagnostics(binary_version: String) -> DoctorReport {
    let rustls_label = match rustls::crypto::ring::default_provider().install_default() {
        Ok(()) => "installed (ring)".to_string(),
        Err(_) => "already installed (ring)".to_string(),
    };

    let env_vars = ["RUST_BACKTRACE", "RUST_LOG", "TERM", "TZ"]
        .iter()
        .map(|v| {
            (
                v.to_string(),
                std::env::var(v).unwrap_or_else(|_| "not set".to_string()),
            )
        })
        .collect();

    DoctorReport {
        binary_version,
        rustls_provider: rustls_label,
        reqwest_tls: "rustls",
        allocator: "active (native)",
        tokio_runtime: "multi-thread, full",
        ai_json: check_ai_json(),
        well_known_ai_json: check_well_known_ai_json(),
        peer_heartbeat: check_peer_heartbeat(),
        inbox: check_inbox(),
        http_listener: check_http_listener().await,
        cargo_vet: check_vet_audits(),
        workspace: check_workspace(),
        env_vars,
    }
}

/// Workspace health (AH-16): opens the agent home, assembles against the
/// default bootstrap budget, and warns on missing required files or truncation.
fn check_workspace() -> CheckResult {
    let config = match crate::config::load_config(&aphrody_config::CliOverrides::default()) {
        Ok(config) => config,
        Err(error) => {
            return CheckResult::Warn(format!("agent home profile config not loadable: {error}"));
        }
    };
    let workspace = match crate::config::profile_workspace(&config) {
        Ok(workspace) => workspace,
        Err(error) => {
            return CheckResult::Warn(format!("agent home profile not resolvable: {error}"));
        }
    };
    let home = match aphrody_agent_home::AgentHome::open(aphrody_agent_home::HomeOptions {
        workspace: Some(workspace),
        profile: config.active_profile.clone(),
        ..Default::default()
    }) {
        Ok(h) => h,
        Err(e) => return CheckResult::Warn(format!("agent home not openable: {e}")),
    };
    let root = home.root();
    if !root.is_dir() {
        return CheckResult::Warn(format!(
            "workspace not seeded ({}); run `aphrody oc-onboard`",
            root.display()
        ));
    }

    let mut missing_required: Vec<&str> = Vec::new();
    for file in [
        aphrody_agent_home::BootstrapFile::Agents,
        aphrody_agent_home::BootstrapFile::Tools,
    ] {
        if !root.join(file.filename()).is_file() {
            missing_required.push(file.filename());
        }
    }

    let budget = aphrody_agent_home::BootstrapBudget::default();
    let view = home.system_prompt(&budget);
    let total_chars: usize = view.sections.iter().map(|s| s.body.chars().count()).sum();

    if !missing_required.is_empty() {
        return CheckResult::Warn(format!(
            "{} ({}; missing required: {})",
            root.display(),
            human_chars(total_chars),
            missing_required.join(", ")
        ));
    }
    if let Some(report) = &view.truncation {
        return CheckResult::Warn(format!(
            "{} ({}; {} file(s) truncated by the bootstrap budget — raise the caps or trim the \
             files)",
            root.display(),
            human_chars(total_chars),
            report.truncated_files
        ));
    }
    CheckResult::Ok(format!(
        "{} ({}, {} section(s), no truncation)",
        root.display(),
        human_chars(total_chars),
        view.sections.len()
    ))
}

/// Render a char count compactly (e.g. `12.0k chars`).
fn human_chars(n: usize) -> String {
    if n >= 1000 {
        format!("{:.1}k chars", n as f64 / 1000.0)
    } else {
        format!("{n} chars")
    }
}

/// Extract age in seconds from a `CheckResult` value string of the form
/// "... (N s ago — ...)". Returns `(None, false)` when the age cannot be
/// parsed (e.g. peer offline).
fn parse_age_from_result(r: &CheckResult) -> (Option<u64>, bool) {
    let text = r.value();
    // Look for pattern "(NNN s ago"
    if let Some(start) = text.find('(') {
        let inner = &text[start + 1..];
        if let Some(end) = inner.find(" s ago")
            && let Ok(age) = inner[..end].trim().parse::<u64>()
        {
            let is_stale = age > HEARTBEAT_TTL_SECS;
            return (Some(age), is_stale);
        }
    }
    (None, false)
}

/// Locate repo root by walking up from the current exe directory.
pub fn repo_root() -> Option<std::path::PathBuf> {
    // Primary heuristic: walk up from cwd until we find a Cargo.toml with
    // `[workspace]`, which is reliable in both dev and release layouts.
    let mut dir = std::env::current_dir().ok()?;
    loop {
        let candidate = dir.join("Cargo.toml");
        if candidate.exists()
            && let Ok(content) = std::fs::read_to_string(&candidate)
            && content.contains("[workspace]")
        {
            return Some(dir);
        }
        if !dir.pop() {
            break;
        }
    }

    // Fallback: exe-relative (release layout: target/<triple>/release/aphrody)
    let exe = std::env::current_exe().ok()?;
    // Walk up exe path until Cargo.toml with [workspace] found.
    let mut dir = exe.parent()?.to_path_buf();
    loop {
        let candidate = dir.join("Cargo.toml");
        if candidate.exists()
            && let Ok(content) = std::fs::read_to_string(&candidate)
            && content.contains("[workspace]")
        {
            return Some(dir);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn check_ai_json() -> CheckResult {
    let root = match repo_root() {
        Some(r) => r,
        None => {
            return CheckResult::Warn("repo root not found — skip".to_string());
        }
    };
    let path = root.join("ai.json");
    if !path.exists() {
        return CheckResult::Err(format!("absent (expected {})", path.display()));
    }
    // Try to read schema version and A2A version from the JSON.
    let schema_v = match std::fs::read_to_string(&path) {
        Ok(text) => {
            let schema_ver = if text.contains("\"version\": \"1.0.0\"") {
                "schema v1.0.0"
            } else {
                "schema unknown"
            };
            let a2a_ver = if text.contains("a2a/v0.4") || text.contains("a2a_protocol_version") {
                "A2A v0.4"
            } else {
                "A2A unknown"
            };
            format!("{schema_ver}, {a2a_ver}")
        }
        Err(e) => return CheckResult::Warn(format!("unreadable ({e})")),
    };
    CheckResult::Ok(format!("present at {} ({schema_v})", path.display()))
}

fn check_well_known_ai_json() -> CheckResult {
    let root = match repo_root() {
        Some(r) => r,
        None => return CheckResult::Warn("repo root not found — skip".to_string()),
    };
    let path = root.join(".well-known").join("ai.json");
    if !path.exists() {
        return CheckResult::Warn("absent (non-critical for local dev)".to_string());
    }
    // Look for canonical_manifest field.
    let detail = match std::fs::read_to_string(&path) {
        Ok(text) => {
            if text.contains("canonical_manifest") || text.contains("../ai.json") {
                "present (canonical_manifest -> ../ai.json)".to_string()
            } else {
                "present".to_string()
            }
        }
        Err(e) => return CheckResult::Warn(format!("unreadable ({e})")),
    };
    CheckResult::Ok(detail)
}

fn check_peer_heartbeat() -> CheckResult {
    // The peer heartbeat file is written by the winclean side.  The canonical
    // path and TTL are declared in C:/winclean/.coord/ai.json under
    // `channels[type=heartbeat_file]`.  We use the hard-coded constants so
    // the check is self-contained and does not require parsing the coord ai.json
    // at runtime.
    let candidates = host_candidates(&winclean_path(WINCLEAN_HEARTBEAT_PATH));

    let path = match candidates.iter().find(|p| p.exists()) {
        Some(p) => p.clone(),
        // The file-mailbox peer is optional: agents coordinate through the A2A hub
        // (APHRODY_A2A_HUB_URL, docs/A2A-AGENTS.md), so an absent winclean coord is not a fault.
        None => {
            return CheckResult::Ok("winclean file peer not configured (A2A hub in use)".to_owned());
        }
    };

    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return CheckResult::Warn(format!("unreadable ({e})")),
    };

    let ts_str = text.trim().to_string();
    if ts_str.is_empty() {
        return CheckResult::Warn("heartbeat file is empty — peer not yet active".to_string());
    }

    match parse_iso8601_approx(&ts_str) {
        None => CheckResult::Ok(format!("heartbeat {ts_str} (age unknown)")),
        Some(ts_unix) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            let age_secs = now.saturating_sub(ts_unix);
            // Bug fix: use the declared TTL (600 s) as the staleness boundary.
            let (freshness, is_stale) = if age_secs > HEARTBEAT_TTL_SECS {
                (format!("stale (over {HEARTBEAT_TTL_SECS}s TTL)"), true)
            } else {
                ("fresh".to_string(), false)
            };
            let result = format!("heartbeat {ts_str} ({age_secs} s ago — {freshness})");
            if is_stale {
                CheckResult::Warn(result)
            } else {
                CheckResult::Ok(result)
            }
        }
    }
}

fn check_inbox() -> CheckResult {
    // The canonical inbox path is declared in the coord ai.json channels block
    // (channels[type=file_jsonl].outbox).  We resolve the platform-specific
    // equivalent of the C:/ path rather than looking in the aphrody repo root.
    let inbox = host_candidates(&winclean_path(WINCLEAN_INBOX_PATH));
    let path = inbox
        .iter()
        .find(|candidate| candidate.exists())
        .unwrap_or(&inbox[inbox.len() - 1])
        .clone();

    if !path.exists() {
        return CheckResult::Ok("winclean file inbox not configured (A2A hub in use)".to_owned());
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return CheckResult::Warn(format!("unreadable ({e})")),
    };
    let envelope_count = text.lines().filter(|l| !l.trim().is_empty()).count();
    // Extract the id field from the last non-empty line.
    let last_id = text
        .lines()
        .rfind(|l| !l.trim().is_empty())
        .and_then(|line| {
            extract_json_str_field(line, "id").or_else(|| extract_json_str_field(line, "from"))
        })
        .unwrap_or_else(|| "unknown".to_string());
    CheckResult::Ok(format!("{envelope_count} envelopes, last id={last_id}"))
}

async fn check_http_listener() -> CheckResult {
    // The hub this host talks to: the VPS listener directly, or the workstation's loopback tunnel to it.
    let base = std::env::var("APHRODY_A2A_HUB_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:8788".to_owned());
    let base = base.trim_end_matches('/');
    let url = format!("{base}/ping");
    // Build a reqwest client with a short timeout so we don't block the
    // user for multi-second hangs when the peer listener is down.
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(e) => return CheckResult::Warn(format!("could not build HTTP client: {e}")),
    };

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => CheckResult::Ok(format!(
            "{base} (alive, /ping -> {})",
            resp.status().as_u16()
        )),
        Ok(resp) => CheckResult::Warn(format!("{base} (non-200: {})", resp.status().as_u16())),
        Err(_) => CheckResult::Warn(format!("{base} (no response — hub or tunnel not running)")),
    }
}

fn check_vet_audits() -> CheckResult {
    let root = match repo_root() {
        Some(r) => r,
        None => return CheckResult::Warn("repo root not found — skip".to_string()),
    };
    let path = root.join("supply-chain").join("audits.toml");
    if !path.exists() {
        return CheckResult::Warn(format!("absent (expected {})", path.display()));
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return CheckResult::Warn(format!("unreadable ({e})")),
    };
    // Count `[[audits.<crate>]]` style entries.
    let entries = text
        .lines()
        .filter(|l| {
            let t = l.trim();
            t.starts_with("[[audits.") || (t.starts_with("[audits.") && !t.starts_with("[audits]"))
        })
        .count();
    CheckResult::Ok(format!("present at {} ({entries} entries)", path.display()))
}

/// Extract the string value for a JSON key using simple substring search.
/// Works for simple flat fields like `"key": "value"`.
fn extract_json_str_field(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let start = text.find(&needle)?;
    let after_key = &text[start + needle.len()..];
    // Skip whitespace and colon.
    let colon = after_key.find(':')?;
    let after_colon = after_key[colon + 1..].trim_start();
    if let Some(inner) = after_colon.strip_prefix('"') {
        let end = inner.find('"')?;
        Some(inner[..end].to_string())
    } else {
        None
    }
}

/// Parse an ISO-8601 datetime string to a Unix timestamp (seconds, UTC approx).
/// Handles `YYYY-MM-DDTHH:MM:SSZ` and `YYYY-MM-DDTHH:MM:SS+HH:MM` forms.
fn parse_iso8601_approx(s: &str) -> Option<u64> {
    // Expect at least YYYY-MM-DD (10 chars).
    if s.len() < 10 {
        return None;
    }
    let year: u64 = s[0..4].parse().ok()?;
    let month: u64 = s[5..7].parse().ok()?;
    let day: u64 = s[8..10].parse().ok()?;

    let (hour, min, sec) = if s.len() >= 19 {
        let h: u64 = s[11..13].parse().ok()?;
        let m: u64 = s[14..16].parse().ok()?;
        let sc: u64 = s[17..19].parse().ok()?;
        (h, m, sc)
    } else {
        (0, 0, 0)
    };

    // Parse optional timezone offset (+HH:MM or -HH:MM).
    let tz_offset_secs: i64 = if s.len() >= 25 {
        let tz = &s[19..];
        let tz = tz.trim_start_matches('Z');
        if tz.len() >= 6 && (tz.starts_with('+') || tz.starts_with('-')) {
            let sign: i64 = if tz.starts_with('+') { 1 } else { -1 };
            let tz_h: i64 = tz[1..3].parse().ok()?;
            let tz_m: i64 = tz[4..6].parse().ok()?;
            sign * (tz_h * 3600 + tz_m * 60)
        } else {
            0
        }
    } else {
        0
    };

    // Days since epoch using the same Gregorian formula as `epoch_to_date`.
    // Convert calendar date to JDN then to Unix days.
    let a = (14u64.wrapping_sub(month)) / 12;
    let y = year + 4800 - a;
    let m_adj = month + 12 * a - 3;
    let jdn = day + (153 * m_adj + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045;
    // JDN of 1970-01-01 is 2440588.
    let unix_days = jdn.saturating_sub(2440588);
    let unix_secs = unix_days * 86400 + hour * 3600 + min * 60 + sec;
    let adjusted = unix_secs as i64 - tz_offset_secs;
    Some(adjusted.max(0) as u64)
}
