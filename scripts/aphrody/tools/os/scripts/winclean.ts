#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Native Windows inventory and narrowly scoped stale-temp cleanup.
 *
 * Default: read-only inventory and a SHA-256 cleanup plan.
 * Apply: bun scripts/tools/os/scripts/winclean.ts --apply --confirm <plan-sha256>
 *
 * Cleanup is limited to old, direct child .tmp/.temp files in the current user's
 * TEMP directory. Persistent build caches, projects, Docker data, provider state,
 * SSH/WireGuard credentials, VNC state, services and system settings are preserved.
 */

import { createHash } from "node:crypto";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { isElevated, knownFolder, processes, windowsHost } from "@aphrody/winclean/windows-host";

const SCHEMA = "aphrody.winclean.local.v1";
const PROCESS_FILTER = /bun|rust|cargo|docker|claude|agy|vnc|wireguard|ssh|aphrody/i;
const PROTECTED_NAME =
  /cookie|session|credential|secret|token|identity|known_hosts|wireguard|ssh|vnc|docker|claude|agy|\.db(?:$|[.-])|\.sqlite/i;
const CACHE_DISPOSITION = "inventory only; retained";

interface Options {
  apply: boolean;
  confirm?: string;
  ageDays: number;
}

interface Candidate {
  path: string;
  size: number;
  mtimeMs: number;
}

function parseOptions(args: string[]): Options {
  const result: Options = { apply: false, ageDays: 30 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun scripts/tools/os/scripts/winclean.ts [--age-days N] [--apply --confirm SHA256]\n" +
          "Default is read-only. Apply only removes unchanged direct-child .tmp/.temp files in %TEMP% older than N days. N must be at least 30.",
      );
      process.exit(0);
    }
    if (arg === "--apply") {
      result.apply = true;
      continue;
    }
    if (arg === "--confirm") {
      result.confirm = args[++i];
      continue;
    }
    if (arg === "--age-days") {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 30 || value > 3650)
        throw new Error("--age-days must be an integer from 30 to 3650");
      result.ageDays = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (result.apply && !/^[a-f0-9]{64}$/i.test(result.confirm ?? ""))
    throw new Error("--apply requires --confirm <64-character SHA-256 from the current dry-run>");
  if (!result.apply && result.confirm) throw new Error("--confirm is valid only with --apply");
  return result;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required Windows environment variable ${name} is unset`);
  return value;
}

async function collectCandidates(tempRoot: string, ageDays: number, now = Date.now()): Promise<Candidate[]> {
  const cutoff = now - ageDays * 24 * 60 * 60 * 1000;
  const candidates: Candidate[] = [];
  // Use Bun's native globber only at this exact directory level. The prebuilt
  // repository fsindex is not a machine-wide index and cannot safely inventory TEMP.
  const paths = new Bun.Glob("*.{tmp,temp}").scanSync({
    cwd: tempRoot,
    absolute: true,
    onlyFiles: true,
    followSymlinks: false,
    dot: true,
  });
  await Promise.all(
    Array.from(paths, async path => {
      const name = basename(path);
      if (PROTECTED_NAME.test(name)) return;
      try {
        const file = Bun.file(path);
        const stat = await file.stat();
        if (!stat.isFile() || stat.mtimeMs > cutoff) return;
        candidates.push({ path, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // A concurrently removed or inaccessible item is omitted from the plan.
      }
    }),
  );
  return candidates.toSorted((a, b) => a.path.localeCompare(b.path, "en-US"));
}

function planDigest(machine: string, tempRoot: string, ageDays: number, candidates: Candidate[]): string {
  const payload = JSON.stringify({
    schema: SCHEMA,
    machine: machine.toUpperCase(),
    tempRoot: tempRoot.toUpperCase(),
    ageDays,
    candidates: candidates.map(({ path, size, mtimeMs }) => ({
      path: path.toUpperCase(),
      size,
      mtimeMs,
    })),
  });
  return createHash("sha256").update(payload).digest("hex");
}

async function cacheInventory(profile: string, localAppData: string) {
  const roots = [
    {
      name: "Bun install cache",
      path: join(profile, ".bun", "install", "cache"),
    },
    {
      name: "Cargo registry archives",
      path: join(profile, ".cargo", "registry", "cache"),
    },
    {
      name: "Cargo registry sources",
      path: join(profile, ".cargo", "registry", "src"),
    },
    { name: "Cargo git database", path: join(profile, ".cargo", "git") },
    {
      name: "sccache",
      path: process.env.SCCACHE_DIR ?? join(localAppData, "Mozilla", "sccache", "cache"),
    },
    { name: "Docker data", path: join(localAppData, "Docker") },
    { name: "Claude provider store", path: join(profile, ".claude") },
    { name: "Codex provider store", path: join(profile, ".codex") },
    {
      name: "Antigravity / agy store",
      path: join(profile, ".gemini", "antigravity-cli"),
    },
    {
      name: "VNC credentials store",
      path: join(profile, ".aphrody", "private", "docker"),
    },
    {
      name: "WireGuard configuration store",
      path: join(process.env.ProgramFiles ?? "C:\\Program Files", "WireGuard", "Data", "Configurations"),
    },
    { name: "SSH store", path: join(profile, ".ssh") },
  ];
  return Promise.all(
    roots.map(async ({ name, path }) => {
      let exists = false;
      try {
        await Bun.file(path).stat();
        exists = true;
      } catch {
        // Missing inventory roots are expected.
      }
      return {
        name,
        exists,
        path,
        disposition: /provider|agy|VNC|WireGuard|SSH/i.test(name)
          ? "protected; never scanned or modified"
          : CACHE_DISPOSITION,
      };
    }),
  );
}

function localProfile(machine: string): Record<string, unknown> {
  const result = Bun.spawnSync(["aphrody", "winclean", "call", "get_os_info", "--json"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`Local WinClean get_os_info failed (exit ${result.exitCode})`);
  let payload: any;
  try {
    payload = JSON.parse(result.stdout.toString("utf8"));
  } catch {
    throw new Error("Local WinClean returned invalid JSON for get_os_info");
  }
  const os = payload?.structuredContent;
  if (!os || String(os.MachineName).toUpperCase() !== machine.toUpperCase())
    throw new Error("WinClean CLI and the Windows host report different machines; refusing cleanup");
  return os as Record<string, unknown>;
}

async function applyCandidates(
  tempRoot: string,
  candidates: Candidate[],
): Promise<{ removed: Candidate[]; errors: string[] }> {
  const removed: Candidate[] = [];
  const errors: string[] = [];
  const root = resolve(tempRoot);
  // eslint-disable-next-line no-await-in-loop -- apply and verify each leaf before continuing
  for (const candidate of candidates) {
    try {
      const fullPath = resolve(candidate.path);
      const rel = relative(root, fullPath);
      if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || resolve(root, rel) !== fullPath)
        throw new Error("path is outside TEMP");
      if (basename(fullPath) !== basename(candidate.path) || !/\.(?:tmp|temp)$/i.test(extname(fullPath)))
        throw new Error("path no longer matches the temporary-file allowlist");
      const file = Bun.file(fullPath);
      // eslint-disable-next-line no-await-in-loop -- re-stat immediately before unlink
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== candidate.size || stat.mtimeMs !== candidate.mtimeMs)
        throw new Error("file changed since the confirmed plan");
      // The exact validated leaf is unlinked through Bun's native file API.
      // Keep deletes serialized so each result is verified before continuing.
      // eslint-disable-next-line no-await-in-loop -- deletion order is intentional
      await file.delete();
      try {
        // eslint-disable-next-line no-await-in-loop -- verify deletion before next item
        await file.stat();
        throw new Error("Bun returned but the file still exists");
      } catch (error) {
        if (error instanceof Error && error.message === "Bun returned but the file still exists") throw error;
      }
      removed.push(candidate);
    } catch (error) {
      errors.push(`${candidate.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { removed, errors };
}

async function main(): Promise<void> {
  if (process.platform !== "win32") throw new Error("This script requires native Windows");
  const windows = windowsHost();

  const options = parseOptions(process.argv.slice(2));
  const system = windows.systemInfo;
  const machine = String(system.computerName);
  const profile = knownFolder("Profile");
  const localAppData = knownFolder("LocalAppData");
  const tempEnvPath = resolve(requiredEnv("TEMP"));
  const expectedTempPath = resolve(localAppData, "Temp");
  if (tempEnvPath.toUpperCase() !== expectedTempPath.toUpperCase())
    throw new Error("TEMP must resolve to the current user's LocalAppData\\Temp folder");
  const tempRoot = tempEnvPath;
  if (!(await Bun.file(tempRoot).stat()).isDirectory()) throw new Error("TEMP is not a directory");
  if (tempRoot.toUpperCase() === resolve(tempRoot, "..").toUpperCase()) throw new Error("Refusing an unsafe TEMP root");

  const runningProcesses = processes()
    .filter(item => PROCESS_FILTER.test(String(item.name)))
    .map(item => ({ pid: item.pid, name: item.name }));
  const services = windows.services
    .list()
    .filter(item => PROCESS_FILTER.test(`${item.name} ${item.displayName}`))
    .map(item => ({
      name: item.name,
      displayName: item.displayName,
      state: item.state,
    }));
  const candidates = await collectCandidates(tempRoot, options.ageDays);
  const digest = planDigest(machine, tempRoot, options.ageDays, candidates);
  const disk = windows.storage.drives();
  const memory = windows.memory.status();

  const report = {
    schema: SCHEMA,
    machine,
    runtime: {
      bun: Bun.version,
      windows: windows.version,
      elevated: isElevated(),
    },
    system: { ...system, memory, drives: disk },
    installedTools: ["bun", "cargo", "rustc", "docker", "claude", "agy", "vncviewer", "wg", "ssh", "sshfs"].map(
      name => ({ name, path: Bun.which(name) ?? null }),
    ),
    processes: runningProcesses,
    services,
    filesystemIndex: {
      configured: Boolean(process.env.APHRODY_FSINDEX_DB),
      used: false,
      note: "The existing fsindex is repository-scoped; this TEMP plan uses a bounded one-level Bun.Glob scan.",
    },
    caches: await cacheInventory(profile, localAppData),
    cleanupPlan: {
      scope: tempRoot,
      ageDays: options.ageDays,
      recursive: false,
      files: candidates,
      count: candidates.length,
      bytes: candidates.reduce((sum, item) => sum + item.size, 0),
      sha256: digest,
      applyCommand: `bun scripts/tools/os/scripts/winclean.ts --apply --age-days ${options.ageDays} --confirm ${digest}`,
    },
    exclusions: [
      "Rust/Cargo registry and git caches, sccache, Bun install cache and project build outputs",
      "Docker images, containers, build cache and volumes (no prune is run)",
      "Claude/agy/Codex sessions, cookies, credentials and provider stores",
      "VNC state, WireGuard configuration, SSH keys/config/known_hosts",
      "Services, processes, registry, NTFS, boot, power and Windows Update settings",
      "Directories, nested files, links, reparse points, non-.tmp/.temp files and files younger than the threshold",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  if (!options.apply) return;
  if (options.confirm?.toLowerCase() !== digest)
    throw new Error(`Plan changed; the supplied digest does not match this inventory (${digest})`);
  if (candidates.length > 1000) throw new Error("Refusing to apply a plan containing more than 1000 files");

  const os = localProfile(machine);
  if (String(os.MachineName).toUpperCase() !== machine.toUpperCase())
    throw new Error("WinClean target identity changed; refusing cleanup");
  const result = await applyCandidates(tempRoot, candidates);
  console.log(JSON.stringify({ applied: result.removed, errors: result.errors }, null, 2));
  if (result.errors.length > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
