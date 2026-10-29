import type { Env } from "../env.ts";

export type Platform = "win32" | "linux" | "darwin";

export interface Detection {
  found: boolean;
  path?: string;
  version?: string;
  notes?: string[];
  /** One line telling the user how to fix a missing or broken tool. */
  fixHint?: string;
}

export interface InstallPlan {
  /** Commands run in order. Never interactive. */
  commands: string[][];
  /** Set when no unattended command exists. */
  manual?: string;
}

export interface Context {
  platform: Platform;
  /** Repository root used to find rust-toolchain.toml, buncc.toolchain.json, components.json. */
  root: string;
  env: Env;
}

/** A toolchain component: how to find it, install it, put it on the environment and pin its version. */
export interface Provider {
  id: string;
  description: string;
  platforms: Platform[];
  detect(ctx: Context): Promise<Detection>;
  install(ctx: Context): InstallPlan;
  /** Variables to overlay on the build environment so tools find this component. */
  env(ctx: Context): Promise<Record<string, string>>;
  /** Minimum version from buncc.toolchain.json, when pinned. */
  pin?(ctx: Context): Promise<string | undefined>;
}

export function currentPlatform(): Platform {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}

/** Compare dotted versions numerically. Returns negative, zero or positive like a comparator. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}
