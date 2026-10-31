// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-control-regex -- OAuth inputs reject raw control characters. */
import { timingSafeEqual, type webcrypto } from "node:crypto";
type JsonWebKey = webcrypto.JsonWebKey;
type RsaHashedKeyAlgorithm = webcrypto.RsaHashedKeyAlgorithm;

const AUTHORIZATION = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const JWKS = "https://www.googleapis.com/oauth2/v3/certs";
const FLOW_COOKIE = "__Host-aphrody-google-flow";
const SESSION_COOKIE = "__Host-aphrody-google-session";
const opaque = /^[A-Za-z0-9_-]{43}$/;
const paths = new Set(["/auth/google/login", "/auth/google/callback", "/auth/session", "/auth/scopes", "/auth/logout"]);

export interface GoogleOAuthUser {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}
export interface GoogleOAuthState {
  verifier: string;
  nonce: string;
  bindingHash: string;
  returnTo: string;
  scopes: string[];
  expiresAt: number;
}
export interface GoogleOAuthSession {
  user: GoogleOAuthUser;
  scopes: string[];
  expiresAt: number;
}
export interface GoogleOAuthStore {
  putState(key: string, value: GoogleOAuthState): Promise<void>;
  /** Atomically remove and return an unexpired transaction; never return it twice. */
  consumeState(key: string, now: number): Promise<GoogleOAuthState | undefined>;
  putSession(key: string, value: GoogleOAuthSession): Promise<void>;
  getSession(key: string, now: number): Promise<GoogleOAuthSession | undefined>;
  deleteSession(key: string): Promise<void>;
}
export interface GoogleOAuthTokens {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes: string[];
}
export interface GoogleOAuthOptions {
  publicOrigin: string;
  callbackURL: string;
  allowedCallbackURLs: readonly string[];
  clientId?: string;
  clientSecret?: string;
  store?: GoogleOAuthStore;
  allowedScopes?: readonly string[];
  allowedReturnPaths?: readonly string[];
  sessionTTLSeconds?: number;
  /** Trusted owner transport; production uses Bun's native fetch. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Protected token owner integration; tokens never enter public session responses. */
  onTokens?: (user: GoogleOAuthUser, tokens: GoogleOAuthTokens) => Promise<void>;
  now?: () => number;
}

/** Explicit bounded single-process store; persistent/multi-worker deployments inject their owner store. */
export function createMemoryGoogleOAuthStore(maxEntries = 4096): GoogleOAuthStore {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 100000)
    throw new TypeError("Invalid OAuth store capacity");
  const states = new Map<string, GoogleOAuthState>();
  const sessions = new Map<string, GoogleOAuthSession>();
  function insert<T extends { expiresAt: number }>(map: Map<string, T>, key: string, value: T) {
    if (map.size >= maxEntries) {
      for (const [id, entry] of map) if (entry.expiresAt <= Date.now()) map.delete(id);
      if (map.size >= maxEntries && !map.has(key)) throw new Error("OAuth store capacity reached");
    }
    map.set(key, structuredClone(value));
  }
  return {
    async putState(key, value) {
      insert(states, key, value);
    },
    async consumeState(key, now) {
      const value = states.get(key);
      states.delete(key);
      return value && value.expiresAt > now ? structuredClone(value) : undefined;
    },
    async putSession(key, value) {
      insert(sessions, key, value);
    },
    async getSession(key, now) {
      const value = sessions.get(key);
      if (value && value.expiresAt <= now) {
        sessions.delete(key);
        return undefined;
      }
      return value && structuredClone(value);
    },
    async deleteSession(key) {
      sessions.delete(key);
    },
  };
}

function random() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}
function hash(value: string) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}
function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function cookie(request: Request, name: string) {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map(part => part.trim())
    .filter(part => part.startsWith(name + "="));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(name.length + 1);
  return opaque.test(value) ? value : undefined;
}
function setCookie(name: string, value: string, age: number) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
}
function response(data: unknown, status = 200, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(data, { status, headers });
}
function redirect(location: string, cookies: string[]) {
  const headers = new Headers({
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 303, headers });
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function decode(part: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("Invalid ID token");
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) throw new Error("Invalid ID token");
  return bytes;
}
async function jsonBody(result: Response) {
  if (!result.ok || !result.body) throw new Error("Google transport failed");
  const reader = result.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 65536) throw new Error("Google response exceeds limit");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (!object(value)) throw new Error("Invalid Google response");
  return value;
}

export function createGoogleOAuthServer(options: GoogleOAuthOptions) {
  const { clientId, clientSecret, store, onTokens } = options;
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.href !== origin.origin + "/")
    throw new TypeError("Explicit Google OAuth public HTTPS origin required");
  const callback = new URL(options.callbackURL);
  if (
    callback.origin !== origin.origin ||
    callback.pathname !== "/auth/google/callback" ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password ||
    !options.allowedCallbackURLs.includes(callback.href)
  )
    throw new TypeError("Google OAuth callback must exactly match its explicit allowlist");
  const now = options.now ?? Date.now;
  const transport = options.fetch ?? globalThis.fetch;
  const ttl = options.sessionTTLSeconds ?? 3600;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) throw new TypeError("Invalid OAuth session expiry");
  const allowedScopes = new Set(options.allowedScopes ?? ["openid", "email", "profile"]);
  if (
    !allowedScopes.has("openid") ||
    allowedScopes.size > 32 ||
    [...allowedScopes].some(
      scope => !/^(openid|email|profile|https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._/-]+)$/.test(scope),
    )
  )
    throw new TypeError("Invalid explicit Google scope allowlist");
  const returnPaths = new Set(options.allowedReturnPaths ?? ["/"]);
  if (
    !returnPaths.size ||
    [...returnPaths].some(
      path =>
        !path.startsWith("/") ||
        path.startsWith("//") ||
        path.includes("\\") ||
        /[\x00-\x20\x7f]/.test(path) ||
        new URL(path, origin).origin !== origin.origin ||
        new URL(path, origin).hash,
    )
  )
    throw new TypeError("Invalid OAuth return path allowlist");
  const configured =
    typeof options.clientId === "string" &&
    /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(options.clientId) &&
    typeof options.clientSecret === "string" &&
    options.clientSecret.length >= 8 &&
    !/[\x00-\x20\x7f]/.test(options.clientSecret) &&
    !!options.store;
  let active = 0;
  let keyCache: { keys: JsonWebKey[]; expires: number; fetched: number } | undefined;
  let keyRequest: Promise<void> | undefined;
  async function loadKeys(signal: AbortSignal) {
    if (keyRequest) return keyRequest;
    keyRequest = (async () => {
      const result = await transport(JWKS, { redirect: "error", signal });
      const cacheAge = Math.min(
        86400,
        Number(result.headers.get("cache-control")?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1] ?? 300),
      );
      const value = await jsonBody(result);
      if (!Array.isArray(value.keys) || !value.keys.length || value.keys.length > 10 || !value.keys.every(object))
        throw new Error("Invalid Google signing keys");
      keyCache = {
        keys: value.keys as JsonWebKey[],
        expires: now() + cacheAge * 1000,
        fetched: now(),
      };
    })();
    try {
      await keyRequest;
    } finally {
      keyRequest = undefined;
    }
  }
  async function verify(token: string, nonce: string, signal: AbortSignal): Promise<GoogleOAuthUser> {
    if (token.length > 16384) throw new Error("Invalid ID token");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid ID token");
    const header: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[0]!)));
    const claims: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[1]!)));
    if (
      !object(header) ||
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      !header.kid ||
      header.kid.length > 256 ||
      header.crit !== undefined ||
      !object(claims)
    )
      throw new Error("Invalid ID token");
    if (!keyCache || keyCache.expires <= now()) await loadKeys(signal);
    let candidates = keyCache!.keys.filter(key => (key as JsonWebKey & { kid?: string }).kid === header.kid);
    if (!candidates.length && now() - keyCache!.fetched >= 30000) {
      await loadKeys(signal);
      candidates = keyCache!.keys.filter(key => (key as JsonWebKey & { kid?: string }).kid === header.kid);
    }
    const key = candidates[0];
    if (
      candidates.length !== 1 ||
      !key ||
      key.kty !== "RSA" ||
      (key.use && key.use !== "sig") ||
      (key.alg && key.alg !== "RS256")
    )
      throw new Error("Invalid Google signing key");
    const publicKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
      "verify",
    ]);
    if (
      (publicKey.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048 ||
      !(await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        decode(parts[2]!),
        new TextEncoder().encode(parts[0] + "." + parts[1]),
      ))
    )
      throw new Error("Invalid ID token signature");
    const seconds = Math.floor(now() / 1000);
    const audiences =
      typeof claims.aud === "string"
        ? [claims.aud]
        : Array.isArray(claims.aud) && claims.aud.every(value => typeof value === "string")
          ? claims.aud
          : [];
    if (
      !clientId ||
      !audiences.includes(clientId) ||
      (audiences.length > 1 && claims.azp !== clientId) ||
      (claims.azp !== undefined && claims.azp !== clientId) ||
      typeof claims.iss !== "string" ||
      !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) ||
      !Number.isInteger(claims.exp) ||
      Number(claims.exp) <= seconds ||
      !Number.isInteger(claims.iat) ||
      Number(claims.iat) < 0 ||
      Number(claims.iat) > seconds + 60 ||
      Number(claims.iat) >= Number(claims.exp) ||
      (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || Number(claims.nbf) > seconds)) ||
      typeof claims.nonce !== "string" ||
      !equal(claims.nonce, nonce) ||
      typeof claims.sub !== "string" ||
      !/^[\x21-\x7e]{1,255}$/.test(claims.sub)
    )
      throw new Error("Invalid ID token claims");
    return {
      sub: claims.sub,
      ...(typeof claims.email === "string" && claims.email.length <= 320 ? { email: claims.email } : {}),
      emailVerified: claims.email_verified === true || claims.email_verified === "true",
      ...(typeof claims.name === "string" && claims.name.length <= 256 ? { name: claims.name } : {}),
    };
  }
  async function session(request: Request) {
    const id = cookie(request, SESSION_COOKIE);
    const value = id ? await store!.getSession(hash(id), now()) : undefined;
    return value && value.expiresAt > now() ? value : undefined;
  }
  return {
    capabilities() {
      return { provider: "google", configured, scopes: [...allowedScopes] };
    },
    async fetch(request: Request): Promise<Response | undefined> {
      try {
        const url = new URL(request.url);
        if (!paths.has(url.pathname)) return undefined;
        if (url.origin !== origin.origin) return response({ error: "untrusted_auth_origin" }, 403);
        if (!configured) return response({ error: "google_oauth_not_configured", authenticated: false }, 503);
        if (url.pathname === "/auth/logout") {
          if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405, { allow: "POST" });
          if (request.headers.get("origin") !== origin.origin || request.headers.get("sec-fetch-site") === "cross-site")
            return response({ error: "untrusted_auth_origin" }, 403);
          const id = cookie(request, SESSION_COOKIE);
          if (id) await store!.deleteSession(hash(id));
          return response({ authenticated: false }, 200, {
            "set-cookie": setCookie(SESSION_COOKIE, "", 0),
          });
        }
        if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405, { allow: "GET" });
        if (url.pathname === "/auth/session" || url.pathname === "/auth/scopes") {
          const value = await session(request);
          return response(
            value
              ? {
                  authenticated: true,
                  user: value.user,
                  scopes: value.scopes,
                  expiresAt: value.expiresAt,
                }
              : { authenticated: false, scopes: [] },
          );
        }
        if (url.pathname === "/auth/google/login") {
          if (request.headers.has("origin") && request.headers.get("origin") !== origin.origin)
            return response({ error: "untrusted_auth_origin" }, 403);
          if (url.searchParams.getAll("returnTo").length > 1 || url.searchParams.getAll("scope").length > 1)
            return response({ error: "invalid_auth_request" }, 400);
          const returnTo = url.searchParams.get("returnTo") ?? "/";
          const scopes = [
            ...new Set(
              (
                url.searchParams.get("scope") ??
                ["openid", "email", "profile"].filter(scope => allowedScopes.has(scope)).join(" ")
              )
                .split(" ")
                .filter(Boolean),
            ),
          ];
          if (
            !returnPaths.has(returnTo) ||
            !scopes.includes("openid") ||
            scopes.some(scope => !allowedScopes.has(scope))
          )
            return response({ error: "invalid_auth_request" }, 400);
          const state = random(),
            binding = random(),
            nonce = random(),
            verifier = random();
          try {
            await store!.putState(hash(state), {
              verifier,
              nonce,
              bindingHash: hash(binding),
              returnTo,
              scopes,
              expiresAt: now() + 600000,
            });
          } catch {
            return response({ error: "auth_store_unavailable" }, 503);
          }
          const target = new URL(AUTHORIZATION);
          target.search = new URLSearchParams({
            client_id: clientId!,
            redirect_uri: callback.href,
            response_type: "code",
            scope: scopes.join(" "),
            state,
            nonce,
            code_challenge: new Bun.CryptoHasher("sha256").update(verifier).digest("base64url"),
            code_challenge_method: "S256",
          }).toString();
          return redirect(target.href, [setCookie(FLOW_COOKIE, binding, 600)]);
        }
        if (["state", "code", "error"].some(key => url.searchParams.getAll(key).length > 1))
          return response({ error: "invalid_oauth_callback" }, 400);
        const state = url.searchParams.get("state"),
          binding = cookie(request, FLOW_COOKIE);
        if (!state || !opaque.test(state) || !binding) return response({ error: "invalid_oauth_callback" }, 400);
        const transaction = await store!.consumeState(hash(state), now());
        const clear = setCookie(FLOW_COOKIE, "", 0);
        if (
          !transaction ||
          !equal(transaction.bindingHash, hash(binding)) ||
          transaction.expiresAt <= now() ||
          !returnPaths.has(transaction.returnTo) ||
          !transaction.scopes.includes("openid") ||
          transaction.scopes.some(scope => !allowedScopes.has(scope)) ||
          url.searchParams.has("error")
        )
          return response({ error: "invalid_oauth_callback" }, 400, { "set-cookie": clear });
        const code = url.searchParams.get("code");
        if (!code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code))
          return response({ error: "invalid_oauth_callback" }, 400, { "set-cookie": clear });
        if (active >= 4) return response({ error: "auth_capacity_reached" }, 503, { "set-cookie": clear });
        active++;
        try {
          const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
          const result = await jsonBody(
            await transport(TOKEN, {
              method: "POST",
              redirect: "error",
              signal,
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: clientId!,
                client_secret: clientSecret!,
                redirect_uri: callback.href,
                grant_type: "authorization_code",
                code,
                code_verifier: transaction.verifier,
              }),
            }),
          );
          if (typeof result.id_token !== "string") throw new Error("Missing Google ID token");
          if (
            (result.access_token !== undefined &&
              (typeof result.access_token !== "string" || !result.access_token || result.token_type !== "Bearer")) ||
            (result.refresh_token !== undefined &&
              (typeof result.refresh_token !== "string" || !result.refresh_token)) ||
            (result.expires_in !== undefined &&
              (!Number.isSafeInteger(result.expires_in) || Number(result.expires_in) <= 0))
          )
            throw new Error("Invalid Google token response");
          const user = await verify(result.id_token, transaction.nonce, signal);
          const aliases: Record<string, string> = {
            "https://www.googleapis.com/auth/userinfo.email": "email",
            "https://www.googleapis.com/auth/userinfo.profile": "profile",
          };
          const scopes =
            typeof result.scope === "string"
              ? [
                  ...new Set(
                    result.scope
                      .split(" ")
                      .filter(Boolean)
                      .map(scope => aliases[scope] ?? scope),
                  ),
                ]
              : ["openid"];
          if (
            !scopes.includes("openid") ||
            scopes.some(scope => !transaction.scopes.includes(scope) || !allowedScopes.has(scope))
          )
            throw new Error("Unexpected Google scopes");
          if (onTokens)
            await onTokens(user, {
              ...(typeof result.access_token === "string" ? { accessToken: result.access_token } : {}),
              ...(typeof result.refresh_token === "string" ? { refreshToken: result.refresh_token } : {}),
              ...(typeof result.expires_in === "number" ? { expiresIn: result.expires_in } : {}),
              scopes,
            });
          const id = random();
          await store!.putSession(hash(id), { user, scopes, expiresAt: now() + ttl * 1000 });
          const prior = cookie(request, SESSION_COOKIE);
          if (prior) await store!.deleteSession(hash(prior));
          return redirect(new URL(transaction.returnTo, origin).href, [clear, setCookie(SESSION_COOKIE, id, ttl)]);
        } catch {
          return response({ error: "google_oauth_failed" }, 400, { "set-cookie": clear });
        } finally {
          active--;
        }
      } catch {
        return response({ error: "auth_store_unavailable" }, 503);
      }
    },
  };
}
