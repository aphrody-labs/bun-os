//! Cross-catalog invariants between `infra/config/service-catalog.json`,
//! yolo `infra/config/host/nginx/routes.json`, `tools/aphrody/config/local-ai.json`, `infra/config/pipeline.json`,
//! the topology port policy of `infra/config/production-topology.json` and the
//! repository registry of `tools/aphrody/config/stack-training.json`.

use crate::catalog::ServiceCatalog;
use crate::local_ai::{LocalAiContract, LocalAiEndpoint, LocalAiEnv, LocalAiTarget, load_local_ai};
use crate::pipeline::{PipelineConfig, check_pipeline, load_pipeline_config};
use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, serde::Serialize)]
pub struct Report {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub services: usize,
    pub routes: usize,
    /// Canonical env names declared by `tools/aphrody/config/local-ai.json`.
    pub local_ai_env: usize,
}

impl Report {
    fn merge(&mut self, other: Self) {
        self.errors.extend(other.errors);
        self.warnings.extend(other.warnings);
        self.local_ai_env += other.local_ai_env;
    }
}

fn load(root: &Path, relative: &str) -> Result<Value> {
    let path = root.join(relative);
    let text = fs::read_to_string(&path).with_context(|| format!("lecture {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("JSON invalide: {}", path.display()))
}

/// Host config (systemd units, nginx sites) lives in `$APHRODY_ROOT/infra/config/host`,
/// default `$HOME/src/aphrody` (`%USERPROFILE%\src\aphrody` on Windows).
pub fn host_systemd_root() -> PathBuf {
    host_config_root().join("systemd")
}

/// `$APHRODY_ROOT/infra/config/host` (default `$HOME/src/aphrody`): systemd units, nginx sites and routes.
pub fn host_config_root() -> PathBuf {
    let root = std::env::var_os("APHRODY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
            PathBuf::from(home.unwrap_or_default()).join("src/aphrody")
        });
    root.join("infra/config/host")
}

fn unit_template_exists(systemd_root: &Path, unit: &str) -> bool {
    let instance_template = unit.split_once('@').and_then(|(name, instance)| {
        let (_, suffix) = instance.split_once('.')?;
        Some(format!("{name}@.{suffix}"))
    });
    std::fs::read_dir(systemd_root)
        .into_iter()
        .flatten()
        .flatten()
        .any(|owner| {
            owner.path().join(unit).is_file()
                || owner.path().join(format!("{unit}.example")).is_file()
                || instance_template
                    .as_ref()
                    .is_some_and(|template| owner.path().join(template).is_file())
        })
}

/// Source validation only. Package-owned units still require independent
/// target-host systemd and health qualification. `systemd_root` holds one
/// subdirectory per owner (see [`host_systemd_root`]).
pub fn check_unit_templates(systemd_root: &Path, catalog: &ServiceCatalog) -> Vec<String> {
    catalog
        .services
        .iter()
        .filter(|service| {
            !service.is_retired()
                && service.requires_unit_template()
                && service
                    .unit
                    .as_deref()
                    .is_some_and(|unit| !unit_template_exists(systemd_root, unit))
        })
        .map(|service| {
            format!(
                "{}: unité {} absente de yolo infra/config/host/systemd/",
                service.id,
                service.unit.as_deref().unwrap_or_default()
            )
        })
        .collect()
}

/// Validate the selected source snapshot. Live-host helpers resolve their own
/// configuration root, independently of this explicit repository argument.
pub fn run(root: &Path) -> Result<Report> {
    let catalog = load(root, "infra/config/service-catalog.json")?;
    let topology = load(root, "infra/config/production-topology.json")?;
    let contract = load_local_ai(root)?;
    let pipeline = load_pipeline_config(root)?;
    let mut report = check(
        &catalog,
        &load(root, "infra/config/host/nginx/routes.json")?,
    );
    report.merge(check_topology_ports(&catalog, &topology));
    report.merge(check_local_ai(&catalog, &topology, &contract));
    report.errors.extend(check_pipeline(&pipeline));
    report.merge(check_repositories(
        &load(root, "tools/aphrody/config/stack-training.json")?,
        &catalog,
        &contract,
        &pipeline,
    ));
    Ok(report)
}

/// Repository names used as owners in the catalogs: live ids of
/// `stack-training.json` `repositories`, and retired ids with their successors.
struct RepositoryRegistry<'a> {
    live: BTreeSet<&'a str>,
    retired: BTreeMap<&'a str, Vec<&'a str>>,
}

impl<'a> RepositoryRegistry<'a> {
    fn from_training(training: &'a Value) -> Self {
        let ids = |key: &str| {
            entries(training, key)
                .iter()
                .filter_map(|repository| str_field(repository, "id"))
                .collect::<Vec<_>>()
        };
        let retired = entries(training, "retiredRepositories")
            .iter()
            .filter_map(|repository| {
                let id = str_field(repository, "id")?;
                let successors = entries(repository, "replacedBy")
                    .iter()
                    .filter_map(Value::as_str)
                    .collect();
                Some((id, successors))
            })
            .collect();
        Self {
            live: ids("repositories").into_iter().collect(),
            retired,
        }
    }

    /// `None` when `repo` is a live repository, else the error to report.
    fn problem(&self, context: &str, repo: &str) -> Option<String> {
        if self.live.contains(repo) {
            return None;
        }
        Some(match self.retired.get(repo) {
            Some(successors) => format!(
                "{context}: repository {repo} is retired (replaced by {})",
                successors.join(", ")
            ),
            None => format!(
                "{context}: unknown repository {repo} (not in tools/aphrody/config/stack-training.json repositories)"
            ),
        })
    }
}

/// Every repository named as a code owner (service `sourceRepo`, application
/// roots, local-ai source repositories, managed-service owners and consumers,
/// pipeline steps) must be a live repository of the registry; a retired
/// monolith such as `aphrody` is never a build, deploy or ownership source.
pub fn check_repositories(
    training: &Value,
    catalog: &Value,
    contract: &LocalAiContract,
    pipeline: &PipelineConfig,
) -> Report {
    let registry = RepositoryRegistry::from_training(training);
    let mut report = Report::default();
    if registry.live.is_empty() {
        report
            .errors
            .push("stack-training: repositories is empty".to_owned());
        return report;
    }
    for retired in registry.retired.keys() {
        if registry.live.contains(retired) {
            report.errors.push(format!(
                "stack-training: {retired} is listed as both live and retired"
            ));
        }
    }
    for (retired, successors) in &registry.retired {
        for successor in successors {
            if !registry.live.contains(successor) {
                report.errors.push(format!(
                    "stack-training: {retired} is replaced by unknown repository {successor}"
                ));
            }
        }
    }
    let mut named: Vec<(String, &str)> = Vec::new();
    for service in entries(catalog, "services") {
        if let Some(repo) = str_field(service, "sourceRepo") {
            let id = str_field(service, "id").unwrap_or("<sans id>");
            named.push((format!("service {id}: sourceRepo"), repo));
        }
    }
    if let Some(roots) = catalog
        .pointer("/policies/applicationRoots")
        .and_then(Value::as_object)
    {
        for repo in roots.keys() {
            named.push(("policies.applicationRoots".to_owned(), repo.as_str()));
        }
    }
    if let Some(repo) = contract
        .model_authority
        .as_ref()
        .and_then(|authority| str_field(authority, "sourceRepo"))
    {
        named.push(("local-ai: modelAuthority.sourceRepo".to_owned(), repo));
    }
    for (id, binary) in &contract.binaries {
        named.push((
            format!("local-ai: binary {id}: sourceRepo"),
            binary.source_repo.as_str(),
        ));
    }
    for (id, service) in &contract.managed_services {
        let repo = service
            .owner
            .split_once('/')
            .map_or(service.owner.as_str(), |(repo, _)| repo);
        named.push((format!("local-ai: managed service {id}: owner"), repo));
    }
    for consumer in contract.consumers.keys() {
        named.push(("local-ai: consumers".to_owned(), consumer.as_str()));
    }
    for stage in &pipeline.stages {
        for step in &stage.steps {
            named.push((format!("pipeline: stage {}", stage.id), step.repo.as_str()));
        }
    }
    let mut seen = BTreeSet::new();
    for (context, repo) in named {
        if let Some(problem) = registry.problem(&context, repo)
            && seen.insert(problem.clone())
        {
            report.errors.push(problem);
        }
    }
    report
}

/// Route upstream of a site nginx serves from disk, `static:<directory>`.
const STATIC_UPSTREAM: &str = "static:";

/// Split `host:port`, tolerating a leading `http://` and a trailing path.
fn host_port(address: &str) -> Option<(&str, u16)> {
    let rest = address.split_once("://").map_or(address, |(_, rest)| rest);
    let authority = rest.split('/').next()?;
    let (host, port) = authority.rsplit_once(':')?;
    Some((host, port.parse().ok()?))
}

fn is_private(host: &str) -> bool {
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private(),
        Ok(std::net::IpAddr::V6(ip)) => ip.is_loopback(),
        Err(_) => host == "localhost",
    }
}

fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn entries<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

/// An absent or malformed host cannot establish independent listener ownership.
fn service_host(service: &Value) -> Option<&str> {
    str_field(service, "host")
        .filter(|host| !host.is_empty() && !host.chars().any(char::is_whitespace))
}

type PortClaims<'a> = BTreeMap<u16, Vec<(&'a str, Option<&'a str>)>>;

/// Keep every claim: an intervening listener on another host must not hide a
/// previous claim on this host, and an unscoped listener conflicts with all hosts.
fn claim_port<'a>(
    report: &mut Report,
    ports: &mut PortClaims<'a>,
    id: &'a str,
    service: &'a Value,
    port: u16,
) {
    let host = service_host(service);
    let claims = ports.entry(port).or_default();
    if let Some((other, _)) = claims.iter().find(|(_, other_host)| {
        !matches!((host, other_host), (Some(host), Some(other)) if host != *other)
    }) {
        report.errors.push(format!("port {port} partagé par {other} et {id}"));
    }
    claims.push((id, host));
}

/// The optional `port` names the primary listener: it must be a valid port and
/// agree with the `health` probe; without `health` it joins the collision map.
fn check_service_port<'a>(
    report: &mut Report,
    ports: &mut PortClaims<'a>,
    id: &'a str,
    service: &'a Value,
) {
    let Some(value) = service.get("port") else {
        return;
    };
    let Some(port) = value
        .as_u64()
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p != 0)
    else {
        report.errors.push(format!("{id}: invalid port ({value})"));
        return;
    };
    match str_field(service, "health").and_then(host_port) {
        Some((_, health)) if health != port => report.errors.push(format!(
            "{id}: port {port} differs from health port {health}"
        )),
        Some(_) => {}
        None => claim_port(report, ports, id, service, port),
    }
}

/// `true` when `value` (a service or a route) declares `"status": "retired"`.
fn is_retired_value(value: &Value) -> bool {
    str_field(value, "status") == Some("retired")
}

/// A unit is decommissioned but kept cataloged with `"status": "retired"` and
/// a `retiredAt` date, so nothing else in the catalogs can claim it is still
/// deployed or health-probed without the checks below failing.
fn check_retirement(report: &mut Report, label: &str, value: &Value) {
    let status = str_field(value, "status");
    let retired_at = str_field(value, "retiredAt");
    match status {
        None => {
            if let Some(retired_at) = retired_at {
                report.errors.push(format!(
                    "{label}: retiredAt {retired_at} without status retired"
                ));
            }
        }
        Some("retired") => match retired_at {
            None => report
                .errors
                .push(format!("{label}: status retired requires retiredAt")),
            Some(date) if !is_plausible_date(date) => report.errors.push(format!(
                "{label}: retiredAt {date} is not a YYYY-MM-DD date"
            )),
            Some(_) => {}
        },
        Some(other) => report.errors.push(format!(
            "{label}: unknown status {other} (only retired is defined)"
        )),
    }
}

/// Loose `YYYY-MM-DD[...]` check: this repository has no `chrono` dependency
/// wired into `serde_json::Value` validation, and the exact calendar
/// correctness of a historical date is not worth pulling one in for.
fn is_plausible_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    bytes.len() >= 10
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
}

fn check_service_capabilities(report: &mut Report, id: &str, service: &Value) {
    let Some(value) = service.get("capabilities") else {
        return;
    };
    let Some(list) = value.as_array() else {
        report
            .errors
            .push(format!("{id}: capabilities must be an array"));
        return;
    };
    let mut seen = BTreeSet::new();
    for capability in list {
        match capability.as_str().filter(|c| !c.trim().is_empty()) {
            Some(c) if !seen.insert(c) => report
                .errors
                .push(format!("{id}: duplicate capability {c}")),
            Some(_) => {}
            None => report
                .errors
                .push(format!("{id}: invalid capability ({capability})")),
        }
    }
}

/// Internal and public port sets of one `production-topology.json` host.
fn topology_ports(topology: &Value, host: &str) -> Option<(BTreeSet<u64>, BTreeSet<u64>)> {
    let network = topology.get("hosts")?.get(host)?.get("network");
    let set = |key: &str| -> BTreeSet<u64> {
        network
            .and_then(|n| n.get(key))
            .and_then(Value::as_array)
            .map(|ports| ports.iter().filter_map(Value::as_u64).collect())
            .unwrap_or_default()
    };
    Some((set("internalOnly"), set("publicPorts")))
}

/// Every active service host must exist in the topology, including health-only listeners.
/// Every active explicit catalog `port` must be internal-only on its declared host
/// (or some host when unscoped), and public on none. The only direct ingress
/// exception is an explicitly host-scoped public native `rust-site` on 80/443,
/// with `publicProxy: direct-rust` and the host's matching publicPorts allocation.
/// Retired records preserve historical bindings without reserving live ports.
pub fn check_topology_ports(catalog: &Value, topology: &Value) -> Report {
    let mut report = Report::default();
    let hosts: Vec<(BTreeSet<u64>, BTreeSet<u64>)> = topology
        .get("hosts")
        .and_then(Value::as_object)
        .map(|hosts| {
            hosts
                .keys()
                .filter_map(|host| topology_ports(topology, host))
                .collect()
        })
        .unwrap_or_default();
    for service in entries(catalog, "services") {
        if is_retired_value(service) {
            continue;
        }
        let Some(id) = str_field(service, "id") else {
            continue;
        };
        let declared_host = match service.get("host") {
            None => None,
            Some(_) => match service_host(service) {
                Some(host) => Some(host),
                None => {
                    report.errors.push(format!(
                        "{id}: host must be a nonempty name without whitespace"
                    ));
                    continue;
                }
            },
        };
        let internal = match declared_host {
            Some(host) => match topology_ports(topology, host) {
                Some((internal, _)) => internal,
                None => {
                    report
                        .errors
                        .push(format!("{id}: unknown topology host {host}"));
                    continue;
                }
            },
            None => hosts
                .iter()
                .flat_map(|(internal, _)| internal.iter().copied())
                .collect(),
        };
        let Some(port) = service.get("port").and_then(Value::as_u64) else {
            if str_field(service, "publicProxy") == Some("direct-rust") {
                report.errors.push(format!(
                    "{id}: direct-rust ingress requires an explicit port"
                ));
            }
            continue;
        };
        if str_field(service, "publicProxy") == Some("direct-rust") {
            if str_field(service, "kind") != Some("rust-site")
                || str_field(service, "runtime") != Some("rust")
                || service.get("public").and_then(Value::as_bool) != Some(true)
            {
                report.errors.push(format!(
                    "{id}: direct-rust ingress requires kind rust-site, runtime rust and public:true"
                ));
                continue;
            }
            let Some(host) = declared_host else {
                report.errors.push(format!(
                    "{id}: direct-rust ingress requires an explicit host"
                ));
                continue;
            };
            if !matches!(port, 80 | 443) {
                report.errors.push(format!(
                    "{id}: direct-rust ingress only permits port 80 or 443"
                ));
                continue;
            }
            // Host existence was checked above. Allocation on another host
            // never authorizes exposure here, even for the same public port.
            let public = topology_ports(topology, host)
                .map(|(_, public)| public)
                .unwrap_or_default();
            if !public.contains(&port) || internal.contains(&port) {
                report.errors.push(format!(
                    "{id}: direct-rust port {port} must be publicPorts and not internalOnly on host {host}"
                ));
            }
            continue;
        }
        if hosts.iter().any(|(_, public)| public.contains(&port)) {
            report
                .errors
                .push(format!("{id}: port {port} is a public topology port"));
        } else if !internal.contains(&port) {
            let scope = declared_host.map_or(String::new(), |host| format!(" on host {host}"));
            report.errors.push(format!(
                "{id}: port {port} is not internalOnly{scope} in infra/config/production-topology.json"
            ));
        }
    }
    report
}

pub fn check(catalog: &Value, routes: &Value) -> Report {
    let mut report = Report::default();
    let services = entries(catalog, "services");
    report.services = services.len();

    let mut by_id: BTreeMap<&str, &Value> = BTreeMap::new();
    let mut units = BTreeSet::new();
    let mut ports = PortClaims::new();
    for service in services {
        let Some(id) = str_field(service, "id") else {
            report.errors.push("service sans id".into());
            continue;
        };
        if by_id.insert(id, service).is_some() {
            report.errors.push(format!("service dupliqué: {id}"));
        }
        if let Some(unit) = str_field(service, "unit")
            && !units.insert(unit)
        {
            report
                .errors
                .push(format!("unit systemd partagée: {unit} ({id})"));
        }
        if let Some(health) = str_field(service, "health") {
            match host_port(health) {
                Some((host, port)) => {
                    if !is_private(host) {
                        report
                            .errors
                            .push(format!("{id}: health hors loopback/privé ({health})"));
                    }
                    claim_port(&mut report, &mut ports, id, service, port);
                }
                None => report
                    .errors
                    .push(format!("{id}: health sans host:port ({health})")),
            }
        }
        check_service_port(&mut report, &mut ports, id, service);
        check_service_capabilities(&mut report, id, service);
        check_retirement(&mut report, id, service);
        if let Some(source) = service.get("unitSource")
            && !matches!(source.as_str(), Some("repository" | "system-package"))
        {
            report.errors.push(format!(
                "{id}: unitSource doit être repository ou system-package"
            ));
        }
        if let Some(additional) = service.get("additionalUpstreams") {
            if let Some(addresses) = additional.as_array() {
                for address in addresses {
                    let Some(address) = address.as_str() else {
                        report
                            .errors
                            .push(format!("{id}: additionalUpstreams invalide"));
                        continue;
                    };
                    match host_port(address) {
                        Some((host, port)) => {
                            if !is_private(host) {
                                report.errors.push(format!(
                                    "{id}: additionalUpstreams hors loopback/privé ({address})"
                                ));
                            }
                            claim_port(&mut report, &mut ports, id, service, port);
                        }
                        None => report.errors.push(format!(
                            "{id}: additionalUpstreams sans host:port ({address})"
                        )),
                    }
                }
            } else {
                report
                    .errors
                    .push(format!("{id}: additionalUpstreams doit être un tableau"));
            }
        }
    }

    let public_routes = entries(routes, "routes");
    let internal_routes = entries(routes, "internal");
    report.routes = public_routes.len() + internal_routes.len();
    let mut hosts = BTreeSet::new();
    let mut routed_public = BTreeSet::new();
    for (route, public) in public_routes
        .iter()
        .map(|r| (r, true))
        .chain(internal_routes.iter().map(|r| (r, false)))
    {
        let label = str_field(route, "host")
            .or_else(|| str_field(route, "service"))
            .unwrap_or("?");
        if public
            && let Some(host) = str_field(route, "host")
            && !hosts.insert(host)
        {
            report.errors.push(format!("host public dupliqué: {host}"));
        }
        let Some(service_id) = str_field(route, "service") else {
            report.errors.push(format!("route {label} sans service"));
            continue;
        };
        let Some(service) = by_id.get(service_id) else {
            report
                .errors
                .push(format!("route {label} vers service inconnu: {service_id}"));
            continue;
        };
        // `static:<dir>`: nginx serves the files itself, there is no origin to probe or to keep on loopback.
        let origin = if str_field(route, "upstream").is_some_and(|u| u.starts_with(STATIC_UPSTREAM))
        {
            None
        } else {
            let Some(origin) = str_field(route, "upstream").and_then(host_port) else {
                report
                    .errors
                    .push(format!("route {label}: upstream sans host:port"));
                continue;
            };
            Some(origin)
        };
        if let Some((host, _)) = origin
            && !is_private(host)
        {
            report.errors.push(format!(
                "route {label}: upstream {host} hors loopback/privé"
            ));
        }
        check_retirement(&mut report, &format!("route {label}"), route);
        if is_retired_value(service) != is_retired_value(route) {
            report.errors.push(format!(
                "route {label}: retired status disagrees with service {service_id} (both or neither must be retired)"
            ));
        }
        if let Some((_, port)) = origin {
            let health_port = str_field(service, "health")
                .and_then(host_port)
                .map(|(_, p)| p);
            let additional_port = entries(service, "additionalUpstreams")
                .iter()
                .any(|address| {
                    address
                        .as_str()
                        .and_then(host_port)
                        .is_some_and(|(_, p)| p == port)
                });
            if health_port.is_some_and(|p| p != port) && !additional_port {
                report.errors.push(format!(
                    "route {label}: port {port} ≠ port health de {service_id} ({})",
                    health_port.unwrap_or_default()
                ));
            }
        }
        if public {
            routed_public.insert(service_id);
            let declared_public = service
                .get("public")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !declared_public {
                let message =
                    format!("route publique {label} vers {service_id} marqué public:false");
                if route.get("paths").is_some() {
                    report
                        .warnings
                        .push(format!("{message} (restreinte par paths)"));
                } else {
                    report.errors.push(message);
                }
            }
        }
    }
    for (id, service) in &by_id {
        if service.get("public").and_then(Value::as_bool) == Some(true)
            && !routed_public.contains(id)
        {
            report
                .warnings
                .push(format!("{id} public:true sans route nginx publique"));
        }
    }
    report
}

const NETWORK_PROTOCOLS: [&str; 2] = ["openai-compatible", "aphrody-rest"];
const PROCESS_PROTOCOLS: [&str; 2] = ["cli", "mcp-stdio"];
const ENV_KINDS: [&str; 5] = ["url", "secret", "model", "dimensions", "path"];
/// Rules enforced below; the contract must list them in `forbidden` so the
/// file documents what the gate actually checks.
const ENFORCED_RULES: [&str; 5] = [
    "mix-embedding-spaces",
    "public-ai-port",
    "secret-value-in-contract",
    "hard-coded-dynamic-port",
    "non-ai-service-as-ai-backend",
];

fn is_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// `(host, port, path)` of an `http(s)://host:port[/path]` URL; `path` has no
/// leading or trailing slash.
fn split_url(url: &str) -> Option<(&str, u16, &str)> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))?;
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let (host, port) = authority.rsplit_once(':')?;
    Some((host, port.parse().ok()?, path.trim_end_matches('/')))
}

/// Catalog service view: effective port, declared capabilities and whether
/// `"status": "retired"` marks the unit as decommissioned.
#[derive(Debug, Default)]
struct CatalogEntry<'a> {
    port: Option<u16>,
    capabilities: BTreeSet<&'a str>,
    retired: bool,
}

type CatalogView<'a> = BTreeMap<&'a str, CatalogEntry<'a>>;

/// Catalog id to its [`CatalogEntry`].
fn catalog_view(catalog: &Value) -> CatalogView<'_> {
    entries(catalog, "services")
        .iter()
        .filter_map(|service| {
            let id = str_field(service, "id")?;
            let port = service
                .get("port")
                .and_then(Value::as_u64)
                .and_then(|p| u16::try_from(p).ok())
                .or_else(|| {
                    str_field(service, "health")
                        .and_then(host_port)
                        .map(|(_, p)| p)
                });
            let capabilities = entries(service, "capabilities")
                .iter()
                .filter_map(Value::as_str)
                .collect();
            Some((
                id,
                CatalogEntry {
                    port,
                    capabilities,
                    retired: is_retired_value(service),
                },
            ))
        })
        .collect()
}

type CanonicalMap<'a> = BTreeMap<&'a str, (&'a str, &'a LocalAiEnv)>;

/// Canonical names are unique `APHRODY_*` names; an alias belongs to exactly
/// one canonical and is never itself canonical. Returns canonical → (owner,
/// entry) and alias → canonical.
fn check_local_ai_env<'a>(
    errors: &mut Vec<String>,
    contract: &'a LocalAiContract,
) -> (CanonicalMap<'a>, BTreeMap<&'a str, &'a str>) {
    let forms = &contract.resolution.url_forms;
    let mut canonical: CanonicalMap<'a> = BTreeMap::new();
    for (owner, env) in contract.env_entries() {
        let name = env.canonical.as_str();
        if !(name.starts_with("APHRODY_") && is_env_name(name)) {
            errors.push(format!(
                "local-ai: {owner}: canonical {name} must match APHRODY_[A-Z0-9_]+"
            ));
        }
        if let Some((other, _)) = canonical.insert(name, (owner, env)) {
            errors.push(format!(
                "local-ai: canonical {name} declared by {other} and {owner}"
            ));
        }
        if !ENV_KINDS.contains(&env.kind.as_str()) {
            errors.push(format!("local-ai: {name}: unknown kind {}", env.kind));
        }
        match (env.kind.as_str(), env.form.as_deref()) {
            ("url", None) => errors.push(format!("local-ai: {name}: url requires a form")),
            ("url", Some(form)) if !forms.contains_key(form) => {
                errors.push(format!("local-ai: {name}: unknown url form {form}"));
            }
            ("url", Some(_)) | (_, None) => {}
            (_, Some(_)) => errors.push(format!("local-ai: {name}: form is only for url")),
        }
        if env.kind != "url" && !env.alias_forms.is_empty() {
            errors.push(format!("local-ai: {name}: aliasForms is only for url"));
        }
        for (alias, form) in &env.alias_forms {
            if !env.aliases.contains(alias) {
                errors.push(format!(
                    "local-ai: {name}: aliasForms names {alias}, which is not an alias"
                ));
            }
            if !forms.contains_key(form) {
                errors.push(format!("local-ai: {name}: unknown url form {form}"));
            }
        }
    }
    let mut aliases: BTreeMap<&str, &str> = BTreeMap::new();
    for (_, env) in contract.env_entries() {
        let name = env.canonical.as_str();
        for alias in env.aliases.iter().map(String::as_str) {
            if !is_env_name(alias) {
                errors.push(format!("local-ai: {name}: invalid alias {alias}"));
            }
            if canonical.contains_key(alias) {
                errors.push(format!(
                    "local-ai: alias {alias} of {name} is itself a canonical name"
                ));
            }
            match aliases.insert(alias, name) {
                Some(other) if other == name => {
                    errors.push(format!("local-ai: alias {alias} listed twice for {name}"));
                }
                Some(other) => errors.push(format!(
                    "local-ai: alias {alias} shared by {other} and {name}"
                )),
                None => {}
            }
        }
    }
    (canonical, aliases)
}

fn check_local_ai_endpoint(
    errors: &mut Vec<String>,
    contract: &LocalAiContract,
    services: &CatalogView<'_>,
    id: &str,
    endpoint: &LocalAiEndpoint,
    capability: bool,
) {
    let protocol = endpoint.protocol.as_str();
    if NETWORK_PROTOCOLS.contains(&protocol) {
        match endpoint.service.as_deref() {
            None => errors.push(format!("local-ai: {id}: {protocol} requires a service")),
            Some(service) => match services.get(service) {
                Some(entry) if !entry.capabilities.contains(id) => errors.push(format!(
                    "local-ai: {id}: catalog service {service} does not declare capability {id}"
                )),
                Some(_) => {}
                None if contract.managed_services.contains_key(service) => {}
                None => errors.push(format!(
                    "local-ai: {id}: unknown service {service} (not in infra/config/service-catalog.json nor managedServices)"
                )),
            },
        }
        if !endpoint
            .base_path
            .as_deref()
            .is_some_and(|path| path.starts_with('/'))
        {
            errors.push(format!("local-ai: {id}: basePath must start with /"));
        }
        if endpoint.binary.is_some() {
            errors.push(format!("local-ai: {id}: {protocol} takes no binary"));
        }
        let own_url = endpoint.env.iter().any(|env| env.kind == "url");
        match endpoint.base_url_from.as_deref() {
            Some(_) if own_url => errors.push(format!(
                "local-ai: {id}: declares both a url env and baseUrlFrom"
            )),
            Some(from) => match contract.capabilities.get(from) {
                Some(source)
                    if source.env.iter().any(|env| env.kind == "url")
                        && source.service == endpoint.service => {}
                Some(_) => errors.push(format!(
                    "local-ai: {id}: baseUrlFrom {from} has no url env on the same service"
                )),
                None => errors.push(format!(
                    "local-ai: {id}: baseUrlFrom names unknown capability {from}"
                )),
            },
            None if !own_url => {
                errors.push(format!("local-ai: {id}: needs a url env or baseUrlFrom"))
            }
            None => {}
        }
    } else if PROCESS_PROTOCOLS.contains(&protocol) {
        match endpoint.binary.as_deref() {
            Some(binary) if contract.binaries.contains_key(binary) => {}
            Some(binary) => errors.push(format!("local-ai: {id}: unknown binary {binary}")),
            None => errors.push(format!("local-ai: {id}: {protocol} requires a binary")),
        }
        if endpoint.service.is_some()
            || endpoint.base_path.is_some()
            || endpoint.base_url_from.is_some()
        {
            errors.push(format!(
                "local-ai: {id}: {protocol} takes no service, basePath or baseUrlFrom"
            ));
        }
        if protocol == "mcp-stdio" && endpoint.tool.is_none() {
            errors.push(format!("local-ai: {id}: mcp-stdio requires a tool"));
        }
        if protocol == "cli" && endpoint.command.is_none() {
            errors.push(format!("local-ai: {id}: cli requires a command"));
        }
    } else {
        errors.push(format!("local-ai: {id}: unknown protocol {protocol}"));
    }
    for operation in &endpoint.operations {
        if !operation.starts_with('/') {
            errors.push(format!(
                "local-ai: {id}: operation {operation} must start with /"
            ));
        }
    }
    if capability {
        match endpoint.default_model.as_deref() {
            Some(model) if model.trim().is_empty() => {
                errors.push(format!("local-ai: {id}: empty defaultModel"));
            }
            None if endpoint.local != Some(false) => errors.push(format!(
                "local-ai: {id}: defaultModel is required unless local is false"
            )),
            _ => {}
        }
    }
    if endpoint.env.iter().any(|env| env.kind == "dimensions")
        && !endpoint.dimensions.is_some_and(|d| d > 0)
    {
        errors.push(format!(
            "local-ai: {id}: a dimensions env requires dimensions"
        ));
    }
}

/// Validate one URL value of a static binding against the catalog port and
/// the target host's internal-only port list.
#[allow(clippy::too_many_arguments)]
fn check_binding_url(
    errors: &mut Vec<String>,
    label: &str,
    name: &str,
    value: &str,
    env: &LocalAiEnv,
    endpoint: &LocalAiEndpoint,
    service_port: Option<u16>,
    ports: &(BTreeSet<u64>, BTreeSet<u64>),
) {
    let Some((host, port, path)) = split_url(value) else {
        errors.push(format!(
            "{label}: {name}={value} is not http(s)://host:port"
        ));
        return;
    };
    if !is_private(host) {
        errors.push(format!(
            "{label}: {name} host {host} is not loopback/private (public-ai-port)"
        ));
    }
    if service_port != Some(port) {
        errors.push(format!(
            "{label}: {name} port {port} differs from the catalog port {}",
            service_port.map_or_else(|| "(none)".to_owned(), |p| p.to_string())
        ));
    }
    let (internal, public) = ports;
    if public.contains(&u64::from(port)) || !internal.contains(&u64::from(port)) {
        errors.push(format!(
            "{label}: {name} port {port} is not internalOnly on the topology host (public-ai-port)"
        ));
    }
    let base_path = endpoint
        .base_path
        .as_deref()
        .unwrap_or_default()
        .trim_matches('/');
    match env.form.as_deref() {
        Some("base") if path != base_path => errors.push(format!(
            "{label}: {name} path /{path} differs from basePath /{base_path}"
        )),
        Some("origin") if !path.is_empty() => {
            errors.push(format!("{label}: {name} must be an origin (no path)"));
        }
        _ => {}
    }
}

fn check_static_target(
    errors: &mut Vec<String>,
    contract: &LocalAiContract,
    services: &CatalogView<'_>,
    canonical: &CanonicalMap<'_>,
    target_id: &str,
    target: &LocalAiTarget,
    ports: &(BTreeSet<u64>, BTreeSet<u64>),
) {
    for (key, binding) in &target.bindings {
        let label = format!("local-ai: target {target_id} binding {key}");
        let Some(endpoint) = contract.endpoint(key) else {
            errors.push(format!("{label}: unknown capability or gateway"));
            continue;
        };
        let Some(entry) = services.get(binding.service.as_str()) else {
            errors.push(format!(
                "{label}: service {} is not in infra/config/service-catalog.json",
                binding.service
            ));
            continue;
        };
        let service_port = entry.port;
        if !entry.capabilities.contains(key.as_str()) {
            errors.push(format!(
                "{label}: service {} does not declare capability {key} (non-ai-service-as-ai-backend)",
                binding.service
            ));
        }
        if entry.retired && !target.is_retired() {
            errors.push(format!(
                "{label}: service {} is retired but target {target_id} is not (mark the target status retired, or its retiredAt)",
                binding.service
            ));
        }
        for (name, value) in &binding.env {
            let Some((owner, env)) = canonical.get(name.as_str()) else {
                errors.push(format!("{label}: {name} is not a canonical name"));
                continue;
            };
            if *owner != key.as_str() && endpoint.base_url_from.as_deref() != Some(*owner) {
                errors.push(format!("{label}: {name} belongs to {owner}"));
            }
            match env.kind.as_str() {
                "secret" => errors.push(format!(
                    "{label}: {name} is a secret; its value never goes in the contract (secret-value-in-contract)"
                )),
                "url" => check_binding_url(
                    errors,
                    &label,
                    name,
                    value,
                    env,
                    endpoint,
                    service_port,
                    ports,
                ),
                "dimensions" if !value.parse::<u32>().is_ok_and(|d| d > 0) => {
                    errors.push(format!("{label}: {name}={value} is not a positive integer"));
                }
                _ if value.trim().is_empty() => errors.push(format!("{label}: {name} is empty")),
                _ => {}
            }
        }
        if let Some(index_id) = &binding.index {
            let Some(index) = contract.indexes.get(index_id) else {
                errors.push(format!("{label}: unknown index {index_id}"));
                continue;
            };
            if index.service != binding.service {
                errors.push(format!(
                    "{label}: index {index_id} is served by {}, not {} (mix-embedding-spaces)",
                    index.service, binding.service
                ));
            }
            let value_of = |kind: &str| {
                binding.env.iter().find_map(|(name, value)| {
                    canonical
                        .get(name.as_str())
                        .filter(|(_, env)| env.kind == kind)
                        .map(|_| value.as_str())
                })
            };
            if value_of("model") != Some(index.served_model.as_str()) {
                errors.push(format!(
                    "{label}: model must be {} for index {index_id} (mix-embedding-spaces)",
                    index.served_model
                ));
            }
            if value_of("dimensions") != Some(index.dimensions.to_string().as_str()) {
                errors.push(format!(
                    "{label}: dimensions must be {} for index {index_id} (mix-embedding-spaces)",
                    index.dimensions
                ));
            }
        }
    }
    for id in contract.gateways.keys().chain(contract.capabilities.keys()) {
        match (
            target.bindings.contains_key(id),
            target.unavailable.contains_key(id),
        ) {
            (true, true) => errors.push(format!(
                "local-ai: target {target_id}: {id} is both bound and unavailable"
            )),
            (false, false) => errors.push(format!(
                "local-ai: target {target_id}: {id} is neither bound nor unavailable"
            )),
            _ => {}
        }
    }
    for id in target.unavailable.keys() {
        if contract.endpoint(id).is_none() {
            errors.push(format!(
                "local-ai: target {target_id}: unavailable names unknown {id}"
            ));
        }
    }
}

/// `tools/aphrody/config/local-ai.json` against the service catalog and the topology:
/// services exist and declare the capability they back, static ports are
/// internal-only, canonical names are unique, aliases unambiguous, indexes
/// pinned to their embedding space and consumers only read known names.
pub fn check_local_ai(catalog: &Value, topology: &Value, contract: &LocalAiContract) -> Report {
    let mut errors = Vec::new();
    let services = catalog_view(catalog);
    if contract.schema_version != 1 {
        errors.push(format!(
            "local-ai: unsupported schemaVersion {}",
            contract.schema_version
        ));
    }
    let mut forbidden = BTreeSet::new();
    for rule in &contract.forbidden {
        if !forbidden.insert(rule.as_str()) {
            errors.push(format!("local-ai: forbidden lists {rule} twice"));
        }
    }
    for rule in ENFORCED_RULES {
        if !forbidden.contains(rule) {
            errors.push(format!("local-ai: forbidden must declare {rule}"));
        }
    }
    let hosts: BTreeSet<&str> = topology
        .get("hosts")
        .and_then(Value::as_object)
        .map(|hosts| hosts.keys().map(String::as_str).collect())
        .unwrap_or_default();
    for (id, managed) in &contract.managed_services {
        if services.contains_key(id.as_str()) {
            errors.push(format!(
                "local-ai: managed service {id} shadows a catalog service"
            ));
        }
        for host in &managed.hosts {
            if !hosts.contains(host.as_str()) {
                errors.push(format!(
                    "local-ai: managed service {id}: unknown topology host {host}"
                ));
            }
        }
    }
    let mut ids = BTreeSet::new();
    for id in contract
        .binaries
        .keys()
        .chain(contract.gateways.keys())
        .chain(contract.capabilities.keys())
    {
        if !ids.insert(id.as_str()) {
            errors.push(format!(
                "local-ai: id {id} reused across binaries, gateways and capabilities"
            ));
        }
    }
    let (canonical, aliases) = check_local_ai_env(&mut errors, contract);
    for (id, gateway) in &contract.gateways {
        check_local_ai_endpoint(&mut errors, contract, &services, id, gateway, false);
    }
    for (id, capability) in &contract.capabilities {
        check_local_ai_endpoint(&mut errors, contract, &services, id, capability, true);
    }
    for (id, index) in &contract.indexes {
        match services.get(index.service.as_str()) {
            Some(entry) if !entry.capabilities.contains("embed") => errors.push(format!(
                "local-ai: index {id}: service {} does not declare capability embed",
                index.service
            )),
            Some(_) => {}
            None => errors.push(format!(
                "local-ai: index {id}: service {} is not in infra/config/service-catalog.json",
                index.service
            )),
        }
        if index.dimensions == 0
            || index.model.trim().is_empty()
            || index.served_model.trim().is_empty()
        {
            errors.push(format!(
                "local-ai: index {id}: model and dimensions are required"
            ));
        }
        if index.rule != "never-mix-spaces" {
            errors.push(format!(
                "local-ai: index {id}: rule must be never-mix-spaces"
            ));
        }
        if let Some(gateway) = &index.read_through
            && !contract.gateways.contains_key(gateway)
        {
            errors.push(format!("local-ai: index {id}: unknown gateway {gateway}"));
        }
    }
    for (target_id, target) in &contract.targets {
        let Some(ports) = topology_ports(topology, &target.topology_host) else {
            errors.push(format!(
                "local-ai: target {target_id}: unknown topology host {}",
                target.topology_host
            ));
            continue;
        };
        for service in &target.services {
            match contract.managed_services.get(service) {
                Some(managed) if !managed.hosts.contains(target_id) => errors.push(format!(
                    "local-ai: target {target_id}: managed service {service} does not run there"
                )),
                Some(_) => {}
                None if services.contains_key(service.as_str()) => {}
                None => errors.push(format!(
                    "local-ai: target {target_id}: unknown service {service}"
                )),
            }
        }
        match target.resolution.as_str() {
            "runtime" => {
                if target
                    .resolver
                    .as_deref()
                    .is_none_or(|r| r.trim().is_empty())
                {
                    errors.push(format!(
                        "local-ai: target {target_id}: runtime resolution requires a resolver"
                    ));
                }
                if !target.bindings.is_empty() {
                    errors.push(format!(
                        "local-ai: target {target_id}: runtime targets carry no static bindings (hard-coded-dynamic-port)"
                    ));
                }
            }
            "static" => check_static_target(
                &mut errors,
                contract,
                &services,
                &canonical,
                target_id,
                target,
                &ports,
            ),
            other => errors.push(format!(
                "local-ai: target {target_id}: unknown resolution {other}"
            )),
        }
    }
    for (consumer, spec) in &contract.consumers {
        for used in &spec.uses {
            if !ids.contains(used.as_str()) {
                errors.push(format!("local-ai: consumer {consumer} uses unknown {used}"));
            }
        }
        for index in &spec.indexes {
            if !contract.indexes.contains_key(index) {
                errors.push(format!(
                    "local-ai: consumer {consumer} uses unknown index {index}"
                ));
            }
        }
        for name in &spec.reads_today {
            if !canonical.contains_key(name.as_str()) && !aliases.contains_key(name.as_str()) {
                errors.push(format!(
                    "local-ai: consumer {consumer} reads {name}, which is neither canonical nor an alias"
                ));
            }
        }
    }
    Report {
        errors,
        local_ai_env: canonical.len(),
        ..Report::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unit_template_source_preserves_repository_checks() {
        let root = tempfile::tempdir().expect("fixture directory");
        let mut raw = json!({
            "schemaVersion": 1, "owner": "infra", "supervisor": "systemd", "proxy": "nginx",
            "services": [{ "id": "redis", "kind": "cache", "runtime": "redis", "unit": "redis-server.service" }]
        });
        let load_catalog = |value: &Value| {
            serde_json::from_value::<ServiceCatalog>(value.clone()).expect("fixture catalog")
        };
        assert_eq!(
            check_unit_templates(&root.path().join("systemd"), &load_catalog(&raw)).len(),
            1
        );
        raw["services"][0]["unitSource"] = json!("repository");
        assert_eq!(
            check_unit_templates(&root.path().join("systemd"), &load_catalog(&raw)).len(),
            1
        );
        raw["services"][0]["unitSource"] = json!("system-package");
        assert!(check_unit_templates(&root.path().join("systemd"), &load_catalog(&raw)).is_empty());
        raw["services"][0]["unitSource"] = json!("repository");
        fs::create_dir_all(root.path().join("systemd/aphrody")).expect("fixture systemd directory");
        fs::write(
            root.path()
                .join("systemd/aphrody/redis-server.service.example"),
            "[Service]\n",
        )
        .expect("fixture unit template");
        assert!(check_unit_templates(&root.path().join("systemd"), &load_catalog(&raw)).is_empty());
    }

    fn static_catalog() -> Value {
        json!({
            "services": [
                { "id": "site", "unit": "site.service", "health": "http://127.0.0.1:8100/health", "public": true },
                { "id": "creator", "kind": "nginx-static", "runtime": "none", "public": true }
            ]
        })
    }

    #[test]
    fn a_site_nginx_serves_from_disk_has_no_unit_and_no_loopback_origin() {
        let routes = json!({ "routes": [
            { "host": "creator.example.com", "service": "creator", "upstream": "static:/home/ubuntu/apps/creator/current" },
            { "host": "example.com", "service": "site", "upstream": "127.0.0.1:8100" }
        ] });
        let report = check(&static_catalog(), &routes);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.services, 2);
    }

    #[test]
    fn a_static_route_keeps_the_service_and_retirement_rules() {
        let unknown = json!({ "routes": [
            { "host": "a.example.com", "service": "nope", "upstream": "static:/home/ubuntu/apps/a" }
        ] });
        assert!(
            check(&static_catalog(), &unknown)
                .errors
                .iter()
                .any(|e| e.contains("inconnu"))
        );
        let retired_route = json!({ "routes": [
            { "host": "a.example.com", "service": "creator", "upstream": "static:/home/ubuntu/apps/a",
              "status": "retired", "retiredAt": "2026-10-01" }
        ] });
        assert!(
            check(&static_catalog(), &retired_route)
                .errors
                .iter()
                .any(|e| e.contains("retired status disagrees"))
        );
        // Only `static:` is exempt: any other upstream still needs a loopback host:port.
        let bare = json!({ "routes": [
            { "host": "a.example.com", "service": "creator", "upstream": "/home/ubuntu/apps/a" }
        ] });
        assert!(
            check(&static_catalog(), &bare)
                .errors
                .iter()
                .any(|e| e.contains("host:port"))
        );
        let public_ip = json!({ "routes": [
            { "host": "a.example.com", "service": "site", "upstream": "8.8.8.8:80" }
        ] });
        assert!(
            check(&static_catalog(), &public_ip)
                .errors
                .iter()
                .any(|e| e.contains("hors"))
        );
    }

    #[test]
    fn a_unit_less_service_needs_no_unit_template() {
        let root = tempfile::tempdir().expect("fixture directory");
        let raw = json!({
            "schemaVersion": 1, "owner": "infra", "supervisor": "systemd", "proxy": "nginx",
            "services": [{ "id": "creator", "kind": "nginx-static", "runtime": "none" }]
        });
        let catalog = serde_json::from_value::<ServiceCatalog>(raw).expect("unit-less catalog");
        assert!(catalog.services[0].unit.is_none());
        assert!(check_unit_templates(&root.path().join("systemd"), &catalog).is_empty());
    }

    #[test]
    fn unknown_unit_source_is_not_a_template_exemption() {
        let raw = json!({ "services": [{ "id": "redis", "unitSource": "external" }] });
        assert!(
            check(&raw, &json!({}))
                .errors
                .iter()
                .any(|error| error.contains("unitSource"))
        );
        assert!(
            serde_json::from_value::<crate::catalog::CatalogService>(json!({
                "id": "redis", "kind": "cache", "runtime": "redis", "unit": "redis-server.service",
                "unitSource": "external"
            }))
            .is_err()
        );
    }

    fn catalog() -> Value {
        json!({ "services": [
            { "id": "site", "unit": "site.service", "health": "http://127.0.0.1:8083/healthz", "public": true },
            { "id": "mcp", "unit": "mcp.service", "health": "http://127.0.0.1:5010/health", "public": false }
        ]})
    }

    #[test]
    fn coherent_catalog_is_clean() {
        let routes = json!({ "routes": [{ "host": "a.com", "service": "site", "upstream": "127.0.0.1:8083" }],
                             "internal": [{ "service": "mcp", "upstream": "127.0.0.1:5010" }] });
        let report = check(&catalog(), &routes);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
        assert_eq!((report.services, report.routes), (2, 2));
    }

    #[test]
    fn detects_unknown_service_port_mismatch_and_public_upstream() {
        let routes = json!({ "routes": [
            { "host": "a.com", "service": "site", "upstream": "127.0.0.1:9999" },
            { "host": "b.com", "service": "ghost", "upstream": "127.0.0.1:1" },
            { "host": "c.com", "service": "mcp", "upstream": "8.8.8.8:5010" }
        ]});
        let errors = check(&catalog(), &routes).errors.join("\n");
        assert!(errors.contains("port 9999"), "{errors}");
        assert!(errors.contains("service inconnu: ghost"), "{errors}");
        assert!(errors.contains("hors loopback"), "{errors}");
        assert!(errors.contains("public:false"), "{errors}");
    }

    #[test]
    fn path_restricted_route_to_private_service_is_warning() {
        let routes = json!({ "routes": [
            { "host": "a.com", "service": "site", "upstream": "127.0.0.1:8083" },
            { "host": "m.com", "service": "mcp", "upstream": "127.0.0.1:5010", "paths": ["/a2a"] }
        ]});
        let report = check(&catalog(), &routes);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.warnings.len(), 1);
    }

    #[test]
    fn accepts_declared_secondary_listener_without_weakening_port_checks() {
        let catalog = json!({ "services": [
            { "id": "bot", "unit": "bot.service", "health": "http://127.0.0.1:4000/health",
              "additionalUpstreams": ["127.0.0.1:4002"], "public": true },
            { "id": "other", "unit": "other.service", "health": "http://127.0.0.1:5000/health",
              "public": false }
        ]});
        let routes = json!({ "routes": [
            { "host": "a.com", "service": "bot", "upstream": "127.0.0.1:4000" },
            { "host": "b.com", "service": "bot", "upstream": "127.0.0.1:4002" }
        ]});
        assert!(check(&catalog, &routes).errors.is_empty());
        let wrong = json!({ "routes": [
            { "host": "b.com", "service": "bot", "upstream": "127.0.0.1:4003" }
        ]});
        assert!(
            check(&catalog, &wrong)
                .errors
                .iter()
                .any(|e| e.contains("port 4003"))
        );
        let collision = json!({ "services": [
            { "id": "bot", "unit": "bot.service", "health": "http://127.0.0.1:4000/health",
              "additionalUpstreams": ["127.0.0.1:5000"] },
            { "id": "other", "unit": "other.service", "health": "http://127.0.0.1:5000/health" }
        ]});
        assert!(
            check(&collision, &json!({}))
                .errors
                .iter()
                .any(|e| e.contains("port 5000 partagé"))
        );
    }

    #[test]
    fn detects_duplicates() {
        let catalog = json!({ "services": [
            { "id": "a", "unit": "x.service", "health": "http://127.0.0.1:1/" },
            { "id": "a", "unit": "x.service", "health": "http://127.0.0.1:1/" }
        ]});
        let errors = check(&catalog, &json!({})).errors;
        assert_eq!(errors.len(), 3, "{errors:?}");
    }

    fn listener(id: &str, host: Value, kind: u8, primary: u16) -> Value {
        let mut service = json!({ "id": id, "host": host });
        match kind {
            0 => service["health"] = json!("http://127.0.0.1:8793/health"),
            1 => service["port"] = json!(8793),
            2 => {
                service["health"] = json!(format!("http://127.0.0.1:{primary}/health"));
                service["additionalUpstreams"] = json!(["127.0.0.1:8793"]);
            }
            _ => unreachable!("fixture listener kind"),
        }
        service
    }

    #[test]
    fn distinct_explicit_hosts_can_reuse_every_listener_kind() {
        for first in 0..3 {
            for second in 0..3 {
                let catalog = json!({ "services": [
                    listener("vps-listener", json!("vps"), first, 8083),
                    listener("dbfr-listener", json!("dbfr"), second, 8084)
                ] });
                let errors = check(&catalog, &json!({})).errors;
                assert!(
                    errors.is_empty(),
                    "listener kinds {first}/{second}: {errors:?}"
                );
            }
        }
    }

    #[test]
    fn same_host_listener_collisions_are_rejected_for_every_kind() {
        for first in 0..3 {
            for second in 0..3 {
                let catalog = json!({ "services": [
                    listener("first", json!("vps"), first, 8083),
                    listener("second", json!("vps"), second, 8084)
                ] });
                let errors = check(&catalog, &json!({})).errors;
                assert_eq!(
                    errors.len(),
                    1,
                    "listener kinds {first}/{second}: {errors:?}"
                );
                assert_error(&errors, "port 8793 partagé par first et second");
            }
        }
    }

    #[test]
    fn unknown_host_scopes_never_establish_independent_listeners() {
        for unknown in [Value::Null, json!(""), json!(" "), json!(" vps"), json!(7)] {
            for unscoped_first in [false, true] {
                let unknown = listener("unknown", unknown.clone(), 0, 8083);
                let known = listener("known", json!("dbfr"), 1, 8084);
                let services = if unscoped_first {
                    vec![unknown, known]
                } else {
                    vec![known, unknown]
                };
                assert_eq!(
                    check(&json!({ "services": services }), &json!({}))
                        .errors
                        .len(),
                    1
                );
            }
        }
        let catalog = json!({ "services": [
            { "id": "unknown", "port": 8793 },
            listener("known", json!("vps"), 2, 8083)
        ] });
        assert_error(&check(&catalog, &json!({})).errors, "port 8793 partagé");
    }

    #[test]
    fn another_host_cannot_hide_an_earlier_listener_claim() {
        let catalog = json!({ "services": [
            listener("first-vps", json!("vps"), 0, 8083),
            listener("dbfr", json!("dbfr"), 1, 8084),
            listener("second-vps", json!("vps"), 2, 8085)
        ] });
        let errors = check(&catalog, &json!({})).errors;
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_error(&errors, "port 8793 partagé par first-vps et second-vps");
    }

    #[test]
    fn retired_service_requires_a_plausible_retired_at() {
        let missing_date = json!({ "services": [
            { "id": "a", "unit": "a.service", "health": "http://127.0.0.1:1/", "status": "retired" }
        ]});
        assert_error(
            &check(&missing_date, &json!({})).errors,
            "a: status retired requires retiredAt",
        );

        let bad_date = json!({ "services": [
            { "id": "a", "unit": "a.service", "health": "http://127.0.0.1:1/",
              "status": "retired", "retiredAt": "not-a-date" }
        ]});
        assert_error(
            &check(&bad_date, &json!({})).errors,
            "a: retiredAt not-a-date is not a YYYY-MM-DD date",
        );

        let unknown_status = json!({ "services": [
            { "id": "a", "unit": "a.service", "health": "http://127.0.0.1:1/", "status": "archived" }
        ]});
        assert_error(
            &check(&unknown_status, &json!({})).errors,
            "a: unknown status archived (only retired is defined)",
        );

        let stray_date = json!({ "services": [
            { "id": "a", "unit": "a.service", "health": "http://127.0.0.1:1/", "retiredAt": "2026-09-25" }
        ]});
        assert_error(
            &check(&stray_date, &json!({})).errors,
            "a: retiredAt 2026-09-25 without status retired",
        );

        let clean = json!({ "services": [
            { "id": "a", "unit": "a.service", "health": "http://127.0.0.1:1/",
              "status": "retired", "retiredAt": "2026-09-25" }
        ]});
        assert!(check(&clean, &json!({})).errors.is_empty());
    }

    #[test]
    fn retired_service_and_its_route_must_agree() {
        let retired_service = json!({ "services": [
            { "id": "site", "unit": "site.service", "health": "http://127.0.0.1:8083/healthz",
              "public": true, "status": "retired", "retiredAt": "2026-09-25" }
        ]});
        let live_route = json!({ "routes": [
            { "host": "a.com", "service": "site", "upstream": "127.0.0.1:8083" }
        ]});
        assert_error(
            &check(&retired_service, &live_route).errors,
            "route a.com: retired status disagrees with service site (both or neither must be retired)",
        );

        let retired_route = json!({ "routes": [
            { "host": "a.com", "service": "site", "upstream": "127.0.0.1:8083",
              "status": "retired", "retiredAt": "2026-09-25" }
        ]});
        assert!(check(&retired_service, &retired_route).errors.is_empty());

        let live_service = json!({ "services": [
            { "id": "site", "unit": "site.service", "health": "http://127.0.0.1:8083/healthz",
              "public": true }
        ]});
        assert_error(
            &check(&live_service, &retired_route).errors,
            "route a.com: retired status disagrees with service site (both or neither must be retired)",
        );
    }

    #[test]
    fn repository_catalogs_are_coherent() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let report = run(&root).unwrap();
        assert!(report.errors.is_empty(), "{:#?}", report.errors);
    }

    #[test]
    fn source_validation_reads_routes_from_the_selected_snapshot() {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let selected = tempfile::tempdir().expect("selected snapshot");
        fs::create_dir_all(selected.path().join("infra/config/host/nginx")).unwrap();
        fs::create_dir_all(selected.path().join("tools/aphrody/config")).unwrap();
        for file in [
            "service-catalog.json",
            "production-topology.json",
            "local-ai.json",
            "pipeline.json",
            "stack-training.json",
        ] {
            let directory = if matches!(file, "local-ai.json" | "stack-training.json") {
                "tools/aphrody/config"
            } else {
                "infra/config"
            };
            fs::copy(
                source.join(directory).join(file),
                selected.path().join(directory).join(file),
            )
            .expect("source catalog fixture");
        }
        fs::write(
            selected.path().join("infra/config/host/nginx/routes.json"),
            serde_json::to_vec(&json!({ "routes": [{
                "host": "snapshot-fixture.invalid",
                "service": "snapshot-fixture-only",
                "upstream": "127.0.0.1:65000"
            }] }))
            .unwrap(),
        )
        .unwrap();
        let report = run(selected.path()).expect("selected snapshot catalogs");
        assert_eq!(report.routes, 1);
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("snapshot-fixture-only"))
        );
    }

    #[test]
    fn repository_local_ai_contract_pins_v1_env_names() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let contract = load_local_ai(&root).unwrap();
        let names: BTreeSet<&str> = contract
            .env_entries()
            .map(|(_, env)| env.canonical.as_str())
            .collect();
        let v1: BTreeSet<&str> = [
            "APHRODY_BIN",
            "APHRODY_AI_MCP_BIN",
            "APHRODY_AI_HTTP_URL",
            "APHRODY_AI_HTTP_TOKEN",
            "APHRODY_AI_CHAT_BASE_URL",
            "APHRODY_AI_CHAT_MODEL",
            "APHRODY_AI_CODE_MODEL",
            "APHRODY_AI_REASONING_MODEL",
            "APHRODY_AI_SMALL_MODEL",
            "APHRODY_AI_VISION_BASE_URL",
            "APHRODY_AI_VISION_MODEL",
            "APHRODY_AI_OCR_MODEL",
            "APHRODY_AI_STT_MODEL",
            "APHRODY_AI_EMBED_BASE_URL",
            "APHRODY_AI_EMBED_MODEL",
            "APHRODY_AI_EMBED_DIMENSIONS",
            "APHRODY_AI_RERANK_BASE_URL",
            "APHRODY_AI_RERANK_MODEL",
        ]
        .into();
        assert_eq!(names, v1);
        assert!(
            contract.indexes.is_empty(),
            "the repository contract declares no embedding index"
        );
    }

    fn ai_catalog() -> Value {
        json!({ "services": [
            { "id": "ai-http", "unit": "ai.service", "health": "http://127.0.0.1:8789/healthz",
              "port": 8789, "capabilities": ["ai-http"] },
            { "id": "embed-svc", "unit": "embed.service", "health": "http://127.0.0.1:8794/health",
              "port": 8794, "capabilities": ["embed"] },
            { "id": "assets", "unit": "assets.service", "health": "http://127.0.0.1:8790/health",
              "port": 8790, "capabilities": ["3d-assets"] }
        ]})
    }

    fn ai_topology() -> Value {
        json!({ "hosts": {
            "vps": { "network": { "publicPorts": [80, 443], "internalOnly": [8789, 8790, 8794] } },
            "windows-local": { "role": "desktop" }
        }})
    }

    fn ai_contract() -> Value {
        json!({
            "schemaVersion": 1, "name": "test", "owner": "aphrody-infra", "description": "test",
            "resolution": { "precedence": ["canonical", "alias"], "aliasPolicy": "canonical first",
                            "urlForms": { "base": "b", "origin": "o", "endpoint": "e" } },
            "managedServices": { "llama": { "owner": "aphrody-ai", "ports": "dynamic",
                                            "discovery": "aphrody ai env", "hosts": ["windows-local"] } },
            "binaries": { "aphrody": { "sourceRepo": "aphrody-ai", "package": "aphrody",
                                       "env": [{ "canonical": "APHRODY_BIN", "kind": "path" }] } },
            "gateways": { "ai-http": { "protocol": "aphrody-rest", "service": "ai-http", "basePath": "/api/v1",
                "env": [
                    { "canonical": "APHRODY_AI_HTTP_URL", "kind": "url", "form": "origin", "aliases": ["APHRODY_LEGACY_API_URL"] },
                    { "canonical": "APHRODY_AI_HTTP_TOKEN", "kind": "secret", "aliases": ["APHRODY_LEGACY_API_TOKEN"] }
                ] } },
            "capabilities": {
                "chat": { "protocol": "openai-compatible", "service": "llama", "basePath": "/v1", "defaultModel": "chat-model",
                    "env": [
                        { "canonical": "APHRODY_AI_CHAT_BASE_URL", "kind": "url", "form": "base",
                          "aliases": ["APHRODY_LOCAL_MODEL_URL"], "aliasForms": { "APHRODY_LOCAL_MODEL_URL": "origin" } },
                        { "canonical": "APHRODY_AI_CHAT_MODEL", "kind": "model", "aliases": ["APHRODY_LLM_MODEL"] }
                    ] },
                "code": { "protocol": "openai-compatible", "service": "llama", "basePath": "/v1", "baseUrlFrom": "chat",
                          "defaultModel": "code-model", "env": [{ "canonical": "APHRODY_AI_CODE_MODEL", "kind": "model" }] },
                "stt": { "protocol": "mcp-stdio", "binary": "aphrody", "tool": "transcribe", "defaultModel": "whisper" },
                "embed": { "protocol": "openai-compatible", "service": "llama", "basePath": "/v1",
                           "defaultModel": "qwen3-embedding-0.6b", "dimensions": 1024,
                    "env": [
                        { "canonical": "APHRODY_AI_EMBED_BASE_URL", "kind": "url", "form": "base",
                          "aliases": ["EMBED_URL"], "aliasForms": { "EMBED_URL": "origin" } },
                        { "canonical": "APHRODY_AI_EMBED_MODEL", "kind": "model" },
                        { "canonical": "APHRODY_AI_EMBED_DIMENSIONS", "kind": "dimensions" }
                    ] }
            },
            "indexes": { "rag": { "owner": "aphrody-app", "store": "postgresql", "model": "e5", "servedModel": "Xenova/e5",
                                  "dimensions": 384, "service": "embed-svc", "rule": "never-mix-spaces",
                                  "onMismatch": "lexical-fallback" } },
            "targets": {
                "vps": { "resolution": "static", "topologyHost": "vps",
                    "bindings": {
                        "ai-http": { "service": "ai-http", "env": { "APHRODY_AI_HTTP_URL": "http://127.0.0.1:8789" } },
                        "embed": { "service": "embed-svc", "index": "rag", "env": {
                            "APHRODY_AI_EMBED_BASE_URL": "http://127.0.0.1:8794/v1",
                            "APHRODY_AI_EMBED_MODEL": "Xenova/e5",
                            "APHRODY_AI_EMBED_DIMENSIONS": "384" } }
                    },
                    "unavailable": { "chat": "none", "code": "none", "stt": "none" } },
                "windows-local": { "resolution": "runtime", "topologyHost": "windows-local",
                                   "resolver": "aphrody ai env", "services": ["llama"] }
            },
            "consumers": { "aphrody-app": { "uses": ["ai-http", "embed"], "indexes": ["rag"],
                                        "readsToday": ["APHRODY_LEGACY_API_URL", "EMBED_URL"], "migration": "canonical first" } },
            "forbidden": ENFORCED_RULES
        })
    }

    /// Replace (or insert) `key` in the object at JSON `pointer`.
    fn set(mut value: Value, pointer: &str, key: &str, new: Value) -> Value {
        value
            .pointer_mut(pointer)
            .and_then(Value::as_object_mut)
            .unwrap_or_else(|| panic!("{pointer} is not an object"))
            .insert(key.to_owned(), new);
        value
    }

    fn ai_report(contract: Value) -> Report {
        let contract: LocalAiContract = serde_json::from_value(contract).expect("contract parses");
        check_local_ai(&ai_catalog(), &ai_topology(), &contract)
    }

    #[track_caller]
    fn assert_error(errors: &[String], needle: &str) {
        assert!(
            errors.iter().any(|e| e.contains(needle)),
            "`{needle}` not in {errors:#?}"
        );
    }

    #[test]
    fn coherent_local_ai_contract_is_clean() {
        let report = ai_report(ai_contract());
        assert!(report.errors.is_empty(), "{:#?}", report.errors);
        assert_eq!(report.local_ai_env, 9);
    }

    #[test]
    fn local_ai_detects_unknown_services_and_non_ai_backends() {
        let contract = set(
            ai_contract(),
            "/capabilities/chat",
            "service",
            json!("ghost"),
        );
        let contract = set(
            contract,
            "/targets/vps/bindings/embed",
            "service",
            json!("assets"),
        );
        let errors = ai_report(contract).errors;
        assert_error(&errors, "chat: unknown service ghost");
        assert_error(&errors, "service assets does not declare capability embed");
        assert_error(&errors, "index rag is served by embed-svc, not assets");
        assert_error(&errors, "port 8794 differs from the catalog port 8790");
    }

    #[test]
    fn local_ai_target_must_acknowledge_retired_catalog_services() {
        let mut catalog = ai_catalog();
        catalog["services"][0]["status"] = json!("retired");
        catalog["services"][0]["retiredAt"] = json!("2026-09-25");
        let contract: LocalAiContract =
            serde_json::from_value(ai_contract()).expect("contract parses");
        let errors = check_local_ai(&catalog, &ai_topology(), &contract).errors;
        assert_error(&errors, "service ai-http is retired but target vps is not");

        let mut retired_target_contract = ai_contract();
        retired_target_contract["targets"]["vps"]["status"] = json!("retired");
        retired_target_contract["targets"]["vps"]["retiredAt"] = json!("2026-09-25");
        let contract: LocalAiContract =
            serde_json::from_value(retired_target_contract).expect("contract parses");
        let errors = check_local_ai(&catalog, &ai_topology(), &contract).errors;
        assert!(
            !errors.iter().any(|e| e.contains("is retired but target")),
            "{errors:#?}"
        );
    }

    #[test]
    fn local_ai_rejects_public_and_undeclared_ports() {
        let contract = set(
            ai_contract(),
            "/targets/vps/bindings/ai-http/env",
            "APHRODY_AI_HTTP_URL",
            json!("http://8.8.8.8:443"),
        );
        let errors = ai_report(contract).errors;
        assert_error(&errors, "host 8.8.8.8 is not loopback/private");
        assert_error(&errors, "port 443 differs from the catalog port 8789");
        assert_error(&errors, "port 443 is not internalOnly");

        let contract = set(
            ai_contract(),
            "/targets/vps/bindings/embed/env",
            "APHRODY_AI_EMBED_BASE_URL",
            json!("http://127.0.0.1:8794"),
        );
        assert_error(
            &ai_report(contract).errors,
            "path / differs from basePath /v1",
        );
    }

    #[test]
    fn local_ai_rejects_duplicate_canonicals_and_ambiguous_aliases() {
        let contract = set(
            ai_contract(),
            "/capabilities/code",
            "env",
            json!([{ "canonical": "APHRODY_AI_CHAT_MODEL", "kind": "model", "aliases": ["APHRODY_LLM_MODEL"] }]),
        );
        let contract = set(
            contract,
            "/capabilities/chat/env/0",
            "aliases",
            json!(["APHRODY_LOCAL_MODEL_URL", "APHRODY_AI_EMBED_BASE_URL"]),
        );
        let errors = ai_report(contract).errors;
        assert_error(
            &errors,
            "canonical APHRODY_AI_CHAT_MODEL declared by chat and code",
        );
        assert_error(&errors, "alias APHRODY_LLM_MODEL listed twice");
        assert_error(
            &errors,
            "alias APHRODY_AI_EMBED_BASE_URL of APHRODY_AI_CHAT_BASE_URL is itself a canonical name",
        );

        let contract = set(
            ai_contract(),
            "/capabilities/embed/env/1",
            "aliases",
            json!(["APHRODY_LLM_MODEL"]),
        );
        assert_error(
            &ai_report(contract).errors,
            "alias APHRODY_LLM_MODEL shared by APHRODY_AI_CHAT_MODEL and APHRODY_AI_EMBED_MODEL",
        );
    }

    #[test]
    fn local_ai_pins_indexes_to_their_embedding_space() {
        let contract = set(
            ai_contract(),
            "/targets/vps/bindings/embed",
            "env",
            json!({
                "APHRODY_AI_EMBED_BASE_URL": "http://127.0.0.1:8794/v1",
                "APHRODY_AI_EMBED_MODEL": "qwen3-embedding-0.6b",
                "APHRODY_AI_EMBED_DIMENSIONS": "1024"
            }),
        );
        let errors = ai_report(contract).errors;
        assert_error(
            &errors,
            "model must be Xenova/e5 for index rag (mix-embedding-spaces)",
        );
        assert_error(
            &errors,
            "dimensions must be 384 for index rag (mix-embedding-spaces)",
        );
    }

    #[test]
    fn local_ai_keeps_secrets_and_dynamic_ports_out_of_the_contract() {
        let contract = set(
            ai_contract(),
            "/targets/vps/bindings/ai-http/env",
            "APHRODY_AI_HTTP_TOKEN",
            json!("do-not-commit"),
        );
        let contract = set(
            contract,
            "/targets/windows-local",
            "bindings",
            json!({ "chat": { "service": "ai-http", "env": {} } }),
        );
        let errors = ai_report(contract).errors;
        assert_error(&errors, "(secret-value-in-contract)");
        assert_error(&errors, "(hard-coded-dynamic-port)");
    }

    #[test]
    fn local_ai_requires_full_coverage_known_consumer_names_and_declared_rules() {
        let mut contract = ai_contract();
        contract["targets"]["vps"]["unavailable"]
            .as_object_mut()
            .unwrap()
            .remove("stt");
        let contract = set(
            contract,
            "/consumers/aphrody-app",
            "readsToday",
            json!(["OPENAI_API_KEY"]),
        );
        let contract = set(contract, "", "forbidden", json!([]));
        let errors = ai_report(contract).errors;
        assert_error(&errors, "target vps: stt is neither bound nor unavailable");
        assert_error(
            &errors,
            "reads OPENAI_API_KEY, which is neither canonical nor an alias",
        );
        assert_error(&errors, "forbidden must declare mix-embedding-spaces");
    }

    #[test]
    fn local_ai_rejects_unknown_fields() {
        let contract = set(ai_contract(), "/capabilities/chat", "servce", json!("typo"));
        assert!(serde_json::from_value::<LocalAiContract>(contract).is_err());
    }

    #[test]
    fn catalog_port_matches_health_and_capabilities_are_unique() {
        let catalog = json!({ "services": [
            { "id": "a", "unit": "a.service", "health": "http://127.0.0.1:8083/healthz",
              "port": 8084, "capabilities": ["embed", "embed", ""] },
            { "id": "b", "unit": "b.service", "port": 70000 }
        ]});
        let errors = check(&catalog, &json!({})).errors;
        assert_error(&errors, "a: port 8084 differs from health port 8083");
        assert_error(&errors, "a: duplicate capability embed");
        assert_error(&errors, "a: invalid capability");
        assert_error(&errors, "b: invalid port");
    }

    #[test]
    fn explicit_catalog_ports_must_be_internal_only() {
        let catalog = json!({ "services": [
            { "id": "ok", "port": 8789 },
            { "id": "public", "port": 443 },
            { "id": "stray", "port": 9999 },
            { "id": "derived", "health": "http://127.0.0.1:9998/" }
        ]});
        let errors = check_topology_ports(&catalog, &ai_topology()).errors;
        assert_eq!(errors.len(), 2, "{errors:#?}");
        assert_error(&errors, "public: port 443 is a public topology port");
        assert_error(&errors, "stray: port 9999 is not internalOnly");
    }

    #[test]
    fn retired_topology_bindings_do_not_reserve_ports_but_active_ones_are_checked() {
        let topology = json!({ "hosts": {
            "vps": { "network": { "internalOnly": [], "publicPorts": [] } },
            "dbfr": { "network": { "internalOnly": [8793], "publicPorts": [80, 443] } }
        } });
        let catalog = json!({ "services": [
            { "id": "retired-mcp", "host": "vps", "port": 8793,
              "status": "retired", "retiredAt": "2026-10-09" },
            { "id": "retired-unscoped", "port": 8798,
              "status": "retired", "retiredAt": "2026-10-09" },
            { "id": "active-mcp", "host": "dbfr", "port": 8793 },
            { "id": "active-wrong-host", "host": "vps", "port": 8793 },
            { "id": "stopped-but-not-retired", "host": "vps", "port": 8798,
              "status": "stopped" }
        ] });
        let errors = check_topology_ports(&catalog, &topology).errors;
        assert_eq!(errors.len(), 2, "{errors:#?}");
        assert_error(
            &errors,
            "active-wrong-host: port 8793 is not internalOnly on host vps",
        );
        assert_error(
            &errors,
            "stopped-but-not-retired: port 8798 is not internalOnly on host vps",
        );
    }

    #[test]
    fn topology_requires_internal_port_on_the_declared_host() {
        let topology = json!({ "hosts": {
            "vps": { "network": { "internalOnly": [8793], "publicPorts": [80, 443] } },
            "dbfr": { "network": { "internalOnly": [8083], "publicPorts": [80, 443] } }
        } });
        let catalog = json!({ "services": [
            { "id": "correct", "host": "vps", "port": 8793 },
            { "id": "wrong-host", "host": "dbfr", "port": 8793 },
            { "id": "legacy-unscoped", "port": 8793 }
        ] });
        let errors = check_topology_ports(&catalog, &topology).errors;
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_error(
            &errors,
            "wrong-host: port 8793 is not internalOnly on host dbfr",
        );
    }

    #[test]
    fn topology_rejects_explicit_unknown_or_malformed_host() {
        let topology = json!({ "hosts": {
            "vps": { "network": { "internalOnly": [8793] } }
        } });
        let catalog = json!({ "services": [
            { "id": "unknown", "host": "missing-host", "health": "http://127.0.0.1:8793/health" },
            { "id": "blank", "host": "", "additionalUpstreams": ["127.0.0.1:8793"] },
            { "id": "null", "host": null, "port": 8793 },
            { "id": "number", "host": 7 }
        ] });
        let errors = check_topology_ports(&catalog, &topology).errors;
        assert_eq!(errors.len(), 4, "{errors:?}");
        assert_error(&errors, "unknown: unknown topology host missing-host");
        assert_error(&errors, "blank: host must be a nonempty name");
        assert_error(&errors, "null: host must be a nonempty name");
        assert_error(&errors, "number: host must be a nonempty name");
    }

    #[test]
    fn declared_internal_host_does_not_allow_a_port_public_on_another_host() {
        let topology = json!({ "hosts": {
            "vps": { "network": { "internalOnly": [8793], "publicPorts": [80, 443] } },
            "dbfr": { "network": { "internalOnly": [], "publicPorts": [8793] } }
        } });
        let catalog = json!({ "services": [{ "id": "private", "host": "vps", "port": 8793 }] });
        assert_error(
            &check_topology_ports(&catalog, &topology).errors,
            "private: port 8793 is a public topology port",
        );
    }

    fn direct_site(port: u16) -> Value {
        json!({"id":"native-site","host":"vps","kind":"rust-site","runtime":"rust","public":true,"publicProxy":"direct-rust","port":port})
    }

    #[test]
    fn explicit_native_site_ingress_accepts_only_declared_host_public80_and443() {
        let topology = json!({"hosts":{
            "vps":{"network":{"publicPorts":[80,443],"internalOnly":[8788,8793]}},
            "dbfr":{"network":{"publicPorts":[80,443],"internalOnly":[8788,8793]}}
        }});
        for port in [80, 443] {
            let report = check_topology_ports(&json!({"services":[direct_site(port)]}), &topology);
            assert!(report.errors.is_empty(), "{report:?}");
        }
        // The typed catalog preserves the existing explicit ingress field.
        let typed: crate::catalog::CatalogService =
            serde_json::from_value(direct_site(80)).unwrap();
        assert_eq!(typed.public_proxy.as_deref(), Some("direct-rust"));
    }

    #[test]
    fn native_ingress_rejects_other_kinds_runtimes_flags_and_undeclared_hosts() {
        let topology =
            json!({"hosts":{"vps":{"network":{"publicPorts":[80,443],"internalOnly":[8788]}}}});
        for (key, value, message) in [
            ("kind", json!("mcp-server"), "requires kind rust-site"),
            ("kind", json!("a2a"), "requires kind rust-site"),
            ("runtime", json!("bun"), "runtime rust"),
            ("public", json!(false), "public:true"),
            ("host", json!("unknown"), "unknown topology host"),
            ("host", Value::Null, "host must be"),
        ] {
            let mut service = direct_site(80);
            service[key] = value;
            assert_error(
                &check_topology_ports(&json!({"services":[service]}), &topology).errors,
                message,
            );
        }
        let mut unscoped = direct_site(80);
        unscoped.as_object_mut().unwrap().remove("host");
        assert_error(
            &check_topology_ports(&json!({"services":[unscoped]}), &topology).errors,
            "requires an explicit host",
        );
    }

    #[test]
    fn native_ingress_cannot_expose_control_ports_or_use_another_hosts_allocation() {
        let topology = json!({"hosts":{
            "vps":{"network":{"publicPorts":[],"internalOnly":[8788,8793]}},
            "dbfr":{"network":{"publicPorts":[80,443],"internalOnly":[]}}
        }});
        assert_error(
            &check_topology_ports(&json!({"services":[direct_site(80)]}), &topology).errors,
            "must be publicPorts and not internalOnly on host vps",
        );
        for port in [3000, 8788, 8793] {
            assert_error(
                &check_topology_ports(&json!({"services":[direct_site(port)]}), &topology).errors,
                "only permits port 80 or 443",
            );
        }
        let overlap = json!({"hosts":{"vps":{"network":{"publicPorts":[80],"internalOnly":[80]}}}});
        assert_error(
            &check_topology_ports(&json!({"services":[direct_site(80)]}), &overlap).errors,
            "must be publicPorts and not internalOnly",
        );
        let mut missing_port = direct_site(80);
        missing_port.as_object_mut().unwrap().remove("port");
        assert_error(
            &check_topology_ports(&json!({"services":[missing_port]}), &topology).errors,
            "requires an explicit port",
        );
    }

    fn training() -> Value {
        json!({
            "repositories": [{ "id": "aphrody-ai" }, { "id": "aphrody-web" }, { "id": "aphrody-app" }, { "id": "aphrody-site" }],
            "retiredRepositories": [{ "id": "aphrody", "replacedBy": ["aphrody-ai", "aphrody-web"] }]
        })
    }

    fn pipeline(repos: &[&str]) -> PipelineConfig {
        serde_json::from_value(json!({
            "schemaVersion": 1, "name": "p", "authority": "aphrody-infra",
            "stages": [{ "id": "lint", "parallel": true,
                         "steps": repos.iter().map(|repo| json!({ "repo": repo, "command": ["run", "lint"] })).collect::<Vec<_>>() }]
        }))
        .expect("pipeline parses")
    }

    fn contract() -> LocalAiContract {
        serde_json::from_value(ai_contract()).expect("contract parses")
    }

    #[test]
    fn live_repositories_are_accepted() {
        let catalog = json!({
            "services": [{ "id": "site", "sourceRepo": "aphrody-web" }, { "id": "a2a", "sourceRepo": "aphrody-ai" }],
            "policies": { "applicationRoots": { "aphrody-web": "/home/ubuntu/apps/aphrody/current", "aphrody-site": "/home/ubuntu/apps/aphrody-site/current" } }
        });
        let report = check_repositories(
            &training(),
            &catalog,
            &contract(),
            &pipeline(&["aphrody-site", "aphrody-ai"]),
        );
        assert_eq!(report.errors, Vec::<String>::new());
    }

    #[test]
    fn retired_and_unknown_repositories_are_rejected() {
        let catalog = json!({
            "services": [{ "id": "site", "sourceRepo": "aphrody" }],
            "policies": { "applicationRoots": { "aphrody-os": "/home/ubuntu/apps/aphrody/current" } }
        });
        let contract = serde_json::from_value::<LocalAiContract>(set(
            ai_contract(),
            "/binaries/aphrody",
            "sourceRepo",
            json!("aphrody"),
        ))
        .expect("contract parses");
        let errors = check_repositories(
            &training(),
            &catalog,
            &contract,
            &pipeline(&["aphrody", "ghost"]),
        )
        .errors;
        assert_error(
            &errors,
            "service site: sourceRepo: repository aphrody is retired (replaced by aphrody-ai, aphrody-web)",
        );
        assert_error(
            &errors,
            "policies.applicationRoots: unknown repository aphrody-os",
        );
        assert_error(
            &errors,
            "local-ai: binary aphrody: sourceRepo: repository aphrody is retired",
        );
        assert_error(
            &errors,
            "pipeline: stage lint: repository aphrody is retired",
        );
        assert_error(&errors, "pipeline: stage lint: unknown repository ghost");
    }

    #[test]
    fn registry_must_be_consistent() {
        let training = json!({
            "repositories": [{ "id": "aphrody" }],
            "retiredRepositories": [{ "id": "aphrody", "replacedBy": ["aphrody-ai"] }]
        });
        let errors = check_repositories(&training, &json!({}), &contract(), &pipeline(&[])).errors;
        assert_error(&errors, "aphrody is listed as both live and retired");
        assert_error(
            &errors,
            "aphrody is replaced by unknown repository aphrody-ai",
        );
        let empty = check_repositories(&json!({}), &json!({}), &contract(), &pipeline(&[])).errors;
        assert_error(&empty, "stack-training: repositories is empty");
    }

    #[test]
    fn repository_catalogs_name_only_live_repositories() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let report = run(&root).expect("catalogs load");
        assert_eq!(report.errors, Vec::<String>::new());
    }
}
