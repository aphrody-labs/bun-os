#!/usr/bin/env bun
/** Read-only domain qualification and thin native Docker/Bun storage launch adapter. */
import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import contract from "../config/storage-runtime.json";
import { operationsContext, repositoryRoot } from "./aphrody-context";
import { checkBunRuntime } from "../validation/bun-runtime";

type Environment = Record<string, string | undefined>;
class StorageRuntimeError extends Error {}
type RuntimeConfig = {
  postgresUrl?: string;
  nativeLibraryPath?: string;
  backupDir?: string;
  backupFile?: string;
  backupVolume?: string;
};
export const MIRROR_TABLES = [
  "basara",
  "characters",
  "skills",
  "passives",
  "teams",
  "formations",
  "items",
  "quests",
  "capsules",
  "gallery",
  "uniforms",
  "drops_tables",
  "drops_battles",
  "drops_treasures",
].map(name => `inagle_${name}`);
type SqliteEvidence = {
  available: boolean;
  ready: boolean;
  integrity: boolean;
  requiredSchema: boolean;
  requiredData: boolean;
};
type Container = {
  Id?: string;
  Config?: { Labels?: Record<string, string> };
  State?: { Running?: boolean; Health?: { Status?: string } };
  NetworkSettings?: { Ports?: Record<string, { HostIp: string; HostPort: string }[] | null> };
};

function native(command: string[], env: Environment = process.env) {
  return Bun.spawnSync(command, {
    cwd: repositoryRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
}

export function sqliteEvidence(
  path: string | undefined,
  kind: "mirror" | "cfgbin",
  metadataDatabase?: string,
): SqliteEvidence {
  const empty = {
    available: false,
    ready: false,
    integrity: false,
    requiredSchema: false,
    requiredData: false,
  };
  if (!path || !existsSync(path)) return empty;
  const canonical = realpathSync(path);
  if (
    metadataDatabase &&
    existsSync(metadataDatabase) &&
    canonical.toLowerCase() === realpathSync(metadataDatabase).toLowerCase()
  )
    throw new StorageRuntimeError("The Aphrody metadata database is not an IECODE game source");
  if (!statSync(canonical).isFile() || !statSync(canonical).size) return empty;
  let database: Database | undefined;
  try {
    database = new Database(canonical, { readonly: true, strict: true });
    const integrity = database.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check === "ok";
    const names = new Set(
      database
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map(row => row.name),
    );
    const required = kind === "mirror" ? MIRROR_TABLES : ["cfgbin"];
    let requiredSchema = required.every(name => names.has(name));
    if (kind === "cfgbin" && requiredSchema) {
      const columns = new Set(
        database
          .query<{ name: string }, []>("PRAGMA table_info(cfgbin)")
          .all()
          .map(row => row.name),
      );
      requiredSchema = ["path", "cpk", "size", "parsed", "format", "error", "json"].every(name => columns.has(name));
    }
    const requiredData =
      kind === "cfgbin" ||
      (requiredSchema &&
        ["characters", "skills", "teams"].every(name =>
          Boolean(
            database!
              .query<{ present: number }, []>(`SELECT EXISTS(SELECT 1 FROM inagle_${name} LIMIT 1) AS present`)
              .get()?.present,
          ),
        ));
    return {
      available: true,
      ready: integrity && requiredSchema && requiredData,
      integrity,
      requiredSchema,
      requiredData,
    };
  } catch {
    return { ...empty, available: true };
  } finally {
    database?.close();
  }
}

export function ownedPostgres(container: Container, value: string | undefined): boolean {
  const labels = container.Config?.Labels;
  if (
    labels?.["com.docker.compose.project"] !== contract.project ||
    labels?.[contract.profileLabel] !== contract.profile ||
    labels?.["com.docker.compose.service"] !== contract.postgresService ||
    !container.State?.Running ||
    container.State.Health?.Status !== "healthy" ||
    !value
  )
    return false;
  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      decodeURIComponent(url.pathname.slice(1)) !== contract.postgresDatabase
    )
      return false;
    return Boolean(
      container.NetworkSettings?.Ports?.["5432/tcp"]?.some(
        port => ["127.0.0.1", "::1"].includes(port.HostIp) && port.HostPort === (url.port || "5432"),
      ),
    );
  } catch {
    return false;
  }
}

export function validateBackup(path: string | undefined, kind: "directory" | "file"): string | undefined {
  if (!path) return undefined;
  if (!existsSync(path)) throw new StorageRuntimeError("The explicitly configured IECODE backup source does not exist");
  const canonical = realpathSync(path),
    info = statSync(canonical);
  if ((kind === "directory" && !info.isDirectory()) || (kind === "file" && !info.isFile()))
    throw new StorageRuntimeError("The configured IECODE backup source has the wrong type");
  return canonical;
}

export function backupVolumes(directory?: string, file?: string) {
  return [
    [directory, "/backups"],
    [file, "/backup/input.dump"],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[0]))
    .map(([source, target]) => ({
      type: "bind",
      source,
      target,
      read_only: true,
      bind: { create_host_path: false },
    }));
}

function fileChecksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A read transaction includes committed WAL pages; no raw source-file copy is used. */
export async function sqliteSnapshot(source: string, destination: string) {
  if (!existsSync(source) || existsSync(destination))
    throw new StorageRuntimeError("SQLite snapshot requires an existing source and a new destination");
  const database = new Database(source, { readonly: true, strict: true });
  try {
    database.exec("BEGIN");
    const sourceSchema = database
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map(row => row.name);
    const sourceChecksum = fileChecksum(source);
    await Bun.write(destination, database.serialize(), { mode: 0o600 });
    // Make only the new owned snapshot standalone, so a read-only volume
    // needs no writable WAL sidecars. The source stays read-only.
    const standalone = new Database(destination);
    try {
      standalone.exec("PRAGMA journal_mode=DELETE");
    } finally {
      standalone.close();
    }
    const snapshot = new Database(destination, { readonly: true, strict: true });
    try {
      const integrity = snapshot.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check === "ok";
      const snapshotSchema = snapshot
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map(row => row.name);
      const schemaParity = JSON.stringify(sourceSchema) === JSON.stringify(snapshotSchema);
      const sourceUnchanged = sourceChecksum === fileChecksum(source);
      if (!integrity || !schemaParity || !sourceUnchanged)
        throw new StorageRuntimeError("SQLite snapshot failed integrity, schema parity or source preservation");
      return {
        kind: "sqlite" as const,
        integrity,
        schemaParity,
        sourceUnchanged,
        sha256: fileChecksum(destination),
        bytes: statSync(destination).size,
        tableCount: snapshotSchema.length,
      };
    } finally {
      snapshot.close();
    }
  } finally {
    database.exec("ROLLBACK");
    database.close();
  }
}

function bindFileArgument(source: string, destination: string): string {
  const fields = ["type=bind", `source=${source}`, `target=${destination}`, "readonly"];
  return fields.map(field => (/[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field)).join(",");
}

function ownedBackupVolume(name: string): boolean {
  if (!/^iecode-backup-[A-Za-z0-9_.-]+$/.test(name)) return false;
  const result = native(["docker", "volume", "inspect", name]);
  if (result.exitCode !== 0) return false;
  const volume = JSON.parse(result.stdout.toString())[0] as { Labels?: Record<string, string> };
  return (
    volume.Labels?.[contract.profileLabel] === contract.profile &&
    volume.Labels?.["io.aphrody.workspace"] === contract.project &&
    volume.Labels?.["io.aphrody.backup"] === "sqlite"
  );
}

/** Stream only the verified game snapshot when this Docker host cannot bind host files. */
async function streamSqliteVolume(path: string, checksum: string, suffix: string) {
  const name = `iecode-backup-${suffix}`;
  if (native(["docker", "volume", "inspect", name]).exitCode === 0)
    throw new StorageRuntimeError("The new IE backup volume name is already in use");
  const created = native([
    "docker",
    "volume",
    "create",
    "--label",
    `${contract.profileLabel}=${contract.profile}`,
    "--label",
    `io.aphrody.workspace=${contract.project}`,
    "--label",
    "io.aphrody.backup=sqlite",
    name,
  ]);
  if (created.exitCode !== 0 || !ownedBackupVolume(name))
    throw new StorageRuntimeError("Cannot create an isolated IE backup volume");
  const identityResult = native([
    "docker",
    "run",
    "--rm",
    "--pull",
    "never",
    "--network",
    "none",
    "--read-only",
    "--entrypoint",
    "bun",
    contract.bunImage,
    "-e",
    'console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),cli:Bun.spawnSync([process.execPath,"--version"]).stdout.toString().trim(),revision:Bun.revision}))',
  ]);
  if (identityResult.exitCode !== 0)
    throw new StorageRuntimeError("Cannot qualify the selected Bun container identity");
  const identity = JSON.parse(identityResult.stdout.toString()) as {
    uid: number;
    gid: number;
    cli: string;
    revision: string;
  };
  if (
    identity.cli !== contract.bunContainerVersion ||
    identity.revision !== contract.bunContainerRevision ||
    !Number.isInteger(identity.uid) ||
    !Number.isInteger(identity.gid)
  )
    throw new StorageRuntimeError("The selected Bun container does not match its qualified immutable artifact");
  const writer = Bun.spawn(
    [
      "docker",
      "run",
      "--rm",
      "--interactive",
      "--pull",
      "never",
      "--network",
      "none",
      "--read-only",
      "--entrypoint",
      "bun",
      "--user",
      "0:0",
      "--mount",
      `type=volume,source=${name},target=/backup,volume-nocopy`,
      contract.bunImage,
      "-e",
      `import{chownSync,chmodSync}from"node:fs";const writer=Bun.file("/backup/mirror.sqlite").writer();for await(const chunk of Bun.stdin.stream())writer.write(chunk);await writer.end();chownSync("/backup/mirror.sqlite",${identity.uid},${identity.gid});chmodSync("/backup/mirror.sqlite",0o600);chownSync("/backup",${identity.uid},${identity.gid});chmodSync("/backup",0o700);`,
    ],
    {
      cwd: repositoryRoot,
      stdin: Bun.file(path),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
  );
  if (await writer.exited)
    throw new StorageRuntimeError("Streaming the verified IE snapshot into its isolated volume failed");
  const verify = native(
    [
      "docker",
      "run",
      "--rm",
      "--pull",
      "never",
      "--network",
      "none",
      "--read-only",
      "--entrypoint",
      "bun",
      "--mount",
      `type=volume,source=${name},target=/backup,readonly,volume-nocopy`,
      "--env",
      "IECODE_BACKUP_SHA256",
      contract.bunImage,
      "-e",
      'import{Database}from"bun:sqlite";const file=Bun.file("/backup/mirror.sqlite");const checksum=new Bun.CryptoHasher("sha256").update(await file.bytes()).digest("hex");if(checksum!==process.env.IECODE_BACKUP_SHA256)process.exit(2);const database=new Database("/backup/mirror.sqlite",{readonly:true});if(database.query("PRAGMA quick_check").get().quick_check!=="ok")process.exit(3);database.close();',
    ],
    { ...process.env, IECODE_BACKUP_SHA256: checksum },
  );
  if (verify.exitCode !== 0)
    throw new StorageRuntimeError("The read-only IE backup volume failed checksum or SQLite integrity verification");
  return name;
}

async function backupStorage() {
  const state = await inspectStorage();
  const directory = state.backupDir ?? join(dirname(state.context.path), "backups");
  if (!state.backupDir) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const suffix = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(4).toString("hex")}`;
  let receipt: {
    kind: "sqlite" | "postgres";
    sha256: string;
    bytes: number;
    [key: string]: unknown;
  };
  let path: string;
  let backupVolume: string | undefined;
  if (state.report.selected === "sqlite") {
    path = join(directory, `ie-mirror-${suffix}.sqlite`);
    receipt = await sqliteSnapshot(state.childEnv.NIE_WIKI_DB!, path);
    const probe = native([
      "docker",
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--entrypoint",
      "bun",
      "--mount",
      bindFileArgument(path, "/backup/mirror.sqlite"),
      contract.bunImage,
      "-e",
      'import{Database}from"bun:sqlite";const d=new Database("/backup/mirror.sqlite",{readonly:true});if(d.query("PRAGMA quick_check").get().quick_check!=="ok")process.exit(1);d.close();',
    ]);
    if (probe.exitCode !== 0) {
      backupVolume = await streamSqliteVolume(path, receipt.sha256, suffix);
      receipt.mountMode = "ie-owned-volume";
      receipt.hostBindSupported = false;
    } else {
      receipt.mountMode = "host-read-only-bind";
      receipt.hostBindSupported = true;
    }
    receipt.containerMountVerified = true;
  } else if (state.report.selected === "postgres") {
    path = join(directory, `ie-postgres-${suffix}.dump`);
    await Bun.write(path, new Uint8Array(), { mode: 0o600 });
    const container = state.containers.find(item => ownedPostgres(item, state.childEnv.NIE_PG_URL));
    if (!container?.Id) throw new StorageRuntimeError("IE PostgreSQL ownership changed before backup");
    const dump = Bun.spawn(
      [
        "docker",
        "exec",
        container.Id,
        "pg_dump",
        "-U",
        contract.postgresUser,
        "-d",
        contract.postgresDatabase,
        "--format=custom",
      ],
      { cwd: repositoryRoot, stdout: Bun.file(path), stderr: "pipe" },
    );
    if (await dump.exited) throw new StorageRuntimeError("The owned IE PostgreSQL backup failed");
    const probe = native([
      "docker",
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--entrypoint",
      "pg_restore",
      "--mount",
      bindFileArgument(path, "/backup/input.dump"),
      contract.postgresImage,
      "--list",
      "/backup/input.dump",
    ]);
    if (probe.exitCode !== 0) throw new StorageRuntimeError("The owned IE PostgreSQL backup archive is invalid");
    receipt = {
      kind: "postgres",
      sha256: fileChecksum(path),
      bytes: statSync(path).size,
      archiveListVerified: true,
    };
  } else throw new StorageRuntimeError("No qualified IE SQLite or PostgreSQL source is available for backup");
  await Bun.write(
    `${path}.manifest.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        profile: contract.profile,
        project: contract.project,
        ...receipt,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await updateStorageRuntime({ backupFile: path, ...(backupVolume ? { backupVolume } : {}) });
  return { ...receipt, readOnlyMount: true, privateManifest: true };
}

export function selectStorage(options: {
  explicit?: string;
  gameAvailable?: boolean;
  postgres: boolean;
  sqlite: boolean;
  postgresDisabled?: boolean;
}): "postgres" | "sqlite" | "vfs" {
  const selected = options.explicit?.trim() || "auto";
  if (!["auto", "postgres", "sqlite", "vfs"].includes(selected))
    throw new Error("NIE_DATA_SOURCE must be auto, postgres, sqlite or vfs");
  if (selected === "postgres" && (options.postgresDisabled || !options.postgres))
    throw new Error("The selected IE PostgreSQL source is not qualified");
  if (selected === "sqlite" && !options.sqlite) throw new Error("The selected IE SQLite mirror is not qualified");
  if (selected !== "auto") return selected as "postgres" | "sqlite" | "vfs";
  return options.gameAvailable
    ? "vfs"
    : options.postgres && !options.postgresDisabled
      ? "postgres"
      : options.sqlite
        ? "sqlite"
        : "vfs";
}

function profileContext() {
  const result = native(["aphrody", "home", "--profile", contract.profile, "status"]);
  if (result.exitCode !== 0) throw new Error("Cannot resolve the isolated Aphrody IE profile");
  const status = JSON.parse(result.stdout.toString()) as {
    home: string;
    db: string;
    scope: string;
  };
  if (status.scope !== contract.profile || !status.home || !status.db)
    throw new Error("Invalid IE profile owner response");
  const path = join(status.home, contract.runtimeConfig);
  const runtime = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as RuntimeConfig) : {};
  return { home: status.home, metadataDatabase: status.db, path, runtime };
}

/** Merge the latest isolated profile state, retaining unrelated runtime fields. */
export async function updateStorageRuntime(patch: RuntimeConfig) {
  const context = profileContext();
  mkdirSync(dirname(context.path), { recursive: true, mode: 0o700 });
  const temporary = `${context.path}.${randomBytes(6).toString("hex")}.tmp`;
  await Bun.write(temporary, JSON.stringify({ ...context.runtime, ...patch }, null, 2), {
    mode: 0o600,
  });
  renameSync(temporary, context.path);
}

function postgresContainers(): Container[] {
  const list = native([
    "docker",
    "ps",
    "--all",
    "--filter",
    `label=com.docker.compose.project=${contract.project}`,
    "--filter",
    `label=${contract.profileLabel}=${contract.profile}`,
    "--filter",
    `label=com.docker.compose.service=${contract.postgresService}`,
    "--format",
    "{{.ID}}",
  ]);
  if (list.exitCode !== 0) return [];
  const ids = list.stdout.toString().trim().split(/\s+/).filter(Boolean);
  if (!ids.length) return [];
  const result = native(["docker", "inspect", ...ids]);
  return result.exitCode === 0 ? (JSON.parse(result.stdout.toString()) as Container[]) : [];
}

async function postgresReady(url: string): Promise<boolean> {
  let sql: SQL | undefined;
  try {
    sql = new SQL(url, { max: 1, connectionTimeout: 3, idleTimeout: 1 });
    const rows =
      await sql`SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name='inagle') AS ready`;
    if (rows[0]?.ready !== true) return false;
    const tables =
      await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'inagle_%'`;
    const names = new Set(tables.map((row: { table_name: string }) => row.table_name));
    if (!MIRROR_TABLES.every(name => names.has(name))) return false;
    const data =
      await sql`SELECT EXISTS(SELECT 1 FROM public.inagle_characters LIMIT 1) AND EXISTS(SELECT 1 FROM public.inagle_skills LIMIT 1) AND EXISTS(SELECT 1 FROM public.inagle_teams LIMIT 1) AS ready`;
    return data[0]?.ready === true;
  } catch {
    return false;
  } finally {
    await sql?.close({ timeout: 1 });
  }
}

export async function inspectStorage(env: Environment = process.env) {
  operationsContext(repositoryRoot, env);
  const context = profileContext();
  // The selected Workspace owns this launcher; legacy dotenv checkout paths
  // cannot redirect it to a foreign host or another domain profile.
  const root = repositoryRoot;
  const mirrorPath = env.NIE_WIKI_DB || env.NIE_MIRROR_DB || join(root, contract.mirror);
  const cachePath = env.IEVR_CFGBIN_DB || join(root, contract.cfgbinCache);
  if ((env.NIE_WIKI_DB || env.NIE_MIRROR_DB) && !existsSync(mirrorPath))
    throw new Error("The explicitly selected IE SQLite mirror is unavailable");
  if (env.IEVR_CFGBIN_DB && !existsSync(cachePath))
    throw new Error("The explicitly selected IE cfgbin cache is unavailable");
  const mirror = sqliteEvidence(mirrorPath, "mirror", context.metadataDatabase);
  const cache = sqliteEvidence(cachePath, "cfgbin", context.metadataDatabase);
  const url = env.NIE_PG_URL || context.runtime.postgresUrl;
  const containers = postgresContainers();
  const container = containers.find(item => ownedPostgres(item, url));
  const pgIsReady = container?.Id
    ? native([
        "docker",
        "exec",
        container.Id,
        "pg_isready",
        "-U",
        contract.postgresUser,
        "-d",
        contract.postgresDatabase,
      ]).exitCode === 0
    : false;
  const postgres = Boolean(pgIsReady && url && (await postgresReady(url)));
  const selected = selectStorage({
    explicit: env.NIE_DATA_SOURCE || env.INAGLE_DATA_SOURCE,
    postgres,
    sqlite: mirror.ready,
    postgresDisabled: env.IEVR_CFGBIN_POSTGRES === "0",
  });
  const backupDir = validateBackup(env.NIE_BACKUP_DIR || context.runtime.backupDir, "directory");
  const backupFile = validateBackup(context.runtime.backupFile, "file");
  if (context.runtime.backupVolume && !ownedBackupVolume(context.runtime.backupVolume))
    throw new StorageRuntimeError("The configured backup volume is not owned by the IE profile");
  let gameAvailable = false;
  const childEnv: Environment = {
    ...env,
    IECODE_ROOT: root,
    NIE_DATA_SOURCE: selected,
    INAGLE_DATA_SOURCE: selected,
  };
  if (context.runtime.nativeLibraryPath) childEnv.IECODE_LIB_PATH = context.runtime.nativeLibraryPath;
  if (selected === "postgres") childEnv.NIE_PG_URL = url;
  if (mirror.ready) childEnv.NIE_WIKI_DB = realpathSync(mirrorPath);
  if (cache.ready) childEnv.IEVR_CFGBIN_DB = realpathSync(cachePath);
  if (childEnv.IECODE_LIB_PATH && existsSync(childEnv.IECODE_LIB_PATH)) {
    const probe = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        'import {locateGameSource} from "@aphrody/inagle/ffi";const source=locateGameSource(process.env.NIE_GAME_DIR);if(!source.source)process.exit(1);',
      ],
      { cwd: repositoryRoot, env: childEnv, stdout: "pipe", stderr: "pipe", timeout: 10_000 },
    );
    gameAvailable = probe.exitCode === 0;
  }
  const report = {
    profile: contract.profile,
    project: contract.project,
    selected,
    postgres: { ownedContainers: containers.length, ready: postgres },
    mirror,
    cfgbinCache: cache,
    gameAvailable,
    nativeLibraryAvailable: Boolean(childEnv.IECODE_LIB_PATH && existsSync(childEnv.IECODE_LIB_PATH)),
    backups: {
      directoryConfigured: Boolean(backupDir),
      fileConfigured: Boolean(backupFile),
      volumeConfigured: Boolean(context.runtime.backupVolume),
      readOnly: true,
    },
  };
  return { report, childEnv, context, containers, backupDir, backupFile };
}

async function setupStorage() {
  const state = await inspectStorage();
  if (state.containers.length)
    throw new Error("An IE-owned PostgreSQL service already exists; setup will not initialize or restore it");
  const priorVolume = native(["docker", "volume", "inspect", `${contract.project}_ie-postgres-data`]);
  if (priorVolume.exitCode === 0)
    throw new StorageRuntimeError(
      "An IE PostgreSQL data volume already exists; setup will not initialize or restore it",
    );
  const runtimeDir = dirname(state.context.path),
    passwordFile = join(runtimeDir, "secrets", "postgres-password");
  mkdirSync(dirname(passwordFile), { recursive: true, mode: 0o700 });
  if (!existsSync(passwordFile)) await Bun.write(passwordFile, randomBytes(32).toString("base64url"), { mode: 0o600 });
  const files = ["--file", join(repositoryRoot, "config/container/compose.storage.yaml")];
  if (state.backupDir || state.backupFile) {
    const override = join(runtimeDir, "compose.storage.override.json");
    const backupVolume = state.context.runtime.backupVolume;
    const volumes = backupVolume
      ? [
          {
            type: "volume",
            source: backupVolume,
            target: "/backup",
            read_only: true,
            volume: { nocopy: true },
          },
        ]
      : backupVolumes(state.backupDir, state.backupFile);
    await Bun.write(
      override,
      JSON.stringify({
        services: { postgres: { volumes }, bun: { volumes } },
        ...(backupVolume ? { volumes: { [backupVolume]: { external: true } } } : {}),
      }),
    );
    files.push("--file", override);
  }
  const args = ["docker", "compose", "--project-name", contract.project, ...files];
  const composeEnv = { ...process.env, IECODE_PG_PASSWORD_FILE: passwordFile };
  const validation = native([...args, "config", "--quiet"], composeEnv);
  if (validation.exitCode !== 0) throw new Error("The IE storage Compose contract is invalid");
  const processHandle = Bun.spawn([...args, "up", "--detach", "--wait", "--wait-timeout", "120", "postgres"], {
    cwd: repositoryRoot,
    env: composeEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (await processHandle.exited) throw new Error("The new isolated IE PostgreSQL service did not become healthy");
  const container = postgresContainers()[0];
  const port = container?.NetworkSettings?.Ports?.["5432/tcp"]?.find(item => item.HostIp === "127.0.0.1")?.HostPort;
  if (!port) throw new Error("The IE PostgreSQL service lacks an isolated loopback port");
  const password = readFileSync(passwordFile, "utf8").trim();
  const url = `postgresql://${contract.postgresUser}:${encodeURIComponent(password)}@127.0.0.1:${port}/${contract.postgresDatabase}`;
  const sql = new SQL(url, { max: 1, connectionTimeout: 3 });
  try {
    await sql`CREATE SCHEMA IF NOT EXISTS inagle`;
  } finally {
    await sql.close({ timeout: 1 });
  }
  await updateStorageRuntime({ postgresUrl: url });
  return (await inspectStorage()).report;
}

if (import.meta.main) {
  try {
    await checkBunRuntime(repositoryRoot);
    const [operation = "status", ...args] = process.argv.slice(2);
    if (operation === "status") console.log(JSON.stringify((await inspectStorage()).report, null, 2));
    else if (operation === "backup") console.log(JSON.stringify(await backupStorage(), null, 2));
    else if (operation === "setup") console.log(JSON.stringify(await setupStorage(), null, 2));
    else if (operation === "run") {
      const command = args[0] === "--" ? args.slice(1) : args;
      if (!command.length) throw new Error("storage run requires an explicit command");
      const state = await inspectStorage();
      if (command[0] === "bun") command[0] = process.execPath;
      const child = Bun.spawn(command, {
        cwd: repositoryRoot,
        env: state.childEnv,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      process.exitCode = await child.exited;
    } else throw new Error("Use storage status, setup, or run -- <command>");
  } catch (error) {
    const safeMessage =
      error instanceof StorageRuntimeError
        ? error.message
        : "IE storage operation failed; check isolated runtime configuration and service readiness";
    console.error(safeMessage);
    process.exitCode = 1;
  }
}
