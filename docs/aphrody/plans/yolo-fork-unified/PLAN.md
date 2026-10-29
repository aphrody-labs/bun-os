> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# yolo et le fork Bun : un seul produit runtime

Directive propriétaire du 2026-10-06 : le CLI `yolo` et le fork Bun (`aphrody-labs/bun`) forment un seul produit
runtime. Le binaire fusionné s'appelle **`yolo`** ; **`bun`** reste un alias compatible (lien, même fichier,
`argv0` `bun`). Les identités publiques existantes (noms de commande, paquets `@aphrody/*`, schémas) ne changent pas.

Rattachement : [PLAN.md §6](../../PLAN.md), BUN-FORK-UNIFIED-NATIVE. Le fork lui-même (patches, synchro upstream,
releases `aphrody-v*`, npm `@aphrody/bun-runtime`) : [Bun dans Aphrody](../../reference/upstream-bun/APHRODY-FORK.md).

## Cible

- Un fichier exécutable produit par `bun-forge` : `yolo`. Lancé comme `yolo`, il expose les commandes `yolo`
  (CLI, `forge`, `ops`, `workspace`, `update`…) en natif ; lancé comme `bun` (lien `bun -> yolo`), il se comporte
  comme Bun. Aucune copie du moteur : un seul fichier livré (le CLI est compilé sur le moteur qui vient d'être construit,
  `bun-forge --yolo-root`), pas de second binaire Bun à côté.
- `yolo` (ancien exécutable compilé, `~/.local/bin/yolo`) devient un alias de compatibilité du binaire fusionné
  jusqu'à sa disparition ; `bun-fork` (lien d'activation provisoire) disparaît au profit de `yolo`/`bun`.

## État mesuré (2026-10-06)

Architecture retenue : le fork construit le moteur ; `bun-forge` compile ensuite le CLI `yolo` sur ce moteur
(`bun build --compile` exécuté par le moteur qui vient d'être construit), ce qui donne **un seul fichier** `yolo`.
Un correctif de deux lignes de logique dans le fork (`src/runtime/cli/mod.rs`) fait que tout exécutable compilé lancé
sous le nom `bun` est le moteur (le chargeur d'exécutable autonome est ignoré quand `argv0` est `bun`) ; sous le
nom `yolo` il exécute le CLI embarqué ; sous le nom `vu` le CLI délègue à l'artefact `vu`. Les liens `bun` et
`vu` pointent vers `yolo` : aucune copie du moteur.

- [x] Fork `aphrody-labs/bun:main` `a4d88d124` (avance `41a2ff302d` en fast-forward, sans force) : (1) `argv0`
  `bun` = moteur même avec un CLI embarqué, `BUN_BE_BUN=1` reste valable ; (2) `bun:ffi`
  `dlopen(chemin, symboles, { global: true })` ouvre en `RTLD_NOW | RTLD_GLOBAL` (`DynLib::open_global`,
  `RTLD::NOW/GLOBAL`, types bun-types (ffi.d.ts du fork)), défaut inchangé (`RTLD_LAZY`). Tests du fork :
  `test/js/first_party/runtime/dlopen-global.test.ts` (2, deux bibliothèques C dont une liée `-z now`) et
  `argv0-bun-alias.test.ts` (2).
- [x] `bun-forge` : l'artefact est `yolo` ; `--yolo-root <monorepo>` (+ `--yolo-asset`, `BUN_FORGE_YOLO_ROOT`)
  compile le CLI (`packages/engine/yolo/src/index.ts`, drapeaux de `scripts/release/compile-flags.ts`) sur le moteur construit ;
  les liens `bun` et `vu` sont créés ; la fumée exécute le moteur par `bun` (`argv0` vérifié), `yolo version` (CLI
  embarqué) et `vu --version` (`argv0` `vu`, code 127 sans artefact) ; le plafond glibc 2.39 s'applique au fichier
  final. Les tests `first_party` tournent sur le moteur tel que construit (un `yolo` compilé relancerait son CLI quand
  un test crée un processus fils avec `process.execPath`). 28 tests forge.
- [x] Reçu de la fabrique (VPS, `BUN_FORGE_HOME=/home/ubuntu/bun-forge-home`) pour `a4d88d124178` : build 569 s,
  157 tests `first_party` verts (160 avec 3 `todo`, dont les 4 nouveaux), `yolo` 86 689 872 octets sha256
  `7c6b4c6e…5aa6`, glibc 2.43 → 2.38. Installé sous `~/.local/share/aphrody/yolo/a4d88d124/` (`yolo`, liens `bun`
  et `vu`, reçu) sans toucher aux liens du PATH : `yolo version` `yolo 0.1.0 (… Bun 1.4.3)`, `bun --revision`
  `1.4.3-canary.1+a4d88d124`, `vu --version` délègue au vrai artefact `~/.vu` (CPython 3.12.15, uv 0.12.23, ruff
  0.16.10), `dlopen` de la libpython de l'artefact avec `{ global: true }` : `Py_GetVersion()` répond, une seule
  libpython mappée.
- [x] CLI : `yolo vu …` et `vu …` (`packages/engine/yolo/src/vu.ts`, `runVu`, `isVuArgv0`) vérifient le manifeste de
  l'artefact puis l'exécutent ; 127 sans artefact, 1 si la vérification échoue ; l'artefact est chargé, jamais lié.
- [x] Packaging : `scripts/release/release.ts` empaquette l'artefact de la forge (`YOLO_BINARY`) avec les liens
  `bun` et `vu` (chemin `packages/engine/yolo` corrigé) ; `packages/engine/yolo/install.sh` vérifie l'alias `bun` de la livraison et
  accepte `YOLO_NO_ALIASES=1` pour ne pas masquer un `bun`/`vu` existant du PATH.
- [x] Activation locale (2026-10-07) : la release qualifiée `qualification-20261007-embedded` (moteur `a4d88d124`,
  `libaphrody_ffi` ABI 1.5 embarqué) est installée par `install.sh` dans `~/.yolo` (`yolo`, liens `bun` et `vu`) ;
  `~/.bun/bin/bun` et `~/.local/bin/vu` pointent sur ces liens, `~/.local/bin/yolo` sur `~/.yolo/bin/yolo` ; le Bun
  officiel reste en `~/.bun/bin/bun-1.4.2` (retour arrière : relier `bun` dessus) et `bunx` y pointe jusqu'à la
  prochaine forge (fork `1ab54728c6` : `argv0` `bunx` = moteur) ; `bun-fork` et son répertoire sont retirés.
- [x] Activation locale (2026-10-07) : `~/.yolo/bin/yolo` est le binaire fusionné (Bun 1.4.3, `a4d88d124`, CLI et
  fournisseur natif embarqués), `~/.bun/bin/bun` et `~/.local/bin/{yolo,bun,vu}` pointent vers lui ; `vu --version`
  délègue à l'artefact `~/.vu` (`0.1.0-cf385dd2`).
- [x] Windows (code) : `install.ps1` crée `bin\bun.exe` et `bin\vu.exe` en liens durs vers `yolo.exe` (aucune copie,
  `YOLO_NO_ALIASES=1` les retire) ; le fork reconnaît `bun.exe`/`bunx.exe` comme moteur, `isVuArgv0` reconnaît `vu.exe`.
- [x] libpython partagée côté `libaphrody` : `crates/interop/ffi/src/python_ffi.rs` (not in repo) (`aphrody_py_*`) ouvre la
  bibliothèque en `RTLD_GLOBAL` sous Unix et par `LoadLibraryW`/`GetProcAddress` (`python3XY.dll`, déjà chargée ou
  explicite) sous Windows ; liaison `bun:ffi` `@aphrody/runtime-sdk/python` (`Python.open`, `run`, `eval`, `call`,
  `version`, libpython de l'artefact `vu` actif) ; `yolo py eval|exec` exécute Python en processus sur cette bibliothèque.
- [ ] Ouvert : build fork Windows (`yolo.exe`) sur la fabrique et artefact `yolo`/`windows-x86_64` de
  `tools/config/downloads.json` ; `packageManager` `bun@1.4.2` des manifestes (le fork n'a pas de version publiée) ;
  retrait de l'ancien `yolo` historique.

## Hors périmètre

Aucune publication publique. Les paquets npm, noms de commandes et schémas gardent leurs identités.

## Décision définitive du 2026-10-06 : runtime unique `yolo`, qui charge `vu`

Tranché par l'agent exécutant sur ordre du propriétaire (« runtime unique yolo, charge vu et notre fork bun »).

| Question | Décision | Raison |
| --- | --- | --- |
| Produit | Un seul runtime : **`yolo`** = fork Bun (`aphrody-labs/bun`) + CLI `yolo`. | Les runtimes sont les produits ([positionnement](../../AGENTS.md)) ; un seul artefact à livrer, vérifier et installer. |
| Noms | `yolo` (principal), `bun` (alias moteur, `argv0`), `vu` (alias Python, `argv0`). Pas de codename `nub` : un quatrième nom, quasi homonyme de `bun`, sans consommateur ni gain. | Un nom par rôle ; le nom `vu` est réglé une fois dans `vu/scaffold/vu.json` (plan vu §0, §4.5). |
| `vu` dans `yolo` | `yolo` **charge** `vu` : `yolo py …` et `vu …` délèguent à l'artefact `vu` installé (`~/.vu/current`, manifeste vérifié). `vu` n'est **pas** lié statiquement dans le binaire Bun. | `vu` a son dépôt, son cycle de build (uv release : 20 min, 6 Gio de pic ; ruff plus lourd) et sa matrice glibc ; fusionner les liens casserait le plafond glibc 2.39 du fork et la qualification par fabrique. |
| Lien natif | **Une seule libpython partagée** (celle de l'artefact `vu`) : `yolo` (`bun:ffi`) et `libaphrody` (PyO3) l'ouvrent en global (`RTLD_GLOBAL`) ; aucun second CPython. | Liaison Bun ↔ Python ↔ Rust sans copie ni double interpréteur. |
| Dépendance | Sens unique : `yolo` → artefact `vu` (contrat : manifeste schéma 1, `compatibility.cliMajor`) ; `vu` ne dépend jamais de `yolo`. Aphrody → `yolo`/`vu` par artefact. | Plan vu D3, D12. |
| Hors périmètre | Aucune publication publique ; `tools/config/vendor.json` ne bouge qu'après qualification `yolo forge build`. | Règles du fork. |

Ordre d'exécution : (1) commandes `yolo` natives dans le fork (détection `argv0`), (2) chargement de l'artefact `vu` par `yolo py|vu`, (3) libpython partagée en global côté fork et `libaphrody`, (4) packaging `install.sh`/`install.ps1` : `yolo` + liens `bun` et `vu`.
