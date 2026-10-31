/**
 * Privacy-preserving cryptography absorbed from Brave: STAR threshold
 * aggregation, the STAR randomness (PPOPRF) client, Privacy Pass tokens and
 * the OPAQUE asymmetric password-authenticated key exchange.
 *
 * Strings are encoded as UTF-8. Every result is a `Uint8Array`.
 *
 * @example
 * ```ts
 * import { star } from "bun:privacy";
 * const a = star.encode("hello world", { threshold: 2, epoch: "t" });
 * const b = star.encode("hello world", { threshold: 2, epoch: "t" });
 * star.recover([a.message, b.message], { threshold: 2, epoch: "t" });
 * ```
 */
declare module "bun:privacy" {
  type BytesLike = string | ArrayBuffer | ArrayBufferView;

  interface Identifiers {
    client?: BytesLike;
    server?: BytesLike;
  }

  interface StarEncodeOptions {
    /** Number of matching messages required to recover the measurement (>= 2). */
    threshold: number;
    epoch: BytesLike;
    /** Auxiliary data encrypted with the measurement. */
    aux?: BytesLike;
    /** 32 bytes from `randomness.finalize`; defaults to local STARLite randomness. */
    randomness?: BytesLike;
  }

  interface StarRecoverOptions {
    threshold: number;
    epoch: BytesLike;
  }

  interface RandomnessVerifyOptions {
    publicKey: BytesLike;
    blinded: BytesLike;
    evaluated: BytesLike;
    proof: BytesLike;
    epoch: number;
  }

  interface PrivacyPassUnblindOptions {
    tokens: readonly BytesLike[];
    blinded: readonly BytesLike[];
    signed: readonly BytesLike[];
    proof: BytesLike;
    publicKey: BytesLike;
  }

  interface PrivacyPassRedemption {
    preimage: BytesLike;
    signature: BytesLike;
  }

  /** STAR: k-anonymous threshold aggregation of measurements. */
  export const star: {
    encode(measurement: BytesLike, options: StarEncodeOptions): { message: Uint8Array; tag: Uint8Array };
    parse(message: BytesLike): { ciphertext: Uint8Array; share: Uint8Array; tag: Uint8Array };
    /** Recovers the measurement once `threshold` messages share a tag. Throws otherwise. */
    recover(
      messages: readonly BytesLike[],
      options: StarRecoverOptions,
    ): { measurement: Uint8Array; aux: Uint8Array[] };
  };

  /** Client side of the STAR randomness server (puncturable partially oblivious PRF). */
  export const randomness: {
    blind(input: BytesLike): { blinded: Uint8Array; blind: Uint8Array };
    unblind(evaluated: BytesLike, blind: BytesLike): Uint8Array;
    verify(options: RandomnessVerifyOptions): boolean;
    /** Derives the 32-byte value passed as `star.encode({ randomness })`. */
    finalize(input: BytesLike, epoch: number, unblinded: BytesLike): Uint8Array;
  };

  /** Privacy Pass (challenge-bypass-ristretto) VOPRF tokens. */
  export const privacyPass: {
    createTokens(count?: number): Uint8Array[];
    blind(tokens: readonly BytesLike[]): Uint8Array[];
    createSigningKey(): Uint8Array;
    publicKey(signingKey: BytesLike): Uint8Array;
    sign(signingKey: BytesLike, blinded: readonly BytesLike[]): { signed: Uint8Array[]; proof: Uint8Array };
    /** Verifies the batch DLEQ proof and returns the unblinded tokens. */
    unblind(options: PrivacyPassUnblindOptions): Uint8Array[];
    redeem(unblinded: BytesLike, message: BytesLike): { preimage: Uint8Array; signature: Uint8Array };
    verify(signingKey: BytesLike, redemption: PrivacyPassRedemption, message: BytesLike): boolean;
  };

  /**
   * OPAQUE (Ristretto255, TripleDH, Argon2id). States are opaque bytes the
   * caller keeps between round trips. Login failures throw an error with code
   * `ERR_OPAQUE_INVALID_LOGIN`.
   */
  export const opaque: {
    createServerSetup(): Uint8Array;
    clientRegistrationStart(password: BytesLike): { state: Uint8Array; request: Uint8Array };
    serverRegistrationStart(setup: BytesLike, request: BytesLike, credentialId: BytesLike): Uint8Array;
    clientRegistrationFinish(
      state: BytesLike,
      password: BytesLike,
      response: BytesLike,
      identifiers?: Identifiers,
    ): { upload: Uint8Array; exportKey: Uint8Array; serverPublicKey: Uint8Array };
    /** Returns the password file to store. */
    serverRegistrationFinish(upload: BytesLike): Uint8Array;
    clientLoginStart(password: BytesLike): { state: Uint8Array; request: Uint8Array };
    /** Pass `null` as `passwordFile` for unknown credentials to run the indistinguishable dummy flow. */
    serverLoginStart(
      setup: BytesLike,
      passwordFile: BytesLike | null,
      request: BytesLike,
      credentialId: BytesLike,
      identifiers?: Identifiers,
    ): { state: Uint8Array; response: Uint8Array };
    clientLoginFinish(
      state: BytesLike,
      password: BytesLike,
      response: BytesLike,
      identifiers?: Identifiers,
    ): { finalization: Uint8Array; sessionKey: Uint8Array; exportKey: Uint8Array; serverPublicKey: Uint8Array };
    /** Returns the session key. */
    serverLoginFinish(state: BytesLike, finalization: BytesLike): Uint8Array;
  };
}
