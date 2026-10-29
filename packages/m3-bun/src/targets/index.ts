// SPDX-License-Identifier: Apache-2.0
// The deploy targets of m3-bun. Every target is a function from a `TargetContext` to files; `generateTargets`
// writes them below `<out>/<id>/` and nothing else. No target applies anything: no docker push, no flyctl, no
// wrangler deploy, no systemctl, no nginx reload, no tauri build, no registry write, no theme install,
// no Lambda publish, no GitHub release.
import { join, resolve } from "node:path";
import { yoloRoot, writeFiles, type GeneratedFile } from "../util.ts";
import type { M3App } from "../config.ts";
import { cloudflare } from "./cloudflare.ts";
import { coolify } from "./coolify.ts";
import { docker } from "./docker.ts";
import { fly } from "./fly.ts";
import { lambda } from "./lambda.ts";
import { next } from "./next.ts";
import { nginx } from "./nginx.ts";
import { osThemes } from "./os-themes.ts";
import { release } from "./release.ts";
import { systemd } from "./systemd.ts";
import { tauri } from "./tauri.ts";
import type { Target, TargetContext } from "./types.ts";
import { vercel } from "./vercel.ts";
import { vscode } from "./vscode.ts";
import { webos } from "./webos.ts";
import { windows } from "./windows.ts";

export type { Target, TargetContext, TargetFile } from "./types.ts";
export { inspectWindows, type WindowsInspection } from "./windows-inspect.ts";
export { verifyWebView, type VerifyWebViewOptions, type WebViewReport } from "./webos.ts";
export { windowsIcon } from "./windows.ts";

export const TARGETS: readonly Target[] = [
  docker,
  systemd,
  nginx,
  vercel,
  fly,
  cloudflare,
  coolify,
  vscode,
  windows,
  tauri,
  webos,
  lambda,
  osThemes,
  release,
  next,
];

export function getTarget(id: string): Target {
  const target = TARGETS.find(t => t.id === id);
  if (!target) throw new Error(`m3-bun: unknown deploy target ${id} (${TARGETS.map(t => t.id).join(", ")})`);
  return target;
}

/** The context of `app`, with the deploy section of its config applied. */
export function contextFor(app: M3App, overrides: Partial<TargetContext> = {}): TargetContext {
  const deploy = app.bun.deploy ?? {};
  const relativeApi = app.api ? app.api.slice(app.dir.length + 1).replaceAll("\\", "/") : undefined;
  const theme = app.m3.theme ?? {};
  return {
    name: app.name,
    version: app.version,
    port: app.port,
    ...(deploy.domain ? { domain: deploy.domain } : {}),
    image: deploy.image ?? `ghcr.io/aphrody-labs/${app.name}`,
    namespace: deploy.namespace ?? "aphrody",
    user: deploy.user ?? "ubuntu",
    region: deploy.region ?? "cdg",
    binary: app.name,
    outdir: app.outdir.slice(app.dir.length + 1).replaceAll("\\", "/") || "dist",
    ...(relativeApi ? { api: relativeApi } : {}),
    bunVersion: Bun.version,
    yoloRoot: yoloRoot(),
    cli: "bunx --bun m3-bun",
    tls: "letsencrypt",
    ...(app.bun.compile?.windows ? { windows: app.bun.compile.windows } : {}),
    appDir: app.dir,
    ...(theme.seed ? { seed: theme.seed } : {}),
    ...(theme.variant ? { variant: theme.variant } : {}),
    ...overrides,
  };
}

export interface GeneratedTarget {
  id: string;
  dir: string;
  files: string[];
}

/** Generate `ids` (or every target) into `<out>/<id>/`. Returns what was written. */
export async function generateTargets(
  ids: readonly string[],
  context: TargetContext,
  out: string,
): Promise<GeneratedTarget[]> {
  const targets = ids.length === 0 || ids.includes("all") ? TARGETS : ids.map(getTarget);
  const generated: GeneratedTarget[] = [];
  for (const target of targets) {
    const dir = resolve(join(out, target.id));
    // oxlint-disable-next-line no-await-in-loop -- Target generators may build artifacts; complete one target before starting the next.
    const files = await target.generate({ ...context, targetDir: dir });
    // `writeFiles` hands the content to `Bun.write`, which takes bytes as well as text.
    // oxlint-disable-next-line no-await-in-loop -- Persist a target before proceeding so failures cannot leave later targets partially generated.
    generated.push({
      id: target.id,
      dir,
      files: await writeFiles(dir, files as GeneratedFile[]),
    });
  }
  return generated;
}
