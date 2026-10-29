// SPDX-License-Identifier: Apache-2.0
//! Pure index decoders. The raw record remains available so adapters do not
//! discard peer dependencies, features, framework groups or platform markers.
use crate::ecosystem_versions::{NpmVersions, NugetVersions};
use crate::{Dependency, Index, PackageVersion, Source, VersionScheme};
use serde_json::Value;
use std::{collections::BTreeMap, fmt};

#[derive(Debug)]
pub struct ParseError(pub String);
impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ParseError {}
impl From<serde_json::Error> for ParseError {
    fn from(e: serde_json::Error) -> Self {
        Self(e.to_string())
    }
}

#[derive(Clone, Debug)]
pub struct RegistryIndex {
    pub ecosystem: String,
    pub packages: Vec<PackageVersion>,
    /// Original records keyed by original version, including unsupported fields.
    pub records: BTreeMap<String, Value>,
    pub metadata: Value,
}
impl Index for RegistryIndex {
    fn source(&self) -> &str {
        &self.ecosystem
    }
    fn packages(&self) -> &[PackageVersion] {
        &self.packages
    }
}
fn required<'a>(v: &'a Value, field: &str) -> Result<&'a str, ParseError> {
    v.get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| ParseError(format!("missing string {field}")))
}
fn index(ecosystem: &str, metadata: Value) -> RegistryIndex {
    RegistryIndex {
        ecosystem: ecosystem.into(),
        packages: Vec::new(),
        records: BTreeMap::new(),
        metadata,
    }
}
fn insert(
    out: &mut RegistryIndex,
    package: PackageVersion,
    record: Value,
) -> Result<(), ParseError> {
    if out
        .records
        .insert(package.version.clone(), record)
        .is_some()
    {
        return Err(ParseError(format!("duplicate version {}", package.version)));
    }
    out.packages.push(package);
    Ok(())
}

/// Decode npm's full or abbreviated packument. Optional dependencies override
/// normal dependencies; peers remain in raw records and are not install edges.
pub fn npm_packument(package: &str, bytes: &[u8]) -> Result<RegistryIndex, ParseError> {
    let document: Value = serde_json::from_slice(bytes)?;
    let versions = document
        .get("versions")
        .and_then(Value::as_object)
        .ok_or_else(|| ParseError("missing versions object".into()))?;
    let mut out = index("npm", document.clone());
    for (version, record) in versions {
        if record
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| name != package)
            || record
                .get("version")
                .and_then(Value::as_str)
                .is_some_and(|value| value != version)
        {
            return Err(ParseError("npm package identity mismatch".into()));
        }
        let mut deps = BTreeMap::new();
        for (field, optional) in [("dependencies", false), ("optionalDependencies", true)] {
            if let Some(values) = record.get(field) {
                let values = values
                    .as_object()
                    .ok_or_else(|| ParseError(format!("invalid {field}")))?;
                for (name, requirement) in values {
                    let requirement = requirement
                        .as_str()
                        .ok_or_else(|| ParseError("non-string dependency".into()))?;
                    deps.insert(
                        name.clone(),
                        Dependency {
                            source: "npm".into(),
                            name: name.clone(),
                            requirement: requirement.into(),
                            optional,
                            target: None,
                        },
                    );
                }
            }
        }
        insert(
            &mut out,
            PackageVersion {
                name: package.into(),
                version: version.clone(),
                scheme: VersionScheme::Semver,
                dependencies: deps.into_values().collect(),
                artifact: record
                    .pointer("/dist/tarball")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                integrity: record
                    .pointer("/dist/integrity")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| {
                        record
                            .pointer("/dist/shasum")
                            .and_then(Value::as_str)
                            .map(|s| format!("sha1:{s}"))
                    }),
                withdrawn: false,
            },
            record.clone(),
        )?;
    }
    Ok(out)
}

/// Decode newline-delimited crates.io sparse records. Rename and dependency
/// kind/features remain in each original record; target expressions are raw.
pub fn cargo_sparse(package: &str, bytes: &[u8]) -> Result<RegistryIndex, ParseError> {
    let text = std::str::from_utf8(bytes).map_err(|e| ParseError(e.to_string()))?;
    let mut out = index("cargo", Value::Null);
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let record: Value = serde_json::from_str(line)?;
        if required(&record, "name")? != package {
            return Err(ParseError("cargo package identity mismatch".into()));
        }
        let version = required(&record, "vers")?.to_owned();
        let dependencies = record
            .get("deps")
            .and_then(Value::as_array)
            .ok_or_else(|| ParseError("missing deps array".into()))?
            .iter()
            .map(|dep| {
                Ok(Dependency {
                    source: dep
                        .get("registry")
                        .and_then(Value::as_str)
                        .unwrap_or("cargo")
                        .into(),
                    name: dep
                        .get("package")
                        .and_then(Value::as_str)
                        .unwrap_or(required(dep, "name")?)
                        .into(),
                    requirement: required(dep, "req")?.into(),
                    optional: dep
                        .get("optional")
                        .and_then(Value::as_bool)
                        .ok_or_else(|| ParseError("missing optional bool".into()))?,
                    target: dep.get("target").and_then(Value::as_str).map(str::to_owned),
                })
            })
            .collect::<Result<Vec<_>, ParseError>>()?;
        let checksum = required(&record, "cksum")?;
        if checksum.len() != 64 || !checksum.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(ParseError("invalid cargo SHA256 checksum".into()));
        }
        let withdrawn = record
            .get("yanked")
            .and_then(Value::as_bool)
            .ok_or_else(|| ParseError("missing yanked bool".into()))?;
        insert(
            &mut out,
            PackageVersion {
                name: package.into(),
                version,
                scheme: VersionScheme::Semver,
                dependencies,
                artifact: None,
                integrity: Some(format!("sha256:{checksum}")),
                withdrawn,
            },
            record,
        )?;
    }
    Ok(out)
}

/// Flat-container indexes contain no dependencies or hashes. Those must be
/// supplied later from the nuspec/package metadata, never guessed here.
pub fn nuget_flatcontainer(package: &str, bytes: &[u8]) -> Result<RegistryIndex, ParseError> {
    let record: Value = serde_json::from_slice(bytes)?;
    let versions = record
        .get("versions")
        .and_then(Value::as_array)
        .ok_or_else(|| ParseError("missing versions array".into()))?;
    let mut out = index("nuget", record.clone());
    for value in versions {
        let version = value
            .as_str()
            .ok_or_else(|| ParseError("non-string NuGet version".into()))?;
        insert(
            &mut out,
            PackageVersion {
                name: package.into(),
                version: version.into(),
                scheme: VersionScheme::Nuget,
                dependencies: Vec::new(),
                artifact: None,
                integrity: None,
                withdrawn: false,
            },
            value.clone(),
        )?;
    }
    Ok(out)
}

/// vcpkg versions JSON uses several distinct schemes and a port revision.
/// Preserve the scheme in the original record and encode revision as #N.
pub fn vcpkg_versions(package: &str, bytes: &[u8]) -> Result<RegistryIndex, ParseError> {
    let document: Value = serde_json::from_slice(bytes)?;
    let records = document
        .get("versions")
        .and_then(Value::as_array)
        .ok_or_else(|| ParseError("missing versions array".into()))?;
    let mut out = index("vcpkg", document.clone());
    for record in records {
        let schemes = [
            "version",
            "version-semver",
            "version-date",
            "version-string",
        ];
        let present: Vec<_> = schemes
            .into_iter()
            .filter(|key| record.get(key).is_some())
            .collect();
        if present.len() != 1 {
            return Err(ParseError(
                "vcpkg record needs exactly one version scheme".into(),
            ));
        }
        let version = required(record, present[0])?;
        let port = match record.get("port-version") {
            None => 0,
            Some(value) => value
                .as_u64()
                .ok_or_else(|| ParseError("invalid port-version".into()))?,
        };
        insert(
            &mut out,
            PackageVersion {
                name: package.into(),
                version: format!("{version}#{port}"),
                scheme: VersionScheme::Vcpkg,
                dependencies: Vec::new(),
                artifact: Some(required(record, "git-tree")?.into()),
                integrity: None,
                withdrawn: false,
            },
            record.clone(),
        )?;
    }
    Ok(out)
}

pub fn vcpkg_baseline(bytes: &[u8]) -> Result<BTreeMap<String, (String, u64)>, ParseError> {
    let document: Value = serde_json::from_slice(bytes)?;
    let entries = document
        .get("default")
        .and_then(Value::as_object)
        .ok_or_else(|| ParseError("missing default baseline".into()))?;
    entries
        .iter()
        .map(|(name, entry)| {
            Ok((
                name.clone(),
                (
                    required(entry, "baseline")?.into(),
                    entry
                        .get("port-version")
                        .and_then(Value::as_u64)
                        .ok_or_else(|| ParseError("missing port-version".into()))?,
                ),
            ))
        })
        .collect()
}

/// PEP 691 simple JSON returns distribution files, not per-release metadata.
/// Keep every filename/hash/requires-python/yanked/core-metadata field intact.
/// Resolving filenames to PEP 440 releases belongs to the distribution parser.
pub fn pypi_simple_json(bytes: &[u8]) -> Result<Value, ParseError> {
    let document: Value = serde_json::from_slice(bytes)?;
    required(&document, "name")?;
    let files = document
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| ParseError("missing files array".into()))?;
    for file in files {
        required(file, "filename")?;
        required(file, "url")?;
        if !file.get("hashes").is_some_and(Value::is_object) {
            return Err(ParseError("missing hashes object".into()));
        }
    }
    Ok(document)
}

#[derive(Clone, Copy, Debug, Default)]
pub struct NpmSource(pub NpmVersions);
impl Source for NpmSource {
    type Error = ParseError;
    type Index = RegistryIndex;
    type Versions = NpmVersions;
    fn id(&self) -> &str {
        "npm"
    }
    fn versions(&self) -> &Self::Versions {
        &self.0
    }
    fn parse_index(&self, package: &str, bytes: &[u8]) -> Result<Self::Index, Self::Error> {
        npm_packument(package, bytes)
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct NugetSource(pub NugetVersions);
impl Source for NugetSource {
    type Error = ParseError;
    type Index = RegistryIndex;
    type Versions = NugetVersions;
    fn id(&self) -> &str {
        "nuget"
    }
    fn versions(&self) -> &Self::Versions {
        &self.0
    }
    fn parse_index(&self, package: &str, bytes: &[u8]) -> Result<Self::Index, Self::Error> {
        nuget_flatcontainer(package, bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Version, ecosystem_versions::Pep440Versions};

    #[test]
    fn npm_optional_overrides_regular_and_peers_survive() {
        let index = npm_packument("demo", br#"{"dist-tags":{"latest":"1.0.0"},"versions":{"1.0.0":{"name":"demo","version":"1.0.0","dependencies":{"dep":"^1"},"optionalDependencies":{"dep":"^2"},"peerDependencies":{"react":">=18"},"os":["linux"],"dist":{"integrity":"sha512-abcd","tarball":"https://example.test/demo.tgz"}}}}"#).unwrap();
        assert!(index.packages[0].dependencies[0].optional);
        assert_eq!(index.packages[0].dependencies[0].requirement, "^2");
        assert_eq!(index.records["1.0.0"]["peerDependencies"]["react"], ">=18");
        assert_eq!(index.packages[0].integrity.as_deref(), Some("sha512-abcd"));
    }

    #[test]
    fn cargo_retains_renames_features_and_target() {
        let index = cargo_sparse("demo", br#"{"name":"demo","vers":"1.0.0","deps":[{"name":"alias","package":"real","req":"^2","optional":true,"target":"cfg(windows)","kind":"build","features":["f"],"default_features":false}],"cksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","yanked":true,"features":{"x":["alias/f"]}}"#).unwrap();
        assert_eq!(index.packages[0].dependencies[0].name, "real");
        assert_eq!(
            index.packages[0].dependencies[0].target.as_deref(),
            Some("cfg(windows)")
        );
        assert!(index.packages[0].withdrawn);
        assert_eq!(index.records["1.0.0"]["deps"][0]["kind"], "build");
        assert!(cargo_sparse("other", br#"{"name":"demo"}"#).is_err());
    }

    #[test]
    fn sparse_and_flat_metadata_do_not_invent_hashes() {
        let index =
            nuget_flatcontainer("demo", br#"{"versions":["1.2.3.4","2.0.0-Preview"]}"#).unwrap();
        assert_eq!(index.packages[0].version, "1.2.3.4");
        assert!(index.packages[0].integrity.is_none());
        assert!(nuget_flatcontainer("demo", br#"{"versions":["1","1"]}"#).is_err());
        assert!(
            NugetSource::default()
                .versions()
                .satisfies("1", "*")
                .is_err()
        );
        assert!(
            NugetSource::default()
                .versions()
                .satisfies("1.2.3.4", "[1.2,2)")
                .unwrap()
        );
    }

    #[test]
    fn vcpkg_port_revisions_and_scheme_preserved() {
        let index = vcpkg_versions(
            "demo",
            br#"{"versions":[{"version-date":"2025-01-01","port-version":2,"git-tree":"tree"}]}"#,
        )
        .unwrap();
        assert_eq!(index.packages[0].version, "2025-01-01#2");
        assert_eq!(index.records["2025-01-01#2"]["version-date"], "2025-01-01");
        assert!(
            vcpkg_versions(
                "demo",
                br#"{"versions":[{"version":"1","version-string":"one","git-tree":"tree"}]}"#
            )
            .is_err()
        );
    }

    #[test]
    fn pypi_preserves_yanked_reason_and_requires_python() {
        let value = pypi_simple_json(br#"{"meta":{"api-version":"1.0"},"name":"demo","files":[{"filename":"demo-1.0.tar.gz","url":"./demo-1.0.tar.gz","hashes":{"sha256":"abc"},"requires-python":">=3.10","yanked":"security","core-metadata":true}]}"#).unwrap();
        assert_eq!(value["files"][0]["yanked"], "security");
        assert_eq!(value["files"][0]["requires-python"], ">=3.10");
    }

    #[test]
    fn npm_and_python_use_distinct_native_engines() {
        assert!(NpmVersions.satisfies("1.4.0", "^1.2.0 || ^2.0.0").unwrap());
        assert!(!NpmVersions.satisfies("1.4.0-beta.1", "^1.2.0").unwrap());
        assert_eq!(
            Pep440Versions.compare("1!1.0", "2.0").unwrap(),
            std::cmp::Ordering::Greater
        );
        assert!(Pep440Versions.satisfies("1.0+local", "==1.0").unwrap());
        assert!(Pep440Versions.satisfies("1.0", "^1").is_err());
    }
}
