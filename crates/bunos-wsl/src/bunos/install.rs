// SPDX-License-Identifier: GPL-3.0-only
//! One-click install of Bun OS on WSL: verify the artifacts against the manifest, import the
//! rootfs, point `.wslconfig` at the Bun OS kernel (keeping a backup), and restart the WSL VM.
//!
//! `build_plan` is pure (tested on any OS); `execute` runs a plan through `WslCommandExecutor`
//! and the filesystem, so tests use the mock executor and a temp directory.

use super::{ini, manifest::*, DEFAULT_DISTRO_NAME};
use crate::wsl::executor::WslCommandExecutor;
use crate::wsl::WslError;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct InstallRequest {
    pub distro_name: String,
    /// Directory the distro's VHDX is created in (`wsl --import <name> <dir> <tar>`).
    pub install_dir: String,
    /// Directory holding the downloaded artifacts (names from the manifest).
    pub artifact_dir: PathBuf,
    pub use_kernel: bool,
    pub make_default: bool,
}

impl InstallRequest {
    pub fn new(install_dir: &str, artifact_dir: &Path) -> Self {
        Self {
            distro_name: DEFAULT_DISTRO_NAME.into(),
            install_dir: install_dir.into(),
            artifact_dir: artifact_dir.into(),
            use_kernel: true,
            make_default: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "step", rename_all = "kebab-case")]
pub enum Step {
    Verify { artifact: String, sha256: String },
    Import { name: String, location: String, tarball: String },
    WriteWslConfig { path: PathBuf, content: String },
    SetDefault { name: String },
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InstallPlan {
    pub steps: Vec<Step>,
}

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("the manifest has no {0:?} artifact")]
    MissingArtifact(ArtifactKind),
    #[error("invalid distro name {0:?}")]
    BadName(String),
    #[error(transparent)]
    Manifest(#[from] ManifestError),
    #[error(transparent)]
    Wsl(#[from] WslError),
    #[error("wsl.exe failed during {step}: {detail}")]
    Command { step: &'static str, detail: String },
    #[error("io: {0}")]
    Io(String),
}

fn valid_distro_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 64 && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Build the plan. `wslconfig` is the current text of `%USERPROFILE%\.wslconfig` (empty if absent).
pub fn build_plan(
    m: &Manifest,
    req: &InstallRequest,
    wslconfig_path: &Path,
    wslconfig: &str,
) -> Result<InstallPlan, InstallError> {
    if !valid_distro_name(&req.distro_name) {
        return Err(InstallError::BadName(req.distro_name.clone()));
    }
    m.validate()?;
    let rootfs = m.artifact(ArtifactKind::Rootfs).ok_or(InstallError::MissingArtifact(ArtifactKind::Rootfs))?;
    let mut steps = vec![Step::Verify { artifact: rootfs.name.clone(), sha256: rootfs.sha256.clone() }];
    let mut config = wslconfig.to_string();
    let mut config_changed = false;
    if req.use_kernel {
        let kernel = m.artifact(ArtifactKind::Kernel).ok_or(InstallError::MissingArtifact(ArtifactKind::Kernel))?;
        steps.push(Step::Verify { artifact: kernel.name.clone(), sha256: kernel.sha256.clone() });
        config = ini::set(&config, "wsl2", "kernel", &ini::escape_windows_path(&req.artifact_dir.join(&kernel.name).to_string_lossy()));
        if let Some(mods) = m.artifact(ArtifactKind::KernelModules) {
            steps.push(Step::Verify { artifact: mods.name.clone(), sha256: mods.sha256.clone() });
            config = ini::set(&config, "wsl2", "kernelModules", &ini::escape_windows_path(&req.artifact_dir.join(&mods.name).to_string_lossy()));
        }
        config_changed = config != wslconfig;
    }
    steps.push(Step::Import {
        name: req.distro_name.clone(),
        location: req.install_dir.clone(),
        tarball: req.artifact_dir.join(&rootfs.name).to_string_lossy().into_owned(),
    });
    if req.make_default {
        steps.push(Step::SetDefault { name: req.distro_name.clone() });
    }
    if config_changed {
        steps.push(Step::WriteWslConfig { path: wslconfig_path.to_path_buf(), content: config });
        // The kernel is read when the VM boots.
        steps.push(Step::Shutdown);
    }
    Ok(InstallPlan { steps })
}

fn command_ok(step: &'static str, out: crate::wsl::executor::CommandOutput) -> Result<(), InstallError> {
    if out.success { Ok(()) } else { Err(InstallError::Command { step, detail: out.stderr }) }
}

/// Run a plan. All `Verify` steps come first in a plan, so nothing is imported or written when an
/// artifact is missing or its digest differs. `progress` receives one line per step.
pub fn execute(
    plan: &InstallPlan,
    m: &Manifest,
    artifact_dir: &Path,
    exec: &dyn WslCommandExecutor,
    progress: &mut dyn FnMut(&str),
) -> Result<(), InstallError> {
    for step in &plan.steps {
        match step {
            Step::Verify { artifact, .. } => {
                progress(&format!("verify {artifact}"));
                let a = m.artifacts.iter().find(|a| &a.name == artifact).ok_or_else(|| ManifestError::BadName(artifact.clone()))?;
                verify_artifact(&artifact_dir.join(&a.name), a)?;
            }
            Step::Import { name, location, tarball } => {
                progress(&format!("import {name}"));
                std::fs::create_dir_all(location).map_err(|e| InstallError::Io(e.to_string()))?;
                command_ok("import", exec.import(name, location, tarball, Some(2))?)?;
            }
            Step::SetDefault { name } => {
                progress(&format!("set default {name}"));
                command_ok("set-default", exec.set_default(name)?)?;
            }
            Step::WriteWslConfig { path, content } => {
                progress(&format!("write {}", path.display()));
                if path.exists() {
                    let backup = path.with_file_name(".wslconfig.bunos-backup");
                    if !backup.exists() {
                        std::fs::copy(path, &backup).map_err(|e| InstallError::Io(e.to_string()))?;
                    }
                }
                std::fs::write(path, content).map_err(|e| InstallError::Io(e.to_string()))?;
            }
            Step::Shutdown => {
                progress("wsl --shutdown");
                command_ok("shutdown", exec.shutdown()?)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wsl::executor::MockWslExecutor;

    const SHA_ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn manifest(with_modules: bool) -> Manifest {
        let mut artifacts = vec![
            Artifact { kind: ArtifactKind::Rootfs, name: "bunos-wsl.tar.gz".into(), version: "1".into(), url: "https://x.test/r".into(), sha256: SHA_ABC.into(), size: Some(3) },
            Artifact { kind: ArtifactKind::Kernel, name: "bzImage".into(), version: "7.3".into(), url: "https://x.test/k".into(), sha256: SHA_ABC.into(), size: Some(3) },
        ];
        if with_modules {
            artifacts.push(Artifact { kind: ArtifactKind::KernelModules, name: "modules.vhdx".into(), version: "7.3".into(), url: "https://x.test/m".into(), sha256: SHA_ABC.into(), size: Some(3) });
        }
        Manifest { schema: 1, release: "t".into(), artifacts }
    }

    fn dir_with_artifacts() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        for f in ["bunos-wsl.tar.gz", "bzImage", "modules.vhdx"] {
            std::fs::write(d.path().join(f), b"abc").unwrap();
        }
        d
    }

    #[test]
    fn plan_orders_verify_before_any_mutation_and_sets_the_kernel() {
        let d = dir_with_artifacts();
        let req = InstallRequest::new("C:\\wsl\\bunos", d.path());
        let plan = build_plan(&manifest(true), &req, Path::new("C:\\u\\.wslconfig"), "[wsl2]\nmemory=8GB\n").unwrap();
        let kinds: Vec<&str> = plan.steps.iter().map(|s| match s {
            Step::Verify { .. } => "verify", Step::Import { .. } => "import", Step::WriteWslConfig { .. } => "write",
            Step::SetDefault { .. } => "default", Step::Shutdown => "shutdown",
        }).collect();
        assert_eq!(kinds, ["verify", "verify", "verify", "import", "write", "shutdown"]);
        let Step::WriteWslConfig { content, .. } = &plan.steps[4] else { panic!() };
        assert!(content.contains("memory=8GB"));
        assert!(content.contains("kernel="));
        assert!(content.contains("kernelModules="));
    }

    #[test]
    fn no_kernel_means_no_config_write_and_no_shutdown() {
        let d = dir_with_artifacts();
        let mut req = InstallRequest::new("C:\\wsl\\bunos", d.path());
        req.use_kernel = false;
        req.make_default = true;
        let plan = build_plan(&manifest(false), &req, Path::new("x"), "").unwrap();
        assert_eq!(plan.steps.len(), 3);
        assert!(matches!(plan.steps[2], Step::SetDefault { .. }));
    }

    #[test]
    fn rejects_bad_names_and_missing_artifacts() {
        let d = dir_with_artifacts();
        let mut req = InstallRequest::new("C:\\wsl", d.path());
        req.distro_name = "bad name; rm".into();
        assert!(matches!(build_plan(&manifest(false), &req, Path::new("x"), ""), Err(InstallError::BadName(_))));
        let mut m = manifest(false);
        m.artifacts.retain(|a| a.kind != ArtifactKind::Kernel);
        let req = InstallRequest::new("C:\\wsl", d.path());
        assert!(matches!(build_plan(&m, &req, Path::new("x"), ""), Err(InstallError::MissingArtifact(ArtifactKind::Kernel))));
    }

    #[test]
    fn execute_imports_writes_config_with_backup_and_registers_in_the_mock() {
        let d = dir_with_artifacts();
        let work = tempfile::tempdir().unwrap();
        let cfg = work.path().join(".wslconfig");
        std::fs::write(&cfg, "[wsl2]\nmemory=8GB\n").unwrap();
        let mut req = InstallRequest::new(work.path().join("vhd").to_str().unwrap(), d.path());
        req.make_default = true;
        let m = manifest(true);
        let plan = build_plan(&m, &req, &cfg, "[wsl2]\nmemory=8GB\n").unwrap();
        let exec = MockWslExecutor::new();
        let mut log = Vec::new();
        execute(&plan, &m, d.path(), &exec, &mut |l| log.push(l.to_string())).unwrap();
        assert!(log.iter().any(|l| l.starts_with("import bunos")));
        assert!(std::fs::read_to_string(&cfg).unwrap().contains("kernel="));
        assert_eq!(std::fs::read_to_string(work.path().join(".wslconfig.bunos-backup")).unwrap(), "[wsl2]\nmemory=8GB\n");
        let listed = exec.list_verbose().unwrap().stdout;
        assert!(listed.contains("bunos"), "{listed}");
    }

    #[test]
    fn corrupted_artifact_stops_before_import_or_config_write() {
        let d = dir_with_artifacts();
        std::fs::write(d.path().join("bzImage"), b"tampered").unwrap();
        let work = tempfile::tempdir().unwrap();
        let cfg = work.path().join(".wslconfig");
        let req = InstallRequest::new(work.path().join("vhd").to_str().unwrap(), d.path());
        let m = manifest(false);
        let plan = build_plan(&m, &req, &cfg, "").unwrap();
        let exec = MockWslExecutor::new();
        let err = execute(&plan, &m, d.path(), &exec, &mut |_| {}).unwrap_err();
        assert!(matches!(err, InstallError::Manifest(ManifestError::Mismatch { .. })));
        assert!(!cfg.exists());
        assert!(!exec.list_verbose().unwrap().stdout.contains("bunos"));
    }
}
