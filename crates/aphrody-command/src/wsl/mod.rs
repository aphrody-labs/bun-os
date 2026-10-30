// SPDX-License-Identifier: Apache-2.0
//! Build workbench for the upstream WSL platform and the Aphrody OS guest.
//! Compilers remain owned by upstream; this library owns recipes and evidence.
pub mod cli;
mod recipes;
mod runner;
pub mod wslg;
pub use cli::cli_main;

use aphrody_proc::NoWindow as _;
pub use recipes::{Step, Target, plan};
pub use runner::build;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub name: String,
    pub url: String,
    pub revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

/// Signed third-party APT repository added to the guest; `fingerprint` pins its OpenPGP key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Repository {
    pub name: String,
    pub url: String,
    pub suite: String,
    pub components: String,
    pub fingerprint: String,
}

/// Guest package set; `toolchainManifests` are workspace JSON files whose `toolchain.apt` lists are installed too.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Distro {
    #[serde(default)]
    pub packages: Vec<String>,
    #[serde(default)]
    pub repositories: Vec<Repository>,
    #[serde(default)]
    pub toolchain_manifests: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub source_root: PathBuf,
    pub output_root: PathBuf,
    pub workspace: PathBuf,
    pub jobs: usize,
    pub timeout_seconds: u64,
    pub distribution: String,
    pub suite: String,
    pub mirror: String,
    pub sources: Vec<Source>,
    #[serde(default)]
    pub distro: Distro,
}

/// kernel.org stable tree pinned for the `mainline` target.
pub const MAINLINE_SOURCE: &str = "linux-stable";
const SOURCE_NAMES: [&str; 5] = [
    "WSL",
    "wslg",
    "WSL2-Linux-Kernel",
    "terminal",
    MAINLINE_SOURCE,
];

fn simple_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.+".contains(&b))
}
/// Windows executable `relative` to System32: on PATH when interop exposes it, else located with `wslpath`.
pub fn windows_executable(relative: &str) -> PathBuf {
    let name = Path::new(relative)
        .file_name()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(relative));
    let on_path = std::env::var_os("PATH")
        .is_some_and(|paths| std::env::split_paths(&paths).any(|dir| dir.join(&name).is_file()));
    if cfg!(windows) || on_path {
        return name;
    }
    match std::process::Command::new("wslpath")
        .no_window()
        .args(["-u", r"C:\Windows\System32"])
        .output()
    {
        Ok(out) if out.status.success() => {
            PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()).join(relative)
        }
        _ => name,
    }
}

impl Config {
    pub fn read(path: &Path) -> Result<Self> {
        // <workspace>/tools/config/os/wsl-build.json: the checkout is three levels above the file.
        let absolute = path.canonicalize()?;
        let workspace = absolute.ancestors().nth(3).ok_or_else(|| {
            Error::Invalid("config must live under <workspace>/tools/config/os".into())
        })?;
        Self::parse(&fs::read(path)?, workspace)
    }
    /// Parses a configuration whose roots may use `${workspace}`, `${home}` and `${data}`.
    pub fn parse(bytes: &[u8], workspace: &Path) -> Result<Self> {
        let mut config: Self = serde_json::from_slice(bytes)?;
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from);
        let data = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
            .or_else(|| home.as_ref().map(|home| home.join(".local/share")));
        for root in [
            &mut config.source_root,
            &mut config.output_root,
            &mut config.workspace,
        ] {
            let mut text = root
                .to_string_lossy()
                .replace("${workspace}", &workspace.to_string_lossy());
            for (token, value) in [("${home}", &home), ("${data}", &data)] {
                if text.contains(token) {
                    let value = value.as_ref().ok_or_else(|| {
                        Error::Invalid(format!("{token} is not available on this host"))
                    })?;
                    text = text.replace(token, &value.to_string_lossy());
                }
            }
            *root = PathBuf::from(text);
        }
        config.validate()?;
        Ok(config)
    }
    pub fn validate(&self) -> Result<()> {
        for path in [&self.source_root, &self.output_root, &self.workspace] {
            if !path.is_absolute()
                || path
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err(Error::Invalid(
                    "build roots must be absolute without ..".into(),
                ));
            }
        }
        if self.output_root == self.source_root
            || self.output_root == self.workspace
            || self.output_root.starts_with(&self.workspace)
        {
            return Err(Error::Invalid(
                "outputs must live outside the Aphrody checkout and source root itself".into(),
            ));
        }
        if !(1..=64).contains(&self.jobs) || !(1..=86400).contains(&self.timeout_seconds) {
            return Err(Error::Invalid(
                "jobs must be 1..64 and timeoutSeconds 1..86400".into(),
            ));
        }
        for value in [&self.distribution, &self.suite] {
            if value.is_empty()
                || value.len() > 64
                || !value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            {
                return Err(Error::Invalid(
                    "distribution and suite must be simple nonempty names".into(),
                ));
            }
        }
        if !self.mirror.starts_with("https://") {
            return Err(Error::Invalid("rootfs mirror must use HTTPS".into()));
        }
        if self.sources.len() != SOURCE_NAMES.len()
            || SOURCE_NAMES
                .iter()
                .any(|name| self.sources.iter().filter(|s| s.name == *name).count() != 1)
        {
            return Err(Error::Invalid(format!(
                "exactly the upstream source owners {} are required",
                SOURCE_NAMES.join(", ")
            )));
        }
        for source in &self.sources {
            if !is_revision(&source.revision) || !source.url.starts_with("https://") {
                return Err(Error::Invalid(
                    "sources need an HTTPS URL and full 40-digit Git revision".into(),
                ));
            }
            if source.tag.as_deref().is_some_and(|tag| !simple_name(tag)) {
                return Err(Error::Invalid("source tags must be simple names".into()));
            }
        }
        if self.distro.packages.iter().any(|p| !simple_name(p)) {
            return Err(Error::Invalid(
                "distro packages must be simple names".into(),
            ));
        }
        for repo in &self.distro.repositories {
            if !simple_name(&repo.name)
                || !simple_name(&repo.suite)
                || !repo.url.starts_with("https://")
                || repo.url.bytes().any(|b| b.is_ascii_whitespace())
                || repo.components.split(' ').any(|c| !simple_name(c))
                || repo.fingerprint.len() != 40
                || !repo.fingerprint.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err(Error::Invalid(format!(
                    "repository {} needs a simple name/suite/components, an HTTPS URL and a 40-digit key fingerprint",
                    repo.name
                )));
            }
        }
        if self.distro.toolchain_manifests.iter().any(|p| {
            p.is_absolute()
                || p.components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
        }) {
            return Err(Error::Invalid(
                "toolchain manifests must be workspace-relative without ..".into(),
            ));
        }
        Ok(())
    }
    pub fn script(&self, name: &str) -> PathBuf {
        self.workspace.join("scripts/aphrody/build/os").join(name)
    }
    pub fn source(&self, name: &str) -> Result<&Source> {
        self.sources
            .iter()
            .find(|s| s.name == name)
            .ok_or_else(|| Error::Invalid(format!("source {name} is not configured")))
    }
    /// Guest packages: the configured list followed by each toolchain manifest's `toolchain.apt`, deduplicated in order.
    pub fn distro_packages(&self) -> Result<Vec<String>> {
        let mut packages = self.distro.packages.clone();
        for manifest in &self.distro.toolchain_manifests {
            let path = self.workspace.join(manifest);
            let value: serde_json::Value = serde_json::from_slice(&fs::read(&path)?)?;
            let apt = value
                .pointer("/toolchain/apt")
                .and_then(|v| v.as_array())
                .ok_or_else(|| {
                    Error::Invalid(format!("{} has no toolchain.apt list", path.display()))
                })?;
            for name in apt {
                let name = name.as_str().filter(|n| simple_name(n)).ok_or_else(|| {
                    Error::Invalid(format!("{} lists an invalid package", path.display()))
                })?;
                packages.push(name.into());
            }
        }
        let mut seen = std::collections::BTreeSet::new();
        packages.retain(|p| seen.insert(p.clone()));
        Ok(packages)
    }
}

fn is_revision(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Newest stable release tag (`vX.Y` or `vX.Y.Z`, no `-rc`) in `git ls-remote --tags` output, with its peeled commit.
pub fn newest_stable_tag(ls_remote: &str) -> Option<(String, String)> {
    let mut tags = std::collections::BTreeMap::<String, (Option<String>, Option<String>)>::new();
    for line in ls_remote.lines() {
        let Some((sha, reference)) = line.split_once('\t') else {
            continue;
        };
        let Some(name) = reference.strip_prefix("refs/tags/") else {
            continue;
        };
        let (name, peeled) = match name.strip_suffix("^{}") {
            Some(n) => (n, true),
            None => (name, false),
        };
        if !is_revision(sha) {
            continue;
        }
        let entry = tags.entry(name.into()).or_default();
        if peeled {
            entry.1 = Some(sha.into());
        } else {
            entry.0 = Some(sha.into());
        }
    }
    let version = |tag: &str| -> Option<(u32, u32, u32)> {
        let mut parts = tag.strip_prefix('v')?.split('.');
        let parsed = (
            parts.next()?.parse().ok()?,
            parts.next()?.parse().ok()?,
            parts.next().map_or(Some(0), |p| p.parse().ok())?,
        );
        parts.next().is_none().then_some(parsed)
    };
    tags.into_iter()
        .filter_map(|(tag, (direct, peeled))| Some((version(&tag)?, tag, peeled.or(direct)?)))
        .max_by_key(|(v, _, _)| *v)
        .map(|(_, tag, commit)| (tag, commit))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestKernel {
    pub source: String,
    pub tag: String,
    pub revision: String,
    pub pinned_tag: Option<String>,
    pub pinned_revision: String,
    pub current: bool,
    pub applied: bool,
}

/// Resolves the newest kernel.org stable tag; with `apply`, rewrites only the pinned tag and revision in `config_path`.
pub fn latest_kernel(config: &Config, config_path: &Path, apply: bool) -> Result<LatestKernel> {
    let source = config.source(MAINLINE_SOURCE)?;
    let output = Command::new("git")
        .no_window()
        .args(["ls-remote", "--tags", &source.url, "refs/tags/v*"])
        .output()?;
    if !output.status.success() {
        return Err(Error::Invalid(format!(
            "git ls-remote {} failed",
            source.url
        )));
    }
    let (tag, revision) =
        newest_stable_tag(&String::from_utf8_lossy(&output.stdout)).ok_or_else(|| {
            Error::Invalid(format!("{} publishes no stable vX.Y[.Z] tag", source.url))
        })?;
    let current = revision == source.revision;
    let mut applied = false;
    if apply && !current {
        let text = fs::read_to_string(config_path)?;
        let old_tag = source.tag.as_deref().ok_or_else(|| {
            Error::Invalid(format!("{MAINLINE_SOURCE} needs a pinned tag to update"))
        })?;
        if text.matches(&source.revision).count() != 1
            || text.matches(&format!("\"{old_tag}\"")).count() != 1
        {
            return Err(Error::Invalid(
                "the pinned kernel tag and revision must each appear exactly once in the config"
                    .into(),
            ));
        }
        let updated = text
            .replace(&source.revision, &revision)
            .replace(&format!("\"{old_tag}\""), &format!("\"{tag}\""));
        let tmp = config_path.with_extension("json.new");
        fs::write(&tmp, updated)?;
        fs::rename(tmp, config_path)?;
        applied = true;
    }
    Ok(LatestKernel {
        source: source.url.clone(),
        tag,
        revision,
        pinned_tag: source.tag.clone(),
        pinned_revision: source.revision.clone(),
        current,
        applied,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    pub name: String,
    pub revision: String,
    pub expected_revision: String,
    pub clean: bool,
    pub matches: bool,
}

pub fn sources(config: &Config) -> Result<Vec<SourceState>> {
    config.validate()?;
    config
        .sources
        .iter()
        .map(|source| {
            let root = config.source_root.join(&source.name);
            let revision = git(&root, &["rev-parse", "HEAD"])?;
            let clean = git(&root, &["status", "--porcelain"])?.is_empty();
            Ok(SourceState {
                name: source.name.clone(),
                matches: revision == source.revision,
                revision,
                expected_revision: source.revision.clone(),
                clean,
            })
        })
        .collect()
}
fn git(path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .no_window()
        .arg("-C")
        .arg(path)
        .args(args)
        .output()?;
    if !output.status.success() {
        return Err(Error::Invalid(format!(
            "git {} failed at {}",
            args.join(" "),
            path.display()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub path: PathBuf,
    pub bytes: u64,
    pub sha256: String,
}
pub fn artifact(path: &Path) -> Result<Artifact> {
    use std::io::Read;
    let mut file = fs::File::open(path)?;
    let bytes = file.metadata()?.len();
    if bytes == 0 {
        return Err(Error::Invalid(format!(
            "empty artifact: {}",
            path.display()
        )));
    }
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(Artifact {
        path: path.into(),
        bytes,
        sha256: hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>(),
    })
}

pub fn expected_artifacts(config: &Config, target: Target) -> Vec<PathBuf> {
    let root = &config.output_root;
    match target {
        Target::Kernel => {
            vec![
                root.join("kernel/arch/x86/boot/bzImage"),
                root.join("kernel/modules.vhdx"),
            ]
        }
        Target::Mainline => {
            vec![
                root.join("mainline/arch/x86/boot/bzImage"),
                root.join("mainline/modules.vhdx"),
            ]
        }
        Target::Wslg => vec![root.join("wslg/system_x64.vhd")],
        Target::Wsl => vec![root.join("wsl/artifacts.json")],
        Target::Distro => vec![
            root.join(format!("distro/{}.wsl", config.distribution)),
            root.join("distro/packages.txt"),
        ],
    }
}

#[derive(Debug, Serialize)]
pub struct Dependency {
    pub command: String,
    pub available: bool,
}
pub fn doctor(config: &Config) -> Result<serde_json::Value> {
    let dependencies = [
        "git",
        "make",
        "gcc",
        "flex",
        "bison",
        "pahole",
        "bc",
        "cpio",
        "rsync",
        "qemu-img",
        "mke2fs",
        "podman",
        "go",
        "debootstrap",
        "gpg",
        "cargo",
        "rustc",
        "bindgen",
        "clang",
        "ld.lld",
        "wslpath",
    ]
    .into_iter()
    .map(|name| Dependency {
        command: name.into(),
        available: find_executable(name).is_some(),
    })
    .collect::<Vec<_>>();
    let source_state = sources(config);
    Ok(
        serde_json::json!({"dependencies":dependencies,"sources":source_state.as_ref().ok(),"sourceError":source_state.err().map(|e|e.to_string()),"outputRoot":config.output_root}),
    )
}
pub(crate) fn find_executable(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|dir| dir.join(name))
            .find(|p| p.is_file())
    })
}

pub fn import(config: &Config, install_dir: &Path) -> Result<()> {
    config.validate()?;
    let image = config
        .output_root
        .join(format!("distro/{}.wsl", config.distribution));
    artifact(&image)?;
    let windows_path = |path: &Path| -> Result<String> {
        if cfg!(windows) {
            return Ok(path.to_string_lossy().into_owned());
        }
        let out = Command::new("wslpath")
            .no_window()
            .arg("-w")
            .arg(path)
            .output()?;
        if !out.status.success() {
            return Err(Error::Invalid("wslpath failed".into()));
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().into())
    };
    let executable = windows_executable("wsl.exe");
    let status = Command::new(executable)
        .no_window()
        .args([
            "--import",
            &config.distribution,
            &windows_path(install_dir)?,
            &windows_path(&image)?,
            "--version",
            "2",
        ])
        .status()?;
    if !status.success() {
        return Err(Error::Invalid(
            "WSL import failed; existing distributions are never unregistered".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Config {
        Config::parse(
            include_bytes!("../../embedded/tools/aphrody/config/os/wsl-build.json"),
            &std::env::temp_dir().join("aphrody-workspace"),
        )
        .unwrap()
    }
    #[test]
    fn rejects_unsafe_roots_and_names() {
        let mut c = config();
        c.output_root = c.workspace.clone();
        assert!(c.validate().is_err());
        c = config();
        c.distribution = "../Ubuntu".into();
        assert!(c.validate().is_err());
        c = config();
        c.sources[0].revision = "main".into();
        assert!(c.validate().is_err());
    }
    #[test]
    fn picks_newest_stable_peeled_tag() {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let c = "c".repeat(40);
        let d = "d".repeat(40);
        let out = format!(
            "{a}\trefs/tags/v7.2.9\n{b}\trefs/tags/v7.2.9^{{}}\n{c}\trefs/tags/v7.10\n{d}\trefs/tags/v7.11-rc1\n{a}\trefs/tags/v6.18.55\n"
        );
        assert_eq!(newest_stable_tag(&out), Some(("v7.10".into(), c.clone())));
        assert_eq!(
            newest_stable_tag(&format!(
                "{a}\trefs/tags/v7.2.9\n{b}\trefs/tags/v7.2.9^{{}}\n"
            )),
            Some(("v7.2.9".into(), b))
        );
        assert_eq!(newest_stable_tag("garbage\n"), None);
    }
    #[test]
    fn distro_packages_merge_toolchain_manifests() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = config();
        c.workspace = dir.path().into();
        fs::write(
            dir.path().join("forge.json"),
            br#"{"toolchain":{"apt":["git","rustup","nasm"]}}"#,
        )
        .unwrap();
        c.distro.packages = vec!["rustup".into(), "cosmic-session".into()];
        c.distro.toolchain_manifests = vec!["forge.json".into()];
        assert_eq!(
            c.distro_packages().unwrap(),
            ["rustup", "cosmic-session", "git", "nasm"]
        );
        c.distro.repositories[0].fingerprint = "short".into();
        assert!(c.validate().is_err());
        c = config();
        c.sources.retain(|s| s.name != MAINLINE_SOURCE);
        assert!(c.validate().is_err());
    }
    #[test]
    fn mainline_plan_enables_rust_on_kernel_org_tree() {
        let c = config();
        let step = &plan(&c, Target::Mainline).unwrap()[0];
        assert!(step.args.iter().any(|a| a.ends_with(MAINLINE_SOURCE)));
        assert_eq!(step.args.last().unwrap(), "rust");
        let mut c = c;
        c.workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../apps/aphrody/crates/infra")
            .canonicalize()
            .unwrap();
        let distro = &plan(&c, Target::Distro).unwrap()[0];
        assert!(
            distro
                .args
                .iter()
                .any(|a| a.contains("cosmic-session") && a.contains("nasm"))
        );
        assert!(
            distro
                .args
                .iter()
                .any(|a| a.starts_with("pop-os|https://apt.pop-os.org/release|resolute|main|"))
        );
    }
    #[test]
    fn hashes_nonempty_artifacts_and_rejects_empty() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("artifact");
        fs::write(&p, b"abc").unwrap();
        assert_eq!(
            artifact(&p).unwrap().sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::write(p.clone(), []).unwrap();
        assert!(artifact(&p).is_err());
    }
}
