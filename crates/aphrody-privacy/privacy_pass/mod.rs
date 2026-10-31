// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Privacy Pass tokens over Ristretto255 (VOPRF with batch DLEQ proofs), as
//! issued and redeemed by Brave's challenge-bypass servers. Uses the RFC 9497
//! hash-to-group and finalization variants that brave-core selects.

#[macro_use]
mod macros;
mod dleq;
mod errors;
mod oprf;

use hmac::Hmac;
use rand::rngs::OsRng;
use sha2::Sha512;

pub(crate) use dleq::BatchDLEQProof;
pub(crate) use oprf::{
    BLINDED_TOKEN_LENGTH, BlindedToken, PublicKey, SIGNED_TOKEN_LENGTH, SignedToken, SigningKey,
    TOKEN_LENGTH, Token, TokenPreimage, UNBLINDED_TOKEN_LENGTH, UnblindedToken,
    VerificationSignature,
};

type HmacSha512 = Hmac<Sha512>;

fn err(error: errors::TokenError) -> String {
    format!("Privacy Pass: {error}")
}

fn chunks<T>(
    bytes: &[u8],
    size: usize,
    name: &str,
    parse: impl Fn(&[u8]) -> Result<T, errors::TokenError>,
) -> Result<Vec<T>, String> {
    if bytes.len() % size != 0 {
        return Err(format!(
            "Privacy Pass: {name} must be a multiple of {size} bytes"
        ));
    }
    bytes
        .chunks_exact(size)
        .map(|c| parse(c).map_err(err))
        .collect()
}

pub(crate) fn token() -> Vec<u8> {
    Token::random::<Sha512, _>(&mut OsRng).to_bytes().to_vec()
}

pub(crate) fn blind(tokens: &[u8]) -> Result<Vec<u8>, String> {
    let tokens = chunks(tokens, TOKEN_LENGTH, "tokens", Token::from_bytes)?;
    let mut out = Vec::with_capacity(tokens.len() * BLINDED_TOKEN_LENGTH);
    for token in &tokens {
        out.extend_from_slice(&token.blind_rfc::<Sha512>().map_err(err)?.to_bytes());
    }
    Ok(out)
}

pub(crate) fn signing_key() -> Vec<u8> {
    SigningKey::random(&mut OsRng).to_bytes().to_vec()
}

pub(crate) fn public_key(signing_key: &[u8]) -> Result<Vec<u8>, String> {
    let key = SigningKey::from_bytes(signing_key).map_err(err)?;
    Ok(key.public_key.to_bytes().to_vec())
}

/// Signs every blinded token and returns `signed tokens || batch proof`.
pub(crate) fn sign(signing_key: &[u8], blinded: &[u8]) -> Result<Vec<u8>, String> {
    let key = SigningKey::from_bytes(signing_key).map_err(err)?;
    let blinded = chunks(
        blinded,
        BLINDED_TOKEN_LENGTH,
        "blinded tokens",
        BlindedToken::from_bytes,
    )?;
    let signed = blinded
        .iter()
        .map(|token| key.sign(token).map_err(err))
        .collect::<Result<Vec<_>, _>>()?;
    let proof =
        BatchDLEQProof::new::<Sha512, _>(&mut OsRng, &blinded, &signed, &key).map_err(err)?;
    let mut out = Vec::with_capacity(signed.len() * SIGNED_TOKEN_LENGTH + 64);
    for token in &signed {
        out.extend_from_slice(&token.to_bytes());
    }
    out.extend_from_slice(&proof.to_bytes());
    Ok(out)
}

pub(crate) fn unblind(
    tokens: &[u8],
    blinded: &[u8],
    signed: &[u8],
    proof: &[u8],
    public_key: &[u8],
) -> Result<Vec<u8>, String> {
    let tokens = chunks(tokens, TOKEN_LENGTH, "tokens", Token::from_bytes)?;
    let blinded = chunks(
        blinded,
        BLINDED_TOKEN_LENGTH,
        "blinded tokens",
        BlindedToken::from_bytes,
    )?;
    let signed = chunks(
        signed,
        SIGNED_TOKEN_LENGTH,
        "signed tokens",
        SignedToken::from_bytes,
    )?;
    if tokens.len() != blinded.len() || tokens.len() != signed.len() {
        return Err("Privacy Pass: tokens, blinded and signed tokens differ in count".into());
    }
    let proof = BatchDLEQProof::from_bytes(proof).map_err(err)?;
    let public_key = PublicKey::from_bytes(public_key).map_err(err)?;
    let unblinded = proof
        .verify_and_unblind::<Sha512, _>(&tokens, &blinded, &signed, &public_key)
        .map_err(err)?;
    let mut out = Vec::with_capacity(unblinded.len() * UNBLINDED_TOKEN_LENGTH);
    for token in &unblinded {
        out.extend_from_slice(&token.to_bytes());
    }
    Ok(out)
}

/// Redeems one unblinded token for `message`: returns `preimage || signature`.
pub(crate) fn redeem(unblinded: &[u8], message: &[u8]) -> Result<Vec<u8>, String> {
    let token = UnblindedToken::from_bytes(unblinded).map_err(err)?;
    let signature = token
        .derive_verification_key_rfc::<Sha512>()
        .sign::<HmacSha512>(message);
    let mut out = token.t.to_bytes().to_vec();
    out.extend_from_slice(&signature.to_bytes());
    Ok(out)
}

pub(crate) fn verify(
    signing_key: &[u8],
    preimage: &[u8],
    signature: &[u8],
    message: &[u8],
) -> Result<bool, String> {
    let key = SigningKey::from_bytes(signing_key).map_err(err)?;
    let preimage = TokenPreimage::from_bytes(preimage).map_err(err)?;
    let signature = VerificationSignature::from_bytes(signature).map_err(err)?;
    let token = key
        .rederive_unblinded_token_rfc::<Sha512>(&preimage)
        .map_err(err)?;
    Ok(token
        .derive_verification_key_rfc::<Sha512>()
        .verify::<HmacSha512>(&signature, message))
}

#[cfg(test)]
mod tests {
    #[test]
    fn issue_redeem_roundtrip() {
        let key = super::signing_key();
        let public = super::public_key(&key).unwrap();
        let tokens = [super::token(), super::token()].concat();
        let blinded = super::blind(&tokens).unwrap();
        let signed = super::sign(&key, &blinded).unwrap();
        let (signed, proof) = signed.split_at(signed.len() - 64);
        let unblinded = super::unblind(&tokens, &blinded, signed, proof, &public).unwrap();
        assert_eq!(unblinded.len(), 2 * super::UNBLINDED_TOKEN_LENGTH);
        let redeemed = super::redeem(&unblinded[..96], b"GET /").unwrap();
        let (preimage, signature) = redeemed.split_at(64);
        assert!(super::verify(&key, preimage, signature, b"GET /").unwrap());
        assert!(!super::verify(&key, preimage, signature, b"GET /x").unwrap());
        let other = super::signing_key();
        let other_public = super::public_key(&other).unwrap();
        assert!(super::unblind(&tokens, &blinded, signed, proof, &other_public).is_err());
    }
}
