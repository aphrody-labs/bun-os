// SPDX-License-Identifier: Apache-2.0
// Shared helpers of the Bun OS Store repositories. Everything here runs on the VPS (Linux); the Windows
// workstation only edits sources. Each format module exports `build(ctx)` and `qualify(ctx)`.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const FORMATS = ["pacman", "apk", "flatpak", "npm", "cargo", "android", "winget", "apt", "appstream"] as const;
export type Format = (typeof FORMATS)[number];

export interface Ctx {
  /** Repository checkout (git root). */
  root: string;
  /** Persistent store served by nginx (STORE_ROOT). */
  store: string;
  /** Public origin of the repositories. */
  origin: string;
  /** Protected key store; never printed, never served. */
  secrets: string;
}
export interface IndexEntry {
  name: string;
  version: string;
  desc: string;
  license?: string;
  size?: number;
  sha256?: string;
  /** URL path of the artifact below the origin. */
  file?: string;
  homepage?: string;
  /** Repository path of the owner (packages/x, crates/y, apps/z, factory/...). */
  member?: string;
  /** Pacman/apk/flatpak/npm/cargo specific extras shown by the Store. */
  meta?: Record<string, unknown>;
}
export interface FormatIndex {
  format: Format;
  generated: string;
  /** URL of the repository below the origin. */
  url: string;
  entries: IndexEntry[];
  /** Members that could not be published, with the reason. */
  skipped?: { name: string; reason: string }[];
}
export interface QualStep {
  name: string;
  ok: boolean;
  ms: number;
  /** Last lines of output, secrets removed. */
  log: string;
}
export interface QualResult {
  format: Format;
  ok: boolean;
  at: string;
  image?: string;
  steps: QualStep[];
}

export function context(): Ctx {
  const root = resolve(import.meta.dir, "../../..");
  const home = Bun.env.HOME ?? "/root";
  return {
    root,
    store: resolve(Bun.env.WEBOS_STORE ?? join(home, "apps/webos/store")),
    origin: Bun.env.WEBOS_STORE_ORIGIN ?? "https://aphrody.com",
    secrets: resolve(Bun.env.WEBOS_STORE_SECRETS ?? join(home, "apps/webos/secrets/store")),
  };
}

export const sha256 = async (path: string) =>
  new Bun.CryptoHasher("sha256").update(await Bun.file(path).bytes()).digest("hex");

export async function writeIndex(ctx: Ctx, index: FormatIndex) {
  await mkdir(join(ctx.store, "index"), { recursive: true });
  await Bun.write(join(ctx.store, "index", `${index.format}.json`), JSON.stringify(index, null, 1));
}
export async function readIndex(ctx: Ctx, format: Format): Promise<FormatIndex | undefined> {
  try {
    return (await Bun.file(join(ctx.store, "index", `${format}.json`)).json()) as FormatIndex;
  } catch {
    return undefined;
  }
}

/** Run a command, return exit code and merged output. Bounded by a timeout. */
export async function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; timeout?: number; stdin?: string } = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    timeout: opts.timeout ?? 600_000,
    killSignal: "SIGKILL",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out: out + err };
}
export const tail = (text: string, lines = 12) => text.trim().split("\n").slice(-lines).join("\n");

/** Run a qualification step and record it. */
export async function step(steps: QualStep[], name: string, fn: () => Promise<{ code: number; out: string }>): Promise<boolean> {
  const t = Date.now();
  let r: { code: number; out: string };
  try {
    r = await fn();
  } catch (error) {
    r = { code: 1, out: String((error as Error).message ?? error) };
  }
  steps.push({ name, ok: r.code === 0, ms: Date.now() - t, log: tail(r.out) });
  return r.code === 0;
}

/** docker run helper for throw-away containers on the host network (no privileges unless asked). */
/** docker run helper for throw-away containers on the host network; `lock` serializes runs that write one repository (flock, six hours). */
export const docker = (image: string, script: string, opts: { privileged?: boolean; mounts?: string[]; user?: string; timeout?: number; env?: Record<string, string>; lock?: string } = {}) =>
  run(
    [
      ...(opts.lock ? ["flock", "-w", "21600", opts.lock] : []),
      "docker", "run", "--rm", "--network", "host",
      ...(opts.privileged ? ["--privileged"] : []),
      ...(opts.user ? ["--user", opts.user] : []),
      ...(opts.mounts ?? []).flatMap((m) => ["-v", m]),
      ...Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
      image, "sh", "-c", script,
    ],
    { timeout: opts.timeout ?? 900_000 },
  );

export const safeName = (s: string) => s.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "-");
