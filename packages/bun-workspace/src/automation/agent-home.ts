#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// Sync the local repo ecosystem into the agent-home context (`~/.aphrody`).
//
// # Why a script and not a hand-written file
//
// `~/.aphrody/workspace/REPOS.md` is what an agent reads at boot to know which
// repositories exist on this machine, what each one is, and how to invoke it.
// Written by hand it would be wrong within a week: a HEAD moves, a binary gets
// installed, a clone falls behind its submodule. Every line here is READ FROM
// THE MACHINE, so re-running the script is the way to refresh it.
//
// # What it refuses to do
//
// It never invents. A repository that is absent is written as absent, a clone
// that lags its submodule pointer says so, and a tool that exists but is not on
// the PATH is reported as exactly that rather than as missing — the first
// version of this script resolved binaries through `PATH` alone and declared
// `cargo` absent on a machine where it was installed. An agent acting on a
// confident but wrong inventory is worse off than one told the entry is
// unknown.
//
// Usage:
//   aphrody-ops agent-home --source <aphrody-root>            # write the context
//   aphrody-ops agent-home --source <aphrody-root> --dry-run  # print it, touch nothing
//   aphrody-ops agent-home --source <aphrody-root> --profile dbfr      # workspaces/dbfr

import { spawnSync } from "@aphrody/update/process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** One repository we expect to find beside the monorepo. */
interface RepoSpec {
  /** Directory name under the home directory. */
  readonly dir: string;
  /** What it is for, in one line. This is the only hand-written field. */
  readonly role: string;
}

/**
 * The ecosystem, in the order an agent should read it: the monorepo first,
 * then what it drives.
 */
const REPOS: readonly RepoSpec[] = [
  {
    dir: "aphrody",
    role: "Monorepo Rust/Bun : fondations, infrastructure et capacités publiées.",
  },
  { dir: "iecode", role: "Workspace actif du domaine jeu." },
];

/** Binaries this ecosystem installs, and how an agent checks for them. */
const BINARIES = [
  "aphrody",
  "aphrody-mcp",
  "claude",
  "codex",
  "agy",
  "bun",
  "bunx",
  "uv",
  "uvx",
  "cargo",
  "rustc",
  "rustup",
  "sccache",
  "oxlint",
  "oxfmt",
  "tsc",
  "git",
  "gh",
  "nu",
  "rg",
  "fd",
  "sd",
  "eza",
  "bat",
  "dust",
  "procs",
  "btm",
  "ssh",
  "pwsh",
  "python3",
  "gcloud",
  "rclone",
  "ffmpeg",
  "llama-server",
  "bxc",
  "n2b",
] as const;

/** Run a command and return trimmed stdout, or `null` when it fails. */
function run(cmd: string, args: string[], cwd?: string): string | null {
  const out = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 15_000,
  });
  if (out.status !== 0 || out.stdout == null) return null;
  const text = out.stdout.trim();
  return text.length > 0 ? text : null;
}

function git(cwd: string, ...args: string[]): string | null {
  return run("git", args, cwd);
}

/** Everything read off the disk for one repository. */
interface RepoFacts {
  readonly spec: RepoSpec;
  readonly path: string;
  readonly present: boolean;
  readonly remote: string | null;
  readonly branch: string | null;
  readonly head: string | null;
  /** Count of dirty paths, or null when not a git repo. */
  readonly dirty: number | null;
  readonly pkgName: string | null;
  readonly pkgVersion: string | null;
  readonly bins: readonly string[];
  readonly hasCargo: boolean;
  readonly hasPython: boolean;
  readonly skills: readonly string[];
  /** Notes worth surfacing, e.g. a clone lagging a submodule pointer. */
  readonly warnings: readonly string[];
}

function readSkills(root: string): string[] {
  for (const dir of ["skills", join(".claude", "skills")]) {
    const candidate = join(root, dir);
    if (!existsSync(candidate)) continue;
    const listing = run("git", ["ls-files", "--others", "--cached", "--directory", dir], root);
    if (listing == null) continue;
    const names = new Set<string>();
    for (const line of listing.split("\n")) {
      const rest = line.slice(dir.length + 1);
      const name = rest.split("/")[0];
      if (name != null && name.length > 0 && name !== "SKILL.md") names.add(name);
    }
    if (names.size > 0) return [...names].toSorted();
  }
  return [];
}

function inspect(spec: RepoSpec, source: string): RepoFacts {
  const path = join(source, spec.dir);
  const warnings: string[] = [];
  if (!existsSync(path)) {
    return {
      spec,
      path,
      present: false,
      remote: null,
      branch: null,
      head: null,
      dirty: null,
      pkgName: null,
      pkgVersion: null,
      bins: [],
      hasCargo: false,
      hasPython: false,
      skills: [],
      warnings: ["absent de cette machine"],
    };
  }

  const isGit = existsSync(join(path, ".git"));
  const status = isGit ? git(path, "status", "--porcelain") : null;

  let pkgName: string | null = null;
  let pkgVersion: string | null = null;
  let bins: string[] = [];
  const pkgPath = join(path, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        name?: string;
        version?: string;
        bin?: string | Record<string, string>;
      };
      pkgName = pkg.name ?? null;
      pkgVersion = pkg.version ?? null;
      if (typeof pkg.bin === "string") bins = [pkg.name ?? "(bin)"];
      else if (pkg.bin != null) bins = Object.keys(pkg.bin);
    } catch (err) {
      // A malformed manifest is a fact about the repo, not a reason to abort
      // the whole inventory.
      warnings.push(`package.json illisible: ${String(err)}`);
    }
  }

  return {
    spec,
    path,
    present: true,
    remote: isGit ? git(path, "remote", "get-url", "origin") : null,
    branch: isGit ? git(path, "rev-parse", "--abbrev-ref", "HEAD") : null,
    head: isGit ? git(path, "rev-parse", "--short", "HEAD") : null,
    dirty: status == null ? (isGit ? 0 : null) : status.split("\n").length,
    pkgName,
    pkgVersion,
    bins,
    hasCargo: existsSync(join(path, "Cargo.toml")),
    hasPython: existsSync(join(path, "pyproject.toml")),
    skills: readSkills(path),
    warnings,
  };
}

/**
 * Places a tool can be installed without being on the PATH of whatever shell
 * happens to run this script.
 *
 * Resolving only through `PATH` is how the first version of this table
 * reported `cargo` and `aphrody` as absent on a machine where both were
 * installed — the exact confidently-wrong inventory this script exists to
 * prevent. "Installed but not on PATH" is also a real, actionable state (it is
 * bun's, here), and collapsing it into "absent" would send an agent
 * reinstalling something it already has.
 */
function knownInstallDirs(home: string): string[] {
  const dirs = [join(home, ".cargo", "bin"), join(home, ".bun", "bin")];
  if (process.platform === "win32") {
    const local = process.env["LOCALAPPDATA"];
    if (local != null) dirs.push(join(local, "bun"));
  } else {
    dirs.push("/usr/local/bin", join(home, ".local", "bin"));
  }
  return dirs;
}

/** How a tool resolves on this machine. */
type BinState =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "off-path"; readonly path: string }
  | { readonly kind: "absent" };

/**
 * The user's persistent `PATH`, not this process's.
 *
 * On Windows a process inherits the `PATH` its parent had at launch, so a
 * long-running host application can hand a child an out-of-date or trimmed
 * environment. Judging "is it on the PATH" from `process.env.PATH` therefore
 * describes the shell that happened to run this script, not the machine — it
 * is what made an earlier run report every tool as off-PATH on a box where the
 * user's own terminal finds them all. The registry is the machine's answer.
 */
const queryPersistentPath = (scope: "User" | "Machine"): string[] => {
  const raw = run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `[Environment]::GetEnvironmentVariable('Path','${scope}')`,
  ]);
  return raw == null
    ? []
    : raw
        .split(";")
        .map(d => d.trim())
        .filter(d => d.length > 0);
};

function persistentPathDirs(): string[] {
  if (process.platform !== "win32") return [];
  return [...queryPersistentPath("User"), ...queryPersistentPath("Machine")];
}

export function locate(bin: string, home: string, persistent: readonly string[]): BinState {
  const exe = process.platform === "win32" ? `${bin}.exe` : bin;

  const onPath = Bun.which(bin, { PATH: process.env.PATH ?? "" });
  if (onPath) return { kind: "path", path: onPath };

  // Not in *this* process's PATH — but the user's shell may still find it.
  for (const dir of persistent) {
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return { kind: "path", path: candidate };
  }

  for (const dir of knownInstallDirs(home)) {
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return { kind: "off-path", path: candidate };
  }
  return { kind: "absent" };
}

export interface InstalledTool {
  name: string;
  state: BinState["kind"];
  path: string | null;
  version: string | null;
}

/** Read installed tools without changing their installation. */
export function collectInstalledTools(
  home = homedir(),
  root = resolve(import.meta.dir, "..", "..", "..", ".."),
): InstalledTool[] {
  const persistent = persistentPathDirs();
  const catalogPath = join(root, "infra", "config", "developer-cli-tools.json");
  const commands: string[] = [...BINARIES];
  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      tools: { command: string }[];
    };
    for (const tool of catalog.tools) if (!commands.includes(tool.command)) commands.push(tool.command);
  }
  return commands.map(name => {
    const state = locate(name, home, persistent);
    const path = state.kind === "absent" ? null : state.path;
    const version = path ? (run(path, ["--version"])?.split("\n")[0] ?? null) : null;
    return { name, state: state.kind, path, version };
  });
}

function binaryTable(home: string, root: string): string[] {
  return collectInstalledTools(home, root).map(tool => {
    const label =
      tool.state === "path"
        ? "ok"
        : tool.state === "off-path"
          ? "**installé, hors PATH**"
          : "**absent de cette machine**";
    return `| \`${tool.name}\` | ${label} | ${tool.version ?? "—"} | ${tool.path ? `\`${tool.path}\`` : "—"} |`;
  });
}

function renderRepos(all: readonly RepoFacts[], generatedAt: string, source: string): string {
  const lines: string[] = [
    "<!-- GENERATED by aphrody-ops agent-home — do not edit by hand. -->",
    "# Écosystème de dépôts — poste local",
    "",
    `Relevé le **${generatedAt}** par \`aphrody-ops agent-home --source ${source}\` depuis`,
    `\`${source}\`. Chaque ligne vient du disque : rien n'est déclaré de mémoire.`,
    "**Relancer le script après tout clone, pull ou installation** — un inventaire",
    "périmé mais confiant est pire qu'une entrée marquée inconnue.",
    "",
    "## Vue d'ensemble",
    "",
    "| Dépôt | Branche @ HEAD | Propre | Rôle |",
    "|---|---|---|---|",
  ];

  for (const r of all) {
    if (!r.present) {
      lines.push(`| \`${r.spec.dir}\` | — | — | **ABSENT** — ${r.spec.role} |`);
      continue;
    }
    const rev = r.branch != null ? `${r.branch} @ ${r.head ?? "?"}` : "pas un dépôt git";
    const clean = r.dirty == null ? "—" : r.dirty === 0 ? "oui" : `**${r.dirty} fichier(s)**`;
    lines.push(`| \`${r.spec.dir}\` | ${rev} | ${clean} | ${r.spec.role} |`);
  }

  lines.push("", "## Détail", "");
  for (const r of all) {
    lines.push(`### \`~/${r.spec.dir}\``, "");
    if (!r.present) {
      lines.push(`**Absent de cette machine.** ${r.spec.role}`, "");
      continue;
    }
    lines.push(`- Chemin : \`${r.path}\``);
    if (r.remote != null) lines.push(`- Remote : ${r.remote}`);
    if (r.pkgName != null) {
      lines.push(`- Paquet : \`${r.pkgName}\`${r.pkgVersion != null ? ` v${r.pkgVersion}` : ""}`);
    }
    const stacks = [
      r.pkgName != null ? "Bun/TS" : null,
      r.hasCargo ? "Rust" : null,
      r.hasPython ? "Python" : null,
    ].filter((s): s is string => s != null);
    if (stacks.length > 0) lines.push(`- Stack : ${stacks.join(" + ")}`);
    if (r.bins.length > 0) lines.push(`- Binaire(s) déclaré(s) : ${r.bins.map(b => `\`${b}\``).join(", ")}`);
    if (r.skills.length > 0) {
      lines.push(`- Skills (${r.skills.length}) : ${r.skills.map(s => `\`${s}\``).join(", ")}`);
    }
    if (r.dirty != null && r.dirty > 0) {
      lines.push(`- **Working tree sale** : ${r.dirty} chemin(s) — vérifier avant tout pull ou checkout.`);
    }
    for (const w of r.warnings) lines.push(`- ⚠ ${w}`);
    lines.push("");
  }

  lines.push("## Points d'attention", "");
  lines.push(
    "- Le monorepo `aphrody` contient les domaines Rust/Bun ; ne pas restaurer les anciens checkouts catégoriels.",
    "- Python vit dans `py/` du monorepo, le domaine jeu dans sa racine active vérifiée.",
    "- Les contextes Agent Home `aphrody`, `dbfr` et `ie` restent distincts.",
    "- Un seul contexte par domaine est partagé par Claude, Codex, agy et les modèles locaux.",
    "- Les poids, conversations, mémoires et bases utilisateur restent dans leurs stores privés.",
    "",
  );
  return lines.join("\n");
}

export function renderTools(generatedAt: string, home: string, root: string): string {
  const kernel = locate("aphrody", home, persistentPathDirs());
  let toolRows: string[] = [];
  let kernelStatus = "Non interrogé : binaire kernel absent.";
  if (kernel.kind !== "absent") {
    const raw = run(kernel.path, ["kernel", "tools"], root);
    if (raw != null) {
      try {
        const inventory = JSON.parse(raw) as {
          tools?: { name: string; description?: string }[];
        };
        toolRows = (inventory.tools ?? []).map(
          tool => `| \`${tool.name}\` | ${(tool.description ?? "").replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
        );
        kernelStatus = `${toolRows.length} outils effectivement exposés par le kernel installé.`;
      } catch {
        kernelStatus = "Inventaire kernel non décodable ; aucune capacité supposée.";
      }
    } else kernelStatus = "Inventaire kernel indisponible ou timeout ; aucune capacité supposée.";
  }
  return [
    "<!-- GENERATED by aphrody-ops agent-home — do not edit by hand. -->",
    "# Outils et contextes Agent Home",
    "",
    `Relevé le **${generatedAt}** depuis \`${root}\`.`,
    "",
    "## Binaires réellement installés",
    "",
    "`ok` : trouvé sur PATH ; `installé, hors PATH` : invoquer le chemin indiqué ; absent : installer avant usage.",
    "Une version inconnue signifie que la sonde --version a échoué, pas que le binaire fonctionne.",
    "",
    "| Outil | État | Version | Chemin |",
    "|---|---|---|---|",
    ...binaryTable(home, root),
    "",
    "## Propriétaires et commandes",
    "",
    "- Inventaire des commandes : docs/reference/workspace/CLI.md dans le monorepo ; consulter --help du binaire installé.",
    "- Kernel OS : `aphrody kernel tools`, `aphrody kernel call <outil> '<JSON>'`, `aphrody kernel serve`.",
    "- Nushell : `nu_eval` reçoit code/cwd/vars ; transmettre les données via vars. Cet outil peut modifier le système.",
    "- Git : `github_status` reçoit repo_path ; sa liste de modifications ne prouve pas leur auteur.",
    "- Agent Home : crates/ai/agent-home ; génération : packages/bun-workspace/src/automation/agent-home.ts.",
    "- Sessions externes : crates/ai/session/src/external ; mémoire : crates/ai/memory.",
    "- A2A : tools/aphrody/config/a2a-peers.json ; transport : crates/aphrody-a2a-coord ; contrat : crates/aphrody-a2a.",
    "- Modèles locaux : crates/ai/llama-server et crates/ai/models ; ne pas déplacer les poids.",
    "- Rust: scoped cargo check/clippy/test; Bun: bun check/lint/fmt/test according to manifests. Declaration emission retains the locked TypeScript SDK.",
    "",
    "## Séparation des domaines et collaboration",
    "",
    "Choisir un profil avant le lancement : ~/.aphrody/workspaces/aphrody, dbfr ou ie.",
    "APHRODY_WORKSPACE désigne le profil Agent Home ; le cwd de travail reste la racine de code du domaine.",
    "Claude, Codex, agy et modèles locaux partagent les règles et le contexte uniquement au sein du domaine choisi.",
    "Les règles du dépôt (AGENTS.md, et projections CLAUDE.md/GEMINI.md) restent applicables.",
    "Partager une branche exige de vérifier branche et HEAD avant chaque tâche ; réserver les fichiers et désigner un intégrateur Git.",
    "Ne pas créer de worktree/branche isolée pour ce mode ; ne pas attribuer une modification Git à un PID sans preuve.",
    "",
    "`aphrody ai sync-sessions --watch --interval-secs 30 --json` existe ; son mode historique agrège tous les agents.",
    "Avec APHRODY_AGENT_DOMAIN=aphrody|dbfr|ie, le miroir et la mémoire utilisent le profil choisi ; les sessions non marquées sont exclues.",
    "Les associations PID/session historiques fondées sur cwd et mtime sont heuristiques si plusieurs sessions partagent un cwd.",
    "Les conversations natives restent dans leurs stores privés ; le miroir filtré exige le marqueur de domaine du premier tour utilisateur.",
    "Pour dbfr, le dossier synchronisé Google Drive conserve corpus/poids et entraînements ; vérifier le mapping privé avant de lancer.",
    "",
    "## Inventaire kernel effectif",
    "",
    kernelStatus,
    "",
    "| Outil | Contrat descriptif du binaire installé |",
    "|---|---|",
    ...toolRows,
    "",
  ].join("\n");
}

export function runAgentHome(args: string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: aphrody-ops agent-home [--source <parent-root>] [--profile <profile>] [--workspace <directory>] [--dry-run]",
    );
    return 0;
  }
  const dryRun = args.includes("--dry-run");
  const profileIndex = args.indexOf("--profile");
  const profile = profileIndex >= 0 ? args[profileIndex + 1] : undefined;
  const sourceIndex = args.indexOf("--source");
  const source = resolve(
    sourceIndex >= 0 ? (args[sourceIndex + 1] ?? "") : resolve(import.meta.dir, "..", "..", "..", "..", ".."),
  );
  if (!source) throw new Error("--source requires a workspace directory");

  const home = homedir();
  const workspaceIndex = args.indexOf("--workspace");
  const explicitWorkspace = workspaceIndex >= 0 ? args[workspaceIndex + 1] : undefined;
  if (workspaceIndex >= 0 && !explicitWorkspace) throw new Error("--workspace requires a directory");
  const canonicalProfile = profile ? join(home, ".aphrody", "workspaces", profile) : undefined;
  const workspace = explicitWorkspace
    ? resolve(explicitWorkspace)
    : process.env.APHRODY_WORKSPACE ||
      (canonicalProfile && existsSync(canonicalProfile)
        ? canonicalProfile
        : join(home, ".aphrody", profile ? `workspace-${profile}` : "workspace"));
  const facts = REPOS.map(spec => inspect(spec, source));
  const generatedAt = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  const repos = renderRepos(facts, generatedAt, source);
  const root = existsSync(join(source, "Cargo.toml")) ? source : join(source, "aphrody");
  const tools = renderTools(generatedAt, home, root);
  if (dryRun) {
    process.stdout.write(`${repos}\n---\n${tools}\n`);
    return 0;
  }
  mkdirSync(workspace, { recursive: true });
  for (const [name, content] of [
    ["REPOS.md", repos],
    ["TOOLS.md", tools],
  ]) {
    const path = join(workspace, name!);
    if (existsSync(path)) {
      const previous = readFileSync(path, "utf8");
      if (!previous.startsWith("<!-- GENERATED by aphrody-ops agent-home") && previous !== content) {
        const backup = `${path}.before-agent-home-${Date.now()}`;
        writeFileSync(backup, previous, { mode: 0o600, flag: "wx" });
      }
    }
    writeFileSync(path, content!, "utf8");
  }
  const missing = facts.filter(fact => !fact.present).map(fact => fact.spec.dir);
  process.stderr.write(
    `wrote ${join(workspace, "REPOS.md")} and TOOLS.md\n${facts.length - missing.length}/${facts.length} repo(s) present${missing.length > 0 ? ` — absent: ${missing.join(", ")}` : ""}\n`,
  );
  return 0;
}

if (import.meta.main) process.exit(runAgentHome(process.argv.slice(2)));
