// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Absorbed from brave/sta-rs ppoprf/src/ppoprf.rs (ppoprf 0.5.0).

//! This module defines the `Client` and `Server` functionality for a
//! puncturable partially oblivious pseudorandom function (PPOPRF).
//!
//! The POPRF that is used is very similar to the design of [Tyagi et
//! al.](https://eprint.iacr.org/2021/864.pdf), but where H_3 is
//! replaced with a puncturable PRF evaluation (over a small input
//! domain). This allows puncturing metadata tags from PPOPRF server
//! secret keys, which in turn gives forward-security guarantees related
//! to the pseudorandomness of evaluations received by clients.
//!
//! This construction is primarily used in the STAR protocol for
//! providing secure randomness to clients.

use curve25519_dalek::traits::Identity;
use rand::{Rng, rngs::OsRng};

use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar as RistrettoScalar;

use std::collections::BTreeMap;
use std::convert::TryInto;

use crate::strobe_rng::StrobeRng;
use strobe_rs::{SecParam, Strobe};

#[cfg(test)]
use zeroize::{Zeroize, ZeroizeOnDrop};

pub use super::PPRFError;
#[cfg(test)]
use super::{PPRF, ggm::GGM};

pub const COMPRESSED_POINT_LEN: usize = 32;
pub const DIGEST_LEN: usize = 64;

pub struct ProofDLEQ {
    c: RistrettoScalar,
    s: RistrettoScalar,
}
impl ProofDLEQ {
    // https://cfrg.github.io/draft-irtf-cfrg-voprf/draft-irtf-cfrg-voprf.html#name-proof-generation
    #[cfg(test)]
    fn new_batch(
        key: &RistrettoScalar,
        public_value: &RistrettoPoint,
        p: &[RistrettoPoint],
        q: &[RistrettoPoint],
    ) -> Self {
        let (m, z) = ProofDLEQ::compute_composites(Some(*key), public_value, p, q);

        let r = RistrettoScalar::random(&mut OsRng);
        let t2 = r * RISTRETTO_BASEPOINT_POINT;
        let t3 = r * m;

        let mut challenge_transcript = Vec::new();
        let compressed_point_len_slice = &ProofDLEQ::i2osp2(COMPRESSED_POINT_LEN);
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(public_value.compress().as_bytes());
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(m.compress().as_bytes());
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(z.compress().as_bytes());
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(t2.compress().as_bytes());
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(t3.compress().as_bytes());

        let c = ProofDLEQ::hash_to_scalar(&challenge_transcript, "Challenge");
        let s = r - c * key;

        Self { c, s }
    }

    // https://cfrg.github.io/draft-irtf-cfrg-voprf/draft-irtf-cfrg-voprf.html#name-proof-verification
    fn verify_batch(
        &self,
        public_value: &RistrettoPoint,
        p: &[RistrettoPoint],
        q: &[RistrettoPoint],
    ) -> bool {
        let (m, z) = ProofDLEQ::compute_composites(None, public_value, p, q);

        let t2 = (self.s * RISTRETTO_BASEPOINT_POINT) + (self.c * public_value);
        let t3 = (self.s * m) + (self.c * z);

        let mut challenge_transcript = Vec::new();
        let compressed_point_len_slice = &ProofDLEQ::i2osp2(COMPRESSED_POINT_LEN);
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(public_value.compress().as_bytes());
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(m.compress().as_bytes());
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(z.compress().as_bytes());
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(t2.compress().as_bytes());
        challenge_transcript.extend_from_slice(compressed_point_len_slice);
        challenge_transcript.extend_from_slice(t3.compress().as_bytes());

        let c = ProofDLEQ::hash_to_scalar(&challenge_transcript, "Challenge");
        self.c == c
    }

    fn compute_composites(
        key: Option<RistrettoScalar>,
        b: &RistrettoPoint,
        c: &[RistrettoPoint],
        d: &[RistrettoPoint],
    ) -> (RistrettoPoint, RistrettoPoint) {
        if c.len() != d.len() {
            panic!("C and D have a different number of elements!");
        }

        // We use the Partially-punctureable Oblivious Pseudo-Random Function
        // We assign mode 0x03 for the PPOPRF
        let context_string = format!("{}-{}-{}", "PPOPRFv1", 0x03, "ristretto255-strobe");

        let mut seed_transcript = Vec::new();
        seed_transcript.extend_from_slice(&ProofDLEQ::i2osp2(COMPRESSED_POINT_LEN));
        seed_transcript.extend_from_slice(b.compress().as_bytes());
        seed_transcript.extend_from_slice(&ProofDLEQ::i2osp2(context_string.len()));
        seed_transcript.extend_from_slice(context_string.as_bytes());

        let mut seed = [0u8; DIGEST_LEN];
        strobe_hash(&seed_transcript, "Seed", &mut seed);

        let mut m = RistrettoPoint::identity();
        let mut z = RistrettoPoint::identity();

        let compressed_point_len_slice = &ProofDLEQ::i2osp2(COMPRESSED_POINT_LEN);
        for i in 0..c.len() {
            let mut composite_transcript = Vec::new();
            composite_transcript.extend_from_slice(&ProofDLEQ::i2osp2(seed.len()));
            composite_transcript.extend_from_slice(&seed);
            composite_transcript.extend_from_slice(&ProofDLEQ::i2osp2(i));
            composite_transcript.extend_from_slice(compressed_point_len_slice);
            composite_transcript.extend_from_slice(c[i].compress().as_bytes());
            composite_transcript.extend_from_slice(compressed_point_len_slice);
            composite_transcript.extend_from_slice(d[i].compress().as_bytes());

            let di = ProofDLEQ::hash_to_scalar(&composite_transcript, "Composite");
            m = di * c[i] + m;

            // If we know the key (server), we don't need to calculate Z here
            if key.is_none() {
                z = di * d[i] + z;
            }
        }

        // If we know the key (server), we can calulate Z from key and M
        if let Some(k) = key {
            z = k * m;
        }

        (m, z)
    }

    // https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-hash-to-curve-16#name-hash_to_field-implementatio
    // The hash_to_field function is also suitable for securely hashing
    // to scalars. For example, when hashing to the scalar field for an
    // elliptic curve (sub)group with prime order r, it suffices to
    // instantiate hash_to_field with target field GF(r).
    fn hash_to_scalar(input: &[u8], label: &str) -> RistrettoScalar {
        let mut uniform_bytes = [0u8; DIGEST_LEN];
        strobe_hash(input, label, &mut uniform_bytes);

        RistrettoScalar::from_bytes_mod_order_wide(&uniform_bytes)
    }

    // I2OSP2(x): Converts a non-negative integer x into a byte
    // array of length 2 as described in [RFC8017]. Note that
    // this function returns a byte array in big-endian byte order.
    fn i2osp2(x: usize) -> [u8; 2] {
        let x_u16: u16 = x.try_into().expect("integer too large");
        x_u16.to_be_bytes()
    }
}

// Server public key structure for PPOPRF, contains all elements of the
// form g^{sk_0},g^{t_i} for metadata tags t_i.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerPublicKey {
    base_pk: Point,
    md_pks: BTreeMap<u8, Point>,
}
impl ServerPublicKey {
    // Byte layout of upstream's postcard encoding: base point, varint
    // count, then (tag, point) pairs in ascending tag order.
    #[cfg(test)]
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(34 + self.md_pks.len() * 33);
        out.extend_from_slice(self.base_pk.as_bytes());
        let mut n = self.md_pks.len();
        loop {
            let byte = (n & 0x7f) as u8;
            n >>= 7;
            if n == 0 {
                out.push(byte);
                break;
            }
            out.push(byte | 0x80);
        }
        for (md, point) in &self.md_pks {
            out.push(*md);
            out.extend_from_slice(point.as_bytes());
        }
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let base: [u8; 32] = bytes.get(..32)?.try_into().ok()?;
        let mut rest = &bytes[32..];
        let mut n = 0usize;
        let mut shift = 0;
        loop {
            let (&byte, tail) = rest.split_first()?;
            rest = tail;
            if shift > 14 {
                return None;
            }
            n |= usize::from(byte & 0x7f) << shift;
            shift += 7;
            if byte & 0x80 == 0 {
                break;
            }
        }
        if rest.len() != n * 33 {
            return None;
        }
        let base_pk = Point(CompressedRistretto(base));
        base_pk.decompress()?;
        let mut md_pks = BTreeMap::new();
        for chunk in rest.chunks_exact(33) {
            let point = Point(CompressedRistretto(chunk[1..].try_into().ok()?));
            point.decompress()?;
            if md_pks.insert(chunk[0], point).is_some() {
                return None;
            }
        }
        Some(Self { base_pk, md_pks })
    }
}

impl ProofDLEQ {
    // Upstream postcard layout: c || s, canonical scalars.
    #[cfg(test)]
    pub fn to_bytes(&self) -> [u8; 64] {
        let mut out = [0u8; 64];
        out[..32].copy_from_slice(self.c.as_bytes());
        out[32..].copy_from_slice(self.s.as_bytes());
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() != 64 {
            return None;
        }
        let c = Option::from(RistrettoScalar::from_canonical_bytes(
            bytes[..32].try_into().ok()?,
        ))?;
        let s = Option::from(RistrettoScalar::from_canonical_bytes(
            bytes[32..].try_into().ok()?,
        ))?;
        Some(Self { c, s })
    }
}

impl ServerPublicKey {
    fn get(&self, md: u8) -> Option<&Point> {
        self.md_pks.get(&md)
    }

    fn get_combined_pk_value(&self, md: u8) -> Result<Point, PPRFError> {
        let res = self.get(md);
        let md_pk = res.ok_or(PPRFError::BadTag { md })?;
        let b = self.base_pk.decompress().unwrap();
        let md = md_pk.decompress().unwrap();
        Ok(Point::from(b + md))
    }
}

// The wrapper for PPOPRF evaluations (similar to standard OPRFs)
pub struct Evaluation {
    pub output: Point,
    pub proof: Option<ProofDLEQ>,
}

// Public wrapper for points associated with the elliptic curve that
// is used
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Point(CompressedRistretto);
impl Point {
    pub(crate) fn decompress(&self) -> Option<RistrettoPoint> {
        self.0.decompress()
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        self.0.as_bytes()
    }
}
impl From<RistrettoPoint> for Point {
    fn from(rp: RistrettoPoint) -> Self {
        Self(rp.compress())
    }
}
impl From<&[u8]> for Point {
    fn from(bytes: &[u8]) -> Self {
        Self(CompressedRistretto::from_slice(bytes).expect("slice should be 32 bytes"))
    }
}
impl From<Point> for RistrettoPoint {
    fn from(p: Point) -> RistrettoPoint {
        p.decompress().unwrap()
    }
}

// Public wrapper for scalar values associated with the elliptic curve
// that is used. Currently only supports ristretto. Will need to be
// rewritten to include generic types if we want to support more curves
pub struct CurveScalar(RistrettoScalar);
impl From<[u8; 32]> for CurveScalar {
    fn from(bytes: [u8; 32]) -> Self {
        CurveScalar(RistrettoScalar::from_bytes_mod_order(bytes))
    }
}
impl From<RistrettoScalar> for CurveScalar {
    fn from(rs: RistrettoScalar) -> Self {
        CurveScalar(rs)
    }
}
impl From<CurveScalar> for RistrettoScalar {
    fn from(cs: CurveScalar) -> RistrettoScalar {
        cs.0
    }
}

// The `Server` runs the server-side component of the PPOPRF protocol.
#[cfg(test)]
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Server {
    oprf_key: RistrettoScalar,
    #[zeroize(skip)]
    public_key: ServerPublicKey,
    pprf: GGM,
}
#[cfg(test)]
impl Server {
    pub fn new(mds: Vec<u8>) -> Result<Self, PPRFError> {
        let oprf_key = RistrettoScalar::random(&mut OsRng);
        let mut md_pks = BTreeMap::new();
        let pprf = GGM::setup();
        for &md in mds.iter() {
            let mut tag = [0u8; 32];
            pprf.eval(&[md], &mut tag)?;
            let ts = RistrettoScalar::from_bytes_mod_order(tag);
            md_pks.insert(md, Point::from(ts * RISTRETTO_BASEPOINT_POINT));
        }
        Ok(Self {
            oprf_key,
            public_key: ServerPublicKey {
                base_pk: Point::from(oprf_key * RISTRETTO_BASEPOINT_POINT),
                md_pks,
            },
            pprf,
        })
    }

    pub fn eval(&self, p: &Point, md: u8, verifiable: bool) -> Result<Evaluation, PPRFError> {
        let p = p.0;
        let point = p.decompress().ok_or(PPRFError::BadPointEncoding)?;
        if self.public_key.get(md).is_none() {
            return Err(PPRFError::BadTag { md });
        }
        let mut tag = [0u8; 32];
        self.pprf.eval(&[md], &mut tag)?;
        let ts = RistrettoScalar::from_bytes_mod_order(tag);
        let tagged_key = self.oprf_key + ts;
        let exponent = tagged_key.invert();
        let eval_point = exponent * point;
        let mut proof = None;
        if verifiable {
            let public_value = self.public_key.get_combined_pk_value(md)?;
            proof = Some(ProofDLEQ::new_batch(
                &tagged_key,
                &public_value.into(),
                &[eval_point],
                &[point],
            ));
        }
        Ok(Evaluation {
            output: Point(eval_point.compress()),
            proof,
        })
    }

    pub fn puncture(&mut self, md: u8) -> Result<(), PPRFError> {
        self.pprf.puncture(&[md])
    }

    pub fn get_public_key(&self) -> ServerPublicKey {
        self.public_key.clone()
    }
}

// The `Client` struct is essentially a collection of static functions
// for computing client-side operations in the PPOPRF protocol.
pub struct Client {}
impl Client {
    pub fn blind(input: &[u8]) -> (Point, CurveScalar) {
        let mut hashed_input = [0u8; 64];
        strobe_hash(input, "ppoprf_derive_client_input", &mut hashed_input);
        let point = RistrettoPoint::from_uniform_bytes(&hashed_input);
        let r = RistrettoScalar::random(&mut OsRng);
        (Point((r * point).compress()), CurveScalar::from(r))
    }

    pub fn verify(public_key: &ServerPublicKey, input: &Point, eval: &Evaluation, md: u8) -> bool {
        let Evaluation { output, proof } = eval;
        if let Ok(public_value) = public_key.get_combined_pk_value(md) {
            return proof.as_ref().unwrap().verify_batch(
                &public_value.into(),
                &[output.decompress().unwrap()],
                &[input.decompress().unwrap()],
            );
        }
        false
    }

    pub fn unblind(p: &Point, r: &CurveScalar) -> Point {
        let point = p.decompress().unwrap();
        let r_inv = r.0.invert();
        Point((r_inv * point).compress())
    }

    pub fn finalize(input: &[u8], md: u8, unblinded: &Point, out: &mut [u8]) {
        if out.len() != 32 {
            panic!("Wrong output length!!: {:?}", out.len());
        }
        let point_bytes = unblinded.as_bytes();
        let mut hash_input = Vec::with_capacity(input.len() + 1 + point_bytes.len());
        hash_input.extend(input);
        hash_input.push(md);
        hash_input.extend(point_bytes);
        let mut untruncated = vec![0u8; 64];
        strobe_hash(&hash_input, "ppoprf_finalize", &mut untruncated);
        out.copy_from_slice(&untruncated[..32]);
    }
}

fn strobe_hash(input: &[u8], label: &str, out: &mut [u8]) {
    if out.len() != DIGEST_LEN {
        panic!(
            "Output buffer length ({}) does not match intended output length ({})",
            out.len(),
            DIGEST_LEN
        );
    }
    let mut t = Strobe::new(label.as_bytes(), SecParam::B128);
    t.key(input, false);
    let mut rng: StrobeRng = t.into();
    rng.fill(out);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn end_to_end_eval_check_no_proof(server: &Server, c_input: &[u8], md: u8) -> (Point, Point) {
        let (blinded_point, r) = Client::blind(c_input);
        let evaluated = server.eval(&blinded_point, md, false).unwrap();
        let unblinded = Client::unblind(&evaluated.output, &r);

        let mut chk_inp = [0u8; 64];
        strobe_hash(c_input, "ppoprf_derive_client_input", &mut chk_inp);
        let p = Point(RistrettoPoint::from_uniform_bytes(&chk_inp).compress());
        let chk_eval = server.eval(&p, md, false).unwrap();
        (unblinded, chk_eval.output)
    }

    fn end_to_end_eval_check(server: &Server, c_input: &[u8], md: u8) -> (Point, Point) {
        let (blinded_point, r) = Client::blind(c_input);
        let evaluated = server.eval(&blinded_point, md, true).unwrap();
        if !Client::verify(&server.public_key, &blinded_point, &evaluated, md) {
            panic!("Failed to verify proof");
        }
        let unblinded = Client::unblind(&evaluated.output, &r);

        let mut chk_inp = [0u8; 64];
        strobe_hash(c_input, "ppoprf_derive_client_input", &mut chk_inp);
        let p = Point(RistrettoPoint::from_uniform_bytes(&chk_inp).compress());
        let chk_eval = server.eval(&p, md, false).unwrap();
        (unblinded, chk_eval.output)
    }

    fn end_to_end_no_verify(mds: &[u8], md: u8) {
        let server = Server::new(mds.to_vec()).unwrap();
        let input = b"some_test_input";
        let (unblinded, chk_eval) = end_to_end_eval_check_no_proof(&server, input, md);
        assert_eq!(chk_eval, unblinded);
        let mut eval_final = vec![0u8; 32];
        Client::finalize(input, md, &unblinded, &mut eval_final);
        let mut chk_final = vec![0u8; 32];
        Client::finalize(input, md, &chk_eval, &mut chk_final);
        assert_eq!(chk_final, eval_final);
    }

    fn end_to_end_verify(mds: &[u8], md: u8) {
        let server = Server::new(mds.to_vec()).unwrap();
        let input = b"some_test_input";
        let (unblinded, chk_eval) = end_to_end_eval_check(&server, input, md);
        assert_eq!(chk_eval, unblinded);
        let mut eval_final = vec![0u8; 32];
        Client::finalize(input, md, &unblinded, &mut eval_final);
        let mut chk_final = vec![0u8; 32];
        Client::finalize(input, md, &chk_eval, &mut chk_final);
        assert_eq!(chk_final, eval_final);
    }

    #[test]
    fn end_to_end_no_verify_single_tag() {
        end_to_end_no_verify(&[0u8], 0);
    }

    #[test]
    fn end_to_end_verify_single_tag() {
        end_to_end_verify(&[0u8], 0);
    }

    #[test]
    #[should_panic]
    fn bad_index() {
        end_to_end_verify(&[0u8], 1);
    }

    #[test]
    fn end_to_end_no_verify_multi_tag() {
        let mds = vec![0u8, 1, 2, 3, 4];
        end_to_end_no_verify(&mds, 0);
        end_to_end_no_verify(&mds, 1);
        end_to_end_no_verify(&mds, 2);
        end_to_end_no_verify(&mds, 3);
        end_to_end_no_verify(&mds, 4);
    }

    #[test]
    fn end_to_end_verify_multi_tag() {
        let mds = vec![0u8, 1, 2, 3, 4];
        end_to_end_verify(&mds, 0);
        end_to_end_verify(&mds, 1);
        end_to_end_verify(&mds, 2);
        end_to_end_verify(&mds, 3);
        end_to_end_verify(&mds, 4);
    }

    #[test]
    #[should_panic(expected = "NoPrefixFound")]
    fn end_to_end_puncture() {
        let mds = vec![0u8, 1];
        let mut server = Server::new(mds).unwrap();
        let (unblinded, chk_eval) = end_to_end_eval_check_no_proof(&server, b"some_test_input", 1);
        assert_eq!(chk_eval, unblinded);
        server.puncture(1).unwrap();
        let (unblinded1, chk_eval1) = end_to_end_eval_check_no_proof(&server, b"another_input", 0);
        assert_eq!(chk_eval1, unblinded1);
        end_to_end_eval_check_no_proof(&server, b"some_test_input", 1);
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    // Known answers: upstream insta snapshots (postcard bytes), hex-encoded.
    #[test]
    fn pk_serialization() {
        let oprf_key = RistrettoScalar::from_bytes_mod_order([7u8; 32]);
        let mut md_pks = BTreeMap::new();

        for i in 0..8u8 {
            let ts = RistrettoScalar::from_bytes_mod_order([i * 2; 32]);
            md_pks.insert(i, Point::from(ts * RISTRETTO_BASEPOINT_POINT));
        }

        let pk = ServerPublicKey {
            base_pk: Point::from(oprf_key * RISTRETTO_BASEPOINT_POINT),
            md_pks,
        };

        let bytes = pk.to_bytes();
        assert_eq!(
            hex(&bytes),
            "aaf82404e5f7bfa7352ce093e4aabe82435385d64aa870090a56d1aa361698000800000000000000000000000000000000000000000000000000000000000000000001f6d73cfa04628744bf6939147f8535be14a0ef13e3ab294413177b541f08da090278cbb09cd18f90824f8ce357ac6163276fbc70df590a3853ad056f4af16f662b030c185646531770f1ad1847e01c691e281f0ce23605d03a2625f7e1d44623d62a0482ef1f297fbda67b35e213bddb9c043e61dc23d5389a5e939bb6f57bdd41454105ea1d1d7e75ca26fc1a2328be21caf290c171328c18a9f75c3e024ae5c70bfc34068e2fd54f46c808fcb27ea96bdb6e5682d689c807d8225013609ca9383f98ee1c07e4a55c96ea4c908ee7cc15a7a0329a3d3f8ef0f38b38068e00b4c8b3037adc3f"
        );
        assert_eq!(ServerPublicKey::from_bytes(&bytes), Some(pk));
    }

    #[test]
    fn pk_bad_data_load() {
        assert!(ServerPublicKey::from_bytes(&[8u8; 40]).is_none());
        assert!(ServerPublicKey::from_bytes(&[]).is_none());
        assert!(ServerPublicKey::from_bytes(&[0xFF]).is_none());
    }

    #[test]
    fn proof_serialization() {
        let proof = ProofDLEQ {
            c: RistrettoScalar::from_bytes_mod_order([7u8; 32]),
            s: RistrettoScalar::from_bytes_mod_order([15u8; 32]),
        };

        let bytes = proof.to_bytes();
        assert_eq!(
            hex(&bytes),
            "07070707070707070707070707070707070707070707070707070707070707070f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f"
        );
        let deserialized = ProofDLEQ::from_bytes(&bytes).unwrap();
        assert_eq!(proof.c, deserialized.c);
        assert_eq!(proof.s, deserialized.s);
    }

    #[test]
    fn proof_bad_data_load() {
        assert!(ProofDLEQ::from_bytes(&[8u8; 40]).is_none());
        assert!(ProofDLEQ::from_bytes(&[98u8; 65]).is_none());
        assert!(ProofDLEQ::from_bytes(&[0xffu8; 64]).is_none());
    }

    #[test]
    fn i2osp2() {
        assert_eq!(ProofDLEQ::i2osp2(42), [0, 42]);
        assert_eq!(ProofDLEQ::i2osp2(255), [0, 255]);
        assert_eq!(ProofDLEQ::i2osp2(256), [1, 0]);
        assert_eq!(ProofDLEQ::i2osp2(511), [1, 255]);
        assert_eq!(ProofDLEQ::i2osp2(65535), [255, 255]);
    }

    #[test]
    #[should_panic]
    fn i2osp2_overflow() {
        ProofDLEQ::i2osp2(65536); // [1,0,0]
    }

    #[test]
    fn test_batched_proofs() {
        let server = Server::new([0u8].to_vec()).unwrap();
        let input1 = b"some_test_input";
        let input2 = b"hello_world";
        let input3 = b"a_third_input";

        let (blinded_point1, _) = Client::blind(input1);
        let point1 = blinded_point1.0.decompress().unwrap();
        let (blinded_point2, _) = Client::blind(input2);
        let point2 = blinded_point2.0.decompress().unwrap();
        let (blinded_point3, _) = Client::blind(input3);
        let point3 = blinded_point3.0.decompress().unwrap();

        let mut tag = [0u8; 32];
        server.pprf.eval(&[0], &mut tag).unwrap();
        let ts = RistrettoScalar::from_bytes_mod_order(tag);
        let tagged_key = server.oprf_key + ts;
        let exponent = tagged_key.invert();

        let eval_point1 = exponent * point1;
        let eval_point2 = exponent * point2;
        let eval_point3 = exponent * point3;

        let public_value = server.public_key.get_combined_pk_value(0).unwrap();

        // Create one proof for multiple inputs
        let proof = Some(ProofDLEQ::new_batch(
            &tagged_key,
            &public_value.into(),
            &[eval_point1, eval_point2, eval_point3],
            &[point1, point2, point3],
        ));

        // verify multiple inputs in one proof
        let public_value_verify = server.public_key.get_combined_pk_value(0).unwrap();

        let result = proof.as_ref().unwrap().verify_batch(
            &public_value_verify.into(),
            &[eval_point1, eval_point2, eval_point3],
            &[point1, point2, point3],
        );

        assert!(result)
    }
}
