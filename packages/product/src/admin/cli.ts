#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { UsageError } from "../shared/args.ts";
import { logCrash, splitArgs } from "../shared/crash.ts";
import { aliases, registry, summaries } from "./commands/index.ts";
import { defaultContext, VERSION, type Context } from "./lib/context.ts";
import { autoUpdateInBackground, omarApp } from "./lib/update.ts";
import { mainMenu } from "./menu.ts";

export function help(): string {
  const width = Math.max(...Object.keys(summaries).map(name => name.length));
  const lines = Object.entries(summaries).map(([name, text]) => `  ${name.padEnd(width)}  ${text}`);
  return `aphrody-omar <commande> [options]\n\nCommandes :\n${lines.join("\n")}\n\nSans commande : le menu. "aphrody-omar <commande> --help" détaille les options.`;
}

export async function main(argv: string[], ctx: Context = defaultContext()): Promise<number> {
  const [first, ...rest] = argv;
  if (first === "--version" || first === "-v") {
    ctx.ui.say(ctx.version);
    return 0;
  }
  if (!first || first === "--help" || first === "-h" || first === "help" || first === "aide") {
    ctx.ui.say(help());
    return 0;
  }
  const name = aliases[first] ?? first;
  const load = registry[name];
  if (!load) {
    console.error(`Commande inconnue : ${first}\n\n${help()}`);
    return 2;
  }
  if (name !== "mise-a-jour" && name !== "interne") {
    const notice = await autoUpdateInBackground(ctx.sys.env, omarApp(ctx.version)).catch(() => undefined);
    if (notice) console.error(notice);
  }
  const { default: command } = await load();
  try {
    return await command.run(rest, ctx);
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(`${(error as Error).message}\n(aphrody-omar ${name} --help)`);
      return 2;
    }
    throw error;
  }
}

/** Run one command line; an unexpected error is logged and explained, never left as a raw crash. */
export async function guarded(argv: string[], ctx?: Context): Promise<number> {
  try {
    return await main(argv, ctx);
  } catch (error) {
    const log = logCrash(error, argv, process.env, omarApp(VERSION));
    console.error(`Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`);
    if (log) console.error(`Détails : ${log}`);
    console.error("Choisis « Préparer le message d'aide pour l'équipe » et envoie-le.");
    return 1;
  }
}

/** Started with no argument from a terminal (double click): the menu. */
async function interactive(): Promise<number> {
  const ctx = defaultContext();
  if (ctx.sys.platform === "win32") ctx.sys.run(["cmd", "/c", "chcp 65001 >nul"]).catch(() => undefined);
  const notice = await autoUpdateInBackground(ctx.sys.env, omarApp(ctx.version)).catch(() => undefined);
  if (notice) ctx.ui.say(notice);
  try {
    await mainMenu(ctx);
    return 0;
  } catch (error) {
    const log = logCrash(error, [], process.env, omarApp(VERSION));
    console.error(`Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`);
    if (log) console.error(`Détails : ${log}`);
    ctx.ui.pause("Appuie sur Entrée pour fermer...");
    return 1;
  }
}

function crashAndExit(error: unknown): never {
  logCrash(error, Bun.argv.slice(2), process.env, omarApp(VERSION));
  console.error(`Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (import.meta.main) {
  process.on("uncaughtException", crashAndExit);
  process.on("unhandledRejection", crashAndExit);
  const args = Bun.argv.slice(2);
  const doubleClick =
    (args.length === 0 || (args.length === 1 && args[0] === "--console")) &&
    process.stdin.isTTY &&
    process.stdout.isTTY;
  // Double click: the console menu.
  const code = doubleClick ? await interactive() : await guarded(args);
  process.exit(code);
}

export { splitArgs };
