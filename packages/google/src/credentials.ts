// SPDX-License-Identifier: Apache-2.0
import { dlopen, FFIType, ptr, read, toArrayBuffer, type Pointer } from "bun:ffi";
import type { GoogleClientOptions } from "./client.ts";

export interface AntigravityCredentialOptions {
  /** Exact existing Windows target, such as gemini:antigravity. No discovery or store migration. */
  target: string;
}

export type AntigravityCredentialProvider = GoogleClientOptions["credentialProvider"] & {
  /** Non-secret envelope metadata, updated after each protected-store read. */
  readonly authMethod?: string;
};

const CRED_TYPE_GENERIC = 1;
/** CREDENTIALW on 64-bit Windows: CredentialBlobSize at 32, CredentialBlob at 40. */
const BLOB_SIZE_OFFSET = 32;
const BLOB_OFFSET = 40;

let advapi32: ReturnType<typeof load> | undefined;

function load() {
  return dlopen("advapi32.dll", {
    CredReadW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.bool },
    CredFree: { args: [FFIType.ptr], returns: FFIType.void },
  }).symbols;
}

/** Reads one generic credential blob by its exact Credential Manager target; null when it does not exist. */
export function readWindowsCredential(target: string): string | null {
  if (process.platform !== "win32") throw new Error("Windows Credential Manager is available only on Windows");
  advapi32 ??= load();
  const out = new BigUint64Array(1);
  if (!advapi32.CredReadW(ptr(Buffer.from(`${target}\0`, "utf16le")), CRED_TYPE_GENERIC, 0, ptr(out))) return null;
  const credential = Number(out[0]) as Pointer;
  try {
    const size = read.u32(credential, BLOB_SIZE_OFFSET);
    if (size === 0) return "";
    const blob = new Uint8Array(toArrayBuffer(read.ptr(credential, BLOB_OFFSET) as Pointer, 0, size).slice(0));
    // Credential Manager blobs are opaque bytes; writers use UTF-8 or UTF-16LE JSON.
    const utf16 = size % 2 === 0 && blob.length > 2 && blob[1] === 0 && blob[0] !== 0;
    return new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(blob);
  } finally {
    advapi32.CredFree(credential);
  }
}

/**
 * Re-read the desktop-owned OAuth envelope through Windows Credential Manager (bun:ffi, advapi32).
 * This is read-only: the desktop remains token/refresh authority. No opaque credential or non-Windows store
 * parity is claimed.
 */
export function createAntigravityCredentialProvider(
  options: AntigravityCredentialOptions,
  readStored: (target: string) => string | null | Promise<string | null> = readWindowsCredential,
): AntigravityCredentialProvider {
  const target = options?.target;
  if (typeof target !== "string" || !target.trim() || target.includes("\0"))
    throw new TypeError("Google credential provider requires an explicit target");
  let authMethod: string | undefined;
  const provider = async (signal?: AbortSignal): Promise<string> => {
    signal?.throwIfAborted();
    let stored: string | null;
    try {
      stored = await readStored(target);
    } catch {
      signal?.throwIfAborted();
      throw new Error("Google protected credential read failed");
    }
    signal?.throwIfAborted();
    let envelope: { token?: { access_token?: unknown; expiry?: unknown }; auth_method?: unknown };
    try {
      if (stored === null) throw new Error();
      envelope = JSON.parse(stored);
    } catch {
      throw new Error("Google protected credential envelope unavailable");
    }
    const token = envelope?.token;
    if (typeof token?.access_token !== "string" || !/^[A-Za-z0-9._~+/-]+=*$/.test(token.access_token))
      throw new Error("Google protected credential envelope unavailable");
    if (token.expiry !== undefined && token.expiry !== null) {
      const expiry =
        typeof token.expiry === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(token.expiry)
          ? Date.parse(token.expiry)
          : NaN;
      if (!Number.isFinite(expiry) || expiry <= Date.now())
        throw new Error("Google protected credential expired or has invalid expiry");
    }
    authMethod = typeof envelope.auth_method === "string" ? envelope.auth_method : undefined;
    return token.access_token;
  };
  return Object.defineProperty(provider, "authMethod", { get: () => authMethod });
}
