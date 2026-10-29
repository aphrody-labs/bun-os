> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Cœur Yolo, modules Bun et fournisseurs natifs

> Current authority: the [root plan](../../../../PLAN.md) defines one Bun OS
> product, including AI, UI, Infra, Workspace and imported application domains.
> The dated decisions below preserve historical evidence; their former
> Yolo/Aphrody product split is not current ownership doctrine. Source migration
> and host-specific deployment qualification must still be demonstrated.

> Path reconciliation (2026-10-07): `vendor/obscura` (not in repo) → `crates/web/obscura`. Original dated observations below retain their historical scope.

Décision du 2026-10-04, issue de l’examen des manifestes, points d’entrée et
consommateurs Yolo/Aphrody. **Yolo absorbe les contrats communs ; les moteurs
restent des fournisseurs optionnels précompilés, exposés par quelques modules
Bun. Aphrody conserve le produit.** Cette décision précise D5/D6 et remplace le
comptage historique de D15 dans [DECISIONS](../../decisions/runtime/DECISIONS.md).

Le recensement exhaustif couvre les
117 manifestes directement sous `crates/`, les huit sous-modules `vendor/` et
deux sous-modules hors moteurs. Les 113 imports se répartissent en 54 desktop
et 59 compilateur. Ce comptage décrit les sources, pas une résolution Cargo
transitive ni la taille d’un binaire. Les modifications concurrentes des
manifestes et du navigateur sont identifiées dans le recensement.

Mise en œuvre du 2026-10-05 : les racines Cargo par défaut sont réduites aux deux
crates cœur ; les recettes, la CI et le format Rust distinguent le cœur des
fournisseurs. Le recensement du 4 octobre reste une preuve de l’état précédent.
La qualification et les limites courantes sont dans
le reçu d’implémentation.

## Précision propriétaire : absorption dans le fork Bun

Le 2026-10-05, le propriétaire confirme la cible **fork Bun orienté desktop**,
avec les vrais moteurs V8/Tauri/Obscura/Turbopack et uv absorbés nativement.
Le cœur Bun complet reste dans le [fork `aphrody-labs/bun`](../../reference/upstream-bun/APHRODY-FORK.md) ; les deux crates `yolo-*` minimales
désignent le socle commun de qualification et d’interopérabilité, pas tout le
runtime final. Les modules organisent le code et l’initialisation à la demande
dans le processus. Un preload ou un wrapper qui invoque les CLI ne réalise pas
cette absorption.

Le tableau ci-dessous décrit les propriétaires et la séparation des builds.
L’hôte desktop supervisé et l’acquisition actuelle par CLI sont des étapes
existantes, pas la cible d’intégration native. Le raccordement doit réutiliser les
bibliothèques réelles, leurs boucles d’événements et leurs garanties de panic/ABI.
La parité de démarrage avec Bun nécessite une mesure appariée des mêmes parcours,
puis des mesures du premier usage desktop/browser ; elle n’est pas acquise.

La précision suivante du même jour conserve JSC/WebKit et la compatibilité V8.
Tauri reste un plugin desktop et partage à terme le fournisseur WebView de Bun ;
Obscura porte le headless. Depuis la décision 21 (D28 pour la coupe des plugins), le seul
runtime desktop est `tauri-runtime-cef` (Chromium embarqué) ; wry, tao et les WebViews système sont retirés. Un raccord réel doit
partager ce fournisseur dans le profil embarqué, sans déclarer cette
capacité sur la seule base d’un flag. La cible inclut React/Next 16 et une
application desktop empaquetée en un fichier Bun ; aucune parité Chromium ni
amélioration du compilateur n’est déduite de cet arbitrage.

## Arbitrage par ensemble

| Ensemble constaté                                                           | Destination retenue                                                                                | Limite publique                                                                      |
| :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| `yolo-core`, `yolo-runtime` : 2 crates propres                              | Cœur natif minimal partagé                                                                         | Primitives communes et ABI C versionnée ; `runtime:system` et `runtime:process`      |
| `yolo-desktop` : fusionné dans `aphrody-app` (`crates/ui/app`)              | Hôte desktop optionnel : `aphrody-app --host-info` / `--runtime-host` (protocole `yolo.desktop/1`) | `runtime:desktop`, avec supervision et boucle UI native                              |
| `yolo-pyo3` : 1 crate propre                                                | Adaptateur Python optionnel du même cœur                                                           | `_yolo_native` ; l’IA/ML reste dans Aphrody Python                                   |
| Tauri (runtime CEF) et outillage : 33 crates, dont 15 plugins Tauri         | Fournisseur desktop et ses outils de fabrication                                                   | Sélection de plugins par application et permissions Tauri ; aucune API Bun par crate |
| Next/Turbo/Turbopack                                                        | Retiré le 2026-10-05 : aucun consommateur, `next` vient de npm                                     | Historique Git                                                                       |
| Obscura et son V8, dans `crates/web/obscura`                                | Fournisseur navigateur optionnel                                                                   | `runtime:browser` ; conserver le graphe de build du moteur                           |
| [Fork Bun `aphrody-labs/bun`](../../reference/upstream-bun/APHRODY-FORK.md) | Hôte JavaScript et APIs natives existantes                                                         | Commit dans le fork seulement pour un besoin d’intégration VM ou un gain mesuré      |

Les quatre modules `runtime:*` figurent déjà dans le
[preload](../../../../packages/runtime-sdk/src/preload.ts). Desktop et browser ont du code en
cours ; leur présence ne qualifie pas R3/R4 ni une distribution installable.

## Ce qui entre dans le cœur

Le cœur Rust conserve les primitives effectivement partagées entre les hôtes,
le contrat ABI, les handles, la propriété des buffers, les erreurs, l’annulation
et la supervision. Les contrôles de permissions et d’origine doivent rester
natifs aux frontières privilégiées ; les politiques produit restent Aphrody.
Les grandes données utilisent les contrats de buffers dédiés. L’API actuelle
effectue aussi des copies : aucune garantie générale « zéro copie » n’est déduite.

Le cœur Bun `@aphrody/yolo-core` est le propriétaire des commandes et de
l’orchestration. Il réutilise les APIs Bun pour fichiers, HTTP, cryptographie et
clients natifs déjà couverts. Les règles de catalogue, déploiement et gestionnaire
de paquets restent des modules du CLI/SDK ; elles ne deviennent pas des builtins
de la VM. L’acquisition Bun/uv/Cargo utilise les binaires globaux et le wrapper
Cargo sérialisé déjà présents dans [pm](../../../../packages/yolo-core/src/pm/index.ts).

Une fonction ne rejoint le cœur natif que si son contrat est commun à plusieurs
consommateurs, si elle y apporte une garantie native utile, et si ses dépendances
restent compatibles avec le profil serveur léger. Une similitude de nom ne
suffit pas : `turbo-tasks` et `turbo-tasks-fs` restent internes au compilateur.

## Desktop : conserver le fournisseur, sélectionner les extensions

Tauri et son runtime CEF restent ensemble comme plugin optionnel. Le
[SDK desktop](../../../../packages/runtime-sdk/src/desktop.ts) supervise actuellement un hôte
précompilé séparé ; ce chemin transitoire n’est pas l’absorption demandée.
L’intégration dans Bun doit respecter la boucle UI principale et ses règles de thread.
La source générique et les artefacts moteur appartiennent à Yolo ; les fenêtres,
workflows, capacités accordées et l’UI canonique appartiennent à Aphrody.

Seuls les 15 `tauri-plugin-*` enregistrés par l’app desktop unique (`crates/ui/app`) sont importés
(décision du 2026-10-09) ; les plugins mobiles et inutilisés (http, shell, sql, stronghold, nfc…) sont
supprimés. `fs/process/os` servent les appels WebView soumis aux permissions Tauri ; HTTP, shell et
SQL côté serveur passent par Bun et les services Yolo existants.

`tauri-build`, macros, codegen, bundler, CLI, signature, générateurs de schémas et
create-tauri-app sont des outils de production des artefacts. `acl-tests`,
`restart`, les exemples et le driver servent la qualification. Ils restent dans
la provenance importée, hors bibliothèque d’exécution minimale.
`tauri-runtime-cef` est un fournisseur alternatif explicite, hors profil par
défaut : son graphe CEF/GTK4 n’est pas requis par le choix Obscura.

## Compilateur

Le fork vendored Next/Turbo/Turbopack (59 crates) a été retiré le 2026-10-05 : aucun crate ni paquet ne le
consommait ; `next` vient de npm et la compilation passe par `Bun.build`.

## Employer le bon mécanisme Bun

| Besoin                                 | Mécanisme retenu                                     | Preuve ou condition                                                                                          |
| :------------------------------------- | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| Imports `runtime:*` à l’exécution      | `Bun.plugin()` et modules virtuels                   | [Preload existant](../../../../packages/runtime-sdk/src/preload.ts)                                          |
| Résolution de ces imports au build     | Plugin `Bun.build`                                   | [Adaptateur existant](../../../../packages/runtime-sdk/src/bundler.ts) ; l’artefact natif reste à distribuer |
| Transformations natives du code source | Addon N-API `onBeforeParse`, si le besoin correspond | [Contrat Bun épinglé](https://github.com/aphrody-labs/bun/blob/main/docs/bundler/plugins.mdx) ; respecter les threads de parsing   |
| Service natif partagé Rust/Bun/Python  | C ABI versionnée, `bun:ffi` côté Bun                 | [Contrat Yolo](../runtime-native/RUNTIME-ABI.md), ownership et arrêt explicites                              |
| Accès interne à la VM                  | Patch du fork Bun, build et tests propres            | Registre des builtins                                                                                        |

`Bun.plugin()` ne commute pas JSC vers V8 et ne remplace pas globalement
`Bun.file`. Obscura possède son propre backend V8 ; R5/R6 qualifient désormais
les contrats JSC/V8 et leur coexistence, sans retrait général de V8.
Le GOAL de moteur commutable dans Bun reste un chantier
distinct à mener dans le fork Bun, avec qualification propre, hors prérequis du cœur minimal.
Les déclarations `bun-types/tauri.d.ts` ne prouvent pas un builtin Tauri exécuté.

## Autres fournisseurs et propriétaires

| Ensemble                                       | Décision                                                                                                                                                                                                                                       |
| :--------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VFS / IEVR                                     | Contrat générique de montage, handles, buffers et permissions dans Yolo ; fournisseur IEVR chez son propriétaire IECODE. Réutiliser le trait VFS d’Aphrody avant d’en inventer un. `runtime:vfs` est une surface proposée, absente du preload. |
| WebGPU / rendu                                 | Fournisseur optionnel ; contrats partagés seulement si nécessaires aux consommateurs. Aphrody garde le rendu produit. `runtime:gpu` n’est ni exposé ni qualifié aujourd’hui.                                                                   |
| IA, RAG, entraînement                          | Aphrody et Aphrody Python conservent les comportements produit, modèles et données ; les transports génériques peuvent être partagés. Le PyO3 Yolo actuel expose du calcul générique, pas un moteur ML.                                        |
| `plugins/` et `packages/plugins` (not in repo) | Marketplace et génération de plugins agents ; distincts des modules et addons Bun.                                                                                                                                                             |
| `design/aphrody-m3`                            | Sources et ressources de design ; UI canonique dans Aphrody. Aucun rôle dans le cœur natif.                                                                                                                                                    |

## Déduplication Yolo / Aphrody

Directive complémentaire du 2026-10-05 : retirer les doublons d’exécution,
partager les allocations transférables et les quotas chez le propriétaire du
pool. Une interface supplémentaire du même pool ne doit ni recharger un moteur
ni recréer un budget de workers. Les ressources immuables peuvent être communes ;
les heaps JSC/V8 et les contextes ayant des droits différents ne deviennent pas
interchangeables. Le partage de pages de bibliothèque par l’OS ne se mesure pas
en additionnant simplement les RSS : distinguer mémoire privée et proportionnelle.

La première correction du compilateur vise ce cas précis : Turbopack partageait
son état de workers par répertoire/point d’entrée, mais chaque interface recréait
ses sémaphores. Les quotas doivent appartenir à cet état unique ; une demande
de limite incompatible est refusée explicitement. Les builds et mesures de
l’addon complet restent nécessaires pour qualifier l’effet applicatif.

Les deux workspaces ont encore des graphes Obscura : dépendances Rust locales
dans Aphrody et `crates/web/obscura` dans Yolo. Les fichiers du moteur JS comparés ont
des hashes différents (voir recensement). Tauri suit aussi deux lignes : imports
générés préfixés dans Yolo, registry et patches produit dans Aphrody.

La cible est un seul producteur moteur Yolo, consommé au travers du contrat
qualifié. Il faut inventorier et réconcilier les patches, qualifier R3/R4,
migrer un consommateur réel avec ses permissions et son arrêt, puis retirer sa
dépendance directe. Le SDK est déjà consommé par `agent-browser` pour la
supervision ; les consommateurs Rust Web et l’application UI ne sont pas tous
migrés. Le pilote desktop ne couvre pas encore tous leurs plugins.

La matérialisation `vendor` → `crates/` est en revanche définie par
[VENDORING](../../guides/workspace/VENDORING.md). Les 113 imports gardent pins, notices et identités
compatibles. Leur suppression ou leur fusion physique dans le fork Bun n’est
pas nécessaire pour adopter ce découpage.

## Mise en œuvre et critères de fermeture

1. **Appliqué le 2026-10-05 :** `default-members` contient uniquement les deux
   crates cœur, contre 48 racines précédemment. Les 117 membres sont conservés
   avec des sélections explicites desktop, browser, Python, compiler et upstream.
   Les ajouts concurrents de dépendances browser restent préservés.
2. Qualifier les fournisseurs desktop/browser en cours : artefact épinglé,
   capacités détectées, erreurs et refus de droits, annulation et arrêt,
   installation et consommateur réel. Builds lourds par la fabrique sérialisée.
3. Réconcilier les patches et migrer les consommateurs Aphrody séparément ;
   retirer une ancienne dépendance seulement après passage de ses gates.
4. Qualifier l’addon compilateur existant sous Bun, puis exposer le backend
   optionnel. Comparer des builds froids/chauds avant toute absorption dans Bun.
5. Définir les contrats VFS/GPU à partir des propriétaires existants ; garder
   les données, cookies, bases et poids dans leurs magasins protégés.

Validation de cette décision : couverture exacte du recensement, hashes des
manifestes, correspondance `vendor.lock`/gitlinks, liens et gates documentaires.
Aucun build moteur, migration de sources ou gain de performance n’est affirmé.
