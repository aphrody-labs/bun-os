// SPDX-License-Identifier: Apache-2.0
// Copyright (c) .NET Foundation. All rights reserved.
// Rust adaptation of NuGet.Client NuGet.Versioning VersionComparer.cs and
// NuGetVersionFactory.cs @37a0aead4f19d3069d6a1dff94bc8cfe15b87004.
// Original license: Apache-2.0, https://github.com/NuGet/NuGet.Client/blob/dev/LICENSE.txt
//! NuGet's four-part versions and case-insensitive release ordering. Floating
//! ranges are explicitly unsupported; NuGet interval/exact/minimum ranges work.
use super::VersionError;
use crate::{Version, VersionScheme};
use std::cmp::Ordering;

#[derive(Debug)]
struct NugetVersion {
    numbers: [u32; 4],
    release: Vec<String>,
}
fn invalid(value: &str) -> VersionError {
    VersionError(format!("invalid NuGet version/range: {value}"))
}
fn valid_label(label: &str, leading_zero: bool) -> bool {
    !label.is_empty()
        && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && (leading_zero
            || label.len() == 1
            || !label.starts_with('0')
            || !label.bytes().all(|b| b.is_ascii_digit()))
}
impl NugetVersion {
    fn parse(value: &str) -> Result<Self, VersionError> {
        let text = value.trim();
        let (base, metadata) = text.split_once('+').map_or((text, None), |(a, b)| (a, Some(b)));
        if metadata.is_some_and(|m| !m.split('.').all(|s| valid_label(s, true))) {
            return Err(invalid(value));
        }
        let (core, release) = base.split_once('-').map_or((base, None), |(a, b)| (a, Some(b)));
        let segments: Vec<_> = core.split('.').collect();
        if segments.is_empty() || segments.len() > 4 {
            return Err(invalid(value));
        }
        let mut numbers = [0; 4];
        for (index, segment) in segments.into_iter().enumerate() {
            let segment = segment.trim();
            if segment.is_empty() || !segment.bytes().all(|b| b.is_ascii_digit()) {
                return Err(invalid(value));
            }
            numbers[index] = segment.parse::<u32>().map_err(|_| invalid(value))?;
            if numbers[index] > i32::MAX as u32 {
                return Err(invalid(value));
            }
        }
        let release = if let Some(release) = release {
            if !release.split('.').all(|s| valid_label(s, false)) {
                return Err(invalid(value));
            }
            release.split('.').map(str::to_ascii_lowercase).collect()
        } else {
            Vec::new()
        };
        Ok(Self { numbers, release })
    }
    fn compare(&self, other: &Self) -> Ordering {
        let order = self.numbers.cmp(&other.numbers);
        if order != Ordering::Equal {
            return order;
        }
        match (self.release.is_empty(), other.release.is_empty()) {
            (true, false) => return Ordering::Greater,
            (false, true) => return Ordering::Less,
            _ => {},
        }
        for (left, right) in self.release.iter().zip(&other.release) {
            // NuGet compares numeric identifiers only when they fit Int32.
            let order = match (left.parse::<i32>(), right.parse::<i32>()) {
                (Ok(a), Ok(b)) => a.cmp(&b),
                (Ok(_), Err(_)) => Ordering::Less,
                (Err(_), Ok(_)) => Ordering::Greater,
                (Err(_), Err(_)) => left.cmp(right),
            };
            if order != Ordering::Equal {
                return order;
            }
        }
        self.release.len().cmp(&other.release.len())
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct NugetVersions;
impl Version for NugetVersions {
    type Error = VersionError;
    fn scheme(&self) -> VersionScheme {
        VersionScheme::Nuget
    }
    fn compare(&self, left: &str, right: &str) -> Result<Ordering, Self::Error> {
        Ok(NugetVersion::parse(left)?.compare(&NugetVersion::parse(right)?))
    }
    fn satisfies(&self, version: &str, requirement: &str) -> Result<bool, Self::Error> {
        let version = NugetVersion::parse(version)?;
        let requirement = requirement.trim();
        if requirement.contains('*') {
            return Err(VersionError(
                "NuGet floating ranges require explicit FloatRange support".into(),
            ));
        }
        if requirement.is_empty() {
            return Err(invalid(requirement));
        }
        let first = requirement.as_bytes()[0];
        if first != b'[' && first != b'(' {
            return Ok(version.compare(&NugetVersion::parse(requirement)?) != Ordering::Less);
        }
        let last = *requirement.as_bytes().last().ok_or_else(|| invalid(requirement))?;
        if last != b']' && last != b')' {
            return Err(invalid(requirement));
        }
        let inside = &requirement[1..requirement.len() - 1];
        let Some((lower, upper)) = inside.split_once(',') else {
            if first != b'[' || last != b']' {
                return Err(invalid(requirement));
            }
            return Ok(version.compare(&NugetVersion::parse(inside)?) == Ordering::Equal);
        };
        if upper.contains(',') {
            return Err(invalid(requirement));
        }
        let lower = lower.trim();
        let upper = upper.trim();
        if (lower.is_empty() && first != b'(') || (upper.is_empty() && last != b')') {
            return Err(invalid(requirement));
        }
        let lower = (!lower.is_empty()).then(|| NugetVersion::parse(lower)).transpose()?;
        let upper = (!upper.is_empty()).then(|| NugetVersion::parse(upper)).transpose()?;
        if let (Some(lower), Some(upper)) = (&lower, &upper) {
            let order = lower.compare(upper);
            if order == Ordering::Greater
                || (order == Ordering::Equal && (first != b'[' || last != b']'))
            {
                return Err(invalid(requirement));
            }
        }
        Ok(lower.as_ref().is_none_or(|lower| match version.compare(lower) {
            Ordering::Less => false,
            Ordering::Equal => first == b'[',
            Ordering::Greater => true,
        }) && upper.as_ref().is_none_or(|upper| match version.compare(upper) {
            Ordering::Greater => false,
            Ordering::Equal => last == b']',
            Ordering::Less => true,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn padded_four_part_case_and_metadata() {
        assert_eq!(NugetVersions.compare("1", "1.0.0.0").unwrap(), Ordering::Equal);
        assert_eq!(NugetVersions.compare("1.0.0.1", "1.0.0").unwrap(), Ordering::Greater);
        assert_eq!(
            NugetVersions.compare("1.0-PREVIEW+Build", "1.0-preview+different").unwrap(),
            Ordering::Equal
        );
        assert_eq!(NugetVersions.compare("1-rc.2", "1-rc.10").unwrap(), Ordering::Less);
        assert_eq!(NugetVersions.compare("1-rc", "1").unwrap(), Ordering::Less);
    }
    #[test]
    fn exact_minimum_and_intervals() {
        assert!(NugetVersions.satisfies("2", "1.0").unwrap());
        assert!(!NugetVersions.satisfies("2", "[1.0]").unwrap());
        assert!(NugetVersions.satisfies("1.5", "[1,2)").unwrap());
        assert!(!NugetVersions.satisfies("2", "[1,2)").unwrap());
        assert!(NugetVersions.satisfies("1", "(,2]").unwrap());
        assert!(NugetVersions.satisfies("9", "(1,)").unwrap());
        assert!(NugetVersions.satisfies("2", "2.*").is_err());
        assert!(NugetVersions.satisfies("2", "[3,1]").is_err());
        assert!(NugetVersions.compare("1.0.0.0.1", "1").is_err());
        assert!(NugetVersions.compare("1-01", "1").is_err());
    }
}
