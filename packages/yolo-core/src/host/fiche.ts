// SPDX-License-Identifier: Apache-2.0
// Fiche factuelle propriétaire <-> Omar (source de la synchronisation) : réseau en direct, inventaire WireGuard
// (clés publiques), variables d'Omar, alias SSH, tâches de boot, tâches planifiées de ce PC et liste de ce qu'Omar doit
// compléter. Aucun secret : clés privées, jetons et mots de passe ne sont jamais lus.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BEGIN, END } from "./net-env.ts";
import { run, type Run } from "./net-facts.ts";

const SECRET = /(private|preshared|password|passwd|secret|token\s*[:=])/i;
const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");

/** Valeur d'un fait `NET_LIVE_<MEMBRE>_<NOM>` du bloc généré. */
const strip = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(strip)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => !SECRET.test(k))
            .map(([k, x]) => [k, strip(x)]),
        )
      : v;

export const fact = (block: string, member: string, name: string): string | undefined =>
  new RegExp(`^NET_LIVE_${member}_${name}=(.*)$`, "m").exec(block)?.[1];

const mark = (ok: boolean) => (ok ? "[x]" : "[ ]");

export function omarChecklist(block: string): string[] {
  const open = new Set((fact(block, "OMAR", "PORTS_OPEN") ?? "").split(","));
  const online = fact(block, "OMAR", "WG_ONLINE") === "yes";
  return [
    `${mark(online)} Tunnel wg1 actif (tâche SYSTEM \`aphrody infra wg up omar\` au démarrage)`,
    `${mark(open.has("22"))} sshd Windows à l'écoute sur 10.200.77.10:22 (service Automatic)`,
    `${mark(open.has("2222"))} sshd WSL sur 10.200.77.10:2222`,
    `${mark(open.has("5900"))} VNC (RFB) 5900 ; mot de passe via \`aphrody infra remote token set vnc --target omar\``,
    `${mark(open.has("8795"))} Bureau à distance 8795 (\`aphrody infra remote serve --bind 10.200.77.10:8795\`)`,
    `${mark(open.has("8793"))} MCP HTTP 8793 (127.0.0.1:8793 + portproxy), jeton actuel donné hors bande`,
    `${mark(open.has("8999"))} API container 8999`,
    `${mark(open.has("8788"))} A2A 8788`,
    "[ ] Nom d'utilisateur Windows et WSL communiqués (rapport `fiche`)",
    "[ ] Clé SSH du propriétaire dans `C:/ProgramData/ssh/administrators_authorized_keys` et `~/.ssh/authorized_keys` (WSL)",
    "[ ] Tâches du dossier Aphrody au boot via `aphrody infra boot apply --host local` (sans fenêtre : SYSTEM ou `conhost --headless`)",
    "[ ] Pare-feu Windows : groupe `Aphrody`, tous les ports depuis 10.200.77.0/24",
    "[ ] Réagir ✅ aux demandes de #sync-demandes ; poster `APHRODY-SYNC/1 report fiche` avec les faits de son PC",
  ];
}

export async function buildFiche(root: string, envFile: string, runner: Run = run, now = new Date()): Promise<string> {
  const env = read(envFile);
  const a = env.indexOf(BEGIN);
  const b = env.indexOf(END);
  const block = a >= 0 && b > a ? env.slice(a, b + END.length) : "";
  const wg = JSON.parse(read(join(root, "infra/config/host/wireguard/aphrody-tunnel.json")) || "{}");
  const omar = read(join(root, "tools/config/var/omar.json"));
  const ssh = read(join(homedir(), ".ssh", "config"))
    .split(/\r?\n/)
    .filter(l => !/IdentityFile|UserKnownHostsFile/i.test(l))
    .join("\n");
  const catalog = JSON.parse(read(join(root, "infra/config/service-catalog.json")) || "{}");
  const tasks = (await runner(["schtasks", "/query", "/fo", "CSV", "/nh"], 15_000))
    .split(/\r?\n/)
    .filter(l => l.includes("\\Aphrody\\"))
    .join("\n");
  const doc = [
    "# Fiche factuelle Aphrody ↔ Omar",
    `Générée par le PC du propriétaire (APHRODY) le ${now.toISOString()}. Sans secret. Mise à jour automatique chaque minute (tâche Net Env Probe → vps → #sync-fiche).`,
    "## Réseau en direct (wg1, SSH, VNC, ports, conteneurs, adresses publiques)",
    "```\n" + block + "\n```",
    "## Inventaire WireGuard (clés publiques)",
    "```json\n" + JSON.stringify(strip(wg), null, 2) + "\n```",
    "## Variables d'Omar",
    "```json\n" + omar.trim() + "\n```",
    "## Alias SSH du propriétaire",
    "```\n" + ssh.trim() + "\n```",
    "## État de boot déclaré (service-catalog.json › boot.entries)",
    "```json\n" + JSON.stringify(catalog.boot?.entries ?? [], null, 1) + "\n```",
    "## Tâches planifiées du dossier Aphrody du PC propriétaire",
    "```\n" + tasks + "\n```",
    "## Ce qu'Omar doit compléter (case cochée = vérifié en direct)",
    omarChecklist(block).join("\n"),
  ].join("\n\n");
  return doc
    .split("\n")
    .filter(l => !SECRET.test(l) || /bearer-token|vnc-password/i.test(l))
    .join("\n");
}

/** Pousse la fiche sur l'hôte hub puis récupère la version fusionnée avec la partie d'Omar. */
export async function syncFicheWith(host: string, fiche: string): Promise<string | undefined> {
  const dir = "~/.local/state/aphrody-sync";
  const proc = Bun.spawn(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      host,
      `mkdir -p ${dir} && cat > ${dir}/fiche-owner.md.tmp && mv ${dir}/fiche-owner.md.tmp ${dir}/fiche-owner.md`,
    ],
    { stdin: "pipe", stdout: "ignore", stderr: "ignore", timeout: 20_000 },
  );
  proc.stdin.write(fiche);
  await proc.stdin.end();
  if ((await proc.exited) !== 0) return undefined;
  const merged = await run(
    ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, `cat ${dir}/fiche-merged.md`],
    15_000,
  );
  return merged.trim() ? merged : undefined;
}

export const FICHE_BEGIN = "<!-- >>> fiche-auto-sync -->";
export const FICHE_END = "<!-- <<< fiche-auto-sync -->";

/** Remplace (ou ajoute) le bloc auto-synchronisé d'un fichier mémoire ; le reste est conservé. */
export function mergeIntoMemory(text: string, fiche: string): string {
  const block = `${FICHE_BEGIN}\n${fiche.trimEnd()}\n${FICHE_END}`;
  const a = text.indexOf(FICHE_BEGIN);
  const b = text.indexOf(FICHE_END);
  if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + FICHE_END.length);
  return `${text.trimEnd()}\n\n${block}\n`;
}

export function writeMemory(file: string, fiche: string): void {
  writeFileSync(file, mergeIntoMemory(read(file), fiche));
}
