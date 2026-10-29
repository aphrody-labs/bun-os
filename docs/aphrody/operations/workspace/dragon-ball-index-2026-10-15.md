> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Index Dragon Ball et complétude Shenron — 2026-10-15

## Demande et propriétaires

Enrichir `aphrody web dragon-ball index` avec les exports du catalogue Shenron,
puis compléter les 110 tomes manquants et les lacunes du wiki. Le produit
Aphrody conserve l'intégration ; les sources Rust Web transférées restent dans
[le fork Bun](https://github.com/aphrody-labs/bun/tree/2b27e9d8fb40329245cd18f35bfb7080cea1a8b9/packages/web/rust).
Les données éditoriales et lecteurs sont
administrés par Shenron et ses writers existants.

La commande d'indexation accepte les catalogues publics locaux par l'option
répétable `--catalogue` (`--catalog`). Les exports connus sont également lus dans
le dossier de campagne. Un catalogue explicite peut initialiser un nouveau
dossier privé. Chaque tome, chapitre, publication, épisode, article, statistique
Jump et asset devient consultable avec ses métadonnées et sa provenance.
Les corps JSONL conservent aussi langue, catégorie, auteurs, champs structurés
et références médias. Les pages du catalogue CDN restent locales ; leur SHA-256,
révision, dénombrement et unicité sont vérifiés avant l'écriture des documents.

La chaîne réutilise `aphrody-command`, `aphrody-web-crawl`,
`aphrody-web-extract`, le DOM du fork et `aphrody-rag`. Aucun moteur,
dépendance, corpus ou média n'est copié dans Aphrody. Le profil `shenron`
reste isolé. Les lecteurs, OCR, arbitrages canoniques et écritures éditoriales
ne sont pas activés par une indexation hors ligne.

## Ressources du contexte

La demande suivante autorise l'utilisation simultanée des CPU et de la mémoire.
L'inventaire local relève 12 vCPU et 45 Gio de RAM, dont environ 25 Gio
disponibles. L'attente disque reste élevée ; le volume de travail est à 98 %.
`APHRODY_CARGO_JOBS=auto` sélectionne désormais les CPU disponibles dans le
wrapper existant, en conservant ses verrous et le cache partagé. Les valeurs
numériques et le comportement par défaut conservent leur contrat précédent.
Le test Web ciblé a été relancé avec 12 jobs, en réutilisant ses artefacts.
Les tests du wrapper utilisent un répertoire temporaire en RAM. Le préchargement
en 12 lectures parallèles a également relu 4 178 manifestes Cargo, soit
10 139 180 octets, sans erreur ; aucune accélération comparative n'est revendiquée.
Aucune suppression de stores, aucun déplacement de cache partagé ou arrêt de
build concurrent n'a été effectué.

## Index du catalogue Rust Bun — 2026-10-15

Le catalogue local des crates Bun a aussi été indexé dans le profil isolé
`aphrody`, sans le mélanger au profil DBFR :
`/home/ubuntu/.aphrody/workspaces/aphrody/bun-graph/rust-crate-catalog.json`.
La source est épinglée à `aphrody-labs/bun` révision
`1988e4bae7b374810cacda67d52dfd08e26ea6b7` et à Bun 1.4.4 (`dfde053a`).
L'index rapproche 237/237 manifestes Cargo de 129 snapshots de domaines ;
1 032 artefacts exportés ont passé les vérifications de taille et SHA-256.
L'index Aphrody a ajouté 1 273 fichiers, produit 388 documents, 2 245 chunks,
1 292 nœuds et 2 173 arêtes, sans erreur. Une requête RAG retrouve la fiche
de synthèse du catalogue.

Cette indexation rend le catalogue des crates consultable, mais ne complète pas
l'index Dragon Ball lui-même et ne qualifie pas les 237 crates en build ou test.
Le producteur signale une couverture de fichiers incomplète : 13 692 fichiers
parsés nativement, 7 543 non résolus, 4 273 disponibles seulement comme
métadonnées, 149 erreurs de parse, 11 collisions d'identifiants,
168 468 appels non résolus et 99 exports tronqués. La base SQLite de graphe et
les artefacts restent privés dans le home Aphrody. Il n'y a pas eu de nouveau
commit Bun dans ce lot : le checkout Bun avait des changements concurrents
étrangers à cette demande.

## Index wiki public — 2026-10-15

Une capture paginée en lecture seule de l'API publique
`/api/public/wiki/categories` puis `/api/public/wiki/{category}` a observé
21 catégories et 2 014 fiches à `2026-10-15T21:49:32Z`. Le snapshot JSON privé
fait 10 145 802 octets (SHA-256
`2ac1849a1158981a2f2d133a1205054d7f091e7e995360fd5c183c496da31183`).
Les totaux annoncés ont été comparés sur chaque page ; toute variation pendant
la capture aurait interrompu l'export. Le snapshot a été projeté avec
`aphrody web dragon-ball index` dans un corpus neuf du profil `aphrody` :
2 014 documents indexés, 5 483 chunks, 4 028 nœuds et 2 014 arêtes, zéro
erreur. Une requête RAG retrouve la fiche publique de Vegeta. L'état Aphrody
compte ensuite sept sources, 2 528 documents et 8 334 chunks, incluant l'index
des crates décrit ci-dessus.

Un détecteur simple des champs de prose vides a signalé 58 fiches parmi ces
2 014 lignes publiques (55 épisodes, deux combats et un tournoi). C'est une
mesure indicative : elle ne contrôle pas les schémas complets de chaque
catégorie et ne prouve pas que ces champs sont tous requis ou éditorialement
documentables. Cette API ne couvre que les catégories publiques listées ; elle
ne représente pas à elle seule l'inventaire complet de 10 754 fiches de l'API
admin. Aucun texte éditorial n'a été écrit ni publié. Les corrections restent
sous l'administration et les writers Shenron.

## Données et limites observées

L'API publique confirme 329 tomes, 219 lisibles et 110 sans lecteur. La collecte
officielle Jump+ a vérifié 31 pages japonaises de Yamcha : 31 GET réussis,
31 SHA distincts et 8 193 654 octets. L'épisode suivant est non public et ne
fournit pas de structure de pages. Cette sérialisation partielle ne prouve pas
la complétude du tome relié ; aucun nouveau tome complet n'est annoncé.
Le reçu d'acquisition et les références restent dans le store privé.

Correction de mesure à 20:01 UTC : le point d'accès de couverture est
`https://dragonballfr.com/api/manga/coverage` (HTTP 200), et non une route
`/api/public/manga/coverage`. Sa réponse déclare 329 tomes, 222 avec pages
listées et 53 304 pages listées ; les 222 se répartissent en trois aperçus
(`readerExtent=preview`) et 219 étendues inconnues, aucun `full`. La réponse
indique `assetAvailabilityVerified=false`,
`fullEditionPaginationVerified=false` et `complete=false`. Elle énumère toujours
110 lecteurs absents ou partiels. Ainsi, « pages listées » n'est pas synonyme de
lecteur complet, et les 219 entrées ne sont pas qualifiées comme intégrales.

Le wiki compte 10 754 fiches. Le snapshot éditorial présenté dans l'actualisation
ci-dessous a été corrigé après relecture : il portait sur 83 fiches et 131
champs manquants, pas 86 fiches. Sept corrections antérieures étaient déjà
publiées ; le relevé du writer a établi leurs révisions historiques.

L'image `b90f81052ef4ec7947dfea4f597eecf4f77e4811` a ensuite été construite.
Le smoke historique a échoué car `docker0` est absent ; la même image immuable
a passé les smokes de version et de bot avec `--network=none`. Le terminal
historique reste à 1 et les scripts de packaging privés refusent un reçu
alternatif. Le claim exclusif d'activation du propriétaire est préservé :
aucun transport d'image, cutover concurrent ou PATCH n'est annoncé.

## Livraisons et vérification

L'index enrichi est livré sur `origin/main` du fork Bun par `e09dda60ae`,
dans les propriétaires Rust existants et leur intégration CLI transférée.

Le mode CPU explicite est livré sur `origin/main` d'Aphrody par `f05eafe5d` :
9 tests, 29 assertions, `bun check`, `bun lint`, `bun fmt --check`, syntaxe
Bash et contrôle des espaces passent sur le wrapper et ses tests.

La collecte Jump+ est livrée sur `origin/main` de Shenron par `6c11a02e`
(greffe du lot local `a4fa57d5`, modifications concurrentes conservées) :
10 tests, 69 assertions et gates Bun ciblés passent. Le worker reste en attente
de sa dépendance native ; ce commit ne prouve pas de nouveau tome complet.

Le SDK source Web passe ses 10 tests et son Clippy strict ciblé. Les 69 tests
du crawler Rust passent également sur le lot final. Le test de reprise vérifie
désormais les trois documents produits (texte et deux références médias),
ainsi que l'absence de nouvelle requête à la reprise. Le format Rust et le
contrôle des espaces passent sur les chemins modifiés.
Le Clippy du crawler avec `--all-targets -- -D warnings` passe également.
Ces gates qualifient le crawler et le SDK source ; le binaire CLI complet,
son installation et son activation ne sont pas qualifiés par ce lot.

Les preuves détaillées et les snapshots éditoriaux restent dans les rapports
privés Shenron. Les décomptes ci-dessus décrivent l'observation datée, pas une
complétude des mangas, du wiki, du crawl, du runtime installé ou du site actif.

## Actualisation — 2026-10-15 à 13:58 UTC

Le serveur Shenron `b90f8105` est actif et `/api/health` répond 200. La
relecture du writer a confirmé sept corrections déjà publiées, avec leurs sept
révisions historiques exactes ; aucun PATCH supplémentaire n'a été envoyé.
L'inventaire complet récent compte 10 754 fiches et 86 fiches avec 131 champs
encore manquants, contre 108 fiches au relevé précédent. Les manques touchent
55 épisodes (103 champs), une œuvre, 11 databooks, neuf sections, deux combats,
un tournoi et quatre comédiens. Quatre synopsis sont présents dans l'API
publique et la description du databook 40 apparaît sur sa page. Les notices des
comédiens ne figurent pas dans le résumé staff. Reçu privé de vérification après
release : SHA-256
`c025aa003227fceea04f3e80208672b4fe9037954418ee6a791f6be80c5dd2b8`.

Le worker manga tourne sur le VPS depuis 13:55:40 UTC (PID 4051905, aucun
redémarrage). Le reçu de progression public observé à 13:56:40 UTC compte 329
tomes, 219 lecteurs complets, 52 220 pages de catalogue et zéro média vérifié.
Le worker accepte 16 tâches en parallèle et en exécutait quatre, avec 1 316
tâches en attente, 176 terminées, trois échouées, 64 refusées par robots et une
tâche sans capacité requise. Le service de publication manga DBFR est actif ;
`/api/health` répond 200. La disponibilité de la route de couverture n'avait pas
été testée correctement dans ce relevé. À 13:58 UTC, la file canonique du
publisher ne contenait aucun bundle qualifié, candidat ou handoff ; le dernier
reçu de projection indiquait zéro émission et zéro écriture publique. Les 110
tomes restent donc sans lecteur complet public. Les 31 pages Jump+ de Yamcha
déjà vérifiées ne constituent pas un tome complet. Les tâches terminées ou les
pages listées ne sont pas comptées comme ressources manga acquises.

La source de l'index catalogue reste livrée sur le fork Bun, avec ses gates Rust
verts. En revanche, `aphrody web dragon-ball index --help` depuis le binaire
installé n'expose que `--output`, `--profile`, `--state` et `--json` ; il ne
reconnaît pas encore `--catalogue`. Le binaire complet n'a donc pas été reconstruit,
installé ni activé après le commit de source. Aucun build CLI séparé n'a été
lancé pendant les compilations Bun partagées. Le stockage dédié
`/home/ubuntu/build/storage` dispose de 492 Gio libres sur un volume de 492 Gio ;
`/home/ubuntu/build` n'en a que 3,4 Gio.

Les comptes de progression manga et l'inventaire wiki restent des observations
datées. Les sources privées, propositions, médias et détails d'identification
des tomes demeurent dans le store Shenron protégé.

## Actualisation — 2026-10-15 à 14:07 UTC

Le writer wiki a appliqué à `media_works/14` une correction du synopsis français
avec backup, snapshot frais, CAS et relecture indépendante. La révision
`eex86twbniakbab3oqq6e0e1` est visible sur l'API publique (HTTP 200). Au relevé
GET seul de 14:07:15, il reste 77 fiches avec 125 champs manquants : 55 épisodes
(103 champs), six databooks, neuf sections, deux combats, un tournoi et quatre
comédiens. L'œuvre est complète. D'autres writers ont aussi complété cinq
databooks depuis le précédent snapshot ; leurs écritures n'ont pas été rejouées
ni écrasées. Le serveur `b90f8105` reste actif et son claim d'activation demeure
chez son propriétaire. L'inventaire ne prouve pas que les 77 fiches soient
documentables : les candidats sans source ou avec données en conflit restent
non modifiés.

Le statut expurgé du worker manga public observé à 14:05:41 compte 329 tomes,
219 avec lecteur, 110 sans lecteur, 53 220 pages listées et zéro média vérifié.
Le pool configuré pour seize workers en exécutait cinq ; 1 316 tâches étaient
terminées, 2 470 en attente, 74 en échec et 279 refusées par robots. Le publisher
DBFR est actif, mais son état relevé à 14:04:59 n'avait aucun bundle, candidat
ou handoff qualifié ; la dernière projection indiquait zéro émission et écriture
publique. Il n'existe toujours pas de galerie complète associée à une édition
exacte pour les 110 tomes. Les 31 pages Jump+ de Yamcha ne forment pas un tome.

À 14:05 UTC, un build release Bun partagé était actif avec quatre jobs ; le
build debug précédent utilisait douze. Le volume dédié libre ne justifie pas de
contourner le verrou de build. Le binaire `aphrody web dragon-ball index --help`
installé ne reconnaît toujours pas `--catalogue` ; sa reconstruction,
installation et activation restent à qualifier.

## Actualisation — 2026-10-15 à 14:15 UTC

Le correctif de préservation des BOM est livré dans Shenron `813d11d3`, intégré
sur `origin/main` (`f60ff727`). Les gates locales de son lot sont vertes : 19 tests,
121 assertions, vérification native sur six fichiers, lint et format. Un test
reconstruit 57 reçus en retrouvant exactement leur SHA-256 avec le BOM conservé ;
13 différences restent inexpliquées et quarantainées. Aucun reçu privé n'a été
réécrit et le service manga n'a pas été redémarré : l'activation du changement
dans le processus déjà lancé n'est pas prouvée.

Le statut public observé à 14:15:04 indique 329 tomes, 219 lecteurs, 110 sans
lecteur et 74 médias vérifiés dans le collecteur. À 14:14:43, le pool actif avait
terminé 2 380 tâches avec quatre workers actifs et 11 157 tâches en file. La
projection avait examiné 861 entrées, en mis 2 108 en quarantaine, et n'avait
émis aucun bundle ni écriture publique. DBFR ne comptait aucun candidat,
handoff ou tâche de publication à 14:15 ; aucun tome supplémentaire n'est donc
qualifié comme complet.

## Actualisation — 2026-10-15 à 14:57 UTC

La supervision privée Shenron a exécuté une passe `once` sur DBFR à 14:56:50
UTC. Le reçu expurgé signale un état `partial`, sans candidat nouvellement traité,
avec 6 propositions approuvées, 90 bloquées, 10 647 complètes, 3 quarantainées
et 8 rejetées. La passe suivante est planifiée à 20:56:41 UTC. Une lecture
SQLite au même moment montrait aussi des lignes remplacées et une quatrième ligne
quarantainée, d’où une différence entre le résumé du superviseur et les statuts
bruts de la file ; aucune modification manuelle des décisions n’a été faite.

L’export immuable des six propositions possède des reçus de writer déjà établis
pour cinq identifiants : section 13087 (`g2gznhxpwvrc3crbgxf5av27`), databooks
27 (`e8fk0pwtdaslbg8ynokn2mky`) et 23 (`g5xr7741sl9n1j8pfdxifvaz`), et
media work 15 (`rhzefsejmp41q4vutd577rbo`) ainsi que section 13090
(`iwymmeepzp3uda70u0u6jiqm`). La page publique de cette dernière a aussi été
relue en HTTP 200 à 14:36:48. Les reçus résident dans le store DBFR protégé ;
aucune écriture n’a été rejouée.

La preuve disponible ne couvre pas Dragon Ball SD (`media_works/7`) : aucun
reçu correspondant n’a été trouvé. Les routes d’API publiques et admin renvoient
403 depuis la session Infra actuelle, donc ce champ ne peut pas être marqué
publié ou confirmé. Les éléments disponibles ne permettent pas de qualifier les
90 propositions bloquées ; les corrections wiki restent partielles. Le timer
est actif et conserve ses limites de 4 workers / 20 candidats, sans publication
automatique.

## Actualisation — 2026-10-15 à 15:00 UTC

Le dépôt Shenron `origin/main` apporte depuis le précédent relevé les preuves
suivantes : 84 fiches wiki distinctes écrites, dont 78 textes relus exactement
sur le site public ; six articles de comédiens attendent encore le correctif
d’affichage de l’image commune. Un lot séparé de sept corrections a ses backups,
CAS, relectures et révisions signées vérifiés. Ces 84 fiches incluent les
corrections précédentes : elles ne doivent pas être additionnées aux reçus
ponctuels déjà listés ici. Dix corrections lexicales de Fû ne comptent pas comme
fiches. Le détecteur de champs manquants mesure mal certains synopsis originaux
restés nuls malgré un texte français public. Sources des reçus détaillés dans le
store Shenron protégé et docs/reference/root/REPRISE.md de son origin/main.

Le worker manga est toujours vivant (PID 4167233, démarré à 14:33:55). Reçu
expurgé du VPS à 14:57:03 : 329 tomes, 219 lecteurs complets, 110 sans lecteur,
1 169 assets vérifiés, 5 574 tâches terminées, 52 470 en attente, deux actives,
106 échouées, 296 refusées par robots, deux bloquées par le fournisseur et une
capacité search indisponible. Ces compteurs décrivent l’acquisition d’assets,
pas la validation d’un tome complet ni une publication. Le publisher DBFR reste
suspendu à l’image API exposant `readerExtent` ; aucune intégrale nouvelle n’est
annoncée.

## Correction de preuve — Dragon Ball SD, 2026-10-15 à 15:02 UTC

La lecture authentifiée du writer DBFR et de l’historique a depuis confirmé que
`media_works/7` possède un `synopsisFr` non nul, révision
`as2gz1i96bjhpr8xl9bkzfx2` du 15 octobre à 13:29:13 UTC. L’index public
`/wiki/manga` répond 200 et contient le titre Dragon Ball SD et ce synopsis.
La page détail `/wiki/manga/7` répond 404 ; cela ne contredit pas la présence du
texte dans l’index. Le synopsis public diffère de la proposition immuable
examinée dans le relevé de 14:57 : aucun PATCH n’a été effectué pendant cette
vérification et la proposition n’a pas été rejouée. Cette preuve authentifiée
remplace la mention précédente indiquant que la publication de `media_works/7`
ne pouvait être confirmée.

## Réconciliation des propositions bloquées — 2026-10-15 à 15:01 UTC

Une relecture authentifiée, sans mutation, des 90 entrées `blocked` de la file
wiki sur DBFR a obtenu 90 réponses administratives HTTP 200. Au moment de cette
lecture, 27 avaient toutes les cibles de leur proposition déjà renseignées
(4 œuvres, 18 databooks et 5 fiches de comédiens) : leur statut de file est
périmé, mais cette vérification n’a pas réécrit la base SQLite. Quarante-huit
autres ont déjà `synopsisFr` renseigné, tandis que le champ générique `synopsis`
reste nul ; ces champs ne sont pas interchangeables et ne sont pas comptés
comme deux synopsis français manquants.

Les 15 candidats dont toutes les cibles sont encore vides sont sept épisodes,
deux combats, un tournoi et cinq sections de statistiques de Vegeta. Les cinq
sections concernent le power scaling, désactivé conformément à la doctrine ;
elles ne sont pas complétées par extrapolation. Cette vérification n’est pas un
nouvel inventaire complet du wiki et ne change pas le décompte global.

## Actualisation — 2026-10-15 à 15:05 UTC

Le reçu d’acquisition public du VPS à 15:04:05 UTC compte toujours 329 tomes,
219 lecteurs complets et 110 sans lecteur. Le worker est vivant et a terminé
5 836 tâches ; il possède 1 328 assets vérifiés, avec 52 209 tâches en attente,
107 en échec, 296 refusées par robots, deux bloquées par le fournisseur et une
capacité de recherche indisponible. Aucun de ces assets n’est assimilé à un tome
complet. DBFR `/api/health` répond 200, mais le catalogue public tronqué à la
lecture ne démontre pas de nouvelle extent de lecteur ni publication.

Le dépôt Shenron contient un changement non commité sous propriétaire dans son
manifest bibliographique et deux tests : l’ISBN japonais officiel de DBS 24 est
associé à l’identifiant historique 147, tandis que le preview Shueisha est
explicitement d’une page et incomplet. Les tests ciblés passent (14 tests,
40 assertions) et `git diff --check` est propre. Cette édition précise ne
qualifie pas un tome entier. Les fichiers ont des changements locaux préexistants
dans Shenron; ce reçu ne les intègre ni ne les publie.

Le binaire Aphrody installé a été recontrôlé :
`aphrody web dragon-ball index --help` n’expose toujours pas `--catalogue`.
Le source correspondant est livré dans le fork Bun, mais ce binaire n’a pas été
reconstruit ou activé. Sur l’hôte, le volume `/home/ubuntu/build` est à 98 %
(7 Gio libres), tandis que deux builds Bun sont actifs et que le test Shenron
source tourne en 12 jobs. Je n’ai pas lancé de build Aphrody concurrent ni
contourné le verrou partagé. Le volume `/home/ubuntu/build/storage` a 549 Gio
libres, mais cette capacité ne rend pas qualifié le chemin de build courant.

## Actualisation — 2026-10-15 à 16:41 UTC

Le `main` local est aligné sur `origin/main` au commit
`8fe0645e6909bf0e61e8373f2d148de8e0f5752f`. Le binaire Aphrody installé a
encore été vérifié ; `aphrody web dragon-ball index --help` ne présente pas
`--catalogue`. Le source Rust correspondant reste sur le fork Bun au commit
`bcf03c2fae8d54f6657dbe3ac5df14807c8ba7af`.

J’ai préparé deux worktrees propres isolés et synchronisé leur source exacte sur
le VPS. Le premier build a échoué avant compilation, car le chemin `../bun` du
workspace n’avait pas encore reçu son snapshot ; le dépôt secondaire a ensuite
été synchronisé et vérifié au commit Bun indiqué ci-dessus. Trois invocations
ont échoué immédiatement avec `no such command: cargo` : l’interface
`vps-cargo run` attend directement les arguments Cargo, et les appels initiaux
avaient répété le mot `cargo`. La commande correctement formée,
`vps-cargo run --jobs auto -- build --release -p aphrody --features index
--locked`, a compilé les dépendances et les crates Bun/Aphrody avec 12 jobs.
Après un scan initial lent du cache Git partagé, elle a échoué avec code 101 sur
le module GCS transféré :
`aphrody-web-source::module!` refuse ce chemin car le fichier correspondant
manque dans [la zone d’intégration du fork Bun à ce commit](https://github.com/aphrody-labs/bun/tree/bcf03c2fae8d54f6657dbe3ac5df14807c8ba7af/packages/web/rust/integrations).
Les références `crate::gcs` échouent ensuite en cascade. Pourtant,
[le reçu de transfert](https://github.com/aphrody-labs/bun/blob/bcf03c2fae8d54f6657dbe3ac5df14807c8ba7af/packages/web/rust/transfer-receipt.json)
possède l’entrée source/destination de ce fichier ; la réconciliation est incomplète dans le commit Bun
`bcf03c2fae8d54f6657dbe3ac5df14807c8ba7af`. Le binaire complet n’a donc pas été
produit.

Au relevé VPS suivant : 12 CPU, 19 Gio de mémoire disponibles, 515 Gio libres
sur `/home/ubuntu/build/storage`, mais 2,2 Gio libres sur le volume déclaré
`/home/ubuntu/build` (100 %) et swap saturé. Le linker du build Bun partagé
attendait le stockage depuis plus de 31 minutes et des lectures Git/ext4 étaient
bloquées. Les verrous Cargo sont désormais libres et les snapshots distants
restent isolés sur les révisions attendues. Je n’ai ni contourné les verrous, ni
modifié les jobs ou caches concurrents.

Gates locaux sur worktree pruné : `cargo metadata --no-deps --format-version 1
--locked` passe ; `bun check` ne démarre pas, car `@types/bun` et `@types/node`
ne sont pas installés. `bun install --frozen-lockfile --offline` est impossible
dans ce snapshot incomplet : dix workspaces Material externes requis manquent.
La source Rust transférée avait déjà ses gates ciblés verts dans le reçu de
livraison initial ; cette tentative n’ajoute donc pas une qualification du
binaire CLI complet. `aphrody --help` n’a pas été installé ni activé.

Les données manga/wiki demeurent sous le propriétaire Shenron. Le dernier reçu
disponible ici reste celui de 15:05 UTC : 329 tomes, 219 lecteurs complets, 110
sans lecteur public ; les assets collectés ne sont pas des intégrales. Le relevé
wiki antérieur compte 84 fiches écrites dont 78 textes exactement relus en
public, avec six profils de comédiens attendant le correctif d’affichage et des
candidats bloqués non documentables. Je n’ai fait aucune nouvelle écriture
éditoriale ou mutation de publication. Les deux claims d’intégration affichent
`released`; le claim d’activation Shenron reste détenu par son propriétaire.

## Actualisation — 2026-10-15 à 17:03 UTC

Le source Bun nécessaire à l’intégration, après restauration exacte de la
source GCS transférée (SHA-256
`5ac01afcbe07fddfc8e60af17a4535db40b70dd35d7c908988f4d93b629b8a17`), est
commité et poussé sur `aphrody-labs/bun/main` en `6f1c9a1ccc2039e57d0a46b6234b65d87db61b04`.
Le build release ciblé Aphrody a réussi par l’usine déclarée, avec 12 jobs :

```sh
bun scripts/build/rust/vps-cargo.ts run --jobs auto \
  --config /home/ubuntu/aphrody-build/dragonball/vps-cargo.json -- \
  build --release -p aphrody --features index --locked
```

Le build a terminé en 8 min 43 s. Il reste des avertissements non bloquants
existants (exigence semver avec métadonnées, documentation/commentaires et
fonction inutilisés). L’artefact
`/home/ubuntu/aphrody-build/dragonball/aphrody-bin/aphrody` et le binaire
installé `~/.local/share/aphrody/bin/aphrody` ont tous deux le SHA-256
`18c1816a12d14f1117291b82bdd2836a83be5ce9f605b55d2144ed5a6eac68f5`.
L’installation a conservé l’ancien binaire et évité l’activation du démarrage
(`self install --keep-legacy --no-boot`). L’aide du binaire installé expose
`--catalogue`. Le test hors ligne d’un catalogue synthétique `shenron-manga-cdn/v1`
a matérialisé et indexé deux documents sans erreur, avec les titres, ISBN et
empreinte attendus ; il ne lit ni ne republie de corpus privé ou de médias.

Le test Rust ciblé de `aphrody-web-source`, lancé via le même factory avec
`--locked`, a ensuite passé après la libération des verrous partagés : 3 tests
unitaires de source, 5 tests de catalogue, 2 tests consommateur et 2 doctests
(dont un compile-fail), zéro échec. Il a compilé `aphrody-web-source` et
`catalogue_index` en profil release.

Le reçu public du worker sur le VPS observé à 17:03:08 UTC indique 329 volumes,
222 lisibles et 107 sans lecteur complet, 53 304 pages listées et 1 995 assets
vérifiés ; la recherche est toujours indisponible. Le worker est `running`, avec
16 workers configurés (aucun actif à cet instant), 51 544 tâches en attente,
6 503 terminées, 111 en échec, 296 refusées par robots et deux bloquées par le
fournisseur. Ces assets ne prouvent pas l’intégralité d’un volume. DBFR
`/api/health` répond 200 et `/wiki/manga` répond avec sa page HTML publique ;
cela ne constitue ni un audit exhaustif des fiches ni une confirmation du nombre
total d’entrées exactes. Aucune donnée wiki/manga éditoriale n’a été écrite ou
publiée dans cette actualisation.

## Actualisation — 2026-10-15 à 17:16 UTC

Le reçu public du worker observé à 17:15:13 UTC conserve 329 volumes, 222
lisibles, 1 995 assets vérifiés et `search: unavailable`; sa prochaine
réconciliation est planifiée à 18:15:13. Le processus tourne sous une limite de
12 cœurs et 20 Gio, sans throttling CPU observé, avec environ 373 Mio de mémoire
utilisée. Au relevé, la progression indique zéro worker actif et zéro tâche en
cours malgré 51 544 tâches en attente. La capacité CPU/mémoire est donc déjà
déclarée par l’unité, mais l’absence de recherche reste une limite de couverture ;
il n’y a pas de justification à allouer de la mémoire artificielle.

La tentative de planification d’un manifeste wiki approuvé a été refusée avant
toute mutation, car le snapshot administratif avait changé. Une relecture
authentifiée confirme que plusieurs propositions correspondantes ont déjà été
remplies ou remplacées : les notices `db_databooks/23` et `/27`, Jaco (`15`),
et les sections Vegeta `13087` et `13090` contiennent les textes approuvés ; le
synopsis de Dragon Ball SD (`media_works/7`) a une autre formulation actuelle ;
celui de SDBH (`11`) est également déjà renseigné. Aucune de ces opérations
obsolètes n’a été réappliquée. L’export immuable et la file restent préservés ;
les corrections futures nécessitent un snapshot neuf et une nouvelle revue
indépendante.

## Actualisation — 2026-10-15 à 17:31 UTC

Le pool manga tournait à environ 93 % d’un cœur avec 456 Mio résidents
(pic historique 1,4 Gio), sous son plafond déclaré de 12 cœurs et 20 Gio. Il
avait 16 workers configurés, zéro tâche active, 51 544 en attente et 6 503
terminées. Le CPU élevé malgré l’absence d’activité justifiait une correction
du polling, pas une hausse artificielle de mémoire.

Shenron `c23af7334560415973d61f51a6ce16569f1c308b` arrête maintenant le scan
des slots dès que `claim()` ne trouve plus de tâche éligible : la file SQLite
était interrogée jusqu’à 16 fois par tour sans qu’un slot supplémentaire
puisse rendre une tâche réclamable. Le correctif a passé 23 tests ciblés et
187 assertions, `bun check`, `bun fmt --check` et `bun lint` sur le fichier
(avertissements existants du fichier, aucune erreur). Les mêmes portes ont
été rejouées sur le VPS après fast-forward ; le SHA des octets déployés a été
comparé avec le commit.

Le seul service manga, `shenron-manga-workers.service`, a redémarré via Infra.
Le nouveau PID 602749 a écrit `ready.json` et `workers.json` pour 16 workers,
avec le runtime Bun 1.4.4 qualifié (`dfde053a…`). Le statut public confirme
`activeWorkers=0`, `running=0`, 51 544 en file et `search=unavailable`.
Une mesure courte immédiatement après le démarrage oscillait entre 65 et 84 %
d’un cœur, donc elle ne suffit pas à revendiquer un gain comparatif durable ;
la récupération du pool et les lectures SQLite restent à profiler. Limites
systemd inchangées : `CPUQuota=1200%`, `MemoryHigh=16G`, `MemoryMax=20G`.

L’API publique est toujours à 329 volumes, 222 avec lecteur complet et 107
sans lecteur complet ; les 3 aperçus connus gardent leur statut partiel,
soit 110 volumes manquants ou partiels. Le worker ne constitue pas une preuve
de complétude. La recherche Google reste bloquée par la réponse anonyme vide ;
aucun retry ni contournement n’a été fait. Les propositions wiki restent
partielles : plusieurs approuvées sont déjà présentes sous un autre texte et
les sources officielles manquent pour les éléments encore vides ; aucune
écriture wiki n’a été ajoutée dans ce lot.

## Index RAG terminé — 2026-10-15

La génération locale du catalogue Dragon Ball s’est achevée dans le profil
`workspace-shenron`. Le run 17 est `succeeded` : 85 828 documents indexés,
89 802 chunks, 0 erreur et 0 document inchangé. Le run graphe 18 a aussi
réussi : 85 828 fichiers scannés et hachés, 171 656 nœuds, 85 828 arêtes,
0 erreur. Les entrées provenaient de quatre exports locaux fournis à
`aphrody web dragon-ball index --catalogue` (catalogue Shenron, épisodes
Toei, statistiques Jump et actualités officielles). Les fichiers et la base
restent dans le profil privé Shenron ; les compteurs décrivent cet index
privé et ne signifient pas que les contenus manga manquants ont été acquis,
ni qu’ils sont publiquement lisibles.

La porte `bun run docs:check` a été exécutée et échoue sur des artefacts
documentaires préexistants obsolètes (`STATE.md`, `llms.txt`, README racine,
`docs/README.md`, `documentation.json` et quatre fichiers `docs/ecosystem`),
ainsi qu’un groupe de doublons exacts conservé. Le reçu passe
`git diff --check`. Son commit n’a pas été créé dans cette session : un verrou
Git partagé, vide et sans processus propriétaire visible, bloque toujours
toute mise à jour de l’index Git. Les changements
concurrents sous `packages/infra/paths/` sont préservés.

## Complément et correction de livraison — 2026-10-15 à 18:00 UTC

Correction : le reçu a depuis été committé et poussé sur `main` par
`d00029296941df7bc8c7a0439b9786922cd89a3f` ; son SHA distant a été relu. Le
verrou orphelin avait pu être retiré après vérification de son âge, de son
contenu vide et de l’absence de détenteur. Le commit n’inclut que ce document.

La couverture publique relue à 18:00:22 donne 329 notices : 222 avec des pages
listées, 107 sans page listée, et trois volumes qui ne sont que des aperçus
(147, 619, 620). Les 107 se répartissent en 90 notices hors SOSH sans pages
listées — ARALE 33, DBGT_ANIME_COMICS 3, DBS_ANIME_COMICS 3,
DB_LIGHT_NOVELS 3, DB_SD 23, JACO 3, NEKOMAJIN 3, SDBH 19 — et 17 fiches
SOSH (702–718) sans page. La couverture précise que l’intégralité de la
pagination et la disponibilité des assets ne sont pas vérifiées ; ces nombres
ne prouvent donc pas que les 222 lecteurs listés soient complets.

À 18:00, le pool de collecte restait actif avec 16 workers configurés, zéro
tâche active, 51 544 en file, 6 503 terminées, 111 en échec/reprise, 296
refus robots, deux blocages de fournisseur et une capacité de recherche
indisponible. Le reçu de projection compte 3 966 documents projetés, zéro
candidat émis, zéro écriture publique et zéro écriture éditoriale. Les 3 989
quarantaines se répartissent entre 3 498 identités édition/ISBN exactes
insuffisantes, 468 galeries natives ordonnées absentes et 23 empreintes de
capture différentes. Cela exclut une publication sûre par les writers
canoniques à partir des candidats actuels.

La page de [Shueisha pour Dragon Ball SD 10](https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-883767-3)
confirme le titre, 192 pages imprimées, l’ISBN et un lien officiel « essai ».
Ce lien mène à un aperçu éditeur et n’établit ni l’accès aux 192 pages ni une
pagination exploitable pour les autres éditions. La capture d’aperçus publics
est déjà revendiquée par un claim actif dans Shenron ; aucun captureur ni sortie
privée de ce propriétaire n’a été modifié ou lancé.
La campagne wiki a aussi un claim actif sur son inventaire et ses propositions ;
aucune proposition ni écriture publique n’a été ajoutée ici.

### Contrôle bibliographique ciblé — 18:05 UTC

Une nouvelle lecture des deux API publiques retrouve exactement 110 volumes
incomplets : 107 sans pages listées et 3 aperçus. Parmi ces 110, 107 ont un
ISBN déclaré et trois n’en ont pas (ID 719, 720, 802). Le catalogue officiel
Shueisha identifie le Broly roman japonais sous ISBN `978-4-08-321475-2`
([fiche officielle](https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-321475-2)), mais
c’est une autre édition que l’entrée française de l’API ; aucune fusion
d’identités n’a été faite. Pour l’entrée « Résurrection de F - Roman du film »,
la fiche officielle [Glénat](https://www.glenat.com/glenat-manga/dragon-ball-z-la-resurrection-de-f-9782344017708/) retrouvée porte sur l’anime-comics papier
`978-2-344-01770-8`, pas sur un roman ; cet ISBN n’a pas été attribué à l’entrée.
Enfin, Shueisha donne pour [`ネコマジン カラー版`](https://books.shueisha.co.jp/items/contents.html?jdcn=08873825873825325501) un identifiant de livre
numérique (`jdcn=08873825873825325501`) et distingue la version couleur
numérique de l’édition papier ; l’ISBN papier `978-4-08-873-825-3` n’a donc
pas été injecté comme ISBN de cette autre édition. Ces contrôles aident à
qualifier les notices, mais ne fournissent aucune planche manga manquante.

## Complément RAG — source officielle Ultra God Mission (2026-10-15)

Le binaire courant `aphrody web dragon-ball index --help` expose maintenant
`--catalogue` répétable. Une invocation sans sortie explicite sur le dossier du
crawl s’est arrêtée sur son verrou ; un crawl distinct était effectivement actif
(PID 764682) sur ce dossier. Aucun verrou n’a été forcé et aucun fichier de ce
job n’a été modifié.

Pour ajouter une source vérifiée sans toucher au crawl, le profil privé
`workspace-shenron` a reçu une notice courte dérivée de la page officielle
[Dragon Ball Official Site — Ultra God Mission!!!!, volume 1](https://en.dragon-ball-official.com/news/01_1524.html).
Réponse HTTP 200, corps reçu 44 252 octets, SHA-256
`dcf4e1d0dfe4c60773eb883141d542a2b897fae6f262edd0cff242f40cec4e4b`.
La notice Markdown privée est indexée par
`aphrody home index ... --profile shenron --state /home/ubuntu/.aphrody/workspace-shenron` :
1 fichier ajouté, 1 document extrait, 2 chunks, 0 erreur. Une recherche native
RAG sur « Ultra God Mission Aeos Super Space-Time Tournament Jiren Hit » retrouve
la source et ses deux chunks. Le reçu JSONL conserve les métadonnées mais n’est
pas lui-même extractible par l’indexeur ; l’indexation utilise la notice Markdown.

Cette source officielle confirme le contexte manga du Super Space-Time Tournament
et le rôle d’Aeos. Elle ne prouve pas la parenthèse « Toki Toki City » attachée à
la fiche publique Shenron `tournaments/11`. Aucune modification wiki, copie de
page intégrale ou publication publique n’a été faite. Le dossier source privé
est `/home/ubuntu/.aphrody/workspace-shenron/private/web/official-source-addendum-20261015/`.

## État live et reprise — 2026-10-15 à 19:49 UTC

L’API publique du catalogue indique toujours 329 notices : 222 avec pages
listées, 107 sans pages et les trois aperçus 147, 619 et 620. Le reçu de
progression du pool à 19:48:51 compte 53 304 pages listées et 1 995 assets
vérifiés, mais zéro worker actif, 51 544 tâches en attente, 6 503 terminées,
111 en échec, 296 refus robots, deux blocages fournisseur et une capacité de
recherche indisponible. Ces assets vérifiés ne suffisent pas à qualifier les
110 éditions sans lecteur complet; aucun compteur de tâches ne vaut preuve de
complétude d’un tome.

Le crawl officiel distinct est toujours en cours (PID 1094602, lancé depuis
19:43 UTC) sur son dossier privé. Je ne l’ai ni relancé ni indexé pendant son
écriture. Les routes publiques testées `/api/public/manga/catalog` et
`/api/public/manga/coverage` répondent 404 sur le serveur DBFR; la couverture
reste établie par le statut public existant et le reçu du pool.

La fiche publique `db_episodes#875` (`DBS_BEERUS`, épisode 1) répond HTTP 200;
`synopsis_fr` reste nul et la source officielle déclarée est
`https://dragonball-super.com/en/index.html#story`. Le writer canonique Shenron
demande une approbation éditoriale indépendante, un manifeste revu, un backup
PostgreSQL vérifié et l’application CAS. La session Gemini disponible n’a pas
pu s’authentifier (`SNlM0e token not found`); aucune approbation n’a été
fabriquée et aucun PATCH n’a été envoyé. La campagne wiki demeure partielle.

La situation est donc inchangée sur le fond : l’index RAG privé est complet au
sens de son run réussi, mais ni les 110 tomes incomplets ni toutes les lacunes
wiki ne sont complétés ou publiés.

## Reprise du writer et du crawl — 2026-10-15 à 19:55 UTC

Une nouvelle lecture protégée de l’API admin a alimenté une base de campagne
distincte, sans rejouer la file existante : 10 757 cibles, 10 692 complètes,
64 candidates en attente et une candidate bloquée après la découverte officielle.
Le test ciblé portait sur l’épisode 1 de l’arc UGM; le runner n’a trouvé aucune
citation officielle qualifiable pour son synopsis et n’a produit ni brouillon,
ni approbation, ni écriture. Les autres lacunes fraîches sont surtout des
synopsis d’épisodes SDBH/DBZ Kai, deux articles de combats et des sections de
statistiques Vegeta; elles restent soumises à la preuve exacte propre à leur
support et continuité. L’inventaire n’est pas une complétion.

Le pool manga a été relu à 19:53:57 : toujours 329 notices, 222 avec pages
listées, 110 manquantes ou partielles, 53 304 pages listées et 1 995 assets
vérifiés. Les 16 workers configurés restent à zéro actif, avec 51 544 tâches
en attente. Le fichier privé de capacité désactive Google pour le motif
`bun-search-cli-unsupported`; les tâches de recherche restent en quarantaine,
sans retry. Réactiver ce propriétaire exige un correctif qualifié du worker;
aucune capacité fictive ni retry n’a été injecté.

Le crawl orchestré par le PID 2930486 demeure vivant. Son processus enfant
travaille actuellement sur la source Toei `dragon`; les rapports des rounds
précédents n’autorisent pas à lire/indexer son répertoire partagé pendant
l’écriture. Les rapports individuels de source ne sont pas utilisés comme
compteur global; le run entier n’est pas terminé. Aucun nouvel index RAG ni
publication wiki/manga n’est revendiqué.

## Reprise de l’index local Bun — 2026-10-15 à 20:59 UTC

Le checkout fork `/home/ubuntu/src/bun` est sur `main`, avec
`3182a79486` (`origin/main`) pour la préservation de la preuve de couverture.
Ce changement conserve dans l’index les champs de pagination et d’étendue du
lecteur (`listedPages`, `hasListedPages`, `readerExtent`) et les totaux de
couverture. Les tests ciblés précédemment exécutés sur le lot passent : test
unitaire, `cargo test --locked -p aphrody-web-crawl --lib` (70 réussis) et
Clippy strict. Le binaire Aphrody reconstruit depuis ce snapshot expose
`--catalogue`.

Une nouvelle indexation hors ligne utilise ce binaire et les trois snapshots
immuables : catalogue manga (329 notices, 925 chapitres), couverture (329
entrées, 110 absentes ou partielles) et inventaire CDN public (112 718 notices
d’assets, 1 175 sidecars). À 20:59:23 UTC, le run est toujours actif après
9 min 18 s et a écrit 18 253 documents dans
`/home/ubuntu/build/storage/artifacts/dragon-ball-index-20261015T201308Z/indexed-fork-qualified`.
Le volume dédié conserve 444 Gio libres; le processus consomme environ 19 Mio
RSS. Aucun reçu final n’est encore disponible : ce nombre intermédiaire ne
prouve ni l’ingestion complète des trois snapshots ni l’intégrité du run achevé.
Le résultat est une collection locale privée de métadonnées et de références,
pas une acquisition de planches.

La réponse de couverture capturée à 20:13:46 UTC contient 329 volumes, 222
avec pages répertoriées et 53 304 pages répertoriées. Elle marque les 222
étendues comme aperçu ou inconnues, avec zéro étendue `full`,
`assetAvailabilityVerified=false`, `fullEditionPaginationVerified=false` et
`complete=false`. Les 110 IDs manquants/partiels demeurent inchangés. Les
assets Arale observés dans l’inventaire sont uniquement des métadonnées de
chemins ; aucune vérification HTTP, correspondance exacte d’édition ou
pagination intégrale n’a été faite. Les 110 tomes ne sont donc pas complétés.

Les propositions et auteurs wiki restent sous le propriétaire Shenron et ses
claims actifs; aucun champ wiki ni publication n’a été modifié dans cette
reprise. Les travaux simultanés sur le build Bun Windows et les chemins
Aphrody ont été laissés intacts. L’index fork est livré sur `origin/main`; le
présent reçu décrit un run toujours en cours, et non un résultat final.

## Index incrémental qualifié — 2026-10-15 à 21:38 UTC

Le fork Bun a livré `2b27e9d8fb` (`origin/main`) dans le crate propriétaire
[aphrody-web-crawl et son indexeur catalogue](https://github.com/aphrody-labs/bun/blob/2b27e9d8fb40329245cd18f35bfb7080cea1a8b9/packages/web/rust/crates/web-crawl/src/dragon_ball/catalogue_index.rs).
Les sidecars d’assets manga publics sont
agrégés par série et volume : nombre d’assets, octets, nombre d’images WebP
numérotées, bornes et continuité des numéros depuis un. Les notices conservent
explicitement `assetAvailabilityVerified`, `fullEditionPaginationVerified`,
`rightsVerified`, `editionMatchVerified`, `languageVerified`,
`contentIdentityVerified`, `readerEligible` et `canonical_eligible` à `false`.
Le parseur ne télécharge ni ne copie de planches. Les propriétés de projection
et le test des trous de séquence sont couverts par les gates Rust du crate.

Sur le snapshot du lot, `cargo test --locked -p aphrody-web-crawl
-p aphrody-web-source` passe 85 tests au total (71 tests web-crawl, 3 tests
source, 7 tests catalogue, 2 tests consommateurs et 2 doctests). `cargo clippy
--locked -p aphrody-web-crawl --all-targets -- -D warnings`, le `rustfmt`
ciblé et `git diff --check` passent. Le CLI a ensuite été reconstruit depuis
Aphrody avec `cargo build --locked -p aphrody`, `CARGO_BUILD_JOBS=12` et le
cache de build du factory ; la compilation se termine en 8 min 12 s. Le fork a
avancé sur `main` à `88090ecfe2` après le commit d’indexation ; ce commit
ultérieur porte sur le worker de release Windows et les fichiers Rust
d’indexation restent au commit qualifié ci-dessus.

Le premier run hors ligne sur les trois snapshots, avec l’ancien binaire, a
indexé 114 302 documents et 114 455 chunks sans erreur en 27 min 28 s. Le run
incrémental avec le nouveau binaire prend 375,39 s : 114 455 fichiers scannés
et hachés, 153 nouveaux documents ajoutés et indexés, 114 302 conservés depuis
le cache, 153 chunks ajoutés, zéro refus, fichier illisible ou erreur. L’état
RAG final contient 114 455 documents, 114 608 chunks et 114 455 fichiers.
Les catégories projetées sont 112 718 assets, un index d’inventaire, 925
chapitres, 658 notices volume/couverture et 153 résumés d’assets par volume.
Une recherche `aphrody home query` retrouve directement le résumé d’ARALE vol.
1 : 193 chemins `.webp` numérotés 1–193 et 13 729 204 octets déclarés.

L’archive privée du corpus et de la base est
`/home/ubuntu/build/storage/artifacts/dragon-ball-index-20261015T201308Z/indexed-fork-full-20261015.tar.zst`
(116 Mo, 875 898 880 octets décompressés). `zstd -t` passe ; SHA-256 :
`58c50cebd5b413026e23d80b21db97d7b8d5a8cd3df4cd2d51d5f72964917252`.
Les snapshots d’entrée ont pour SHA-256 `4402d06f…13630c9` (catalogue, 329
publications et 925 chapitres), `d1249aff…03cb99` (couverture, observée à
20:13:46 UTC) et `135f1f35…5f5e0b` (inventaire CDN, révision
`89c5af72…e94762b2`).

Le candidat ARALE vol. 1 recoupe la notice catalogue 601, dont 193 pages sont
listées avec `readerExtent=unknown`. Cette égalité de dénombrement ne prouve
pas que les fichiers soient disponibles, appartiennent à la même édition ou
forment sa pagination intégrale ; tous les indicateurs de qualification du
résumé restent faux. À 21:38:09, le suivi du pool lit toujours 329 volumes,
222 lisibles, 110 manquants ou partiels, 1 995 assets vérifiés et 53 304 pages
listées. Le pool a 51 544 tâches en attente, zéro worker actif et la capacité
de recherche déclarée `unavailable`. Le catalogue de couverture garde
`complete=false`, `assetAvailabilityVerified=false` et
`fullEditionPaginationVerified=false` ; aucun des 110 tomes n’est complété par
ce lot.

Les claims de complétion wiki et de writer Shenron restent aux propriétaires
existants. Le crawl privé poursuivait ses propres sources ; je n’ai modifié ni
ses sorties ni ses propositions et n’ai rien publié. L’index qualifié est une
copie locale privée de métadonnées, distincte de l’état d’activation du site.
`git diff --check` passe. `bun run docs:check-links` échoue au niveau du dépôt
sur 176 liens locaux cassés et 175 chemins de code morts (1 597 chemins vérifiés
dans 573 documents) ; le reçu présent ne figure plus parmi les erreurs après
remplacement des chemins vers le checkout Bun externe par des liens de commit.

## Build CLI et index incrémental des crates Bun — 2026-10-15 à 22:40 UTC

Le fork Bun a livré l'adaptateur de catalogue des crates sur `origin/main` au
commit `d2b92866563b640da4197edc88b337cca2da09a8`. Il valide le schéma,
l'identité du dépôt, la révision source, les manifestes et les champs de
couverture avant de produire les fiches de navigation et leur synthèse. Les
gates du lot passent : 73 tests du crate `aphrody-web-crawl`, Clippy strict,
`rustfmt` ciblé et contrôle des espaces. Les fiches relient chaque manifeste
à la révision Bun source épinglée `1988e4bae7b374810cacda67d52dfd08e26ea6b7`.

Le CLI Aphrody a été compilé en release depuis le commit `8ab5fe233` dans le
worktree de build détaché réservé à ce lot, avec le verrou `heavy`, l'admission
de ressources du factory et 12 jobs Cargo. La compilation `--locked -p aphrody`
a réussi (`exitCode=0`, terminée à 22:39:46 UTC) ; le SHA-256 du binaire est
`bf00050567c1158deb44a12d43cc5a237f0f870b01dc80b5ebc9a200f6d1a387`. Le
checkout canonique du VPS avait avancé et contenait des modifications
concurrentes ; elles ont été préservées, sans les inclure dans ce build.

Ce binaire a indexé hors ligne le catalogue local de 237 crates dans le profil
privé `aphrody` : 238 documents matérialisés et indexés (237 fiches plus la
synthèse), 239 chunks, zéro erreur. Une requête RAG retrouve la fiche
`bun_browser_crawl` et ses liens Cargo épinglés. Aucune collecte réseau n'a eu
lieu pendant l'indexation et aucun résultat n'a été publié. Cette livraison
rend les métadonnées des crates consultables ; elle ne signifie pas que les
237 crates ont été construites ou testées. Le snapshot producteur conserve sa
limite déclarée de couverture de fichiers incomplète.

La disponibilité des 110 tomes incomplets et les lacunes éditoriales du wiki
restent sous Shenron. Les preuves déjà consignées indiquent qu'aucune pagination
intégrale n'est qualifiée et que les champs wiki restants requièrent des sources
éditoriales. Cette étape n'a acquis aucun tome, modifié aucune fiche wiki et
n'effectué aucune publication.

## Actualisation de l'index wiki public — 2026-10-15 à 22:45 UTC

Une nouvelle capture paginée en lecture seule a contrôlé les 21 catégories,
leurs totaux et chaque page avec détection des doublons, puis a revalidé
l'inventaire des catégories après la collecte. Le snapshot contient toujours
2 014 fiches et 10 141 719 octets, SHA-256
`0d6b2c2a51b6a538fd2372b1c65ccb636d63c22f974374d4fd0bc71273b9c8f1` ; il a
été observé à `2026-10-15T22:45:15.931Z`. L'API a imposé des réponses HTTP 429
pendant la capture ; la reprise à débit réduit a fini sans abandonner de page.

Le binaire release Aphrody a indexé le snapshot dans un nouveau corpus privé du
profil `aphrody` : 2 014 documents, 5 541 chunks, 4 028 nœuds, 2 014 arêtes et
zéro erreur. La recherche RAG retrouve un document du snapshot à son horodatage
et sa révision de source. Cette actualisation confirme la couverture complète
de l'API publique paginée au moment de la capture ; elle ne complète pas les
champs absents des fiches privées/admin et n'apporte aucune correction wiki.

Le reçu public du pool manga observé à 22:46:34 UTC indique toujours 329 volumes,
222 lisibles, 110 manquants ou partiels, 51 543 tâches en file, une active,
6 503 terminées et une capacité de recherche indisponible. Aucun des 110 volumes
n'est qualifié comme complet par ces nombres. Le pool reste en exécution sous
son propriétaire Shenron ; aucune tâche n'a été dupliquée ou relancée ici.

## Sources de lecture licenciées — vérification du 2026-10-15

Les catalogues éditeurs confirment une voie d'accès licenciée pour une partie
de la série : [VIZ liste les chapitres de Dragon Ball et Dragon Ball Z](https://www.viz.com/shonenjump/chapters/dragon-ball)
avec le premier chapitre gratuit et les suivants réservés à l'abonnement ou à
l'achat du volume ; [MANGA Plus indique l'accès par abonnement à l'histoire](https://mangaplus.shueisha.co.jp/titles/100011)
avec des chapitres et pages exclus. Ces offres sont des pistes de lecture
officielles, pas des exports d'images utilisables pour remplir le CDN.
Elles ne démontrent ni la correspondance d'édition, la pagination ni la
couverture des 110 notices absentes ou partielles. Aucun accès payant n'a été
acheté ou utilisé, aucune page n'a été téléchargée et aucun droit de
redistribution n'a été présumé.
