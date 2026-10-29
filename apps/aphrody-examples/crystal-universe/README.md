<!-- SPDX-License-Identifier: Apache-2.0 -->

# Dragon Pixel — proposition pour Omar

Mini-jeu original jouable dans un navigateur : combattant personnalisable, arène
Bevy/WebGPU 3D compilée en WASM avec repli WebGPU JS ou Canvas 2D, combos, sauts, projectiles, charge d'énergie et
transformation de huit secondes.
Cinq vagues d'adversaires IA, score, victoire/défaite, pause et reprise.
Trois styles (équilibré, vitesse, puissance) et couleur personnalisable.
Clavier, clic gauche/glisser pour bouger, clic droit pour tirer, manette Gamepad API et sept boutons tactiles avec
gestion des pointeurs simultanés.
Atelier d'avatar avec nom, six choix de race, coiffure et couleurs de peau, cheveux et tenue;
le choix est conservé dans le stockage local du navigateur.
L’éditeur ajoute une silhouette (fine, athlétique ou robuste) et une taille de 85 à 115 %;
ces paramètres sont rendus par Canvas, WebGPU et Bevy, puis transmis aux joueurs distants.
Les archives Shenron permettent de chercher tout le RAG, les passages OCR des
deux mangas ensemble, ou séparément Dragon Ball (42 tomes) et Dragon Ball Super.
Les vues séparées interrogent le corpus manga partagé, puis filtrent les titres de
série parmi les 25 premiers résultats récupérés; elles ne garantissent pas une
couverture exhaustive des pages OCR.
Le panneau de couverture expose les compteurs globaux du RAG Shenron; ils ne sont
pas ventilés par série et ne certifient pas une transcription page par page.
Le catalogue séparé liste les 42 volumes Dragon Ball et les chapitres DBS annoncés
par Shenron, avec leurs compteurs de pages OCR déclarés; ces métadonnées ne
certifient pas la complétude des transcriptions.

Le prototype s'inspire de conventions générales de jeux d'arène et reste entièrement
original. Aucun graphisme, personnage ou code de jeux commerciaux n'est copié.

Depuis la racine du checkout :

```sh
bun examples/crystal-universe/serve.js
```

Pour le mode multijoueur local, démarrer aussi le service Rust dans un autre terminal :

```sh
cargo run --locked --manifest-path crates/web/dragon-pixel-server/Cargo.toml
```

Construire le cœur de combat WASM avant de lancer le navigateur :

```sh
bun scripts/aphrody/build/rust/wasm-package.ts --manifest-path crates/web/dragon-pixel-wasm/Cargo.toml --crate aphrody-dragon-pixel-wasm --out target/wasm-package-stage/aphrody-dragon-pixel-wasm --name dragon-pixel-wasm
```

Les trois crates `crates/web/dragon-pixel-*` sont exclues du workspace racine :
chacune a son `[workspace]` et son `Cargo.lock`, d'où `--manifest-path`.

Le paquet WASM active Bevy 0.19.1 pour la cible `wasm32-unknown-unknown` avec
`3d`, `web` et `webgpu`. Le renderer crée une arène 3D procédurale et reçoit les
snapshots du combat Rust et les couleurs de l'avatar. Il démarre uniquement quand
le navigateur expose WebGPU et un adaptateur; sinon le rendu WebGPU JS ou Canvas 2D
reste disponible. Les primitives du prototype ne sont pas des modèles Xenoverse.

Ouvrir `http://127.0.0.1:4317/`, choisir le style, puis **Jouer / Recommencer**.
Le serveur de jeu écoute par défaut sur `127.0.0.1:4320`, limite les salles à
quatre joueurs et conserve leur état en mémoire. Chaque joueur rejoint le même code
de salle pour voir les avatars des autres. Le cœur de simulation Rust est partagé
entre le client WASM et le service natif; le serveur maintient également un état de
combat de salle à partir des entrées reçues. Le mode reste jouable en solo si Rust
n'est pas démarré. Aucun déploiement public, compte utilisateur ou stockage réseau
n'a été configuré.

Le client emploie ce port séparé sur `localhost`; sur un hôte distant il utilise
`/ws/{salle}` même origine, à router vers Axum par le proxy de déploiement. Une
base WebSocket absolue ou un préfixe de chemin peut être défini dans l'environnement
Bun avec `DRAGON_PIXEL_WS_BASE` (URL absolue en `ws:`/`wss:`, sans identifiants ni query).
Le serveur Rust doit aussi autoriser explicitement l'origine de la page via
`DRAGON_PIXEL_ALLOWED_ORIGINS`; aucun proxy ni service public n'est configuré ici.

Flèches ou Q/D : déplacement ; Espace : saut ; J : combo ; K : projectile ;
L : charge ; T : transformation ; P : pause. Les commandes sont aussi affichées
dans le jeu. Une perte de focus ou le passage en arrière-plan met en pause.
Manette standard : stick gauche ou croix directionnelle, A saut, X combo, B
projectile, Y charge, LB transformation, Start pause/reprise.

La section **Carte d’expédition · AGE 1000** est un schéma Canvas original de West City
et de ses voies d’accès. Elle utilise seulement les descriptions officielles (campus,
quartiers urbains, complexe Capsule, esplanade et mission glaciaire) ; aucun asset ni
capture du jeu n’est incorporé. Source structurelle : `age1000-map.js`.

```sh
bun test examples/crystal-universe/engine.test.js
oxlint --deny-warnings examples/crystal-universe/*.js
oxfmt --check examples/crystal-universe
```

Téléchargements Android, preuves et limites :
rapport d'exécution.
