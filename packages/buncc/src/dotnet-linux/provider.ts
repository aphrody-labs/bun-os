/** `pwsh` provider for `buncc doctor` / `buncc install` / `buncc env`: PowerShell found in the pinned prefix or on PATH, checked against the pin. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "../process.ts";
import { pathVar, prependPath } from "../providers/_shared.ts";
import type { Context, Detection, Provider } from "../providers/types.ts";
import { defaultPrefix } from "./install.ts";
import { loadPins } from "./pins.ts";

function pinned(ctx: Context): string | undefined {
  try {
    return loadPins(ctx.root).powershell.stable.version;
  } catch {
    return undefined;
  }
}

export const pwshProvider: Provider = {
  id: "pwsh",
  description: "PowerShell 7 (upstream tarball pinned in factory/dotnet-linux/pins.json; buncc pwsh runs it)",
  platforms: ["win32", "linux", "darwin"],
  async detect(ctx): Promise<Detection> {
    const prefixed = join(defaultPrefix(ctx.env), "bin", "pwsh");
    const exe = existsSync(prefixed)
      ? prefixed
      : (Bun.which("pwsh", { PATH: pathVar(ctx) ?? "" } as never) ?? Bun.which("pwsh"));
    if (!exe) return { found: false, fixHint: "buncc dotnet install pwsh --run" };
    const r = await run(
      [exe, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"],
      { output: "capture", timeoutMs: 60_000 },
    );
    const version = r.code === 0 ? r.stdout.trim() : undefined;
    const want = pinned(ctx);
    return {
      found: !!version,
      path: exe,
      version,
      notes:
        want && version && version !== want ? [`pin is ${want}; \`buncc dotnet install pwsh --run\` installs it`] : [],
    };
  },
  install(ctx) {
    if (ctx.platform === "win32")
      return { commands: [["winget", "install", "--id", "Microsoft.PowerShell", "-e", "--silent"]] };
    return {
      commands: [[process.execPath, join(import.meta.dir, "..", "cli.ts"), "dotnet", "install", "pwsh", "--run"]],
    };
  },
  async env(ctx): Promise<Record<string, string>> {
    const bin = join(defaultPrefix(ctx.env), "bin");
    return existsSync(bin)
      ? { POWERSHELL_TELEMETRY_OPTOUT: "1", POWERSHELL_UPDATECHECK: "Off", PATH: prependPath(pathVar(ctx), [bin]) }
      : { POWERSHELL_TELEMETRY_OPTOUT: "1" };
  },
  async pin(ctx) {
    return pinned(ctx);
  },
};
