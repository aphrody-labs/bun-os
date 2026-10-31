<!-- SPDX-License-Identifier: Apache-2.0 -->

# creator-kit

Petits outils locaux pour un créateur (jeux de combat, dessin, stream) : réponse point par point à une liste de
demandes. Tout tourne sur le PC, rien n'est envoyé ailleurs sauf les services que tu configures toi-même
(Challonge, Discord, serveur de traduction).

## Les demandes et où les trouver

| Demande                                                   | Outil                                                           | Détails                                                |
| :-------------------------------------------------------- | :-------------------------------------------------------------- | :----------------------------------------------------- |
| Bot qui monte les tournois Challonge                      | `creator-kit challonge`                                         | [Challonge](#challonge)                                |
| Récupérer les images d'une galerie de wiki                | `creator-kit wiki-images`                                       | [Wiki](#wiki-images)                                   |
| Optimiser la RAM et les logiciels Adobe                   | `creator-kit adobe-clean`                                       | [Adobe](#adobe-clean)                                  |
| Optimiser le stockage du PC                               | `creator-kit disk-clean`                                        | [Stockage](#disk-clean)                                |
| Compresser des images en local                            | `web/image-compressor/index.html` et `creator-kit img-compress` | [Images](#compresser-des-images)                       |
| Traduire des vidéos en anglais, sans traduction littérale | `creator-kit video-translate`                                   | [Vidéo](#video-translate)                              |
| 10 % de l'écran mort                                      | `windows/dead-zone.ps1`                                         | [windows/README.md](windows/README.md)                 |
| Trier les abonnements YouTube                             | `extensions/yt-subs-sorter/`                                    | [extension](extensions/yt-subs-sorter/README.md)       |
| PNGTuber-Plus : combinaisons de touches                   | `patches/pngtuber-plus-hotkey-combos/`                          | [patch](patches/pngtuber-plus-hotkey-combos/README.md) |
| Playnite : lancement au démarrage + optimisation          | `windows/playnite-boost.ps1`                                    | [windows/README.md](windows/README.md)                 |
| Stacher7 : blocage des cookies                            | `windows/stacher-cookies.ps1`                                   | [windows/README.md](windows/README.md)                 |

Pas fait : la partie « ADOBE POUR TOI » (GenP, wiki dbzer0, invitation Stoat). C'est un outil de contournement de
licence Adobe : il n'est ni installé, ni documenté, ni automatisé ici. Les points Adobe couverts sont légitimes :
`adobe-clean` vide les caches et libère la RAM de ton Adobe, quelle que soit sa licence.

## Double clic

Le double-clic sur `creator-kit.exe` ouvre le menu console. `Aphrody-Setup.exe` (rôle créateur) installe le kit dans `%LOCALAPPDATA%\Aphrody\Creator`.

## Installer

- **Windows** : télécharge le pack sur <https://creator.aphrody.com>, décompresse, lance `creator-kit.exe`. L'exe se met à
  jour tout seul en arrière-plan (`CREATOR_KIT_NO_UPDATE=1` pour couper, `creator-kit self-update` pour forcer).
  Détails : [docs/operations/infra/CREATOR.md](../../../docs/operations/infra/CREATOR.md).
- **Avec [Bun](https://bun.sh)** : `bun packages/infra/product/src/creator/cli.ts <commande>`.

`creator-kit --help` liste les commandes ; `creator-kit <commande> --help` détaille les options.
Toutes les commandes qui modifient quelque chose sont en simulation tant que tu n'ajoutes pas `--apply`
(ou, pour la compression d'images, elles n'écrasent jamais l'original).

**Thème Windows** (dans le pack, `windows/theme/`) : thème clair et sombre Material 3 tiré de la couleur du logo (`#951ae2`, variante fidelity), fonds d'écran unis. `install-windows.ps1` simule tant que tu n'ajoutes pas `-Apply` et garde l'état précédent ; `uninstall-windows.ps1` revient en arrière. Non testé sur un vrai Windows.

## wiki-images

```
creator-kit wiki-images https://guilty-gear.fandom.com/wiki/Sol_Badguy/Gallery
creator-kit wiki-images <url> --category "Nom de la catégorie" --depth 1 --out C:\Images\gg
creator-kit wiki-images <url> --prefix "Sol_" --ext png,webp --min-size 50 --dry-run
```

Parle à l'API MediaWiki du wiki (Fandom, Dustloop, Wikipédia…), détectée à partir de l'URL : pas de scraping de la
page, donc la galerie complète en quelques requêtes. Reprend là où il s'est arrêté (fichiers déjà présents de même
taille ignorés), 4 téléchargements en parallèle, écrit `manifest.json` (page source de chaque fichier). Vérifié en
réel : la galerie de Sol Badguy sur le wiki Guilty Gear Fandom renvoie 160 fichiers (69,9 Mo) en `--dry-run`.
Les images restent soumises au droit d'auteur du wiki : usage personnel.

## adobe-clean

```
creator-kit adobe-clean status          # RAM, processus Adobe, plus gros consommateurs
creator-kit adobe-clean free --apply    # ferme les services Creative Cloud en arrière-plan
creator-kit adobe-clean cache --apply   # vide les caches régénérables
creator-kit adobe-clean all --apply
```

- `free` ne ferme jamais Photoshop, Premiere, After Effects, etc. et ne fait rien tant qu'une application Adobe est ouverte.
- `cache` vide `%APPDATA%\Adobe\Common\Media Cache Files`, `Media Cache`, `Peak Files`, le cache Camera Raw et les
  fichiers « Photoshop Temp » orphelins ; refusé tant qu'une application Adobe tourne. Emplacements par défaut de
  Premiere confirmés dans la doc Adobe (communauté Adobe, « clear your media cache in Premiere Pro »), fichiers
  « Photoshop Temp » orphelins supprimables Photoshop fermé selon l'aide Adobe ; l'emplacement du cache Camera Raw est
  l'emplacement par défaut connu, non revérifié ici. Si tu as déplacé tes caches, ajoute `--extra <dossier>`.
- Les projets, catalogues Lightroom et préférences ne sont jamais touchés.

## disk-clean

```
creator-kit disk-clean scan                       # espace libre, caches récupérables, plus gros dossiers/fichiers
creator-kit disk-clean clean --apply              # caches navigateurs, shaders GPU, temporaires, Discord, npm/bun…
creator-kit disk-clean clean --only chrome,discord --apply
creator-kit disk-clean dupes --root D:\Videos --min-size 50 --report doublons.json
```

`clean` ne vide que des caches que les programmes reconstruisent seuls, ignore un navigateur ou Discord ouvert, et
saute les fichiers verrouillés. `dupes` ne supprime rien : il liste les doublons exacts (taille, puis empreinte
SHA-256) et ce que garder une seule copie libérerait. Pour aller plus loin (admin, non automatisé) :
`cleanmgr /sageset:1`, `Dism /Online /Cleanup-Image /StartComponentCleanup`.

## Compresser des images

**Page locale** : ouvre `web/image-compressor/index.html` dans Chrome, Edge ou Firefox (double-clic, hors ligne).
Glisser-déposer ou Ctrl+V, format (WebP par défaut, JPEG, AVIF si le navigateur sait l'encoder, PNG), qualité,
taille maximale, résultat image par image et en `.zip`. Vérifié dans Chromium (page chargée en `file://`, PNG de
test 224,9 Ko -> 29,9 Ko en WebP) ; le `.zip` est vérifié par test (`unzip`).

**Ligne de commande** (lots, dossiers) :

```
creator-kit img-compress C:\Photos --recursive --max-width 2000
creator-kit img-compress a.png b.jpg --format webp --quality 75 --out C:\Photos\web
```

Les originaux ne sont pas modifiés (sorties dans `compressed/`), un résultat n'est gardé que s'il est plus léger.
PNG : palette 256 couleurs par défaut (`--png-lossless` pour garder tous les pixels). Exemple mesuré sur 5
captures d'écran du dépôt : -65 à -77 % en PNG palette. Utilise `Bun.Image` (présent dans le runtime Bun du
projet ; sinon utilise la page locale).

## challonge

Voir [docs-challonge.md](docs-challonge.md).

## video-translate

Voir [docs-video-translate.md](docs-video-translate.md).

## Contrôles

```
bun test                                   # dans packages/infra/product
bun check --noEmit -p packages/infra/product/tsconfig.json
```
