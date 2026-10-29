// SPDX-License-Identifier: Apache-2.0
/**
 * Dev-env module: user systemd units (rendered from the yolo unit catalog -> ~/.config/systemd/user) and /etc/wsl.conf.
 *   check    drift between repo units and installed units, live-only units, wsl.conf keys
 *   install  write every catalog unit, or only the named ones (differing copies are kept as *.pre-update), daemon-reload   [unit...] [--apply]
 *   restart  try-restart units that run a given binary (default: units mentioning bun or aphrody)  [--apply]
 */
// oxlint-disable no-await-in-loop -- readiness retries and authentication checks are intentionally ordered.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  rmSync,
  realpathSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Ctx } from "./context.ts";
import { spawnSync, type SpawnSyncResult } from "./process.ts";
import {
  prepareNativeJobHostClients,
  qualifyNativeJobHostClients,
  type NativeJobHost,
  type NativeJobTransport,
} from "./job-hosts.ts";

export type UnitState = "missing" | "current" | "stale-copy" | "foreign-link";

interface Rendered {
  file: string;
  text: string;
}
const unitDir = () => process.env.APHRODY_SYSTEMD_USER_DIR ?? join(homedir(), ".config", "systemd", "user");
const isUnit = (f: string) => /\.(service|timer|socket|path|target)$/.test(f);

/** The unit catalog and renderer live in yolo (`@aphrody/yolo-core/units`); APHRODY_YOLO_ROOT or ~/aphrody. */
export function renderedUnits(): Rendered[] {
  const root = process.env.APHRODY_YOLO_ROOT ?? join(homedir(), "aphrody");
  const entry = join(root, "packages/engine/core/src/units/index.ts");
  if (!existsSync(entry)) throw new Error(`yolo unit catalog missing: ${entry} (set APHRODY_YOLO_ROOT)`);
  return (createRequire(import.meta.url)(entry) as { renderAll(): Rendered[] }).renderAll();
}

export function repoUnits(_c?: Ctx): string[] {
  return renderedUnits()
    .map(u => u.file)
    .filter(f => !f.includes("/"))
    .toSorted();
}

export function stateOf(_c: Ctx | undefined, name: string, dir = unitDir(), rendered = renderedUnits()): UnitState {
  const want = rendered.find(u => u.file === name);
  const dst = join(dir, name);
  if (!existsSync(dst) && !isLink(dst)) return "missing";
  if (isLink(dst)) return "foreign-link";
  return want && readFileSync(dst, "utf8") === want.text ? "current" : "stale-copy";
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Keys required by the repo template that /etc/wsl.conf does not set the same way. */
export function wslDrift(template: string, live: string): string[] {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- existing local parser stays scoped to this unrelated drift check.
  const parse = (t: string) => {
    const out = new Map<string, string>();
    let section = "";
    for (const raw of t.split("\n")) {
      const l = raw.trim();
      if (!l || l.startsWith("#")) continue;
      const s = /^\[(.+)\]$/.exec(l);
      if (s) {
        section = s[1]!;
        continue;
      }
      const kv = /^([^=]+)=(.*)$/.exec(l);
      if (kv) out.set(`${section}.${kv[1]!.trim()}`, kv[2]!.trim());
    }
    return out;
  };
  const want = parse(template);
  const have = parse(live);
  return [...want]
    .filter(([k, v]) => have.get(k) !== v)
    .map(([k, v]) => `${k}: want ${v}, have ${have.get(k) ?? "(unset)"}`);
}

export function check(c: Ctx): number {
  let bad = 0;
  for (const u of repoUnits(c)) {
    const st = stateOf(c, u);
    if (st !== "current") {
      bad++;
    }
    console.log(`unit   ${u.padEnd(46)} ${st}`);
  }
  const live = existsSync(unitDir()) ? readdirSync(unitDir()).filter(isUnit) : [];
  const own = new Set(repoUnits(c));
  const orphan = live.filter(u => !own.has(u) && u.startsWith("aphrody-"));
  for (const u of orphan) console.log(`unit   ${u.padEnd(46)} live-only (not in the yolo unit catalog)`);
  const tpl = "tools/config/wsl/wsl.conf";
  if (c.exists(tpl) && existsSync("/etc/wsl.conf")) {
    const drift = wslDrift(c.read(tpl), readFileSync("/etc/wsl.conf", "utf8"));
    for (const d of drift) {
      console.log(`wsl    ${d}`);
      bad++;
    }
    if (!drift.length) console.log("wsl    /etc/wsl.conf matches tools/config/wsl/wsl.conf");
  }
  return bad ? 1 : 0;
}

export function install(c: Ctx, only: string[] = []): number {
  const rendered = renderedUnits();
  const units = repoUnits();
  const unknown = only.filter(u => !units.includes(u));
  if (unknown.length) {
    console.error(`unknown catalog unit: ${unknown.join(", ")}`);
    return 2;
  }
  const dir = unitDir();
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const wanted = only.length ? only : units;
  for (const u of rendered.filter(r => wanted.includes(r.file) || wanted.some(w => r.file.startsWith(`${w}.d/`)))) {
    const st = stateOf(c, u.file, dir, rendered);
    if (st === "current") continue;
    console.log(`${c.apply ? "write " : "would "} ${u.file} (${st})`);
    if (!c.apply) continue;
    const dst = join(dir, u.file);
    if (st !== "missing") {
      if (isLink(dst)) unlinkSync(dst);
      else renameSync(dst, `${dst}.pre-update-${stamp}`); // never overwrite a copy without keeping it
    }
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, u.text);
  }
  if (c.apply) c.run("systemctl", ["--user", "daemon-reload"], { inherit: true });
  return 0;
}

export function restart(c: Ctx, needles: string[]): number {
  const active = c
    .run("systemctl", ["--user", "list-units", "--type=service", "--state=active", "--no-legend", "--plain"])
    .stdout.split("\n")
    .map(l => l.split(/\s+/)[0]!)
    .filter(u => u.startsWith("aphrody-"));
  for (const u of active) {
    const text = c.run("systemctl", ["--user", "cat", u]).stdout;
    if (!needles.some(n => text.includes(n))) continue;
    console.log(`${c.apply ? "restart" : "would restart"} ${u}`);
    if (c.apply) c.run("systemctl", ["--user", "try-restart", u], { inherit: true });
  }
  return 0;
}

const LOCAL_JOB_UNITS = ["aphrody-local-mcp.service", "aphrody-jobs-worker-wsl.service"];
type LocalRun = (command: string, args: string[]) => SpawnSyncResult;
const nonnegativeInteger = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Validate the actual queue listing DTO, including availability of its counters. */
export function assertLocalJobsReceipt(stdout: string): void {
  const envelope = JSON.parse(stdout) as {
    result?: {
      isError?: boolean;
      structuredContent?: unknown;
      content?: Array<{ type: string; text?: string }>;
    };
  };
  const result = envelope.result;
  const texts = result?.content?.filter(block => block.type === "text" && block.text) ?? [];
  if (!result || result.isError === true || (!result.structuredContent && texts.length !== 1))
    throw new Error("Authenticated local native jobs control failed");
  const receipt = (result.structuredContent ?? JSON.parse(texts[0]!.text!)) as {
    error?: unknown;
    count?: unknown;
    jobs?: unknown;
    queue?: { queued?: unknown; running?: unknown };
  };
  if (
    !receipt ||
    receipt.error ||
    !Array.isArray(receipt.jobs) ||
    !nonnegativeInteger(receipt.count) ||
    receipt.count !== receipt.jobs.length ||
    !nonnegativeInteger(receipt.queue?.queued) ||
    !nonnegativeInteger(receipt.queue?.running)
  )
    throw new Error("Authenticated local native jobs control failed");
}

/** POSIX owner and 0700-style mode check; Windows has no uid/mode semantics (per-user profile ACLs apply). */
export function ownerPrivate(s: { uid: number; mode: number }): boolean {
  if (process.platform === "win32") return true;
  return s.uid === process.getuid?.() && (s.mode & 0o077) === 0;
}

export function ownedPrivateFile(path: string): string {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || !ownerPrivate(s) || s.size > 2 * 1024 * 1024)
    throw new Error("Expected an owned private regular file");
  return readFileSync(path, "utf8");
}
export function durablePrivateWrite(path: string, text: string) {
  const temporary = `${path}.${crypto.randomUUID()}.new`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, text);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  if (process.platform === "win32") return; // directories cannot be opened or fsynced on Windows
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

/** An occupied endpoint is reusable only when its exact selected unit owns every listener. */
export function assertLocalJobsListener(rows: string, mainPid: string, active: boolean): void {
  for (const row of rows.split("\n").filter(line => line.trim())) {
    const pids = [...row.matchAll(/pid=(\d+)/g)].map(match => match[1]);
    if (
      !active ||
      !/^[1-9]\d*$/.test(mainPid) ||
      !row.split(/\s+/).includes("127.0.0.1:8791") ||
      !pids.length ||
      pids.some(pid => pid !== mainPid)
    ) {
      throw new Error("Refusing a foreign or unidentified local jobs listener on port 8791");
    }
  }
}

/** The existing user-unit owner deploys only the bounded WSL worker and its distinct authenticated MCP. */
export async function activateLocalJobs(
  c: Ctx,
  pin: string,
  options: {
    home?: string;
    availableMemoryBytes?: number;
    run?: LocalRun;
    fetch?: typeof fetch;
    platform?: NodeJS.Platform;
  } = {},
) {
  if (!/^[a-f0-9]{64}$/.test(pin)) throw new Error("Local jobs require an explicit qualified native binary SHA-256");
  if ((options.platform ?? process.platform) !== "linux")
    throw new Error("Local jobs require the Linux user-systemd owner");
  const home = options.home ?? homedir();
  const run = options.run ?? ((command, args) => spawnSync(command, args, { cwd: c.root, timeout: 15000 }));
  const native = join(home, ".local/bin/aphrody"),
    mcp = join(home, ".local/bin/aphrody-mcp");
  for (const path of [native, mcp])
    if (new Bun.CryptoHasher("sha256").update(readFileSync(realpathSync(path))).digest("hex") !== pin)
      throw new Error("Canonical local native binary differs from its qualified pin");
  const help = run(native, ["job", "run", "--help"]);
  if (help.status !== 0 || !help.stdout.includes("--host") || !help.stdout.includes("--concurrency"))
    throw new Error("Qualified local native jobs capability missing");
  const memory =
    options.availableMemoryBytes ??
    Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync("/proc/meminfo", "utf8"))?.[1] ?? 0) * 1024;
  if (memory < 5 * 1024 ** 3) throw new Error("Local jobs require at least 5 GiB available memory before activation");
  const privateRoot = realpathSync(join(home, ".aphrody/private"));
  const profile = JSON.parse(ownedPrivateFile(join(privateRoot, "mcp-environment/aphrody.json"))) as Record<
    string,
    unknown
  >;
  if (profile.APHRODY_AGENT_DOMAIN !== "aphrody" || profile.APHRODY_MCP_HTTP_TOKEN)
    throw new Error("Local MCP profile must preserve Aphrody domain and the separate host bearer");
  for (const unit of LOCAL_JOB_UNITS) {
    const path = join(unitDir(), unit);
    if (isLink(path)) throw new Error("Refusing a foreign user-unit link");
  }
  if (run("systemctl", ["--user", "show-environment"]).status !== 0)
    throw new Error("Local user-systemd owner is unavailable");
  const listeners = run("ss", ["-H", "-ltnp", "sport = :8791"]);
  if (listeners.status !== 0) throw new Error("Local jobs listener ownership probe failed");
  const owner = run("systemctl", ["--user", "show", "aphrody-local-mcp.service", "--property=MainPID", "--value"]);
  assertLocalJobsListener(
    listeners.stdout,
    owner.stdout.trim(),
    run("systemctl", ["--user", "is-active", "--quiet", "aphrody-local-mcp.service"]).status === 0,
  );
  if (!c.apply) {
    console.log(
      "would activate aphrody-local-mcp:8791 and native WSL worker (2 slots, worker 3G/MCP 1G limits); preserve pc-agent:8793",
    );
    return 0;
  }
  const credentials = join(privateRoot, "jobs");
  mkdirSync(credentials, { recursive: true, mode: 0o700 });
  const ds = lstatSync(credentials);
  if (!ds.isDirectory() || ds.isSymbolicLink() || !ownerPrivate(ds))
    throw new Error("Local jobs credentials directory must be private and owned");
  const tokenFile = join(credentials, "wsl-mcp.env");
  if (!existsSync(tokenFile))
    durablePrivateWrite(
      tokenFile,
      `APHRODY_MCP_HTTP_TOKEN=${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}\n`,
    );
  const match = /^APHRODY_MCP_HTTP_TOKEN=([a-f0-9]{64})\n?$/.exec(ownedPrivateFile(tokenFile));
  if (!match) throw new Error("Local MCP requires its existing purpose-bound protected bearer");
  const config = join(credentials, "wsl.toml");
  if (existsSync(config)) ownedPrivateFile(config);
  durablePrivateWrite(
    config,
    `[mcp_servers.aphrody]\nurl = "http://127.0.0.1:8791/mcp"\n[mcp_servers.aphrody.http_headers]\nAuthorization = "Bearer ${match[1]}"\n`,
  );
  const previous = LOCAL_JOB_UNITS.map(unit => ({
    unit,
    path: join(unitDir(), unit),
    text: existsSync(join(unitDir(), unit)) ? readFileSync(join(unitDir(), unit), "utf8") : null,
    active: run("systemctl", ["--user", "is-active", "--quiet", unit]).status === 0,
    enabled: run("systemctl", ["--user", "is-enabled", "--quiet", unit]).status === 0,
  }));
  let qualification = "unit installation";
  try {
    if (install(c, LOCAL_JOB_UNITS) !== 0) throw new Error("Local jobs unit installation failed");
    if (run("systemctl", ["--user", "daemon-reload"]).status !== 0) throw new Error("Local user-systemd reload failed");
    for (const unit of LOCAL_JOB_UNITS)
      if (
        run("systemctl", ["--user", "enable", unit]).status !== 0 ||
        run("systemctl", ["--user", "restart", unit]).status !== 0
      )
        throw new Error("Local jobs unit activation failed");
    const request = options.fetch ?? fetch;
    qualification = "MCP health";
    let ready = false;
    for (let attempt = 0; attempt < 20 && !ready; attempt++) {
      try {
        ready = (
          await request("http://127.0.0.1:8791/healthz", {
            signal: AbortSignal.timeout(1000),
          })
        ).ok;
      } catch {}
      if (!ready) await Bun.sleep(250);
    }
    if (!ready) throw new Error("Local native MCP health failed");
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    qualification = "MCP authentication guard";
    for (const authorization of [undefined, "Bearer invalid-local-jobs-probe"]) {
      const response = await request("http://127.0.0.1:8791/mcp", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(authorization ? { Authorization: authorization } : {}),
        },
        signal: AbortSignal.timeout(3000),
      });
      if (response.status !== 401) throw new Error("Local MCP authentication guard failed");
    }
    qualification = "authenticated native jobs receipt";
    const status = run(native, ["mcp", "call", "--config", config, "aphrody", "aphrody_job_status", "--args", "{}"]);
    if (status.status !== 0) throw new Error("Authenticated local native jobs request failed");
    assertLocalJobsReceipt(status.stdout);
    qualification = "worker activity";
    for (const unit of LOCAL_JOB_UNITS)
      if (run("systemctl", ["--user", "is-active", "--quiet", unit]).status !== 0)
        throw new Error("Local native worker is inactive");
    console.log(
      `activated local native jobs; client config ${config}; workerReady remains false until a real lease and finish qualify`,
    );
    return 0;
  } catch {
    for (const saved of previous.toReversed()) {
      if (!saved.active) run("systemctl", ["--user", "stop", saved.unit]);
      if (!saved.enabled) run("systemctl", ["--user", "disable", saved.unit]);
      if (saved.text === null) rmSync(saved.path, { force: true });
      else writeFileSync(saved.path, saved.text);
    }
    run("systemctl", ["--user", "daemon-reload"]);
    for (const saved of previous) if (saved.active) run("systemctl", ["--user", "restart", saved.unit]);
    throw new Error(
      `Local jobs qualification failed (${qualification}); prior selected user units restored, private credentials retained`,
    );
  }
}

export function runSystemd(
  c: Ctx,
  args: string[],
  ports: { nativeJobTransport?: NativeJobTransport } = {},
): number | Promise<number> {
  switch (args[0] ?? "check") {
    case "check":
      return check(c);
    case "install":
      return install(
        c,
        args.slice(1).filter(a => !a.startsWith("-")),
      );
    case "restart":
      return restart(
        c,
        args.slice(1).filter(a => !a.startsWith("-")).length
          ? args.slice(1).filter(a => !a.startsWith("-"))
          : [".bun/bin/bun", "aphrody-kernel", "aphrody"],
      );
    case "jobs": {
      const at = args.indexOf("--binary-sha256");
      return activateLocalJobs(c, at < 0 ? "" : (args[at + 1] ?? ""));
    }
    case "jobs-clients": {
      if (args.includes("--qualify") && (!c.apply || !ports.nativeJobTransport))
        throw new Error("Native job qualification requires --apply and the native transport owner");
      const at = args.indexOf("--binary-sha256");
      const ids = args.flatMap((arg, index) => (arg === "--host" ? [args[index + 1]] : []));
      if (ids.some(id => !["vps", "dbfr", "wsl"].includes(id ?? "")))
        throw new Error("Select existing qualified host identities explicitly");
      const hosts = prepareNativeJobHostClients(c, ids as NativeJobHost["id"][], at < 0 ? "" : (args[at + 1] ?? ""));
      if (args.includes("--qualify"))
        return qualifyNativeJobHostClients(hosts, ports.nativeJobTransport!, {
          pin: args[at + 1] ?? "",
        }).then(qualified => {
          console.log(JSON.stringify(qualified, null, 2));
          return 0;
        });
      console.log(JSON.stringify(hosts, null, 2));
      return 0;
    }
    default:
      console.error(
        "usage: systemd [check|install [unit...]|restart [needle...]|jobs --binary-sha256 HEX|jobs-clients --host vps|dbfr|wsl --binary-sha256 HEX]",
      );
      return 2;
  }
}
