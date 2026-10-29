// SPDX-License-Identifier: Apache-2.0
//! Local port-forwards to aphrody-infra catalog services, grouped per SSH alias.
//!
//! `aphrody ssh tunnel` reads `infra/config/service-catalog.json` (auto-discovered, or given
//! explicitly) and opens one `ssh -N -L ...` process per SSH alias covering every requested
//! service, so application repositories stop hand-rolling their own `ssh -L` invocations.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};

use clap::Args;
use serde::{Deserialize, Serialize};
use tokio::{process::Command, task::JoinSet};

use crate::Error;

/// Relative path of the service catalog inside an aphrody-infra checkout.
pub const CATALOG_RELATIVE_PATH: &str = "infra/config/service-catalog.json";

/// Default local-port offset applied to a service's remote port.
pub const DEFAULT_OFFSET: u16 = 10_000;

/// SSH alias used when a catalog entry does not name one.
pub const DEFAULT_ALIAS: &str = "vps";

/// Service id used for the built-in Redis entry when the catalog does not carry one.
pub const REDIS_SERVICE_ID: &str = "redis";

/// Default set of service ids opened by `aphrody ssh tunnel` when `--services` is omitted.
pub const DEFAULT_TUNNEL_SERVICE_IDS: &[&str] = &["aphrody-ai-http", REDIS_SERVICE_ID];

/// Shared flags for `tunnel` and `tunnel status`.
#[derive(Debug, Clone, Args)]
pub struct TunnelArgs {
    /// Comma or space separated catalog service ids (defaults to the built-in dev set).
    #[arg(long)]
    pub services: Option<String>,
    /// Local port offset added to each service's remote port.
    #[arg(long, default_value_t = DEFAULT_OFFSET)]
    pub offset: u16,
    /// Explicit path to `service-catalog.json` (auto-discovered from the cwd otherwise).
    #[arg(long)]
    pub catalog: Option<PathBuf>,
    /// Print the resolved plan and exit without opening or probing anything.
    #[arg(long)]
    pub dry_run: bool,
}

/// One resolved local -> remote forward.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TunnelPlanEntry {
    pub id: String,
    pub alias: String,
    #[serde(rename = "localPort")]
    pub local_port: u16,
    #[serde(rename = "remotePort")]
    pub remote_port: u16,
}

/// Status of one planned forward, as probed by `tunnel status`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TunnelStatusEntry {
    pub id: String,
    pub alias: String,
    #[serde(rename = "localPort")]
    pub local_port: u16,
    #[serde(rename = "remotePort")]
    pub remote_port: u16,
    pub up: bool,
}

/// Forwards grouped under a single SSH alias, ready to become one `ssh -N -L ... -L ... <alias>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelGroup {
    pub alias: String,
    pub ids: Vec<String>,
    pub forwards: Vec<(u16, u16)>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawCatalog {
    #[serde(default)]
    services: Vec<RawService>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawService {
    id: String,
    #[serde(default)]
    health: Option<String>,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    host: Option<String>,
    #[serde(default)]
    node: Option<String>,
    #[serde(default, rename = "sshAlias")]
    ssh_alias: Option<String>,
}

fn builtin_redis() -> RawService {
    RawService {
        id: REDIS_SERVICE_ID.to_string(),
        health: None,
        target: Some(format!("{DEFAULT_ALIAS}:127.0.0.1:6379")),
        host: None,
        node: None,
        ssh_alias: None,
    }
}

/// Split a `--services` value into ids, falling back to [`DEFAULT_TUNNEL_SERVICE_IDS`].
#[must_use]
pub fn parse_service_ids(services: Option<&str>) -> Vec<String> {
    match services {
        Some(raw) if !raw.trim().is_empty() => raw
            .split(|c| c == ',' || c == ' ')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
        _ => DEFAULT_TUNNEL_SERVICE_IDS
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
    }
}

fn normalize_alias(raw: &str) -> String {
    match raw.trim() {
        "ovh-vps" | "ovh-vps-direct" | "ovh-vps-ubuntu-direct" => DEFAULT_ALIAS.to_string(),
        other => other.to_string(),
    }
}

fn url_scheme(url: &str) -> Option<&str> {
    url.split_once("://").map(|(scheme, _)| scheme)
}

fn parse_url_authority(url: &str) -> Result<(String, u16), Error> {
    let (_, rest) = url
        .split_once("://")
        .ok_or_else(|| Error::Catalog(format!("invalid URL '{url}': missing scheme")))?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let (host, port_str) = authority
        .rsplit_once(':')
        .ok_or_else(|| Error::Catalog(format!("invalid URL '{url}': missing port")))?;
    let port: u16 = port_str
        .parse()
        .map_err(|_| Error::Catalog(format!("invalid URL '{url}': invalid port '{port_str}'")))?;
    Ok((host.to_string(), port))
}

/// Parse a catalog `target` field shaped as `<alias>:<host>:<port>` (e.g. `dbfr:127.0.0.1:5432`).
fn parse_target(target: &str) -> Result<(String, u16), Error> {
    let (alias, rest) = target.split_once(':').ok_or_else(|| {
        Error::Catalog(format!(
            "invalid target '{target}': expected 'alias:host:port'"
        ))
    })?;
    let (_, port_str) = rest.rsplit_once(':').ok_or_else(|| {
        Error::Catalog(format!(
            "invalid target '{target}': expected 'alias:host:port'"
        ))
    })?;
    let port: u16 = port_str.parse().map_err(|_| {
        Error::Catalog(format!(
            "invalid target '{target}': invalid port '{port_str}'"
        ))
    })?;
    Ok((normalize_alias(alias), port))
}

fn resolve_entry(
    id: &str,
    raw: Option<&RawService>,
    offset: u16,
) -> Result<TunnelPlanEntry, Error> {
    let owned_builtin;
    let raw = match raw {
        Some(r) => r,
        None if id == REDIS_SERVICE_ID => {
            owned_builtin = builtin_redis();
            &owned_builtin
        }
        None => {
            return Err(Error::Catalog(format!(
                "service '{id}' not found in the catalog (pass --catalog, or check the id)"
            )));
        }
    };

    let (alias, remote_port) = if let Some(target) = raw.target.as_deref() {
        parse_target(target)?
    } else {
        let health = raw.health.as_deref().ok_or_else(|| {
            Error::Catalog(format!(
                "service '{id}' has neither 'target' nor 'health'; cannot derive a remote port"
            ))
        })?;
        let (_, port) = parse_url_authority(health)?;
        let alias = raw
            .host
            .as_deref()
            .or(raw.node.as_deref())
            .or(raw.ssh_alias.as_deref())
            .map_or_else(|| DEFAULT_ALIAS.to_string(), normalize_alias);
        (alias, port)
    };

    let local_port = match raw.health.as_deref().and_then(url_scheme) {
        Some("tcp") => {
            let health = raw.health.as_deref().expect("checked by url_scheme above");
            parse_url_authority(health)?.1
        }
        _ => remote_port.checked_add(offset).ok_or_else(|| {
            Error::Catalog(format!(
                "local port overflow for '{id}': {remote_port} + offset {offset}"
            ))
        })?,
    };

    Ok(TunnelPlanEntry {
        id: id.to_string(),
        alias,
        local_port,
        remote_port,
    })
}

/// Resolve a tunnel plan for `service_ids` from a raw catalog JSON document.
pub fn resolve_plan(
    catalog_json: &str,
    service_ids: &[String],
    offset: u16,
) -> Result<Vec<TunnelPlanEntry>, Error> {
    let catalog: RawCatalog = serde_json::from_str(catalog_json)
        .map_err(|e| Error::Catalog(format!("invalid service catalog JSON: {e}")))?;
    let by_id: BTreeMap<&str, &RawService> = catalog
        .services
        .iter()
        .map(|s| (s.id.as_str(), s))
        .collect();

    service_ids
        .iter()
        .map(|id| resolve_entry(id, by_id.get(id.as_str()).copied(), offset))
        .collect()
}

/// Locate `service-catalog.json`, honoring an explicit path, `APHRODY_INFRA_CATALOG`,
/// `APHRODY_INFRA_ROOT`, or a search of the current directory and its ancestors (direct or a
/// active monorepo identified by its current SSH owner layout).
pub fn resolve_catalog_path(explicit: Option<&Path>) -> Result<PathBuf, Error> {
    if let Some(p) = explicit {
        return Ok(p.to_path_buf());
    }
    if let Ok(direct) = std::env::var("APHRODY_INFRA_CATALOG") {
        let trimmed = direct.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    if let Ok(root) = std::env::var("APHRODY_INFRA_ROOT") {
        let trimmed = root.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed).join(CATALOG_RELATIVE_PATH));
        }
    }
    let cwd = std::env::current_dir().map_err(|e| Error::Catalog(format!("cwd: {e}")))?;
    if let Some(path) = find_workspace_catalog(&cwd) {
        return Ok(path);
    }
    Err(Error::Catalog(format!(
        "could not locate {CATALOG_RELATIVE_PATH}; pass --catalog <path>, set \
         APHRODY_INFRA_CATALOG or APHRODY_INFRA_ROOT, or run from the active Aphrody monorepo"
    )))
}

fn find_workspace_catalog(cwd: &Path) -> Option<PathBuf> {
    cwd.ancestors().find_map(|base| {
        let catalog = base.join(CATALOG_RELATIVE_PATH);
        (base.join("Cargo.toml").is_file()
            && base.join("crates/aphrody-ssh/Cargo.toml").is_file()
            && catalog.is_file())
        .then_some(catalog)
    })
}

fn load_catalog(path: &Path) -> Result<String, Error> {
    std::fs::read_to_string(path)
        .map_err(|e| Error::Catalog(format!("reading {}: {e}", path.display())))
}

fn build_plan(args: &TunnelArgs) -> Result<Vec<TunnelPlanEntry>, Error> {
    let catalog_path = resolve_catalog_path(args.catalog.as_deref())?;
    let catalog_json = load_catalog(&catalog_path)?;
    let service_ids = parse_service_ids(args.services.as_deref());
    resolve_plan(&catalog_json, &service_ids, args.offset)
}

/// Group a plan by SSH alias, preserving the order in which aliases first appear.
#[must_use]
pub fn group_by_alias(plan: &[TunnelPlanEntry]) -> Vec<TunnelGroup> {
    let mut order: Vec<String> = Vec::new();
    let mut groups: BTreeMap<String, TunnelGroup> = BTreeMap::new();
    for entry in plan {
        if !groups.contains_key(&entry.alias) {
            order.push(entry.alias.clone());
        }
        let group = groups
            .entry(entry.alias.clone())
            .or_insert_with(|| TunnelGroup {
                alias: entry.alias.clone(),
                ids: Vec::new(),
                forwards: Vec::new(),
            });
        group.ids.push(entry.id.clone());
        group.forwards.push((entry.local_port, entry.remote_port));
    }
    order
        .into_iter()
        .filter_map(|alias| groups.remove(&alias))
        .collect()
}

/// Build the `ssh` argument list for one alias group.
#[must_use]
pub fn build_ssh_args(forwards: &[(u16, u16)], alias: &str) -> Vec<String> {
    let mut args = vec![
        "-N".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=30".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
    ];
    for (local, remote) in forwards {
        args.push("-L".to_string());
        args.push(format!("127.0.0.1:{local}:127.0.0.1:{remote}"));
    }
    args.push(alias.to_string());
    args
}

/// Probe whether something is already listening on `127.0.0.1:<port>`.
pub async fn probe_local_port(port: u16, timeout: Duration) -> bool {
    tokio::task::spawn_blocking(move || {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            timeout,
        )
        .is_ok()
    })
    .await
    .unwrap_or(false)
}

/// Terminates the given processes natively (SIGTERM on Unix, TerminateProcess
/// on Windows) instead of shelling out to `kill`/`taskkill`.
fn kill_pids(pids: &[u32]) {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};
    let wanted: Vec<Pid> = pids.iter().map(|pid| Pid::from_u32(*pid)).collect();
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&wanted),
        true,
        ProcessRefreshKind::nothing(),
    );
    for pid in &wanted {
        if let Some(process) = system.process(*pid) {
            process
                .kill_with(Signal::Term)
                .unwrap_or_else(|| process.kill());
        }
    }
}

/// Kills every local `ssh` client whose command line carries `forward`
/// (e.g. `1080:host:port`), replacing `pkill -f` and a PowerShell CIM query.
pub(crate) fn kill_ssh_forwards(forward: &str) -> usize {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    let mut killed = 0;
    for process in system.processes().values() {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        if name != "ssh" && name != "ssh.exe" {
            continue;
        }
        let matches = process
            .cmd()
            .iter()
            .any(|arg| arg.to_string_lossy().contains(forward));
        if matches && process.kill() {
            killed += 1;
        }
    }
    killed
}

fn render_plan(plan: &[TunnelPlanEntry], json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(plan).expect("serializable")
        );
        return;
    }
    println!("=== APHRODY SSH TUNNEL PLAN ===");
    for entry in plan {
        println!(
            "  {:<24} 127.0.0.1:{:<7} -> {}:{}",
            entry.id, entry.local_port, entry.alias, entry.remote_port
        );
    }
}

fn render_status(statuses: &[TunnelStatusEntry], json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(statuses).expect("serializable")
        );
        return;
    }
    println!("=== APHRODY SSH TUNNEL STATUS ===");
    for s in statuses {
        let flag = if s.up { "UP  " } else { "DOWN" };
        println!(
            "  [{}] {:<24} 127.0.0.1:{:<7} -> {}:{}",
            flag, s.id, s.local_port, s.alias, s.remote_port
        );
    }
}

/// Open every forward in `plan` in the foreground, one `ssh -N` process per alias. Local ports
/// already listening are skipped. Returns when any child exits, or `Ok(())` on Ctrl+C.
pub async fn open_tunnels(plan: &[TunnelPlanEntry], json: bool) -> Result<(), Error> {
    let groups = group_by_alias(plan);
    let mut launched: Vec<(String, Vec<(u16, u16)>)> = Vec::new();
    for group in &groups {
        let mut open_forwards = Vec::new();
        for &(local, remote) in &group.forwards {
            if probe_local_port(local, Duration::from_millis(300)).await {
                if json {
                    println!(
                        "{}",
                        serde_json::json!({
                            "event": "skip",
                            "alias": group.alias,
                            "localPort": local,
                            "remotePort": remote,
                            "reason": "already listening",
                        })
                    );
                } else {
                    println!(
                        "skip 127.0.0.1:{local} -> {}:{remote} (already listening)",
                        group.alias
                    );
                }
            } else {
                open_forwards.push((local, remote));
            }
        }
        if !open_forwards.is_empty() {
            launched.push((group.alias.clone(), open_forwards));
        }
    }

    if launched.is_empty() {
        if !json {
            println!(
                "[SSH Tunnel] Nothing to open; every planned local port is already listening."
            );
        }
        return Ok(());
    }

    let mut pids = Vec::new();
    let mut join_set = JoinSet::new();
    for (alias, forwards) in launched {
        let args = build_ssh_args(&forwards, &alias);
        let mut child = Command::new("ssh").args(&args).spawn()?;
        if let Some(pid) = child.id() {
            pids.push(pid);
        }
        if !json {
            let summary = forwards
                .iter()
                .map(|(l, r)| format!("127.0.0.1:{l}->127.0.0.1:{r}"))
                .collect::<Vec<_>>()
                .join(", ");
            println!("[SSH Tunnel] {alias}: {summary}");
        }
        let alias_for_task = alias.clone();
        join_set.spawn(async move {
            let status = child.wait().await;
            (alias_for_task, status)
        });
    }

    if !json {
        println!("[SSH Tunnel] Press Ctrl+C to close every tunnel.");
    }

    tokio::select! {
        joined = join_set.join_next() => {
            kill_pids(&pids);
            match joined {
                Some(Ok((alias, Ok(status)))) => Err(Error::Remote {
                    code: status.code(),
                    stderr: format!("ssh tunnel for '{alias}' exited unexpectedly"),
                }),
                Some(Ok((alias, Err(e)))) => Err(Error::Remote {
                    code: None,
                    stderr: format!("ssh tunnel for '{alias}' failed: {e}"),
                }),
                Some(Err(join_err)) => Err(Error::Remote {
                    code: None,
                    stderr: format!("tunnel task panicked: {join_err}"),
                }),
                None => Ok(()),
            }
        }
        _ = tokio::signal::ctrl_c() => {
            kill_pids(&pids);
            if !json {
                println!("\n[SSH Tunnel] Closed.");
            }
            Ok(())
        }
    }
}

/// Probe every planned local port and report up/down.
pub async fn probe_plan_status(plan: &[TunnelPlanEntry]) -> Vec<TunnelStatusEntry> {
    let mut out = Vec::with_capacity(plan.len());
    for entry in plan {
        let up = probe_local_port(entry.local_port, Duration::from_millis(500)).await;
        out.push(TunnelStatusEntry {
            id: entry.id.clone(),
            alias: entry.alias.clone(),
            local_port: entry.local_port,
            remote_port: entry.remote_port,
            up,
        });
    }
    out
}

/// `aphrody ssh tunnel`: open (or dry-run print) local port-forwards for the resolved plan.
pub async fn run_tunnel_command(args: &TunnelArgs, json: bool) -> Result<(), Error> {
    let plan = build_plan(args)?;
    if args.dry_run {
        render_plan(&plan, json);
        return Ok(());
    }
    open_tunnels(&plan, json).await
}

/// `aphrody ssh tunnel status`: probe local ports and exit non-zero if any is down.
pub async fn run_tunnel_status_command(args: &TunnelArgs, json: bool) -> Result<(), Error> {
    let plan = build_plan(args)?;
    if args.dry_run {
        render_plan(&plan, json);
        return Ok(());
    }
    let statuses = probe_plan_status(&plan).await;
    render_status(&statuses, json);
    if statuses.iter().any(|s| !s.up) {
        return Err(Error::Remote {
            code: None,
            stderr: "one or more tunnels are down".to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
        "services": [
            {
                "id": "aphrody-ai-http",
                "health": "http://127.0.0.1:8789/healthz"
            },
            {
                "id": "aphrody-embed",
                "health": "http://127.0.0.1:8794/health"
            },
            {
                "id": "db-tunnel",
                "health": "tcp://127.0.0.1:15433",
                "target": "dbfr:127.0.0.1:5432"
            },
            {
                "id": "aphrody-site",
                "health": "http://127.0.0.1:8083/healthz",
                "host": "ovh-vps"
            }
        ]
    }"#;

    #[test]
    fn parse_service_ids_defaults_when_empty() {
        assert_eq!(
            parse_service_ids(None),
            DEFAULT_TUNNEL_SERVICE_IDS
                .iter()
                .map(|s| (*s).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            parse_service_ids(Some("  ")),
            DEFAULT_TUNNEL_SERVICE_IDS
                .iter()
                .map(|s| (*s).to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn parse_service_ids_splits_commas_and_spaces() {
        assert_eq!(
            parse_service_ids(Some("a, b c ,d")),
            vec!["a", "b", "c", "d"]
        );
    }

    #[test]
    fn resolve_plan_default_offset_matches_spec() {
        let ids = [
            "db-tunnel",
            "aphrody-ai-http",
            "aphrody-embed",
            REDIS_SERVICE_ID,
        ]
        .map(String::from);
        let plan = resolve_plan(FIXTURE, &ids, DEFAULT_OFFSET).expect("plan resolves");
        assert_eq!(
            plan,
            vec![
                TunnelPlanEntry {
                    id: "db-tunnel".into(),
                    alias: "dbfr".into(),
                    local_port: 15433,
                    remote_port: 5432,
                },
                TunnelPlanEntry {
                    id: "aphrody-ai-http".into(),
                    alias: "vps".into(),
                    local_port: 18789,
                    remote_port: 8789,
                },
                TunnelPlanEntry {
                    id: "aphrody-embed".into(),
                    alias: "vps".into(),
                    local_port: 18794,
                    remote_port: 8794,
                },
                TunnelPlanEntry {
                    id: "redis".into(),
                    alias: "vps".into(),
                    local_port: 16379,
                    remote_port: 6379,
                },
            ]
        );
    }

    #[test]
    fn resolve_plan_uses_catalog_redis_when_present() {
        let catalog = r#"{"services": [
            {"id": "redis", "health": "tcp://127.0.0.1:6380"}
        ]}"#;
        let plan = resolve_plan(catalog, &["redis".to_string()], DEFAULT_OFFSET).unwrap();
        assert_eq!(plan[0].local_port, 6380);
        assert_eq!(plan[0].remote_port, 6380);
        assert_eq!(plan[0].alias, "vps");
    }

    #[test]
    fn resolve_plan_respects_custom_offset() {
        let plan = resolve_plan(FIXTURE, &["aphrody-ai-http".to_string()], 500).unwrap();
        assert_eq!(plan[0].local_port, 9289);
        assert_eq!(plan[0].remote_port, 8789);
    }

    #[test]
    fn resolve_plan_normalizes_host_alias() {
        let plan = resolve_plan(FIXTURE, &["aphrody-site".to_string()], DEFAULT_OFFSET).unwrap();
        assert_eq!(plan[0].alias, "vps");
    }

    #[test]
    fn resolve_plan_rejects_unknown_service() {
        let err = resolve_plan(
            FIXTURE,
            &["nope-does-not-exist".to_string()],
            DEFAULT_OFFSET,
        )
        .unwrap_err();
        assert!(matches!(err, Error::Catalog(_)));
    }

    #[test]
    fn resolve_plan_rejects_malformed_catalog() {
        let err =
            resolve_plan("not json", &["aphrody-ai-http".to_string()], DEFAULT_OFFSET).unwrap_err();
        assert!(matches!(err, Error::Catalog(_)));
    }

    #[test]
    fn group_by_alias_groups_and_preserves_order() {
        let ids = [
            "db-tunnel",
            "aphrody-ai-http",
            "aphrody-embed",
            REDIS_SERVICE_ID,
        ]
        .map(String::from);
        let plan = resolve_plan(FIXTURE, &ids, DEFAULT_OFFSET).unwrap();
        let groups = group_by_alias(&plan);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].alias, "dbfr");
        assert_eq!(groups[0].forwards, vec![(15433, 5432)]);
        assert_eq!(groups[1].alias, "vps");
        assert_eq!(groups[1].forwards.len(), 3);
    }

    #[test]
    fn build_ssh_args_shape() {
        let args = build_ssh_args(&[(18789, 8789), (15006, 5006)], "vps");
        assert_eq!(
            args,
            vec![
                "-N",
                "-o",
                "BatchMode=yes",
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "ServerAliveInterval=30",
                "-o",
                "ServerAliveCountMax=3",
                "-L",
                "127.0.0.1:18789:127.0.0.1:8789",
                "-L",
                "127.0.0.1:15006:127.0.0.1:5006",
                "vps",
            ]
        );
    }

    #[test]
    fn automatic_catalog_requires_current_monorepo_layout() {
        let root = std::env::temp_dir().join(format!("ssh-catalog-layout-{}", std::process::id()));
        std::fs::create_dir_all(root.join("aphrody-infra/infra/config")).unwrap();
        std::fs::write(
            root.join("aphrody-infra/infra/config/service-catalog.json"),
            "{}",
        )
        .unwrap();
        assert_eq!(find_workspace_catalog(&root), None);
        assert_eq!(find_workspace_catalog(&root.join("aphrody-infra")), None);
        std::fs::create_dir_all(root.join("infra").join("config")).unwrap();
        std::fs::write(root.join(CATALOG_RELATIVE_PATH), "{}").unwrap();
        std::fs::write(root.join("Cargo.toml"), "[workspace]").unwrap();
        assert_eq!(find_workspace_catalog(&root), None);
        std::fs::create_dir_all(root.join("crates/aphrody-ssh")).unwrap();
        std::fs::write(root.join("crates/aphrody-ssh/Cargo.toml"), "[package]").unwrap();
        assert_eq!(
            find_workspace_catalog(&root.join("nested")),
            Some(root.join(CATALOG_RELATIVE_PATH))
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolve_catalog_path_prefers_explicit() {
        let explicit = Path::new("some/explicit/catalog.json");
        assert_eq!(
            resolve_catalog_path(Some(explicit)).unwrap(),
            explicit.to_path_buf()
        );
    }

    #[test]
    fn resolve_catalog_path_uses_env_override() {
        // SAFETY: test-local env mutation; no other test in this module reads this variable
        // concurrently outside of this function's scope, and it is restored before returning.
        unsafe {
            std::env::set_var("APHRODY_INFRA_CATALOG", "custom/path/catalog.json");
        }
        let resolved = resolve_catalog_path(None).unwrap();
        unsafe {
            std::env::remove_var("APHRODY_INFRA_CATALOG");
        }
        assert_eq!(resolved, PathBuf::from("custom/path/catalog.json"));
    }

    #[tokio::test]
    async fn probe_local_port_detects_closed_port() {
        // Port 1 is reserved and essentially never has a local listener in CI/dev sandboxes.
        assert!(!probe_local_port(1, Duration::from_millis(100)).await);
    }
}
