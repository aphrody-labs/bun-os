// SPDX-License-Identifier: Apache-2.0
//! Host-independent contracts for ecosystem adapters. Raw versions are kept:
//! Debian, PEP 440 and NuGet must never silently use npm version semantics.

use std::cmp::Ordering;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VersionScheme {
    Semver,
    Pep440,
    Debian,
    Apk,
    Alpm,
    Nuget,
    Vcpkg,
    /// Existing loose version semantics used by Bun's winget adapter.
    SystemLoose,
}

/// Source-specific comparison and constraint matching over preserved text.
/// Invalid syntax is an error, not a wildcard or an automatically coerced version.
pub trait Version {
    type Error;

    fn scheme(&self) -> VersionScheme;
    fn compare(&self, left: &str, right: &str) -> Result<Ordering, Self::Error>;
    fn satisfies(&self, version: &str, requirement: &str) -> Result<bool, Self::Error>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dependency {
    /// Stable ecosystem identity: npm, cargo, pypi, nuget, vcpkg, apk, deb, ...
    pub source: String,
    pub name: String,
    pub requirement: String,
    pub optional: bool,
    /// Original ecosystem expression, evaluated by its adapter, not the host OS.
    pub target: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackageVersion {
    pub name: String,
    pub version: String,
    pub scheme: VersionScheme,
    pub dependencies: Vec<Dependency>,
    /// Content URL or repository tree reference. Fetching belongs to the host.
    pub artifact: Option<String>,
    /// Original upstream integrity string, including algorithm and encoding.
    /// Absence must not be treated as successful signature/integrity verification.
    pub integrity: Option<String>,
    pub withdrawn: bool,
}

/// A parsed immutable index view, independent of HTTP and the host filesystem.
pub trait Index {
    fn source(&self) -> &str;
    fn packages(&self) -> &[PackageVersion];
}

/// Parser adapter accepts already-fetched bytes and returns an index.
/// Implementations preserve dependency constraints and source-specific versions.
pub trait Source {
    type Error;
    type Index: Index;
    type Versions: Version;

    fn id(&self) -> &str;
    fn versions(&self) -> &Self::Versions;
    fn parse_index(&self, package: &str, bytes: &[u8]) -> Result<Self::Index, Self::Error>;
}
