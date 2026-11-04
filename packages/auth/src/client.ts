// SPDX-License-Identifier: Apache-2.0
/**
 * Browser-safe client exports for @aphrody/auth.
 * Excludes backend runtimes (bun:sqlite, node crypto, etc.) so it bundles cleanly in client frontends.
 */

export * from "./types.ts";
export * from "./i18n.ts";
export * from "./tanstack.ts";
export {
  createPasskeyAuthOptions,
  createPasskeyRegistrationOptions,
  verifyPasskeyAuthResponse,
  verifyPasskeyRegistrationResponse,
  type ClientAuthResponse,
  type ClientRegistrationResponse,
} from "./passkey.ts";
export {
  SESSION_COOKIE,
  SESSION_ISSUER,
  SESSION_AUDIENCE,
  COMPAT_COOKIES,
  extractSessionToken,
} from "./session.ts";
