<!-- SPDX-License-Identifier: Apache-2.0 -->
# Variables d’environnement et fichiers `.env`

Le fichier racine [`.env.example`](../../.env.example) est le catalogue de
référence des noms de variables lus par le code Rust et Bun du monorepo. Il ne
contient aucune valeur provenant d’un `.env` privé. Les variables de service y
sont commentées : active uniquement celles du programme lancé. Les exemples
propres à une application restent les modèles opérationnels de cette
application.

## Qui charge les fichiers

| Consommateur | Chargement | Portée |
| --- | --- | --- |
| Bun | Depuis le répertoire courant, charge `.env`, `.env.{NODE_ENV}`, `.env.local` (sauf en mode `test`), puis `.env.{NODE_ENV}.local`; les fichiers plus tardifs ont priorité. `--env-file` désactive cette sélection automatique et charge le ou les fichiers indiqués; `--no-env-file` désactive le chargement automatique. | Le processus Bun et ses enfants. |
| Next.js / `@next/env` | Charge les fichiers de l’application Next selon son mode; certains scripts appellent `loadEnvConfig` explicitement. | Le processus Next ou le script appelant. |
| Rust | `std::env` lit l’environnement hérité du processus. Rust/Cargo ne parse pas `.env` automatiquement; `env!` et `option_env!` capturent une valeur à la compilation. | Le binaire et ses enfants. |
| Nushell, Bash, PowerShell | Les initialiseurs Aphrody configurent chemins et outils. Ils ne chargent pas les secrets du projet. | La session interactive. |

Pour donner une variable à un binaire Rust, exporte-la dans le shell ou lance le
binaire depuis un processus qui l’a déjà chargée. Les variables Bun d’un `.env`
ne sont pas magiquement disponibles à une commande `cargo` lancée séparément.

## Fichiers et propriétaires observés

- `.env` à la racine : Bun le charge lorsqu’un programme est lancé depuis cette
  racine; les autres outils
  peuvent charger un fichier explicite.
- `.env.remote-db` : fichier privé distinct, lu explicitement par des outils
  d’audit et d’administration. Il n’est pas créé par l’initialiseur.
- Les fichiers `/etc/aphrody/*.env` : configurations opérateur ou systemd. Elles ne
  sont ni importées ni copiées dans le dépôt.
- `config/*.env.example`, `tools/config/host/privoxy/*.env.example` et les exemples propres
  aux applications sont des modèles; ils ne sont pas chargés globalement par
  défaut.

Le générateur [`env-inventory.ts`](../../../../scripts/aphrody/audit/workspace/env-inventory.ts)
inspecte statiquement le code de première partie et les fichiers suivis
`*.env.example`; il ne lit aucun fichier `.env` privé. Le catalogue racine
contient actuellement 917 noms distincts. C’est une aide de référence, pas une
liste exhaustive : les noms construits dynamiquement peuvent manquer et les
modèles peuvent déclarer des clés non utilisées par le code. Les variables
fournies automatiquement par Cargo ou l’OS ne sont pas des réglages à recopier.

## Initialiser les shells

Depuis la racine du checkout, exécute une fois la commande du shell concerné :

```sh
scripts/tools/shell/setup.sh
nu scripts/tools/shell/setup.nu --install --root "$PWD"
pwsh -NoProfile -File scripts/tools/shell/setup.ps1 -Install
```

Les scripts ajoutent un bloc marqué, idempotent, au profil Bash, Nushell ou
PowerShell de l’utilisateur courant. Ouvre un nouveau terminal après
l’installation. Tu peux aussi les charger ponctuellement :

```sh
source scripts/tools/shell/setup.sh
```

```nu
source-env scripts/tools/shell/setup.nu
```

```powershell
. ./scripts/tools/shell/setup.ps1
```

Ils préservent les valeurs déjà définies et configurent `APHRODY_ROOT`,
`APHRODY_HOME`, le domaine et le workspace agent, les checkouts voisins,
`CARGO_HOME`, `BUN_INSTALL`, le chemin des exécutables et les limites de build
Cargo du monorepo. Aucun secret n’est lu, exporté, imprimé ou écrit dans le
profil. Après déplacement du checkout, relance son installateur pour actualiser
le chemin du hook.

Références officielles : [Bun environment variables](https://bun.sh/docs/runtime/environment-variables),
[Bash startup files](https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html),
[PowerShell profiles](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles?view=powershell-7.6),
[PowerShell environment variables](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables?view=powershell-7.6),
[Nushell configuration](https://www.nushell.sh/book/configuration.html),
[Nushell environment](https://www.nushell.sh/book/environment.html),
[Rust `std::env`](https://doc.rust-lang.org/std/env/),
[Cargo environment variables](https://doc.rust-lang.org/cargo/reference/environment-variables.html).

Pour changer de profil agent dans une session :

```sh
APHRODY_AGENT_DOMAIN=ie
APHRODY_WORKSPACE="$APHRODY_HOME/workspaces/ie"
```

Sous Nushell ou PowerShell, utilise les affectations natives de `$env`.
