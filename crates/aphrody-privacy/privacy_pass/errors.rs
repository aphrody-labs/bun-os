// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Absorbed from brave-intl/challenge-bypass-ristretto 2.1.0 src/errors.rs
// (used by brave-core components/challenge_bypass_ristretto).

//! Errors which may occur when parsing keys and/or tokens to or from wire formats,
//! or verifying proofs.

use core::fmt;
use core::fmt::Display;

use std::error::Error;

/// Internal errors.  Most application-level developers will likely not
/// need to pay any attention to these.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum InternalError {
    /// An error occured when converting from a `CompressedRistretto` to a `RistrettoPoint`
    PointDecompressionError,
    /// An error occured when interpretting bytes as a scalar
    ScalarFormatError,
    /// An error in the length of bytes handed to a constructor.
    BytesLengthError {
        /// The name of the type
        name: &'static str,
        /// The expected number of bytes
        length: usize,
    },
    /// Verification failed
    VerifyError,
    /// Inputs differed in length
    LengthMismatchError,
    /// Decoding failed
    #[cfg(test)]
    DecodingError,
    /// Per RFC 9497 Section 3.3.1, `HashToGroup` produced the group identity
    /// element (InvalidInputError)
    InvalidInput,
}

impl Display for InternalError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match *self {
            InternalError::PointDecompressionError => write!(f, "Cannot decompress Edwards point"),
            InternalError::ScalarFormatError => {
                write!(f, "Input bytes were not in canonical representation")
            }
            InternalError::BytesLengthError { name: n, length: l } => {
                write!(f, "{} must be {} bytes in length", n, l)
            }
            InternalError::VerifyError => write!(f, "Verification failed"),
            InternalError::LengthMismatchError => write!(f, "Inputs differed in length"),
            #[cfg(test)]
            InternalError::DecodingError => write!(f, "Decoding failed"),
            InternalError::InvalidInput => write!(f, "Invalid Input"),
        }
    }
}

impl Error for InternalError {}

/// Errors when keys and/or tokens to or from wire formats, or verifying proofs.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub struct TokenError(pub InternalError);

impl Display for TokenError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Error for TokenError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        Some(&self.0)
    }
}
