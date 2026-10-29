#!/usr/bin/env bun
/**
 * Contrat et observabilité de la stack Aphrody/RG/Niers.
 *
 * Commands:
 *   status [--json] [--strict] [--deep] [--host=<alias>]  live units, host resources and probes (Linux host);
 *     --host (or APHRODY_CATALOG_HOST) keeps only the catalog entries of that host
 *
 * Manifest/source consistency is checked by scripts/aphrody/tools/infra/check-infra.ts.
 *
 * This file intentionally never starts, stops, reloads or installs anything.
 * Deployment remains explicit through `aphrody-infra deploy`.
 *
 * The only service registry is infra/config/service-catalog.json; components, ports and
 * retired units are derived from it.
 */

import { homedir } from "node:os";
import { readFile } from "node:fs/promises";

const INFRA_ROOT = process.env.APHRODY_INFRA_ROOT ?? `${import.meta.dir}/../../../..`;
const CATALOG_PATH = process.env.APHRODY_SERVICE_CATALOG ?? `${INFRA_ROOT}/infra/config/service-catalog.json`;
const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8")) as Catalog;
const json = process.argv.includes("--json");
const strict = process.argv.includes("--strict");
const deep = process.argv.includes("--deep");
// Catalog host alias (vps, dbfr, ...): limits the report to the entries that host runs.
const hostFilter =
  process.argv.find(arg => arg.startsWith("--host="))?.slice("--host=".length) ?? process.env.APHRODY_CATALOG_HOST;
const command = process.argv[2] ?? "status";
const DISK_WARNING_PERCENT = 85;
const DISK_CRITICAL_PERCENT = 95;

type CatalogService = {
  id: string;
  kind: string;
  /** Absent for container, remote-host and proxy-only entries: they have no systemd unit. */
  unit?: string;
  application?: string;
  sourceRepo?: string;
  health?: string;
  additionalUpstreams?: string[];
  staged?: boolean;
  required?: boolean;
  /** `retired` units are decommissioned: never required, never health-probed. */
  status?: string;
  host?: string;
};
type Catalog = {
  schemaVersion: number;
  services: CatalogService[];
  policies?: { retiredUnits?: string[] };
};
type Component = {
  id: string;
  kind: string;
  owner: string;
  unit: string;
  required: boolean;
  oneshot?: boolean;
  timer?: string;
  ports?: number[];
  health?: string;
  retired?: boolean;
};

function port(address: string): number | undefined {
  const match = address.match(/:(\d+)(?:\/|$)/u);
  return match ? Number(match[1]) : undefined;
}

// A catalog entry whose unit is a timer is a oneshot job: the timer must be active, the
// service it triggers is idle between runs.
const manifest = {
  name: "aphrody-production",
  schemaVersion: catalog.schemaVersion,
  components: [
    // Only systemd-managed entries are observable here; unit-less entries are checked by their owners.
    ...catalog.services.flatMap((service): Component[] => {
      const unit = service.unit;
      if (!unit || (hostFilter && service.host && service.host !== hostFilter)) return [];
      const timer = unit.endsWith(".timer") ? unit : undefined;
      const retired = service.status === "retired";
      const ports = [service.health, ...(service.additionalUpstreams ?? [])].flatMap(address => {
        const value = address ? port(address) : undefined;
        return value === undefined ? [] : [value];
      });
      return [
        {
          id: service.id,
          kind: retired ? "retired" : service.kind,
          owner: retired
            ? "retired"
            : (service.application ?? service.sourceRepo ?? service.id.split("-", 1)[0] ?? service.id),
          unit: timer ? timer.replace(/\.timer$/u, ".service") : unit,
          required: !retired && (service.required ?? (service.staged ? false : true)),
          oneshot: timer !== undefined,
          timer,
          // A retired unit is never health-probed: its listener is gone.
          ports: retired ? [] : ports,
          health: retired ? undefined : service.health,
          retired,
        },
      ];
    }),
    ...(catalog.policies?.retiredUnits ?? [])
      .filter(unit => !unit.includes("@"))
      .map((unit): Component => ({
        id: unit.replace(/\.service$/u, ""),
        kind: "retired",
        owner: "retired",
        unit,
        required: false,
        retired: true,
      })),
  ],
};

type CommandResult = { code: number; stdout: string; stderr: string };
async function run(args: string[]): Promise<CommandResult> {
  const child = Bun.spawn(args, {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code: await child.exited, stdout, stderr };
}

async function text(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function number(value: string | undefined): number | null {
  if (value === undefined || value === "" || value === "N/A") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function manifestProblems(): string[] {
  const problems: string[] = [];
  if (manifest.schemaVersion !== 1) problems.push("schemaVersion inconnue");
  const ids = manifest.components.map(component => component.id);
  for (const id of unique(ids)) {
    if (ids.filter(candidate => candidate === id).length > 1) problems.push(`id dupliqué: ${id}`);
  }
  const ports = new Map<number, Component[]>();
  for (const component of manifest.components) {
    for (const port of component.ports ?? []) ports.set(port, [...(ports.get(port) ?? []), component]);
  }
  for (const [port, owners] of ports) {
    const active = owners.filter(component => !component.retired);
    if (active.length > 1)
      problems.push(`port ${port} partagé par ${active.map(component => component.id).join(", ")}`);
  }
  return problems;
}

async function unitStatus(unit: string) {
  const result = await run([
    "systemctl",
    "show",
    unit,
    "--no-page",
    "--property=LoadState,ActiveState,SubState,UnitFileState,MemoryCurrent,CPUUsageNSec,TasksCurrent,NRestarts",
  ]);
  const values = Object.fromEntries(
    result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => line.split("=", 2) as [string, string]),
  );
  return {
    unit,
    loaded: values.LoadState === "loaded",
    active: values.ActiveState === "active",
    state: values.SubState ?? "unknown",
    enabled: values.UnitFileState ?? "unknown",
    memoryBytes: number(values.MemoryCurrent),
    cpuTimeNs: number(values.CPUUsageNSec),
    tasks: number(values.TasksCurrent),
    restarts: number(values.NRestarts),
  };
}

async function timerStatus(timer: string | undefined) {
  if (!timer) return undefined;
  const result = await run(["systemctl", "show", timer, "--no-page", "--property=ActiveState,UnitFileState"]);
  const values = Object.fromEntries(
    result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => line.split("=", 2) as [string, string]),
  );
  return {
    unit: timer,
    active: values.ActiveState === "active",
    enabled: values.UnitFileState ?? "unknown",
  };
}

async function probe(url: string) {
  const started = performance.now();
  if (url.startsWith("tcp://")) {
    const [, hostname, portText] = url.match(/^tcp:\/\/([^:]+):(\d+)$/u) ?? [];
    if (hostname && portText) {
      try {
        await Bun.connect({
          hostname,
          port: Number(portText),
          socket: {
            open(s) {
              s.end();
            },
            data() {},
            error() {},
            close() {},
          },
        });
        return {
          url,
          ok: true,
          status: 200,
          ms: Math.round(performance.now() - started),
        };
      } catch (error) {
        return {
          url,
          ok: false,
          status: 0,
          ms: Math.round(performance.now() - started),
          error: String(error),
        };
      }
    }
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    return {
      url,
      ok: response.ok,
      status: response.status,
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - started),
      error: String(error),
    };
  }
}

async function filesystems() {
  const paths = ["/", homedir(), "/var", "/var/www", "/tmp", "/run", "/boot"];
  const result = await run(["df", "-Pk", ...paths]);
  const rows = result.stdout.trim().split("\n").slice(1);
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const columns = row.trim().split(/\s+/u);
    const mount = columns.slice(5).join(" ") || columns.at(-1) || "unknown";
    if (seen.has(mount)) return [];
    seen.add(mount);
    return [
      {
        filesystem: columns[0],
        mount,
        sizeKb: number(columns[1]),
        usedKb: number(columns[2]),
        availableKb: number(columns[3]),
        usedPercent: Number.parseInt(columns[4]?.replace("%", "") ?? "0", 10),
      },
    ];
  });
}

function parseMeminfo(source: string) {
  const values: Record<string, number> = {};
  for (const line of source.trim().split("\n")) {
    const [, key, amount] = line.match(/^([^:]+):\s+(\d+)/u) ?? [];
    if (key && amount) values[key] = Number(amount) * (line.endsWith(" kB") ? 1024 : 1);
  }
  const total = values.MemTotal ?? 0;
  const available = values.MemAvailable ?? values.MemFree ?? 0;
  const swapTotal = values.SwapTotal ?? 0;
  const swapFree = values.SwapFree ?? 0;
  return {
    totalBytes: total,
    availableBytes: available,
    usedBytes: Math.max(0, total - available),
    usedPercent: total ? Math.round((1 - available / total) * 100) : null,
    swapTotalBytes: swapTotal,
    swapUsedBytes: Math.max(0, swapTotal - swapFree),
    swapUsedPercent: swapTotal ? Math.round((1 - swapFree / swapTotal) * 100) : null,
  };
}

function parseNetDev(source: string) {
  return source
    .trim()
    .split("\n")
    .slice(2)
    .flatMap(line => {
      const [rawName, rawValues] = line.split(":", 2);
      if (!rawName || !rawValues) return [];
      const values = rawValues.trim().split(/\s+/u);
      return [
        {
          interface: rawName.trim(),
          rxBytes: number(values[0]) ?? 0,
          txBytes: number(values[8]) ?? 0,
        },
      ];
    });
}

async function network() {
  const before = parseNetDev(await text("/proc/net/dev"));
  await Bun.sleep(1000);
  const after = parseNetDev(await text("/proc/net/dev"));
  const beforeByName = new Map(before.map(row => [row.interface, row]));
  return after.map(row => {
    const previous = beforeByName.get(row.interface) ?? row;
    return Object.assign(row, {
      rxBytesPerSecond: Math.max(0, row.rxBytes - previous.rxBytes),
      txBytesPerSecond: Math.max(0, row.txBytes - previous.txBytes),
    });
  });
}

function parsePressure(source: string) {
  return Object.fromEntries(
    source
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [kind, ...fields] = line.split(" ");
        return [kind, Object.fromEntries(fields.map(field => field.split("=", 2)).filter(pair => pair.length === 2))];
      }),
  );
}

async function processSummary() {
  const result = await run(["ps", "-eo", "pid=,ppid=,user=,comm=,%cpu=,%mem=,rss=,stat=", "--sort=-%cpu"]);
  const processes = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const fields = line.trim().split(/\s+/u);
      return {
        pid: number(fields[0]),
        ppid: number(fields[1]),
        user: fields[2],
        command: fields[3],
        cpuPercent: number(fields[4]),
        memoryPercent: number(fields[5]),
        rssKb: number(fields[6]),
        state: fields[7],
      };
    });
  return {
    count: processes.length,
    topCpu: processes.slice(0, 10),
    topMemory: [...processes].toSorted((a, b) => (b.memoryPercent ?? 0) - (a.memoryPercent ?? 0)).slice(0, 10),
  };
}

async function serviceSummary() {
  const listed = await run(["systemctl", "list-units", "--type=service", "--state=running", "--no-legend", "--plain"]);
  const names = listed.stdout
    .trim()
    .split("\n")
    .flatMap(line => {
      const [name] = line.trim().split(/\s+/u);
      return name ? [name] : [];
    });
  const resources = await Promise.all(names.map(unit => unitStatus(unit)));
  return {
    runningCount: names.length,
    running: names,
    topMemory: [...resources].toSorted((a, b) => (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0)).slice(0, 10),
    topCpuTime: [...resources].toSorted((a, b) => (b.cpuTimeNs ?? 0) - (a.cpuTimeNs ?? 0)).slice(0, 10),
  };
}

async function socketSummary() {
  const summary = await run(["ss", "-s"]);
  const established = await run(["ss", "-Htan", "state", "established"]);
  const listening = await run(["ss", "-Hln"]);
  return {
    summary: summary.stdout.trim().split("\n").filter(Boolean),
    established: established.stdout.trim() ? established.stdout.trim().split("\n").length : 0,
    listening: listening.stdout.trim() ? listening.stdout.trim().split("\n").length : 0,
  };
}

async function kernelSummary() {
  const pressure = Object.fromEntries(
    await Promise.all(
      ["cpu", "io", "memory"].map(async name => [name, parsePressure(await text(`/proc/pressure/${name}`))]),
    ),
  );
  const fileNr = (await text("/proc/sys/fs/file-nr")).trim().split(/\s+/u).map(Number);
  const oom =
    (await run(["journalctl", "-k", "-n", "300", "--no-pager"])).stdout.match(
      /out of memory|oom-kill|killed process/giu,
    )?.length ?? 0;
  return {
    pressure,
    fileHandles: {
      allocated: fileNr[0] ?? null,
      unused: fileNr[1] ?? null,
      max: fileNr[2] ?? null,
    },
    oomEventsRecent: oom,
    loadAverage: await osLoadAverage(),
  };
}

async function osLoadAverage() {
  const source = (await text("/proc/loadavg")).trim().split(/\s+/u).map(Number);
  return {
    one: source[0] ?? null,
    five: source[1] ?? null,
    fifteen: source[2] ?? null,
    cpuCount: navigator.hardwareConcurrency,
  };
}

async function inventory() {
  const paths = ["/", homedir(), "/var", "/tmp"];
  const result = await Promise.all(
    paths.map(async path => {
      const du = await run(["timeout", "20s", "du", "-x", "-d", "1", "-B1", "--apparent-size", path]);
      return {
        path,
        timedOut: du.code === 124,
        entries: du.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(line => {
            const match = line.match(/^(\d+)\s+(.*)$/u);
            return match ? { bytes: Number(match[1]), path: match[2] } : { raw: line };
          })
          .toSorted((a, b) => ((b as { bytes?: number }).bytes ?? 0) - ((a as { bytes?: number }).bytes ?? 0))
          .slice(0, 20),
      };
    }),
  );
  return result;
}

async function status() {
  const components = await Promise.all(
    manifest.components.map(async component => ({
      ...component,
      unit: await unitStatus(component.unit),
      timer: await timerStatus(component.timer),
      probe: component.health ? await probe(component.health) : undefined,
    })),
  );
  const diskState = await filesystems();
  const [networkState, processes, services, sockets, kernel] = await Promise.all([
    network(),
    processSummary(),
    serviceSummary(),
    socketSummary(),
    kernelSummary(),
  ]);
  const diskWarnings = diskState.filter(row => row.usedPercent >= DISK_WARNING_PERCENT);
  const diskCritical = diskState.some(row => row.usedPercent >= DISK_CRITICAL_PERCENT);
  const requiredFailures = components.filter(
    component =>
      (component.required &&
        ((!component.oneshot && !component.unit.active) || (component.probe && !component.probe.ok))) ||
      (component.required && component.oneshot && component.timer && !component.timer.active) ||
      (component.retired && component.unit.active),
  );
  const result = {
    stack: manifest.name,
    schemaVersion: manifest.schemaVersion,
    timestamp: new Date().toISOString(),
    components,
    host: {
      hostname: (await run(["hostname"])).stdout.trim(),
      kernel: (await run(["uname", "-sr"])).stdout.trim(),
      uptimeSeconds: number((await text("/proc/uptime")).split(" ")[0]),
    },
    memory: parseMeminfo(await text("/proc/meminfo")),
    disk: diskState,
    network: networkState,
    processes,
    services,
    sockets,
    kernel,
    inventory: deep ? await inventory() : undefined,
    diskWarnings,
    manifestProblems: manifestProblems(),
    health: requiredFailures.length === 0 && manifestProblems().length === 0 && !diskCritical ? "ok" : "degraded",
  };
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(`${result.stack} — ${result.health}`);
    for (const component of components) {
      const health = component.probe ? ` probe=${component.probe.status}` : "";
      const isActive = component.oneshot && component.timer ? component.timer.active : component.unit.active;
      const state =
        component.oneshot && component.timer
          ? component.timer.active
            ? "timer-active"
            : "timer-inactive"
          : component.unit.state;
      console.log(`- ${component.id.padEnd(24)} ${isActive ? "UP" : "DOWN"} ${state}${health}`);
    }
    console.log(`- host ${result.host.hostname} ${result.host.kernel}`);
    console.log(`- memory ${result.memory.usedPercent}% used, swap ${result.memory.swapUsedPercent ?? 0}% used`);
    for (const row of result.disk) console.log(`- disk ${row.mount}: ${row.usedPercent}% used`);
    for (const row of result.network)
      console.log(`- net ${row.interface}: rx ${row.rxBytesPerSecond} B/s, tx ${row.txBytesPerSecond} B/s`);
    for (const row of result.diskWarnings) console.log(`! disk warning ${row.mount}: ${row.usedPercent}% used`);
    for (const problem of result.manifestProblems) console.log(`! ${problem}`);
  }
  return strict && result.health !== "ok" ? 1 : 0;
}

let exitCode: number;
if (command === "status") exitCode = await status();
else {
  console.error(
    "usage: bun scripts/aphrody/tools/infra/infra-status.ts [status] [--json] [--strict] [--deep] [--host=<alias>]",
  );
  exitCode = 2;
}
process.exit(exitCode);
