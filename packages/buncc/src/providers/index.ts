import { currentPlatform, type Context, type Detection, type InstallPlan, type Provider } from "./types.ts";
import { msvc } from "./msvc.ts";
import { rust } from "./rust.ts";
import { toolProviders } from "./tools.ts";
import { probeSccache } from "../sccache.ts";

/** vcpkg in manifest mode: VCPKG_ROOT, a binary cache directory and the triplet for the host. */
const vcpkg: Provider = {
  id: "vcpkg",
  description: "vcpkg package manager (manifest mode, binary cache)",
  platforms: ["win32", "linux", "darwin"],
  async detect(ctx: Context): Promise<Detection> {
    const root = ctx.env.VCPKG_ROOT;
    const bin = Bun.which("vcpkg") ?? (root ? `${root}/vcpkg${ctx.platform === "win32" ? ".exe" : ""}` : null);
    if (!bin || !(await Bun.file(bin).exists()))
      return {
        found: false,
        fixHint:
          "git clone https://github.com/microsoft/vcpkg C:\\src\\vcpkg && C:\\src\\vcpkg\\bootstrap-vcpkg.bat -disableMetrics",
      };
    return { found: true, path: bin };
  },
  install(ctx: Context): InstallPlan {
    const dir = ctx.platform === "win32" ? "C:\\src\\vcpkg" : `${Bun.env.HOME ?? "~"}/src/vcpkg`;
    const bootstrap =
      ctx.platform === "win32"
        ? [`${dir}\\bootstrap-vcpkg.bat`, "-disableMetrics"]
        : ["sh", `${dir}/bootstrap-vcpkg.sh`, "-disableMetrics"];
    return { commands: [["git", "clone", "--depth", "1", "https://github.com/microsoft/vcpkg", dir], bootstrap] };
  },
  async env(ctx: Context) {
    const out: Record<string, string> = {};
    const root =
      ctx.env.VCPKG_ROOT ?? (Bun.which("vcpkg") ? Bun.which("vcpkg")!.replace(/[\\/][^\\/]*$/, "") : undefined);
    if (root) {
      out.VCPKG_ROOT = root;
      out.CMAKE_TOOLCHAIN_FILE = `${root}/scripts/buildsystems/vcpkg.cmake`;
    }
    out.VCPKG_DISABLE_METRICS = "1";
    return out;
  },
};

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

export const providers: Provider[] = [msvc, rust, vcpkg, sccacheHealth, ...toolProviders];

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
