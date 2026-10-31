// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Absorbed from brave/sta-rs ppoprf/src/lib.rs (ppoprf 0.5.0).

//! This module defines the combined functionality for producing a
//! puncturable partially oblivious pseudorandom function (PPOPRF)
//! protocol. The protocol combines the PPOPRF of [Tyagi et
//! al.](https://eprint.iacr.org/2021/864.pdf) with the classic GGM
//! puncturable PRF.
//!
//! The result is a POPRF that can provide forward-security guarantees
//! related to the pseudorandomness of client-side outputs, by allowing
//! the puncturing of metadata tags from the server secret key. Such
//! guarantees hold when clients reveal POPRF outputs for a metadata tag
//! `t`, after `t` has been punctured from the secret key. This
//! functionality is used to provide forward-secure randomness to
//! clients in the STAR protocol.

#[cfg(test)]
pub(crate) mod ggm;
#[allow(clippy::module_inception)]
pub(crate) mod ppoprf;

#[derive(Debug)]
pub enum PPRFError {
    BadTag { md: u8 },
    #[cfg(test)]
    NoPrefixFound,
    #[cfg(test)]
    AlreadyPunctured,
    #[cfg(test)]
    BadInputLength { actual: usize, expected: usize },
    #[cfg(test)]
    UnexpectedEndOfBv,
    #[cfg(test)]
    BadPointEncoding,
}

impl std::fmt::Display for PPRFError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadTag { md } => write!(f, "Specified tag ({md}) is not a valid metadata tag"),
            #[cfg(test)]
            Self::NoPrefixFound => f.write_str("No prefix found"),
            #[cfg(test)]
            Self::AlreadyPunctured => f.write_str("Tag already punctured"),
            #[cfg(test)]
            Self::BadInputLength { actual, expected } => write!(
                f,
                "Input length ({actual}) does not match input param ({expected})"
            ),
            #[cfg(test)]
            Self::UnexpectedEndOfBv => f.write_str("Unexpected end of bv"),
            #[cfg(test)]
            Self::BadPointEncoding => f.write_str("Bad compressed ristretto point encoding"),
        }
    }
}
impl std::error::Error for PPRFError {}

#[cfg(test)]
pub trait PPRF {
    fn setup() -> Self;
    fn eval(&self, input: &[u8], output: &mut [u8]) -> Result<(), PPRFError>;
    fn puncture(&mut self, input: &[u8]) -> Result<(), PPRFError>;
}
