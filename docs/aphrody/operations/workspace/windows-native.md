<!-- SPDX-License-Identifier: Apache-2.0 -->
# Contexte de développement, build et déploiement

Correction propriétaire du 2026-10-09 : Aphrody et Bun peuvent être développés
et construits partout où l'hôte, la cible, les outils, les ressources et les
permissions conviennent. Le choix natif, SSH ou Docker dépend du contexte.
Les chemins et hôtes du poste courant sont des exemples de configuration,
pas des restrictions des produits. WSL est retiré du workflow du poste actuel.

Yoyo / aphrody-dev administre tout Aphrody Labs. Omar administre DBFR.
Un compte SSH ou une observation historique ne donne pas une autorité globale.

| Fonction | Propriétaire et destination |
| --- | --- |
| Sources Aphrody | Checkout courant ou `APHRODY_WORKSPACE` ; ici `C:\src\aphrody` |
| Fork Bun | Checkout sélectionné avec `APHRODY_BUN_CHECKOUT` ou découvert comme frère du workspace ; ici `C:\src\bun` ; les modifications runtime restent dans le fork |
| Développement | Outils natifs de l'hôte choisi, avec leurs aides actuelles |
| Builds | Hôte natif, fabrique SSH ou Docker qualifié ; verrous et sccache conservés. Fabrique SSH actuelle : `vps` |
| Qualification Linux locale | Docker ou hôte Linux natif ; exemples locaux Alpine 3.24 et Ubuntu 26.04, ressources bornées et caches nommés |
| Déploiements actuels | `dbfr`, depuis des artefacts qualifiés ; un hôte de production reçoit des builds seulement si une allocation le prévoit |
| Home partagé | Home Aphrody configuré ; ici `C:\Users\aphro\.aphrody` ; `aphrody home` et `aphrody graph` |
| Plugins | `<home>/plugins/aphrody`, `<home>/plugins/yolo` |
| MCP | Serveur unique `aphrody-mcp`, avec les fonctionnalités compilées réellement exposées |

## Commandes du checkout

```powershell
# Depuis le checkout sélectionné ; adapter --state au home du contexte.
aphrody home status
aphrody graph --source graph:aphrody report
bun packages/engine/yolo/src/index.ts workspace code-edit --help
bun scripts/build/rust/vps-cargo.ts tunnel up
bun scripts/build/rust/vps-cargo.ts run -- check -p <crate> --locked
bun scripts/build/rust/cargo-serial.ts --msvc check -p <crate> --locked
```

Le tunnel Windows lance un superviseur Bun natif, SSH natif et le daemon Git
local sous tmux natif. Il n'utilise ni shell WSL ni socket ControlMaster Unix.
L'hôte distant reste Linux et utilise le wrapper Cargo sérialisé et tmux.
La configuration est [vps-cargo.json](../../../../infra/config/host/vps-cargo.json).
Les chemins distants existants `aphrody-wsl`, `vu-wsl` restent
des identifiants de stores/caches : ce lot ne les déplace ni ne les purge.

Pour Linux local, utiliser les wrappers de jobs tmux du fork sélectionné
après leur aide : `--alpine` ou `--ubuntu`, ressources bornées, volume nommé
pour les gros arbres. Les images déclarées sont
`ghcr.io/aphrody-labs/alpine:3.24` et `aphrody/build-linux:26.04` ; leur présence
et leur digest doivent être vérifiés avant exécution. Une instruction ou une
configuration d'image ne prouve pas un build ni un déploiement réussi.

## Mémoire, sessions et configuration

Les corrections de fichiers réutilisent les propriétaires Workspace :
`imports-exports` pour l'inventaire AST, `path-audit --repository` pour les
chemins d'hôte, `docs-consolidation` pour les doublons et réécritures vérifiées,
et `docs generate/check/links` pour les références générées et liens.
Le script historique `fix-refs.nu` exige une table de renommages actuellement
absente ; il ne constitue pas une correction exécutée. `workspace-repair`
réutilise désormais ces propriétaires avec `--root` : aperçu par défaut,
application des corrections de chemins avec préservation des fichiers modifiés,
inventaire AST et contrôles docs/liens parallèles. Le CLI natif installé route
rename, parse, bench et verify vers le propriétaire existant du fork sélectionné
par APHRODY_BUN_CHECKOUT. Si le binaire Bun ne contient pas encore ces builtins,
le pont exécute le même devtools.ts du fork après une sonde d'aide isolée ; il
ne rejoue jamais une commande de mutation. Aucune copie du moteur n'est créée.

Les homes `aphrody`, `dbfr` et `ie` restent séparés avec `--profile`.
Les imports sont additifs, précédés d'un aperçu et d'une sauvegarde vérifiée.
Les historiques bruts, cookies et authentifications restent dans les stores
natifs des fournisseurs. Les métadonnées de sessions peuvent pointer vers ces
stores par des références locales, sans déplacement des conversations.

L'import du 2026-10-09 a ajouté 120 fiches mémoire et indexé 367 références
de sessions Claude/agy dans les homes correspondants. Trois configurations
ont un manifeste privé de référence ; un fichier de réglages vide est conservé
sans conversion. La CLI installée n'a pas d'importeur de réglages Claude/agy :
aucune activation, copie d'authentification ni parité de configuration n'est
revendiquée par cet import. Une opération distincte du propriétaire de plugins
a ensuite actualisé les caches Claude/Codex et activé Aphrody 2.3.0 dans Codex,
avec Yolo désactivé et un seul MCP global canonique. Les sessions déjà ouvertes
doivent être redémarrées pour recharger les hooks. Les reçus et chemins source
restent dans le home privé, hors Git.

Le graphe natif a été rafraîchi depuis le checkout sélectionné ; trente plans
actifs Aphrody et cinq plans Bun ont été indexés dans le seul profil aphrody.
Les 120 mémoires et 367 références importées sont vérifiées présentes dans
leurs domaines. Les contenus mémoire/session des quatre profils sont inchangés
par ce rafraîchissement et l'intégrité SQLite passe.

## Positionnement et qualification

La cible propriétaire est un OS dans le navigateur et une CLI multiplateforme
complète, avec les capacités IA sous `aphrody ai`. CLI, FFI, MCP et kernel
délèguent aux mêmes crates/packages propriétaires. Les contrats et critères
de qualification restent dans [PLAN.md](../../PLAN.md) et
[desktop-web](../../plans/desktop-web/PLAN.md). Les travaux CLI/FFI/UI
concurrents restent distingués des correctifs qualifiés dans
[le reçu d'audit](agy-audit-2026-10-09.md). Le CLI Windows installé a passé
127 tests Rust, Clippy strict et les checks des consommateurs CLI/FFI.

## État vérifié du poste — 2026-10-14

- Les checkouts actifs Aphrody, Bun OS, Material et APT sont sous `C:\src`.
  Le checkout Bun est exposé par `C:\src\bun`, jonction vers `C:\bun` ;
  gardez cette jonction tant que des sessions ChatGPT ouvrent le dépôt physique.
- La racine `C:\src\aphrody` appartient à `APHRODY\aphro`. Les répertoires
  descendants échantillonnés `.git`, `crates`, `packages`, `scripts`, `tools`
  et `var` appartiennent encore à `BUILTIN\Administrateurs`. Le jeton courant
  ne peut pas réattribuer ces objets sans les privilèges Windows de prise de
  possession et de restauration ; ne prétendez pas que le changement est fait.
- Les sept répertoires de runs sont dans
  `C:\src\aphrody\var\runs-legacy-20261014`. `C:\aphrody\var` est vide et
  conservé. Les variables utilisateur `APHRODY_ROOT`,
  `APHRODY_MONOREPO_ROOT` et `APHRODY_PY_ROOT` résolvent sous `C:\src`.
- Aucun processus autonome `aphrody.exe` ou `aphrody-mcp` n'a été trouvé.
  Les MCP Bun, les builds du fork et WireGuard restent
  des propriétaires ou usages distincts ; ne les arrêtez pas comme processus
  Aphrody.
