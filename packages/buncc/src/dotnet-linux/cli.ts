/**
 * `buncc dotnet <pins|install|env|doctor|publish|pwsh>` and `buncc pwsh`: upstream .NET SDK and PowerShell on Linux,
 * pinned in factory/dotnet-linux/pins.json. Dry run unless --run is given (install) or --exec (publish).
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "../process.ts";
import { aotPrerequisites, runtimeIdentifier } from "../providers/dotnet.ts";
import { makeContext } from "../providers/index.ts";
import { defaultPrefix, installPinned, layout, prefixEnv } from "./install.ts";
import { loadPins, WHAT, type WhatKey } from "./pins.ts";
import { publishPlan } from "./publish.ts";

export const DOTNET_USAGE = `buncc dotnet: upstream .NET SDK and PowerShell on Linux (pins: factory/dotnet-linux/pins.json)

  buncc dotnet pins [--json]                          pinned versions, sources and hashes
  buncc dotnet install [sdk10|sdk11|pwsh|pwsh-preview|all] [--rid linux-x64|linux-arm64|linux-musl-x64|linux-musl-arm64] [--prefix d] [--run]
                                                      checksum-verified tarball install (SHA-512 .NET, SHA-256 PowerShell); dry run without --run
  buncc dotnet env [--prefix d] [--shell sh|pwsh|json]
  buncc dotnet doctor [--prefix d]                    installed versions vs pins, NativeAOT prerequisites
  buncc dotnet publish <project> -r <rid> [--aot] [--native-lib] [--self-contained] [--channel 10.0|11.0] [-o dir] [--exec] [-- msbuild args]
                                                      plan (and with --exec run) dotnet publish; NativeAOT cross-OS is refused as Microsoft documents
  buncc pwsh [pwsh arguments]                         run the pinned PowerShell with the prefix environment`;

function parse(args: string[]) {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-r" || a === "-o") flags.set(a === "-r" ? "rid" : "output", args[++i] ?? "");
    else if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      const next = args[i + 1];
      if (v !== undefined) flags.set(k!, v);
      else if (["rid", "prefix", "shell", "channel"].includes(k!) && next && !next.startsWith("-")) flags.set(k!, args[++i]!);
      else flags.set(k!, "true");
    } else positional.push(a);
  }
  return { flags, positional };
}

async function version(cmd: string[], env: Record<string, string>): Promise<string | undefined> {
  const r = await run(cmd, { output: "capture", env, timeoutMs: 60_000 });
  return r.code === 0 ? r.stdout.trim() : undefined;
}

export async function dotnetLinuxMain(args: string[], root: string, command = "dotnet"): Promise<number> {
  if (command === "pwsh") {
    const prefix = defaultPrefix();
    const pwsh = join(prefix, "bin", "pwsh");
    const exe = existsSync(pwsh) ? pwsh : (Bun.which("pwsh") ?? "pwsh");
    return (await run([exe, ...args], { output: "inherit", stdin: "inherit", env: { ...Bun.env, ...prefixEnv(prefix) } })).code;
  }
  const [sub = "help", ...all] = args;
  const dash = all.indexOf("--");
  const rest = dash < 0 ? all : all.slice(0, dash);
  const passthrough = dash < 0 ? [] : all.slice(dash + 1);
  const { flags, positional } = parse(rest);
  const prefix = resolve(flags.get("prefix") ?? defaultPrefix());
  const rid = flags.get("rid") ?? runtimeIdentifier();
  const pins = () => loadPins(root);
  switch (sub) {
    case "help":
    case "--help":
      console.log(DOTNET_USAGE);
      return 0;
    case "pins": {
      const p = pins();
      if (flags.has("json")) {
        console.log(JSON.stringify(p, null, 2));
        return 0;
      }
      for (const k of ["10.0", "11.0"] as const)
        console.log(`.NET ${k.padEnd(5)} SDK ${p.dotnet[k].sdk}  runtime ${p.dotnet[k].runtime}  (${p.dotnet[k].supportPhase}, ${p.dotnet[k].release})`);
      for (const k of ["stable", "preview"] as const) console.log(`PowerShell ${k.padEnd(8)} ${p.powershell[k].version}  (${p.powershell[k].tag})`);
      console.log(`observed ${p.observedAt}; refresh: bun factory/dotnet-linux/refresh.ts`);
      return 0;
    }
    case "install": {
      const what = positional[0] ?? "all";
      const list: WhatKey[] = what === "all" ? ["sdk10", "pwsh"] : [what as WhatKey];
      for (const w of list) if (!WHAT.includes(w)) throw new Error(`unknown component ${w}; use ${WHAT.join(", ")} or all`);
      if (what === "all") console.error("buncc dotnet: 'all' installs sdk10 and pwsh; add sdk11 / pwsh-preview explicitly");
      for (const w of list) {
        const receipt = await installPinned({ root, what: w, rid, prefix, dryRun: !flags.has("run") });
        console.log(JSON.stringify(receipt));
      }
      if (!flags.has("run")) console.log("dry run: pass --run to download and install");
      return 0;
    }
    case "env": {
      const env = prefixEnv(prefix);
      const shell = flags.get("shell") ?? "sh";
      if (shell === "json") console.log(JSON.stringify(env, null, 2));
      else
        for (const [k, v] of Object.entries(env))
          console.log(shell === "pwsh" ? `$env:${k} = '${v.replaceAll("'", "''")}'` : `export ${k}='${v.replaceAll("'", "'\\''")}'`);
      return 0;
    }
    case "doctor": {
      const p = pins();
      const env = { ...Bun.env, ...prefixEnv(prefix) } as Record<string, string>;
      let bad = 0;
      const dotnet = join(prefix, "dotnet", "dotnet");
      const sdks = existsSync(dotnet) ? ((await version([dotnet, "--list-sdks"], env)) ?? "") : "";
      for (const [w, want] of [["sdk10", p.dotnet["10.0"].sdk], ["sdk11", p.dotnet["11.0"].sdk]] as const) {
        const ok = sdks.includes(want);
        if (!ok && w === "sdk10") bad++;
        console.log(`${ok ? "ok " : w === "sdk10" ? "ERR" : "-- "} ${w.padEnd(13)} want ${want}`);
      }
      for (const [w, want] of [["pwsh", p.powershell.stable.version], ["pwsh-preview", p.powershell.preview.version]] as const) {
        const exe = layout(prefix, w, want).marker;
        const got = existsSync(exe) ? await version([exe, "-NoProfile", "-NoLogo", "-Command", "$PSVersionTable.PSVersion.ToString()"], env) : undefined;
        const ok = got === want;
        if (!ok && w === "pwsh") bad++;
        console.log(`${ok ? "ok " : w === "pwsh" ? "ERR" : "-- "} ${w.padEnd(13)} want ${want}${got ? `  got ${got}` : "  missing"}`);
      }
      for (const q of await aotPrerequisites(makeContext(root)))
        console.log(`${q.ok ? "ok " : "-- "} NativeAOT: ${q.name}  ${q.detail}${q.ok ? "" : `  fix: ${q.fix}`}`);
      return bad ? 1 : 0;
    }
    case "publish": {
      const plan = publishPlan({
        project: positional[0],
        rid,
        aot: flags.has("aot"),
        nativeLib: flags.has("native-lib") ? "Shared" : undefined,
        selfContained: flags.has("self-contained"),
        channel: (flags.get("channel") as "10.0" | "11.0" | undefined) ?? "10.0",
        output: flags.get("output"),
      });
      plan.args.push(...passthrough);
      for (const e of plan.errors) console.error(`buncc dotnet: ${e}`);
      for (const n of plan.needs) console.error(`needs: ${n}`);
      console.log(["dotnet", ...plan.args].join(" "));
      if (!plan.ok) return 2;
      if (!flags.has("exec")) return 0;
      const env = { ...Bun.env, ...prefixEnv(prefix) } as Record<string, string>;
      return (await run([join(prefix, "dotnet", "dotnet"), ...plan.args], { output: "inherit", env })).code;
    }
    default:
      console.error(DOTNET_USAGE);
      return 2;
  }
}
