// SPDX-License-Identifier: Apache-2.0
// Common lifecycle owner for the existing Compose project and native host adapters.
// oxlint-disable no-await-in-loop -- one ordered lifecycle loop; adapters are restarted before the next health receipt
// oxlint-disable no-unmodified-loop-condition -- signal handlers set the shutdown flag
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { updateMain, validateUpdate, type UpdateConfig } from "./mesh-update.ts";

/** The Windows surface this supervisor uses (job objects, bun:ffi), loaded lazily; it executes no Windows operation. */
export async function windows() {
  const { WindowsJob } = await import("@aphrody/bun-workspace/windows-job");
  return { Job: WindowsJob };
}
export async function windowsCapabilities() {
  const api = await windows();
  return {
    supported: process.platform === "win32",
    exports: Object.keys(api).toSorted(),
  };
}

export type ComposeGroup = {
  file: string;
  overrides?: string[];
  services: string[];
  profiles?: string[];
  envFile?: string;
};
export type NativeAdapter = {
  id: string;
  argv: string[];
  envFile?: string;
  intervalSeconds?: number;
};
export function adapterDue(adapter: NativeAdapter, exited: boolean, elapsedMs: number): boolean {
  return exited && (adapter.intervalSeconds === undefined || elapsedMs >= adapter.intervalSeconds * 1000);
}
export type MeshConfig = {
  version: 1;
  member: "aphro-pc" | "omar" | "vps" | "dbfr";
  root: string;
  home: string;
  compose: ComposeGroup[];
  adapters: NativeAdapter[];
  health: { id: string; url: string }[];
  update?: UpdateConfig;
};

export function validateConfig(value: unknown): MeshConfig {
  const c = value as MeshConfig;
  if (!c || c.version !== 1 || !["aphro-pc", "omar", "vps", "dbfr"].includes(c.member))
    throw new Error("invalid mesh member/version");
  if (!isAbsolute(c.root) || !isAbsolute(c.home)) throw new Error("root/home must be absolute");
  if (!Array.isArray(c.compose) || !c.compose.length || !Array.isArray(c.adapters) || !Array.isArray(c.health))
    throw new Error("compose, adapters and health arrays required");
  const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
  for (const group of c.compose) {
    if (
      !isAbsolute(group.file) ||
      !Array.isArray(group.services) ||
      !group.services.length ||
      [...group.services, ...(group.profiles ?? [])].some(s => !identifier.test(s))
    )
      throw new Error("invalid Compose selection");
    if ((group.overrides ?? []).some(file => !isAbsolute(file))) throw new Error("Compose overrides must be absolute");
  }
  const ids = new Set<string>();
  for (const adapter of c.adapters) {
    if (
      !identifier.test(adapter.id) ||
      ids.has(adapter.id) ||
      !Array.isArray(adapter.argv) ||
      !adapter.argv.length ||
      adapter.argv.some(s => typeof s !== "string" || /[\r\n\0]/.test(s) || /^(--token|--password)(=|$)/i.test(s))
    )
      throw new Error("invalid adapter or credential in argv");
    if (
      adapter.intervalSeconds !== undefined &&
      (!Number.isInteger(adapter.intervalSeconds) || adapter.intervalSeconds < 60)
    )
      throw new Error("adapter interval must be at least 60 seconds");
    ids.add(adapter.id);
  }
  for (const item of [...c.compose, ...c.adapters]) {
    if (item.envFile) {
      const relative = resolve(item.envFile).slice(resolve(c.home).length);
      const privateRoot = join(resolve(c.home), "private");
      if (!resolve(item.envFile).startsWith(privateRoot + (process.platform === "win32" ? "\\" : "/")) || !relative)
        throw new Error("envFile must be in this host's protected home/private");
    }
  }
  for (const h of c.health) {
    const u = new URL(h.url);
    if (
      !identifier.test(h.id) ||
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.hash ||
      u.search
    )
      throw new Error("invalid or credential-bearing health URL");
  }
  if (c.update) validateUpdate(c.update);
  return c;
}

export function composeArgs(group: ComposeGroup, action: "config" | "up"): string[] {
  return [
    "docker",
    "compose",
    "-f",
    group.file,
    ...(group.overrides ?? []).flatMap(file => ["-f", file]),
    ...(group.envFile ? ["--env-file", group.envFile] : []),
    ...(group.profiles ?? []).flatMap(p => ["--profile", p]),
    ...(action === "config"
      ? ["config", "--quiet"]
      : ["up", "-d", "--no-build", "--wait", "--wait-timeout", "120", ...group.services]),
  ];
}

export function environment(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error("invalid protected env file (expected NAME=value)");
    let value = match[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    result[match[1]!] = value;
  }
  return result;
}

async function command(
  argv: string[],
  root: string,
  timeout = 15_000,
  owned?: {
    children: Set<Subprocess>;
    signal: AbortSignal;
    assign(child: Subprocess): void;
  },
): Promise<boolean> {
  if (owned?.signal.aborted) return false;
  let child: Subprocess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => child?.kill("SIGKILL");
  try {
    child = Bun.spawn(argv, {
      cwd: root,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    });
    owned?.children.add(child);
    owned?.assign(child);
    owned?.signal.addEventListener("abort", stop, { once: true });
    timer = setTimeout(stop, timeout);
    return (await child.exited) === 0;
  } catch {
    stop();
    if (child) await child.exited;
    return false;
  } finally {
    clearTimeout(timer);
    owned?.signal.removeEventListener("abort", stop);
    if (child) owned?.children.delete(child);
  }
}

export async function probes(config: MeshConfig): Promise<{ id: string; healthy: boolean; status: number | null }[]> {
  return Promise.all(
    config.health.map(async h => {
      try {
        const response = await fetch(h.url, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        return {
          id: h.id,
          healthy: response.status === 200,
          status: response.status,
        };
      } catch {
        return { id: h.id, healthy: false, status: null };
      }
    }),
  );
}

async function windowsLock(member: string): Promise<() => void> {
  const { dlopen, FFIType, ptr } = await import("bun:ffi");
  const api = dlopen("kernel32.dll", {
    CreateMutexW: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
      returns: FFIType.ptr,
    },
    WaitForSingleObject: {
      args: [FFIType.ptr, FFIType.u32],
      returns: FFIType.u32,
    },
    ReleaseMutex: { args: [FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  const name = Buffer.from(`Global\\AphrodyMesh-${member}\0`, "utf16le");
  const handle = api.symbols.CreateMutexW(null, 0, ptr(name));
  if (!handle) {
    api.close();
    throw new Error("mesh mutex creation failed");
  }
  const state = api.symbols.WaitForSingleObject(handle, 0);
  if (state !== 0 && state !== 0x80) {
    api.symbols.CloseHandle(handle);
    api.close();
    throw new Error("mesh supervisor already running");
  }
  return () => {
    api.symbols.ReleaseMutex(handle);
    api.symbols.CloseHandle(handle);
    api.close();
  };
}

async function supervise(config: MeshConfig): Promise<void> {
  const children = new Map<string, Subprocess>();
  const commandChildren = new Set<Subprocess>();
  const started = new Map<string, number>();
  const logs = new Map<string, number>();
  const adapterErrors = new Map<string, string>();
  const compose = config.compose.map(() => ({
    status: "pending" as "pending" | "ready" | "degraded",
    error: null as string | null,
    retryAt: 0,
  }));
  let composeAttempt: Promise<void> | undefined;
  let lastUpdate = Date.now();
  const job = process.platform === "win32" ? new (await windows()).Job({ killOnClose: true }) : undefined;
  const abort = new AbortController();
  const owned = {
    children: commandChildren,
    signal: abort.signal,
    assign: (child: Subprocess) => job?.assign(child),
  };
  let stopping = false;
  const stop = () => {
    stopping = true;
    abort.abort();
    for (const child of children.values()) child.kill();
    for (const child of commandChildren) child.kill();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const receipt = join(config.home, "run", "mesh.json");
  try {
    mkdirSync(dirname(receipt), { recursive: true });
    mkdirSync(join(config.home, "logs"), { recursive: true });
    while (!stopping) {
      for (const adapter of config.adapters) {
        const previous = children.get(adapter.id);
        if (previous && !adapterDue(adapter, previous.exitCode !== null, Date.now() - (started.get(adapter.id) ?? 0)))
          continue;
        if (
          !previous &&
          adapterErrors.has(adapter.id) &&
          Date.now() - (started.get(adapter.id) ?? 0) < (adapter.intervalSeconds ?? 5) * 1000
        )
          continue;
        try {
          const env = adapter.envFile ? environment(readFileSync(adapter.envFile, "utf8")) : {};
          let log = logs.get(adapter.id);
          if (log === undefined) {
            log = openSync(join(config.home, "logs", `mesh-${adapter.id}.log`), "a", 0o600);
            logs.set(adapter.id, log);
          }
          const child = Bun.spawn(adapter.argv, {
            cwd: config.root,
            env: { ...process.env, ...env, APHRODY_HOME: config.home },
            stdin: "ignore",
            stdout: log,
            stderr: log,
            windowsHide: true,
          });
          children.set(adapter.id, child);
          started.set(adapter.id, Date.now());
          job?.assign(child);
          adapterErrors.delete(adapter.id);
        } catch {
          children.get(adapter.id)?.kill();
          started.set(adapter.id, Date.now());
          adapterErrors.set(adapter.id, "native adapter or protected environment unavailable");
        }
      }
      // A slow or absent engine never holds the native recovery plane hostage.
      // One owned attempt runs in the background, with bounded process deadlines
      // and a 30-second retry interval; existing containers are never removed.
      if (!composeAttempt && compose.some(state => Date.now() >= state.retryAt)) {
        composeAttempt = (async () => {
          const engine = await command(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            config.root,
            15_000,
            owned,
          );
          for (const [index, group] of config.compose.entries()) {
            const state = compose[index]!;
            if (stopping || Date.now() < state.retryAt) continue;
            let healthy = false;
            let error = "docker engine unavailable";
            if (engine) {
              error = "Compose configuration or activation unavailable";
              healthy =
                (await command(composeArgs(group, "config"), config.root, 15_000, owned)) &&
                (await command(composeArgs(group, "up"), config.root, 150_000, owned));
            }
            state.status = healthy ? "ready" : "degraded";
            state.error = healthy ? null : error;
            state.retryAt = Date.now() + 30_000;
          }
        })().finally(() => {
          composeAttempt = undefined;
        });
      }
      const health = await probes(config);
      writeFileSync(
        `${receipt}.new`,
        JSON.stringify(
          {
            member: config.member,
            pid: process.pid,
            observedAt: new Date().toISOString(),
            status:
              compose.some(state => state.status !== "ready") || adapterErrors.size || health.some(h => !h.healthy)
                ? "degraded"
                : "healthy",
            compose,
            health,
            adapters: config.adapters.map(({ id }) => ({
              id,
              pid: children.get(id)?.pid ?? null,
              exitCode: children.get(id)?.exitCode ?? null,
              error: adapterErrors.get(id) ?? null,
            })),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      renameSync(`${receipt}.new`, receipt);
      if (config.update && Date.now() - lastUpdate >= config.update.intervalSeconds * 1000) {
        lastUpdate = Date.now();
        let updated = false;
        try {
          updated = await updateMain(config.update, config.home);
        } catch (error) {
          writeFileSync(
            join(config.home, "run", "mesh-update-error.json"),
            JSON.stringify({
              observedAt: new Date().toISOString(),
              error: error instanceof Error ? error.message : "main update failed",
            }),
            { mode: 0o600 },
          );
        }
        if (updated) throw new Error("qualified main bundle activated; scheduler restart requested");
      }
      await Bun.sleep(5000);
    }
  } finally {
    stop();
    job?.close();
    const killDeadline = setTimeout(() => {
      for (const child of children.values()) if (child.exitCode === null) child.kill("SIGKILL");
      for (const child of commandChildren) if (child.exitCode === null) child.kill("SIGKILL");
    }, 5000);
    await Promise.all([...children.values()].map(child => child.exited));
    await composeAttempt;
    clearTimeout(killDeadline);
    for (const fd of logs.values()) closeSync(fd);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  const [action] = argv;
  if (action === "capabilities") {
    console.log(JSON.stringify(await windowsCapabilities()));
    return 0;
  }
  const at = argv.indexOf("--config");
  const path =
    at < 0 ? join(process.env.APHRODY_HOME ?? join(homedir(), ".aphrody"), "host", "mesh.json") : argv[at + 1];
  if (!path || !["plan", "health", "run"].includes(action ?? ""))
    throw new Error("usage: container-service.ts --mesh plan|health|run [--config path]");
  const config = validateConfig(JSON.parse(readFileSync(path, "utf8")));
  if (!existsSync(config.root)) throw new Error("configured checkout missing");
  if (action === "health") {
    const rows = await probes(config);
    console.log(JSON.stringify(rows));
    return rows.every(r => r.healthy) ? 0 : 1;
  }
  if (action === "plan") {
    for (const item of [...config.compose, ...config.adapters]) {
      if (item.envFile && !existsSync(item.envFile)) throw new Error("configured protected env file missing");
    }
    for (const group of config.compose) {
      if (!(await command(composeArgs(group, "config"), config.root))) throw new Error("Compose configuration invalid");
    }
    console.log(
      JSON.stringify(
        {
          member: config.member,
          compose: config.compose.map(g => composeArgs(g, "up")),
          adapters: config.adapters.map(a => ({
            id: a.id,
            executable: a.argv[0],
          })),
          health: config.health,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (process.platform !== "win32" && !argv.includes("--locked")) {
    const lock = join(config.home, "run", "mesh.lock");
    mkdirSync(dirname(lock), { recursive: true });
    const child = Bun.spawn(
      [
        "flock",
        "--close",
        "--nonblock",
        lock,
        process.execPath,
        "--no-env-file",
        import.meta.path,
        ...(Bun.argv.includes("--mesh") ? ["--mesh"] : []),
        ...argv,
        "--locked",
      ],
      { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
    );
    return await child.exited;
  }
  const release = process.platform === "win32" ? await windowsLock(config.member) : () => {};
  try {
    await supervise(config);
    return 0;
  } finally {
    release();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "mesh failed");
    process.exitCode = 1;
  }
}
