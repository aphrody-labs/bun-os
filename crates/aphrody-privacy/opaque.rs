// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Cipher suite and client flow follow brave-core
// components/brave_account/resources/opaque_ke (Brave Account).

//! OPAQUE asymmetric PAKE: Ristretto255 OPRF and key group, TripleDH and
//! Argon2id (default parameters) as key stretching. Every protocol state is
//! serialized so callers can hold it between round trips.

use argon2::Argon2;
use opaque_ke::ciphersuite::CipherSuite;
use opaque_ke::errors::ProtocolError;
use opaque_ke::rand::rngs::OsRng;
use opaque_ke::{
    ClientLogin, ClientLoginFinishParameters, ClientRegistration,
    ClientRegistrationFinishParameters, CredentialFinalization, CredentialRequest,
    CredentialResponse, Identifiers, RegistrationRequest, RegistrationResponse, RegistrationUpload,
    ServerLogin, ServerLoginStartParameters, ServerRegistration, ServerSetup,
};

pub(crate) struct Suite;
impl CipherSuite for Suite {
    type OprfCs = opaque_ke::Ristretto255;
    type KeGroup = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::key_exchange::tripledh::TripleDh;
    type Ksf = Argon2<'static>;
}

pub(crate) const INVALID_LOGIN: &str = "OPAQUE: invalid login";

fn err<E>(step: &str) -> impl FnOnce(ProtocolError<E>) -> String + '_ {
    move |error| match error {
        ProtocolError::InvalidLoginError => INVALID_LOGIN.into(),
        _ => format!("OPAQUE: {step} failed"),
    }
}

fn identifiers<'a>(client: &'a [u8], server: &'a [u8]) -> Identifiers<'a> {
    Identifiers {
        client: (!client.is_empty()).then_some(client),
        server: (!server.is_empty()).then_some(server),
    }
}

pub(crate) fn server_setup() -> Vec<u8> {
    ServerSetup::<Suite>::new(&mut OsRng).serialize().to_vec()
}

fn setup(bytes: &[u8]) -> Result<ServerSetup<Suite>, String> {
    ServerSetup::<Suite>::deserialize(bytes).map_err(err("server setup"))
}

/// Returns `[state, request]`.
pub(crate) fn client_registration_start(password: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let result = ClientRegistration::<Suite>::start(&mut OsRng, password)
        .map_err(err("registration start"))?;
    Ok(vec![
        result.state.serialize().to_vec(),
        result.message.serialize().to_vec(),
    ])
}

pub(crate) fn server_registration_start(
    setup_bytes: &[u8],
    request: &[u8],
    credential_id: &[u8],
) -> Result<Vec<u8>, String> {
    let request =
        RegistrationRequest::<Suite>::deserialize(request).map_err(err("registration request"))?;
    let result = ServerRegistration::<Suite>::start(&setup(setup_bytes)?, request, credential_id)
        .map_err(err("registration start"))?;
    Ok(result.message.serialize().to_vec())
}

/// Returns `[upload, exportKey, serverPublicKey]`.
pub(crate) fn client_registration_finish(
    state: &[u8],
    password: &[u8],
    response: &[u8],
    client_id: &[u8],
    server_id: &[u8],
) -> Result<Vec<Vec<u8>>, String> {
    let state =
        ClientRegistration::<Suite>::deserialize(state).map_err(err("registration state"))?;
    let response = RegistrationResponse::<Suite>::deserialize(response)
        .map_err(err("registration response"))?;
    let result = state
        .finish(
            &mut OsRng,
            password,
            response,
            ClientRegistrationFinishParameters::new(identifiers(client_id, server_id), None),
        )
        .map_err(err("registration finish"))?;
    Ok(vec![
        result.message.serialize().to_vec(),
        result.export_key.to_vec(),
        result.server_s_pk.serialize().to_vec(),
    ])
}

/// Returns the password file to store for this credential.
pub(crate) fn server_registration_finish(upload: &[u8]) -> Result<Vec<u8>, String> {
    let upload =
        RegistrationUpload::<Suite>::deserialize(upload).map_err(err("registration upload"))?;
    Ok(ServerRegistration::<Suite>::finish(upload)
        .serialize()
        .to_vec())
}

/// Returns `[state, request]`.
pub(crate) fn client_login_start(password: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let result = ClientLogin::<Suite>::start(&mut OsRng, password).map_err(err("login start"))?;
    Ok(vec![
        result.state.serialize().to_vec(),
        result.message.serialize().to_vec(),
    ])
}

/// Returns `[state, response]`. An empty password file runs the dummy flow so
/// unknown credentials are indistinguishable from a wrong password.
pub(crate) fn server_login_start(
    setup_bytes: &[u8],
    password_file: &[u8],
    request: &[u8],
    credential_id: &[u8],
    client_id: &[u8],
    server_id: &[u8],
) -> Result<Vec<Vec<u8>>, String> {
    let password_file = if password_file.is_empty() {
        None
    } else {
        Some(
            ServerRegistration::<Suite>::deserialize(password_file)
                .map_err(err("password file"))?,
        )
    };
    let request =
        CredentialRequest::<Suite>::deserialize(request).map_err(err("credential request"))?;
    let result = ServerLogin::start(
        &mut OsRng,
        &setup(setup_bytes)?,
        password_file,
        request,
        credential_id,
        ServerLoginStartParameters {
            context: None,
            identifiers: identifiers(client_id, server_id),
        },
    )
    .map_err(err("login start"))?;
    Ok(vec![
        result.state.serialize().to_vec(),
        result.message.serialize().to_vec(),
    ])
}

/// Returns `[finalization, sessionKey, exportKey, serverPublicKey]`.
pub(crate) fn client_login_finish(
    state: &[u8],
    password: &[u8],
    response: &[u8],
    client_id: &[u8],
    server_id: &[u8],
) -> Result<Vec<Vec<u8>>, String> {
    let state = ClientLogin::<Suite>::deserialize(state).map_err(err("login state"))?;
    let response =
        CredentialResponse::<Suite>::deserialize(response).map_err(err("credential response"))?;
    let result = state
        .finish(
            password,
            response,
            ClientLoginFinishParameters::new(None, identifiers(client_id, server_id), None),
        )
        .map_err(err("login finish"))?;
    Ok(vec![
        result.message.serialize().to_vec(),
        result.session_key.to_vec(),
        result.export_key.to_vec(),
        result.server_s_pk.serialize().to_vec(),
    ])
}

pub(crate) fn server_login_finish(state: &[u8], finalization: &[u8]) -> Result<Vec<u8>, String> {
    let state = ServerLogin::<Suite>::deserialize(state).map_err(err("login state"))?;
    let finalization = CredentialFinalization::<Suite>::deserialize(finalization)
        .map_err(err("credential finalization"))?;
    let result = state.finish(finalization).map_err(err("login finish"))?;
    Ok(result.session_key.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn register(setup: &[u8], password: &[u8]) -> Vec<u8> {
        let [state, request] =
            <[Vec<u8>; 2]>::try_from(client_registration_start(password).unwrap()).unwrap();
        let response = server_registration_start(setup, &request, b"alice").unwrap();
        let finish =
            client_registration_finish(&state, password, &response, b"alice@example.com", b"")
                .unwrap();
        server_registration_finish(&finish[0]).unwrap()
    }

    fn login(setup: &[u8], file: &[u8], password: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
        let [cstate, request] =
            <[Vec<u8>; 2]>::try_from(client_login_start(password).unwrap()).unwrap();
        let [sstate, response] = <[Vec<u8>; 2]>::try_from(
            server_login_start(setup, file, &request, b"alice", b"alice@example.com", b"").unwrap(),
        )
        .unwrap();
        let finish = client_login_finish(&cstate, password, &response, b"alice@example.com", b"")?;
        let server_key = server_login_finish(&sstate, &finish[0])?;
        Ok((finish[1].clone(), server_key))
    }

    #[test]
    fn register_and_login() {
        let setup = server_setup();
        let file = register(&setup, b"hunter2");
        let (client, server) = login(&setup, &file, b"hunter2").unwrap();
        assert_eq!(client.len(), 64);
        assert_eq!(client, server);
        assert_eq!(login(&setup, &file, b"wrong").unwrap_err(), INVALID_LOGIN);
        assert_eq!(login(&setup, &[], b"hunter2").unwrap_err(), INVALID_LOGIN);
    }
}
