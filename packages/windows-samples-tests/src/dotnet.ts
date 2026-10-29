/** .NET driver for the sample matrix: SDK resolution, build and NativeAOT arguments come from buncc's dotnet provider. */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  aotPublishArgs,
  buildArgs,
  candidateRoots,
  listInstalls,
  resolveInstall,
} from "../../buncc/src/providers/dotnet.ts";

export const repoRoot = resolve(import.meta.dir, "../../..");
/** Portable SDK root (dotnet-install, no machine-wide change); override with BUNOS_DOTNET_ROOT. */
export const portableRoot = Bun.env.BUNOS_DOTNET_ROOT ?? join(homedir(), "tools", "dotnet-portable");

export interface Dotnet {
  exe: string;
  sdk: string;
  env: Record<string, string>;
}

/** The dotnet a command run in `cwd` uses, honouring that directory's global.json. */
export function resolveDotnet(cwd: string): Dotnet | undefined {
  const env = { ...(process.env as Record<string, string>), DOTNET_ROOT: portableRoot };
  const choice = resolveInstall(listInstalls(candidateRoots(env, "win32")), cwd);
  if (!choice) return undefined;
  const exe = join(choice.root, "dotnet.exe");
  if (!existsSync(exe)) return undefined;
  return {
    exe,
    sdk: choice.sdk,
    env: {
      ...env,
      DOTNET_ROOT: choice.root,
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_NOLOGO: "1",
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      DOTNET_MULTILEVEL_LOOKUP: "0",
      DOTNET_CLI_HOME: join(portableRoot, ".cli-home"),
      PATH: [choice.root, "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer", process.env.PATH ?? ""].join(";"),
    },
  };
}

export async function runDotnet(dn: Dotnet, args: string[], cwd: string, timeoutMs = 900_000) {
  const proc = Bun.spawn([dn.exe, ...args], { cwd, env: dn.env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);
  return { code, stdout, stderr };
}

export const dotnetBuild = (dn: Dotnet, dir: string) => runDotnet(dn, buildArgs({ config: "Release" }), dir);
export const dotnetAot = (dn: Dotnet, dir: string, channel: "aot-dotnet10" | "aot-dotnet11", out: string) =>
  runDotnet(dn, aotPublishArgs({ profile: channel, output: out }), dir);
