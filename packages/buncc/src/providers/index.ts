import { currentPlatform, type Context, type Detection, type Provider } from "./types.ts";
import { msvc } from "./msvc.ts";
import { rust } from "./rust.ts";
import { toolProviders } from "./tools.ts";
import { REPLACES_CORE_IDS, toolchainProviders } from "./toolchains.ts";
import { probeSccache } from "../sccache.ts";

/** sccache health, not just presence: a crashing wrapper is reported as unhealthy. */
const sccacheHealth: Provider = {
  id: "sccache-health",
  description: "sccache answers a real request (crashing wrapper detection)",
  platforms: ["win32", "linux", "darwin"],
  async detect(ctx: Context): Promise<Detection> {
    const probe = await probeSccache(ctx.env);
    return probe.healthy
      ? { found: true, path: probe.path ?? undefined }
      : {
          found: false,
          path: probe.path ?? undefined,
          notes: [probe.reason],
          fixHint:
            "buncc bypasses sccache automatically; run `sccache --stop-server` then retry, or set BUNCC_SCCACHE=off",
        };
  },
  install: () => ({ commands: [], manual: "Install sccache with `buncc install sccache`." }),
  env: async () => ({}),
};

/** Providers with verified downloads and argument builders (toolchains.ts) win over the detect-only core ones of the same id. */
const replaced = new Set<string>(REPLACES_CORE_IDS);
export const providers: Provider[] = [
  ...toolchainProviders,
  ...[msvc, rust, sccacheHealth, ...toolProviders].filter(provider => !replaced.has(provider.id)),
];

export function getProvider(id: string): Provider {
  const found = providers.find(provider => provider.id === id);
  if (!found) throw new Error(`Unknown provider: ${id}. Known: ${providers.map(provider => provider.id).join(", ")}`);
  return found;
}

export function makeContext(root: string, env = Bun.env as Context["env"]): Context {
  return { platform: currentPlatform(), root, env };
}

/** Providers that apply to the current platform. */
export function applicable(ctx: Context): Provider[] {
  return providers.filter(provider => provider.platforms.includes(ctx.platform));
}

export * from "./types.ts";
