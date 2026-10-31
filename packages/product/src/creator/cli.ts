#!/usr/bin/env bun
import { registry, summaries } from "./commands/index.ts";
import { UsageError } from "../shared/args.ts";
import { logCrash, splitArgs } from "../shared/crash.ts";
import { autoUpdateInBackground, VERSION } from "../shared/update.ts";

function help(): string {
  const width = Math.max(...Object.keys(summaries).map(name => name.length));
  const lines = Object.entries(summaries).map(([name, text]) => `  ${name.padEnd(width)}  ${text}`);
  return `creator-kit <commande> [options]\n\nCommandes :\n${lines.join("\n")}\n\n"creator-kit <commande> --help" détaille les options.`;
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === "--version" || name === "-v") {
    console.log(VERSION);
    return 0;
  }
  if (!name || name === "--help" || name === "-h" || name === "help") {
    console.log(help());
    return 0;
  }
  const load = registry[name];
  if (!load) {
    console.error(`Commande inconnue : ${name}\n\n${help()}`);
    return 2;
  }
  if (name !== "self-update") {
    const notice = await autoUpdateInBackground().catch(() => undefined);
    if (notice) console.error(notice);
  }
  const { default: command } = await load();
  try {
    return await command.run(rest);
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(`${(error as Error).message}\n(creator-kit ${name} --help)`);
      return 2;
    }
    throw error;
  }
}

/** Run one command line; any unexpected error is logged and reported, never left as a raw crash. */
export async function guarded(argv: string[]): Promise<number> {
  try {
    return await main(argv);
  } catch (error) {
    const log = logCrash(error, argv);
    console.error(`Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`);
    if (log) console.error(`Détails : ${log}`);
    return 1;
  }
}

/** Started without arguments from a terminal (double click on the .exe): menu loop instead of a flash. */
async function interactive(): Promise<number> {
  console.log(help());
  for (;;) {
    const line = prompt("\ncreator-kit> (q pour quitter)");
    if (line === null || /^(q|quit|exit)$/i.test(line.trim())) return 0;
    if (line.trim() === "") continue;
    // oxlint-disable-next-line no-await-in-loop --boucle interactive : chaque commande attend la saisie et s'exécute dans l'ordre
    await guarded(splitArgs(line));
  }
}

function crash(error: unknown): void {
  logCrash(error, Bun.argv.slice(2));
  console.error(`Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (import.meta.main) {
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
  const args = Bun.argv.slice(2);
  const doubleClick =
    (args.length === 0 || (args.length === 1 && args[0] === "--console")) &&
    process.stdin.isTTY &&
    process.stdout.isTTY;
  // Double click: the console menu.
  const code = doubleClick ? await interactive() : await guarded(args);
  process.exit(code);
}
