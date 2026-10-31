// SPDX-License-Identifier: MIT
/**
 * `bun:google` of the aphrody-labs/bun fork on upstream Bun, served by the @aphrody/google Bun OS
 * plugin. Same surface as the fork builtin (`googleRuntime`, `createClient`, `chromium`, `obscura`,
 * `dns`), plus `adcCredentialProvider` for Application Default Credentials (on the VPS: admin-sa
 * impersonating aphrody-bot through /etc/aphrody/google.env).
 */
import chromium from "@aphrody/chromium/chromium";
import obscura from "@aphrody/chromium/obscura";
import { createClient, googleRuntime } from "./client.ts";

export { createClient, googleRuntime } from "./client.ts";
export type { GoogleClient, GoogleClientOptions, GoogleRuntime } from "./client.ts";
export { chromium, obscura };
export const dns = Bun.dns;

/**
 * Credential provider over Application Default Credentials (google-auth-library), for
 * `createClient({ credentialProvider })`. Tokens stay in the auth library's cache.
 */
export function adcCredentialProvider(
  scopes: string | string[] = "https://www.googleapis.com/auth/cloud-platform",
): (signal?: AbortSignal) => Promise<string> {
  let client: Promise<{ getAccessToken(): Promise<{ token?: string | null }> }> | undefined;
  return async signal => {
    signal?.throwIfAborted();
    client ??= import("google-auth-library").then(({ GoogleAuth }) => new GoogleAuth({ scopes }).getClient());
    const { token } = await (await client).getAccessToken();
    if (!token) throw new Error("Application Default Credentials returned no access token");
    return token;
  };
}

export default { googleRuntime, createClient, chromium, obscura, dns, adcCredentialProvider };
