// SPDX-License-Identifier: GPL-3.0-only
//! Release manifest of the Bun OS WSL artifacts (rootfs, kernel, kernel modules, WSLg system
//! distro) with sha256 checksums. The manifest is produced from the CI artifact directory by
//! `bunos-wsl-cli manifest <dir>`; the installer refuses any file whose digest differs.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

pub const MANIFEST_SCHEMA: u32 = 1;
/// Where the manifest of the latest published Bun OS WSL release lives.
pub const DEFAULT_MANIFEST_URL: &str =
    "https://github.com/aphrody-labs/bun-os/releases/download/bunos-wsl-latest/bunos-wsl-manifest.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactKind {
    /// `bunos-wsl.tar.gz` / `.wsl`, imported with `wsl --import`.
    Rootfs,
    /// `bzImage` of the Bun OS WSL kernel (`.wslconfig` `kernel=`).
    Kernel,
    /// `modules.vhdx` (`.wslconfig` `kernelModules=`).
    KernelModules,
    /// Bun OS WSLg system distro build (aphrody-labs/wslg).
    WslgSystem,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub kind: ArtifactKind,
    /// File name on disk (no directory part).
    pub name: String,
    /// Component version (kernel release, WSLg tag, image date).
    pub version: String,
    pub url: String,
    /// Lowercase hex sha256 of the file.
    pub sha256: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema: u32,
    pub release: String,
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ManifestError {
    #[error("manifest is not valid JSON: {0}")]
    Json(String),
    #[error("unsupported manifest schema {0} (expected {MANIFEST_SCHEMA})")]
    Schema(u32),
    #[error("artifact {0}: sha256 must be 64 lowercase hex digits")]
    BadDigest(String),
    #[error("artifact {0}: url must be https")]
    BadUrl(String),
    #[error("artifact name {0:?} must be a plain file name")]
    BadName(String),
    #[error("artifact kind {0:?} appears more than once")]
    Duplicate(ArtifactKind),
    #[error("checksum mismatch for {name}: expected {expected}, got {actual}")]
    Mismatch { name: String, expected: String, actual: String },
    #[error("io: {0}")]
    Io(String),
}

impl Manifest {
    pub fn parse(json: &str) -> Result<Self, ManifestError> {
        let m: Manifest = serde_json::from_str(json).map_err(|e| ManifestError::Json(e.to_string()))?;
        m.validate()?;
        Ok(m)
    }

    pub fn validate(&self) -> Result<(), ManifestError> {
        if self.schema != MANIFEST_SCHEMA {
            return Err(ManifestError::Schema(self.schema));
        }
        let mut seen = std::collections::HashSet::new();
        for a in &self.artifacts {
            if a.name.is_empty() || a.name.contains(['/', '\\']) || a.name == "." || a.name == ".." {
                return Err(ManifestError::BadName(a.name.clone()));
            }
            if !is_sha256_hex(&a.sha256) {
                return Err(ManifestError::BadDigest(a.name.clone()));
            }
            if !a.url.starts_with("https://") {
                return Err(ManifestError::BadUrl(a.name.clone()));
            }
            if !seen.insert(a.kind) {
                return Err(ManifestError::Duplicate(a.kind));
            }
        }
        Ok(())
    }

    pub fn artifact(&self, kind: ArtifactKind) -> Option<&Artifact> {
        self.artifacts.iter().find(|a| a.kind == kind)
    }
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Streaming sha256 of a file, lowercase hex.
pub fn sha256_file(path: &Path) -> Result<String, ManifestError> {
    let mut f = std::fs::File::open(path).map_err(|e| ManifestError::Io(format!("{}: {e}", path.display())))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| ManifestError::Io(e.to_string()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Verify `path` against `artifact.sha256` (and `size` when the manifest records it).
pub fn verify_artifact(path: &Path, artifact: &Artifact) -> Result<(), ManifestError> {
    if let Some(size) = artifact.size {
        let actual = std::fs::metadata(path).map_err(|e| ManifestError::Io(e.to_string()))?.len();
        if actual != size {
            return Err(ManifestError::Mismatch {
                name: artifact.name.clone(),
                expected: format!("{size} bytes"),
                actual: format!("{actual} bytes"),
            });
        }
    }
    let actual = sha256_file(path)?;
    if actual != artifact.sha256 {
        return Err(ManifestError::Mismatch { name: artifact.name.clone(), expected: artifact.sha256.clone(), actual });
    }
    Ok(())
}

/// First digest in a `sha256sum`-style file (`<hex>  <name>`), as written by `build-rootfs.sh`.
pub fn parse_sha256_file(text: &str) -> Option<String> {
    let first = text.split_whitespace().next()?.to_ascii_lowercase();
    is_sha256_hex(&first).then_some(first)
}

/// Known CI output file names -> artifact kind.
fn kind_of_file(name: &str) -> Option<ArtifactKind> {
    match name {
        "bunos-wsl.tar.gz" | "bunos-wsl.wsl" => Some(ArtifactKind::Rootfs),
        "bzImage" => Some(ArtifactKind::Kernel),
        "modules.vhdx" => Some(ArtifactKind::KernelModules),
        "wslg-system.vhd" | "system.vhd" => Some(ArtifactKind::WslgSystem),
        _ => None,
    }
}

/// Build a manifest from a directory of CI outputs (`wsl-rootfs.yml`, `wsl-kernel.yml`, WSLg
/// build). `base_url` is the release download URL prefix the files will be uploaded under.
/// `versions` maps an artifact kind to its component version.
pub fn manifest_from_dir(
    dir: &Path,
    release: &str,
    base_url: &str,
    versions: &dyn Fn(ArtifactKind) -> String,
) -> Result<Manifest, ManifestError> {
    let mut artifacts = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| ManifestError::Io(format!("{}: {e}", dir.display())))?
        .filter_map(Result::ok)
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(kind) = kind_of_file(&name) else { continue };
        // `bunos-wsl.wsl` and `.tar.gz` are the same bytes: keep the first (tar.gz sorts later, so skip dup).
        if artifacts.iter().any(|a: &Artifact| a.kind == kind) {
            continue;
        }
        let sha256 = sha256_file(&e.path())?;
        let size = e.metadata().map(|m| m.len()).ok();
        artifacts.push(Artifact {
            kind,
            version: versions(kind),
            url: format!("{}/{}", base_url.trim_end_matches('/'), name),
            name,
            sha256,
            size,
        });
    }
    let m = Manifest { schema: MANIFEST_SCHEMA, release: release.to_string(), artifacts };
    m.validate()?;
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABC_SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn art(kind: ArtifactKind, name: &str) -> Artifact {
        Artifact { kind, name: name.into(), version: "1".into(), url: format!("https://x.test/{name}"), sha256: ABC_SHA.into(), size: Some(3) }
    }

    #[test]
    fn sha256_of_known_vector_and_verify() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bzImage");
        std::fs::write(&p, b"abc").unwrap();
        assert_eq!(sha256_file(&p).unwrap(), ABC_SHA);
        verify_artifact(&p, &art(ArtifactKind::Kernel, "bzImage")).unwrap();
        std::fs::write(&p, b"abd").unwrap();
        assert!(matches!(verify_artifact(&p, &art(ArtifactKind::Kernel, "bzImage")), Err(ManifestError::Mismatch { .. })));
    }

    #[test]
    fn size_mismatch_is_reported_before_hashing() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bzImage");
        std::fs::write(&p, b"abcd").unwrap();
        let e = verify_artifact(&p, &art(ArtifactKind::Kernel, "bzImage")).unwrap_err();
        assert!(e.to_string().contains("bytes"));
    }

    #[test]
    fn parse_validates_schema_digest_url_name_duplicates() {
        let ok = Manifest { schema: 1, release: "r".into(), artifacts: vec![art(ArtifactKind::Rootfs, "bunos-wsl.tar.gz")] };
        let json = serde_json::to_string(&ok).unwrap();
        assert_eq!(Manifest::parse(&json).unwrap(), ok);

        let mut bad = ok.clone();
        bad.schema = 2;
        assert_eq!(bad.validate(), Err(ManifestError::Schema(2)));
        let mut bad = ok.clone();
        bad.artifacts[0].sha256 = ABC_SHA.to_uppercase();
        assert!(matches!(bad.validate(), Err(ManifestError::BadDigest(_))));
        let mut bad = ok.clone();
        bad.artifacts[0].url = "http://x.test/a".into();
        assert!(matches!(bad.validate(), Err(ManifestError::BadUrl(_))));
        let mut bad = ok.clone();
        bad.artifacts[0].name = "../evil".into();
        assert!(matches!(bad.validate(), Err(ManifestError::BadName(_))));
        let mut bad = ok.clone();
        bad.artifacts.push(art(ArtifactKind::Rootfs, "other.tar.gz"));
        assert!(matches!(bad.validate(), Err(ManifestError::Duplicate(ArtifactKind::Rootfs))));
        assert!(matches!(Manifest::parse("{"), Err(ManifestError::Json(_))));
    }

    #[test]
    fn sha256_file_text_forms() {
        assert_eq!(parse_sha256_file(&format!("{ABC_SHA}  bunos-wsl.tar.gz\n")).as_deref(), Some(ABC_SHA));
        assert_eq!(parse_sha256_file("nothex  file"), None);
    }

    #[test]
    fn manifest_from_ci_output_dir() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("bzImage"), b"abc").unwrap();
        std::fs::write(dir.path().join("bunos-wsl.tar.gz"), b"abc").unwrap();
        std::fs::write(dir.path().join("bunos-wsl.wsl"), b"abc").unwrap();
        std::fs::write(dir.path().join("config"), b"ignored").unwrap();
        let m = manifest_from_dir(dir.path(), "bunos-wsl-test", "https://x.test/dl/", &|k| format!("{k:?}")).unwrap();
        assert_eq!(m.artifacts.len(), 2);
        let k = m.artifact(ArtifactKind::Kernel).unwrap();
        assert_eq!(k.url, "https://x.test/dl/bzImage");
        assert_eq!(k.sha256, ABC_SHA);
        assert_eq!(m.artifact(ArtifactKind::Rootfs).unwrap().name, "bunos-wsl.tar.gz");
    }
}
