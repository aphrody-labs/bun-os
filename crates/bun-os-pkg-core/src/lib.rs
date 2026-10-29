// Leaf crate on std, outside the event loop (like `bun_host`): std I/O and strings are intended.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
// SPDX-License-Identifier: Apache-2.0
//! Pure package contracts. Ecosystem parsers are absorbed by SP/WG from Bun.
//! No network, filesystem, process execution or implicit trust belongs here.

#![forbid(unsafe_code)]

mod contracts;
pub mod ecosystem_versions;
pub mod indexes;
pub use contracts::{Dependency, Index, PackageVersion, Source, Version, VersionScheme};

/// Signature schemes are explicit; providers must reject unsupported schemes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignatureAlgorithm {
    Ed25519,
    RsaPkcs1Sha256,
    RsaPkcs1Sha512,
}

/// Cryptographic backend injected by the host. Success means verification with
/// the supplied trusted key succeeded, never merely that the signature parsed.
pub trait Crypto {
    type Error;

    fn verify_signature(
        &self,
        algorithm: SignatureAlgorithm,
        trusted_key: &[u8],
        message: &[u8],
        signature: &[u8],
    ) -> Result<(), Self::Error>;
}
