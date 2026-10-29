<!-- SPDX-License-Identifier: Apache-2.0 -->

# Objectifs d'Omar — Dragon Pixel

Preuves recueillies le 2026-10-07 UTC. Demande authentifiée :
[message source](https://discord.com/channels/1554189180030947338/1557354118710829117/1557385939393716335).

## Recherche et téléchargements effectifs

Fiches produit Google Play lues par `aphrody web fetch --json` :

- [Dragon Crystal — Arena Online](https://play.google.com/store/apps/details?id=com.CrystalDev.DragonCrystalArena) : combat 2D, charge, transformations, arènes et multijoueur.
- [Warriors of the Universe](https://play.google.com/store/apps/details?id=com.GamerMind.Warriors_of_the_Universe_Online) : personnalisation, combos, capacités et invasion par vagues, solo et multijoueur.

Archives téléchargées depuis les liens XAPK exposés par les pages
[Dragon Crystal sur APKPure](https://apkpure.com/dragon-crystal-arena-online/com.CrystalDev.DragonCrystalArena/download) et
[Warriors of the Universe sur APKPure](https://apkpure.com/warriors-of-the-universe-online/com.GamerMind.Warriors_of_the_Universe_Online/download).
Les fichiers restent hors Git dans `/home/ubuntu/.aphrody/artifacts/omar-crystal-universe/`.

| Fichier                         | Version du manifeste | Identifiant                                   | SHA-256                                                          |
| ------------------------------- | -------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `dragon-crystal.xapk`           | 39.262129 (200180)   | com.CrystalDev.DragonCrystalArena             | 3e612c6fd3e115391a5abef34a0a4330180b566204d27e360f9b53760b294a62 |
| `warriors-of-the-universe.xapk` | 2.7.5 (2007005)      | com.GamerMind.Warriors_of_the_Universe_Online | 2b117deb9e98f94ae68c45ea355cb8676a5b7ba0970738bb587942163cfc8111 |

`unzip -t` : aucune erreur dans les deux archives. `unzip -p ... manifest.json` :
identifiants conformes aux fiches Google Play. Dragon Crystal : ARM64, Android ≥ 5.1 ;
Warriors : ARMv7, Android ≥ 6. Le téléchargement n'est pas une preuve
d'installation ni d'exécution sur téléphone. XAPK contient des APK séparés :
il faut un installateur prenant en charge ce format sur un appareil compatible.
Aucune comparaison des certificats éditeur ni analyse antimalware locale n'est revendiquée.

## Implémentation et proposition

[Dragon Pixel](../../../apps/aphrody-examples/crystal-universe/README.md) est la proposition
jouable : styles/couleur personnalisables, combos, sauts, projectiles, charge,
transformation, cinq vagues IA, score, victoire/défaite, pause et reprise.
Graphismes originaux dessinés sur Canvas ; aucune dépendance ajoutée.

Contrôles actuels :

- `bun test examples/crystal-universe/engine.test.js` : 5 réussis, 20 assertions ; énergie/transformation, dégâts/coûts/cooldown, cinq vagues/victoire/score, mort/arrêt, saut/bornes/styles.
- `oxlint --deny-warnings examples/crystal-universe/*.js` : vert.
- Serveur Bun sur `127.0.0.1:4317` : HTML, JS et CSS HTTP 200 avec types corrects ; accès à `GOAL.md` HTTP 404.
- CDP natif local sur `127.0.0.1:9222` : titre, canvas, neuf boutons ; démarrage avec vague 1 et énergie qui évolue ; pause `aria-pressed=true` ; aucune exception JavaScript.
- Vue mobile 390 × 844 : largeur du contenu 390, sept commandes tactiles, capture inspectée.
- Captures hors Git : `prototype-desktop.png`, `prototype-mobile.png` dans le dossier des archives.

Le navigateur natif refuse la navigation vers les adresses privées. Le contrôle
visuel a donc injecté le HTML/CSS et le code local dans un nouvel onglet vierge
par CDP ; la desserte HTTP a été contrôlée séparément. Le chargement complet par
URL dans un navigateur de téléphone et le jeu au toucher physique restent à
qualifier. L'onglet de test a été fermé sans toucher aux autres onglets.

## Dépendance ouverte : indexation native

État historique avant installation : `/home/ubuntu/.local/bin/aphrody web crawl-index --help` répondait `unrecognized subcommand 'crawl-index'` et l'aide `aphrody web --help` confirmait l'absence de cette capacité. Aucun ancien script de crawl n'a été utilisé.
`aphrody home query 'Dragon Crystal Warriors of the Universe' --profile aphrody
--limit 5` retourne `hits: []`.

Installer la capacité produit `web crawl-index` pour pouvoir indexer les fiches
autorisées (profil aphrody, labels omar, maximum 25 requêtes et profondeur 2,
respect robots), puis vérifier leur présence avec `aphrody home query`.
Cette dépendance a été levée le 2026-10-07 par installation de la capacité produit ; voir la campagne ci-dessus. L'achèvement global demeure ouvert pour le jeu complet, le corpus exhaustif et les assets sous licence.

## Nom du jeu — 2026-10-07

Demande authentifiée : [nommer le jeu « Dragon Pixel »](https://discord.com/channels/1554189180030947338/1557354118710829117/1557386591985602601).
Le titre HTML, le titre visible, le README et le message du serveur portent
désormais ce nom. Le chemin technique `examples/crystal-universe/`
a été migré avec ses commandes et liens locaux. Les noms des jeux
ayant inspiré ses mécaniques conservent leur attribution.

Vérification actuelle du renommage : serveur Bun lancé sur `127.0.0.1:4318`,
réponse HTTP 200 analysée : `<title>Dragon Pixel — mini-jeu d'Omar</title>`
et texte du `<h1>` égal à `Dragon Pixel` ; ancien nom absent du HTML servi.
Sortie du serveur : `Dragon Pixel: http://127.0.0.1:4318/`.
Tests moteur : 5 réussis, 20 assertions ; oxlint strict, oxfmt et
`git diff --check` réussis. Aucun déploiement public effectué.

## Consolidation de la racine — 2026-10-07

Le prototype autonome Bun est maintenant sous `examples/crystal-universe/`.
Les commandes de validation ci-dessus décrivent leur chemin historique ; pour
les relancer, utiliser `bun test examples/crystal-universe/engine.test.js` et
`oxlint --deny-warnings examples/crystal-universe/*.js`. Le serveur se lance par
`bun examples/crystal-universe/serve.js`. Les imports relatifs et les ressources
restent dans le même dossier ; aucune copie de moteur ni dépendance ajoutée.

Validation du déplacement : les six fichiers de code/ressources sont identiques
octet par octet à leur version Git avant migration. Les cinq tests moteur passent
(20 assertions). oxlint strict et oxfmt passent avec les règles du dépôt et
l'exclusion globale des exemples désactivée dans des configurations temporaires.
Le serveur Bun sur un port loopback éphémère sert les quatre ressources avec un
contenu identique au disque ; trois chemins non autorisés retournent 404.
Le serveur est arrêté après les sondes. `yolo ops docs check --skip-ecosystem`
passe ; le contrôle global des liens ne trouve aucun lien local cassé mais
relève quatre chemins morts préexistants hors du lot. Aucun build moteur,
rendu navigateur ou activation du fork n'est revendiqué par ce déplacement.

## 2026-10-07 — sources officielles et carte AGE 1000

### État des annonces (vérifié le 2026-10-07)

- Toei Animation annonce **Dragon Ball Super: Beerus** comme édition _enhanced_ de l’anime Dragon Ball Super, pour l’automne 2026 ; la page officielle renvoie à une bande-annonce de lancement et un visuel. Le même communiqué annonce la production de **Dragon Ball Super: The Galactic Patrol**. Aucune image sous copyright n’est reprise dans le prototype.
- Bandai Namco annonce Xenoverse 3 sur PS5, Xbox Series et PC/Steam pour 2027. Les descriptions officielles présentent West City en AGE 1000, son université et ses quartiers, le Great Saiya Squad, un accès d’expédition vers un glacier, la création de héros, la coopération, Soul Assist/Soul Switch/Awoken et des styles de combat. Les captures officielles sont descriptives, non incorporées.
- La carte complète des zones et leurs connexions n’a pas été publiée dans les sources examinées. Le plan livré est une proposition de prototype original, pas une reconstruction fidèle ni une carte officielle. Les fonctionnalités et visuels annoncés peuvent changer avant la sortie.

Sources primaires :

- Toei Animation, annonce « Dragon Ball Super: Beerus » : <https://www.toei-animation.com/dragon-ball-super-beerus/>.
- Toei Animation, « The Galactic Patrol Set For Production » : <https://www.toei-animation.com/dragon-ball-super-the-galactic-patrol/>.
- Bandai Namco Europe, trailer West City (23 juin 2026) : <https://en.bandainamcoent.eu/dragon-ball/news/become-the-hero-of-new-dragon-ball-era-dragon-ball-xenoverse-3>.
- Bandai Namco Europe, guide de combat (11 septembre 2026) : <https://en.bandainamcoent.eu/dragon-ball/news/dragon-ball-xenoverse-3-battle-system-guide>.
- Dragon Ball Official Site, compte rendu de démo : <https://en.dragon-ball-official.com/news/01_4279.html>.
- Steam, fiche publique DB Xenoverse 2 (propriétaire, modes, personnalisation) : <https://store.steampowered.com/app/454650/DRAGON_BALL_XENOVERSE_2/>.

Indexation native effectuée le 2026-10-07 :
`/home/ubuntu/.local/bin/aphrody web crawl-index <4 URL officielles> --label omar-xenoverse3-super-remake --profile aphrody --max-requests 25 --max-depth 2` : 25 requêtes, 24 pages écrites, 0 erreur, 191 chunks, frontier incomplète (450 pending). Les requêtes `aphrody home query --profile aphrody` pour « Xenoverse 3 West City AGE 1000 combat trailer » et « Dragon Ball Super Beerus enhanced visual trailer fall 2026 » retrouvent respectivement les annonces officielles Xenoverse 3/West City et Beerus/visuel. Le profil `aphrody` a été utilisé ; aucune donnée des profils dbfr/ie n’a été consultée.

### Livrable carte

`examples/crystal-universe/age1000-map.js` définit un plan de cinq secteurs originaux ; `game.js` le dessine sur Canvas dans le mini-jeu local. Il s’agit d’un prototype jouable/consultable, non d’un « full game AAA » ; contenu réseau, monde ouvert, assets licenciés et progression persistante ne sont pas présents.

### Périmètre dbxv2, actifs et Steam

Le plan de fusion dbxv2 marque cette intégration incomplète. Le sous-module attendu vers `aphrody-code/dbxv2`, épinglé à `fabc19c0021e3e992786dc2a093a749c8a1c26f0`, est identifié comme propriétaire/sous licence Proprietary. Son checkout est actuellement vide, et aucun checkout/asset dbxv2 correspondant n’a été trouvé au chemin local attendu.

Le scanner Steam existant lit `steamapps/appmanifest_*.acf`, sans jetons ni profils privés ; aucun flux de données de compte, dépôt d'assets de jeu, copie vers le PC/VPS/DBFR ou production CDN n'a été effectué. La licence et l'inventaire complet des assets du jeu/du toolkit ne permettent pas une redistribution publique dans la carte/CDN. Le contenu du jeu reste dans les stores du propriétaire ; aucun résultat d'extraction/données privées n'est ajouté à Git.

## 2026-10-07 — Commandes manette

Dragon Pixel lit maintenant l'API Gamepad du navigateur : stick gauche/croix pour
le déplacement, boutons standard A saut, X combo, B projectile, Y charge, LB
transformation et Start pause/reprise. Le Start est traité sur front montant pour
que l'appui maintenu ne bascule pas plusieurs fois; le polling fonctionne également
après reconnexion. Le module pur `gamepad.js` est servi par le serveur local.

Vérification : ajout d'un test simulant axes, D-pad, boutons, Start et déconnexion;
suite moteur `bun test examples/crystal-universe/engine.test.js` : 6 tests,
24 assertions, tous verts. Oxlint strict, oxfmt et diff-check verts. Le serveur sur
`127.0.0.1:4329` sert `/gamepad.js` (200) et la page (200); recherche RAG `Goku
Namek` via ce serveur renvoie des résultats avec URL source. Aucun périphérique
physique n'était connecté, donc le mapping matériel sur un vrai contrôleur reste
non qualifié. Cette entrée ne fournit pas le rendu 3D/WebGPU ni le multijoueur.

## 2026-10-07 — Atelier de création d'avatar

Dragon Pixel propose maintenant un éditeur local d'avatar original : nom, race,
coiffure, couleurs de peau, cheveux et tenue. Les choix sont normalisés et conservés
dans le `localStorage` du navigateur; l'arène dessine ces traits sans charger d'images
ni de personnages Xenoverse. Si le stockage est indisponible, l'avatar reste
utilisable en mémoire.

Vérification : test couvrant choix valides, normalisation de saisies invalides,
sérialisation/relecture et JSON corrompu. Ces choix pilotent désormais aussi des
formes géométriques dans l'arène WebGPU ci-dessous, sans morph avancé de proportions,
équipement du jeu ou sauvegarde multijoueur.

## 2026-10-07 — Filtre de recherche OCR du manga

Le formulaire d'archives peut maintenant sélectionner `sourceId=manga`; le proxy
autorise seulement ce corpus (ou le mode RAG complet sans filtre) et refuse les
autres identifiants. Le rendu conserve titres, type d'entrée et URL source et
n'enregistre pas les transcriptions dans le dépôt.

Vérification réelle sur le serveur local `127.0.0.1:4332` : `GET /` → 200; recherche
`Bulma Son Goku` avec le corpus manga → 8 résultats cités dont Dragon Ball, tomes
2–15; recherche `Moro` → 8 résultats cités Dragon Ball Super, chapitres 46–64;
chaque résultat annonce `sourceId=manga`. `sourceId=invalid` → 400. Garde-fous
toujours verts : 7 tests / 28 assertions, oxlint strict, oxfmt et diff-check.

Cela connecte l'interface au RAG manga OCR des deux séries, mais les recherches
lexicales ne prouvent pas à elles seules qu'une requête trouve chaque page; les
pages intégrales ne sont pas importées dans l'application. Les relevés de métadonnées
vol. 1/42 et ch1370 ci-dessus restent des échantillons, pas une matrice complète.

## 2026-10-07 — Indexation officielle Dragon Ball

Vérification des règles avant crawl : `en.dragon-ball-official.com/robots.txt`
autorise les chemins publics (`Disallow:` vide). `viz.com/robots.txt` interdit
`/manga/`; ce domaine a donc été exclu. Bandai Namco Europe réserve explicitement
les droits de text and data mining dans son `robots.txt`; aucune page de ce domaine
n'a été crawlée dans cette campagne.

La capacité native installée `aphrody web crawl-index` a indexé la racine officielle
Dragon Ball avec le profil privé `aphrody`, label
`omar-dragonball-official-rag`, profondeur 2 et budget 25 requêtes. Rapport natif :
19 pages écrites, 89 chunks, 0 erreur, 80 pages en attente, campagne incomplète.
`aphrody home query 'site:en.dragon-ball-official.com Dragon Ball manga Super story official'
--profile aphrody --limit 5` retrouve notamment l'actualité officielle d'octobre
sur Saikyo Jump (`/news/01_4460`). Ces pages de site officiel apportent des références
et actualités, pas le texte intégral des 42 tomes ni une preuve d'exhaustivité de
Dragon Ball Super. Aucun scan ni transcription de manga n'a été copié dans le dépôt.

Reprises de la frontier existante (même profil, label, URL autorisée, profondeur 2,
budget maximum 25 par passe) : campagne achevée à 105 tentatives, 60 pages écrites,
140 chunks, zéro erreur, frontier vide et `complete:true`. `aphrody home query`
retrouve les documents indexés sous ce label. La recherche contient des références
officielles, sans changer la limite de couverture documentaire ci-dessus.

## 2026-10-07 — Arène 3D WebGPU et déplacement souris

`examples/crystal-universe/webgpu.js` ajoute une scène originale faite de
géométrie procédurale pour le combattant, les adversaires, le sol et les tirs.
Le rendu utilise l'API WebGPU du navigateur, un pipeline WGSL, profondeur et
redimensionnement par `ResizeObserver`; le Canvas 2D existant reste actif lorsque
WebGPU ou son adaptateur est absent ou que le device est perdu. Aucun modèle
Xenoverse ni asset tiers n'est importé. `game.js` relie le clic/glisser sur l'arène
au déplacement du personnage; attaques et actions restent au clavier, à la manette
et aux boutons tactiles. Race, peau, coiffure, cheveux et tenue sont traduits en
formes originales.

Contrôles : 8 tests du moteur / 32 assertions, dont le déplacement souris,
oxlint strict, oxfmt et `git diff --check` passent; `bun build --target browser`
groupe 6 modules. Les routes locales `/`, `/game.js`, `/engine.js`, `/webgpu.js`,
`/style.css` répondent 200 et le proxy RAG manga renvoie 8 résultats pour `Goku`.
L'outil Aphrody Browser refuse les URL
loopback (`127.0.0.1`) comme IP privée; l'exécution réelle du pipeline et le rendu
sur adaptateur GPU restent donc non qualifiés. Cette évolution est une arène
prototype côté navigateur : elle n'intègre ni moteur Rust/WASM, ni multijoueur,
ni données/assets Xenoverse 2.

## 2026-10-07 — Service Rust de salles multijoueurs locales

`crates/web/dragon-pixel-server` fournit le binaire `aphrody-web-game-server` avec
Axum/WebSocket. Il écoute par défaut sur `127.0.0.1:4320`; les navigateurs d'origine
`http://127.0.0.1:4317` et `http://localhost:4317` sont acceptés, avec liste
additionnelle explicite via `DRAGON_PIXEL_ALLOWED_ORIGINS`. Salles ASCII de 1 à 32
caractères, plafond de 128 salles et quatre joueurs par salle. Les positions sont
bornées à l'arène et les champs avatar sont validés avant diffusion. Le bouton
multijoueur côté page rejoint ou quitte une salle et dessine les autres avatars
dans le rendu WebGPU/Canvas; le mode solo reste disponible serveur arrêté.

Validation : `cargo check`, quatre tests Rust dont deux clients WebSocket réels qui
reçoivent le même état partagé, Clippy strict, huit tests JS / 32 assertions, build
navigateur, lint/format, `diff --check`; endpoints de la page, du module WebGPU, du
service `/health` et du proxy RAG vérifiés localement. L'outil navigateur bloque les
URL loopback, donc le clic UI n'a pas été exercé dans le navigateur intégré.

## 2026-10-07 — Simulation Rust partagée et client WASM

`crates/web/dragon-pixel-core` contient la simulation déterministe sans I/O;
`crates/web/dragon-pixel-wasm` l'expose au navigateur via wasm-bindgen. Le service
Axum et le module WASM appellent la même fonction. En salle connectée, le client
envoie les entrées et affiche les snapshots Rust; hors connexion, il avance le même
cœur WASM local. Le paquet se construit avec
`scripts/build/rust/wasm-package.ts`; Bun sert les deux fichiers générés depuis
`target/wasm-package-stage` (not in repo) (build output).

Vérification : 7 tests Rust réussis (2 cœur, 1 pont WASM, 4 serveur); le test
WebSocket ouvre deux clients et vérifie la présence et une évolution de combat Rust
reçue par le second client. Clippy ciblé `-D warnings`, compilation
`wasm32-unknown-unknown --release`, wasm-bindgen 0.2.129, bundle navigateur Bun,
8 tests JS / 32 assertions, Oxlint strict, Oxfmt et `git diff --check` passent. En
exécution locale, `/`, le module JS WASM et le binaire WASM répondent 200 (139 272
octets); `/health` répond `ok`.

Cette arène partage une simulation de combat par salle; ce n'est pas encore un réseau
d'instances individuelles ni un netcode qualifié contre latence, triche,
reconnexion ou charge. Il n'y a ni comptes, persistance, TLS, service public ni
déploiement. Le navigateur embarqué ne peut pas ouvrir le loopback dans cette
session et l'adaptateur GPU réel reste non testé. Aucun moteur Bevy, asset/data
Xenoverse, contenu Xenoverse 3 ou texte de manga n'a été ajouté. 

## 2026-10-07 — Renderer Bevy/WebGPU dans le client WASM

Le crate `aphrody-dragon-pixel-wasm` ajoute Bevy 0.19.1, uniquement pour la cible
`wasm32-unknown-unknown`, avec les fonctionnalités `3d`, `web` et `webgpu`. Le
canvas `#arena-bevy` héberge une scène procédurale 3D : plateau, lumière, caméra,
combattant, tête/cheveux, ennemis, autres joueurs et projectiles. À chaque frame,
le client transmet l'état du cœur de simulation Rust et l'avatar; Bevy actualise
les modèles. Le chargement est tenté quand le navigateur expose WebGPU et un
adaptateur; le Canvas/WebGPU JS demeure en repli pendant l'initialisation et si la
cible WASM n'est pas construite. Le code n'importe aucune donnée ou ressource de
Xenoverse.

Les crates `dragon-pixel-*` sont depuis sorties du workspace racine (`exclude`,
`[workspace]` et `Cargo.lock` propres) : la commande actuelle est `cargo check
--manifest-path crates/web/dragon-pixel-wasm/Cargo.toml --target
wasm32-unknown-unknown --locked`.

Contrôles du lot : `cargo check -p aphrody-dragon-pixel-wasm --target
wasm32-unknown-unknown --locked`, Clippy WASM strict, le test natif du pont WASM
(1/1), build WASM release et test de chargement du paquet généré dans Bun avec
initialisation du module et ingestion d'un snapshot : verts. Le build release
Bevy a pris 5 min 52 s. `wasm-bindgen` a produit 88 240 684 octets; le Binaryen
installé est v120 et le script standard n'a pas optimisé car cette version ne
reconnaît pas `--enable-bulk-memory-opt`. L'optimisation `-Oz` avec les options
acceptées par v120 a généré un artefact WASM de 33 Mo, conservé uniquement dans
`target/`.

Oxlint strict, Oxfmt et 13 tests JS (60 assertions) passent. L'outil navigateur
refuse les URL loopback dans cette session : l'exécution réelle de l'application,
la création du contexte WebGPU et l'affichage Bevy dans un navigateur n'ont pas
été vérifiés. La scène utilise des primitives originales; ce n'est pas le moteur
commercial Xenoverse 2 ni son contenu. Le corpus RAG, les données/licences
Xenoverse, la portée Xenoverse 3 et le netcode complet restent à réaliser.

## 2026-10-07 — Races supplémentaires pour l'éditeur d'avatar

L'éditeur original ajoute les choix Freezer et Androïde aux quatre choix existants,
avec des détails géométriques distincts en Canvas 2D/WebGPU et validation dans le
service Rust. Source de vérification des six familles annoncées : [présentation
officielle Xenoverse 3](https://en.bandainamcoent.eu/dragon-ball/news/fight-your-own-way-dragon-ball-xenoverse-3).
Le `robots.txt` de Bandai Namco Europe réserve les droits de text/data mining; le
site n'a pas été crawlé et aucun visuel, asset ou texte du jeu n'a été repris.

Vérification : test d'avatar couvre les six valeurs, test serveur valide Freezer et
Androïde; suites Rust/JS et les gates ciblées sont relancées dans ce lot. Il s'agit
de formes de substitution originales, sans représentation canonique ou équipement
du jeu.

Le clic droit de la souris déclenche aussi un tir d'énergie; le clic gauche reste
le déplacement vers le point visé. Le Canvas capture le pointeur pendant le tir et
libère l'action sur relâchement, annulation ou perte de capture pour éviter un tir
resté bloqué. Le menu contextuel est désactivé uniquement sur l'arène.

## 2026-10-07 — Audit métadonnées de la collection manga

Nouvel audit MCP sans copie de transcription : les 42 identifiants DB `vol1` à
`vol42` ont tous retourné un `pageCount` positif, soit 7 844 pages déclarées
(minimum 168, maximum 234 par volume). Les réponses de détail incluent le texte OCR
et sont tronquées par l'API à 90 000 caractères; ce contrôle de `pageCount` ne
prouve donc pas que chaque page possède une transcription complète.

Pour DBS, le catalogue précédemment relevé contient 103 identifiants contigus,
`ch1315` à `ch1417`, et 4 355 pages déclarées. La vérification détaillée fraîche a
obtenu des métadonnées positives pour `ch1315` à `ch1329` (410 pages), puis l'API a
renvoyé HTTP 429 avec sa limite de 60 requêtes/minute à partir de `ch1330`; l'audit
détaillé s'est arrêté là. Aucune nouvelle extraction OCR n'a été faite. Ces nombres
décrivent le catalogue, pas la complétude éditoriale ni les droits de reproduction.

## Reprise des contrôles locaux — 2026-10-07

Contrôles refaits sur l'hôte de build `vps-203bea89` : la suite navigateur passe
(8 tests, 40 assertions), Oxlint strict et Oxfmt passent, et `bun build
--target browser examples/crystal-universe/game.js` regroupe 6 modules
(35,13 Ko). Le serveur local sert le titre Dragon Pixel et son proxy RAG répond
HTTP 200 à `q=Goku Namek&sourceId=manga`, avec 8 résultats dont des URL HTTPS.
Le binaire local du serveur de salles répond `{"service":"dragon-pixel","status":"ok"}`
sur `/health`.

La compilation Rust n'a pas été relancée : le verrou partagé
`/home/ubuntu/build/locks/heavy.lock` était détenu par plusieurs tâches de build
au contrôle `lslocks`. Les tests Rust et la production WASM mentionnés dans les
sections précédentes restent les dernières validations compilées ; ce contrôle
de santé n'est pas un test de WebSocket ni une validation Bevy. Aucun changement
de code ni paquet généré n'a été ajouté par cette reprise. L'objectif complet
reste ouvert : le moteur Xenoverse 2 et ses assets propriétaires sont absents,
Bevy n'est pas intégré, et les métadonnées RAG ne prouvent pas la transcription
exhaustive de chaque page.

## 2026-10-07 — URL WebSocket configurable pour l'hébergement

Le navigateur choisit maintenant `ws://localhost:4320` en développement local,
`ws(s)://<hôte de la page>` ailleurs, ou la base optionnelle
`DRAGON_PIXEL_WS_BASE`. Bun expose la configuration publique via `/api/config`
avec `cache-control: no-store`; ses validateurs rejettent protocoles autres que
`ws:`/`wss:`, identifiants, query et fragment avant exposition. Le client valide
l'URL structurée, n'accepte que les salles existantes (ASCII, 1–32 caractères) et
encode le chemin. Le serveur Axum conserve sa liste d'origines explicite : le
déploiement doit router `/ws/{room}` jusqu'à Axum et définir
`DRAGON_PIXEL_ALLOWED_ORIGINS` avec l'origine exacte de la page. Aucun proxy ni
service public n'a été appliqué.

Vérification : cas unitaires localhost, même origine HTTPS, préfixe configurable,
salle invalide et bases aux schémas/identifiants interdits; `bun test` (13 tests,
60 assertions), bundle navigateur (7 modules), Oxlint strict, Oxfmt et `git diff
--check` passent. Les instances Bun locales `127.0.0.1:4337/4338` servent les
assets et `/api/config` en 200, avec la base `wss://` attendue; un schéma HTTP
configuré est ramené à une valeur vide sans divulguer la configuration invalide.
Le routage proxy, l'allowlist d'une origine de production et une connexion WebSocket
publique restent non qualifiés.
## 2026-10-07 — Morphologie d’avatar synchronisée entre rendus

L’atelier permet maintenant de choisir une silhouette fine, athlétique ou robuste et
une taille comprise entre 85 et 115 %. `avatar.js` normalise et conserve ces choix
avec les avatars existants; `game.js` les applique dans le rendu Canvas, et
`webgpu.js` les répercute sur la géométrie 3D. Le renderer Bevy WASM applique les
mêmes facteurs de proportions aux acteurs locaux et distants. Le serveur multijoueur
valide les valeurs bornées et attribue les défauts compatibles aux anciens messages.

Gates : 14 tests Bun (66 assertions), 5 tests du serveur Rust, `cargo check` du
renderer Bevy pour `wasm32-unknown-unknown`, Oxlint sans avertissement, Oxfmt,
bundle navigateur Bun et `git diff --check` — verts. La vérification navigateur
visuelle n’a pas été exécutée. Cette amélioration concerne la création d’avatar;
elle ne fournit ni moteur Xenoverse 2 ni ses ressources, et le RAG n’est pas devenu
une archive exhaustive intégrée au client.
