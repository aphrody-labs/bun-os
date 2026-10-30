/**
 * Chromium's depot_tools and GN: locate or clone depot_tools, format GN args, run `gn gen` and `autoninja`.
 * https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools_tutorial.html
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { exeSuffix, missing, pathVar, prependPath, probeVersion, which } from "./_shared.ts";
import type { Context, Provider } from "./types.ts";

export const DEPOT_TOOLS_URL = "https://chromium.googlesource.com/chromium/tools/depot_tools.git";

export function findDepotTools(
  ctx: Pick<Context, "env" | "platform">,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const explicit = ctx.env.DEPOT_TOOLS_PATH;
  if (explicit && exists(join(explicit, "gclient.py"))) return explicit;
  const onPath = which("gclient", ctx as Context) ?? which("autoninja", ctx as Context);
  if (onPath && exists(join(dirname(onPath), "gclient.py"))) return dirname(onPath);
  return undefined;
}

export function cloneCommands(dest: string): string[][] {
  return [["git", "clone", "--depth", "1", DEPOT_TOOLS_URL, dest]];
}

export const gnProvider: Provider = {
  id: "gn",
  description: "depot_tools (gclient, gn, autoninja) for Chromium-style builds",
  platforms: ["win32", "linux", "darwin"],
  async detect(ctx) {
    const root = findDepotTools(ctx);
    if (!root) return missing(`git clone ${DEPOT_TOOLS_URL} <dir> and add it to PATH (or set DEPOT_TOOLS_PATH)`);
    const gn = which("gn", ctx);
    const notes = gn ? undefined : ["gn is fetched by gclient sync/ensure_bootstrap on first use"];
    return { found: true, path: root, version: gn ? await probeVersion(gn, ["--version"], ctx) : undefined, notes };
  },
  install(ctx) {
    return { commands: cloneCommands(join(ctx.root, "..", "depot_tools")) };
  },
  async env(ctx) {
    const root = findDepotTools(ctx);
    if (!root) return {};
    const out: Record<string, string> = { PATH: prependPath(pathVar(ctx), [root]), DEPOT_TOOLS_UPDATE: "0" };
    // Use the locally installed Visual Studio instead of Google's internal toolchain package.
    if (ctx.platform === "win32") out.DEPOT_TOOLS_WIN_TOOLCHAIN = "0";
    return out;
  },
};

export { exeSuffix };
