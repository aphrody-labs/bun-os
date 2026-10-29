// SPDX-License-Identifier: Apache-2.0
/**
 * Redis/Valkey client factory over Bun's built-in `RedisClient` (ADR
 * sql-convergence D1/D7: Redis is cache/session only, never a system of
 * record).
 *
 * The module imports nothing from `bun` at load time (type-only import), so a
 * Next server bundle or a Node process may import it; `createRedisClient`
 * needs the Bun runtime and throws a clear error otherwise.
 *
 * Bun facts (bun-types 1.4.2): commands auto-connect; `maxRetries` exhausted
 * runs `onclose` and the client stays closed; `idleTimeout` (ms) closes the
 * connection without reconnecting. Long-lived services should therefore drop
 * a closed client and build a new one.
 */
import type { RedisClient, RedisOptions } from "bun";
import { type EnvSource, isUsableEnvValue } from "./env";

export type { RedisClient, RedisOptions } from "bun";

/** Default URL when no variable is set (local Redis/Valkey). */
export const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

/**
 * Options applied when the caller does not set them. They equal Bun's own
 * defaults and are spelled out so the policy is visible and testable.
 */
export const DEFAULT_REDIS_OPTIONS = {
  connectionTimeout: 10_000,
  autoReconnect: true,
  maxRetries: 20,
  enableOfflineQueue: true,
  enableAutoPipelining: true,
} as const satisfies RedisOptions;

export interface ResolveRedisUrlOptions {
  env?: EnvSource;
  /** Variable names tried in order. Default `["REDIS_URL", "VALKEY_URL"]`. */
  names?: readonly string[];
  /** Returned when no variable holds a usable value. Default {@link DEFAULT_REDIS_URL}. */
  fallback?: string;
}

/** First usable Redis URL from the environment, else the fallback (read at call time). */
export function resolveRedisUrl(options: ResolveRedisUrlOptions = {}): string {
  const env = options.env ?? (globalThis as { process?: { env?: EnvSource } }).process?.env ?? {};
  for (const name of options.names ?? ["REDIS_URL", "VALKEY_URL"]) {
    const value = env[name];
    if (isUsableEnvValue(value)) return value;
  }
  return options.fallback ?? DEFAULT_REDIS_URL;
}

/** Options passed to `new RedisClient` (defaults merged under the caller's values). */
export function redisOptions(options: RedisOptions = {}): RedisOptions {
  return { ...DEFAULT_REDIS_OPTIONS, ...options };
}

function redisClientConstructor(): typeof RedisClient {
  const bun = (globalThis as { Bun?: { RedisClient?: typeof RedisClient } }).Bun;
  if (!bun?.RedisClient) {
    throw new Error("@aphrody/sql/redis requires the Bun runtime (Bun.RedisClient).");
  }
  return bun.RedisClient;
}

/**
 * New Bun `RedisClient` for `url` (default {@link resolveRedisUrl}). The
 * connection opens on the first command.
 */
export function createRedisClient(url?: string, options: RedisOptions = {}): RedisClient {
  const BunRedisClient = redisClientConstructor();
  return new BunRedisClient(url ?? resolveRedisUrl(), redisOptions(options));
}
