// SPDX-License-Identifier: Apache-2.0
// Loop 2, self-healing runtime (bunos-auto-health.timer, every 2 minutes): probes every live Bun OS endpoint, restarts
// the owning unit after two failed probes in a row, and escalates to an agent over a2a when three restarts in 30
// minutes did not bring it back. Shenron and other non-Bun-OS projects are never touched (lib.ts NEVER_TOUCH).
import {
  closeTasks,
  event,
  fileTask,
  httpStatus,
  loadState,
  NEVER_TOUCH,
  run,
  saveState,
  sudo,
  tcpOpen,
} from "./lib.ts";

export interface Probe {
  name: string;
  unit: string;
  /** false: escalate after repeated failures without restarting (data problems a restart cannot fix). */
  restart?: false;
  check: () => Promise<{ ok: boolean; detail: string }>;
}

const http =
  (url: string, accept: (code: number) => boolean = code => code >= 200 && code < 400) =>
  async () => {
    const code = await httpStatus(url, 12_000);
    return { ok: accept(code), detail: `HTTP ${code || "unreachable"} ${url}` };
  };
const tcp = (port: number) => async () => {
  const ok = await tcpOpen("127.0.0.1", port);
  return { ok, detail: `tcp 127.0.0.1:${port} ${ok ? "open" : "closed"}` };
};
const alive = (code: number) => code > 0 && code < 500;

/** The live product surface. `unit` is what gets restarted when the probe keeps failing. */
export const PROBES: Probe[] = [
  {
    name: "webos /api/health",
    unit: "aphrody-webos.service",
    async check() {
      try {
        const res = await fetch("http://127.0.0.1:8790/api/health", { signal: AbortSignal.timeout(12_000) });
        const body = (await res.json()) as { ok?: boolean; sourceCommit?: string };
        return { ok: res.ok && body.ok === true, detail: `ok=${body.ok} commit=${body.sourceCommit?.slice(0, 10)}` };
      } catch (error) {
        return { ok: false, detail: String(error).slice(0, 200) };
      }
    },
  },
  {
    name: "public https://aphrody.com/api/health",
    unit: "nginx.service",
    check: http("https://aphrody.com/api/health"),
  },
  {
    name: "/api/android",
    unit: "aphrody-android-gateway.service",
    check: http("https://aphrody.com/api/android/", alive),
  },
  { name: "android gateway", unit: "aphrody-android-gateway.service", check: tcp(8799) },
  { name: "store API", unit: "aphrody-store.service", check: http("http://127.0.0.1:8791/", alive) },
  {
    name: "store apt repo",
    unit: "aphrody-store.service",
    // A missing feed file is a publishing problem, not a crashed service: escalate, do not restart.
    restart: false,
    check: http("https://aphrody.com/repo/apt/dists/resolute/InRelease"),
  },
  { name: "site", unit: "aphrody-site.service", check: http("http://127.0.0.1:8083/health") },
  { name: "chat gateway", unit: "aphrody-chat-gateway.service", check: http("http://127.0.0.1:8794/v1/models") },
  { name: "downloads", unit: "aphrody-downloads.service", check: tcp(8797) },
  { name: "bun-os-server", unit: "aphrody-bun-os-server.service", check: tcp(29030) },
  { name: "a2a hub", unit: "aphrody-a2a.service", check: http("http://127.0.0.1:8788/ping") },
  {
    name: "Android 17 container",
    unit: "aphrody-android17.service",
    async check() {
      const active = await run(["systemctl", "is-active", "aphrody-android17.service"]);
      const status = await run(["waydroid", "status"], { timeoutMs: 20_000 });
      const running = /Session:\s*RUNNING/i.test(status.out) && /Container:\s*RUNNING/i.test(status.out);
      return {
        ok: active.out.trim() === "active" && running,
        detail: `unit ${active.out.trim()}; ${status.out.replace(/\s+/g, " ").slice(0, 120)}`,
      };
    },
  },
];

/** Units that must be active even without an HTTP surface (the stream session stack). */
export const UNITS = [
  "aphrody-remote.service",
  "aphrody-desktop-xvfb.service",
  "aphrody-desktop-wm.service",
  "aphrody-web-browser-vps.service",
  "aphrody-fonts-proxy.service",
  "waydroid-container.service",
  "aphrody-webos-deploy.timer",
  "aphrody-selfheal.timer",
  "aphrody-priority.timer",
  "docker.service",
  "nginx.service",
];

interface HealthState {
  probes: Record<string, { ok: boolean; failures: number; detail: string; at: string }>;
  restarts: Record<string, string[]>;
}

async function restart(unit: string, reason: string, state: HealthState) {
  if (NEVER_TOUCH.test(unit)) return;
  const recent = (state.restarts[unit] ?? []).filter(at => Date.now() - Date.parse(at) < 30 * 60_000);
  if (recent.length >= 3) {
    await fileTask({
      key: `health:${unit}`,
      kind: "escalation",
      title: `${unit} stays down after ${recent.length} restarts in 30 minutes`,
      detail: `${reason}\nLast logs: journalctl -u ${unit} -n 80 on the VPS. The health loop keeps probing; fix the cause on main.`,
    });
    state.restarts[unit] = recent;
    return;
  }
  await sudo(["systemctl", "reset-failed", unit]);
  const r = await sudo(["systemctl", "restart", unit], 180_000);
  recent.push(new Date().toISOString());
  state.restarts[unit] = recent;
  event("health", "restart", `${unit} (${reason})${r.code ? `: restart failed ${r.out.slice(0, 200)}` : ""}`);
}

export async function health() {
  const state = loadState<HealthState>("health", { probes: {}, restarts: {} });
  const results = await Promise.all(PROBES.map(async probe => ({ probe, ...(await probe.check()) })));
  const toRestart = new Map<string, string>();
  for (const { probe, ok, detail } of results) {
    const previous = state.probes[probe.name];
    const failures = ok ? 0 : (previous?.failures ?? 0) + 1;
    state.probes[probe.name] = { ok, failures, detail, at: new Date().toISOString() };
    if (previous && previous.ok !== ok) event("health", ok ? "recovered" : "down", `${probe.name}: ${detail}`);
    if (probe.restart === false) {
      if (ok) closeTasks(`health:probe:${probe.name}`, "probe green again");
      // Fifteen failed probes (30 minutes): an agent looks at it.
      else if (failures >= 15)
        await fileTask({
          key: `health:probe:${probe.name}`,
          kind: "escalation",
          title: `${probe.name} failing for ${failures * 2} minutes`,
          detail: `${detail}\nNot a crashed service (no restart helps): fix the published data or its nginx location.`,
        });
      continue;
    }
    if (ok) closeTasks(`health:${probe.unit}`, "probe green again");
    // Two failed probes in a row (about 4 minutes) before a restart: one slow answer is not an outage.
    if (failures >= 2) toRestart.set(probe.unit, `${probe.name}: ${detail}`);
  }
  for (const unit of UNITS) {
    const active = (await run(["systemctl", "is-active", unit])).out.trim();
    state.probes[`unit ${unit}`] = {
      ok: active === "active",
      failures: 0,
      detail: active,
      at: new Date().toISOString(),
    };
    if (active !== "active" && active !== "activating") toRestart.set(unit, `unit ${active}`);
  }
  for (const [unit, reason] of toRestart) await restart(unit, reason, state);
  saveState("health", state);
  const down = Object.entries(state.probes).filter(([, p]) => !p.ok);
  console.log(`health: ${Object.keys(state.probes).length - down.length}/${Object.keys(state.probes).length} green`);
  return state;
}
