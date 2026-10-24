// SPDX-License-Identifier: Apache-2.0
// One-time, non-destructive import into the dedicated, empty WebOS PostgreSQL service.
import { chmod, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
if (process.platform !== "linux")
  throw new Error("Run database migration on the VPS");
const app = resolve(Bun.env.WEBOS_HOME ?? join(Bun.env.HOME!, "apps/webos"));
const sourceFile = Bun.env.WEBOS_SOURCE_DATABASE_URL_FILE;
if (!sourceFile)
  throw new Error(
    "Set WEBOS_SOURCE_DATABASE_URL_FILE to the protected source connection reference",
  );
const source = new URL((await Bun.file(sourceFile).text()).trim());
if (source.pathname !== "/bun_site" || !source.hostname.endsWith(".neon.tech"))
  throw new Error("Expected the existing bun_site source");
const backup = join(app, "backups", `bun-site-${Date.now()}.dump`);
await mkdir(join(app, "backups"), { recursive: true, mode: 0o700 });
await mkdir(join(app, "secrets"), { recursive: true, mode: 0o700 });
const dump = Bun.spawn(
  [
    "pg_dump",
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--schema=aphrody_site",
    "--file",
    backup,
  ],
  {
    env: {
      ...Bun.env,
      PGHOST: source.hostname,
      PGPORT: source.port || "5432",
      PGDATABASE: "bun_site",
      PGUSER: decodeURIComponent(source.username),
      PGPASSWORD: decodeURIComponent(source.password),
      PGSSLMODE: "require",
      PGCONNECT_TIMEOUT: "15",
    },
    stdout: "ignore",
    stderr: "pipe",
    timeout: 180000,
  },
);
if (await dump.exited)
  throw new Error("Source backup failed; protected diagnostics withheld");
await chmod(backup, 0o600);
async function psql(sql: string) {
  const child = Bun.spawn(
    [
      "docker",
      "exec",
      "-i",
      "aphrody-webos-db",
      "psql",
      "-U",
      "webos_owner",
      "-d",
      "bun_site",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  child.stdin.write(sql);
  child.stdin.end();
  const [out, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code)
    throw new Error(
      "Local PostgreSQL migration failed; protected diagnostics withheld",
    );
  return out.trim();
}
if (
  (await psql(
    "SELECT count(*) FROM information_schema.schemata WHERE schema_name='aphrody_site';",
  )) !== "0"
)
  throw new Error("Destination already has site data; refusing to replace it");
const restore = Bun.spawn(
  [
    "docker",
    "exec",
    "-i",
    "aphrody-webos-db",
    "pg_restore",
    "-U",
    "webos_owner",
    "-d",
    "bun_site",
    "--no-owner",
    "--no-acl",
    "--single-transaction",
  ],
  {
    stdin: Bun.file(backup),
    stdout: "ignore",
    stderr: "pipe",
    timeout: 180000,
  },
);
if (await restore.exited)
  throw new Error("Backup restore failed; destination transaction rolled back");
const password =
  crypto.randomUUID().replaceAll("-", "") +
  crypto.randomUUID().replaceAll("-", "");
await psql(`REVOKE ALL ON DATABASE bun_site FROM PUBLIC;
CREATE ROLE webos_reader LOGIN PASSWORD '${password}';
GRANT CONNECT ON DATABASE bun_site TO webos_reader;
GRANT USAGE ON SCHEMA aphrody_site TO webos_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA aphrody_site TO webos_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE webos_owner IN SCHEMA aphrody_site GRANT SELECT ON TABLES TO webos_reader;
ALTER ROLE webos_reader SET default_transaction_read_only=on;
ALTER ROLE webos_reader SET statement_timeout='8s';`);
const reader = join(app, "secrets/database.url");
await Bun.write(
  reader,
  `postgres://webos_reader:${password}@127.0.0.1:15434/bun_site\n`,
  { mode: 0o600 },
);
await chmod(reader, 0o600);
const tables = (
  await psql(
    "SELECT tablename FROM pg_tables WHERE schemaname='aphrody_site' ORDER BY tablename;",
  )
).split("\n");
const remote = new Bun.SQL(source.href, { max: 1, connectionTimeout: 15 });
const counts: Record<string, number> = {};
for (const table of tables) {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected source table name");
  const query = `SELECT count(*)::int AS count FROM aphrody_site.${table}`;
  const before = await remote.unsafe(query);
  const after = Number(await psql(query));
  if (before[0].count !== after)
    throw new Error(`Migration count differs for ${table}`);
  counts[table] = after;
}
await remote.close();
await Bun.write(
  join(app, "database-migration.json"),
  JSON.stringify(
    {
      migratedAt: new Date().toISOString(),
      backup,
      counts,
      sourcePreserved: true,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ migrated: true, counts, sourcePreserved: true }));
