// SPDX-License-Identifier: Apache-2.0
/**
 * Profile management & multi-account credential resolution for OVHcloud.
 *
 * Resolves the segregated accounts and domain sets of the Aphrody infrastructure:
 *  - aphrody.com: aphrody.com (host secret file, env vars)
 *
 * Authentication priority: OAuth2 service account from the environment (OVH_CLIENT_ID /
 * OVH_CLIENT_SECRET), then `client_id` / `client_secret` of a profile file, then the legacy
 * application key triplet. The service account belongs to the aphrody account only.
 *
 * `rpbey.fr` was reported sold (operator decision, docs/PLAN.md) and is intentionally excluded
 * from the managed profile. A 2026-09-29 read-only zone-list call still showed it on the account;
 * visibility does not establish ownership or authorize changes.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OvhClient, selectAuthMode, type OvhAuthMode, type OvhClientOptions, type OvhEndpoint } from "./client.js";

export interface ProfileDefinition {
  id: string;
  name: string;
  region: OvhEndpoint;
  domains: string[];
  candidatePaths: string[];
}

export const KNOWN_PROFILES: Record<string, ProfileDefinition> = {
  "aphrody.com": {
    id: "aphrody.com",
    name: "Aphrody Core (aphrody.com)",
    region: "ovh-eu",
    domains: ["aphrody.com"],
    candidatePaths: [join(homedir(), ".bash_secrets"), join(homedir(), ".config", "ovh", "aphrody.conf")],
  },
};

/** Per-user file holding the service account as `export OVH_CLIENT_ID=...` lines (outside the repo). */
export const SERVICE_ACCOUNT_ENV_FILE = join(homedir(), ".config", "aphrody", "ovh.env");

export interface ResolvedCredentials extends OvhClientOptions {
  endpoint: OvhEndpoint;
  authMode: OvhAuthMode;
  source: string;
}

/** Keeps secrets out of logs: only the mode, endpoint and source are printable. */
export function describeCredentials(creds: ResolvedCredentials): string {
  return `${creds.authMode} (${creds.endpoint}) from ${creds.source}`;
}

/**
 * Parses credentials from a bash export file, an INI file, or an env-like file. Returns the OAuth2
 * pair and/or the application key triplet found; null when neither is complete.
 */
export function parseCredentialsText(content: string, _sourceLabel: string): OvhClientOptions | null {
  const bash = (name: string): string | undefined =>
    content.match(new RegExp(`^\\s*(?:export\\s+)?(?:OVH_)?${name}\\s*=\\s*["']?([^"'\\s#]+)["']?`, "m"))?.[1];
  const ini = (key: string): string | undefined => {
    const rx = new RegExp(`^\\s*(?:dns_ovh_)?${key}\\s*=\\s*(.+)\\s*$`, "m");
    return content
      .match(rx)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
  };
  const pick = (upper: string, ...lower: string[]): string | undefined => bash(upper) ?? lower.map(ini).find(Boolean);

  const options: OvhClientOptions = {
    clientId: pick("CLIENT_ID", "client_id"),
    clientSecret: pick("CLIENT_SECRET", "client_secret"),
    applicationKey: pick("APPLICATION_KEY", "application_key", "app_key"),
    applicationSecret: pick("APPLICATION_SECRET", "application_secret", "app_secret"),
    consumerKey: pick("CONSUMER_KEY", "consumer_key"),
    endpoint: (pick("ENDPOINT", "endpoint") as OvhEndpoint | undefined) || "ovh-eu",
  };
  return selectAuthMode(options) ? options : null;
}

/** Keeps the OAuth2 pair when complete, else the triplet; never mixes partial halves. */
function resolveParsed(
  parsed: OvhClientOptions,
  endpoint: OvhEndpoint,
  source: string,
  only?: OvhAuthMode,
): ResolvedCredentials | null {
  const mode = selectAuthMode(parsed);
  if (!mode || (only && mode !== only)) {
    // A file with both kinds still serves the requested mode.
    if (only === "application_key" && selectAuthMode({ ...parsed, clientId: undefined })) {
      return resolveParsed({ ...parsed, clientId: undefined }, endpoint, source, only);
    }
    return null;
  }
  const base =
    mode === "oauth2"
      ? { clientId: parsed.clientId, clientSecret: parsed.clientSecret }
      : {
          applicationKey: parsed.applicationKey,
          applicationSecret: parsed.applicationSecret,
          consumerKey: parsed.consumerKey,
        };
  return { ...base, endpoint, authMode: mode, source };
}

function readParsed(path: string): OvhClientOptions | null {
  if (!existsSync(path)) return null;
  try {
    return parseCredentialsText(readFileSync(path, "utf8"), path);
  } catch {
    return null;
  }
}

function matchProfile(profileOrDomain?: string): ProfileDefinition | undefined {
  const target = profileOrDomain?.toLowerCase() ?? "aphrody.com";
  const direct = KNOWN_PROFILES[target];
  if (direct) return direct;
  for (const prof of Object.values(KNOWN_PROFILES)) {
    if (prof.domains.some(d => d === target || target.endsWith(`.${d}`))) return prof;
  }
  if (target === "aphrody" || target === "vps") return KNOWN_PROFILES["aphrody.com"];
  return undefined;
}

/**
 * Loads credentials for a profile, domain, or explicit file path.
 * Order: env OAuth2 -> profile OAuth2 -> env triplet (no profile) -> profile triplet -> ~/.ovh.conf.
 */
export function loadCredentials(
  profileOrDomain?: string,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): ResolvedCredentials {
  const envEp = (env.OVH_ENDPOINT as OvhEndpoint) || "ovh-eu";
  const matched = matchProfile(profileOrDomain);
  const isAphrody = !profileOrDomain || matched === KNOWN_PROFILES["aphrody.com"];
  const explicit = profileOrDomain && existsSync(profileOrDomain) ? readParsed(profileOrDomain) : null;

  // 1. Service account from the environment (belongs to the aphrody account only).
  if (isAphrody && env.OVH_CLIENT_ID && env.OVH_CLIENT_SECRET) {
    return {
      clientId: env.OVH_CLIENT_ID,
      clientSecret: env.OVH_CLIENT_SECRET,
      endpoint: envEp,
      authMode: "oauth2",
      source: "environment_variables",
    };
  }

  const files: string[] = [];
  if (explicit && profileOrDomain) files.push(profileOrDomain);
  if (isAphrody) files.push(join(home, ".config", "aphrody", "ovh.env"));
  files.push(...(matched?.candidatePaths ?? []), join(home, ".ovh.conf"));
  const parsedFiles = files.map(path => ({ path, parsed: readParsed(path) }));

  // 2. Profile OAuth2 pair.
  for (const { path, parsed } of parsedFiles) {
    const r = parsed && resolveParsed(parsed, matched?.region ?? (parsed.endpoint as OvhEndpoint), path, "oauth2");
    if (r) return r;
  }

  // 3. Legacy triplet: environment (no profile), then profile files.
  const envAk = env.OVH_APPLICATION_KEY || env.OVH_APP_KEY;
  const envAs = env.OVH_APPLICATION_SECRET || env.OVH_APP_SECRET;
  const envCk = env.OVH_CONSUMER_KEY;
  const envTriplet: ResolvedCredentials | null =
    envAk && envAs && envCk
      ? {
          applicationKey: envAk,
          applicationSecret: envAs,
          consumerKey: envCk,
          endpoint: envEp,
          authMode: "application_key",
          source: "environment_variables",
        }
      : null;
  if (!profileOrDomain && envTriplet) return envTriplet;
  for (const { path, parsed } of parsedFiles) {
    const r =
      parsed &&
      resolveParsed(parsed, (parsed.endpoint as OvhEndpoint) || matched?.region || "ovh-eu", path, "application_key");
    if (r) return r;
  }
  if (envTriplet) return envTriplet;

  throw new Error(
    `No valid OVH credentials found for '${profileOrDomain ?? "default"}'. ` +
      `Provide OVH_CLIENT_ID and OVH_CLIENT_SECRET (service account), or OVH_APPLICATION_KEY, ` +
      `OVH_APPLICATION_SECRET and OVH_CONSUMER_KEY, or configure ~/.config/ovh/<profile>.conf.`,
  );
}

/**
 * Creates an authenticated OvhClient for the requested profile, domain or credentials source.
 */
export function createClient(profileOrDomain?: string): OvhClient {
  const { source: _source, authMode: _mode, ...options } = loadCredentials(profileOrDomain);
  return new OvhClient(options);
}
