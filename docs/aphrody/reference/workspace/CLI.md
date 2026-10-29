<!-- SPDX-License-Identifier: Apache-2.0 -->
# CLI du poste Aphrody

Contexte du 2026-10-09 : développement et builds sur tout hôte qualifié, selon la cible et les ressources ; voir le [contexte courant](../../operations/workspace/windows-native.md). Les versions et tableaux WSL ci-dessous sont historiques. Utiliser le home configuré et le serveur unique `aphrody-mcp`. Vérifier les aides natives avant usage.

Inventaire WSL/Linux vérifié le 2026-10-01 : 71 exécutables trouvés sur PATH,
10 plugins Nushell chargés. Les versions décrivent ce poste ; un chemin trouvé
ne prouve ni l’authentification d’un fournisseur ni une compilation produit.

## Aides installées et mémoire persistante

L’aide du binaire installé est la référence avant de choisir une commande.
Consulter d’abord les orchestrateurs `aphrody infra`, `aphrody-infra` et
`yolo ops`, puis l’aide du propriétaire de la capacité. Ne pas reconstruire
manuellement un workflow déjà déclaré dans Workspace ou Infra.

Le relevé récursif du 2026-10-03 couvre **53 binaires installés et
675 pages d’aide** sur WSL/Linux. Il consigne **7 aides en échec** et
**40 binaires absents**, sans prétendre à leur fonctionnement. Les arbres
source complets restent dans [CLI.md de l’écosystème](../../ecosystem/CLI.md).

```sh
bun run cli:help
# Lire le résultat durable (hors checkout Git)
bat ~/.local/share/aphrody/cli-help/INDEX.md
rg -n 'deploy|pipeline|workspace' ~/.local/share/aphrody/cli-help/
aphrody infra --help
aphrody-infra pipeline --help
yolo ops --help
```

Workspace possède le collecteur `cli-help` : chaque invocation termine par
`--help`, seules les sous-commandes annoncées sont parcourues, avec six lectures
simultanées au maximum et un délai de quinze secondes par commande. Les valeurs
sensibles présentes dans l’environnement sont masquées. Chaque snapshot conserve
les textes, les codes de sortie, les chemins des exécutables, leurs dates et la
révision source. `latest.json` indique le snapshot courant ; `--out` permet de
choisir un autre store, sans supprimer les anciens relevés.

Le même index recense les **89 binaires Rust déclarés**, dont **28 dans
NIE/IECODE**, et les **16 CLI Bun** : dépôt, crate/package propriétaire,
manifeste local, parser Clap lorsqu’il est catalogué et point d’entrée `bin` Bun.
Les manifests Bun sont relus dans le checkout propriétaire courant, notamment
`iecode/packages/inagle`, `iecode/packages/azalee` et `iecode/packages/iecode-homebrew`.
Les helpers Rust sans arbre Clap restent identifiés comme tels. Une entrée source
sans binaire installé reste consultable ; cette collecte ne lance ni compilation
Cargo ni CLI source en remplacement d’un exécutable absent.

Le pointeur persistant Codex est `~/.codex/brain/CLI-HELP.md`, chargé par les
consignes globales. Ces fichiers sont une référence consultable ; ils ne prouvent
pas une importation dans un fournisseur de mémoire ni la disponibilité d’un outil
MCP dans une session donnée. Réactualiser après changement d’un binaire. Le
relevé décrit WSL/Linux, pas les installations Windows ou distantes.

## Démarrage des agents et contextes

Démarrer depuis `<repo>`. Les règles communes sont dans
[AGENTS.md](../../AGENTS.md) ; Claude et agy y accèdent par les liens
`CLAUDE.md` et `GEMINI.md`. Les trois agents travaillent sur la branche courante
et réclament des familles de fichiers distinctes avant leurs modifications.

```bash
cd <repo>
aphrody a2a invoke --peer codex --claim crates/ai/example "tâche"
aphrody a2a invoke --peer claude --claim docs/operations/example "tâche"
aphrody a2a invoke --peer agy --claim packages/infra/example "tâche"
```

Adapter les chemins de claim à la tâche réelle. `--dry-run` vérifie la commande
résolue sans lancer de tâche. Les claims sont des verrous coopératifs ; les
commits observés ne constituent pas une attribution certaine à un agent.

Aphrody et IE ont des contextes de domaine séparés. Le contexte
partagé entre CLI reste rattaché au workspace concerné. Les bases natives de
conversation restent dans leurs stores ; leurs projections ne deviennent pas
des règles. Les poids entraînés et les données privées conservent leur store.
Voir [TOOLS.md](../../TOOLS.md) pour les profils effectivement configurés.
Le défaut de configuration est `aphrody`. Pour le domaine Inazuma :

```bash
APHRODY_AGENT_DOMAIN=ie APHRODY_PROFILE=ie \
APHRODY_WORKSPACE=~/.aphrody/workspaces/ie \
aphrody a2a invoke --peer codex --claim crates/ai "tâche IE"
```

Les pairs continuent de
booter depuis ce checkout ; leurs stores et conversations sont filtrés par profil.

## Commandes de coordination vérifiées

| Besoin | Commande |
| --- | --- |
| Agents et familles de fichiers | `aphrody a2a invoke --help` |
| Routage des pairs | `aphrody a2a peers` |
| Import incrémental des sessions | `aphrody ai sync-sessions --json --shared-workspace <repo>` |
| Projection sans import mémoire | `aphrody ai sync-sessions --json --no-memory` |
| Propriétaire natif de l’import par domaine | `yolo ops agent-sync --help` |
| État live PID/session/workspace/Git | `yolo ops agent-live --json` |
| Actualisation continue | `yolo ops agent-live --watch --interval-secs 30` |
| Génération Agent Home | `yolo ops agent-home --help` |
| Catalogue réel du kernel | `aphrody-kernel tools` |
| Appel kernel | `aphrody-kernel call <outil> '<objet JSON>'` |
| Modèles locaux installés | `aphrody model list --json` |
| Contrôle du store modèles | `aphrody model doctor --json` |
| Environnement IA résolu | `aphrody ai env --help` |
| Inspection mémoire disponible | `aphrody memory --help` |

`agent-live` publie `.coord/shared/LIVE.json` (not in repo) et `LIVE.md` en observateur passif.
Depuis le lot `bb0cfd33f` du 2026-10-03, `agent-sync` possède l’import natif MCP
des sessions et de la mémoire pour un domaine sélectionné ; il vérifie le domaine
du kernel et publie `.coord/shared/AGENT-SYNC.json` (not in repo). Le service installé
`aphrody-agent-session-sync.service` est configuré pour Aphrody. Les instances
historiques `aphrody-agent-domain-sync@<domaine>.service` doivent être vérifiées
avant usage : un seul propriétaire doit consommer les offsets d’un domaine.
L’existence d’un service ne prouve ni import complet ni rattrapage historique.
Voir [preuve et limites live](../../operations/ai/agent-live.md) et
[propriétaire de l’import](../../../../packages/workspace/src/agent-sync.ts).
L’aide installée de `aphrody memory` propose `migrate` ; ne supposer aucune
sous-commande `audit` ou `backends` sans la vérifier sur le binaire courant.

## Toolchains et validation

Bun `1.4.4`, uv `0.12.24`, Rust/Cargo `1.98.1`, Oxc `oxlint 1.86.0` /
`oxfmt 0.71.0`, TypeScript `7.0.2`. Le wrapper Cargo global est `sccache`.
Les cibles Rust installées incluent Linux, Windows MSVC/GNU, macOS Intel/ARM,
WASM navigateur, WASI et Emscripten ; cela ne prouve pas leurs SDK externes.
La qualification des outils MSVC est enregistrée séparément dans le rapport
setup toolchain.

```bash
scripts/build/rust/cargo-serial.sh check -p <crate> --all-targets
scripts/build/rust/cargo-serial.sh clippy -p <crate> --all-targets -- -D warnings
scripts/build/rust/cargo-serial.sh test -p <crate>
oxlint <fichiers>
oxfmt --check <fichiers>
tsc --noEmit --project <tsconfig>
bun test <tests>
```

Respecter les manifests des propriétaires pour les scripts et les périmètres.
Les exécutables globaux n’alignent pas automatiquement les dépendances locales.

Contrat des outils globaux (2026-10-04) : `oxlint`, `oxfmt`, `tsc`, `bun` et `nu`
sont appelés directement, sans `bunx`/`npx`/`nx`, dans les scripts `package.json`,
les scripts TypeScript/shell et la documentation. Les scripts `package.json`
résolvent d’abord `node_modules/.bin` (outil local, ex. `next`, `drizzle-kit`,
`nodemon`), puis le PATH global. `bunx` n’est plus nécessaire pour les outils suivants, installés globalement et
épinglés sur WSL, Windows, vps et dbfr (`bun add -g`, manifeste
`yolo/tools/config/host/toolchain.json`, procédure `docs/operations/infra/TOOLCHAIN-SYNC.md`) :
`wasm-pack@0.15.0`, `@tauri-apps/cli@3.0.0-alpha.4`, `jscodeshift`, `@ast-grep/cli`
(`ast-grep`), `json-schema-to-typescript` (`json2ts`), `@material-design-icons/scripts`,
ainsi que `drizzle-kit`, `prisma`, `wrangler`, `serve`, `nodemon`, `nx`, `shadcn`,
`@tailwindcss/cli`, `vite`, `@mikro-orm/cli`, `sharp-cli`. Les scripts peuvent appeler ces
binaires directement ; `bunx` ne reste utile que pour un outil absent de cette liste.

## Inventaire des exécutables

Sources : [manifest développeur](../../../../infra/config/developer-cli-tools.json),
[catalogue canonique](../../../../tools/aphrody/config/cli-catalog.json), résolution du PATH et
`--version` exécuté avec délai borné. Les plugins sont vérifiés via `plugin list`.
`bottom` est le nom du package, son exécutable est `btm` ; `yazi-cli` fournit
`ya` ; `tealdeer` fournit `tldr`. Ces noms de packages ne sont pas des absences.

| Commande | Version observée | Chemin réel |
| --- | --- | --- |
| `agy` | 1.2.14 | `~/.local/bin/agy` |
| `aphrody` | aphrody 1.0.0-canary | `~/.local/bin/aphrody` |
| `aphrody-kernel` | aphrody-kernel 1.0.0-canary | `~/.local/bin/aphrody-kernel` |
| `aphrody-mcp` | aphrody-mcp 1.0.0 | `~/.local/bin/aphrody-mcp` |
| `atuin` | atuin 18.23.0 (78366dca8c4941731e06a2f81c0980cc2ccc3836) | `~/.cargo/bin/atuin` |
| `bat` | bat 0.26.1 (979ba22) | `~/.cargo/bin/bat` |
| `btm` | bottom 0.14.9 | `~/.cargo/bin/btm` |
| `bun` | 1.4.4 | `~/.bun/bin/bun` |
| `bunx` | 1.4.4 | `~/.bun/bin/bunx` |
| `bxc` | bxc 0.9.15 | `~/.bun/bin/bxc` |
| `carapace` | carapace-bin 1.8.0 | `/usr/bin/carapace` |
| `cargo` | cargo 1.98.1 (797e8a9bc 2026-08-05) | `~/.cargo/bin/cargo` |
| `choose` | choose 1.3.7 | `~/.cargo/bin/choose` |
| `cl.exe` | Microsoft C/C++ 19.44.35229 | `~/.local/bin/cl.exe` |
| `claude` | 2.1.286 (Claude Code) | `~/.nvm/versions/node/v24.20.0/bin/claude` |
| `codex` | codex-cli 0.158.0 | `~/.local/bin/codex` |
| `coreutils` | coreutils 0.12.0 (multi-call binary) | `~/.cargo/bin/coreutils` |
| `curl` | curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0 OpenSSL/3.0.13 zlib/1.3 brotli/1.1.0 zstd/1.5.5 libidn2/2.3.7 libpsl/0.21.2 (+libidn2/2.3.7) libssh/0.10.6/openss | `/usr/bin/curl` |
| `delta` | delta 0.19.2 | `~/.cargo/bin/delta` |
| `dust` | Dust 1.2.6 | `~/.cargo/bin/dust` |
| `dysk` | dysk 3.7.1 | `~/.cargo/bin/dysk` |
| `erd` | erdtree 3.1.2 | `~/.cargo/bin/erd` |
| `eza` | eza - A modern, maintained replacement for ls | `/usr/bin/eza` |
| `fd` | fd 10.5.0 | `~/.cargo/bin/fd` |
| `ffmpeg` | non établie | `/usr/bin/ffmpeg` |
| `gcloud` | Google Cloud SDK 587.0.0 | `/usr/bin/gcloud` |
| `gh` | gh version 2.45.0 (2025-07-18 Ubuntu 2.45.0-1ubuntu0.3) | `/usr/bin/gh` |
| `git` | git version 2.43.0 | `/usr/bin/git` |
| `gitui` | gitui 0.28.1-nightly 2026-03-25 () | `~/.cargo/bin/gitui` |
| `hx` | helix 25.07.1 (079a789e) | `~/.cargo/bin/hx` |
| `just` | just 1.58.0 | `~/.cargo/bin/just` |
| `lib.exe` | MSVC 14.44.35207 | `~/.local/bin/lib.exe` |
| `link.exe` | MSVC 14.44.35207 | `~/.local/bin/link.exe` |
| `llama-server` | non établie | `~/.local/bin/llama-server` |
| `ml64.exe` | Microsoft MASM 14.44.35207 | `~/.local/bin/ml64.exe` |
| `n2b` | n2b 0.6.2 | `~/.local/bin/n2b` |
| `nu` | 0.115.1 | `~/.cargo/bin/nu` |
| `nu_plugin_bigquery` | plugin chargé | `~/.cargo/bin/nu_plugin_bigquery` |
| `nu_plugin_formats` | plugin chargé | `~/.cargo/bin/nu_plugin_formats` |
| `nu_plugin_gstat` | plugin chargé | `~/.cargo/bin/nu_plugin_gstat` |
| `nu_plugin_highlight` | plugin chargé | `~/.cargo/bin/nu_plugin_highlight` |
| `nu_plugin_inc` | plugin chargé | `~/.cargo/bin/nu_plugin_inc` |
| `nu_plugin_json_path` | plugin chargé | `~/.cargo/bin/nu_plugin_json_path` |
| `nu_plugin_polars` | plugin chargé | `~/.cargo/bin/nu_plugin_polars` |
| `nu_plugin_query` | plugin chargé | `~/.cargo/bin/nu_plugin_query` |
| `nu_plugin_skim` | plugin chargé | `~/.cargo/bin/nu_plugin_skim` |
| `nu_plugin_zstdsep` | plugin chargé | `~/.cargo/bin/nu_plugin_zstdsep` |
| `oxfmt` | Version: 0.70.0 | `~/.bun/bin/oxfmt` |
| `oxlint` | Version: 1.85.0 | `~/.bun/bin/oxlint` |
| `procs` | procs 0.14.12 | `~/.cargo/bin/procs` |
| `pwsh` | PowerShell 7.6.6 | `/usr/bin/pwsh` |
| `python3` | Python 3.12.3 | `/usr/bin/python3` |
| `rclone` | rclone v1.75.1 | `~/.local/bin/rclone` |
| `rg` | ripgrep 15.2.0 (rev e89fff89ac) | `~/.codex/packages/app-server-daemon/releases/0.159.3-x86_64-unknown-linux-musl/codex-path/rg` |
| `rustc` | rustc 1.98.1 (48a229cea 2026-09-01) | `~/.cargo/bin/rustc` |
| `rustup` | rustup 1.29.1 (d95a37b6a 2026-08-13) | `~/.cargo/bin/rustup` |
| `sccache` | sccache 0.18.0 | `~/.cargo/bin/sccache` |
| `sd` | sd 1.0.0 | `~/.cargo/bin/sd` |
| `ssh` | non établie | `/usr/bin/ssh` |
| `starship` | starship 1.26.0 | `~/.cargo/bin/starship` |
| `tldr` | tealdeer 1.9.0 | `~/.cargo/bin/tldr` |
| `tsc` | Version 7.0.2 | `~/.bun/bin/tsc` |
| `tsgo` | Version 7.0.0-dev.20260707.2 | `~/.bun/bin/tsgo` |
| `uv` | uv 0.12.24 (x86_64-unknown-linux-gnu) | `~/.local/bin/uv` |
| `uvx` | uvx 0.12.24 (x86_64-unknown-linux-gnu) | `~/.local/bin/uvx` |
| `xh` | xh 0.26.2 | `~/.cargo/bin/xh` |
| `ya` | Ya 26.5.6 (aa52643 2026-05-05) | `~/.cargo/bin/ya` |
| `yazi` | Yazi 26.5.6 (aa52643 2026-05-05) | `~/.cargo/bin/yazi` |
| `zellij` | zellij 0.45.1 | `~/.cargo/bin/zellij` |
| `zig` | 0.16.0 | `~/.local/bin/zig` |
| `zoxide` | zoxide 0.10.0 | `~/.cargo/bin/zoxide` |

## Rafraîchissement et propriétaires

Agent Home collecte les exécutables présents et le catalogue kernel depuis le
poste. Relancer son générateur après une installation et consulter les profils
produits. Le catalogue historique
[CLI de l’ancien écosystème](../../ecosystem/CLI.md) est une preuve importée,
avec des chemins antérieurs à la migration ; utiliser les manifests actuels et
`<commande> --help` pour les commandes effectivement installées.

La configuration Nushell et ses intégrations sont décrites dans le
[guide workstation](nu.md). Les dix plugins sont chargés à cette vérification.
Le catalogue `tools/config/cli-catalog.json` choisit un seul outil par capacité ;
`systemctl` reste le superviseur hôte et `ssh` le transport.

Les jetons, conversations brutes et valeurs de configuration privées ne sont
pas inclus dans cet inventaire. La synchronisation Drive et les modèles
sont documentés par leurs propriétaires Agent Home et Infra.
