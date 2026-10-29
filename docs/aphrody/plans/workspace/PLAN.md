> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody — FFI unique et consolidation Rust, Python, Bun

> Contexte courant (2026-10-09) : développement et builds selon l'hôte, la cible et les ressources disponibles ; aucun produit n'est réservé à un poste. Voir le [contexte](../../operations/workspace/windows-native.md).

> Path reconciliation (2026-10-07): `crates/compat/n2b-native` (not in repo) → `crates/interop/ffi/src/n2b_native.rs`. Original dated observations below retain their historical scope.

Décision de cible : 2026-09-29. Ce plan organise le travail demandé ; ses
cases ouvertes ne décrivent pas une migration livrée. Les étapes s'exécutent
sur des révisions relevées à nouveau, avec preuves de parité et retour arrière.

## 1. Décision et autorité

Créer sous `aphrody-labs` **deux dépôts canoniques de code** :

| Dépôt cible | Contenu et responsabilité |
| --- | --- |
| `aphrody` | Toutes les crates Rust et tout le code JS/TS/Bun de `src` : plateforme, contrats, OS, AI, Web/runtime, UI, Infra, Shell, N2B, Koharu, Discord, IECODE/NIE, applications, packages, plugins, automatisations et extensions Rust de Python. Workspaces Cargo et Bun au même niveau ; une seule façade publique Bun/Rust, **`@aphrody/bun`**. Les forks et crates tierces y sont accessibles comme sources épinglées et identifiées. |
| `aphrody-py` | Tous les projets, bibliothèques, outils et scripts Python : AI, entraînement, SDK, IECODE/NIE, Blender et utilitaires. Workspace uv commun et environnements spécialisés explicitement déclarés. |

`aphrody-infra` reste le control plane et l'orchestrateur principal des
workspaces Cargo/Bun/uv, de CI, des audits et des releases. **`@aphrody/workspace`
reste dans `aphrody-infra`** comme client/dispatcher d'orchestration ; il
consomme les interfaces stables d'`aphrody` et `aphrody-py` et n'embarque pas
de copie de leurs implémentations. Infra conserve configs, inventaires,
secrets, routes, runbooks et déploiements. Son code library/Rust et ses outils
Bun/Python rejoignent respectivement les deux monorepos ; les interfaces
opérationnelles restent dans Infra.

Leur implantation change de dépôt et leur métier reste isolé en modules. Tous les fichiers de `src`, y compris ceux hors catalogue, reçoivent une destination ou une justification vérifiée. Le C/C++, Zig, C#, assets, modèles et archives sont répertoriés avec leur propriétaire ; ils ne sont pas supprimés par le tri en trois langages.

L'extraction locale commence dans `<repo>` et `../aphrody-py`, créés à côté de `src`. Aucun gitlink, remote, service ou source de ces deux dépôts ne change avant cette barrière.

La décision finale réunit Rust et Bun dans `aphrody` : aucun dépôt
`aphrody-ts` séparé n'est à créer. Un package dépendant de Rust et ses crates
évoluent dans le même commit, avec leurs tests, types et artefacts de build.
Le code Bun sans dépendance native rejoint aussi ce workspace ; Python dispose
de son dépôt complet, avec les sources de ses extensions Rust dans `aphrody`.

Ce plan **remplace la cible antérieure de neuf dépôts et `aphrody-core`** et
la proposition de deux façades `@aphrody/native-core` / `@aphrody/native` du
[plan FFI précédent](../infra/BUN-RUST-BRIDGE-PLAN.md).
La cible est un FFI Aphrody, un chargeur, un registre de capacités et un
package de façade. Une transition avec plusieurs implémentations a une date
et un critère de retrait ; elle ne vaut pas clôture.

L'[architecture actuelle](../../architecture/workspace/ARCHITECTURE.md) décrit les frontières encore
actives. Avant chaque bascule, mettre à jour ses chemins et les plans locaux
avec la même preuve. Les obligations produit de l'ancien plan sont conservées
intégralement dans son [archive](../../operations/workspace/HISTORY.md),
y compris les ajouts non commités présents avant cette rédaction. Elles
restent à livrer selon les parcours maintenus en section 10.

## 2. Sources actuelles et limites de l'audit

[Snapshot de cette passe](../../operations/workspace/HISTORY.md) :
heads, branches, modifications locales et résultat de
`yolo ops bridge status`. Il observe **13 racines Bun et 10 binaires** dans
le catalogue du package central, pas l'ensemble des crates ni leurs exports.
`bridges.ts` exécute encore les binaires : « bridge » ne prouve pas une FFI.
L'inventaire de scripts antérieur ne descend pas toutes les profondeurs de
répertoires ; son total ne prouve pas la couverture complète de `src`.

| Source vérifiée | Constat utile à la fusion |
| --- | --- |
| `aphrody-ui/packages/bun/package.json`, `crates/ui/bun/Cargo.toml` | `@aphrody/bun` 3.3.3, crate `aphrody-bun` 1.0.0-canary, bibliothèque `bun_rs`, cdylib + rlib. Les versions ne sont pas un contrat ABI commun. |
| `aphrody-ui/packages/bun/src/`, `packages/svg/src/` (not in repo) | Plusieurs chargements du même `bun_rs`, recherche de `target/`, appels natifs dès l'import du module principal. M3, Sass, icônes, SVG, rendu et reproduction doivent tous être conservés. |
| [Fork `aphrody-labs/bun`](../../reference/upstream-bun/APHRODY-FORK.md) | Pas de module `bun:aphrody` ni de liaison Rust statique au moteur : `aphrody_ffi`, N2B et Oxc se chargent par `bun:ffi`. |
| `crates/interop/ffi/src/n2b_native.rs`, `oxc/apps/aphrody-oxc` | Sources natives spécifiques déjà présentes ; comparer leur graphe Oxc, leurs fonctions et leurs features avant fusion. |
| `aphrody-web/Cargo.toml` | Web est déjà une famille de crates : moteur, bridge, FFI, render, extract, index, service, Chromium et Obscura ; sa simple façade ne supprime pas leurs duplications. |
| `iecode/crates/ffi`, `nie/crates/engine/nie-ffi`, `iecode/packages/nie` | ABI/bindings du domaine en migration. Une présence dans deux dépôts n'est pas une raison suffisante pour supprimer un côté. |
| `aphrody-ai/py/aphrody/Cargo.toml` | Extension PyO3 `aphrody-rust`, cdylib indépendante : destination Rust dans `aphrody`, packaging Python dans `aphrody-py`. |
| `aphrody-native` | Probes CPU/mémoire/CUDA/horloge. Ce dépôt ne fournit pas actuellement un pont universel FFI. |

Le fork Bun observé est `a2671046afbfc818fba21a4925f384b75dc8e109`, Oxc
`31d5266e150ff17af52f0c2fc798cc27dc9a5a59`. La documentation du fork
[FFI du fork Bun](https://github.com/aphrody-labs/bun/blob/main/docs/runtime/ffi.mdx) décrit FFI comme expérimental ;
[Node-API du fork Bun](https://github.com/aphrody-labs/bun/blob/main/docs/runtime/node-api.mdx) présente les addons Node-API.
Ces documents vivent dans le checkout Bun ; le [registre de provenance](../../reference/upstream-bun/SOURCE.json)
décrit la référence conservée dans Aphrody.
Aucun choix de transport ne dispense des essais du fork exact distribué.
Les skills locaux `bun`, `rust-bun` et Rust consultés sont des aides datées ;
les manifests, sources et types installés tranchent leurs contradictions.

`bun_rs` est le nom de bibliothèque de `aphrody-bun`. L'expression `rs-bun`
n'a pas identifié un second crate dans les chemins consultés ; P0 vérifiera
noms Cargo, aliases de dépendances, packages et sources exclues avant toute
conclusion exhaustive. Les anciens benchmarks du brain restent historiques.
Cette passe n'a ni compilé le futur pont ni mesuré son débit.

### État de migration — 2026-09-29

Infra `@aphrody/workspace` fournit maintenant `consolidation inventory`,
`consolidation docs-import` et `consolidation scripts-import`. Le relevé courant
du 2026-09-29 porte sur 19 worktrees directs, 77 859 chemins suivis/non ignorés
et 7 040 documents candidats. La cible `<repo>` indexe 6 538
documents importables, dont 202 alias de documents identiques. 454 scripts
classés ont été copiés. Le rapport (removed import receipt)
compte 1 297 liens locaux non résolus (notamment code, assets, chemins exclus ou
références historiques) ; l'absence de collision de copie ne ferme pas ces
références.

Le module Infra `@aphrody/workspace` utilise Bun 1.4.4 et TypeScript 7.0.2
comme compilateur ; son besoin d'API du compilateur est explicitement fourni
par `@typescript/typescript6` 6.0.2 dans l'auditeur AST. Le lockfile, oxlint,
le typecheck et oxfmt ont été vérifiés après cette séparation.

Ce relevé ne ferme pas P0 : il ne descend pas les sous-modules imbriqués ; les
checkouts `bevy`, `dust` et `emu.nintendo.wii.gecko` sont absents du disque à
cette passe et demeurent à classer depuis leurs déclarations de sous-module.
IECODE est maintenant un checkout frère ; la copie a été faite depuis la
révision `550066b66181c4aeffb90b4067e8af742b0c112b`. Le dernier scan voit
`797507d675690579e7bd632d83c212c7ae970e09` ; IECODE contient des changements
de travail postérieurs à la copie (sept chemins relevés par le scan final,
dont un nouveau script). Leur liste figure dans la carte ; aucun n'est touché
ici. Les 254
fichiers extraits restent byte-identiques à la crate de cette révision. Une tranche de
`iecode/crates/ievr-data` a été copiée à `aphrody/crates/iecode/ievr-data` sans
écart SHA-256 et passe `cargo check --all-targets --locked --offline` dans le
workspace cible initial. Le relevé est dans
`aphrody/docs/migration/ievr-iecode-extraction.json`. Ceci ne valide pas les
autres crates IEVR, les données de jeu, le binding Bun, le MCP ou le plugin.

Les 453 scripts sont des copies de travail : leur exécution, les scripts imbriqués dans les apps/packages, les liens/attachements doc et la résolution des conflits de manifests restent ouverts. `aphrody-mcp` demeure le seul endpoint configuré dans `nie/.mcp.json`. `nie-mcp` reste un binaire fin (`nie-cli::main_entry_with(["nie", "mcp"])`), avec l'implémentation dans `nie-cli/src/mcp.rs`. AI le relaie par un processus persistant et expose en plus ses outils typés. Le package source IECODE `@nie/plugin` enregistre des loaders IEVR et dépend de l'ancien `@aphrody/nie`, qui charge `iecode` via `bun:ffi`. Le staging de ces wrappers dans Aphrody a été retiré faute de parité; leur réintroduction exige le contrat FFI/API IECODE et une parité de capacités avant le retrait du proxy MCP. Aucune app/package complète n'a encore passé son installation propre dans le workspace cible.

## 3. Topologie de code proposée

```text
aphrody/                         # nouveau monorepo Rust + Bun
  Cargo.toml, Cargo.lock         # workspace propriétaire, profils et patches
  package.json, bun.lock         # workspace Bun, catalogue et outils communs
  crates/<domain>/<crate>/       # contracts, native, compat, os, shell, ai,
                                 # web, ui, infra, iecode, nie, koharu, discord
  crates/ffi/aphrody-ffi/        # seule frontière native publique Bun/Rust
  apps/<domain>/<app>/           # applications classées par propriétaire
  packages/<domain>/<package>/   # packages Bun classés par propriétaire
  docs/<category>/<domain>/      # documentation canonique sourcée
  scripts/<category>/            # audit, build, dev, migration, release
  upstream/                      # Bun, Oxc, Bevy et autres sources épinglées
aphrody-py/
  packages/, apps/, tools/      # packages historiques et applications
  pyproject.toml, uv.lock       # workspace uv
  environments/                # résolutions incompatibles justifiées, ex. CUDA
aphrody-infra/                  # control plane, @aphrody/workspace, config, release
```

Ces chemins sont des destinations, pas des chemins déjà créés. La façade
publique Bun unique ne transforme pas tous les composants UI/métier en une
seule distribution géante : tous leurs accès Rust passent par ses exports.
Exemples cibles : `@aphrody/bun/{ai,web,n2b,oxc,ui,svg,iecode,infra}`.
`@aphrody/workspace` reste dans Infra comme orchestrateur des deux monorepos ;
il consomme cette façade et les contrats publics Python sans devenir une
implémentation native concurrente. Les scripts de contrôle Infra restent dans
Infra ; les outils liés aux apps/packages migrent dans `scripts/` par catégorie.

Cargo et Bun gardent chacun leur manifeste et leur lockfile à la racine de
`aphrody`. Le graphe commun relie `crates/`, `packages/` et `apps/` : génération
des contrats → build Rust → artefacts natifs → packages Bun → applications.
Les bindings générés et leurs sources changent atomiquement. Définir les
entrées/sorties et clés de cache par SHA, cible, features et versions des outils,
pour qu'un changement Rust invalide bien les packages et apps qui en dépendent.
L'édition locale n'exige plus de checkout Rust voisin ; les packages publiés
résolvent leurs artefacts versionnés sans chercher le workspace du développeur.

Toutes les crates tierces sont couvertes dans `aphrody/upstream` par des
sous-modules ou imports documentés, avec SHA, patches et licence. Bun/Oxc
conservent leurs dépôts de fork GitHub, leur relation upstream et leurs
workspaces propres. Les réécrire en membres du Cargo propriétaire sans leurs
outils serait une régression ; le monorepo Rust + Bun les référence et construit la
fermeture de sources complète. Les exceptions au workspace commun restent
explicites, qualifiées et réexaminées ; aucune crate n'est oubliée du graphe.

## 4. Un FFI et une façade : contrat de fusion

**Nom canonique proposé : conserver `aphrody-ffi`, étendre `@aphrody/bun`.**
Le crate FFI devient l'agrégateur supérieur des capacités, avec dépendances
acycliques vers les bibliothèques. Les anciennes bibliothèques ne dépendent
jamais de l'agrégateur. Le contrat ABI neutre reste dans Contracts avant son
import dans `aphrody/crates/contracts` ; son nom exact est arrêté après
recherche des types déjà disponibles.

Un seul artefact natif Aphrody par plateforme/profil de capacités, un même
ensemble de règles ABI, aucun second moteur intégré par façade. Les bibliothèques
système, GPU et moteurs externes requis ne sont pas comptées comme de nouveaux
FFI Aphrody. Un addon Node-API éventuel est un adaptateur mince de ce même
cœur ; sa construction doit démontrer qu'elle ne duplique pas le runtime.
Bun FFI, Node-API ou une liaison au fork sont sélectionnés par qualification,
avec le même package public et le même contrat. La dualité de deux nouvelles
façades du plan précédent est abandonnée.

- [ ] Recenser **chaque symbole** C, wrapper TS, header, feature et consommateur,
- [ ] Définir version ABI distincte de SemVer, taille des structures, capacités,
  erreurs, encodage, tailles bornées, alignement, entiers 64 bits, handles et
  politique de panic. Aucun `String`/`Vec` Rust brut à travers la frontière.
- [ ] Donner à chaque allocation son propriétaire et son destructeur exact.
  Réconcilier les contrats existants, dont `IecodeBytes`, sans imposer son
  nom métier à toute la plateforme. Fermer après libération des handles actifs.
- [ ] Préférer les appels typés aux JSON de commandes ; réserver JSON aux
  métadonnées et opérations qui le justifient. Les gros buffers sont bornés,
  transférés/copiés avec un contrat explicite et mesurés.
- [ ] Transformer les longues opérations en jobs avec progression, annulation,
  délais et files bornées. Une fonction C synchrone appelée dans une Promise
  reste bloquante ; employer worker Bun ou pont async qualifié. Réutiliser
  les propriétaires de jobs/Tokio et éviter les runtimes créés à chaque appel.
- [ ] Retirer du chemin courant `runCaptured`/capture globale stdout/stderr ;
  les garder temporairement pour compatibilité des CLI tant que toutes leurs
  commandes n'ont pas d'API structurée équivalente.
- [ ] Chargeur unique paresseux, manifeste de triple/libc/features, vérification
  ABI avant usage, source/release SHA et empreinte. Aucun calcul de démonstration
  au moment de l'import ; types importables sans bibliothèque installée.
  Une résolution `target/` reste un mode développeur explicite et centralisé.
- [ ] `@aphrody/bun`, SVG et les autres consommateurs partagent les mêmes
  descripteurs générés.
- [ ] Les anciens noms de packages/symboles servent de redirections temporaires
  vers le même code. Des anciens noms de DLL peuvent nécessiter des shims de
  transition ; aucune implémentation dupliquée permanente.

**Critère de fermeture :** un seul crate `aphrody-ffi` produit la bibliothèque
native publique, une seule façade Bun la charge, et un seul serveur MCP Aphrody
héberge les outils de tous les domaines. Les anciens noms de symboles,
packages, binaires, variables d'environnement et serveurs MCP sont retirés
après migration des consommateurs. Le contrôle final recherche ces noms dans
le code et la documentation actifs, vérifie les export maps et les chargeurs,
puis construit les artefacts depuis un clone propre. Les instantanés de
provenance conservent leurs empreintes sans servir de documentation produit.

Le premier lot Web dans l'agrégateur importe les adaptateurs extraction et
indexation comme modules de `aphrody-ffi`, liés aux crates Rust partagées. Il
n'annonce pas l'ABI Web v4 complète : les autres symboles doivent être migrés
avant le basculement du chargeur Bun. Les alias historiques sont supprimés
après ce basculement et la qualification des consommateurs.

Pour MCP, `aphrody-mcp` est l'hôte publié. Importer les outils du serveur Web
Bun, du serveur Obscura/CDP et des autres domaines comme modules ou adaptateurs
de cet hôte ; préserver leurs schémas pendant la bascule. Débrancher ensuite
leurs points d'entrée autonomes et leurs configurations clientes. Une commande
CLI ou une bibliothèque cliente peut rester, mais elle ne doit pas publier un
deuxième serveur Aphrody. Vérifier qu'une seule configuration de lancement MCP
et un seul catalogue d'outils sont distribués.

## 5. Fusion Web, runtimes JS et intégration au fork Bun

La cible de capacité est **un `aphrody-web` complet**, avec modules internes
`browser`, `engine`, `js`, `extract`, `index`, `render`, `service` et adaptateurs
hôte. Les sources de `aphrody-web-{engine,bridge,extract,index,render,service}`
y convergent après les lots de parité. `aphrody-web-ffi` converge dans le FFI
canonique. Le serveur `aphrody-site` devient une entrée mince de ce moteur,
avec les mêmes routes, sessions et handlers de domaine. Les interfaces libres
ou amont gardent leurs notices et provenance.

### Décision de consolidation Aphrody Web — inventaire du 2026-09-29

L'inventaire généré par `@aphrody/workspace consolidation inventory` observe
le checkout propre Aphrody Web à `bbeb5ef4c497f7d27f546ad2cc15a250dcc93c83`
(1 653 chemins). Les noms Cargo et Bun extraits des seuls manifests de cette
carte sont consignés dans
`APHRODY-WEB-INVENTORY-2026-09-29.md`.
La cible comprend 22 crates Rust de produit, l'app BXC, quatre packages Bun
et le manifest workspace privé. Quatre autres manifests Cargo sont des
frontières distinctes (workspace, serveur Drive, scanner embarqué et Taffy
vendored) ; les traiter dans P0 selon leur propriétaire, licence et graphe.

La cible est **un seul workspace Aphrody, avec Rust comme propriétaire par
défaut de toute capacité portable ou native**. Le code Rust du navigateur,
DOM, réseau, exécution JS, CDP, extraction, index, rendu, crawl, service, X,
CLI et MCP converge dans des crates canoniques `crates/web/` et `crates/web/x/`.
Les crates Cargo peuvent rester séparées quand elles matérialisent une
frontière de sécurité, un backend moteur, une licence, un coût de compilation
ou une API publique distincte ; la déduplication porte sur l'implémentation
et les contrats communs, pas sur l'aplatissement arbitraire des manifests.

Bun/TypeScript reste une couche de compatibilité et d'intégration minimale :
façades publiques conservant les noms/export maps, adaptateurs pour les
consommateurs Bun/Tauri, scripts de build et code web réellement requis par
les interfaces. Aucun scraping, parsing, orchestration browser, stockage ou
client métier ne garde une deuxième implémentation TS lorsque son équivalent
Rust est intégré et qualifié. BXC devient une app/CLI mince sur l'API Rust ;
`@aphrody/agent-browser`, `@aphrody/bxc-test` et `@aphrody/x` deviennent des
adaptateurs temporaires ou restent uniquement si un parcours consommateur
prouvé l'exige. `@aphrody/m3-tokens` suit le propriétaire M3 et n'est pas
absorbé dans Web par simple proximité du workspace.

| Domaine | Propriétaire unifié visé | Dédoublonnage et compatibilité à prouver |
| --- | --- | --- |
| Web API/service/site | `aphrody-web` Rust ; bins serveur/site minces | Un routage, sessions et pipeline de crawl ; conserver routes, sorties, auth et erreurs publiques. |
| Browser/runtime | `aphrody-web` Rust avec backend interne sélectionné par workload | Un contrat de contexte/profil/cookies/réseau/CDP ; Obscura, Chromium et Lightpanda restent des backends seulement si chacun passe les mêmes fixtures utiles. Pas de réécriture Rust d'un upstream Zig/Chromium. |
| HTML/extraction/index | Bibliothèques Rust Web | Un parseur et modèle canonique par sortie ; corpus de fixtures pour extraction, Markdown, URL, SimHash et index avant suppression des doublons. |
| Rendu et automatisation | Rust Web + adaptateur hôte minimal | Séparer HTML/rendu serveur, WebView et rendu GPU ; préserver captures et comportement mesuré. |
| FFI/CLI/MCP | Une bibliothèque Rust propriétaire, un ABI borné, façades minces | Stabiliser ABI, schémas et noms legacy ; retirer bridge/subprocess uniquement après bascule de chaque consommateur et voie de rollback. |
| X | Crates Rust `aphrody-x` et algorithme, packages de compatibilité | Un client, modèle de cookies, stockage et classement ; préserver API/export maps en transition. |

Ordre obligatoire : (1) fermer P0 avec manifests et workspaces imbriqués,
consommateurs Cargo/Bun/AI/MCP, symboles ABI, schémas CLI/MCP, secrets/caches,
licences et dépendances natives ; (2) établir des fixtures/oracles historiques
et les profils browser sans exposer de cookies ; (3) intégrer chaque capacité
Rust en gardant source et shim ; (4) basculer consommateurs internes puis
publics et valider un clone propre, builds/release et rollback ; (5) dédupliquer
les moteurs/caches/APIs seulement selon preuve par workload ; (6) retirer les
shims datés et anciens owners après fenêtre de compatibilité documentée. La
copie ou le succès de compilation d'une crate ne ferme aucun de ces gates.

État d'exécution : l'extracteur Rust complet et son DOM Obscura requis sont
importés avec hashes et tests de la tranche portable dans
`aphrody-web-extract-import.json`.
Le bridge Rust est importé avec ses méthodes publiques, et sa conversion
Markdown HTTP directe appelle l'extracteur local ; le test HTTP local et les
gates de l'archive propre sont dans
`aphrody-web-bridge-import.json`.
L'index HNSW Rust de BXC est importé avec son format de persistance et ses
tests de rappel dans
`aphrody-web-index-import.json`.
`aphrody-memory` reste sur une recherche exacte et un fichier JSONL ; une
migration de format et un contrat de classement sont requis avant toute fusion
de ces deux surfaces.
Les crates `aphrody-web-chromium`, `obscura-net`, `aphrody-x` et
`aphrody-x-algorithm` sont aussi importées avec hashes et tests ciblés. Le
seul `aphrody-ffi` exporte désormais les 67 symboles C du catalogue Web v4,
les noms canoniques réseau et les alias de transition. Son chargeur Bun ouvre
la bibliothèque à la première utilisation et vérifie les ABI Aphrody et Web.
`aphrody-mcp` expose déjà l'extraction HTML via le Rust partagé ; son catalogue
Web restant délègue encore à un processus enfant. La couverture des symboles
ne ferme ni le corpus gold, ni la parité navigateur/réseau, ni le basculement
des consommateurs Bun/AI/MCP. Les deux autres chargeurs FFI Bun recensés dans
le workspace doivent converger vers la façade unique avant suppression des
anciens noms. Leur bascule et l'élimination des dépendances au checkout source
restent des critères de sortie de P5.

- [ ] Cartographier Obscura/JS, Chromium/CDP, V8 et JSC, leurs dépendances
  natives, fils d'exécution, allocateurs, contextes, stockage et features.
  Le manifest Web render signale déjà une contrainte de liaison V8 : reproduire
  cette contrainte dans la qualification avant de réunir les archives.
- [ ] Définir une API runtime commune : création/destruction de contexte,
  exécution, modules/imports, timers, promesses, limites mémoire/CPU, réseau,
  annulation, cookies et isolation. Fusionner les adaptateurs et registres.
- [ ] Choisir le moteur canonique à partir des workloads Bun/DOM/crawl/installés.
  Remplacer les moteurs redondants seulement après parité. Un besoin Chromium
  ne disparaît pas parce que JSC exécute du JavaScript ; les backends encore
  nécessaires restent des implémentations internes qualifiées du moteur unique.
- [ ] Fusionner les caches/répertoires/runtime-configs qui représentent la même
  ressource. Conserver la séparation des profils utilisateurs et des secrets.
- [ ] BXC reste consommateur transitoire optionnel ; son comportement est porté
  dans le Rust `aphrody-web`, puis tous ses clients utilisent `@aphrody/bun/web`.
  Une perte d'extraction, rendu, auth ou crawling interdit son retrait.
- [ ] Examiner les dépendances natives Oxc/N2B à même révision et mêmes features
  pour construire une seule copie compatible. Mesurer le code et les pages
  réellement chargées ; compter les noms de crates ne mesure pas la mémoire.
- [ ] Pour Bun, traiter séparément `Bun.build`, résolution/parser, minifier,
  `bun test`, formatter et lint. Toute greffe se fait par commit dans le
  [fork](../../reference/upstream-bun/APHRODY-FORK.md) et identifie les types, les tests upstream et le contrat N2B complet à conserver.
- [ ] Comparer l'agrégateur cdylib et une liaison au runtime Rust/JSC du fork.
  Choisir sur ABI, rebases upstream, coût mémoire et plateformes ; ne pas créer
  un second runtime JS embarqué uniquement pour satisfaire un nom de package.

Les instances privilégiées, navigateurs et workers AI qui exigent une isolation
restent supervisés avec l'API commune. « Un seul FFI » ne vaut pas permission
d'exécuter le kernel privilégié dans une application Bun ordinaire.

## 6. Matrice de provenance et migration des deux dépôts

| Provenance | Rust → `aphrody/crates` | Bun/TS → `aphrody/packages`, `apps` | Python → `aphrody-py` |
| --- | --- | --- | --- |
| Contracts, Native, Shell, Compat | Toutes les bibliothèques, N2B, schémas/générateurs et wrappers natifs | Bindings, plugins et outils existants | Scripts et outils présents, à inventorier |
| AI, Koharu, Discord | CLI/MCP/app-server, AI/manga, protocoles et extensions PyO3 | SDK, plugins, façades et outils | `py/aphrody` (not in repo), SDK Antigravity, entraînement, tous scripts autonomes |
| OS, UI, Web | Kernel/Files, rendu/M3, hôtes, moteur Web unifié | Apps web/desktop, M3/SVG, Drive, BXC transitoire | Automatisations et traitement d'assets |
| Infra | Git/SSH/VPN, contrôleur, maintenance, YOLO | `@aphrody/workspace`, OVH, audits et opérations | Outils de maintenance ; configuration reste Infra |
| IECODE, NIE | Moteurs métier, formats/forge, FFI et anciennes crates en absorption | `iecode-ffi`, packages NIE, plugin, vues et applications | `iepy`, `niepy`, projets IECODE, Python NIE/Blender |
| Bun, Oxc, Bevy, dépendances tierces | Sources épinglées sous `upstream/`, workspaces conservés | Sources nécessaires référencées à leur propriétaire upstream | Projets Python upstream épinglés, licence inchangée |

Chaque ligne est développée en correspondances fichier/package/crate. Un
ancien dépôt est retirable seulement quand chaque source et consommateur est
migré ou archivé avec preuve, y compris scripts cachés, sous-modules, CI,
fixtures, assets autorisés, fichiers hors Git et extensions non Python/TS/Rust.
Les fichiers ignorés ne sont pas automatiquement copiables ; secrets, caches,
modèles et bases restent dans les stockages prévus par leurs propriétaires.

**Rust.** Préserver `package.name`, imports, binaires, features et versions des
crates publiées à l'import. Résoudre collisions de noms, `links`, `[patch]`,
profils, toolchains, `cfg`, allocateurs et dépendances cycliques avant un
workspace commun. Garder des workspaces transitoires seulement avec une sortie
planifiée et documentée. Le crate métier fusionné et le FFI ont des features
par capacité ; `--all-features` ne remplace pas une matrice de combinaisons.

**Bun/TS.** Un catalogue, Bun épinglé canary/nightly qualifié, TS7 et Oxc.
Migrer `workspaces`, scripts, exports, aliases, tsconfig, `file:` et liens
inter-workspaces avec les lockfiles. Le nom GitHub `aphrody` ne renomme
pas `@aphrody`, `@nie` ou les packages publics. Déplacer tous les loaders
natifs vers la façade ; les anciens packages deviennent des réexports avant
leur dépréciation. Préserver les usages navigateur/WASM sans charger FFI au
travers d'un import de types ou d'un bundle navigateur.

**Workspace Rust + Bun.** Fusionner les manifests des sources propriétaires
dans les deux workspaces racine du même dépôt, résoudre les chemins relatifs
et conserver une correspondance package → crates/features/artefacts. Les
changements ABI, bindings, packages et apps consommateurs forment une même PR.
La CI calcule les consommateurs affectés dans les deux sens, exécute leurs
gates et produit les artefacts depuis le même SHA ; les changements aux
contrats, locks ou générateurs déclenchent la validation transversale requise.

**Python.** Inventorier aussi les `.py` sans pyproject, notebooks, modèles,
plugins, `requirements*`, `setup.py`, console scripts, extensions et ressources.
Réunir les packages dans uv sans casser les imports existants ; Python minimum,
ABI PyO3, wheels, dépendances CPU/CUDA et licences sont des gates distinctes.
Les environnements réellement incompatibles restent résolus sous
`environments/`, avec provenance et tests d'import, dans le même dépôt.
Les sources des extensions Rust sont uniquement dans `aphrody` ; la production
wheel/sdist inclut ou référence leur source épinglée de manière reproductible,
sans dépendre d'un `../aphrody` arbitraire sur le poste de l'utilisateur.

**Historique.** Importer les arbres à des préfixes explicites depuis les commits
sources. Conserver les historiques originaux accessibles et une table SHA
source → import → chemin. Une extraction par langage peut changer les hashes :
ne pas prétendre qu'elle conserve les SHAs de l'ancien dépôt. Aucun force-push
des historiques partagés. Les licences commerciales, FSL, GNU et notices
amont restent par sous-arbre ; choisir la visibilité avant l'import de source
privée. Une licence à la racine ne relicencie pas tous les composants.

## 7. GitHub → aphrody-labs et automatisation de livraison

Intégrer les [règles de transfert](../../reference/infra/GITHUB-OWNERSHIP.md) et
le [plan GitHub/OAuth/releases](../infra/GITHUB-AUTONOMY-PLAN.md).
Au contrôle API de cette passe, l'organisation expose cinq forks publics
(`tar`, `sed`, `grep`, `findutils`, `diffutils`) et Koharu privé. Les mentions
« organisation vide » des anciens plans sont des observations périmées.
Droits, quotas, rulesets et capacité Actions sont à vérifier avant exécution.

- [ ] G0 — Inventory GitHub et registres : noms/IDs, visibilité, droits réels,
  branches, HEADs, upstream, releases, issues/PR, secrets par **nom seulement**,   webhooks, règles, packages npm/PyPI/crates/GHCR et usages par CI/déploiement.
- [ ] G1 — Transférer d'abord le fork Bun, puis Oxc et les dépôts retenus,
  dans l'ordre du plan Infra. Vérifier absence de collision, mêmes SHAs et
  association upstream. Une fusion de sources n'est pas un transfert GitHub.
- [ ] G2 — Créer les nouveaux `aphrody` et `aphrody-py` après
  contrôle des noms et de la visibilité ; importer les sources par lots
  validés. Garder les anciens dépôts et chemins servant les consommateurs
  jusqu'au gate de retrait. Préserver les liens de redirection existants.
- [ ] G3 — Réconcilier `origin`, `.gitmodules` imbriqués, gitlinks, manifests,
  URL Cargo/Python/npm, workflow `uses:`, badges, Pages, releases, source-sync,
  déploiements et métadonnées de packages. Le scope npm `@aphrody` reste.
  Traiter les associations GHCR/Packages séparément des dépôts transférés.
- [ ] G4 — Branches `feature/`, `fix/`, `upstream/` et worktrees concurrents ;
  PR atomiques par lot, checks requis, tags protégés, checks `merge_group` si
  merge queue. Identité de nouveaux commits :
  `aphrody-code <contact@aphrody.com>`, style `type(scope): résumé`.
  Réutiliser `aphrody-git` et la CI existante comme contrôleur unique.
- [ ] G5 — Lint/format/typecheck/tests avant merge ; build du SHA fusionné ;
  push `main` → artefact immuable → canary → sondes → promotion ou rollback.
  Publication idempotente dans l'ordre Cargo → artefacts FFI → npm/wheels →
  apps, avec locks, provenance, signatures et manifeste de compatibilité.
- [ ] G6 — Versions distinctes code/ABI/canal, identifiants de release communs
  aux deux dépôts, URLs de téléchargement stables, auto-update CLI/GUI et
  politique de downgrade compatible avec les données. Une mise à jour de
  package ne peut pas sélectionner silencieusement une bibliothèque ABI différente.
  Rust et Bun sont corrélés par un même SHA de `aphrody` ; Python référence
  ce SHA et les versions d'extensions dans le manifeste de release commun.
- [ ] G7 — Reprendre les tâches OAuth GUI/site, sessions et MCP public du plan
  Infra : mêmes propriétaires auth, migrations et tests de scopes/expiration ;
  réexaminer routes et services actuels. Les secrets auparavant communiqués
  doivent être renouvelés avant activation. Aucun secret dans un package natif.
- [ ] G8 — Sync upstream canary/nightly automatique sur branche qualifiée,
  patches traçables, sous-modules épinglés, checks et promotion atomique.
  Garder les worktrees sales et les travaux concurrents intacts.

Un transfert GitHub conserve normalement l'association upstream et les
redirections Git, mais les packages et Pages ont des règles propres.
Ne jamais réutiliser l'ancienne URL qui doit rediriger. Vérifier chaque effet
sur le dépôt réellement transféré ; un plan ou une requête soumise n'est pas
la preuve de son exécution.

## 8. Séquence de réalisation et livrables

| Lot | Dépendances | Livrable obligatoire | Gate de sortie |
| --- | --- | --- | --- |
| P1 — Baseline | P0 | Corpus par capacité, résultats anciens, source closure, données restaurables, benchmarks contrôlés | Échecs existants enregistrés, sorties et scénarios de référence disponibles |
| P2 — Fondation et extraction docs | P0–P1 | Git local des cibles, manifestes source→SHA/path/status, `docs/` catégorisé, doublons exacts dédupliqués avec registre d'alias, liens corrigés et scripts migrés par catégories | Couverture exhaustive des docs/scripts inclus ; liens valides ; aucun original supprimé |
| P3 — Workspaces et extraction Rust/Bun | P2 | Un Cargo et un Bun workspace dans `aphrody`; crates sous `crates/<domain>/<name>`, apps/packages sous `apps/<domain>`/`packages/<domain>` ; Infra garde `@aphrody/workspace` | Graphe packages→crates/features/apps complet, imports/exports/licences résolus et provenance conservée |
| P4 — FFI/façade uniques | P3 | Chargeur, contrat, export map, agrégateur `aphrody-ffi`, `@aphrody/bun`, aliases transitoires | Tous symboles et consommateurs pilotes couverts, mémoire et async qualifiés |
| P5 — Web/runtime fusionné | P4 | `aphrody-web` complet, backends nécessaires, Oxc/N2B et builtin Bun raccordés | Parité Web/JS/crawl et gates du fork ; aucune ancienne façade nécessaire hors shims déclarés |
| P6 — Workspace Python et intégration Infra | P0–P5 | `aphrody-py` complet ; Infra/`@aphrody/workspace` orchestre les cibles, inventaires, checks et releases | Clones propres et builds hors de `src`, orchestration, artefacts et rollback attestés |

P0 étend les commandes existantes `bridge status`, `binaries`, inventaire de
workspaces, `automation-inventory`, `workspace-layout` et `cargo-boundaries`
dans `@aphrody/workspace`. Il découvre
les `.git` fichiers et répertoires, sous-modules, globs et workspaces exclus,
sans exécuter leurs scripts. Un scan AST/exports et un graphe Cargo complètent
la recherche textuelle ; une mesure de latence vient d'une exécution instrumentée,
jamais d'une regex. Produire les futurs `source-map.json`,
`bridge-inventory.json`, `compatibility-matrix.json`, `release-set.json` via
les sources Infra, sans second catalogue maintenu à la main à la racine.

Chaque lot désigne les propriétaires, publie ses révisions et ses preuves,
et met à jour README, AGENTS, plans, manifests, imports et commandes des
sources dépouillées. La coordination peut paralléliser des modules disjoints
après stabilisation des contrats ; un responsable tient les manifests/locks
partagés. Préserver les travaux concurrents relevés dans le snapshot.

## 9. Preuves de non-régression et mesures

La non-régression est une condition de sortie testable. On ne peut pas la
promettre à partir du présent document ou d'un typecheck de wrappers.

| Dimension | Mesure / gate |
| --- | --- |
| Couverture | C = capacités migrées avec preuve / capacités recensées : C = 1 pour clôture. Toute capacité absente d'un profil est déclarée, testée et n'était pas implicitement promise sur cette plateforme. |
| ABI/API | Corpus différentiel ancien/nouveau : sorties, erreurs, encodages, schémas, binaires et CLI args ; zéro divergence inexpliquée. Clients N et N-1 quand le contrat le promet. |
| Mémoire | Ownership, alignement, lifetime, concurrence, callbacks, fermeture, annulation et fuites. Ne pas appeler un double-free UB dans le processus de test principal ; handles validés ou harness isolé/sanitizers. |
| Sous-processus | Compteur dynamique par scénario ; zéro lancement pour les opérations internes migrées. Toute frontière externe restante possède une justification de protocole/isolation et sa propre latence mesurée. |
| Performance | Même corpus, SHA, features, machine et cache : p50/p95/p99, démarrage froid/chaud, CPU, RSS/PSS, pages natives, copies/octet, blocage event-loop, concurrence et temps de build. Aucun gain chiffré n'est acquis aujourd'hui. |
| Seuils | Fixer budgets par workload à P1. Garde proposée : aucune dégradation supérieure à 5 % du p95 et de la mémoire hors bruit statistique démontré ; pas de seuil absolu arbitraire commun au GPU, crawler et CLI. |
| Duplication | Une implémentation par capacité, un chargeur et une ABI Aphrody active par process/profil. Mesurer duplications des bibliothèques Oxc/JSC/V8 réellement liées ; nombre de DLL seul insuffisant. |
| Livraison | Clone propre, locks frozen, build et installation des artefacts, connexion utilisateur, jeux de données et rollback vérifiés. Un passage source ne vaut pas passage installé. |

Matrice initiale : Linux x64 GNU et Windows x64 MSVC ; ajouter Linux musl,
ARM64, macOS et WASM selon les artefacts déjà annoncés par les consommateurs.
Le navigateur/WASM exige son chemin explicite ; une cdylib native ne s'y charge
pas. Les builds GPU et sans GPU, CPU/CUDA et moteurs optionnels ont des gates
séparés. Pas d'ajout de plateformes « supportées » sans installation qualifiée.

Commandes futures : gates Rust format/check/clippy/test par crate, features
et cible supportée ; Bun typecheck TS7, oxlint/oxfmt et tests métier ; uv
sync avec lock, ruff, tests et wheels. Réutiliser les commandes réelles des
propriétaires à P0, les toolchains épinglées et `sccache`. Ajouter les tests
upstream Bun build/test/minifier et fixtures FFI lors des modifications natives.
Les erreurs préexistantes sont corrigées ou explicitement qualifiées ; les
régressions nouvelles ne sont pas transformées en skips pour livrer.

## 10. Engagements produit conservés

<a id="nie-convergence"></a>
### NIE, IECODE, Files et les applications

Le plan NIE actif, NIE → Aphrody (archivé dans IECODE `docs/history/aphrody-docs-2026-10-01/plans/nie/PLAN.md` (not in repo)), et sa
[matrice de capacités](https://github.com/aphrody-labs/iecode/blob/main/docs/nie/NIE-CAPABILITY-MAP.md) détaillent le chantier,
les propriétaires et les preuves requises. Ce plan racine fixe la destination
physique commune : tout Rust et Bun NIE rejoint `aphrody`; ses projets Python
rejoignent `aphrody-py`. Il n'y a pas de dépôt `aphrody-engine` distinct.
IECODE garde la propriété des formats, règles, données et workflows IEVR.
Les capacités génériques vont à leurs propriétaires Aphrody existants : OS
pour Files/RE/jobs, UI pour M3 et hôtes, Web pour le site public, AI pour CLI,
MCP et RAG, Infra pour déploiement et workspace Bun. Les contrats neutres
interprocessus seulement vont à Contracts. Aucun code n'est dupliqué entre
ces propriétaires.

Le plan NIE rapporte un transfert initial de 686 fichiers suivis depuis NIE
vers UI, Web et IECODE. C'est une étape de déplacement, pas une preuve de
parité ni d'activation. `apps/nie-web` (not in repo) reste hors workspace Bun actif ; la
feature de site IEVR ne compile pas sans les données de jeu nommées dans le
plan ; l'état actuel des packages et des données manquantes doit être relu
avant chaque lot. Ne pas générer de JSON factice pour faire passer le build.
Restaurer les données indispensables depuis leurs sources autorisées avec
provenance et hash, et garder les bases/sauvegardes hors Git.

Les gates NIE font partie des lots P0–P7 ci-dessus et ne se ferment qu'avec
leurs preuves dans le dépôt propriétaire :

- [ ] Réconcilier le manifeste des 686 fichiers avec les HEADs et fichiers
  suivis actuels. Inventorier aussi scripts, routes, bins, tests, documents,
  `include_str!`, workspaces et sources Python. Fixer une destination pour
  chaque fichier et un owner pour chaque consommateur.
- [ ] Préserver la licence commerciale des crates NIE et vérifier les notices
  amont et les droits des fixtures avant publication ou transfert de sous-arbres.
  L'ancien staging `@aphrody/nie`, qui déclarait MIT sans grant établi, est
  retiré du workspace; toute future binding doit être qualifiée à la source.
- [ ] IECODE absorbe les capacités IEVR du format vers les bindings : formats,
  VFS/data/save, règles/Lua/runtime, forge, FFI/Wasm. Comparer les API et
  consommateurs avec les crates IECODE existantes ; préserver les aliases
  jusqu'à la migration effective. Python `niepy` reste un outil IECODE à
  inventorier ; ses sources vont dans `aphrody-py` et ses extensions Rust
  dans `aphrody`.
- [ ] Rejouer la forge G4–G6 sur les entrées réelles et hachées : frontières
  d'instructions, VEX.256 `vpaddw`, candidat Cross, fin des lectures de
  référence, provenance et égalité binaire indépendante.
- [ ] Prouver les états Lua et les parcours natifs/WASM pour les mêmes entrées
  et instants. Restaurer les 38 écrans de référence, les données/actions
  nommées dans `nie/PLAN.md`, focus et scroll ; exiger les fixtures
  déterministes, géométrie à ≤1 px en 1920×1080 et SSIM ≥0,99.
- [ ] Qualifier clips→poses GLB, morphs, skinning, vêtements, authoring,
  undo/redo et aller-retour GLB/VRM avec parité CPU/GPU après réimport.
  Reconstruire le module Lua Wasm et readiness ; évaluer les crates rendu
  et Bevy avant d'en archiver les références.
- [ ] Intégrer les vues utiles d'Inacord dans l'unique `app-ui` M3, et les
  handlers IEVR dans `aphrody-site`. Comparer les routes `/api/v1`, `/f`,
  `/b`, assets, modèle, downloads, updater et SSE (méthodes, corps, statuts,
  auth, cache/ETag, Range et redirections) avant la bascule.
- [ ] Migrer les commandes NIE vers le CLI AI `aphrody`, les 19 outils vers
  l'unique `aphrody-mcp`, le RAG vers `aphrody-rag`, avec annulation et
  erreurs réelles. Ne retirer aucun relais ou service avant migration du
  dernier client, compatibilité installée et rollback exercé.
- [ ] Migrer les données, sauvegardes et schémas avec hashes et reprise
  vérifiable. Une copie de code ou un build ne suffit pas pour retirer NIE.

L'[archive du plan racine précédent](../../operations/workspace/HISTORY.md)
conserve les autres engagements produit déjà détaillés. Les scénarios et
gates propriétaires y restent maintenus jusqu'à leur import complet dans les
deux dépôts cibles.

<a id="m3-repository-decision"></a>
### Dépôt du framework M3

**Décision : M3 ne devient pas un dépôt indépendant.** Ses crates Rust,
packages Bun et applications rejoignent ensemble le monorepo `aphrody`, dans
les workspaces Cargo/Bun communs. Les packages publiables et les frontières
API restent distincts (`@aphrody/m3`, `@aphrody/m3-theme`, primitives, forms,
icons, adapters et crates M3) ; la fusion porte sur la source et les contrats,
pas sur un paquet npm géant.

Les plans M3 dans UI décrivent déjà un contrat de tokens Rust commun aux
adaptateurs React/Tailwind et Lit, une façade `@aphrody/bun` liée aux tokens,
un framework Bun qui bâtit les applications Tauri et web, et des packages
lockstep. Les manifests consultés confirment que `@aphrody/m3` dépend de
`@aphrody/bun`, que la façade Rust consomme `aphrody-m3-tokens` et que
`app-ui` utilise ces packages par workspace. Cette chaîne bénéficierait d'un
même changement atomique de tokens → FFI → package → app ; aucune preuve locale
ne justifie un dépôt M3 autonome. Les deux familles de rendu gardent chacune
leur adaptation au contrat M3 ; unifier les versions de tokens ne signifie pas
fusionner Lit et React.

Les packages conservent leurs noms npm et leurs contrats installables. La
version lockstep déclarée par le plan M3 reste le mécanisme de publication
tant que ses gates sont satisfaites. À la migration, corriger les métadonnées
`repository`, `homepage`, chemins d'exemple et provenance actuellement
réparties entre `aphrody-ui` et `material-web`. Base UI et Tailwind gardent
leurs patches et historiques upstream référencés ; ce ne sont pas des packages
M3 à réécrire ni à publier sous des identités Aphrody. Le plan de référence
est [M3-PLAN.md](../../../m3/docs/plans/design/M3-PLAN.md), avec son
[contrat multi-hôtes](../../../m3/docs/plans/design/M3-MULTI-HOST-PLAN.md) et son
[schéma framework](../../../m3/docs/architecture/design/M3-FRAMEWORK.md).

### Décisions consolidées qui restaient implicites dans le plan NIE

Ces choix ferment les options d'architecture du
plan NIE (IECODE `docs/history/aphrody-docs-2026-10-01/plans/nie/PLAN.md` (not in repo)). Les cases P0–P4 restent des preuves d'exécution ;
une case ouverte ne rouvre pas une décision ci-dessous.

- **Dépôts et propriété :** IECODE garde le domaine IEVR ; ses sources Rust
  et Bun vont à `aphrody`, Python à `aphrody-py`. Aucun dépôt
  `aphrody-engine` ni sous-dépôt IEVR autonome. OS possède Files/RE/jobs,
  UI possède M3 et les hôtes, Web le serveur public, AI le CLI/MCP/RAG,
  Infra les services et déploiements. Contracts ne reçoit que les messages
  neutres interprocessus. La même implémentation métier ne vit pas en double.
- **FFI et WASM :** `aphrody-ffi` est l'agrégateur Aphrody ; les fonctions
  `nie-ffi` restent une API d'adaptation IEVR compilée dans ce pont commun,
  pas une seconde bibliothèque Aphrody. L'artefact Emscripten reste ciblé
  et chargé séparément, à la demande, depuis les mêmes sources/domain crates ;
  il n'est pas ajouté au chargement natif Bun.
- **UI et hôte 3D :** Tauri est l'unique hôte desktop Aphrody courant. Les
  modes utiles d'Inacord, Explorer, éditeur et jeu rejoignent l'app M3.
  Pas de binaire NIE ni hôte autonome winit/Bevy par défaut. Un hôte GPU
  distinct n'est admis que si un parcours IEVR mesuré échoue dans Tauri/web,
  et seulement comme mode de l'app Aphrody avec ses gates d'installation,
  accessibilité et cycle de vie. Le renderer Bevy n'est pas une dépendance
  obligatoire : IECODE livre les scènes/actions, UI choisit et possède le
  renderer générique qualifié.
- **Fichiers du jeu :** le frontend ne lit pas les routes brutes `/f` et `/b`.
  Il passe par l'API Files typée et autorisée du propriétaire OS/Web ; le
  transport conserve Range, ETag et streaming borné requis pour les gros
  assets. Le serveur garde la compatibilité des anciennes URLs côté routeur
  pendant la migration, puis les retire après preuve sur clients. Pas de
  bundle VFS complet public pour remplacer cette API.
- **Données et licences :** aucune fixture ou table de jeu factice. Les
  données restaurées restent dans les stockages contrôlés avec provenance,
  hash et droits ; les dépôts ne contiennent que les fixtures redistribuables.
  Préserver la licence commerciale NIE et les notices par sous-arbre. Aucun
  code/package concerné ne part sous MIT/Apache avant résolution documentée
  de ses droits ; en cas d'incertitude, l'artefact n'est pas publié.
- **Services et outils :** `aphrody-site` est l'unique origine publique,
  `aphrody-mcp` l'unique endpoint MCP publié. Les routes métier, les 19 outils
  `nie.*` et les commandes gardent des adaptateurs/noms de compatibilité
  jusqu'à preuve d'usage migré ; ce sont des entrées vers les propriétaires
  internes, pas des services d'exécution séparés à long terme.
- **Dépôts/lockfiles :** les crates et packages IEVR/M3 sont membres des
  workspaces Cargo/Bun de `aphrody` et leurs changements intégrés sont atomiques.
  Les forks Bun, Oxc, Base UI et Tailwind conservent leur provenance et leurs
  workspaces amont séparés, épinglés dans la fermeture de sources. Un seul
  dépôt Aphrody n'impose pas de fondre les outils de build de ces upstreams.

- Files/Drive : migration des bibliothèques/UUID, VFS, index, fournisseurs,
  sync, événements/SSE, sidecars, jobs, reprise, aperçus, accès et sauvegardes.
  Réutiliser [l'audit Files](../../research/workspace/FILE-SURFACE-AUDIT.md) sans présumer ses constats actuels.
- NIE/IECODE : forge G4–G6, golden bytes, formats et saves, écrans/captures,
  parité native/headless/WASM et persistance Inacord. La
  [matrice NIE](https://github.com/aphrody-labs/iecode/blob/main/docs/nie/NIE-CAPABILITY-MAP.md) et le plan NIE
  (IECODE `docs/history/aphrody-docs-2026-10-01/plans/nie/PLAN.md` (not in repo))
  guident l'absorption ; Rust et Bun rejoignent `aphrody`, Python `aphrody-py`.
- UI : M3, Tauri courant, qualification de l'hôte natif selon le
  [plan multi-hôtes](../../../m3/docs/plans/design/M3-MULTI-HOST-PLAN.md), desktop,
  web/mobile et accessibilité. La fusion Rust ne supprime pas un parcours GUI.
- AI : CLI, MCP, app-server, RAG, workers/modèles/OCR, capacités Shell/OS et
  parcours Koharu. Respecter les frontières de sessions, annulation et stockage.

<a id="bun-adapter-handoffs"></a>
### Adaptateur de code Bun et entraînement

Conserver D3T du [plan AI](../ai/PLAN.md) et son
[runbook](../../reference/ai/training.md) : données et fork épinglés, modèle de
base officiel, QLoRA qualifié, export et comparaison. Python migre dans
`aphrody-py`, l'intégration Rust et Bun ensemble dans `aphrody`. Les anciennes
estimations de mémoire GPU ne prouvent pas la capacité de l'hôte courant.

### Import documentaire des dépôts upstream — 2026-10-01

Les références Git de `tools/config/upstream-sources.json` sont maintenant incluses
dans (removed import receipt) sous `upstream-<id>`, avec HEAD observé,
état du checkout, hash par fichier et note de licence. Les docs retenues sont
copiées directement sous `docs/<catégorie>/upstream-<id>/`; les doublons SHA
exacts pointent vers une seule copie. La liste est dans
`IMPORTED-DOCS-INDEX.md`, les hashes et
destinations dans `source-map.json`, et le
bilan de lien dans `document-import.json`.

- 18 checkouts Git inventoriés; 11 042 entrées documentaires candidates,
  dont la documentation reStructuredText du noyau WSL2.
- 10 653 fichiers copiés; 175 alias exacts et 3 collisions conservées sous
  `_source/`. La vérification SHA-256 a comparé source et cible pour les
  10 653 fichiers : aucun écart.
- 1 414 liens Markdown locaux remappés; 863 références locales restent à
  examiner (code, assets, fichiers absents ou syntaxe non résolue). L'import
  n'affirme donc pas que tous les liens sont valides.
- 214 entrées ne sont pas copiées : docs Enterprise LiteLLM (licence séparée),
  openfox (licence non vérifiée), fichiers absents du checkout sparse Tauri,
  assets de plus de 10 MiB et docs `vendor/third_party` (not in repo) (historical or proposed upstream checkout; not a current source owner). Chaque motif reste
  visible dans la carte source.
- Les checkouts dans `.cache/upstream` (not in repo) (generated or machine-local artifact; presence depends on the build host) restent intacts; le snapshot mcp-server-tauri
  indique des changements de travail préexistants. L'import n'a modifié que
  les documents Aphrody et la carte/report générés.

Politique d'import (décision du 2026-10-01, appliquée dans `consolidation.ts`) :
seuls les documents texte (`.md`, `.mdx`, `.rst`, `.adoc`, `.txt`) sont gardés.
Médias, notebooks, code, lockfiles et fichiers env sont exclus, ainsi que les
fichiers d'instructions d'agents amont (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
dossiers `.claude`/`.cursor`/`.codex`…), que les agents chargeraient comme
règles, et l'arbre `upstream-WSL2-Linux-Kernel` (WSL attend le déploiement
d'Aphrody). Résultat : 4 168 nouveaux fichiers (32 Mo au lieu de 444 Mo),
6 485 copies non suivies et 101 fichiers déjà suivis retirés, 6 585 entrées
de la carte source requalifiées `excluded-by-upstream-docs-import-policy`.

La passe a utilisé `consolidation inventory --upstreams-only true`, qui fusionne
les racines upstream dans la carte existante, puis
`consolidation docs-import --upstreams-only true`. Le map Python n'est pas
réécrit dans ce mode. Le contrôle de liens global et la qualification des
références non résolues restent ouverts.

## 11. Clôture du programme

- [ ] Chaque source Rust, Bun/TS et Python possède une destination vérifiée,
  incluant extensions, sources upstream et fichiers hors catalogue.
- [ ] Un FFI Aphrody et `@aphrody/bun` servent tous les consommateurs recensés.
- [ ] Web/runtime est complet selon sa matrice, ses doublons ont été retirés,
  tous les backends conservés ont une capacité justifiée et testée.
- [ ] `aphrody` contient les workspaces Cargo et Bun, leurs crates, packages
  et apps ; la CI suit les dépendances natives à travers les deux graphes.
- [ ] Les deux dépôts se construisent/packagent sans checkout voisin implicite,
  avec contrats et release-set corrélés ; historiques et licences accessibles.
- [ ] GitHub, registres, CI, auto-release, téléchargement, installation,
  auto-update, services et rollback ont leurs preuves sur la cible organisation.
- [ ] Les scénarios produit de section 10 et les métriques de section 9 passent.
- [ ] Tous les anciens chemins, wrappers et gitlinks sont retirés ou deviennent
  des archives justifiées ; aucun travail concurrent n'a été perdu.

## Références

- [Bun FFI — documentation en ligne](https://bun.com/docs/runtime/ffi), à comparer au fork distribué.
- [Bun Node-API](https://bun.com/docs/runtime/node-api).
- [Cargo workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html).
- [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/).
- [Transfert GitHub](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository).
- [Rust FFI](https://doc.rust-lang.org/nomicon/ffi.html).
