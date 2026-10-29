# Historique du stockage secondaire (12–21 août 2026)

> **Compte rendu historique, clôturé le 21 août 2026.** Les observations et
> adresses ci-dessous décrivent l'état constaté à cette date et ne constituent
> ni un inventaire actuel ni une procédure d'exploitation. Le contenu alors
> conservé sur le second VPS a été rapatrié sur le VPS principal, vérifié puis
> supprimé de l'hôte secondaire. Aucun outil d'archivage secondaire n'est
> maintenu par ce dépôt.

## Ce qui est revenu, et où

| Contenu | Volume | Emplacement sur le VPS principal |
| --- | --- | --- |
| Médias de tweets + assets (`/home/ubuntu/apps/rg-storage`) | 5,4 Go | `/var/www/rg-storage/` — servi de nouveau en local |
| Sauvegardes Postgres (`/home/ubuntu/apps/rg-backups`) | 609 Mo | `~/rg-backups/` |
| Corpus audio niers (`/home/ubuntu/apps/niers-corpus`) | 156 Mo | `~/niers/var/corpus/` |
| Site achillée retiré, espace de travail azalée, journaux `rg-stats` | 15 Mo | `~/rg-archive-vps2/` |

Deux conséquences de configuration, faites dans le même mouvement :

- `infra/nginx/supabase-compat.inc` n'a **jamais** contenu les deux blocs
  `proxy_pass http://51.255.162.6:8811/` qui avaient été ajoutés à la main dans
  `/etc/nginx/conf.d/` : la copie active a simplement été réalignée sur le
  dépôt, et `/storage/v1/object/public/{tweets,assets}/` repasse par
  `rg-storage.service`. Vérifié avant et après bascule sur le même média :
  200, 264 579 octets dans les deux cas.
- Le vhost `rg-tweets` du second VPS (port 8811, `allow` sur l'IP du principal)
  a été retiré de `sites-enabled`.

### Le corpus audio n'est pas revenu entier, et c'est voulu

`/home/ubuntu/apps/niers-corpus/audio_awb` pesait 8,25 Go pour 5 512 fichiers. Comparés aux
`.awb` réellement présents dans les CPK locaux (index Redis `iev:file:index`,
4 559 noms distincts), **164 fichiers seulement n'existaient nulle part
ailleurs**. Ceux-là sont revenus (43 Mo) ; les autres ont été supprimés, parce
qu'un extrait d'archive dont l'archive est intacte à côté n'est pas une
sauvegarde, c'est un doublon. `data/packs` (not in repo) reste sur le VPS principal, donc la
régénération est possible à tout moment.

## Méthode de vérification employée à l'époque

Les transferts historiques utilisaient rsync sur SSH. La source locale n'était
supprimée qu'après comparaison du nombre de fichiers et du volume total avec la
copie distante. Un index et des témoins locaux indiquaient où retrouver les
éléments déportés. Ces détails documentent l'opération passée et ne sont pas des
instructions pour lancer un nouvel archivage.

## Ce qui a été déporté le 12 août 2026

| Contenu | Volume | Pourquoi c'est froid |
| --- | --- | --- |
| `data/dx11/menu` (not in repo) (69 624 PNG) | 12 Go | Cache pur — voir ci-dessous |
| `niers/var/niers.sqlite` | 6,8 Go | Base de reverse-engineering, lue seulement par `nie-cli` et `nie-explorer` en développement ; aucune unité systemd ne la référence |
| `niers/var/ghidra-proj` | 450 Mo | Projet Ghidra, outillage hors ligne |
| `niers/data/backups` | 105 Mo | Sauvegardes de données inagle |

Purges locales complémentaires : `~/.cache/puppeteer` (641 Mo — un Chromium
orphelin, aucune référence dans le dépôt), `node-gyp`, `pip`, les miroirs SQLite
azalée au-delà des deux plus récents, et les journaux systemd ramenés à 100 Mo.

## Suppressions définitives — chaîne APK Android et navigateurs

Retiré le 12 août 2026, sans passer par l'archive : ce n'est pas du froid à garder.

**Chaîne d'extraction de l'APK Cross (≈ 5 Go).** L'arborescence
`niers/data/cross-apk` (1,6 Go local), les trois lots déjà déportés (3,3 Go sur le
stockage secondaire), l'unité `cross-apk-fetch.{service,timer}` et les paquets
Android du système (`adb`, `apksigner`, `libapksig-java`, `android-udev-rules`,
`/usr/lib/android-sdk`).

Ce qui reste, et qui suffit : les données **dérivées** de cette extraction sont
committées et légères — `packages/azalee/src/data/cross/*.json` (1,6 Mo) et
`packages/inagle-cross` (not in repo) (1,8 Mo). La page `/cross` d'azalée continue de répondre
200 ; aucun module du dépôt ne lisait `niers/data/cross-apk` à l'exécution.

Une seule perte : le test `hca_ievr_dechiffrement_cle_correcte` de
`nie-model-serve`, derrière la feature `real-audio`, pointait un `.awb` de cet
arbre comme fixture. Il était déjà opt-in et non distribué.

**Navigateurs (≈ 870 Mo).** Deux Chrome complets cohabitaient sur une machine sans
écran. Purgé : le paquet `google-chrome-stable` (`/opt/google/chrome`, 432 Mo) et
les profils inutilisés `~/.config/google-chrome` (239 Mo) et `~/.config/chromium`
(198 Mo) — aucun descripteur ouvert, dernière écriture en mai et août.

Conservé : `/usr/local/chrome` (Chrome **for Testing** 147), la cible des liens
`google-chrome` et `chromium` du `PATH`. C'est le navigateur d'automatisation, et
`bxc` — trois services en cours, dont deux crawlers 24/7 — est le seul outil
toléré pour les tests et le scraping. Ses journaux ne mentionnent Chrome nulle
part sur trois jours (il travaille en `lightpanda` et `curl-impersonate`), mais le
retirer casserait le repli d'un service en production pour 370 Mo.

## Le cas `data/dx11/menu` (not in repo) — pourquoi 12 Go étaient redondants

Ce dossier contenait 69 624 PNG **pré-décodés** par `niers menu-predecode`. Ce
n'est pas une source : c'est un cache du décodage G4TX→PNG que
`nie-model-serve` (:8790) sait faire à la volée depuis les CPK, qui eux restent en
local.

Trois vérifications, parce que le CDN en dépend :

1. **Image identique.** Le PNG rendu par le décodeur et celui du dump : mêmes
   dimensions (3924 × 2932), même sRGB 8 bits, et `compare -metric RMSE` **nul** —
   pixel pour pixel identiques. Les octets, eux, diffèrent : le décodeur compresse
   mieux (2,36 Mio contre 2,94 Mio), ce qui allège aussi le transfert.
2. **Latence égale.** 30–40 ms par le décodeur contre 27–157 ms par le dump —
   `nie-model-serve` est en Rust avec un cache CPK de 8 Gio en mémoire.
3. **Chemin réel de la galerie.** La variante `?w=400&format=webp` (celle que sert
   `/gallery`) répond 200 avec la source absente.

Et surtout, le trafic : sur les sept jours de journaux nginx conservés,
`/dx11/menu/` a reçu **397 requêtes, dont 394 en 404**. Un seul PNG de ce dump de
69 624 fichiers avait été servi avec succès. Il occupait 12 Go pour rien.

> **Piège de méthode.** Une première vérification avait conclu « octet pour octet
> identique » : le fichier avait été renommé, mais nginx le servait encore depuis
> son cache de descripteurs. La comparaison n'était valable qu'une fois le fichier
> réellement absent. De même, échantillonner les chemins des journaux sans filtrer
> sur le code de retour donne surtout des chemins qui échouaient déjà.

### Trou préexistant — corrigé depuis

Ces 394 requêtes en échec n'étaient pas causées par le déport : elles échouaient
déjà. Azalée demandait des **textures nommées** de conteneurs G4TX sous la forme
`<atlas>_<texture>.png` — `whs00810_whs00810.png`, `u11727100_l_u11727100_1.png`,
`icon_item07_uni_u031801.png` — un nommage propre à l'ancien dump disque, qui
n'existe dans aucun chemin CPK et que `nie-model-serve` ne savait pas produire :
il décodait un G4TX entier, pas une texture nommée à l'intérieur.

Le décodeur sait désormais sélectionner une texture par son nom, et le nom passe
par le **chemin** (le service supprime la query string avant tout routage, une API
en `?tex=` était donc impossible). Contrat retenu :

```
/dx11/menu/<chemin>.png                     → fichier 1:1  (data/dx11/menu/<chemin>.g4tx)
/dx11/menu/<chemin>.g4tx/<texture>.png      → texture nommée dans le conteneur
```

Mesuré sur un même fichier :

```
/dx11/menu/220_img/telop_waza/fr/whs00810.png             200  173 166 octets
/dx11/menu/220_img/telop_waza/fr/whs00810.g4tx/whs00810.png  200  173 166 octets
/dx11/menu/220_img/telop_waza/fr/whs00810_whs00810.png    404   (forme du dump, abandonnée)
```

La sélection est réelle et non un repli sur la plus grande texture : deux textures
du conteneur `200_icon/02_icon_item/icon_item05.g4tx` (80 textures nommées)
rendent bien deux images distinctes (`eq_ac0100101` et `eq_ac0108001`, md5
différents). L'ancienne forme composée par underscore reste volontairement en 404.

nginx était déjà prêt pour ça : `location ^~ /dx11/` fait
`try_files $uri @cpk_live`, et `@cpk_live` proxifie vers le décodeur. Le dump
absent, tout passe par le décodeur sans changement de configuration.

`data/dx11/model` (not in repo) (227 Mo) reste en local : l'unité `nie-model-serve` le référence
explicitement (`--glb-dir`).

### Effet de bord corrigé dans `cdn-variants`

`apps/cdn-variants/server.ts` (not in repo) (passé dans `niers`) tentait d'abord l'ancien décodeur `iecode-cdn`
(:8788), retiré du dépôt le 11 août 2026 et dont le port ne répond plus, puis
seulement niers. Tant que le dump couvrait presque tout, cet aller-retour perdu
restait rare ; le dump parti, il serait devenu le cas courant. `nie-model-serve`
est donc passé en primaire, `LIVE_ORIGIN` en simple repli.

## Ce qui ne doit jamais être déporté

- **`data/packs` (not in repo) (57 Go)** — les archives CPK. C'est la source de tout le contenu
  décodé en direct par le CDN. Les déporter couperait le CDN.
- **`data/dx11/model` (not in repo)** — référencé par l'unité `nie-model-serve`.
- **`/opt/google/chrome`** — le navigateur que pilote `bxc`.
- **`niers/target`** — contient le binaire `nie-model-serve` en service.

## Le second VPS aujourd'hui

Il n'héberge plus que **bxc** (automatisation de navigateur : API,
crawler, ordonnanceur), plus PostgreSQL, Redis, nginx et un serveur de fichiers.
Son disque de 96 Go était plein à 91 % le 21 août 2026 ; après rapatriement et
nettoyage il est redescendu à environ 60 %.

Deux pièges rencontrés ce jour-là, qui valent pour n'importe quel nettoyage :

- **Un dossier vide peut être une dépendance.** Supprimer les caches
  `apps/*/.bun-cache` a mis un service en échec instantané
  (`226/NAMESPACE`) : l'unité les monte via ses directives d'espace de noms, et
  systemd refuse de démarrer si le point de montage n'existe pas. Recréer les
  dossiers vides a suffi.
- **Ce qui fuit revient.** 930 profils Chrome éphémères (`scoped_dir*`, 2,9 Go)
  s'étaient accumulés sous `~/.config/google-chrome-headless` parce qu'un
  lancement headless mort ne nettoie pas le sien. Purger sans traiter la fuite
  n'aurait rien réglé : une règle `tmpfiles.d` les efface désormais au-delà de
  24 heures.
