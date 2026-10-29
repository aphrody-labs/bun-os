//! PKCE (RFC 7636) and `state` generation.

use crate::error::{Error, Result};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

/// A PKCE pair using the `S256` method.
#[derive(Clone)]
pub struct Pkce {
    /// High-entropy secret kept by the client until the token request.
    pub verifier: String,
    /// `BASE64URL(SHA256(verifier))`, sent in the authorization request.
    pub challenge: String,
}

impl std::fmt::Debug for Pkce {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pkce").field("verifier", &"<redacted>").field("challenge", &self.challenge).finish()
    }
}

/// `n` random bytes, base64url without padding.
pub fn random_urlsafe(n: usize) -> Result<String> {
    let mut buf = vec![0u8; n];
    getrandom::fill(&mut buf).map_err(|e| Error::Invalid(format!("os randomness: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

impl Pkce {
    /// Fresh pair: 32 random bytes give a 43-character verifier (the RFC minimum).
    pub fn generate() -> Result<Self> {
        Ok(Self::from_verifier(random_urlsafe(32)?))
    }
    /// Derive the challenge for a given verifier.
    pub fn from_verifier(verifier: String) -> Self {
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Self { verifier, challenge }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc7636_appendix_b_vector() {
        let p = Pkce::from_verifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into());
        assert_eq!(p.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn generated_pairs_are_distinct_and_valid() {
        let a = Pkce::generate().unwrap();
        let b = Pkce::generate().unwrap();
        assert_ne!(a.verifier, b.verifier);
        assert_eq!(a.verifier.len(), 43);
        assert!(a.verifier.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        assert_eq!(Pkce::from_verifier(a.verifier.clone()).challenge, a.challenge);
    }

    #[test]
    fn debug_never_prints_the_verifier() {
        let p = Pkce::generate().unwrap();
        assert!(!format!("{p:?}").contains(&p.verifier));
    }
}
