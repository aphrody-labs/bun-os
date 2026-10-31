//! Privacy-preserving cryptography for `bun:privacy`, absorbed from Brave:
//!
//! - `star`: STAR threshold aggregation (brave/sta-rs: sta-rs, adss,
//!   star-sharks), with STARLite local randomness or PPOPRF randomness.
//! - `ppoprf`: client side of the STAR randomness server (brave/sta-rs ppoprf,
//!   as served by brave/star-randsrv).
//! - `privacy_pass`: Privacy Pass VOPRF tokens (challenge-bypass-ristretto).
//! - `opaque`: OPAQUE PAKE with the Brave Account cipher suite.
//!
//! [`call`] is the single byte-oriented entry point used by the JS binding.

extern crate alloc;

// Absorbed upstream modules keep their original item visibility and helpers.
#[allow(
    deprecated,
    unreachable_pub,
    clippy::all,
    clippy::pedantic,
    clippy::nursery
)]
mod ppoprf;
#[allow(
    deprecated,
    unreachable_pub,
    clippy::all,
    clippy::pedantic,
    clippy::nursery
)]
mod privacy_pass;
#[allow(
    deprecated,
    unreachable_pub,
    clippy::all,
    clippy::pedantic,
    clippy::nursery
)]
mod star;
#[allow(
    deprecated,
    unreachable_pub,
    clippy::all,
    clippy::pedantic,
    clippy::nursery
)]
mod strobe_rng;

mod opaque;

/// Result of one [`call`].
pub enum Output {
    Bytes(Vec<u8>),
    List(Vec<Vec<u8>>),
    Bool(bool),
}

fn arg<'a>(args: &[&'a [u8]], index: usize) -> &'a [u8] {
    args.get(index).copied().unwrap_or(&[])
}

fn u32_arg(args: &[&[u8]], index: usize, name: &str) -> Result<u32, String> {
    let bytes: [u8; 4] = arg(args, index)
        .try_into()
        .map_err(|_| format!("{name} must be a 32-bit integer"))?;
    Ok(u32::from_le_bytes(bytes))
}

fn u8_arg(args: &[&[u8]], index: usize, name: &str) -> Result<u8, String> {
    match arg(args, index) {
        [value] => Ok(*value),
        _ => Err(format!("{name} must be an integer in 0..255")),
    }
}

fn fixed<const N: usize>(bytes: &[u8], name: &str) -> Result<[u8; N], String> {
    bytes
        .try_into()
        .map_err(|_| format!("{name} must be {N} bytes"))
}

/// Splits `u32le length || bytes` records (the sta-rs `store_bytes` framing).
fn records(mut bytes: &[u8]) -> Result<Vec<&[u8]>, String> {
    let mut out = Vec::new();
    while !bytes.is_empty() {
        let record = star::adss::load_bytes(bytes).ok_or("STAR: truncated message list")?;
        bytes = &bytes[4 + record.len()..];
        out.push(record);
    }
    Ok(out)
}

fn point(bytes: &[u8], name: &str) -> Result<ppoprf::ppoprf::Point, String> {
    let bytes = fixed::<32>(bytes, name)?;
    let point = ppoprf::ppoprf::Point::from(&bytes[..]);
    if point.decompress().is_none() {
        return Err(format!("{name} is not a valid Ristretto255 point"));
    }
    Ok(point)
}

fn star_encode(args: &[&[u8]]) -> Result<Output, String> {
    use star::{AssociatedData, Message, MessageGenerator, SingleMeasurement};
    let measurement = arg(args, 0);
    let threshold = u32_arg(args, 1, "threshold")?;
    if threshold < 2 {
        return Err("threshold must be at least 2".into());
    }
    let generator =
        MessageGenerator::new(SingleMeasurement::new(measurement), threshold, arg(args, 2));
    let aux = arg(args, 3);
    let randomness = arg(args, 4);
    let mut rnd = [0u8; 32];
    if randomness.is_empty() {
        generator.sample_local_randomness(&mut rnd);
    } else {
        rnd = fixed::<32>(randomness, "randomness")?;
    }
    let aux = (!aux.is_empty()).then(|| AssociatedData::new(aux));
    let message = Message::generate(&generator, &rnd, aux).map_err(|e| format!("STAR: {e}"))?;
    let bytes = message.to_bytes();
    Ok(Output::List(vec![bytes, message.tag]))
}

fn star_parse(args: &[&[u8]]) -> Result<Output, String> {
    let message = star::Message::from_bytes(arg(args, 0)).ok_or("STAR: malformed message")?;
    Ok(Output::List(vec![
        message.ciphertext.to_bytes(),
        message.share.to_bytes(),
        message.tag,
    ]))
}

/// Recovers `[measurement, aux...]` from at least `threshold` messages that
/// share one tag.
fn star_recover(args: &[&[u8]]) -> Result<Output, String> {
    let threshold = u32_arg(args, 0, "threshold")? as usize;
    let epoch = arg(args, 1);
    let messages = records(arg(args, 2))?
        .into_iter()
        .map(|bytes| star::Message::from_bytes(bytes).ok_or("STAR: malformed message"))
        .collect::<Result<Vec<_>, _>>()?;
    if threshold < 2 || messages.len() < threshold {
        return Err(format!(
            "STAR: {} messages do not meet the threshold {threshold}",
            messages.len()
        ));
    }
    if messages.iter().any(|m| m.tag != messages[0].tag) {
        return Err("STAR: messages carry different tags".into());
    }
    let shares = messages.iter().map(|m| m.share.clone()).collect::<Vec<_>>();
    let commune = star::share_recover(&shares[..threshold]).map_err(|e| format!("STAR: {e}"))?;
    let mut key = [0u8; 16];
    star::derive_ske_key(&commune.get_message(), epoch, &mut key);
    let mut out = Vec::with_capacity(messages.len() + 1);
    for message in &messages {
        let plaintext = message.ciphertext.decrypt(&key, "star_encrypt");
        let measurement =
            star::adss::load_bytes(&plaintext).ok_or("STAR: ciphertext does not decrypt")?;
        let rest = &plaintext[4 + measurement.len()..];
        let aux = if rest.is_empty() {
            &[][..]
        } else {
            star::adss::load_bytes(rest).ok_or("STAR: ciphertext does not decrypt")?
        };
        match out.first() {
            None => out.push(measurement.to_vec()),
            Some(first) if first.as_slice() == measurement => {}
            Some(_) => return Err("STAR: measurements differ under one tag".into()),
        }
        out.push(aux.to_vec());
    }
    Ok(Output::List(out))
}

fn randomness(op: &str, args: &[&[u8]]) -> Result<Output, String> {
    use ppoprf::ppoprf::{Client, CurveScalar, Evaluation, ProofDLEQ, ServerPublicKey};
    match op {
        "blind" => {
            let (blinded, blind) = Client::blind(arg(args, 0));
            let blind: curve25519_dalek::scalar::Scalar = blind.into();
            Ok(Output::List(vec![
                blinded.as_bytes().to_vec(),
                blind.to_bytes().to_vec(),
            ]))
        }
        "unblind" => {
            let evaluated = point(arg(args, 0), "evaluated point")?;
            let blind = fixed::<32>(arg(args, 1), "blind")?;
            let scalar: Option<curve25519_dalek::scalar::Scalar> =
                curve25519_dalek::scalar::Scalar::from_canonical_bytes(blind).into();
            let scalar = scalar.ok_or("blind is not a canonical scalar")?;
            if scalar == curve25519_dalek::scalar::Scalar::ZERO {
                return Err("blind is zero".into());
            }
            Ok(Output::Bytes(
                Client::unblind(&evaluated, &CurveScalar::from(scalar))
                    .as_bytes()
                    .to_vec(),
            ))
        }
        "verify" => {
            let key =
                ServerPublicKey::from_bytes(arg(args, 0)).ok_or("malformed server public key")?;
            let blinded = point(arg(args, 1), "blinded point")?;
            let output = point(arg(args, 2), "evaluated point")?;
            let proof =
                ProofDLEQ::from_bytes(arg(args, 3)).ok_or("proof must be 64 canonical bytes")?;
            let epoch = u8_arg(args, 4, "epoch")?;
            let eval = Evaluation {
                output,
                proof: Some(proof),
            };
            Ok(Output::Bool(Client::verify(&key, &blinded, &eval, epoch)))
        }
        "finalize" => {
            let unblinded = point(arg(args, 2), "unblinded point")?;
            let mut out = [0u8; 32];
            Client::finalize(
                arg(args, 0),
                u8_arg(args, 1, "epoch")?,
                &unblinded,
                &mut out,
            );
            Ok(Output::Bytes(out.to_vec()))
        }
        _ => Err(format!("unknown randomness operation {op}")),
    }
}

fn privacy_pass(op: &str, args: &[&[u8]]) -> Result<Output, String> {
    use privacy_pass as pp;
    Ok(match op {
        "token" => Output::Bytes(pp::token()),
        "blind" => Output::Bytes(pp::blind(arg(args, 0))?),
        "signingKey" => Output::Bytes(pp::signing_key()),
        "publicKey" => Output::Bytes(pp::public_key(arg(args, 0))?),
        "sign" => {
            let mut signed = pp::sign(arg(args, 0), arg(args, 1))?;
            let proof = signed.split_off(signed.len() - 64);
            Output::List(vec![signed, proof])
        }
        "unblind" => Output::Bytes(pp::unblind(
            arg(args, 0),
            arg(args, 1),
            arg(args, 2),
            arg(args, 3),
            arg(args, 4),
        )?),
        "redeem" => {
            let mut preimage = pp::redeem(arg(args, 0), arg(args, 1))?;
            let signature = preimage.split_off(64);
            Output::List(vec![preimage, signature])
        }
        "verify" => Output::Bool(pp::verify(
            arg(args, 0),
            arg(args, 1),
            arg(args, 2),
            arg(args, 3),
        )?),
        _ => return Err(format!("unknown Privacy Pass operation {op}")),
    })
}

fn opaque_call(op: &str, a: &[&[u8]]) -> Result<Output, String> {
    use opaque as o;
    Ok(match op {
        "serverSetup" => Output::Bytes(o::server_setup()),
        "clientRegistrationStart" => Output::List(o::client_registration_start(arg(a, 0))?),
        "serverRegistrationStart" => Output::Bytes(o::server_registration_start(
            arg(a, 0),
            arg(a, 1),
            arg(a, 2),
        )?),
        "clientRegistrationFinish" => Output::List(o::client_registration_finish(
            arg(a, 0),
            arg(a, 1),
            arg(a, 2),
            arg(a, 3),
            arg(a, 4),
        )?),
        "serverRegistrationFinish" => Output::Bytes(o::server_registration_finish(arg(a, 0))?),
        "clientLoginStart" => Output::List(o::client_login_start(arg(a, 0))?),
        "serverLoginStart" => Output::List(o::server_login_start(
            arg(a, 0),
            arg(a, 1),
            arg(a, 2),
            arg(a, 3),
            arg(a, 4),
            arg(a, 5),
        )?),
        "clientLoginFinish" => Output::List(o::client_login_finish(
            arg(a, 0),
            arg(a, 1),
            arg(a, 2),
            arg(a, 3),
            arg(a, 4),
        )?),
        "serverLoginFinish" => Output::Bytes(o::server_login_finish(arg(a, 0), arg(a, 1))?),
        _ => return Err(format!("unknown OPAQUE operation {op}")),
    })
}

/// Runs `group.operation` (for example `star.encode`) over byte arguments.
/// Missing arguments read as empty; integers are little-endian.
pub fn call(op: &str, args: &[&[u8]]) -> Result<Output, String> {
    if let Some(name) = op.strip_prefix("star.") {
        return match name {
            "encode" => star_encode(args),
            "parse" => star_parse(args),
            "recover" => star_recover(args),
            _ => Err(format!("unknown STAR operation {name}")),
        };
    }
    if let Some(name) = op.strip_prefix("randomness.") {
        return randomness(name, args);
    }
    if let Some(name) = op.strip_prefix("privacyPass.") {
        return privacy_pass(name, args);
    }
    if let Some(name) = op.strip_prefix("opaque.") {
        return opaque_call(name, args);
    }
    Err(format!("unknown privacy operation {op}"))
}

#[cfg(test)]
mod tests {
    use super::{Output, call};

    fn list(output: Output) -> Vec<Vec<u8>> {
        match output {
            Output::List(list) => list,
            _ => panic!("expected a list"),
        }
    }

    fn frame(messages: &[Vec<u8>]) -> Vec<u8> {
        let mut out = Vec::new();
        for m in messages {
            super::star::adss::store_bytes(m, &mut out);
        }
        out
    }

    #[test]
    fn star_threshold_recovery() {
        let threshold = 3u32.to_le_bytes();
        let messages: Vec<Vec<u8>> = (0..3u8)
            .map(|i| {
                let aux = [i + 1];
                list(call("star.encode", &[b"hello world", &threshold, b"t", &aux]).unwrap())
                    .swap_remove(0)
            })
            .collect();
        let tags: Vec<Vec<u8>> = messages
            .iter()
            .map(|m| list(call("star.parse", &[m]).unwrap()).swap_remove(2))
            .collect();
        assert!(tags.iter().all(|t| t == &tags[0]));
        assert!(call("star.recover", &[&threshold, b"t", &frame(&messages[..2])]).is_err());
        let out = list(call("star.recover", &[&threshold, b"t", &frame(&messages)]).unwrap());
        assert_eq!(
            out,
            vec![b"hello world".to_vec(), vec![1], vec![2], vec![3]]
        );
    }

    #[test]
    fn star_ppoprf_randomness() {
        use super::ppoprf::ppoprf::{Client, Point, Server};
        let server = Server::new(vec![0, 1]).unwrap();
        let input = b"hello world";
        let blinded = list(call("randomness.blind", &[input]).unwrap());
        let eval = server.eval(&Point::from(&blinded[0][..]), 1, true).unwrap();
        let output = eval.output.as_bytes().to_vec();
        let proof = eval.proof.as_ref().unwrap().to_bytes();
        let key = server.get_public_key().to_bytes();
        let verified = call(
            "randomness.verify",
            &[&key, &blinded[0], &output, &proof, &[1]],
        )
        .unwrap();
        assert!(matches!(verified, Output::Bool(true)));
        let wrong = call(
            "randomness.verify",
            &[&key, &blinded[0], &output, &proof, &[0]],
        )
        .unwrap();
        assert!(matches!(wrong, Output::Bool(false)));
        let Output::Bytes(unblinded) = call("randomness.unblind", &[&output, &blinded[1]]).unwrap()
        else {
            panic!()
        };
        let Output::Bytes(rnd) = call("randomness.finalize", &[input, &[1], &unblinded]).unwrap()
        else {
            panic!()
        };
        let mut expected = [0u8; 32];
        let direct = server
            .eval(&Point::from(&blinded[0][..]), 1, false)
            .unwrap();
        let blind_scalar: [u8; 32] = blinded[1].clone().try_into().unwrap();
        let r = super::ppoprf::ppoprf::CurveScalar::from(blind_scalar);
        Client::finalize(
            input,
            1,
            &Client::unblind(&direct.output, &r),
            &mut expected,
        );
        assert_eq!(rnd, expected);
        let threshold = 2u32.to_le_bytes();
        let a = list(call("star.encode", &[input, &threshold, b"e", b"", &rnd]).unwrap());
        let b = list(call("star.encode", &[input, &threshold, b"e", b"", &rnd]).unwrap());
        assert_eq!(a[1], b[1]);
        let out = list(
            call(
                "star.recover",
                &[&threshold, b"e", &frame(&[a[0].clone(), b[0].clone()])],
            )
            .unwrap(),
        );
        assert_eq!(out[0], input);
    }
}
