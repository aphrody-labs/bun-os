// SPDX-License-Identifier: Apache-2.0
/**
 * The play NGINX engine, owned through the nginx executable: a master this service spawns in the foreground
 * (`daemon off`, pid file in the prefix) from a configuration rendered out of infra/config/host/nginx/play/engine.conf.
 * This module renders it, validates (`-t`), starts, reloads (`-s reload`, on SIGHUP) and quits it. When the binary
 * carries the optional Bun Rust module (ngx_http_bun_module), its metadata endpoint is read for the status panel;
 * with a stock nginx that location is left out of the rendered configuration.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

export interface NginxModuleInfo {
  schema: 1;
  module: "ngx_http_bun_module";
  nginxVersion: number;
  nginxSourceRevision: string;
  ngxRustRevision: string;
  workerPID: number;
  masterPID: number;
  [field: string]: unknown;
}

export interface EngineState {
  enabled: boolean;
  running: boolean;
  pid: number | null;
  version: string | null;
  capabilities: Record<string, unknown> | null;
  module: NginxModuleInfo | null;
  lastReload: string | null;
  error: string | null;
}

const state: EngineState = {
  enabled: config.nginx.enabled,
  running: false,
  pid: null,
  version: null,
  capabilities: null,
  module: null,
  lastReload: null,
  error: null,
};

interface Controller {
  child: Bun.Subprocess;
  pidFile: string;
}
let controller: Controller | null = null;
/** True when the rendered configuration includes the Bun module's metadata location. */
let moduleLocation = true;

async function run(binary: string, args: string[], timeoutMs = 10_000) {
  const child = Bun.spawn([binary, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

/** `nginx -V` reports on stderr: the version and the `--with-*` modules as capabilities. */
async function probe(binary: string) {
  const { stderr, code } = await run(binary, ["-V"], 5000);
  if (code !== 0) throw new Error(`nginx -V failed: ${stderr.trim()}`);
  const version = /nginx\/(\S+)/.exec(stderr)?.[1] ?? null;
  const capabilities: Record<string, boolean> = {};
  for (const flag of stderr.match(/--with-[a-z0-9_]+/g) ?? []) capabilities[flag.slice("--with-".length)] = true;
  return { version, capabilities };
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A crashed controller leaves `bun-nginx.pid`. It is removed only when the recorded master is dead (systemd's
 * control group stops the service and its master together), so a live foreign master is never adopted.
 */
function recoverPrefix(prefix: string): void {
  const pidFile = join(prefix, "bun-nginx.pid");
  const masterPid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : 0;
  if (masterPid && isAlive(masterPid))
    throw new Error(`NGINX master ${masterPid} from a previous owner is still alive`);
  rmSync(pidFile, { force: true });
}

function render(): string {
  const { nginx } = config;
  const values: Record<string, string> = {
    PREFIX: nginx.prefix,
    PUBLIC_ROOT: config.publicDir,
    EMULATION_ROOT: config.emulationDir,
    APP_UPSTREAM: `${config.hostname}:${config.port}`,
    LISTEN_LOOPBACK: nginx.loopbackListen,
    LISTEN_TUNNEL: nginx.tunnelListen,
    INFO_PORT: String(nginx.infoPort),
    PUBLIC_ORIGIN: config.publicOrigin,
  };
  const source = readFileSync(nginx.template, "utf8");
  const template = moduleLocation ? source : source.replace(/\n\s*location = \/_bun\/info \{[^}]*\}/, "");
  return template.replace(/\$\{([A-Z_]+)\}/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`engine.conf: unknown placeholder ${match}`);
    return value;
  });
}

async function writeConfig(): Promise<void> {
  for (const dir of ["conf", "logs", "temp"]) mkdirSync(join(config.nginx.prefix, dir), { recursive: true });
  await Bun.write(join(config.nginx.prefix, "conf", "nginx.conf"), render());
}

/** Reads the module's metadata endpoint when the binary has the module; stock nginx leaves it empty. */
async function readModuleInfo(url: string, timeoutMs: number): Promise<NginxModuleInfo | null> {
  if (!moduleLocation) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error", keepalive: false });
  if (!response.ok) return null;
  const value = (await response.json()) as Partial<NginxModuleInfo>;
  return value && value.schema === 1 && value.module === "ngx_http_bun_module" ? (value as NginxModuleInfo) : null;
}

async function refreshModule(): Promise<void> {
  if (!controller) return;
  const pid = existsSync(controller.pidFile) ? Number(readFileSync(controller.pidFile, "utf8").trim()) : 0;
  state.running = pid > 0 && isAlive(pid) && controller.child.exitCode === null;
  state.pid = state.running ? pid : null;
  state.module = state.running
    ? await readModuleInfo(`http://127.0.0.1:${config.nginx.infoPort}/_bun/info`, 2000).catch(() => null)
    : null;
}

const args = (prefix: string, pidFile: string) => [
  "-p",
  prefix,
  "-c",
  "conf/nginx.conf",
  "-g",
  `daemon off; pid ${pidFile};`,
];

async function validate(binary: string, prefix: string, pidFile: string): Promise<void> {
  const result = await run(binary, [...args(prefix, pidFile), "-t"]);
  if (result.code !== 0) throw new Error(`nginx configuration rejected: ${result.stderr.trim()}`);
}

/** Renders and validates; a stock nginx rejects the Bun module location, which is then rendered out. */
async function prepare(binary: string, prefix: string, pidFile: string): Promise<void> {
  moduleLocation = true;
  await writeConfig();
  try {
    await validate(binary, prefix, pidFile);
  } catch (error) {
    if (!/bun_nginx|unknown directive/.test(String(error))) throw error;
    moduleLocation = false;
    await writeConfig();
    await validate(binary, prefix, pidFile);
  }
}

export async function startEngine(log: (line: string) => void): Promise<void> {
  if (!state.enabled) return;
  const { binary, prefix } = config.nginx;
  try {
    const found = await probe(binary);
    state.version = found.version;
    state.capabilities = found.capabilities;
    recoverPrefix(prefix);
    const pidFile = join(prefix, "bun-nginx.pid");
    await prepare(binary, prefix, pidFile);
    const child = Bun.spawn([binary, ...args(prefix, pidFile)], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    });
    controller = { child, pidFile };
    // The master writes its pid file once it is up.
    const deadline = Date.now() + 10_000;
    while (!existsSync(pidFile)) {
      if (child.exitCode !== null) throw new Error(`nginx exited with ${child.exitCode} before it was ready`);
      if (Date.now() > deadline) throw new Error("nginx did not write its pid file within 10 s");
      await Bun.sleep(50);
    }
    await refreshModule();
    log(`[play] nginx engine ${state.version ?? ""} started, master ${state.pid}`);
    if (state.module)
      log(
        `[play] bun_nginx module ${state.module.module} nginx ${state.module.nginxVersion} master ${state.module.masterPID}`,
      );
    state.error = null;
  } catch (error) {
    controller?.child.kill();
    controller = null;
    state.error =
      error instanceof Error ? `${(error as { code?: string }).code ?? "Error"}: ${error.message}` : String(error);
    log(`[play] nginx engine failed: ${state.error}`);
    throw error;
  }
}

/** Re-renders the configuration, validates it and reloads the same master. */
export async function reloadEngine(): Promise<EngineState> {
  if (!controller) throw new Error("NGINX engine is not running");
  const { binary, prefix } = config.nginx;
  await prepare(binary, prefix, controller.pidFile);
  const result = await run(binary, [...args(prefix, controller.pidFile), "-s", "reload"]);
  if (result.code !== 0) throw new Error(`nginx reload failed: ${result.stderr.trim()}`);
  state.lastReload = new Date().toISOString();
  await refreshModule();
  return engineState();
}

export async function stopEngine(): Promise<void> {
  if (!controller) return;
  const owned = controller;
  controller = null;
  const { binary, prefix } = config.nginx;
  await run(binary, [...args(prefix, owned.pidFile), "-s", "quit"]).catch(() => undefined);
  await Promise.race([owned.child.exited, Bun.sleep(15_000)]);
  if (owned.child.exitCode === null) owned.child.kill();
  rmSync(owned.pidFile, { force: true });
  state.running = false;
  state.pid = null;
}

export async function engineState(): Promise<EngineState> {
  if (controller) await refreshModule().catch(error => (state.error = String(error)));
  return { ...state };
}
