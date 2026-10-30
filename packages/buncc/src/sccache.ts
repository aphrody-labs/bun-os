import { run } from "./process.ts";
import type { Env } from "./env.ts";

export interface SccacheProbe {
  path: string | null;
  healthy: boolean;
  reason: string;
}

/** Pure decision: use the wrapper only when the binary exists and answered a real request. */
export function decideWrapper(probe: SccacheProbe, forced?: string): { wrapper: string | null; note: string } {
  if (forced === "off" || forced === "0") return { wrapper: null, note: "sccache disabled by BUNCC_SCCACHE=off" };
  if (!probe.path) return { wrapper: null, note: "sccache not installed" };
  if (!probe.healthy) return { wrapper: null, note: `sccache bypassed: ${probe.reason}` };
  return { wrapper: probe.path, note: "sccache active" };
}

/** `--show-stats` starts the server like a real compile does, so a crashing wrapper fails here instead of mid-build. */
export async function probeSccache(env: Env = Bun.env, timeoutMs = 20_000): Promise<SccacheProbe> {
  const path = Bun.which("sccache");
  if (!path) return { path: null, healthy: false, reason: "not installed" };
  const result = await run([path, "--show-stats"], { output: "capture", timeoutMs, env });
  if (result.timedOut) return { path, healthy: false, reason: `timed out after ${timeoutMs} ms` };
  if (result.code !== 0)
    return {
      path,
      healthy: false,
      reason: `exit ${result.code}: ${(result.stderr || result.stdout).trim().split("\n")[0]?.slice(0, 160) ?? ""}`,
    };
  return { path, healthy: true, reason: "ok" };
}

/** Memoised per process: one probe per buncc invocation. */
let cached: Promise<SccacheProbe> | undefined;
export function sccacheProbe(env: Env = Bun.env): Promise<SccacheProbe> {
  return (cached ??= probeSccache(env));
}
