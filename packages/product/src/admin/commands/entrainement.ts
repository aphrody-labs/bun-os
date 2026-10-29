// SPDX-License-Identifier: Apache-2.0
import { parse, UsageError } from "../../shared/args.ts";
import type { Context } from "../lib/context.ts";
import { GIB, parseProbe, readTrainStatus } from "../lib/doctor.ts";
import { formatBytes } from "../../shared/format.ts";
import { loadProfile, trainHostId, type AccessPack, type HostEntry } from "../lib/profile.ts";
import { SCRIPTS } from "../lib/remote.ts";
import { runRemote, SSH_PROBLEM_TEXT } from "../lib/ssh.ts";
import {
  JOB_ID_RE,
  STATE_TEXT,
  TRAIN_TYPES,
  TRAIN_TYPE_IDS,
  isTrainType,
  launchJob,
  listJobs,
  newJobId,
  planLines,
  readLog,
  stopJob,
  validateRequest,
  type JobLine,
  type TrainRequest,
} from "../lib/train.ts";
import { MARK } from "../lib/ui.ts";
import type { Command } from "./types.ts";

const HELP = `aphrody-omar entrainement <etat|demarrer|journal|arreter> [options]

Entraîne un modèle sur un serveur, par le tunnel privé. Le travail tourne sur le serveur (tu peux fermer cette
fenêtre) ; rien n'est jamais supprimé ni écrasé ; un seul travail à la fois.

  etat                          les entraînements lancés avec ce kit et leur avancement   (alias : status)
  demarrer --type <type>        SIMULATION par défaut : montre ce qui serait lancé         (alias : start)
      --hote <nom>              serveur (défaut : celui prévu pour l'entraînement)
      --etapes <n>              nombre d'étapes (défaut 10 pour « test », obligatoire sinon)
      --entree <chemin>         fichier ou dossier d'entrée, sur le serveur
      --reference <chemin>      fichier de référence (jamais utilisé pour apprendre), sur le serveur
      --modele-base <nom>       modèle de base, sur le serveur
      --domaine <nom>           domaine (ex : wiki)
      --cpu                     accepte de tourner sans carte graphique (lent)
      --id <numéro>             numéro choisi (défaut : date + type)
      --lancer                  lance pour de vrai, après confirmation OUI
      --oui                     confirmation donnée d'avance (scripts)
  journal [numéro] [--lignes n] [--suivre] [--hote <nom>]   la fin du journal d'un travail   (alias : logs)
  arreter <numéro> [--force] [--oui] [--hote <nom>]         arrête proprement un travail    (alias : stop)

Types : ${TRAIN_TYPE_IDS.join(", ")}`;

type Resolved = { ok: true; pack: AccessPack; id: string; host: HostEntry } | { ok: false; message: string };

async function resolveHost(ctx: Context, requested?: string): Promise<Resolved> {
  const pack = await loadProfile(ctx.paths);
  if (!pack)
    return {
      ok: false,
      message: "Pas encore de fichier d'accès : choisis « Tout installer ou réparer » dans le menu.",
    };
  const id = requested ?? trainHostId(pack);
  if (!id)
    return {
      ok: false,
      message: "Aucun hôte d’entraînement déclaré. Demande à l’équipe un accès au WSL d’Omar.",
    };
  const host = pack.hosts[id];
  if (!host)
    return {
      ok: false,
      message: `Serveur inconnu : ${id} (disponibles : ${Object.keys(pack.hosts).join(", ")})`,
    };
  return { ok: true, pack, id, host };
}

export function renderJobs(hostId: string, jobs: JobLine[]): string[] {
  if (jobs.length === 0) return [`Serveur ${hostId} : aucun entraînement lancé avec ce kit.`];
  const lines = [`Serveur ${hostId} :`];
  for (const job of jobs) {
    const title = isTrainType(job.type) ? TRAIN_TYPES[job.type].titre : job.type;
    lines.push(`  [${STATE_TEXT[job.state]}] ${job.id} - ${title}${job.started ? `, démarré ${job.started}` : ""}`);
    if (job.last) lines.push(`      dernier message : ${job.last}`);
  }
  return lines;
}

export interface Preflight {
  problems: string[];
  notes: string[];
}

/** One read-only round trip before any launch: the host must be able to train, be free and have room. */
export async function preflight(
  ctx: Context,
  hostId: string,
  host: HostEntry,
  request: TrainRequest,
): Promise<Preflight> {
  const result = await runRemote(ctx.sys, ctx.paths, hostId, SCRIPTS.sonde, {
    timeoutMs: 60_000,
    args: [host.aphrodyBin, host.repoDir],
    connectTimeoutSecs: 8,
  });
  if (result.problem || result.code !== 0)
    return {
      problems: [SSH_PROBLEM_TEXT[result.problem ?? "autre"]],
      notes: [],
    };
  const probe = parseProbe(result.stdout);
  const info = TRAIN_TYPES[request.type];
  const problems: string[] = [];
  const notes: string[] = [];
  if (probe.aphrodyAbsent) problems.push("aphrody n'est pas installé pour ton compte sur ce serveur");
  else if (probe.repo === false) problems.push(`le dossier du dépôt (${host.repoDir}) n'existe pas sur le serveur`);
  else {
    const train = readTrainStatus(probe.train ?? "");
    if (!train.json) problems.push("la fonction d'entraînement n'est pas disponible dans l'aphrody du serveur");
    else if (train.json.python_train_project === false)
      problems.push("le projet d'entraînement Python est introuvable sur le serveur");
    else if (train.json.gpu_lock_active)
      (info.gpu ? problems : notes).push("la carte graphique est déjà réservée par un autre travail");
  }
  if ((probe.jobs ?? 0) > 0) problems.push("un entraînement du kit est déjà en cours : attends sa fin ou arrête-le");
  const free = probe.diskAvailKb ? probe.diskAvailKb * 1024 : undefined;
  if (free !== undefined && free < 10 * GIB)
    problems.push(`le disque du serveur est presque plein (${formatBytes(free)} libres) : préviens l'équipe`);
  else if (free !== undefined && free < 30 * GIB)
    notes.push(`peu de place sur le serveur (${formatBytes(free)} libres)`);
  if (info.gpu && probe.noGpu && !request.allowCpu)
    problems.push(
      "ce serveur n'a pas de carte graphique : l'entraînement serait très lent (ajoute --cpu pour l'accepter malgré tout)",
    );
  return { problems, notes };
}

const typedYes = (answer: string | null): boolean => answer?.trim() === "OUI";

async function startFlow(
  ctx: Context,
  request: TrainRequest,
  resolved: Extract<Resolved, { ok: true }>,
  options: { lancer: boolean; oui: boolean },
): Promise<number> {
  const { ui } = ctx;
  const problems = validateRequest(request, resolved.pack.hosts);
  if (problems.length > 0) {
    for (const problem of problems) ui.say(`${MARK.fail} ${problem}`);
    return 2;
  }
  ui.say();
  for (const line of planLines(request, resolved.host)) ui.say(line);
  ui.say();
  if (!options.lancer) {
    ui.say(
      "SIMULATION : rien n'a été lancé. Ajoute --lancer pour lancer pour de vrai (une confirmation te sera demandée).",
    );
    return 0;
  }
  ui.say("Vérification du serveur...");
  const check = await preflight(ctx, resolved.id, resolved.host, request);
  for (const note of check.notes) ui.say(`${MARK.warn} ${note}`);
  if (check.problems.length > 0) {
    for (const problem of check.problems) ui.say(`${MARK.fail} ${problem}`);
    ui.say("Rien n'a été lancé.");
    return 1;
  }
  if (!options.oui) {
    if (!ui.interactive) {
      ui.say(`${MARK.fail} Confirmation impossible sans fenêtre : ajoute --oui pour confirmer à l'avance.`);
      return 2;
    }
    if (!typedYes(ui.ask("Pour lancer vraiment, tape OUI (en majuscules) puis Entrée. Toute autre réponse annule"))) {
      ui.say("Annulé : rien n'a été lancé.");
      return 0;
    }
  }
  const launched = await launchJob(ctx.sys, ctx.paths, request, resolved.host);
  ctx.log(
    `entraînement ${request.id} (${request.type}) sur ${resolved.id} : ${launched.ok ? "lancé" : `refusé - ${launched.message}`}`,
  );
  if (!launched.ok) {
    ui.say(`${MARK.fail} ${launched.message ?? "le lancement a échoué"}`);
    return 1;
  }
  ui.say(`${MARK.ok} Lancé : ${request.id}${launched.pid ? ` (processus ${launched.pid})` : ""}.`);
  ui.say(
    "Tu peux fermer cette fenêtre : le travail continue sur le serveur. Pour suivre : « Entraînement > Voir l'état ».",
  );
  return 0;
}

function numberOption(value: string | undefined, fallback: number | undefined, label: string): number {
  if (value === undefined) {
    if (fallback === undefined) throw new UsageError(`${label} : valeur obligatoire`);
    return fallback;
  }
  if (!/^\d{1,7}$/.test(value)) throw new UsageError(`${label} : nombre entier attendu`);
  return Number(value);
}

/** Question-and-answer version of `demarrer` for the menu. */
export async function wizard(ctx: Context): Promise<number> {
  const { ui } = ctx;
  const first = await resolveHost(ctx);
  if (!first.ok) {
    ui.say(first.message);
    return 1;
  }
  ui.say("Quel entraînement ?");
  TRAIN_TYPE_IDS.forEach((type, index) =>
    ui.say(`  ${index + 1}. ${TRAIN_TYPES[type].titre}\n       ${TRAIN_TYPES[type].detail}`),
  );
  const choice = Number(ui.ask("Ton choix (numéro, vide pour annuler)")?.trim());
  const type = TRAIN_TYPE_IDS[choice - 1];
  if (!type) {
    ui.say("Annulé.");
    return 0;
  }
  const info = TRAIN_TYPES[type];
  const hosts = Object.keys(first.pack.hosts);
  let hostId = first.id;
  if (hosts.length > 1) {
    const answer = ui.ask(`Sur quel serveur ? (${hosts.join(", ")}) [${hostId}]`)?.trim();
    if (answer) hostId = answer;
  }
  const resolved = await resolveHost(ctx, hostId);
  if (!resolved.ok) {
    ui.say(resolved.message);
    return 1;
  }
  const defaultSteps = type === "test" ? 10 : undefined;
  const stepsText = ui.ask(`Combien d'étapes ?${defaultSteps ? ` [${defaultSteps}]` : " (ex : 100)"}`)?.trim();
  const steps = stepsText ? Number(stepsText) : (defaultSteps ?? Number.NaN);
  const ask = (label: string): string | undefined => ui.ask(`${label} (chemin sur le serveur)`)?.trim() || undefined;
  const request: TrainRequest = {
    type,
    host: hostId,
    id: newJobId(type, ctx.sys.now()),
    steps,
    allowCpu: type === "test",
    ...(info.needs.includes("entree") ? { entree: ask("Fichier ou dossier d'entrée") } : {}),
    ...(info.needs.includes("reference") ? { reference: ask("Fichier de référence") } : {}),
    ...(info.needs.includes("modele-base") ? { modeleBase: ask("Modèle de base") } : {}),
  } as TrainRequest;
  const domaine = ui.ask("Domaine (ex : wiki, vide si aucun)")?.trim();
  if (domaine) request.domaine = domaine;
  if (info.gpu && ui.confirm("Accepter de tourner sans carte graphique si le serveur n'en a pas (très lent) ?", false))
    request.allowCpu = true;
  return startFlow(ctx, request, resolved, { lancer: true, oui: false });
}

/** Ask which job to act on: the running one if there is exactly one, else the user picks. */
async function pickJob(ctx: Context, hostId: string, wanted?: "en-cours"): Promise<string | undefined> {
  const { outcome, jobs } = await listJobs(ctx.sys, ctx.paths, hostId);
  if (!outcome.ok) {
    ctx.ui.say(`${MARK.fail} ${outcome.message}`);
    return undefined;
  }
  const pool = wanted ? jobs.filter(job => job.state === wanted) : jobs;
  if (pool.length === 0) {
    ctx.ui.say(wanted ? "Aucun entraînement en cours." : "Aucun entraînement lancé avec ce kit.");
    return undefined;
  }
  if (pool.length === 1) return pool[0]!.id;
  pool.forEach((job, index) => ctx.ui.say(`  ${index + 1}. ${job.id} [${STATE_TEXT[job.state]}]`));
  return pool[Number(ctx.ui.ask("Lequel ? (numéro)")?.trim()) - 1]?.id;
}

export async function stopFlow(
  ctx: Context,
  hostId: string,
  id: string,
  options: { force: boolean; oui: boolean },
): Promise<number> {
  const { ui } = ctx;
  ui.say(
    `Arrêt de ${id} sur ${hostId}${options.force ? " (ARRÊT FORCÉ : le travail ne pourra pas se terminer proprement)" : " (arrêt poli : le travail est interrompu, ses fichiers restent)"}.`,
  );
  if (!options.oui) {
    if (!ui.interactive) {
      ui.say(`${MARK.fail} Confirmation impossible sans fenêtre : ajoute --oui.`);
      return 2;
    }
    if (!typedYes(ui.ask("Tape OUI (en majuscules) pour arrêter, autre chose pour annuler"))) {
      ui.say("Annulé : rien n'a été arrêté.");
      return 0;
    }
  }
  const stopped = await stopJob(ctx.sys, ctx.paths, hostId, id, options.force);
  ctx.log(`arrêt de ${id} sur ${hostId} (force=${options.force}) : ${stopped.ok ? "ok" : stopped.message}`);
  if (!stopped.ok) {
    ui.say(`${MARK.fail} ${stopped.message}`);
    return 1;
  }
  ui.say(
    stopped.stillRunning
      ? `${MARK.warn} Le travail ne s'est pas arrêté dans les 30 secondes. Réessaie avec --force si tu es sûr.`
      : `${MARK.ok} Arrêté. Les fichiers déjà produits sont conservés sur le serveur.`,
  );
  return stopped.stillRunning ? 1 : 0;
}

const command: Command = {
  name: "entrainement",
  summary: "Entraîner un modèle sur un serveur (état, démarrer, journal, arrêter)",
  async run(argv, ctx) {
    const { values, positionals } = parse(argv, {
      hote: { type: "string" },
      type: { type: "string" },
      etapes: { type: "string" },
      entree: { type: "string" },
      reference: { type: "string" },
      "modele-base": { type: "string" },
      domaine: { type: "string" },
      cpu: { type: "boolean" },
      id: { type: "string" },
      lancer: { type: "boolean" },
      oui: { type: "boolean" },
      lignes: { type: "string" },
      suivre: { type: "boolean" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    const [rawAction, target] = positionals;
    if (values.help) {
      ctx.ui.say(HELP);
      return 0;
    }
    const alias: Record<string, string> = {
      status: "etat",
      start: "demarrer",
      logs: "journal",
      stop: "arreter",
    };
    const action = rawAction ? (alias[rawAction] ?? rawAction) : undefined;
    if (action === undefined) {
      if (ctx.ui.interactive) return wizard(ctx);
      ctx.ui.say(HELP);
      return 2;
    }
    const resolved = await resolveHost(ctx, values.hote);
    if (!resolved.ok) {
      ctx.ui.say(resolved.message);
      return 1;
    }
    switch (action) {
      case "etat": {
        const { outcome, jobs } = await listJobs(ctx.sys, ctx.paths, resolved.id);
        if (!outcome.ok) {
          ctx.ui.say(`${MARK.fail} ${outcome.message}`);
          return 1;
        }
        for (const line of renderJobs(resolved.id, jobs)) ctx.ui.say(line);
        return 0;
      }
      case "demarrer": {
        const type = values.type;
        if (!type || !isTrainType(type)) throw new UsageError(`--type obligatoire : ${TRAIN_TYPE_IDS.join(", ")}`);
        const request: TrainRequest = {
          type,
          host: resolved.id,
          id: values.id ?? newJobId(type, ctx.sys.now()),
          steps: numberOption(values.etapes, type === "test" ? 10 : undefined, "--etapes"),
          allowCpu: values.cpu === true,
          ...(values.entree ? { entree: values.entree } : {}),
          ...(values.reference ? { reference: values.reference } : {}),
          ...(values["modele-base"] ? { modeleBase: values["modele-base"] } : {}),
          ...(values.domaine ? { domaine: values.domaine } : {}),
        };
        return startFlow(ctx, request, resolved, {
          lancer: values.lancer === true,
          oui: values.oui === true,
        });
      }
      case "journal": {
        const id = target;
        if (values.suivre) {
          if (id !== undefined && !JOB_ID_RE.test(id)) throw new UsageError("numéro d'entraînement invalide");
          ctx.ui.say("Suivi du journal en direct (Ctrl+C pour arrêter de suivre : le travail continue).");
          const followed = await runRemote(ctx.sys, ctx.paths, resolved.id, SCRIPTS.journal, {
            args: [id ?? "-", String(numberOption(values.lignes, 50, "--lignes")), "1"],
            inherit: true,
            timeoutMs: 6 * 3_600_000,
          });
          return followed.code === 0 ? 0 : 1;
        }
        const log = await readLog(ctx.sys, ctx.paths, resolved.id, id, numberOption(values.lignes, 50, "--lignes"));
        if (!log.ok) {
          ctx.ui.say(`${MARK.fail} ${log.message}`);
          return 1;
        }
        ctx.ui.say(log.stdout.replace(/^JOURNAL\|(.*)\r?\n/, "Journal de $1 :\n").trimEnd());
        return 0;
      }
      case "arreter": {
        const id = target ?? (await pickJob(ctx, resolved.id, "en-cours"));
        if (!id) return target ? 2 : 0;
        return stopFlow(ctx, resolved.id, id, {
          force: values.force === true,
          oui: values.oui === true,
        });
      }
      default:
        ctx.ui.say(HELP);
        return 2;
    }
  },
};

export default command;
export { pickJob };
