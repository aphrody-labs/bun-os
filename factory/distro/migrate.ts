// SPDX-License-Identifier: 0BSD
/**
 * Migrations, modelled on Omarchy's bin/omarchy-migrate (omacom/omarchy 84782475aeb8, 2026-10-29):
 * `migrations/<unix-timestamp>.sh` files, one empty marker file per applied migration in a per-user state
 * directory, a marker only after exit 0, a failure stops the run (later migrations do not run), `--pending`
 * lists what is left, a fresh install seeds every marker. Differences: `.ts` migrations run under the
 * running Bun, and the state directory is `~/.local/state/bunos/migrations` (override BUNOS_MIGRATION_STATE).
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const MIGRATION_NAME = /^(\d{10,})\.(sh|ts)$/;

export function defaultStateDir(env: Record<string, string | undefined> = process.env): string {
  if (env.BUNOS_MIGRATION_STATE) return env.BUNOS_MIGRATION_STATE;
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "bunos", "migrations");
}

/** Migration files sorted by numeric timestamp (lexical order is not enough once stamps differ in width). */
export async function listMigrations(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter(f => MIGRATION_NAME.test(f))
    .sort((a, b) => Number(a.match(MIGRATION_NAME)![1]) - Number(b.match(MIGRATION_NAME)![1]));
}

export async function pendingMigrations(dir: string, stateDir: string): Promise<string[]> {
  return (await listMigrations(dir)).filter(f => !existsSync(join(stateDir, f)));
}

/** First install: every shipped migration is already satisfied by the fresh configuration. */
export async function seedMigrations(dir: string, stateDir: string): Promise<string[]> {
  await mkdir(stateDir, { recursive: true });
  const all = await listMigrations(dir);
  for (const f of all) await writeFile(join(stateDir, f), "");
  return all;
}

export type MigrationRunner = (file: string, env: Record<string, string>) => Promise<number>;

export const spawnRunner: MigrationRunner = async (file, env) => {
  const argv = file.endsWith(".ts") ? [process.execPath, file] : ["bash", "-euo", "pipefail", file];
  const proc = Bun.spawn(argv, {
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  return await proc.exited;
};

export interface MigrateOptions {
  dir: string;
  stateDir?: string;
  runner?: MigrationRunner;
  bunosPath?: string;
  /** libalpm database lock; the run waits for it (Omarchy: up to 900 s) and reports `locked` if it stays. */
  pacmanLock?: string;
  lockTimeoutMs?: number;
  log?: (line: string) => void;
}
export interface MigrateResult {
  ran: string[];
  failed?: { file: string; code: number };
  locked?: boolean;
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const stateDir = options.stateDir ?? defaultStateDir();
  const log = options.log ?? (line => console.log(line));
  const runner = options.runner ?? spawnRunner;
  const result: MigrateResult = { ran: [] };
  const deadline = Date.now() + (options.lockTimeoutMs ?? 900_000);
  while (options.pacmanLock && existsSync(options.pacmanLock)) {
    if (Date.now() >= deadline) return { ...result, locked: true };
    await Bun.sleep(Math.min(1000, Math.max(10, deadline - Date.now())));
  }
  await mkdir(stateDir, { recursive: true });
  for (const file of await pendingMigrations(options.dir, stateDir)) {
    log(`Running migration (${file})`);
    const code = await runner(join(options.dir, file), { BUNOS_PATH: options.bunosPath ?? "/usr/share/bunos" });
    if (code !== 0) return { ...result, failed: { file, code } };
    await writeFile(join(stateDir, file), "");
    result.ran.push(file);
  }
  return result;
}

/** Name for a new migration: the author date of the last commit, like omarchy-dev-add-migration. */
export function newMigrationName(unixSeconds: number, ext: "sh" | "ts" = "sh"): string {
  return `${Math.trunc(unixSeconds)}.${ext}`;
}
