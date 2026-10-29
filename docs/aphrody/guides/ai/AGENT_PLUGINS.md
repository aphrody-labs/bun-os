<!-- SPDX-License-Identifier: Apache-2.0 -->

# Plugins, skills et MCP centralisés

Le propriétaire est `@aphrody/workspace`. Les sources locales sont dans
`~/plugins`, configurable par `APHRODY_PLUGINS_ROOT`. Les adaptateurs sont dans
[`agent-plugin-providers.json`](../../../../tools/aphrody/config/ai/agent-plugin-providers.json).
Le CLI utilise `@aphrody/paths`, `@aphrody/bun`, Bun YAML/TOML, Oxfmt
et les commandes natives disponibles.

## Préparer et vérifier

```sh
yolo workspace plugins status
yolo workspace plugins clean --apply
yolo workspace plugins fix-refs --scan-root /chemin/docs --apply
yolo workspace plugins prepare --apply
yolo workspace plugins validate
yolo workspace plugins validate --name aphrody --provider claude
yolo workspace plugins facts
```

Sans `--apply`, les mutations produisent un plan. `prepare` synchronise les
versions, les manifestes Claude/Codex, les configurations MCP et les catalogues
locaux, répare les liens prouvés par la migration puis applique Oxfmt.
`fix-refs` corrige les anciens chemins démontrés, les liens Markdown déplacés,
les descriptions YAML invalides et le nom de la skill WinClean partagée.
Les rapports historiques de migration restent des preuves inchangées.

## Fidélité aux sources

Chaque bundle maintient un `source-of-truth.json` avec les racines propriétaires,
les fichiers de code ou docs qui font autorité (`sources[].evidence`) et les
fichiers de connaissance du plugin (`knowledge`). `plugins facts` compare les
SHA-256 courants au reçu `_state/facts-lock.json`: `stale` signifie que la source
ou le contenu du plugin a bougé, `undocumented` qu'aucune source n'est déclarée.
Cette empreinte détecte une dérive; elle ne prouve pas le sens d'une phrase.

Après chaque changement source, le workflow relit l'implémentation et les docs
liées, corrige les instructions et exemples du plugin, exécute les gates du
propriétaire et les validateurs du plugin, puis actualise le reçu:

```sh
yolo workspace plugins facts --name NOM
# Revue manuelle des écarts contre les chemins déclarés et mise à jour du bundle
yolo workspace plugins refresh-facts --name NOM --apply
yolo workspace plugins validate --name NOM
```

Sans `--apply`, `refresh-facts` ne fait qu'afficher le plan. YOLO doit effectuer
ce contrôle pendant sa découverte, avant toute modification guidée par un skill;
un reçu périmé impose une vérification des faits avant l'exécution autonome.

`clean` cible seulement `_copies` et `_registrations` détachés dans le store.
Il conserve chaque contenu unique dans `_recovered`, vérifie les SHA-256,
enregistre les alias de doublons et refuse les liens de cache sortant du store.
Il ne purge pas les caches des plugins tiers encore installés.
Les rapports de mutation et l'inventaire des installations sont sous `_state`.
Un verrou coopératif sérialise les mutations.

## Installer une capacité

```sh
# Depuis . : détection automatique des CLI installés.
yolo workspace plugins install --name aphrody --apply

# Un seul fournisseur.
yolo workspace plugins install --name yolo --provider claude --apply

# Skill complète : instructions et ressources restent dans leur source.
yolo workspace plugins install --kind skill --name ecosystem \
  --source ~/plugins/aphrody/skills/ecosystem --provider codex --apply

# Configuration MCP dans un fichier privé, jamais des secrets en arguments.
yolo workspace plugins install --kind mcp --name aphrody \
  --source ~/plugins/aphrody/.mcp.json --apply

# Retirer l'enregistrement, conserver la source et les données du plugin.
yolo workspace plugins uninstall --name yolo --provider claude --apply
```

Les mêmes options s'appliquent à `uninstall`; les skills et MCP demandent leur
`--source`. `--provider` est répétable. `--scope project` permet une activation
limitée au dépôt, `--cwd` choisit ce dépôt, `--home` fournit un profil de
qualification isolé. Le retrait Codex d'un projet conserve le paquet utilisateur
pour les autres projets. Une destination de skill différente n'est jamais écrasée.

Aphrody reste limité à `aphrody`/`aphrody-py`, IECODE à `iecode`. Les skills de ces bundles héritent
également de leur restriction. YOLO, Bun, BXC et Google Gemini autorisent le
scope utilisateur. Un scope interdit échoue avant les mutations.

| Fournisseur | Installation et activation                                                                                         | Validation                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Codex       | Marketplace local; paquet utilisateur désactivé globalement pour les plugins restreints, activation TOML du projet | Contrôles du gestionnaire; aucune commande native de validation de plugins annoncée       |
| Claude      | Marketplace local et installation native `--scope`                                                                 | `plugin validate --json --strict` sur les manifests, catalogues et dossiers de composants |
| agy         | Installation native globale; entrée `plugins.json` filtrée pour le projet                                          | `plugin validate`                                                                         |
| Tous        | YAML, JSON, TOML, chemins confinés, versions, liens et MCP; skills liées avec leurs ressources                     | validation interne de `@aphrody/workspace`                                                |

Pour agy, le MCP du projet est un petit plugin sous `.agents/aphrody-mcp` (not in repo),
enregistré dans `.agents/plugins.json` (not in repo); un fichier `.agents/mcp_config.json` (not in repo)
seul n'est pas une surface documentée. Les MCP globaux agy et Codex sont
réconciliés directement pour préserver les options privées; Claude emploie
`mcp add-json`. Les headers HTTP sont convertis en `http_headers` pour Codex.
Les rapports masquent les configurations MCP. Les fichiers privés existants
conservent leurs paramètres non concernés; les nouveaux fichiers sont en mode 0600.

## Ajouter un fournisseur

Copier le registre avec `--config /chemin/providers.json`, garder `version: 1`
et ajouter un adaptateur avec `id`, `binary`, `versionArgs`, `pluginHelp`,
`pluginValidation` (tableau ou `null`), `pluginInstall` (tableaux d'arguments),
`pluginRemove`, `skillsDirectory`, `mcpAdd`, `mcpRemove` et `docs`.
`projectSkillsDirectory` est optionnel. Les variables sont `{store}`, `{path}`,
`{home}`, `{cwd}`, `{scope}`, `{name}`, `{marketplace}`, `{command}`, `{args}`
et `{mcpJson}`. Les arguments sont transmis directement, sans shell.
Un adaptateur MCP doit conserver le JSON complet quand des options supplémentaires
existent. Un fournisseur sans capacité annoncée reste explicitement non supporté.

## Qualification du 2026-10-03

Huit bundles préparés. Les contrôles de structure passent. Le lanceur BXC
0.9.15, déjà installé dans le store Aphrody, est exposé par
`~/.local/bin/bxc`; les huit bundles passent alors leurs validations natives
agy et Claude. Le CLI Codex n'annonce pas de validateur de plugin.
La qualification temporaire couvre les trois CLI, les plugins, skills et MCP,
aux scopes utilisateur et projet, avec installation puis retrait.
Cela vérifie les enregistrements; aucune disponibilité d'un serveur MCP distant
ni exécution complète d'un agent n'est déduite de ces contrôles.

Références de fournisseurs établies par les agents natifs avec `aphrody docs search` :
[Codex](../../research/ai/plugin-providers/codex.md),
[Claude](../../research/ai/plugin-providers/claude.md),
[agy](../../research/ai/plugin-providers/agy.md).
