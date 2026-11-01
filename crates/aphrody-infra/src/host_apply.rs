// SPDX-License-Identifier: Apache-2.0
//! Catalog-bound staging of a pinned Aphrody service binary and its systemd unit.
//! This command installs files only; activation remains a separate reviewed step.

use crate::catalog::{CatalogService, UnitSource, load_service_catalog};
use anyhow::{Context, Result, bail, ensure};
use aphrody_proc::NoWindow as _;
use ring::digest::{SHA256, digest};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::Path,
    process::{Command, Output, Stdio},
    time::Duration,
};

const ALLOWED_SERVICES: &[&str] = &["aphrody-mcp-http", "aphrody-jobs-worker-vps"];
const BINARY_DEST: &str = "/home/ubuntu/.local/share/aphrody/bin/aphrody";
const BINARY_LAUNCH: &str = "/home/ubuntu/.local/bin/aphrody";
const STAGE_ROOT: &str = "/var/lib/aphrody-infra/host-apply";
const ROLLBACK_ROOT: &str = "/var/lib/aphrody-infra/host-apply/rollback";
const VPS_MCP_ENV: &str = "/etc/aphrody/aphrody-mcp-http.env";
const DBFR_CRAWL_ENV: &str = "/etc/aphrody/shenron-web-crawl.env";
const SSH_UNIT_SERVICE: &str = "omar-browser-client-vps";
const WG_PROXY_SERVICE: &str = "aphrody-wg-proxy";
const VPS_BROWSER_SERVICE: &str = "aphrody-web-browser-vps";
const VPS_PLAYWRIGHT_SERVICE: &str = "aphrody-web-playwright-vps";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostApplyPlan {
    pub target: String,
    pub service: String,
    pub unit: String,
    pub binary_source: String,
    pub binary_sha256: String,
    pub binary_destination: String,
    pub binary_launch: String,
    pub unit_source: String,
    pub unit_sha256: String,
    pub rollback_id: String,
    pub applied: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUnitPlan {
    pub target: String,
    pub service: String,
    pub unit: String,
    pub unit_source: String,
    pub unit_sha256: String,
    pub files: Vec<HostUnitFile>,
    pub rollback_id: String,
    pub applied: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUnitFile {
    pub unit: String,
    pub source: String,
    pub destination: String,
    pub sha256: String,
}

fn validate_ssh_forward_unit(text: &str) -> Result<()> {
    ensure!(
        text.contains("User=omar"),
        "SSH forward unit must run as omar"
    );
    ensure!(
        text.contains("Group=omar"),
        "SSH forward unit must use group omar"
    );
    ensure!(
        text.contains("ExecStart=/usr/bin/ssh "),
        "SSH forward must use the catalogued SSH executable"
    );
    ensure!(
        text.contains("-L 127.0.0.1:9234:127.0.0.1:9234"),
        "SSH forward must bind MCP on loopback only"
    );
    ensure!(
        text.contains("-L 127.0.0.1:9235:127.0.0.1:9235"),
        "SSH forward must bind health on loopback only"
    );
    ensure!(
        text.contains("-R 127.0.0.1:9230:127.0.0.1:9230"),
        "SSH reverse forward must expose the VPS Playwright bridge on loopback only"
    );
    ensure!(
        !text.contains(BINARY_LAUNCH) && !text.contains(BINARY_DEST),
        "SSH unit must not launch Aphrody"
    );
    Ok(())
}

pub fn unit_plan(root: &Path, target: &str, service_id: &str) -> Result<HostUnitPlan> {
    ensure!(
        target == "vps",
        "host-unit-apply supports only explicit target vps"
    );
    ensure!(
        service_id == SSH_UNIT_SERVICE
            || service_id == WG_PROXY_SERVICE
            || service_id == VPS_BROWSER_SERVICE
            || service_id == VPS_PLAYWRIGHT_SERVICE,
        "service is not enabled for host-unit-apply"
    );
    let service_catalog = load_service_catalog(root)?;
    let service = service_catalog
        .services
        .iter()
        .find(|row| row.id == service_id);
    if service_id == SSH_UNIT_SERVICE
        || service_id == VPS_BROWSER_SERVICE
        || service_id == VPS_PLAYWRIGHT_SERVICE
    {
        let service = service.context("service id is absent from service catalog")?;
        ensure!(
            service.runs_on(target) && !service.is_retired(),
            "service is not active on requested host"
        );
    }
    let host_path = root.join("infra/config/host/catalog.json");
    let host: Value = serde_json::from_slice(&fs::read(host_path)?)?;
    let rows = host["units"]
        .as_array()
        .context("host units catalog must be an array")?;
    let mut selected: Vec<Value> = rows
        .iter()
        .filter(|row| {
            row["service"].as_str() == Some(service_id)
                && row["targetHost"].as_str() == Some(target)
        })
        .cloned()
        .collect();
    ensure!(
        !selected.is_empty(),
        "service has no VPS unit rows in host catalog"
    );
    if service_id == SSH_UNIT_SERVICE {
        ensure!(
            selected.len() == 1
                && selected[0]["unit"].as_str() == Some("aphrody-obscura-omar-client.service"),
            "SSH service must map to its single catalogued unit"
        );
    } else if service_id == VPS_PLAYWRIGHT_SERVICE {
        ensure!(
            selected.len() == 1
                && selected[0]["unit"].as_str() == Some("aphrody-web-playwright-vps.service"),
            "VPS Playwright service must map to its single catalogued unit"
        );
    } else if service_id == VPS_BROWSER_SERVICE {
        ensure!(
            selected.len() == 1
                && selected[0]["unit"].as_str() == Some("aphrody-web-browser-vps.service"),
            "VPS Obscura service must map to its single catalogued unit"
        );
    } else {
        ensure!(
            selected.len() == 2,
            "WG proxy must map to exactly its service and socket templates"
        );
        selected.sort_by_key(|row| row["unit"].as_str() != Some("aphrody-wg-proxy@.service"));
        ensure!(
            selected[0]["unit"].as_str() == Some("aphrody-wg-proxy@.service")
                && selected[1]["unit"].as_str() == Some("aphrody-wg-proxy@.socket")
                && selected[1]["pairs"].as_str() == Some("aphrody-wg-proxy@.service"),
            "WG proxy service/socket pairing differs from allowlist"
        );
    }
    let mut files = Vec::new();
    for row in &selected {
        let unit = row["unit"].as_str().context("catalog unit name missing")?;
        let rel = row["path"].as_str().context("catalog unit path missing")?;
        ensure!(
            !Path::new(rel).is_absolute() && !rel.contains(".."),
            "unit path is not relative"
        );
        let source = root.join("infra/config/host").join(rel);
        let meta = fs::symlink_metadata(&source)?;
        ensure!(
            meta.is_file() && !meta.file_type().is_symlink(),
            "unit source must be a regular file"
        );
        let content = fs::read(&source)?;
        if unit == "aphrody-obscura-omar-client.service" {
            validate_ssh_forward_unit(std::str::from_utf8(&content)?)?;
        } else if service_id == VPS_PLAYWRIGHT_SERVICE {
            let text = std::str::from_utf8(&content)?;
            ensure!(
                unit == "aphrody-web-playwright-vps.service"
                    && text.contains("APHRODY_WEB_CDP_URL=http://127.0.0.1:9222")
                    && text.contains("APHRODY_WEB_PLAYWRIGHT_BIND=127.0.0.1:9230")
                    && text.contains("ExecStart=/home/ubuntu/.local/share/bun-upstream-canary/bun-linux-x64/bun run scripts/aphrody/web/playwright-bridge.ts")
                    && text.contains("ProtectSystem=strict")
                    && text.contains("NoNewPrivileges=true"),
                "VPS Playwright service must use the pinned Bun bridge and loopback-only Obscura endpoints"
            );
        } else if service_id == VPS_BROWSER_SERVICE {
            let text = std::str::from_utf8(&content)?;
            ensure!(
                unit == "aphrody-web-browser-vps.service"
                    && text.contains("ExecStart=/home/ubuntu/.local/bin/aphrody web-engine launch --host 127.0.0.1 --port 9222")
                    && text.contains("MemoryMax=2G"),
                "VPS Obscura service must use the catalogued Aphrody binary and loopback-only CDP"
            );
        } else if service_id == WG_PROXY_SERVICE {
            ensure!(
                unit == "aphrody-wg-proxy@.service" || unit == "aphrody-wg-proxy@.socket",
                "unexpected WG unit"
            );
            let text = std::str::from_utf8(&content)?;
            if unit.ends_with(".service") {
                ensure!(
                    text.contains("ExecStart=/usr/lib/systemd/systemd-socket-proxyd")
                        && text.contains("127.0.0.1:%i")
                        && text.contains("10.200.77.0/24"),
                    "WG forward service must target loopback and the private tunnel subnet"
                );
            } else {
                ensure!(
                    text.contains("ListenStream=10.200.77.1:%i") && text.contains("FreeBind=true"),
                    "WG listener must bind only the declared private VPS address"
                );
            }
        }
        files.push(HostUnitFile {
            unit: unit.into(),
            source: source.display().to_string(),
            destination: format!("/etc/systemd/system/{unit}"),
            sha256: sha256(&content),
        });
    }
    if service_id == WG_PROXY_SERVICE || service_id == VPS_BROWSER_SERVICE {
        let drop_names = selected
            .iter()
            .find(|row| {
                row["unit"].as_str()
                    == Some(if service_id == WG_PROXY_SERVICE {
                        "aphrody-wg-proxy@.service"
                    } else {
                        "aphrody-web-browser-vps.service"
                    })
            })
            .and_then(|row| row["dropIns"].as_array())
            .context("service drop-ins must be catalogued")?;
        let approved: &[&str] = if service_id == WG_PROXY_SERVICE {
            &[
                "sandbox-base",
                "sandbox-kernel",
                "net-inet-only",
                "syscall-service",
            ]
        } else {
            &[
                "run-as-ubuntu",
                "sandbox-base",
                "sandbox-kernel",
                "net-inet-only",
            ]
        };
        ensure!(
            drop_names.len() == approved.len(),
            "WG proxy drop-in allowlist changed"
        );
        for name in approved {
            ensure!(
                drop_names.iter().any(|v| v.as_str() == Some(name)),
                "WG proxy is missing a required catalogued drop-in"
            );
            let source = root
                .join("infra/config/host/systemd/shared")
                .join(format!("{name}.conf"));
            let meta = fs::symlink_metadata(&source)?;
            ensure!(
                meta.is_file() && !meta.file_type().is_symlink(),
                "drop-in source must be a regular file"
            );
            let content = fs::read(&source)?;
            files.push(HostUnitFile {
                unit: if service_id == WG_PROXY_SERVICE {
                    format!("aphrody-wg-proxy@.service.d/{name}.conf")
                } else {
                    format!("aphrody-web-browser-vps.service.d/{name}.conf")
                },
                source: source.display().to_string(),
                destination: if service_id == WG_PROXY_SERVICE {
                    format!("/etc/systemd/system/aphrody-wg-proxy@.service.d/{name}.conf")
                } else {
                    format!("/etc/systemd/system/aphrody-web-browser-vps.service.d/{name}.conf")
                },
                sha256: sha256(&content),
            });
        }
    }
    let manifest = files
        .iter()
        .map(|f| format!("{}\n{}\n", f.destination, f.sha256))
        .collect::<String>();
    let hash = sha256(manifest.as_bytes());
    let primary_unit = if service_id == SSH_UNIT_SERVICE
        || service_id == VPS_BROWSER_SERVICE
        || service_id == VPS_PLAYWRIGHT_SERVICE
    {
        service
            .and_then(|row| row.unit.clone())
            .context("catalog service has no unit")?
    } else {
        "aphrody-wg-proxy@.service".into()
    };
    Ok(HostUnitPlan {
        target: target.into(),
        service: service_id.into(),
        unit: primary_unit,
        unit_source: files[0].source.clone(),
        unit_sha256: hash.clone(),
        files,
        rollback_id: format!("{}-{}", std::process::id(), &hash[..12]),
        applied: false,
    })
}

pub fn unit_apply(root: &Path, plan: &HostUnitPlan) -> Result<HostUnitPlan> {
    let expected = unit_plan(root, &plan.target, &plan.service)?;
    ensure!(
        expected.unit_sha256 == plan.unit_sha256 && expected.unit_source == plan.unit_source,
        "SSH unit plan no longer matches the catalog"
    );
    ensure!(
        plan.rollback_id == expected.rollback_id,
        "SSH unit rollback id is invalid"
    );
    let base = format!("{STAGE_ROOT}/ssh-unit-{}", expected.rollback_id);
    let rollback = format!("{ROLLBACK_ROOT}/ssh-unit-{}", expected.rollback_id);
    checked("vps", &["sudo", "-n", "test", "!", "-e", &base], None)
        .context("SSH unit staging path already exists")?;
    checked("vps", &["sudo", "-n", "test", "!", "-e", &rollback], None)
        .context("SSH unit rollback receipt already exists")?;
    checked(
        "vps",
        &[
            "sudo", "-n", "install", "-d", "-o", "root", "-g", "root", "-m", "0700", &base,
        ],
        None,
    )?;
    checked(
        "vps",
        &[
            "sudo", "-n", "install", "-d", "-o", "root", "-g", "root", "-m", "0700", &rollback,
        ],
        None,
    )?;
    let mut prior = Vec::new();
    for (index, file) in expected.files.iter().enumerate() {
        let stage = format!("{base}/file-{index}");
        let backup = format!("{rollback}/file-{index}");
        let bytes = fs::read(&file.source)?;
        ensure!(
            sha256(&bytes) == file.sha256,
            "catalogued unit file changed after planning"
        );
        checked(
            "vps",
            &[
                "sudo",
                "-n",
                "install",
                "-o",
                "root",
                "-g",
                "root",
                "-m",
                "0644",
                "/dev/stdin",
                &stage,
            ],
            Some(&bytes),
        )?;
        let staged = checked("vps", &["sudo", "-n", "sha256sum", &stage], None)?;
        ensure!(
            staged.split_whitespace().next() == Some(file.sha256.as_str()),
            "remote staged unit file hash mismatch"
        );
        let parent = Path::new(&file.destination)
            .parent()
            .context("unit destination has no parent")?
            .to_string_lossy()
            .to_string();
        checked("vps", &["sudo", "-n", "test", "!", "-L", &parent], None)
            .context("unit destination parent is a symlink")?;
        let exists = remote(
            "vps",
            &format!("sudo -n test -e {}", shell_quote(&file.destination)),
            None,
        )?;
        if exists.status.success() {
            checked(
                "vps",
                &["sudo", "-n", "test", "!", "-L", &file.destination],
                None,
            )
            .context("unit destination is a symlink")?;
            checked(
                "vps",
                &["sudo", "-n", "test", "-f", &file.destination],
                None,
            )
            .context("unit destination is not a regular file")?;
            checked(
                "vps",
                &["sudo", "-n", "cp", "-a", &file.destination, &backup],
                None,
            )?;
            prior.push(true);
        } else {
            checked(
                "vps",
                &[
                    "sudo",
                    "-n",
                    "touch",
                    &format!("{rollback}/no-file-{index}"),
                ],
                None,
            )?;
            prior.push(false);
        }
    }
    let result = (|| -> Result<()> {
        for (index, file) in expected.files.iter().enumerate() {
            let parent = Path::new(&file.destination)
                .parent()
                .unwrap()
                .to_string_lossy()
                .to_string();
            checked(
                "vps",
                &[
                    "sudo", "-n", "install", "-d", "-o", "root", "-g", "root", "-m", "0755",
                    &parent,
                ],
                None,
            )?;
            checked(
                "vps",
                &[
                    "sudo",
                    "-n",
                    "mv",
                    "-f",
                    &format!("{base}/file-{index}"),
                    &file.destination,
                ],
                None,
            )?;
        }
        for file in &expected.files {
            if file.destination.ends_with(".service") || file.destination.ends_with(".socket") {
                if expected.service == WG_PROXY_SERVICE {
                    continue;
                }
                checked(
                    "vps",
                    &["sudo", "-n", "systemd-analyze", "verify", &file.destination],
                    None,
                )?;
            }
            let installed = checked("vps", &["sudo", "-n", "sha256sum", &file.destination], None)?;
            ensure!(
                installed.split_whitespace().next() == Some(file.sha256.as_str()),
                "installed unit file hash mismatch"
            );
        }
        if expected.service == WG_PROXY_SERVICE {
            checked(
                "vps",
                &[
                    "sudo",
                    "-n",
                    "systemd-analyze",
                    "verify",
                    "aphrody-wg-proxy@8793.service",
                    "aphrody-wg-proxy@8793.socket",
                ],
                None,
            )?;
        }
        checked("vps", &["sudo", "-n", "systemctl", "daemon-reload"], None)?;
        Ok(())
    })();
    if let Err(error) = result {
        let mut restore_errors = Vec::new();
        for (index, file) in expected.files.iter().enumerate().rev() {
            let restore = if prior[index] {
                format!(
                    "cp -a {} {}",
                    shell_quote(&format!("{rollback}/file-{index}")),
                    shell_quote(&file.destination)
                )
            } else {
                format!("rm -f {}", shell_quote(&file.destination))
            };
            if remote(
                "vps",
                &format!("sudo -n sh -c {}", shell_quote(&restore)),
                None,
            )
            .is_err()
            {
                restore_errors.push(index);
            }
        }
        let _ = checked("vps", &["sudo", "-n", "systemctl", "daemon-reload"], None);
        ensure!(
            restore_errors.is_empty(),
            "unit file installation failed and rollback was incomplete; files {restore_errors:?} need review"
        );
        return Err(error).context("catalogued unit bundle install failed; prior files restored");
    }
    Ok(HostUnitPlan {
        applied: true,
        ..expected
    })
}

pub fn validate_unit_rollback(target: &str, service: &str, id: &str, hash: &str) -> Result<()> {
    ensure!(
        target == "vps"
            && (service == SSH_UNIT_SERVICE
                || service == WG_PROXY_SERVICE
                || service == VPS_BROWSER_SERVICE
                || service == VPS_PLAYWRIGHT_SERVICE),
        "unit rollback is restricted to allowlisted VPS SSH/WG/Obscura/Playwright units"
    );
    ensure!(safe_rollback_id(id), "invalid SSH unit rollback id");
    ensure!(
        hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()),
        "invalid SSH unit SHA-256"
    );
    ensure!(
        id.ends_with(&hash[..12]),
        "rollback id does not match the unit bundle hash"
    );
    Ok(())
}

pub fn unit_rollback(root: &Path, target: &str, service: &str, id: &str, hash: &str) -> Result<()> {
    validate_unit_rollback(target, service, id, hash)?;
    let current_plan = unit_plan(root, target, service)?;
    ensure!(
        current_plan.unit_sha256 == hash,
        "catalogued unit bundle differs from rollback pin"
    );
    for (index, file) in current_plan.files.iter().enumerate() {
        let current = checked("vps", &["sudo", "-n", "sha256sum", &file.destination], None)?;
        ensure!(
            current.split_whitespace().next() == Some(file.sha256.as_str()),
            "installed unit differs from catalog pin; refusing rollback"
        );
        let backup = format!("{ROLLBACK_ROOT}/ssh-unit-{id}/file-{index}");
        let marker = format!("{ROLLBACK_ROOT}/ssh-unit-{id}/no-file-{index}");
        let has_backup = remote(
            "vps",
            &format!("sudo -n test -f {}", shell_quote(&backup)),
            None,
        )?
        .status
        .success();
        let had_none = remote(
            "vps",
            &format!("sudo -n test -f {}", shell_quote(&marker)),
            None,
        )?
        .status
        .success();
        ensure!(
            has_backup ^ had_none,
            "unit rollback receipt is missing or ambiguous for file {index}"
        );
    }
    for (index, file) in current_plan.files.iter().enumerate().rev() {
        let backup = format!("{ROLLBACK_ROOT}/ssh-unit-{id}/file-{index}");
        let marker = format!("{ROLLBACK_ROOT}/ssh-unit-{id}/no-file-{index}");
        let has_backup = remote(
            "vps",
            &format!("sudo -n test -f {}", shell_quote(&backup)),
            None,
        )?
        .status
        .success();
        if has_backup {
            checked("vps", &["sudo", "-n", "test", "!", "-L", &backup], None)?;
            checked(
                "vps",
                &["sudo", "-n", "cp", "-a", &backup, &file.destination],
                None,
            )?;
        } else {
            checked("vps", &["sudo", "-n", "rm", "-f", &file.destination], None)?;
        }
        let _ = marker;
    }
    checked("vps", &["sudo", "-n", "systemctl", "daemon-reload"], None)?;
    Ok(())
}

fn safe_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-@".contains(&b))
}

fn safe_rollback_id(value: &str) -> bool {
    let Some((pid, hash)) = value.split_once('-') else {
        return false;
    };
    !pid.is_empty()
        && pid.bytes().all(|b| b.is_ascii_digit())
        && hash.len() == 12
        && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn catalog_unit(root: &Path, service: &CatalogService) -> Result<std::path::PathBuf> {
    let catalog_path = root.join("infra/config/host/catalog.json");
    let catalog: Value = serde_json::from_slice(
        &fs::read(&catalog_path)
            .with_context(|| format!("read host unit catalog {}", catalog_path.display()))?,
    )?;
    let rows = catalog["units"]
        .as_array()
        .context("host catalog units must be an array")?;
    let matches: Vec<_> = rows
        .iter()
        .filter(|row| {
            row["service"].as_str() == Some(service.id.as_str())
                && row["unit"].as_str() == service.unit.as_deref()
                && row["targetHost"].as_str() == Some("vps")
        })
        .collect();
    ensure!(
        matches.len() == 1,
        "service/unit is not uniquely allowlisted for vps"
    );
    let relative = matches[0]["path"]
        .as_str()
        .context("allowlisted unit needs a source path")?;
    let relative_path = Path::new(relative);
    ensure!(
        !relative_path.is_absolute() && !relative.contains(".."),
        "unit source path is not relative"
    );
    let path = root.join("infra/config/host").join(relative_path);
    let metadata = fs::symlink_metadata(&path).context("read catalogued unit source")?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "unit source must be a regular file"
    );
    Ok(path)
}

pub fn plan(
    root: &Path,
    target: &str,
    service_id: &str,
    binary_from: &Path,
    expected_sha256: &str,
) -> Result<HostApplyPlan> {
    ensure!(
        target == "vps",
        "host-apply currently supports only explicit target vps"
    );
    ensure!(
        ALLOWED_SERVICES.contains(&service_id),
        "service is not enabled for host-apply"
    );
    ensure!(
        expected_sha256.len() == 64 && expected_sha256.bytes().all(|b| b.is_ascii_hexdigit()),
        "expected SHA-256 must be 64 hexadecimal characters"
    );
    let catalog = load_service_catalog(root)?;
    let service = catalog
        .services
        .iter()
        .find(|row| row.id == service_id)
        .context("service id is absent from the service catalog")?;
    ensure!(
        service.runs_on(target) && !service.is_retired(),
        "service is not active on the requested host"
    );
    ensure!(
        service.unit_source != Some(UnitSource::SystemPackage),
        "system-package units cannot be installed from repository templates"
    );
    let unit = service
        .unit
        .as_deref()
        .context("catalog service has no unit")?;
    ensure!(
        safe_name(unit) && unit.ends_with(".service"),
        "invalid catalog unit name"
    );
    let source = fs::canonicalize(binary_from).context("resolve pinned binary artifact")?;
    let metadata = fs::symlink_metadata(&source)?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "binary artifact must be a regular file"
    );
    ensure!(
        metadata.len() > 0 && metadata.len() <= 512 * 1024 * 1024,
        "binary artifact size is outside the allowed range"
    );
    let binary = fs::read(&source).context("read pinned binary artifact")?;
    let actual = sha256(&binary);
    ensure!(
        actual.eq_ignore_ascii_case(expected_sha256),
        "binary SHA-256 does not match the supplied pin"
    );
    let unit_path = catalog_unit(root, service)?;
    let unit_text = fs::read_to_string(&unit_path).context("read catalogued unit")?;
    ensure!(
        unit_text
            .lines()
            .any(|line| line.trim_start().starts_with("ExecStart=") && line.contains(BINARY_LAUNCH)),
        "unit does not invoke the catalogued Aphrody binary launch symlink"
    );
    ensure!(
        unit_text.contains("User=ubuntu"),
        "VPS unit must run as ubuntu"
    );
    Ok(HostApplyPlan {
        target: target.into(),
        service: service_id.into(),
        unit: unit.into(),
        binary_source: source.display().to_string(),
        binary_sha256: actual,
        binary_destination: BINARY_DEST.into(),
        binary_launch: BINARY_LAUNCH.into(),
        unit_source: unit_path.display().to_string(),
        unit_sha256: sha256(unit_text.as_bytes()),
        applied: false,
        rollback_id: String::new(),
    })
}

/// Verify that the public launcher remains the catalogued symlink to the real managed binary.
/// Returns the link text so apply/rollback can prove it stayed unchanged.
fn verify_binary_launch(target: &str) -> Result<String> {
    checked(target, &["sudo", "-n", "test", "-L", BINARY_LAUNCH], None)
        .context("the Aphrody launcher must remain a symlink")?;
    let link_text = checked(target, &["sudo", "-n", "readlink", BINARY_LAUNCH], None)?;
    let resolved = checked(
        target,
        &["sudo", "-n", "readlink", "-f", BINARY_LAUNCH],
        None,
    )?;
    ensure!(
        resolved == BINARY_DEST,
        "Aphrody launcher symlink resolves to an unexpected binary path"
    );
    checked(
        target,
        &["sudo", "-n", "test", "!", "-L", BINARY_DEST],
        None,
    )
    .context("managed Aphrody binary destination must not be a symlink")?;
    let destination = checked(
        target,
        &["sudo", "-n", "stat", "-c", "%F", BINARY_DEST],
        None,
    )?;
    ensure!(
        destination == "regular file",
        "managed Aphrody binary destination must be a regular file"
    );
    Ok(link_text)
}

pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(crate) fn remote(target: &str, command: &str, input: Option<&[u8]>) -> Result<Output> {
    let mut child = Command::new("ssh")
        .no_window()
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=2",
            target,
            command,
        ])
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("start SSH host-apply transport")?;
    if let (Some(bytes), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin
            .write_all(bytes)
            .context("send catalogued host artifact")?;
    }
    child
        .wait_with_output()
        .context("wait for SSH host-apply transport")
}

pub(crate) fn checked(target: &str, argv: &[&str], input: Option<&[u8]>) -> Result<String> {
    let command = argv
        .iter()
        .map(|part| shell_quote(part))
        .collect::<Vec<_>>()
        .join(" ");
    let output = remote(target, &command, input)?;
    if !output.status.success() {
        bail!(
            "remote catalogued operation failed ({})",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

pub fn apply(root: &Path, plan: &HostApplyPlan) -> Result<HostApplyPlan> {
    ensure!(
        plan.target == "vps"
            && ALLOWED_SERVICES.contains(&plan.service.as_str())
            && plan.binary_destination == BINARY_DEST
            && plan.binary_launch == BINARY_LAUNCH,
        "host-apply plan is outside the VPS service allowlist"
    );
    let binary = fs::read(&plan.binary_source).context("reread pinned binary artifact")?;
    ensure!(
        sha256(&binary) == plan.binary_sha256,
        "binary changed after planning"
    );
    let catalog = load_service_catalog(root)?;
    let service = catalog
        .services
        .iter()
        .find(|row| row.id == plan.service)
        .context("service disappeared from catalog")?;
    ensure!(
        service.unit.as_deref() == Some(plan.unit.as_str()) && safe_name(&plan.unit),
        "unit name changed or is invalid"
    );
    let unit_source = catalog_unit(root, service)?;
    ensure!(
        unit_source.display().to_string() == plan.unit_source,
        "catalogued unit source changed after planning"
    );
    let unit_text = fs::read(&unit_source)?;
    ensure!(
        sha256(&unit_text) == plan.unit_sha256,
        "catalogued unit changed after planning"
    );
    let launch_link_before = verify_binary_launch("vps")?;
    if plan.service == "aphrody-jobs-worker-vps" {
        let jobs_dir = "/home/ubuntu/.aphrody/jobs";
        let state = remote(
            "vps",
            &format!("sudo -n test -e {}", shell_quote(jobs_dir)),
            None,
        )?;
        match state.status.code() {
            Some(1) if state.stderr.is_empty() => {
                checked(
                    "vps",
                    &[
                        "sudo", "-n", "install", "-d", "-o", "ubuntu", "-g", "ubuntu", "-m",
                        "0700", jobs_dir,
                    ],
                    None,
                )?;
            }
            Some(0) => {
                let metadata = checked(
                    "vps",
                    &["sudo", "-n", "stat", "-c", "%U:%G:%a", jobs_dir],
                    None,
                )?;
                ensure!(
                    metadata == "ubuntu:ubuntu:700",
                    "existing jobs directory must be ubuntu:ubuntu 0700"
                );
            }
            _ => bail!("cannot safely inspect the jobs directory"),
        }
    }
    let nonce = format!("{}-{}", std::process::id(), &plan.binary_sha256[..12]);
    let stage_dir = format!("{STAGE_ROOT}/stage-{nonce}");
    let rollback_dir = format!("{ROLLBACK_ROOT}/{nonce}");
    let binary_stage = format!("{stage_dir}/aphrody");
    let binary_backup = format!("{rollback_dir}/aphrody");
    let unit_dest = format!("/etc/systemd/system/{}", plan.unit);
    let unit_stage = format!("{stage_dir}/{}", plan.unit);
    let unit_backup = format!("{rollback_dir}/{}", plan.unit);

    checked("vps", &["sudo", "-n", "test", "!", "-e", &stage_dir], None)
        .context("a matching host-apply staging directory already exists")?;
    checked(
        "vps",
        &["sudo", "-n", "test", "!", "-e", &rollback_dir],
        None,
    )
    .context("a matching host-apply rollback receipt already exists")?;
    checked(
        "vps",
        &[
            "sudo", "-n", "install", "-d", "-o", "root", "-g", "root", "-m", "0700", &stage_dir,
        ],
        None,
    )?;
    checked(
        "vps",
        &[
            "sudo",
            "-n",
            "install",
            "-d",
            "-o",
            "root",
            "-g",
            "root",
            "-m",
            "0700",
            &rollback_dir,
        ],
        None,
    )?;
    checked(
        "vps",
        &[
            "sudo",
            "-n",
            "install",
            "-o",
            "root",
            "-g",
            "root",
            "-m",
            "0755",
            "/dev/stdin",
            &binary_stage,
        ],
        Some(&binary),
    )?;
    let remote_hash = checked("vps", &["sudo", "-n", "sha256sum", &binary_stage], None)?;
    ensure!(
        remote_hash.starts_with(&plan.binary_sha256),
        "remote staged binary SHA-256 mismatch"
    );
    checked(
        "vps",
        &[
            "sudo",
            "-n",
            "install",
            "-o",
            "root",
            "-g",
            "root",
            "-m",
            "0644",
            "/dev/stdin",
            &unit_stage,
        ],
        Some(&unit_text),
    )?;
    let remote_unit_hash = checked("vps", &["sudo", "-n", "sha256sum", &unit_stage], None)?;
    ensure!(
        remote_unit_hash.starts_with(&plan.unit_sha256),
        "remote staged unit SHA-256 mismatch"
    );
    checked(
        "vps",
        &["sudo", "-n", "systemd-analyze", "verify", &unit_stage],
        None,
    )?;

    let had_binary = remote(
        "vps",
        &format!("sudo -n test -f {}", shell_quote(BINARY_DEST)),
        None,
    )?
    .status
    .success();
    ensure!(
        had_binary,
        "managed Aphrody binary destination is absent; refusing to replace launcher state"
    );
    let had_unit = remote(
        "vps",
        &format!("sudo -n test -f {}", shell_quote(&unit_dest)),
        None,
    )?
    .status
    .success();
    let commit = (|| -> Result<()> {
        ensure!(
            verify_binary_launch("vps")? == launch_link_before,
            "Aphrody launcher symlink changed during host apply"
        );
        if had_binary {
            checked(
                "vps",
                &["sudo", "-n", "cp", "-a", BINARY_DEST, &binary_backup],
                None,
            )?;
        } else {
            checked(
                "vps",
                &["sudo", "-n", "touch", &format!("{rollback_dir}/no-binary")],
                None,
            )?;
        }
        if had_unit {
            checked(
                "vps",
                &["sudo", "-n", "cp", "-a", &unit_dest, &unit_backup],
                None,
            )?;
        } else {
            checked(
                "vps",
                &["sudo", "-n", "touch", &format!("{rollback_dir}/no-unit")],
                None,
            )?;
        }
        checked(
            "vps",
            &["sudo", "-n", "mv", "-f", &binary_stage, BINARY_DEST],
            None,
        )?;
        checked(
            "vps",
            &["sudo", "-n", "mv", "-f", &unit_stage, &unit_dest],
            None,
        )?;
        checked(
            "vps",
            &["sudo", "-n", "systemd-analyze", "verify", &unit_dest],
            None,
        )?;
        checked("vps", &["sudo", "-n", "systemctl", "daemon-reload"], None)?;
        ensure!(
            verify_binary_launch("vps")? == launch_link_before,
            "Aphrody launcher symlink changed during host apply"
        );
        Ok(())
    })();
    if let Err(error) = commit {
        let binary_restore = if had_binary {
            format!(
                "cp -a {} {}",
                shell_quote(&binary_backup),
                shell_quote(BINARY_DEST)
            )
        } else {
            format!("rm -f {}", shell_quote(BINARY_DEST))
        };
        let unit_restore = if had_unit {
            format!(
                "cp -a {} {}",
                shell_quote(&unit_backup),
                shell_quote(&unit_dest)
            )
        } else {
            format!("rm -f {}", shell_quote(&unit_dest))
        };
        let rollback = format!(
            "set -eu; {binary_restore}; {unit_restore}; rm -f {}; systemctl daemon-reload",
            shell_quote(&unit_stage)
        );
        let rollback_result = remote(
            "vps",
            &format!("sudo -n sh -c {}", shell_quote(&rollback)),
            None,
        );
        let rollback_status = rollback_result
            .map(|output| output.status.success())
            .unwrap_or(false);
        let symlink_status = verify_binary_launch("vps")
            .map(|link| link == launch_link_before)
            .unwrap_or(false);
        if !rollback_status || !symlink_status {
            return Err(error.context(
                "host apply failed and rollback/launcher preservation requires manual review",
            ));
        }
        return Err(error.context(
            "host apply failed; previous catalogued unit and binary were restored where present",
        ));
    }
    Ok(HostApplyPlan {
        applied: true,
        rollback_id: nonce,
        ..plan.clone()
    })
}

pub fn rollback(
    root: &Path,
    target: &str,
    service_id: &str,
    rollback_id: &str,
    expected_binary_sha256: &str,
    expected_unit_sha256: &str,
) -> Result<()> {
    ensure!(
        target == "vps" && ALLOWED_SERVICES.contains(&service_id),
        "rollback target/service is not allowlisted"
    );
    ensure!(
        safe_rollback_id(rollback_id),
        "invalid host-apply rollback id"
    );
    ensure!(
        valid_sha256(expected_binary_sha256) && valid_sha256(expected_unit_sha256),
        "rollback requires both pinned installed SHA-256 values"
    );
    let catalog = load_service_catalog(root)?;
    let service = catalog
        .services
        .iter()
        .find(|row| row.id == service_id)
        .context("service id is absent from the service catalog")?;
    ensure!(
        service.runs_on(target) && !service.is_retired(),
        "service is not active on the requested host"
    );
    let unit = service
        .unit
        .as_deref()
        .context("catalog service has no unit")?;
    ensure!(
        safe_name(unit) && unit.ends_with(".service"),
        "invalid catalog unit name"
    );
    let unit_source = catalog_unit(root, service)?;
    let unit_text = fs::read_to_string(unit_source)?;
    ensure!(
        unit_text
            .lines()
            .any(|line| line.trim_start().starts_with("ExecStart=") && line.contains(BINARY_LAUNCH)),
        "catalog unit does not invoke the expected launcher symlink"
    );
    let launch_link_before = verify_binary_launch("vps")?;
    let rollback_dir = format!("{ROLLBACK_ROOT}/{rollback_id}");
    let binary_backup = format!("{rollback_dir}/aphrody");
    let unit_dest = format!("/etc/systemd/system/{unit}");
    let unit_backup = format!("{rollback_dir}/{unit}");
    let has_binary = remote(
        "vps",
        &format!("sudo -n test -f {}", shell_quote(&binary_backup)),
        None,
    )?
    .status
    .success();
    let no_binary = remote(
        "vps",
        &format!(
            "sudo -n test -f {}",
            shell_quote(&format!("{rollback_dir}/no-binary"))
        ),
        None,
    )?
    .status
    .success();
    let has_unit = remote(
        "vps",
        &format!("sudo -n test -f {}", shell_quote(&unit_backup)),
        None,
    )?
    .status
    .success();
    let no_unit = remote(
        "vps",
        &format!(
            "sudo -n test -f {}",
            shell_quote(&format!("{rollback_dir}/no-unit"))
        ),
        None,
    )?
    .status
    .success();
    ensure!(
        (has_binary || no_binary) && (has_unit || no_unit),
        "rollback receipt is absent or incomplete"
    );
    let current_binary = checked("vps", &["sudo", "-n", "sha256sum", BINARY_DEST], None)?;
    let current_unit = checked("vps", &["sudo", "-n", "sha256sum", &unit_dest], None)?;
    ensure!(
        current_binary.starts_with(expected_binary_sha256)
            && current_unit.starts_with(expected_unit_sha256),
        "current files differ from the pinned host-apply result; refusing stale rollback"
    );
    if has_binary {
        checked(
            "vps",
            &["sudo", "-n", "mv", "-f", &binary_backup, BINARY_DEST],
            None,
        )?;
    } else {
        checked("vps", &["sudo", "-n", "rm", "-f", BINARY_DEST], None)?;
    }
    if has_unit {
        checked(
            "vps",
            &["sudo", "-n", "mv", "-f", &unit_backup, &unit_dest],
            None,
        )?;
    } else {
        checked("vps", &["sudo", "-n", "rm", "-f", &unit_dest], None)?;
    }
    checked("vps", &["sudo", "-n", "systemctl", "daemon-reload"], None)?;
    ensure!(
        verify_binary_launch("vps")? == launch_link_before,
        "Aphrody launcher symlink changed during rollback"
    );
    Ok(())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub fn validate_rollback_request(
    target: &str,
    service_id: &str,
    rollback_id: &str,
    binary_sha256: &str,
    unit_sha256: &str,
) -> Result<()> {
    ensure!(
        target == "vps" && ALLOWED_SERVICES.contains(&service_id),
        "rollback target/service is not allowlisted"
    );
    ensure!(
        safe_rollback_id(rollback_id),
        "invalid host-apply rollback id"
    );
    ensure!(
        valid_sha256(binary_sha256) && valid_sha256(unit_sha256),
        "rollback requires both pinned installed SHA-256 values"
    );
    ensure!(
        rollback_id.ends_with(&binary_sha256[..12].to_ascii_lowercase()),
        "rollback id does not match the pinned binary"
    );
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlSecretPlan {
    pub state: String,
    pub vps_environment_file: String,
    pub dbfr_environment_file: String,
    pub applied: bool,
}

enum RemoteFile {
    Absent,
    Present {
        metadata: String,
        token_sha256: Option<String>,
        web_configured: bool,
    },
}

fn matching_secret_state(
    vps_metadata: &str,
    vps_token_sha256: Option<&str>,
    dbfr_metadata: &str,
    dbfr_token_sha256: Option<&str>,
) -> bool {
    vps_metadata == "regular file:root:root:600"
        && dbfr_metadata == "regular file:root:ubuntu:640"
        && vps_token_sha256.is_some_and(valid_sha256)
        && dbfr_token_sha256.is_some_and(valid_sha256)
        && vps_token_sha256 == dbfr_token_sha256
}

fn remote_file_state(target: &str, path: &str) -> Result<RemoteFile> {
    let key = if target == "vps" {
        "APHRODY_MCP_HTTP_TOKEN"
    } else {
        "APHRODY_VPS_MCP_HTTP_TOKEN"
    };
    checked(target, &["sudo", "-n", "test", "!", "-L", path], None)
        .with_context(|| format!("refusing symbolic-link bearer path on {target}"))?;
    let exists = remote(
        target,
        &format!("sudo -n test -e {}", shell_quote(path)),
        None,
    )?;
    match exists.status.code() {
        Some(1) if exists.stderr.is_empty() => return Ok(RemoteFile::Absent),
        Some(0) => {}
        _ => bail!("cannot inspect the catalogued secret file on {target}"),
    }
    let metadata = checked(
        target,
        &["sudo", "-n", "stat", "-c", "%F:%U:%G:%a", path],
        None,
    )?;
    ensure!(
        metadata.starts_with("regular file:"),
        "catalogued bearer path is not a regular file on {target}"
    );
    let config_line = "SHENRON_ADMIN_WEB_CONFIG=/run/aphrody/web-crawl/web.json";
    let validation_command = if target == "dbfr" {
        format!(
            "test \"$(grep -Ec '^{key}=[0-9a-f]{{64}}$' {})\" = 1 && {{ test \"$(wc -l < {})\" = 1 || {{ test \"$(wc -l < {})\" = 2 && test \"$(grep -Fxc {} {})\" = 1; }}; }}",
            shell_quote(path),
            shell_quote(path),
            shell_quote(path),
            shell_quote(config_line),
            shell_quote(path)
        )
    } else {
        format!(
            "test \"$(grep -Ec '^{key}=[0-9a-f]{{64}}$' {})\" = 1 && test \"$(wc -l < {})\" = 1",
            shell_quote(path),
            shell_quote(path)
        )
    };
    let validation = remote(
        target,
        &format!("sudo -n sh -c {}", shell_quote(&validation_command)),
        None,
    )?;
    if !validation.status.success() && validation.status.code() != Some(1) {
        bail!("cannot validate the catalogued secret file on {target}");
    }
    let token_sha256 = if validation.status.success() {
        let token_hash = checked(
            target,
            &[
                "sudo",
                "-n",
                "sh",
                "-c",
                &format!("sed -n 's/^{key}=//p' {} | sha256sum", shell_quote(path)),
            ],
            None,
        )?;
        Some(
            token_hash
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_owned(),
        )
    } else {
        None
    };
    let web_configured = target == "dbfr"
        && remote(
            target,
            &format!(
                "sudo -n grep -Fxc {} {}",
                shell_quote(config_line),
                shell_quote(path)
            ),
            None,
        )?
        .status
        .success();
    Ok(RemoteFile::Present {
        metadata,
        token_sha256,
        web_configured,
    })
}

fn provision_state() -> Result<String> {
    let vps = remote_file_state("vps", VPS_MCP_ENV)?;
    let dbfr = remote_file_state("dbfr", DBFR_CRAWL_ENV)?;
    match (vps, dbfr) {
        (RemoteFile::Absent, RemoteFile::Absent) => Ok("absent".into()),
        (
            RemoteFile::Present {
                metadata: v_meta,
                token_sha256: v_token,
                web_configured: false,
            },
            RemoteFile::Present {
                metadata: d_meta,
                token_sha256: d_token,
                web_configured: dbfr_web,
            },
        ) if matching_secret_state(&v_meta, v_token.as_deref(), &d_meta, d_token.as_deref()) => {
            Ok(if dbfr_web { "activated" } else { "complete" }.into())
        }
        _ => bail!(
            "crawl bearer provisioning is partial or divergent; refusing to overwrite existing host state"
        ),
    }
}

fn token_environment_files() -> Result<(Vec<u8>, Vec<u8>)> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| anyhow::anyhow!("CSPRNG unavailable"))?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut token = Vec::with_capacity(64);
    for byte in bytes {
        token.push(HEX[(byte >> 4) as usize]);
        token.push(HEX[(byte & 0x0f) as usize]);
    }
    bytes.fill(0);
    let mut vps = b"APHRODY_MCP_HTTP_TOKEN=".to_vec();
    vps.extend_from_slice(&token);
    vps.push(b'\n');
    let mut dbfr = b"APHRODY_VPS_MCP_HTTP_TOKEN=".to_vec();
    dbfr.extend_from_slice(&token);
    dbfr.push(b'\n');
    token.fill(0);
    Ok((vps, dbfr))
}

/// Plan by default; with apply, creates the same private bearer on VPS and DBFR by stdin only.
/// No crawl config is enabled here: SHENRON_ADMIN_WEB_CONFIG remains unset until qualification.
pub fn provision_crawl(root: &Path, apply_changes: bool) -> Result<CrawlSecretPlan> {
    let catalog = load_service_catalog(root)?;
    ensure!(
        catalog
            .services
            .iter()
            .any(|service| service.id == "aphrody-mcp-http"
                && service.runs_on("vps")
                && !service.is_retired()),
        "VPS MCP service is not catalogued as active"
    );
    ensure!(
        catalog
            .services
            .iter()
            .any(|service| service.id == "aphrody-mcp-http-dbfr"
                && service.runs_on("dbfr")
                && !service.is_retired()),
        "DBFR MCP service is not catalogued as active"
    );
    let state = provision_state()?;
    if state == "complete" || state == "activated" || !apply_changes {
        return Ok(CrawlSecretPlan {
            state,
            vps_environment_file: VPS_MCP_ENV.into(),
            dbfr_environment_file: DBFR_CRAWL_ENV.into(),
            applied: false,
        });
    }
    let vps_active = remote("vps", "systemctl is-active aphrody-mcp-http.service", None)?;
    let inactive_state = String::from_utf8_lossy(&vps_active.stdout)
        .trim()
        .to_owned();
    ensure!(
        (vps_active.status.code() == Some(3) && inactive_state == "inactive")
            || (vps_active.status.code() == Some(4) && inactive_state == "unknown"),
        "cannot safely provision a new bearer while the VPS MCP unit is active or its state is unknown"
    );

    let (mut vps_content, mut dbfr_content) = token_environment_files()?;
    let vps_hash = sha256(&vps_content);
    let dbfr_hash = sha256(&dbfr_content);
    let nonce = format!("{}-{}", std::process::id(), &sha256(&vps_content)[..12]);
    let vps_stage = format!("/etc/aphrody/.aphrody-mcp-http.env.stage-{nonce}");
    let dbfr_stage = format!("/etc/aphrody/.shenron-web-crawl.env.stage-{nonce}");
    let mut committed_vps = false;
    let mut committed_dbfr = false;
    let result = (|| -> Result<()> {
        checked("vps", &["sudo", "-n", "test", "!", "-e", &vps_stage], None)?;
        checked(
            "dbfr",
            &["sudo", "-n", "test", "!", "-e", &dbfr_stage],
            None,
        )?;
        for target in ["vps", "dbfr"] {
            checked(target, &["sudo", "-n", "test", "-d", "/etc/aphrody"], None)
                .context("the protected Aphrody secret directory must already exist")?;
        }
        checked("vps", &["sudo", "-n", "test", "!", "-e", VPS_MCP_ENV], None)?;
        checked(
            "dbfr",
            &["sudo", "-n", "test", "!", "-e", DBFR_CRAWL_ENV],
            None,
        )?;
        checked(
            "vps",
            &[
                "sudo",
                "-n",
                "install",
                "-o",
                "root",
                "-g",
                "root",
                "-m",
                "0600",
                "/dev/stdin",
                &vps_stage,
            ],
            Some(&vps_content),
        )?;
        checked(
            "dbfr",
            &[
                "sudo",
                "-n",
                "install",
                "-o",
                "root",
                "-g",
                "ubuntu",
                "-m",
                "0640",
                "/dev/stdin",
                &dbfr_stage,
            ],
            Some(&dbfr_content),
        )?;
        for (target, stage, expected_hash) in [
            ("vps", vps_stage.as_str(), &vps_hash),
            ("dbfr", dbfr_stage.as_str(), &dbfr_hash),
        ] {
            let remote_hash = checked(target, &["sudo", "-n", "sha256sum", stage], None)?;
            ensure!(
                remote_hash.starts_with(expected_hash),
                "staged bearer file differs on {target}"
            );
        }
        checked(
            "vps",
            &["sudo", "-n", "mv", "-n", &vps_stage, VPS_MCP_ENV],
            None,
        )?;
        committed_vps = true;
        checked(
            "dbfr",
            &["sudo", "-n", "mv", "-n", &dbfr_stage, DBFR_CRAWL_ENV],
            None,
        )?;
        committed_dbfr = true;
        let state = provision_state()?;
        ensure!(
            state == "complete",
            "provisioned bearer files did not pass idempotence checks"
        );
        Ok(())
    })();
    vps_content.fill(0);
    dbfr_content.fill(0);
    if let Err(error) = result {
        for (target, path, committed, expected_hash) in [
            ("vps", VPS_MCP_ENV, committed_vps, &vps_hash),
            ("dbfr", DBFR_CRAWL_ENV, committed_dbfr, &dbfr_hash),
        ] {
            if committed {
                if let Ok(remote_hash) = checked(target, &["sudo", "-n", "sha256sum", path], None) {
                    if remote_hash.starts_with(expected_hash) {
                        let _ = checked(target, &["sudo", "-n", "rm", "-f", path], None);
                    }
                }
            }
        }
        for (target, stage) in [("vps", vps_stage.as_str()), ("dbfr", dbfr_stage.as_str())] {
            let _ = checked(target, &["sudo", "-n", "rm", "-f", stage], None);
        }
        return Err(error.context(
            "crawl bearer provisioning failed; files created by this attempt were rolled back",
        ));
    }
    Ok(CrawlSecretPlan {
        state: "complete".into(),
        vps_environment_file: VPS_MCP_ENV.into(),
        dbfr_environment_file: DBFR_CRAWL_ENV.into(),
        applied: true,
    })
}

const WEB_CONFIG_DIR: &str = "/etc/aphrody/shenron-web-crawl";
const WEB_JSON_PATH: &str = "/etc/aphrody/shenron-web-crawl/web.json";
const MCP_TOML_PATH: &str = "/etc/aphrody/shenron-web-crawl/vps-mcp.toml";
const WEB_CONFIG_ENV: &str = "SHENRON_ADMIN_WEB_CONFIG=/run/aphrody/web-crawl/web.json";
const DBFR_MCP_CONFIG: &str = "[mcp_servers.aphrody]\nurl = \"http://10.200.77.1:8793/mcp\"\nbearer_token_env_var = \"APHRODY_VPS_MCP_HTTP_TOKEN\"\n";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlActivationPlan {
    pub state: String,
    pub job_id: String,
    pub probes: Vec<String>,
    pub config_directory: String,
    pub config_files: Vec<String>,
    pub applied: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlReadyPlan {
    pub state: String,
    pub container_id: String,
    pub revision: String,
    pub container_health: String,
    pub web_config_env_present: bool,
    pub config_file: String,
    pub applied: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CrawlConfigState {
    Absent,
    Prepared,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ComposeBotState {
    container_id: String,
    revision: String,
    health: String,
    web_config_env: bool,
}

fn safe_job_id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

fn bounded_crawl_job(job: &Value, expected_id: &str) -> bool {
    if job["id"].as_str() != Some(expected_id)
        || job["idempotency_key"].as_str().is_none_or(str::is_empty)
        || job["kind"].as_str() != Some("web-pipeline")
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
    let key = job["idempotency_key"].as_str().unwrap();
    let output_dir = format!(
        "/home/ubuntu/.aphrody/workspaces/dbfr/crawl/campaigns/{}",
        sha256(key.as_bytes())
    );
    if args.len() != 17
        || args[..11]
            != [
                "dragon-ball",
                "crawl",
                "--profile",
                "shenron",
                "--source",
                "official",
                "--browser",
                "playwright",
                "--output",
                output_dir.as_str(),
                "--max-requests",
            ]
        || args[12] != "--max-depth"
        || args[14..] != ["--render", "--json", "--index"]
    {
        return false;
    }
    args[11]
        .parse::<u64>()
        .is_ok_and(|value| (1..=100).contains(&value))
        && args[13].parse::<u64>().is_ok_and(|value| value <= 2)
}

fn activation_config_bytes(worker_ready: bool) -> Result<(Vec<u8>, Vec<u8>)> {
    let web = serde_json::to_vec(&json!({
        "hosts": [{
            "id": "vps",
            "config": "/run/aphrody/web-crawl/vps-mcp.toml",
            "slots": 1,
            "workerReady": worker_ready,
            "server": "aphrody"
        }],
        "actions": [{
            "id": "web-official",
            "source": "official",
            "maxRequests": 100,
            "depth": 2
        }]
    }))?;
    let mut web = web;
    web.push(b'\n');
    Ok((web, DBFR_MCP_CONFIG.as_bytes().to_vec()))
}

fn valid_revision(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_compose_bot_state(container_id: &str, output: &str) -> Result<ComposeBotState> {
    ensure!(
        (12..=64).contains(&container_id.len())
            && container_id.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "DBFR compose bot container id is invalid"
    );
    let mut fields = output.trim().split('|');
    let revision = fields.next().unwrap_or_default();
    let health = fields.next().unwrap_or_default();
    let env = fields.next().unwrap_or_default();
    ensure!(
        fields.next().is_none()
            && valid_revision(revision)
            && matches!(health, "healthy" | "unhealthy" | "starting")
            && matches!(env, "present" | "absent"),
        "DBFR compose bot probe returned an invalid status"
    );
    Ok(ComposeBotState {
        container_id: container_id.into(),
        revision: revision.into(),
        health: health.into(),
        web_config_env: env == "present",
    })
}

fn inspect_compose_bot() -> Result<ComposeBotState> {
    let ids = checked(
        "dbfr",
        &[
            "sudo",
            "-n",
            "docker",
            "ps",
            "--quiet",
            "--filter",
            "status=running",
            "--filter",
            "label=com.docker.compose.service=bot",
            "--filter",
            "label=com.docker.compose.project=shenron",
        ],
        None,
    )?;
    let ids: Vec<_> = ids.split_whitespace().collect();
    ensure!(
        ids.len() == 1,
        "DBFR must have exactly one running Compose bot container"
    );
    const INSPECT_FORMAT: &str = "{{index .Config.Labels \"org.opencontainers.image.revision\"}}|{{.State.Health.Status}}|{{range .Config.Env}}{{if eq . \"SHENRON_ADMIN_WEB_CONFIG=/run/aphrody/web-crawl/web.json\"}}present{{else}}{{end}}{{end}}";
    let output = checked(
        "dbfr",
        &[
            "sudo",
            "-n",
            "docker",
            "inspect",
            "--format",
            INSPECT_FORMAT,
            ids[0],
        ],
        None,
    )?;
    parse_compose_bot_state(ids[0], &output)
}

fn local_http_json(address: &str, path: &str) -> Result<(u16, Value)> {
    let mut stream =
        TcpStream::connect(address).with_context(|| format!("connect to local probe {address}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nAccept: application/json\r\n\r\n"
    )?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .context("local probe returned malformed HTTP")?;
    let headers =
        std::str::from_utf8(&response[..split]).context("local probe headers are not UTF-8")?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .context("local probe has no HTTP status")?;
    let body = &response[split + 4..];
    let value = serde_json::from_slice(body).context("local probe body is not JSON")?;
    Ok((status, value))
}

fn probe_local_browser() -> Result<Vec<String>> {
    let (health_status, health) = local_http_json("127.0.0.1:9235", "/health")?;
    ensure!(
        health_status == 200
            && health["service"].as_str() == Some("omar-playwright-mcp")
            && health["ok"] == true
            && health["browser"].as_str() == Some("obscura-bridge")
            && health["toolListReady"] == true
            && health["toolCount"].as_u64().unwrap_or_default() > 0,
        "local Playwright MCP health/tools-list qualification failed"
    );
    let (cdp_status, cdp) = local_http_json("127.0.0.1:9233", "/json/version")?;
    ensure!(
        cdp_status == 200
            && cdp["webSocketDebuggerUrl"]
                .as_str()
                .is_some_and(|url| url.starts_with("ws://127.0.0.1:9233/devtools/browser/")),
        "local Obscura CDP endpoint is not ready on loopback"
    );
    Ok(vec![
        "PC Playwright MCP health and toolListReady".into(),
        "PC Obscura CDP loopback endpoint".into(),
    ])
}

fn probe_vps_playwright_bridge() -> Result<()> {
    let (status, health) = local_http_json("127.0.0.1:9230", "/health")?;
    ensure!(
        status == 200 && health["ok"] == true && health["browser"].as_str().is_some(),
        "VPS Playwright bridge is not connected to Obscura CDP"
    );
    Ok(())
}

fn active_unit(target: &str, unit: &str) -> Result<()> {
    ensure!(safe_name(unit), "invalid catalogued unit name");
    let output = remote(
        target,
        &format!("systemctl is-active {}", shell_quote(unit)),
        None,
    )?;
    ensure!(
        output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "active",
        "required crawl service is not active on {target}: {unit}"
    );
    Ok(())
}

fn enabled_active_unit(target: &str, unit: &str) -> Result<()> {
    active_unit(target, unit)?;
    let output = remote(
        target,
        &format!("systemctl is-enabled {}", shell_quote(unit)),
        None,
    )?;
    ensure!(
        output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "enabled",
        "required crawl service is not enabled at boot on {target}: {unit}"
    );
    Ok(())
}

fn verify_vps_queue_permissions() -> Result<()> {
    for (path, expected) in [
        ("/home/ubuntu/.aphrody/jobs", "directory:ubuntu:ubuntu:700"),
        (
            "/home/ubuntu/.aphrody/jobs/jobs.db",
            "regular file:ubuntu:ubuntu:600",
        ),
        (
            "/home/ubuntu/.aphrody/jobs/logs",
            "directory:ubuntu:ubuntu:700",
        ),
    ] {
        checked("vps", &["sudo", "-n", "test", "!", "-L", path], None)
            .context("VPS queue paths must not be symbolic links")?;
        let actual = checked(
            "vps",
            &["sudo", "-n", "stat", "-c", "%F:%U:%G:%a", path],
            None,
        )?;
        ensure!(
            actual == expected,
            "VPS jobs storage permissions are unsafe at {path}"
        );
    }
    Ok(())
}

fn install_dbfr_probe_config(path: &str) -> Result<()> {
    checked("dbfr", &["sudo", "-n", "test", "!", "-e", path], None)?;
    checked(
        "dbfr",
        &[
            "sudo",
            "-n",
            "install",
            "-o",
            "ubuntu",
            "-g",
            "ubuntu",
            "-m",
            "0600",
            "/dev/stdin",
            path,
        ],
        Some(DBFR_MCP_CONFIG.as_bytes()),
    )?;
    Ok(())
}

fn run_dbfr_mcp(path: &str, action: &str) -> Result<String> {
    let inner = format!(
        "set -a; . {}; set +a; exec /home/ubuntu/.local/bin/aphrody mcp {} --config {}",
        shell_quote(DBFR_CRAWL_ENV),
        action,
        shell_quote(path)
    );
    let command = format!(
        "sudo -n -u ubuntu env APHRODY_HOME=/home/ubuntu/.aphrody /bin/sh -c {}",
        shell_quote(&inner)
    );
    let output = remote("dbfr", &command, None)?;
    ensure!(
        output.status.success(),
        "DBFR authenticated MCP probe failed with status {:?}; response bodies and environment values are suppressed",
        output.status.code()
    );
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn verify_mcp_tools(output: &str) -> Result<()> {
    let rows: Vec<Value> = output
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let row = rows
        .iter()
        .find(|row| row["server"].as_str() == Some("aphrody"))
        .context("DBFR MCP tools/list did not return the aphrody server")?;
    ensure!(
        row.get("error").is_none(),
        "DBFR MCP tools/list returned an error"
    );
    let tools = row["tools"]
        .as_array()
        .context("DBFR MCP tools/list has no tool array")?;
    for required in [
        "aphrody_job_status",
        "aphrody_web_crawl",
        "aphrody_browser_navigate",
    ] {
        ensure!(
            tools
                .iter()
                .any(|tool| tool["name"].as_str() == Some(required)),
            "authenticated MCP tools/list is missing {required}"
        );
    }
    Ok(())
}

fn mcp_tool_names(output: &str, server_name: &str) -> Result<Vec<String>> {
    let rows: Vec<Value> = output
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let row = rows
        .iter()
        .find(|row| row["server"].as_str() == Some(server_name))
        .context("MCP tools/list did not return the expected server")?;
    ensure!(
        row.get("error").is_none(),
        "MCP initialize/tools/list returned an error"
    );
    let tools = row["tools"]
        .as_array()
        .context("MCP tools/list has no tool array")?;
    Ok(tools
        .iter()
        .filter_map(|tool| tool["name"].as_str().map(str::to_owned))
        .collect())
}

fn probe_vps_playwright(config_path: &str) -> Result<()> {
    let health = checked(
        "vps",
        &["curl", "-fsS", "http://127.0.0.1:9235/health"],
        None,
    )?;
    let health: Value =
        serde_json::from_str(&health).context("forwarded Playwright health is not JSON")?;
    ensure!(
        health["service"].as_str() == Some("omar-playwright-mcp")
            && health["ok"] == true
            && health["toolListReady"] == true
            && health["browser"].as_str() == Some("obscura-bridge")
            && health["toolCount"].as_u64().unwrap_or_default() > 0,
        "VPS-forwarded Playwright health did not confirm the PC MCP tools/list"
    );
    let output = (|| -> Result<String> {
        checked("vps", &["sudo", "-n", "test", "!", "-e", config_path], None)?;
        let config = b"[mcp_servers.playwright]\nurl = \"http://127.0.0.1:9234/mcp\"\n";
        checked(
            "vps",
            &[
                "sudo",
                "-n",
                "install",
                "-o",
                "root",
                "-g",
                "root",
                "-m",
                "0600",
                "/dev/stdin",
                config_path,
            ],
            Some(config),
        )?;
        checked(
            "vps",
            &[
                "sudo",
                "-n",
                "/home/ubuntu/.local/bin/aphrody",
                "mcp",
                "list",
                "--config",
                config_path,
            ],
            None,
        )
    })();
    let _ = checked("vps", &["sudo", "-n", "rm", "-f", config_path], None);
    let names = mcp_tool_names(&output?, "playwright")?;
    ensure!(
        !names.is_empty() && names.iter().any(|name| name.ends_with("navigate")),
        "VPS-forwarded Playwright MCP tools/list lacks a navigation tool"
    );
    Ok(())
}

fn extract_job_status(output: &str, job_id: &str) -> Result<Value> {
    let envelope: Value =
        serde_json::from_str(output.trim()).context("job status MCP response is not JSON")?;
    let result = &envelope["result"];
    ensure!(
        result["isError"] != true && result["is_error"] != true,
        "job status MCP call returned an error"
    );
    let text = result["content"]
        .as_array()
        .context("job status response has no content")?
        .iter()
        .filter_map(|block| {
            (block["type"].as_str() == Some("text"))
                .then(|| block["text"].as_str())
                .flatten()
        })
        .collect::<Vec<_>>()
        .join("\n");
    let body: Value = serde_json::from_str(&text).context("job status content is not JSON")?;
    let job = body.get("job").context("job status response has no job")?;
    ensure!(
        bounded_crawl_job(job, job_id),
        "the supplied job is not a successful bounded official Shenron crawl assigned exclusively to the VPS"
    );
    Ok(job.clone())
}

fn path_metadata(target: &str, path: &str) -> Result<Option<String>> {
    checked(target, &["sudo", "-n", "test", "!", "-L", path], None)
        .with_context(|| format!("refusing symbolic-link activation path on {target}"))?;
    let output = remote(
        target,
        &format!("sudo -n test -e {}", shell_quote(path)),
        None,
    )?;
    match output.status.code() {
        Some(1) if output.stderr.is_empty() => return Ok(None),
        Some(0) => {}
        _ => bail!("cannot inspect activation file on {target}"),
    }
    Ok(Some(checked(
        target,
        &["sudo", "-n", "stat", "-c", "%F:%U:%G:%a", path],
        None,
    )?))
}

fn file_metadata_hash(target: &str, path: &str) -> Result<Option<(String, String)>> {
    let Some(metadata) = path_metadata(target, path)? else {
        return Ok(None);
    };
    ensure!(
        metadata.starts_with("regular file:"),
        "activation path is not a regular file: {path}"
    );
    let hash = checked(target, &["sudo", "-n", "sha256sum", path], None)?
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_owned();
    Ok(Some((metadata, hash)))
}

fn verify_activation_files(prepared: &[u8], ready: &[u8], mcp: &[u8]) -> Result<CrawlConfigState> {
    let web = file_metadata_hash("dbfr", WEB_JSON_PATH)?;
    let mcp_file = file_metadata_hash("dbfr", MCP_TOML_PATH)?;
    match (web, mcp_file) {
        (None, None) => Ok(CrawlConfigState::Absent),
        (Some((web_meta, web_hash)), Some((mcp_meta, mcp_hash))) => {
            ensure!(
                web_meta == "regular file:ubuntu:ubuntu:600"
                    && mcp_meta == "regular file:ubuntu:ubuntu:600"
                    && mcp_hash == sha256(mcp),
                "existing activation files are divergent or have unsafe permissions"
            );
            if web_hash == sha256(prepared) {
                Ok(CrawlConfigState::Prepared)
            } else if web_hash == sha256(ready) {
                Ok(CrawlConfigState::Ready)
            } else {
                bail!("existing web crawl config is divergent or has unsafe permissions")
            }
        }
        _ => bail!("crawl activation config is partial"),
    }
}

/// Plan by default. The command repeats live probes and requires a real, bounded, succeeded job id.
/// Apply prepares workerReady=false and adds the env switch; it never starts a service.
pub fn activate_crawl(
    root: &Path,
    job_id: &str,
    apply_changes: bool,
) -> Result<CrawlActivationPlan> {
    ensure!(
        safe_job_id(job_id),
        "job id must contain only ASCII letters, digits, '_' or '-' (1..=128 bytes)"
    );
    let catalog = load_service_catalog(root)?;
    for id in [
        "aphrody-mcp-http",
        "aphrody-jobs-worker-vps",
        "aphrody-web-browser-vps",
        "aphrody-web-playwright-vps",
        "omar-browser-client-vps",
    ] {
        let service = catalog
            .services
            .iter()
            .find(|service| service.id == id)
            .context("required service is missing from the catalog")?;
        ensure!(
            service.runs_on("vps") && !service.is_retired(),
            "required service is not active in the VPS service catalog: {id}"
        );
        enabled_active_unit(
            "vps",
            service
                .unit
                .as_deref()
                .context("required service has no systemd unit")?,
        )?;
    }
    enabled_active_unit("vps", "aphrody-wg-proxy@8793.socket")?;
    verify_vps_queue_permissions()?;

    let (mut probes, config_path) = (
        probe_local_browser()?,
        format!("/run/.aphrody-crawl-probe-{}.toml", std::process::id()),
    );
    probe_vps_playwright_bridge()?;
    probes.push("VPS Playwright render bridge is healthy on loopback 9230".into());
    let playwright_config = format!("/run/.aphrody-playwright-probe-{}.toml", std::process::id());
    probe_vps_playwright(&playwright_config)?;
    let secret_state = provision_state()?;
    ensure!(
        secret_state == "complete" || secret_state == "activated",
        "matching VPS/DBFR crawl bearer must be provisioned before activation"
    );
    let unauth = remote(
        "dbfr",
        "curl -sS -o /dev/null -w '%{http_code}' -X POST http://10.200.77.1:8793/mcp",
        None,
    )?;
    ensure!(
        unauth.status.success() && String::from_utf8_lossy(&unauth.stdout).trim() == "401",
        "DBFR unauthenticated MCP request did not return 401"
    );
    let probes_result = (|| -> Result<Value> {
        install_dbfr_probe_config(&config_path)?;
        let tools = run_dbfr_mcp(&config_path, "list")?;
        verify_mcp_tools(&tools)?;
        let args = serde_json::to_string(&json!({"id": job_id, "log_tail": 0}))?;
        let action = format!(
            "call aphrody aphrody_job_status --args {}",
            shell_quote(&args)
        );
        let status = run_dbfr_mcp(&config_path, &action)?;
        extract_job_status(&status, job_id)
    })();
    let _ = checked("dbfr", &["sudo", "-n", "rm", "-f", &config_path], None);
    let job = probes_result?;
    probes.extend([
        "VPS MCP, worker, Obscura CDP and Playwright bridge units active".into(),
        "VPS WireGuard MCP socket active".into(),
        "VPS loopback forward to PC Playwright health 9235 and MCP initialize/tools/list 9234"
            .into(),
        "DBFR unauthenticated MCP request returns 401".into(),
        "DBFR authenticated MCP tools/list includes queue, crawl, and Obscura".into(),
        format!(
            "bounded Shenron web-pipeline job {} succeeded on vps",
            job["id"].as_str().unwrap_or_default()
        ),
    ]);

    let (web, mcp) = activation_config_bytes(false)?;
    let (ready_web, _) = activation_config_bytes(true)?;
    let config_state = verify_activation_files(&web, &ready_web, &mcp)?;
    let dbfr = remote_file_state("dbfr", DBFR_CRAWL_ENV)?;
    let configured = match dbfr {
        RemoteFile::Present { web_configured, .. } => web_configured,
        RemoteFile::Absent => bail!("DBFR bearer env file is absent"),
    };
    if secret_state == "activated" {
        ensure!(
            configured && config_state != CrawlConfigState::Absent,
            "existing crawl activation is partial or divergent"
        );
        ensure!(
            path_metadata("dbfr", WEB_CONFIG_DIR)?.as_deref() == Some("directory:root:ubuntu:750"),
            "existing crawl config directory has unsafe type, owner, or mode"
        );
        return Ok(CrawlActivationPlan {
            state: match config_state {
                CrawlConfigState::Prepared => "already-prepared",
                CrawlConfigState::Ready => "already-ready",
                CrawlConfigState::Absent => unreachable!(),
            }
            .into(),
            job_id: job_id.into(),
            probes,
            config_directory: WEB_CONFIG_DIR.into(),
            config_files: vec![WEB_JSON_PATH.into(), MCP_TOML_PATH.into()],
            applied: false,
        });
    }
    ensure!(
        !configured && config_state == CrawlConfigState::Absent,
        "crawl activation state is partial; refusing to overwrite host files"
    );
    if !apply_changes {
        return Ok(CrawlActivationPlan {
            state: "ready-to-activate".into(),
            job_id: job_id.into(),
            probes,
            config_directory: WEB_CONFIG_DIR.into(),
            config_files: vec![WEB_JSON_PATH.into(), MCP_TOML_PATH.into()],
            applied: false,
        });
    }

    let dir = path_metadata("dbfr", WEB_CONFIG_DIR)?;
    if let Some(metadata) = dir.as_deref() {
        ensure!(
            metadata == "directory:root:ubuntu:750",
            "existing web crawl config directory must be root:ubuntu 0750"
        );
    }
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    );
    let web_stage = format!("{WEB_CONFIG_DIR}/.web.json.stage-{nonce}");
    let mcp_stage = format!("{WEB_CONFIG_DIR}/.vps-mcp.toml.stage-{nonce}");
    let env_stage = format!("/etc/aphrody/.shenron-web-crawl.env.stage-{nonce}");
    let env_backup = format!("/etc/aphrody/.shenron-web-crawl.env.backup-{nonce}");
    let (mut web, mut mcp) = (web, mcp);
    let web_hash = sha256(&web);
    let mcp_hash = sha256(&mcp);
    let mut made_dir = false;
    let mut committed_web = false;
    let mut committed_mcp = false;
    let mut committed_env = false;
    let result = (|| -> Result<()> {
        for path in [
            &web_stage,
            &mcp_stage,
            &env_stage,
            &env_backup,
            WEB_JSON_PATH,
            MCP_TOML_PATH,
        ] {
            checked("dbfr", &["sudo", "-n", "test", "!", "-e", path], None)?;
        }
        if dir.is_none() {
            checked(
                "dbfr",
                &[
                    "sudo",
                    "-n",
                    "install",
                    "-d",
                    "-o",
                    "root",
                    "-g",
                    "ubuntu",
                    "-m",
                    "0750",
                    WEB_CONFIG_DIR,
                ],
                None,
            )?;
            made_dir = true;
        }
        checked(
            "dbfr",
            &[
                "sudo",
                "-n",
                "install",
                "-o",
                "ubuntu",
                "-g",
                "ubuntu",
                "-m",
                "0600",
                "/dev/stdin",
                &web_stage,
            ],
            Some(&web),
        )?;
        checked(
            "dbfr",
            &[
                "sudo",
                "-n",
                "install",
                "-o",
                "ubuntu",
                "-g",
                "ubuntu",
                "-m",
                "0600",
                "/dev/stdin",
                &mcp_stage,
            ],
            Some(&mcp),
        )?;
        checked(
            "dbfr",
            &["sudo", "-n", "cp", "-p", DBFR_CRAWL_ENV, &env_stage],
            None,
        )?;
        checked(
            "dbfr",
            &["sudo", "-n", "chown", "root:ubuntu", &env_stage],
            None,
        )?;
        checked("dbfr", &["sudo", "-n", "chmod", "0640", &env_stage], None)?;
        checked(
            "dbfr",
            &[
                "sudo",
                "-n",
                "sh",
                "-c",
                &format!(
                    "printf '%s\\n' {} >> {}",
                    shell_quote(WEB_CONFIG_ENV),
                    shell_quote(&env_stage)
                ),
            ],
            None,
        )?;
        ensure!(
            file_metadata_hash("dbfr", &web_stage)?.is_some_and(|(meta, hash)| meta
                == "regular file:ubuntu:ubuntu:600"
                && hash == web_hash),
            "staged web.json differs from the reviewed config"
        );
        ensure!(
            file_metadata_hash("dbfr", &mcp_stage)?.is_some_and(|(meta, hash)| meta
                == "regular file:ubuntu:ubuntu:600"
                && hash == mcp_hash),
            "staged MCP config differs from the reviewed config"
        );
        let original = remote_file_state("dbfr", DBFR_CRAWL_ENV)?;
        let staged = remote_file_state("dbfr", &env_stage)?;
        match (original, staged) {
            (
                RemoteFile::Present {
                    token_sha256: Some(old),
                    ..
                },
                RemoteFile::Present {
                    metadata,
                    token_sha256: Some(new),
                    web_configured: true,
                },
            ) => {
                ensure!(
                    metadata == "root:ubuntu:640" && old == new,
                    "staged DBFR env changed its bearer or permissions"
                );
            }
            _ => bail!("staged DBFR env failed bearer preservation checks"),
        }
        checked(
            "dbfr",
            &["sudo", "-n", "mv", "-n", &web_stage, WEB_JSON_PATH],
            None,
        )?;
        ensure!(
            file_metadata_hash("dbfr", WEB_JSON_PATH)?.is_some_and(|(_, hash)| hash == web_hash),
            "web.json atomic finalization failed"
        );
        committed_web = true;
        checked(
            "dbfr",
            &["sudo", "-n", "mv", "-n", &mcp_stage, MCP_TOML_PATH],
            None,
        )?;
        ensure!(
            file_metadata_hash("dbfr", MCP_TOML_PATH)?.is_some_and(|(_, hash)| hash == mcp_hash),
            "MCP config atomic finalization failed"
        );
        committed_mcp = true;
        checked(
            "dbfr",
            &["sudo", "-n", "cp", "-p", DBFR_CRAWL_ENV, &env_backup],
            None,
        )?;
        checked(
            "dbfr",
            &["sudo", "-n", "mv", "-f", &env_stage, DBFR_CRAWL_ENV],
            None,
        )?;
        committed_env = true;
        ensure!(
            provision_state()? == "activated",
            "activated DBFR env did not pass its token and config check"
        );
        ensure!(
            verify_activation_files(&web, &ready_web, &mcp)? == CrawlConfigState::Prepared,
            "activated crawl config files failed their hashes or permissions"
        );
        checked("dbfr", &["sudo", "-n", "rm", "-f", &env_backup], None)?;
        Ok(())
    })();
    web.fill(0);
    mcp.fill(0);
    if let Err(error) = result {
        let mut rollback_errors = Vec::new();
        if committed_env {
            match remote_file_state("dbfr", DBFR_CRAWL_ENV) {
                Ok(RemoteFile::Present {
                    web_configured: true,
                    ..
                }) => {
                    if let Err(rollback) = checked(
                        "dbfr",
                        &["sudo", "-n", "mv", "-f", &env_backup, DBFR_CRAWL_ENV],
                        None,
                    ) {
                        rollback_errors.push(rollback.to_string());
                    }
                }
                _ => rollback_errors
                    .push("DBFR env changed during rollback; preserved for manual review".into()),
            }
        } else {
            if let Err(rollback) = checked("dbfr", &["sudo", "-n", "rm", "-f", &env_backup], None) {
                rollback_errors.push(rollback.to_string());
            }
        }
        if committed_web {
            match file_metadata_hash("dbfr", WEB_JSON_PATH) {
                Ok(Some((_, hash))) if hash == web_hash => {
                    if let Err(rollback) =
                        checked("dbfr", &["sudo", "-n", "rm", "-f", WEB_JSON_PATH], None)
                    {
                        rollback_errors.push(rollback.to_string());
                    }
                }
                _ => rollback_errors
                    .push("web.json changed during rollback; preserved for manual review".into()),
            }
        }
        if committed_mcp {
            match file_metadata_hash("dbfr", MCP_TOML_PATH) {
                Ok(Some((_, hash))) if hash == mcp_hash => {
                    if let Err(rollback) =
                        checked("dbfr", &["sudo", "-n", "rm", "-f", MCP_TOML_PATH], None)
                    {
                        rollback_errors.push(rollback.to_string());
                    }
                }
                _ => rollback_errors
                    .push("MCP config changed during rollback; preserved for manual review".into()),
            }
        }
        for path in [&web_stage, &mcp_stage, &env_stage] {
            if let Err(rollback) = checked("dbfr", &["sudo", "-n", "rm", "-f", path], None) {
                rollback_errors.push(rollback.to_string());
            }
        }
        if made_dir {
            if let Err(rollback) = checked("dbfr", &["sudo", "-n", "rmdir", WEB_CONFIG_DIR], None) {
                rollback_errors.push(rollback.to_string());
            }
        }
        if rollback_errors.is_empty() {
            return Err(error.context(
                "crawl activation failed; changes made by this attempt were rolled back",
            ));
        }
        return Err(error.context(format!(
            "crawl activation failed and rollback needs review: {}",
            rollback_errors.join("; ")
        )));
    }
    Ok(CrawlActivationPlan {
        state: "prepared".into(),
        job_id: job_id.into(),
        probes,
        config_directory: WEB_CONFIG_DIR.into(),
        config_files: vec![WEB_JSON_PATH.into(), MCP_TOML_PATH.into()],
        applied: true,
    })
}

fn replace_web_config(expected: &[u8], replacement: &[u8]) -> Result<()> {
    let metadata = path_metadata("dbfr", WEB_CONFIG_DIR)?;
    ensure!(
        metadata.as_deref() == Some("directory:root:ubuntu:750"),
        "prepared crawl config directory must be root:ubuntu 0750"
    );
    let (current_meta, current_hash) =
        file_metadata_hash("dbfr", WEB_JSON_PATH)?.context("prepared web.json is absent")?;
    ensure!(
        current_meta == "regular file:ubuntu:ubuntu:600" && current_hash == sha256(expected),
        "web.json changed from the expected worker readiness state"
    );
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    );
    let stage = format!("{WEB_CONFIG_DIR}/.web.json.ready-{nonce}");
    checked("dbfr", &["sudo", "-n", "test", "!", "-e", &stage], None)?;
    checked("dbfr", &["sudo", "-n", "test", "!", "-L", &stage], None)?;
    let result = (|| -> Result<()> {
        checked(
            "dbfr",
            &[
                "sudo",
                "-n",
                "install",
                "-o",
                "ubuntu",
                "-g",
                "ubuntu",
                "-m",
                "0600",
                "/dev/stdin",
                &stage,
            ],
            Some(replacement),
        )?;
        let staged = file_metadata_hash("dbfr", &stage)?;
        ensure!(
            staged.is_some_and(|(meta, hash)| {
                meta == "regular file:ubuntu:ubuntu:600" && hash == sha256(replacement)
            }),
            "staged ready config failed its owner, mode, or hash check"
        );
        let before_commit = file_metadata_hash("dbfr", WEB_JSON_PATH)?;
        ensure!(
            before_commit.is_some_and(|(meta, hash)| {
                meta == "regular file:ubuntu:ubuntu:600" && hash == sha256(expected)
            }),
            "web.json changed while ready config was staged"
        );
        checked(
            "dbfr",
            &["sudo", "-n", "mv", "-f", &stage, WEB_JSON_PATH],
            None,
        )?;
        let installed = file_metadata_hash("dbfr", WEB_JSON_PATH)?;
        ensure!(
            installed.is_some_and(|(meta, hash)| {
                meta == "regular file:ubuntu:ubuntu:600" && hash == sha256(replacement)
            }),
            "atomic workerReady transition failed verification"
        );
        Ok(())
    })();
    if let Err(error) = result {
        let _ = checked("dbfr", &["sudo", "-n", "rm", "-f", &stage], None);
        return Err(error.context("workerReady transition did not pass verification"));
    }
    Ok(())
}

/// Plan by default. Apply rechecks the unique healthy DBFR bot, pinned image revision,
/// and config environment before atomically changing the prepared config to ready.
pub fn ready_crawl(_root: &Path, revision: &str, apply_changes: bool) -> Result<CrawlReadyPlan> {
    ensure!(
        valid_revision(revision),
        "revision must be exactly 40 hexadecimal characters"
    );
    let (prepared, mcp) = activation_config_bytes(false)?;
    let (ready, _) = activation_config_bytes(true)?;
    let initial_bot = inspect_compose_bot()?;
    ensure!(
        initial_bot.revision.eq_ignore_ascii_case(revision),
        "running DBFR bot image revision does not match the requested revision"
    );
    ensure!(
        initial_bot.health == "healthy" && initial_bot.web_config_env,
        "running DBFR bot must be healthy and contain the crawl config environment entry"
    );
    ensure!(
        path_metadata("dbfr", WEB_CONFIG_DIR)?.as_deref() == Some("directory:root:ubuntu:750"),
        "DBFR crawl config directory must be root:ubuntu 0750"
    );
    let config_state = verify_activation_files(&prepared, &ready, &mcp)?;
    ensure!(
        matches!(
            config_state,
            CrawlConfigState::Prepared | CrawlConfigState::Ready
        ),
        "web crawl config must be prepared before marking the worker ready"
    );
    if config_state == CrawlConfigState::Ready {
        return Ok(CrawlReadyPlan {
            state: "already-ready".into(),
            container_id: initial_bot.container_id,
            revision: initial_bot.revision,
            container_health: initial_bot.health,
            web_config_env_present: initial_bot.web_config_env,
            config_file: WEB_JSON_PATH.into(),
            applied: false,
        });
    }
    if !apply_changes {
        return Ok(CrawlReadyPlan {
            state: "ready-to-mark".into(),
            container_id: initial_bot.container_id,
            revision: initial_bot.revision,
            container_health: initial_bot.health,
            web_config_env_present: initial_bot.web_config_env,
            config_file: WEB_JSON_PATH.into(),
            applied: false,
        });
    }

    let current_bot = inspect_compose_bot()?;
    ensure!(
        current_bot == initial_bot,
        "DBFR bot container changed after planning; inspect and plan again"
    );
    ensure!(
        current_bot.revision.eq_ignore_ascii_case(revision)
            && current_bot.health == "healthy"
            && current_bot.web_config_env,
        "DBFR bot no longer satisfies the release readiness gate"
    );
    ensure!(
        verify_activation_files(&prepared, &ready, &mcp)? == CrawlConfigState::Prepared,
        "worker config changed after planning; inspect and plan again"
    );
    if let Err(error) = replace_web_config(&prepared, &ready) {
        let rollback = match verify_activation_files(&prepared, &ready, &mcp) {
            Ok(CrawlConfigState::Ready) => replace_web_config(&ready, &prepared),
            Ok(_) => Ok(()),
            Err(verify_error) => Err(verify_error),
        };
        return match rollback {
            Ok(()) => Err(error.context(
                "workerReady transition failed; prepared false state is preserved",
            )),
            Err(rollback_error) => Err(error.context(format!(
                "workerReady transition failed and false-state rollback needs review: {rollback_error}"
            ))),
        };
    }
    let final_check = (|| -> Result<ComposeBotState> {
        let final_bot = inspect_compose_bot()?;
        ensure!(
            final_bot == current_bot,
            "DBFR bot changed during workerReady transition"
        );
        ensure!(
            verify_activation_files(&prepared, &ready, &mcp)? == CrawlConfigState::Ready,
            "workerReady config failed final verification"
        );
        Ok(final_bot)
    })();
    let final_bot = match final_check {
        Ok(bot) => bot,
        Err(error) => {
            let rollback = replace_web_config(&ready, &prepared);
            return match rollback {
                Ok(()) => Err(error.context(
                    "post-transition release check failed; workerReady was rolled back to false",
                )),
                Err(rollback_error) => Err(error.context(format!(
                    "post-transition release check failed and workerReady rollback failed: {rollback_error}"
                ))),
            };
        }
    };
    Ok(CrawlReadyPlan {
        state: "ready".into(),
        container_id: final_bot.container_id,
        revision: final_bot.revision,
        container_health: final_bot.health,
        web_config_env_present: final_bot.web_config_env,
        config_file: WEB_JSON_PATH.into(),
        applied: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quote_handles_single_quotes() {
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn unit_names_reject_shell_metacharacters() {
        assert!(safe_name("aphrody-jobs-worker-vps.service"));
        assert!(!safe_name("aphrody;touch-bad.service"));
    }

    #[test]
    fn rollback_ids_are_strictly_generated_shape() {
        assert!(safe_rollback_id("1234-0123456789ab"));
        assert!(!safe_rollback_id("../etc/passwd"));
        assert!(!safe_rollback_id("1-abc"));
    }

    #[test]
    fn crawl_bearer_state_requires_expected_permissions_and_same_token_hash() {
        let token_hash = "a".repeat(64);
        assert!(matching_secret_state(
            "regular file:root:root:600",
            Some(&token_hash),
            "regular file:root:ubuntu:640",
            Some(&token_hash)
        ));
        assert!(!matching_secret_state(
            "regular file:root:root:644",
            Some(&token_hash),
            "regular file:root:ubuntu:640",
            Some(&token_hash)
        ));
        assert!(!matching_secret_state(
            "regular file:root:root:600",
            Some(&token_hash),
            "regular file:root:ubuntu:640",
            Some(&"b".repeat(64))
        ));
        assert!(!matching_secret_state(
            "regular file:root:root:600",
            None,
            "regular file:root:ubuntu:640",
            Some(&token_hash)
        ));
    }

    #[test]
    fn worker_service_maps_to_one_catalogued_vps_unit() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let catalog = load_service_catalog(&root).unwrap();
        for (id, expected) in [
            ("aphrody-mcp-http", "aphrody-mcp-http.service"),
            ("aphrody-jobs-worker-vps", "aphrody-jobs-worker-vps.service"),
        ] {
            let service = catalog.services.iter().find(|row| row.id == id).unwrap();
            let unit = catalog_unit(&root, service).unwrap();
            assert_eq!(service.unit.as_deref(), Some(expected));
            assert!(unit.is_file());
            let text = fs::read_to_string(unit).unwrap();
            assert!(text.contains(BINARY_LAUNCH));
            assert!(!text.contains(BINARY_DEST));
        }
    }

    #[test]
    fn managed_binary_path_never_replaces_the_launch_symlink() {
        assert_eq!(BINARY_DEST, "/home/ubuntu/.local/share/aphrody/bin/aphrody");
        assert_eq!(BINARY_LAUNCH, "/home/ubuntu/.local/bin/aphrody");
        assert_ne!(BINARY_DEST, BINARY_LAUNCH);
    }

    #[test]
    fn ssh_forward_unit_is_catalogued_for_vps_and_loopback_only() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let plan = unit_plan(&root, "vps", SSH_UNIT_SERVICE).unwrap();
        assert_eq!(plan.unit, "aphrody-obscura-omar-client.service");
        assert!(
            plan.unit_source
                .ends_with("systemd/omar/aphrody-obscura-omar-client.service")
        );
        let source = fs::read_to_string(&plan.unit_source).unwrap();
        validate_ssh_forward_unit(&source).unwrap();
        assert!(unit_plan(&root, "dbfr", SSH_UNIT_SERVICE).is_err());
        assert!(unit_plan(&root, "vps", "aphrody-mcp-http").is_err());
        assert!(
            validate_ssh_forward_unit(&source.replace("127.0.0.1:9234", "0.0.0.0:9234")).is_err()
        );
        assert!(
            validate_ssh_forward_unit(&source.replace("127.0.0.1:9230", "0.0.0.0:9230")).is_err()
        );
    }

    #[test]
    fn vps_playwright_bridge_unit_is_catalogued_and_loopback_scoped() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let plan = unit_plan(&root, "vps", VPS_PLAYWRIGHT_SERVICE).unwrap();
        assert_eq!(plan.unit, "aphrody-web-playwright-vps.service");
        assert_eq!(plan.files.len(), 1);
        assert!(
            plan.unit_source
                .ends_with("systemd/aphrody/aphrody-web-playwright-vps.service")
        );
        let source = fs::read_to_string(&plan.unit_source).unwrap();
        assert!(source.contains("APHRODY_WEB_PLAYWRIGHT_BIND=127.0.0.1:9230"));
        assert!(source.contains("127.0.0.1:9222"));
        assert!(unit_plan(&root, "dbfr", VPS_PLAYWRIGHT_SERVICE).is_err());
    }

    #[test]
    fn vps_obscura_unit_is_catalogued_and_loopback_scoped() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let plan = unit_plan(&root, "vps", VPS_BROWSER_SERVICE).unwrap();
        assert_eq!(plan.unit, "aphrody-web-browser-vps.service");
        assert!(plan.files.iter().any(|file| {
            file.destination
                .ends_with("aphrody-web-browser-vps.service.d/sandbox-base.conf")
        }));
        let user_drop_in = plan
            .files
            .iter()
            .find(|file| file.destination.ends_with("run-as-ubuntu.conf"))
            .unwrap();
        assert!(
            fs::read_to_string(&user_drop_in.source)
                .unwrap()
                .contains("User=ubuntu")
        );
        assert!(unit_plan(&root, "dbfr", VPS_BROWSER_SERVICE).is_err());
    }

    #[test]
    fn wg_mcp_projection_plan_contains_catalogued_unit_pair_and_dropins() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let plan = unit_plan(&root, "vps", WG_PROXY_SERVICE).unwrap();
        assert_eq!(plan.files.len(), 6);
        assert!(
            plan.files
                .iter()
                .any(|file| file.unit == "aphrody-wg-proxy@.service")
        );
        assert!(
            plan.files
                .iter()
                .any(|file| file.unit == "aphrody-wg-proxy@.socket")
        );
        assert_eq!(
            plan.files
                .iter()
                .filter(|file| file.destination.contains(".service.d/"))
                .count(),
            4
        );
        assert!(unit_plan(&root, "dbfr", WG_PROXY_SERVICE).is_err());
    }

    #[test]
    fn activation_job_guard_requires_a_successful_bounded_vps_crawl() {
        let key = "shenron:test:official";
        let output_dir = format!(
            "/home/ubuntu/.aphrody/workspaces/dbfr/crawl/campaigns/{}",
            sha256(key.as_bytes())
        );
        let mut job = json!({
            "id":"crawl-123", "kind":"web-pipeline", "state":"succeeded",
            "idempotency_key":key, "attempts":1, "max_attempts":1, "result":{"pages":1},
            "host_affinity":{"mode":"hosts","hosts":["vps"]},
            "payload":{"args":["dragon-ball","crawl","--profile","shenron","--source","official","--browser","playwright","--output",output_dir,"--max-requests","10","--max-depth","1","--render","--json","--index"]}
        });
        assert!(safe_job_id("crawl-123"));
        assert!(!safe_job_id("../unsafe"));
        assert!(bounded_crawl_job(&job, "crawl-123"));
        job["host_affinity"]["hosts"] = json!(["dbfr"]);
        assert!(!bounded_crawl_job(&job, "crawl-123"));
        job["host_affinity"]["hosts"] = json!(["vps"]);
        job["payload"]["args"][11] = json!("5000");
        assert!(!bounded_crawl_job(&job, "crawl-123"));
        job["payload"]["args"][11] = json!("10");
        job["payload"]["args"][9] = json!("/tmp/wrong-output");
        assert!(!bounded_crawl_job(&job, "crawl-123"));
    }

    #[test]
    fn activation_config_starts_prepared_and_ready_transition_preserves_contract() {
        let (web, mcp) = activation_config_bytes(false).unwrap();
        let (ready_web, _) = activation_config_bytes(true).unwrap();
        let config: Value = serde_json::from_slice(&web).unwrap();
        let ready_config: Value = serde_json::from_slice(&ready_web).unwrap();
        assert_eq!(config["hosts"].as_array().unwrap().len(), 1);
        assert_eq!(config["hosts"][0]["id"], "vps");
        assert_eq!(config["hosts"][0]["workerReady"], false);
        assert_eq!(ready_config["hosts"][0]["workerReady"], true);
        assert_eq!(config["hosts"][0]["slots"], 1);
        assert_eq!(config["actions"][0]["maxRequests"], 100);
        assert!(
            std::str::from_utf8(&mcp)
                .unwrap()
                .contains("10.200.77.1:8793/mcp")
        );
        assert!(
            std::str::from_utf8(&mcp)
                .unwrap()
                .contains("APHRODY_VPS_MCP_HTTP_TOKEN")
        );
    }

    #[test]
    fn compose_bot_probe_parser_exposes_only_expected_fields() {
        let id = "a1b2c3d4e5f6";
        let revision = "0123456789abcdef0123456789abcdef01234567";
        let bot = parse_compose_bot_state(id, &format!("{revision}|healthy|present")).unwrap();
        assert_eq!(bot.revision, revision);
        assert_eq!(bot.health, "healthy");
        assert!(bot.web_config_env);
        let without_env =
            parse_compose_bot_state(id, &format!("{revision}|healthy|absent")).unwrap();
        assert!(!without_env.web_config_env);
        assert!(parse_compose_bot_state(id, &format!("{revision}|<no value>|present")).is_err());
        assert!(parse_compose_bot_state(id, &format!("|healthy|present")).is_err());
        assert!(parse_compose_bot_state(id, &format!("{revision}|healthy|TOKEN=secret")).is_err());
        assert!(parse_compose_bot_state(id, "<no value>|healthy|present").is_err());
        assert!(parse_compose_bot_state("../bad", &format!("{revision}|healthy|present")).is_err());
    }

    #[test]
    fn worker_ready_revision_requires_full_commit_hash() {
        assert!(valid_revision("0123456789abcdef0123456789abcdef01234567"));
        assert!(valid_revision("0123456789ABCDEF0123456789ABCDEF01234567"));
        assert!(!valid_revision("deadbeef"));
        assert!(!valid_revision("g123456789abcdef0123456789abcdef01234567"));
    }

    #[test]
    fn generated_environment_uses_host_specific_names_for_the_same_private_bearer() {
        let (mut vps, mut dbfr) = token_environment_files().unwrap();
        let vps_text = std::str::from_utf8(&vps).unwrap();
        let dbfr_text = std::str::from_utf8(&dbfr).unwrap();
        let value = vps_text
            .strip_prefix("APHRODY_MCP_HTTP_TOKEN=")
            .unwrap()
            .trim_end();
        let dbfr_value = dbfr_text
            .strip_prefix("APHRODY_VPS_MCP_HTTP_TOKEN=")
            .unwrap()
            .trim_end();
        assert_eq!(value, dbfr_value);
        assert_eq!(value.len(), 64);
        assert!(value.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(vps_text.lines().count(), 1);
        assert_eq!(dbfr_text.lines().count(), 1);
        vps.fill(0);
        dbfr.fill(0);
    }
}
