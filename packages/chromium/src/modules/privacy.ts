// SPDX-License-Identifier: MIT AND MPL-2.0
// bun:privacy: STAR threshold aggregation, STAR randomness (PPOPRF) client,
// Privacy Pass tokens and OPAQUE, absorbed from Brave (crates/aphrody-privacy), reached through
// crates/aphrody-chromium-ffi with bun:ffi on upstream Bun.
import { ptr } from "bun:ffi";
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE } from "../errors.ts";
import { native as library, pointer, take, utf8 } from "../native.ts";

type Bytes = import("bun:privacy").BytesLike;
type Identifiers = import("bun:privacy").Identifiers;

function native(op: string, ...args: (Uint8Array | undefined)[]): any {
  const opBytes = utf8(op);
  const buffers = args.map(arg => arg ?? new Uint8Array(0));
  const pointers = new BigUint64Array(Math.max(buffers.length, 1));
  const lengths = new BigUint64Array(Math.max(buffers.length, 1));
  buffers.forEach((buffer, i) => {
    pointers[i] = buffer.byteLength ? BigInt(pointer(buffer)) : 0n;
    lengths[i] = BigInt(buffer.byteLength);
  });
  const out = take(
    library().aphrody_privacy_call(
      pointer(opBytes),
      opBytes.byteLength,
      ptr(pointers),
      ptr(lengths),
      buffers.length,
    ) as any,
  );
  // Keep the argument buffers alive across the call.
  void buffers.length;
  const kind = out[0];
  if (kind === 0) return out[1] === 1;
  if (kind === 1) return out.slice(1);
  const list: Uint8Array[] = [];
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let offset = 1; offset < out.byteLength;) {
    const length = view.getUint32(offset, true);
    offset += 4;
    list.push(out.slice(offset, offset + length));
    offset += length;
  }
  return list;
}
const NativeUint8Array = Uint8Array;
const NativeTextEncoder = TextEncoder;
const isView = ArrayBuffer.isView;
const isArray = Array.isArray;
const isSafeInteger = Number.isSafeInteger;
const freeze = Object.freeze;
let encoder: TextEncoder | undefined;

const TOKEN_LENGTH = 96;
const BLINDED_LENGTH = 32;
const UNBLINDED_LENGTH = 96;
const INVALID_LOGIN = "OPAQUE: invalid login";

function bytes(name: string, value: unknown): Uint8Array {
  if (typeof value === "string") return (encoder ??= new NativeTextEncoder()).encode(value);
  if (value instanceof NativeUint8Array) return value;
  if (isView(value)) return new NativeUint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new NativeUint8Array(value);
  throw ERR_INVALID_ARG_TYPE(name, ["string", "ArrayBuffer", "ArrayBufferView"], value);
}

function optional(name: string, value: unknown): Uint8Array | undefined {
  return value === undefined || value === null ? undefined : bytes(name, value);
}

function u32(name: string, value: unknown, min: number): Uint8Array {
  if (typeof value !== "number" || !isSafeInteger(value) || value < min || value > 0xffffffff)
    throw ERR_OUT_OF_RANGE(name, `an integer in ${min}..4294967295`, value);
  const out = new NativeUint8Array(4);
  out[0] = value & 0xff;
  out[1] = (value >>> 8) & 0xff;
  out[2] = (value >>> 16) & 0xff;
  out[3] = (value >>> 24) & 0xff;
  return out;
}

function u8(name: string, value: unknown): Uint8Array {
  if (typeof value !== "number" || !isSafeInteger(value) || value < 0 || value > 255)
    throw ERR_OUT_OF_RANGE(name, "an integer in 0..255", value);
  return NativeUint8Array.of(value);
}

function list(name: string, value: unknown): Uint8Array[] {
  if (!isArray(value)) throw ERR_INVALID_ARG_TYPE(name, "Array", value);
  const out: Uint8Array[] = [];
  for (let i = 0; i < value.length; i++) out.push(bytes(`${name}[${i}]`, value[i]));
  return out;
}

function concat(items: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const item of items) length += item.byteLength;
  const out = new NativeUint8Array(length);
  let offset = 0;
  for (const item of items) {
    out.set(item, offset);
    offset += item.byteLength;
  }
  return out;
}

function fixedList(name: string, value: unknown, size: number): Uint8Array {
  const items = list(name, value);
  for (let i = 0; i < items.length; i++)
    if (items[i].byteLength !== size) throw ERR_INVALID_ARG_VALUE(`${name}[${i}]`, items[i], `must be ${size} bytes`);
  return concat(items);
}

function split(buffer: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += size) out.push(buffer.slice(offset, offset + size));
  return out;
}

function frame(items: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const item of items) parts.push(u32("message length", item.byteLength, 0), item);
  return concat(parts);
}

function ids(value: Identifiers | undefined): [Uint8Array | undefined, Uint8Array | undefined] {
  if (value === undefined || value === null) return [undefined, undefined];
  if (typeof value !== "object") throw ERR_INVALID_ARG_TYPE("identifiers", "object", value);
  return [optional("identifiers.client", value.client), optional("identifiers.server", value.server)];
}

const star = freeze({
  encode(measurement: Bytes, options: import("bun:privacy").StarEncodeOptions) {
    if (typeof options !== "object" || options === null) throw ERR_INVALID_ARG_TYPE("options", "object", options);
    const randomness = optional("options.randomness", options.randomness);
    if (randomness !== undefined && randomness.byteLength !== 32)
      throw ERR_INVALID_ARG_VALUE("options.randomness", randomness, "must be 32 bytes");
    const [message, tag] = native(
      "star.encode",
      bytes("measurement", measurement),
      u32("options.threshold", options.threshold, 2),
      bytes("options.epoch", options.epoch),
      optional("options.aux", options.aux),
      randomness,
    );
    return { message, tag };
  },
  parse(message: Bytes) {
    const [ciphertext, share, tag] = native("star.parse", bytes("message", message));
    return { ciphertext, share, tag };
  },
  recover(messages: readonly Bytes[], options: import("bun:privacy").StarRecoverOptions) {
    if (typeof options !== "object" || options === null) throw ERR_INVALID_ARG_TYPE("options", "object", options);
    const [measurement, ...aux] = native(
      "star.recover",
      u32("options.threshold", options.threshold, 2),
      bytes("options.epoch", options.epoch),
      frame(list("messages", messages)),
    );
    return { measurement, aux };
  },
});

const randomness = freeze({
  blind(input: Bytes) {
    const [blinded, blind] = native("randomness.blind", bytes("input", input));
    return { blinded, blind };
  },
  unblind(evaluated: Bytes, blind: Bytes): Uint8Array {
    return native("randomness.unblind", bytes("evaluated", evaluated), bytes("blind", blind));
  },
  verify(options: import("bun:privacy").RandomnessVerifyOptions): boolean {
    if (typeof options !== "object" || options === null) throw ERR_INVALID_ARG_TYPE("options", "object", options);
    return native(
      "randomness.verify",
      bytes("options.publicKey", options.publicKey),
      bytes("options.blinded", options.blinded),
      bytes("options.evaluated", options.evaluated),
      bytes("options.proof", options.proof),
      u8("options.epoch", options.epoch),
    );
  },
  finalize(input: Bytes, epoch: number, unblinded: Bytes): Uint8Array {
    return native("randomness.finalize", bytes("input", input), u8("epoch", epoch), bytes("unblinded", unblinded));
  },
});

const privacyPass = freeze({
  createTokens(count = 1): Uint8Array[] {
    if (!isSafeInteger(count) || count < 1 || count > 4096)
      throw ERR_OUT_OF_RANGE("count", "an integer in 1..4096", count);
    const out: Uint8Array[] = [];
    for (let i = 0; i < count; i++) out.push(native("privacyPass.token"));
    return out;
  },
  blind(tokens: readonly Bytes[]): Uint8Array[] {
    return split(native("privacyPass.blind", fixedList("tokens", tokens, TOKEN_LENGTH)), BLINDED_LENGTH);
  },
  createSigningKey(): Uint8Array {
    return native("privacyPass.signingKey");
  },
  publicKey(signingKey: Bytes): Uint8Array {
    return native("privacyPass.publicKey", bytes("signingKey", signingKey));
  },
  sign(signingKey: Bytes, blinded: readonly Bytes[]) {
    const [signed, proof] = native(
      "privacyPass.sign",
      bytes("signingKey", signingKey),
      fixedList("blinded", blinded, BLINDED_LENGTH),
    );
    return { signed: split(signed, BLINDED_LENGTH), proof };
  },
  unblind(options: import("bun:privacy").PrivacyPassUnblindOptions): Uint8Array[] {
    if (typeof options !== "object" || options === null) throw ERR_INVALID_ARG_TYPE("options", "object", options);
    return split(
      native(
        "privacyPass.unblind",
        fixedList("options.tokens", options.tokens, TOKEN_LENGTH),
        fixedList("options.blinded", options.blinded, BLINDED_LENGTH),
        fixedList("options.signed", options.signed, BLINDED_LENGTH),
        bytes("options.proof", options.proof),
        bytes("options.publicKey", options.publicKey),
      ),
      UNBLINDED_LENGTH,
    );
  },
  redeem(unblinded: Bytes, message: Bytes) {
    const [preimage, signature] = native(
      "privacyPass.redeem",
      bytes("unblinded", unblinded),
      bytes("message", message),
    );
    return { preimage, signature };
  },
  verify(signingKey: Bytes, redemption: import("bun:privacy").PrivacyPassRedemption, message: Bytes): boolean {
    if (typeof redemption !== "object" || redemption === null)
      throw ERR_INVALID_ARG_TYPE("redemption", "object", redemption);
    return native(
      "privacyPass.verify",
      bytes("signingKey", signingKey),
      bytes("redemption.preimage", redemption.preimage),
      bytes("redemption.signature", redemption.signature),
      bytes("message", message),
    );
  },
});

function login<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if ((error as Error)?.message === INVALID_LOGIN) {
      const invalid = new Error("OPAQUE login failed: wrong password or unknown credential");
      (invalid as any).code = "ERR_OPAQUE_INVALID_LOGIN";
      throw invalid;
    }
    throw error;
  }
}

const opaque = freeze({
  createServerSetup(): Uint8Array {
    return native("opaque.serverSetup");
  },
  clientRegistrationStart(password: Bytes) {
    const [state, request] = native("opaque.clientRegistrationStart", bytes("password", password));
    return { state, request };
  },
  serverRegistrationStart(setup: Bytes, request: Bytes, credentialId: Bytes): Uint8Array {
    return native(
      "opaque.serverRegistrationStart",
      bytes("setup", setup),
      bytes("request", request),
      bytes("credentialId", credentialId),
    );
  },
  clientRegistrationFinish(state: Bytes, password: Bytes, response: Bytes, identifiers?: Identifiers) {
    const [client, server] = ids(identifiers);
    const [upload, exportKey, serverPublicKey] = native(
      "opaque.clientRegistrationFinish",
      bytes("state", state),
      bytes("password", password),
      bytes("response", response),
      client,
      server,
    );
    return { upload, exportKey, serverPublicKey };
  },
  serverRegistrationFinish(upload: Bytes): Uint8Array {
    return native("opaque.serverRegistrationFinish", bytes("upload", upload));
  },
  clientLoginStart(password: Bytes) {
    const [state, request] = native("opaque.clientLoginStart", bytes("password", password));
    return { state, request };
  },
  serverLoginStart(
    setup: Bytes,
    passwordFile: Bytes | null,
    request: Bytes,
    credentialId: Bytes,
    identifiers?: Identifiers,
  ) {
    const [client, server] = ids(identifiers);
    const [state, response] = native(
      "opaque.serverLoginStart",
      bytes("setup", setup),
      optional("passwordFile", passwordFile),
      bytes("request", request),
      bytes("credentialId", credentialId),
      client,
      server,
    );
    return { state, response };
  },
  clientLoginFinish(state: Bytes, password: Bytes, response: Bytes, identifiers?: Identifiers) {
    const [client, server] = ids(identifiers);
    const [finalization, sessionKey, exportKey, serverPublicKey] = login(() =>
      native(
        "opaque.clientLoginFinish",
        bytes("state", state),
        bytes("password", password),
        bytes("response", response),
        client,
        server,
      ),
    );
    return { finalization, sessionKey, exportKey, serverPublicKey };
  },
  serverLoginFinish(state: Bytes, finalization: Bytes): Uint8Array {
    return login(() => native("opaque.serverLoginFinish", bytes("state", state), bytes("finalization", finalization)));
  },
});

export default { star, randomness, privacyPass, opaque };
