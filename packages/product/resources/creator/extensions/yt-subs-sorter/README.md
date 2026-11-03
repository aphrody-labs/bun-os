<!-- SPDX-License-Identifier: Apache-2.0 -->

# YouTube Subs Sorter

Extension de navigateur (= add-on, c'est la même chose) pour ranger ses abonnements YouTube en groupes colorés
(« Combat/FGC », « Dessin », « Musique »…), filtrer le flux et trier la liste des chaînes.

WebExtension Manifest V3, sans dépendance, sans page d'arrière-plan : Chrome, Edge, Brave et Firefox (desktop).

## Installation (non empaquetée)

Chrome / Edge / Brave :

1. Ouvrir `chrome://extensions` (Edge : `edge://extensions`), activer le **mode développeur**.
2. **Charger l'extension non empaquetée** et choisir ce dossier (celui qui contient `manifest.json`).

Firefox (version 140 ou plus) :

1. Ouvrir `about:debugging#/runtime/this-firefox`.
2. **Charger un module complémentaire temporaire…** et choisir `manifest.json`. Le chargement disparaît au
   redémarrage de Firefox ; une installation durable demande une signature Mozilla (AMO).

Optionnel avec `web-ext` installé localement : `web-ext run -s . --target=firefox-desktop` (ou `--target=chromium`),
`web-ext lint -s .`, `web-ext build -s .`.

## Utilisation

- **Liste des abonnements** (`youtube.com/feed/channels`) : un bouton « Groupes » sous chaque chaîne, une barre
  en haut pour filtrer par groupe (ou « Sans groupe ») et trier : ordre YouTube, A → Z, par groupe.
- **Page chaîne ou vidéo** : un bouton « Groupes » à côté de « S'abonner » (bouton flottant en bas à droite si
  YouTube a changé cet emplacement). Une chaîne peut être dans plusieurs groupes ; le nom d'un nouveau groupe se
  saisit directement dans la fenêtre.
- **Flux des abonnements** (`youtube.com/feed/subscriptions`) : barre de filtre par groupe, bascules
  « Masquer les Shorts » et « Masquer les vues », pastille de groupe sur les miniatures.
- **Popup** (icône de l'extension) : groupes (renommer, couleur, supprimer en deux clics, nombre de chaînes),
  réglages (seuil « vue » de 1 à 100 %, pastilles, tri par défaut), sauvegarde JSON (exporter, télécharger, copier,
  importer en fusionnant ou en remplaçant).

## Données et confidentialité

- Tout reste dans le navigateur : `storage.local`, clé `yss`. Aucun appel réseau, aucun code distant, aucune
  télémétrie.
- Permissions : `storage` et l'hôte `https://www.youtube.com/*` (rien d'autre). Firefox : identifiant
  `yt-subs-sorter@aphrody.com`, `data_collection_permissions: none`.
- `storage.sync` n'est pas utilisé : son quota (environ 100 Ko au total, 8 Ko par élément) est trop juste pour
  l'état d'un utilisateur qui a des centaines de chaînes. Pour passer d'un navigateur à l'autre, utiliser
  l'export / import JSON.
- Le fichier d'export est validé à l'import (format, version, clés de chaîne, couleurs, tailles). Une entrée
  invalide est ignorée, pas appliquée.

## Ce qui a été vérifié (2026-10-06)

| Élément                                                                    | État                                                                                                                                                                                                            |
| :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest                                                                   | `web-ext lint` (addons-linter) : 0 erreur, 1 avertissement (Firefox Android non déclaré, volontaire)                                                                                                            |
| Logique pure (`src/core.js`)                                               | `bun test` : 32 tests ; `bun lint .` et `bun fmt --check .` propres                                                                                                                                             |
| Chargement réel Chromium 153 (Chrome for Testing, headless, Playwright)    | OK : injection sur une vraie page chaîne et une vraie page vidéo, sélecteur de groupes, stockage, apprentissage handle / identifiant, navigation SPA vidéo → chaîne, popup (groupes, export / import, réglages) |
| Pas de boucle de mutation                                                  | OK : page au repos, zéro changement DOM provoqué par l'extension                                                                                                                                                |
| Flux et liste (filtre, Shorts, vues, tri, ordre CSS)                       | OK **sur un DOM simulé** (balisage synthétique servi à l'URL YouTube), pas sur le vrai flux                                                                                                                     |
| Session YouTube connectée réelle (`/feed/subscriptions`, `/feed/channels`) | **Non vérifié** (pages derrière connexion)                                                                                                                                                                      |
| Firefox exécuté                                                            | **Non vérifié** (aucun Firefox disponible) ; Edge et Brave non lancés (même moteur que Chrome)                                                                                                                  |

Les captures utilisaient des pages YouTube non connectées. Les noms d'éléments ont aussi été recoupés avec le
bundle de production YouTube du jour.

## Sélecteurs YouTube

Tous sont dans la table `selectors`, en tête de `src/content.js`. Statut :

- **V** vu dans un vrai rendu Chromium non connecté : `ytd-page-manager > [role=main]` (page active, les autres
  portent `hidden`), `ytd-browse #primary`, `ytd-channel-renderer` (lien `a#main-link`, nom `#channel-title`),
  `ytd-video-renderer`, `ytd-channel-name`, `ytm-shorts-lockup-view-model(-v2)`, `a[href^="/shorts/"]`,
  `yt-flexible-actions-view-model` (boutons de l'en-tête de chaîne), `ytd-watch-metadata #owner` et
  `ytd-video-owner-renderer`, liens `/@handle` et `/channel/UC…`.
- **B** trouvé dans le bundle de production (JS et CSS), pas vu rendu : `ytd-rich-item-renderer`,
  `ytd-grid-video-renderer`, `ytd-rich-shelf-renderer[is-shorts]`, `ytd-reel-shelf-renderer`,
  `ytw-thumbnail-overlay-resume-playback-renderer` (barre de progression actuelle, l'ancien
  `ytd-thumbnail-overlay-resume-playback-renderer` n'existe plus dans ce bundle),
  `yt-thumbnail-overlay-progress-bar-view-model`, `#grid-container` flex de la liste des chaînes.
- **?** au mieux : lien de chaîne et nom de chaîne dans les éléments du flux connecté ; ancrage de la barre
  si `ytd-browse` change (repli : barre flottante).

## Limites connues

- YouTube change son DOM sans prévenir : en cas de panne, corriger la table `selectors`.
- Barre de progression présente mais pourcentage illisible : la vidéo est considérée comme vue.
- Masquer beaucoup de vidéos peut faire charger la suite du flux automatiquement.
- Une même chaîne apparaît tantôt en `@handle`, tantôt en `/channel/UC…`. L'équivalence est apprise quand les
  deux sont sur le même élément (page vidéo, en-tête de chaîne) ; sinon, repli sur le nom exact mémorisé, s'il est
  unique. Vidéo en collaboration : union des groupes des chaînes présentes.
- Le tri de la liste utilise le CSS `order` : le DOM de YouTube n'est pas réordonné.
- Firefox : ouvrir le sélecteur de fichiers ferme le popup ; coller le JSON dans la zone de texte marche toujours.
- Firefox Android : non testé.

## Développement

```sh
bun test                                  # logique pure
bun lint -c ../../../../../.oxlintrc.json .
bun fmt --check .
bun tools/make-icons.ts                   # régénère icons/*.png
bun tools/build-css.ts                    # régénère src/yss-tokens.css et popup/tokens.css (--check : vérifie)
```

Structure : `manifest.json`, `src/core.js` (logique pure, export global `YSS` et CommonJS), `src/content.js` et
`src/content.css` (glue DOM), `popup/`, `icons/`, `test/core.test.js`. Les couleurs de l'interface sont les rôles M3 de
la marque Aphrody (`packages/app-ui/src/brand.css`), copiés par `tools/build-css.ts` dans `src/yss-tokens.css`
(variables `--yss-*`, clair et `html[dark]` de YouTube) et `popup/tokens.css` (rôles `--md-sys-color-*`).
