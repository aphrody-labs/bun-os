<!-- SPDX-License-Identifier: Apache-2.0 -->
# Architecture Agent-First

Décision propriétaire reçue le 2026-10-03. Le plan Aphrody
reste l'autorité commune. Workspace/Infra possède les workflows inter-dépôts ;
le [superviseur](../../../packages/workspace/src/python-workspace.ts) (`yolo py`) décrit les gates Python à consommer
depuis ces propriétaires, sans installation dépendant d'un checkout voisin.

## Contrat livré

`yolo py plan` publie le catalogue JSON sans exécuter de commande.
`yolo py <command>` exécute une commande déclarée sans shell.
`yolo py fmt -- --check` reste compatible.
Les diagnostics enfants vont sur stderr, le reçu JSON sur stdout. Une erreur
de commande conserve son code ; une commande inconnue retourne 2 et une erreur
de lancement retourne 127. Délai : 124 ; annulation : 130 ; prérequis runtime,
débordement de sortie ou erreur de supervision : 125. L'environnement existant
n'est pas publié dans le reçu.

Le reçu `schemaVersion: 2` contient commande, répertoire, date UTC, durée monotone
en ms, code de sortie, signal Unix numérique, raison et succès. Le code natif
est conservé séparément dans `processExitCode`. Le SDK ne fournit pas actuellement
les compteurs CPU/RSS du processus : `resourceUsage: null` est explicite.
Les ressources en chaînes décimales du schéma 1 sont donc historiques. Aucun gain de
performance n'est déduit d'une durée isolée. Les diagnostics stderr peuvent
contenir des données sensibles : ils restent dans leurs stores autorisés.

`commands` et `measure` sont importables. Un adaptateur MCP/API doit sélectionner
une commande du catalogue, vérifier ses permissions et appliquer ses limites ;
il ne doit pas exposer `measure` comme exécution arbitraire distante.
L'intégration MCP/API reste ouverte. Pas de boucle de retry automatique sur une commande
mutante telle que `build`/`apply`.

La supervision appartient au runtime Yolo : `@aphrody/runtime-sdk` est un membre du workspace Bun du monorepo
(`packages/engine/runtime`), sans pin de checkout voisin ni archive. Le runtime précompilé doit être installé via son
propriétaire release.

Avant exécution, `loadArtifact` vérifie hashes, cible et ABI de l'artefact installé.
Aucun rebuild moteur ni chargement implicite d'une bibliothèque d'un checkout voisin.
Le reçu rapporte `runtime.buildInfo()` ; ces métadonnées de build ne remplacent
pas la provenance SDK/native du manifeste installé.
Capture sans troncature, budget de 64 MiB par flux et délai par défaut de 30 minutes.
`MeasureOptions` peut réduire ces budgets et fournir un `AbortSignal` ;
l'option CLI `--timeout-ms <entier positif>` réduit le délai. SIGINT/SIGTERM
du point d'entrée CLI déclenchent l'annulation. Le SDK arrête le groupe Unix et joint
les workers ; les handles et le contexte sont libérés avant retour. La sortie
stdout enfant est relayée vers stderr après collecte, stderr pendant collecte.
Les descendants qui quittent le groupe restent hors ownership. Ce contrat est
qualifié sur Linux uniquement. L'arrêt brutal du superviseur par SIGKILL n'est
pas couvert par cette qualification.

## Maturation

| Situation | Propriétaire et décision | Preuve de qualification |
| --- | --- | --- |
| Orchestration, prototype, inspection | Bun/TypeScript par défaut | Tests du contrat, types, lint, format et reçu mesuré |
| Chemin critique de calcul ou mémoire | Rust dans Aphrody/Yolo selon la capacité | Bench comparable, check/test/Clippy sérialisés, ABI et lifecycle |
| Bibliothèque officielle C/C++ existante | Réutiliser sa distribution/API officielle | Licence, révision, cible, bindings et tests d'interopérabilité |
| Besoin propre à l'interpréteur | CPython uniquement pour ce besoin | Tests versionnés de l'API interpréteur |
| Écosystème Python tiers requis/supérieur | Python via uv, dépendances verrouillées | Installation propre, imports, wheels et contrats consommateurs |

La modernisation historique de packaging reste en Python sous `uv --locked`.
Ce maintien est transitoire : le remplacement doit qualifier parsing TOML,
locks isolés, métadonnées de distributions et collisions avant retrait de
`modernize_workspace.py`. Le module Bun factorise l'orchestration, pas encore
ces opérations. Ne pas exécuter `apply` pour mesurer une commande en lecture seule.

## Boucle récursive cible

Un besoin produit devient une opération du propriétaire existant, avec entrée
typée, sortie JSON/Markdown, erreurs stables et mesures. Le workflow exécute les
gates, compare le reçu aux critères puis met à jour le plan et la mémoire.
Les lectures indépendantes peuvent être parallèles ; les mutations dépendantes
restent séquentielles et Cargo sérialisé. La récursion est bornée par budget,
annulation et critères d'arrêt, et ne crée pas d'agents récursifs.

CLI, MCP et API doivent appeler le même propriétaire de capacité. La FFI suit
l'ABI C versionnée du plan Aphrody : ownership, buffers, erreurs, annulation,
threading et destruction. Aucune FFI n'est nécessaire pour le catalogue local.

## Jan : absorption demandée

Le [README officiel Jan](https://github.com/janhq/jan) consulté le 2026-10-03
annonce une API locale compatible OpenAI et une intégration MCP. Son arbre expose
`src-tauri`, `core`, `extensions` et `web-app`. Cela constitue une référence de
composition produit ; aucune installation, activation, intégration fournisseur,
qualification ABI ou parité avec le runtime Yolo n'a été effectuée.
La source consultée initialement était la branche mobile `main`.
Instruction propriétaire précisée le 2026-10-03 : fork privé dans `vendor/`,
comparaison factuelle de toutes les surfaces puis absorption des fonctionnalités
absentes dans leurs propriétaires Aphrody, sans doublonner l'existant.
Le checkout déjà présent est `14a720628f9592c8e60f7e081ef733076db8a6a9` ;
son remote public doit être remplacé par le fork privé selon le workflow propriétaire.

## Travaux ouverts

- Porter les opérations de packaging vers leur propriétaire Bun, avec qualification comparative.
- Qualifier les permissions, quotas de concurrence et entrées avant exposition distante.
- Brancher les adaptateurs MCP/API propriétaires sur le catalogue autorisé.
- Définir le budget et l'oracle de la boucle, puis qualifier le parallélisme.
- Mesurer les chemins critiques avant toute maturation Rust ; qualifier les bibliothèques C/C++ choisies.
- Forker Jan en privé, inventorier et migrer les fonctionnalités absentes avec preuves de parité.

Référence de l'API de mesure : [Bun child processes](https://bun.sh/docs/runtime/child-process),
vérifiée avec Bun installé 1.4.2 et types 1.4.2. Les preuves de ce lot sont dans
[MEMORY.md](../../MEMORY.md).
