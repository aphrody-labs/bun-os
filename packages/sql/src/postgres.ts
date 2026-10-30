// SPDX-License-Identifier: Apache-2.0
/**
 * PostgreSQL client factory over `Bun.SQL` (ADR sql-convergence D6/D7).
 *
 * `sqlOptions` is pure (no connection, testable); `createSql` builds a lazy
 * pool. Policies:
 * - pool: `max` 4, `idleTimeout` 30 s, `maxLifetime` 1800 s,
 *   `connectionTimeout` 10 s (the database hosts are shared by many processes);
 * - TLS `"auto"`: `"require"` for a non-loopback host unless the URL already
 *   selects a mode (`sslmode`, `ssl`, `tls`); loopback and Unix sockets stay
 *   plain;
 * - prepare `"auto"`: `false` behind a transaction pooler (PgBouncer port 6432,
 *   Supavisor 6543, Neon `-pooler`, `?pgbouncer=true`), otherwise Bun's default.
 * `"inherit"` leaves either setting to the URL and Bun's defaults, which is what
 * consumer wrappers use.
 * Bun.SQL has no COPY: use postgres.js or a Rust path for bulk ingest.
 */
import { SQL, type TransactionSQL } from "bun";
import { isLoopbackHost, isPoolerUrl, urlHost, urlSelectsTls } from "./env";

type BunSqlOptions = SQL.PostgresOrMySQLOptions;
/** TLS values accepted by Bun.SQL. */
export type SqlTls = NonNullable<BunSqlOptions["tls"]>;

export const DEFAULT_SQL_POOL = {
  max: 4,
  idleTimeout: 30,
  maxLifetime: 1_800,
  connectionTimeout: 10,
} as const;

export interface CreateSqlOptions {
  /** Pool size. Default 4. */
  max?: number;
  /** Seconds before an idle connection closes. Default 30. */
  idleTimeout?: number;
  /** Seconds before a connection is recycled. Default 1800. */
  maxLifetime?: number;
  /** Seconds to wait for a connection. Default 10. */
  connectionTimeout?: number;
  /** `application_name` reported to PostgreSQL. */
  applicationName?: string;
  /** Extra runtime parameters (merged after `application_name`). */
  connection?: Record<string, string | boolean | number>;
  /** Default `"auto"`; see the module comment. */
  tls?: SqlTls | "auto" | "inherit";
  /** Default `"auto"`; see the module comment. */
  prepare?: boolean | "auto" | "inherit";
  /** Return int8 values as `BigInt`. */
  bigint?: boolean;
  onconnect?: BunSqlOptions["onconnect"];
  onclose?: BunSqlOptions["onclose"];
}

/** TLS value chosen by the `"auto"` policy, or `undefined` to leave it to the URL. */
export function autoTls(url: string): SqlTls | undefined {
  if (urlSelectsTls(url)) return undefined;
  return isLoopbackHost(urlHost(url)) ? undefined : "require";
}

/** Bun.SQL constructor options for `url` (pure, opens nothing). Undefined keys are omitted. */
export function sqlOptions(url: string, options: CreateSqlOptions = {}): BunSqlOptions {
  const out: BunSqlOptions = {
    url,
    max: options.max ?? DEFAULT_SQL_POOL.max,
    idleTimeout: options.idleTimeout ?? DEFAULT_SQL_POOL.idleTimeout,
    maxLifetime: options.maxLifetime ?? DEFAULT_SQL_POOL.maxLifetime,
    connectionTimeout: options.connectionTimeout ?? DEFAULT_SQL_POOL.connectionTimeout,
  };

  const tls = options.tls ?? "auto";
  if (tls === "auto") {
    const chosen = autoTls(url);
    if (chosen !== undefined) out.tls = chosen;
  } else if (tls !== "inherit") {
    out.tls = tls;
  }

  const prepare = options.prepare ?? "auto";
  if (prepare === "auto") {
    if (isPoolerUrl(url)) out.prepare = false;
  } else if (prepare !== "inherit") {
    out.prepare = prepare;
  }

  if (options.applicationName !== undefined || options.connection !== undefined) {
    out.connection = {
      ...(options.applicationName !== undefined ? { application_name: options.applicationName } : {}),
      ...options.connection,
    };
  }
  if (options.bigint !== undefined) out.bigint = options.bigint;
  const { onconnect, onclose } = options;
  return {
    ...out,
    ...(onconnect !== undefined ? { onconnect } : {}),
    ...(onclose !== undefined ? { onclose } : {}),
  };
}

/** Lazy Bun.SQL pool for a PostgreSQL URL (connects on the first query). */
export function createSql(url: string, options: CreateSqlOptions = {}): SQL {
  return new SQL(sqlOptions(url, options));
}

export interface TransactionOptions {
  isolation?: "read committed" | "repeatable read" | "serializable";
  readOnly?: boolean;
  deferrable?: boolean;
  /** `SET LOCAL statement_timeout` in milliseconds for this transaction only. */
  statementTimeoutMs?: number;
  /** `SET LOCAL lock_timeout` in milliseconds for this transaction only. */
  lockTimeoutMs?: number;
}

/** `BEGIN` mode string for {@link TransactionOptions} (`""` when none). */
export function transactionMode(options: TransactionOptions = {}): string {
  const parts: string[] = [];
  if (options.isolation) parts.push(`isolation level ${options.isolation}`);
  if (options.readOnly !== undefined) parts.push(options.readOnly ? "read only" : "read write");
  if (options.deferrable !== undefined) parts.push(options.deferrable ? "deferrable" : "not deferrable");
  return parts.join(" ");
}

function timeoutMs(name: string, value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer (got ${value}).`);
  }
  return String(value);
}

/**
 * Runs `fn` in one transaction: `BEGIN` with the requested mode, optional
 * `SET LOCAL` timeouts, `COMMIT` on success and `ROLLBACK` on any error.
 */
export async function withTransaction<T>(
  sql: SQL,
  fn: (tx: TransactionSQL) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const body = async (tx: TransactionSQL): Promise<T> => {
    if (options.statementTimeoutMs !== undefined) {
      const ms = timeoutMs("statementTimeoutMs", options.statementTimeoutMs);
      await tx.unsafe(`SET LOCAL statement_timeout = ${ms}`);
    }
    if (options.lockTimeoutMs !== undefined) {
      const ms = timeoutMs("lockTimeoutMs", options.lockTimeoutMs);
      await tx.unsafe(`SET LOCAL lock_timeout = ${ms}`);
    }
    return fn(tx);
  };
  const mode = transactionMode(options);
  const result = mode ? await sql.begin(mode, body) : await sql.begin(body);
  return result as T;
}
