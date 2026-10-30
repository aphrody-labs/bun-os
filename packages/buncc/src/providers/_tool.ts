import { dirname } from "node:path";
import { findInstalled, installGithubTool, type GithubToolSpec } from "./_github.ts";
import {
  exeSuffix,
  installPlanFor,
  missing,
  parseVersion,
  pathVar,
  pinFromToolchain,
  prependPath,
  probeVersion,
  which,
  type PackageNames,
} from "./_shared.ts";
import { compareVersions, type Context, type Detection, type Platform, type Provider } from "./types.ts";

export interface ToolProviderSpec {
  id: string;
  description: string;
  /** Executable name looked up on PATH. */
  binary: string;
  versionArgs?: string[];
  platforms?: Platform[];
  packages?: PackageNames;
  /** Release-asset install (checksum verified); used by `ensure()` and as a fallback when no package manager is known. */
  github?: GithubToolSpec;
  /** Extra variables once the binary path is known. */
  extraEnv?(bin: string | undefined, ctx: Context): Record<string, string> | Promise<Record<string, string>>;
  /** Shown when nothing can install the tool unattended. */
  manual?: string;
}

export interface ToolProvider extends Provider {
  /** Download the pinned/latest release into the buncc cache. Safe to call repeatedly. */
  ensure(
    ctx: Context,
    options?: { tag?: string; dryRun?: boolean; fetcher?: typeof fetch },
  ): Promise<string | undefined>;
  spec: ToolProviderSpec;
}

async function locate(spec: ToolProviderSpec, ctx: Context): Promise<{ bin: string; version?: string } | undefined> {
  const onPath = which(spec.binary, ctx);
  if (onPath) return { bin: onPath, version: await probeVersion(onPath, spec.versionArgs, ctx) };
  if (spec.github) {
    const local = findInstalled(spec.github);
    if (local)
      return { bin: local.bin, version: (await probeVersion(local.bin, spec.versionArgs, ctx)) ?? local.version };
  }
  return undefined;
}

export function toolProvider(spec: ToolProviderSpec): ToolProvider {
  const platforms = spec.platforms ?? ["win32", "linux", "darwin"];
  return {
    spec,
    id: spec.id,
    description: spec.description,
    platforms,
    async detect(ctx): Promise<Detection> {
      const found = await locate(spec, ctx);
      if (!found) return missing(installHint(spec, ctx));
      const pin = await pinFromToolchain(ctx, spec.id);
      const detection: Detection = { found: true, path: found.bin, version: found.version };
      if (pin && found.version && compareVersions(found.version, pin) < 0) {
        detection.notes = [`${spec.id} ${found.version} is older than the pinned ${pin}`];
        detection.fixHint = installHint(spec, ctx);
      }
      return detection;
    },
    install(ctx) {
      const commands = installPlanFor(spec.packages ?? {}, ctx.platform);
      if (commands.length) return { commands };
      return {
        commands: [],
        manual:
          spec.manual ??
          `install ${spec.id} from ${spec.github ? `https://github.com/${spec.github.repo}/releases` : "your package manager"}`,
      };
    },
    async env(ctx) {
      const found = await locate(spec, ctx);
      const out: Record<string, string> = {};
      if (found) {
        const dir = dirname(found.bin);
        if (!(pathVar(ctx) ?? "").split(process.platform === "win32" ? ";" : ":").includes(dir))
          out.PATH = prependPath(pathVar(ctx), [dir]);
      }
      Object.assign(out, await spec.extraEnv?.(found?.bin, ctx));
      return out;
    },
    pin: ctx => pinFromToolchain(ctx, spec.id),
    async ensure(ctx, options = {}) {
      const existing = await locate(spec, ctx);
      const pin = options.tag ?? (await pinFromToolchain(ctx, spec.id));
      if (existing && (!pin || (existing.version && compareVersions(existing.version, pin.replace(/^v/, "")) >= 0)))
        return existing.bin;
      if (!spec.github) throw new Error(`${spec.id}: no direct download defined; run its install plan`);
      const done = await installGithubTool(spec.github, {
        tag: pin ? tagFor(spec.github, pin) : undefined,
        fetcher: options.fetcher,
        dryRun: options.dryRun,
      });
      return done.bin ?? done.dir;
    },
  };
}

function tagFor(spec: GithubToolSpec, version: string): string {
  return /^[A-Za-z-]+\d|^v\d/.test(version)
    ? version
    : spec.id === "cmake" || spec.id === "ninja"
      ? `v${version}`
      : version;
}

function installHint(spec: ToolProviderSpec, ctx: Context): string {
  const plan = installPlanFor(spec.packages ?? {}, ctx.platform);
  return plan.length ? plan.map(c => c.join(" ")).join(" && ") : `buncc install ${spec.id}`;
}

export { exeSuffix, parseVersion };
