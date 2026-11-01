#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { bridgeDriver, cdpDriver, runParity } from "./drivers.ts";
import { generateProject } from "./generate.ts";
import { planConversion } from "./plan.ts";
import { probeDirectory, probeUrl } from "./probe.ts";
import type { ConversionPlan, ExternalLinks, PlanOptions, Probe, WrapEngine, WrapMode } from "./types.ts";

const HELP = `web-to-tauri: convert a website, web app or built bundle into a native Tauri 3 app.

USAGE
  web-to-tauri probe   <url|dir> [--json]
  web-to-tauri plan    <url|dir> [options] [--json] [--strict]
  web-to-tauri convert <url|dir> --out <dir> [options] [--strict]
  web-to-tauri parity  <project> [--reference-cdp ws://..] [--bridge [exe] | --app-cdp ws://..]
                       [--reference-base <origin>] [--app-base <origin>] [--json]

OPTIONS
  --name <text>            product name (default: manifest name, title or package name)
  --mode auto|remote|bundle|sidecar   (default auto: a URL is remote, a directory is bundle or sidecar)
  --engine auto|wry|cef    (default auto: cef only when the page needs Chromium-only APIs)
  --allow-origin <pattern> extra in-app origin, repeatable (https://*.example.com)
  --external system|inapp|deny   other sites: system browser (default), same window, blocked
  --user-agent <text>      fixed user agent
  --backend <origin>       backend of a bundle: its API routes are proxied
  --port <n>               fixed sidecar port (keeps OAuth callbacks valid)
  --wrap-crate <dir>       tauri-plugin-aphrody crate (default crates/tauri-plugin-aphrody)
  --no-lock                do not copy the repository Cargo.lock
  --force                  write into a non-empty directory (never overwrites a file)
  --strict                 exit 2 when the plan needs review
  --json                   machine-readable output

A green build is not parity: 'parity' needs the running app. Skipped captures are reported as skipped.`;

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string[]>;
  bool: Set<string>;
}

const BOOLEAN = new Set(["json", "strict", "force", "no-lock", "help", "bridge"]);

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string[]>();
  const bool = new Set<string>();
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (BOOLEAN.has(key)) {
      bool.add(key);
      // `--bridge [exe]`: an optional value that does not start with a dash.
      if (key === "bridge" && rest[index + 1] && !rest[index + 1]!.startsWith("--")) {
        flags.set(key, [...(flags.get(key) ?? []), rest[(index += 1)]!]);
      }
      continue;
    }
    const value = rest[(index += 1)];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }
  return { command, positional, flags, bool };
}

function one(args: Args, key: string): string | undefined {
  return args.flags.get(key)?.at(-1);
}

function planOptions(args: Args): PlanOptions {
  const mode = one(args, "mode") as WrapMode | "auto" | undefined;
  const engine = one(args, "engine") as WrapEngine | "auto" | undefined;
  const external = one(args, "external") as ExternalLinks | undefined;
  if (mode && !["auto", "remote", "bundle", "sidecar"].includes(mode)) throw new Error(`unknown mode ${mode}`);
  if (engine && !["auto", "wry", "cef"].includes(engine)) throw new Error(`unknown engine ${engine}`);
  if (external && !["system", "inapp", "deny"].includes(external)) throw new Error(`unknown --external ${external}`);
  const port = one(args, "port");
  return {
    name: one(args, "name"),
    mode,
    engine,
    external,
    userAgent: one(args, "user-agent") ?? null,
    backend: one(args, "backend"),
    port: port ? Number.parseInt(port, 10) : undefined,
    allowOrigins: args.flags.get("allow-origin"),
  };
}

async function probe(target: string): Promise<Probe> {
  if (existsSync(target) && statSync(target).isDirectory()) return probeDirectory(resolve(target));
  return probeUrl(target);
}

function printPlan(plan: ConversionPlan): void {
  const { config } = plan;
  console.log(`${config.name}: mode ${config.mode}, engine ${config.engine}, verdict ${plan.verdict}`);
  for (const reason of plan.reasons) console.log(`  - ${reason}`);
  console.log(`start: ${config.start}`);
  console.log(`in-app origins: ${config.origins.app.join(", ") || "(loopback only)"}`);
  if (config.origins.auth.length > 0) console.log(`sign-in origins: ${config.origins.auth.join(", ")}`);
  console.log("risks:");
  for (const risk of plan.risks)
    console.log(
      `  [${risk.severity}] ${risk.area}: ${risk.summary} (${risk.mitigation.kind}: ${risk.mitigation.detail})`,
    );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const json = args.bool.has("json");
  if (args.command === "help" || args.bool.has("help")) {
    console.log(HELP);
    return 0;
  }

  if (args.command === "probe") {
    const target = args.positional[0];
    if (!target) throw new Error("probe needs a URL or a directory");
    const result = await probe(target);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (args.command === "plan" || args.command === "convert") {
    const target = args.positional[0];
    if (!target) throw new Error(`${args.command} needs a URL or a directory`);
    const plan = planConversion(await probe(target), planOptions(args));
    let result: Awaited<ReturnType<typeof generateProject>> | null = null;
    if (args.command === "convert") {
      const out = one(args, "out");
      if (!out) throw new Error("convert needs --out <dir>");
      result = await generateProject(plan, out, {
        wrapCrate: one(args, "wrap-crate"),
        copyLock: !args.bool.has("no-lock"),
        force: args.bool.has("force"),
      });
    }
    if (json) console.log(JSON.stringify({ plan, generated: result }, null, 2));
    else {
      printPlan(plan);
      if (result) {
        console.log(`generated ${result.files.length} files in ${result.outDir}`);
        for (const note of result.notes) console.log(`  note: ${note}`);
      }
    }
    return args.bool.has("strict") && plan.verdict !== "faithful" ? 2 : 0;
  }

  if (args.command === "parity") {
    const project = args.positional[0];
    if (!project) throw new Error("parity needs the generated project directory");
    const plan = JSON.parse(await Bun.file(resolve(project, "wrap-plan.json")).text()) as ConversionPlan;
    const referenceEndpoint = one(args, "reference-cdp") ?? process.env.APHRODY_BROWSER_CDP_URL;
    const reference = referenceEndpoint ? await cdpDriver(referenceEndpoint, "reference") : null;
    let wrapped = null;
    if (args.bool.has("bridge")) wrapped = await bridgeDriver(one(args, "bridge"));
    else if (one(args, "app-cdp")) wrapped = await cdpDriver(one(args, "app-cdp"), "app-cdp");
    try {
      const report = await runParity(plan, {
        reference,
        wrapped,
        referenceBase: one(args, "reference-base"),
        wrappedBase: one(args, "app-base"),
      });
      if (json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`parity: ${report.verdict}`);
        for (const entry of report.paths)
          console.log(
            `  ${entry.status.padEnd(7)} ${entry.path}${entry.textSimilarity === null ? "" : ` (text ${entry.textSimilarity.toFixed(3)})`}`,
          );
        for (const finding of [...report.policy, ...report.paths.flatMap(entry => entry.findings)])
          console.log(`  [${finding.severity}] ${finding.check}: ${finding.message}`);
        for (const reason of report.skipped) console.log(`  skipped: ${reason}`);
      }
      return report.verdict === "pass" ? 0 : report.verdict === "fail" ? 2 : 3;
    } finally {
      await reference?.close();
      await wrapped?.close();
    }
  }

  console.error(`unknown command: ${args.command}\n`);
  console.error(HELP);
  return 1;
}

main().then(
  code => process.exit(code),
  error => {
    console.error(`web-to-tauri: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  },
);
