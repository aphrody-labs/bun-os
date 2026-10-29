// SPDX-License-Identifier: Apache-2.0
//! Maintained source-native version engines. PEP 440 prerelease environment
//! policy is resolved by the caller, separately from specifier membership.
use crate::{Version, VersionScheme};
use std::{cmp::Ordering, fmt, str::FromStr};

pub mod nuget;
pub use nuget::NugetVersions;

#[derive(Debug)]
pub struct VersionError(pub String);
impl fmt::Display for VersionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for VersionError {}
fn error(e: impl fmt::Display) -> VersionError {
    VersionError(e.to_string())
}

/// node-semver's npm caret, tilde, union, hyphen and prerelease semantics.
#[derive(Clone, Copy, Debug, Default)]
pub struct NpmVersions;
impl Version for NpmVersions {
    type Error = VersionError;
    fn scheme(&self) -> VersionScheme {
        VersionScheme::Semver
    }
    fn compare(&self, left: &str, right: &str) -> Result<Ordering, Self::Error> {
        Ok(node_semver::Version::parse(left)
            .map_err(error)?
            .cmp(&node_semver::Version::parse(right).map_err(error)?))
    }
    fn satisfies(&self, version: &str, requirement: &str) -> Result<bool, Self::Error> {
        let version = node_semver::Version::parse(version).map_err(error)?;
        let range = node_semver::Range::parse(requirement).map_err(error)?;
        Ok(range.satisfies(&version))
    }
}

/// PEP 440 epochs, release padding, pre/post/dev and local versions. This
/// evaluates specifier membership; prerelease candidate policy needs context.
#[derive(Clone, Copy, Debug, Default)]
pub struct Pep440Versions;
impl Version for Pep440Versions {
    type Error = VersionError;
    fn scheme(&self) -> VersionScheme {
        VersionScheme::Pep440
    }
    fn compare(&self, left: &str, right: &str) -> Result<Ordering, Self::Error> {
        Ok(pep440_rs::Version::from_str(left)
            .map_err(error)?
            .cmp(&pep440_rs::Version::from_str(right).map_err(error)?))
    }
    fn satisfies(&self, version: &str, requirement: &str) -> Result<bool, Self::Error> {
        let version = pep440_rs::Version::from_str(version).map_err(error)?;
        let specifiers = pep440_rs::VersionSpecifiers::from_str(requirement).map_err(error)?;
        Ok(specifiers.contains(&version))
    }
}

/// An explicit unsupported adapter prevents callers substituting semver for
/// NuGet's four-part/case-insensitive versions or vcpkg's multiple schemes.
#[derive(Clone, Copy, Debug)]
pub struct UnsupportedVersions(pub VersionScheme);
impl Version for UnsupportedVersions {
    type Error = VersionError;
    fn scheme(&self) -> VersionScheme {
        self.0
    }
    fn compare(&self, _left: &str, _right: &str) -> Result<Ordering, Self::Error> {
        Err(VersionError(format!(
            "comparison not implemented for {:?}",
            self.0
        )))
    }
    fn satisfies(&self, _version: &str, _requirement: &str) -> Result<bool, Self::Error> {
        Err(VersionError(format!(
            "constraint evaluation not implemented for {:?}",
            self.0
        )))
    }
}
