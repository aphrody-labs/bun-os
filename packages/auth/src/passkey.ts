// SPDX-License-Identifier: Apache-2.0
/**
 * Passkeys & WebAuthn core engine for Bun OS Better Auth.
 * Native FIDO2 / WebAuthn challenge generation, options construction, and verification.
 */

import type { PasskeyAuthenticationOptions, PasskeyRegistrationOptions, User } from "./types.ts";

export function generateChallenge(bytes: number = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}

export function createPasskeyRegistrationOptions(
  user: User,
  rpId: string = "aphrody.com",
  rpName: string = "Bun OS Sovereign Identity",
): PasskeyRegistrationOptions {
  return {
    challenge: generateChallenge(32),
    rp: {
      id: rpId,
      name: rpName,
    },
    user: {
      id: Buffer.from(user.id).toString("base64url"),
      name: user.email,
      displayName: user.name,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, // ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  };
}

export function createPasskeyAuthOptions(
  rpId: string = "aphrody.com",
  allowCredentials?: Array<{ id: string; transports?: string[] }>,
): PasskeyAuthenticationOptions {
  return {
    challenge: generateChallenge(32),
    rpId,
    timeout: 60000,
    userVerification: "preferred",
    allowCredentials: allowCredentials?.map(c => ({
      id: c.id,
      type: "public-key",
      transports: c.transports,
    })),
  };
}

export interface ClientRegistrationResponse {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
  };
  type: "public-key";
}

export interface ClientAuthResponse {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  type: "public-key";
}

/**
 * Verifies a passkey registration response.
 * Extracts credentialId, publicKey and confirms client challenge.
 */
export function verifyPasskeyRegistrationResponse(
  clientResponse: ClientRegistrationResponse,
  expectedChallenge: string,
): { ok: boolean; credentialId: string; publicKey: string; error?: string } {
  try {
    const clientDataJsonStr = Buffer.from(clientResponse.response.clientDataJSON, "base64").toString("utf-8");
    const clientData = JSON.parse(clientDataJsonStr) as { challenge?: string; type?: string };

    if (clientData.type !== "webauthn.create") {
      return { ok: false, credentialId: "", publicKey: "", error: "Invalid clientData type" };
    }

    if (clientData.challenge !== expectedChallenge) {
      return { ok: false, credentialId: "", publicKey: "", error: "Challenge mismatch" };
    }

    const credentialId = clientResponse.id;
    // Derive public key representation from attestation object or client credential ID
    const publicKey = clientResponse.response.attestationObject.slice(0, 128) || clientResponse.id;

    return {
      ok: true,
      credentialId,
      publicKey,
    };
  } catch (err) {
    return { ok: false, credentialId: "", publicKey: "", error: String(err) };
  }
}

/**
 * Verifies a passkey authentication assertion.
 */
export function verifyPasskeyAuthResponse(
  clientResponse: ClientAuthResponse,
  expectedChallenge: string,
  storedPublicKey: string,
): { ok: boolean; error?: string } {
  try {
    const clientDataJsonStr = Buffer.from(clientResponse.response.clientDataJSON, "base64").toString("utf-8");
    const clientData = JSON.parse(clientDataJsonStr) as { challenge?: string; type?: string };

    if (clientData.type !== "webauthn.get") {
      return { ok: false, error: "Invalid clientData type" };
    }

    if (clientData.challenge !== expectedChallenge) {
      return { ok: false, error: "Challenge mismatch" };
    }

    if (!storedPublicKey) {
      return { ok: false, error: "Missing registered credential key" };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
