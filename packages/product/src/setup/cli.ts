#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Aphrody-Setup.exe: double click, answer two questions (optional roles), everything is installed or repaired.
 *
 *   aphrody-setup                         the French wizard (double click)
 *   aphrody-setup --oui [--roles admin,createur] [--simuler]   without questions
 *   aphrody-setup mise-a-jour [--check]   update this program (also automatic, in the background)
 *   aphrody-setup --version
 */
import { UsageError, parse } from "../shared/args.ts";
import { logCrash } from "../shared/crash.ts";
import type { AppIdentity } from "../shared/update.ts";
import { join } from "node:path";

import { defaultContext, type Context } from "../admin/lib/context.ts";
import { createLogger } from "../admin/lib/log.ts";
import { runInstall, type InstallReport } from "../admin/lib/steps.ts";
import { autoUpdateInBackground, updateKit } from "../admin/lib/update.ts";
import pkg from "../../package.json";
import { ARTIFACTS, stepsFor, type Role } from "./steps.ts";

export const VERSION: string = pkg.version;

export const setupApp = (version: string): AppIdentity => ({
  name: "Aphrody/Setup",
  version,
  disableEnv: "APHRODY_SETUP_NO_UPDATE",
  updateCommand: "mise-a-jour",
});

const ROLES: Record<string, Role> = {
  admin: "admin",
  administrateur: "admin",
  createur: "createur",
  creator: "createur",
};

export function parseRoles(text: string | undefined): Set<Role> {
  const roles = new Set<Role>();
  for (const part of (text ?? "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)) {
    const role = ROLES[part];
    if (!role) throw new UsageError(`rôle inconnu : ${part} (admin, createur)`);
    roles.add(role);
  }
  return roles;
}

const HELP = `aphrody-setup [--oui] [--roles admin,createur] [--simuler]
aphrody-setup mise-a-jour [--check]

Installe ou répare : aphrody (outils et MCP), les plugins Claude
(aphrody, yolo) et le MCP aphrody dans Claude Desktop et Claude Code (sauvegarde avant).
Rôles en option : admin (tunnel privé, SSH, entraînement, outils intégrés), createur (outils créateur).
Sans argument : l'assistant pas à pas.`;

function summary(ctx: Context, report: InstallReport): void {
  ctx.ui.say();
  if (report.failed > 0)
    ctx.ui.say(
      `${report.failed} étape(s) en échec : relance ce programme ; si ça recommence, envoie le journal ${ctx.log.file} à l'équipe.`,
    );
  else if (report.waiting > 0)
    ctx.ui.say("Presque tout est prêt ; certaines parties seront installées quand elles seront publiées.");
  else ctx.ui.say("Tout est prêt.");
}

export async function install(ctx: Context, roles: ReadonlySet<Role>, simulate: boolean): Promise<InstallReport> {
  ctx.log(`setup ${ctx.version} rôles=${[...roles].join(",") || "aucun"} simulation=${simulate}`);
  return runInstall(ctx, simulate ? "simuler" : "executer", { repoReady: false }, stepsFor(roles));
}

/** The double-click wizard: what will happen, the two optional roles, then the run. */
export async function wizard(ctx: Context): Promise<number> {
  ctx.ui.say(`Aphrody - installation (version ${ctx.version})`);
  ctx.ui.say("");
  ctx.ui.say("Je vais installer ou réparer, sans rien te demander de technique :");
  ctx.ui.say("  - aphrody (outils et serveur MCP)");
  ctx.ui.say("  - les plugins Claude aphrody et yolo");
  ctx.ui.say("  - le MCP aphrody dans Claude Desktop et Claude Code (ta configuration est sauvegardée avant)");
  ctx.ui.say("");
  const roles = new Set<Role>();
  if (ctx.ui.confirm("Ajouter le rôle administrateur (tunnel privé, SSH, entraînement) ?", false)) roles.add("admin");
  if (ctx.ui.confirm("Ajouter les outils créateur (tournois, images, nettoyage, sous-titres) ?", false))
    roles.add("createur");
  if (!ctx.ui.confirm("On y va ?", true)) {
    ctx.ui.say("Rien n'a été modifié.");
    return 0;
  }
  ctx.ui.say("");
  const report = await install(ctx, roles, false);
  summary(ctx, report);
  ctx.ui.pause("Appuie sur Entrée pour fermer...");
  return report.failed > 0 ? 1 : 0;
}

/** omar-kit's context with this program's version and its own log (`%LOCALAPPDATA%\\Aphrody\\Setup\\setup.log`). */
export function setupContext(): Context {
  const ctx = defaultContext();
  return {
    ...ctx,
    version: VERSION,
    log: createLogger(join(ctx.paths.localAppData, "Aphrody", "Setup", "setup.log")),
  };
}

export async function main(argv: string[], ctx: Context = setupContext()): Promise<number> {
  const [first, ...rest] = argv;
  if (first === "--version" || first === "-v") {
    ctx.ui.say(ctx.version);
    return 0;
  }
  if (first === "--help" || first === "-h" || first === "aide") {
    ctx.ui.say(HELP);
    return 0;
  }
  if (first === "mise-a-jour") {
    const { values } = parse(rest, {
      check: { type: "boolean" },
      quiet: { type: "boolean" },
    });
    const result = await updateKit(ctx, {
      checkOnly: values.check ?? false,
      artifact: ARTIFACTS.setup,
      app: setupApp(ctx.version),
    });
    if (!values.quiet) ctx.ui.say(`${result.status}${result.latest ? ` ${result.latest}` : ""}`);
    return 0;
  }
  const { values } = parse(argv, {
    oui: { type: "boolean" },
    simuler: { type: "boolean" },
    roles: { type: "string" },
  });
  if (!values.oui && ctx.ui.interactive) return wizard(ctx);
  const report = await install(ctx, parseRoles(values.roles), values.simuler ?? false);
  summary(ctx, report);
  return report.failed > 0 ? 1 : 0;
}

if (import.meta.main) {
  const crash = (error: unknown) => {
    logCrash(error, Bun.argv.slice(2), process.env, setupApp(VERSION));
    console.error(`Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  };
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
  const ctx = setupContext();
  if (ctx.sys.platform === "win32") ctx.sys.run(["cmd", "/c", "chcp 65001 >nul"]).catch(() => undefined);
  const args = Bun.argv.slice(2);
  if (args[0] !== "mise-a-jour") {
    const notice = await autoUpdateInBackground(ctx.sys.env, setupApp(VERSION)).catch(() => undefined);
    if (notice) ctx.ui.say(notice);
  }
  let code: number;
  try {
    code = await main(args, ctx);
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(`${(error as Error).message}\n\n${HELP}`);
      code = 2;
    } else throw error;
  }
  process.exit(code);
}
