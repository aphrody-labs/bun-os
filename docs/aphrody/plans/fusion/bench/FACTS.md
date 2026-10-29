> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Faits vérifiés pour la fusion V8 / JSC (extrait de l'arbitre)

> Contexte courant (2026-10-09) : développement et builds selon l'hôte, la cible et les ressources disponibles ; aucun produit n'est réservé à un poste. Voir le [contexte](../../../operations/workspace/windows-native.md).


État du 2026-10-05, 23:13 (Europe/Paris). Extrait tenu par `claude-bench-arbiter`, prêt à être lu ; il n'est envoyé à personne. Source de vérité détaillée : journal §13 de `docs/plans/fusion/drive/PLAN-FUSION-APHRODY (4 de 4).md`, méthode `METHOD.md`, reçu `docs/plans/fusion/engine-equivalence-2026-10-05.json`. Chaque ligne dit comment la revérifier. Règle d'usage : tout fait tiré d'un showcase ou d'un banc doit citer le binaire du fork au pin (c439b6fbd, WebKit 5718a6ec), jamais le Bun installé.

## 1. Révisions et binaires

| Objet | Fait | Revérifier |
| --- | --- | --- |
| Fork Bun (pin) | `aphrody-labs/bun` `main` `c439b6fbdaeb00722a54e8ad3b1df7a7e7c10bb4` ; WebKit `5718a6ec579b98362ea7276a426deedcc6281ef5` (fork `aphrody-labs/WebKit@bun-pin`) | `git -C vendor/bun rev-parse HEAD` ; `process.versions.webkit` du binaire du fork |
| Binaire du fork | VPS `/srv/aphrody-build/cache/bun-forge/artifacts/latest/bun`, 80 910 048 octets, sha256 `0358a371f66029a10f9d08e92a541cfb8d40c656362bd9e93bf408adb439bf81`, `--version` 1.4.3, `--revision` `1.4.3-canary.1+c439b6fbd`, release LTO (reçu `aphrody.bun-forge/1`) | `sha256sum` sur le VPS ; `./bun --revision` |
| Bun installé (NON pin) | 1.4.2+744846f84, WebKit `2e2aa2290fac856d6f451ceacb58f7f5b44dd057`, sha256 `a83d2637…dda0c` (identique au zip officiel `bun-v1.4.2`) ; même révision comme Bun d'amorçage du VPS | `bun --revision` ; `bun -p process.versions.webkit` |
| `bin/bun` du dossier forge | script `sh` vers le Bun d'amorçage 1.4.2, pas le fork | `cat /srv/aphrody-build/cache/bun-forge/bin/bun` |
| Glibc | le fork exige glibc 2.43 : il ne démarre pas dans WSL (2.39) ; VPS et dbfr sont en 2.43 | `ldd --version` |
| Deno | 2.9.7 (tag `v2.9.7` = `0c071246a412575e07423263404a5d13e7ed6aa2`, fork `aphrody-labs/deno`), V8 `15.0.245.2-rusty`, TypeScript 6.0.3 ; binaire sha256 `ce6a052beb97c2b92de67077e3f3924ba7c9661ede0d8dc2f66a116a3c841f21`, zip officiel vérifié contre `.sha256sum` (dbfr) | `deno --version` |
| V8 d'Obscura | crate `v8 150.4.0` (rusty_v8 `v150.4.0` = `5c15a699…`) contient V8 15.0.245.2 (`v8-version.h` : 15, 0, 245, 2) ; `deno_core 0.412.0`, `deno_v8 0.4.0` (même `Cargo.lock` que Deno 2.9.7). Drapeaux de compilation de l'archive non comparés | `v8-150.4.0/v8/include/v8-version.h` dans le registre Cargo du VPS |
| `tools/config/vendor.json` | l'entrée `bun` garde `ref` `954db0c0…` (committé), alors que pin et checkout sont `c439b6fbd` ; fichier d'autres sessions, non modifié | `git show HEAD:tools/config/vendor.json` |

## 2. Équivalences V8 / JSC (reçu du 2026-10-05, révisé)

- Couvertes (V8 appelé par `obscura-js`, symbole JSC dans les en-têtes du préconstruit, symbole utilisé par Bun) : contextes multiples (`JSContextGroupCreate`, `JSGlobalContextCreateInGroup`), cache de code (`CachedBytecode`), arrêt de script (`VM::notifyNeedTermination`, `JSContextGroupSetExecutionTimeLimit`), drapeaux (`BUN_JSC_*`, traduction non 1:1), chargeur de modules (`JSModuleLoader`), fonctions hôtes, microtâches (`drainMicrotasks`), exceptions (`ThrowScope`, `CatchScope`).
- Trou : snapshot de démarrage (aucun symbole `StartupSnapshot`/`SnapshotCreator` dans JSC ni dans Bun).
- Trou : limite de tas avec rappel. `gcMaxHeapSize` n'est pas un équivalent (au pin, `Heap.cpp` s'en sert comme seuil de demande de GC sur les octets alloués dans le cycle). Atténuation disponible, non éprouvée : `bun:jsc.heapStats`, `memoryUsage`, `percentAvailableMemoryInUse`, `JSGetMemoryUsageStatistics`, puis arrêt.
- Locale par défaut : `jsc-only`. `WTF::overrideUserPreferredLanguages` est déclaré et exporté, aucune source de Bun ne l'appelle (0 occurrence) ; `bun:jsc.setTimeZone` règle le fuseau horaire (`WTF::setTimeZoneOverride`), pas la locale. Mesuré (B3, fork au pin) : la locale par défaut de JSC reste `en-US` quel que soit l’environnement ; le réglage d’une autre locale reste non éprouvé.
- Briques d'atténuation présentes (existence seulement) : `ShadowRealm` et `NodeVMGlobalObject` (contextes), `produceCachedData` / `cachedData` (cache de bytecode via `node:vm`), `useJIT` (voie interpréteur seul).
- La couche V8 de Bun (`src/jsc/bindings/v8`) n'est pas un remplacement : `rusty_v8` lie le vrai V8.

## 3. Mesures valides (hôte dbfr, binaire du fork, Deno 2.9.7)

Fichiers bruts : `docs/plans/fusion/bench/20261005T203424Z-B1-…json`, `…B2a-…json`, `…B2b-…json`. Hôte : dbfr, 6 vCPU Intel Haswell (KVM), glibc 2.43, nice 10, charge 0,26 au départ, vol CPU 0,02 %.

- `compute` (voie moteur, `shared/compute.js`, source identique) : V8 plus rapide. Rapport JSC/V8 sur les médianes : 1,43 (3 échauffements), 1,24 (10 échauffements, médiane des médianes de processus 1,33) ; plages de processus disjointes (test exact p = 0,0079, 5 contre 5). Le fork n'est pas plus lent que le Bun 1.4.2 installé (même ordre de grandeur sur la même machine).
- `json` (source identique) : JSC plus rapide, rapport JSC/V8 0,69.
- Démarrage du processus (hyperfine, 40 exécutions) : Bun 11,1 ms, Deno 35,8 ms.
- Banc B3 (`…B3-dbfr-bootstrap-eval-and-probes.json`, verdict `indicatif` pour S3 et S4, sondes `valide`) : évaluation de `bootstrap.js` dans un contexte `node:vm`, ops simulés. JSC sans snapshot : 46 ms au premier realm d'un processus (compilation 15 + exécution 28), 10 ms aux suivants ; V8 sans snapshot : 75 ms à froid, 59 ms avec un nom de fichier neuf, 14 ms avec le même nom. Le cache de code lu depuis un fichier fait passer V8 de 75 à 26 ms mais ne réduit pas la compilation sous JSC (40 ms). Création d'un contexte vide : JSC 0,2 ms, V8 0,6 ms.
- Sondes B3 sous le fork : arrêt d'un script (`vm` timeout 200 ms → 200,8 ms, contexte réutilisable), microtâches (`drainMicrotasks`), drapeaux (`BUN_JSC_useJIT=0` honoré, option inconnue rejetée), locale par défaut constante `en-US` quel que soit l'environnement (V8 suit l'environnement), plafond mémoire en émulation Worker + sondage du RSS + `terminate()` (plafond 300 Mo, pic +302 Mo, arrêt en 5 ms, mémoire rendue).
- `bootstrap.js` utilise cinq API `Deno.core` hors ops : `createTimer`, `cancelTimer`, `setReportExceptionCallback`, `setUnhandledPromiseRejectionHandler`, `setHandledPromiseRejectionHandler` (le plan disait « aucune »).
- Aucune mesure valide ne couvre encore : appel d'op (S7), snapshot V8 d'Obscura (S4 côté V8), latence de page complète (S5), RSS par page (S6) ; les colonnes RSS de l'arène sont invalides.

## 4. Défauts connus des outils

- Les arènes et showcases de la session bun tournent avec le Bun installé 1.4.2 : leurs chiffres JSC sont `indicatif` (contrôle C1).
- `bun-jsc-web.ts`, vérification « WebKit/JSC pinné » : lit `WEBKIT_VERSION` dans les sources et ne le compare pas à `process.versions.webkit`.
- `arena.ts` : `rssMB` lu par `resourceUsage().maxRSS` inclut le RSS du parent (valeurs identiques pour des charges différentes) ; `factoryLocks` liste des fichiers toujours présents ; C7 « après » compte la charge du banc ; `--quick` (3 mesures, 1 échauffement) inverse le signe de `compute`.
- Un échauffement de 3 itérations ne suffit pas pour `compute` sous V8 (non stationnaire).

## 5. Suite : chantier W du fork Bun (2026-10-09, code écrit, rien de mesuré)

Le chantier W de `aphrody-labs/bun` (section W de `PLAN-ALPINE-BUN.md`) reprend cette méthode. Son arène
`bench/aphrody/arena/` (`e97cab02b3f`) remplace l'arène de la session bun et corrige les défauts listés au §4 :

- RSS crête par VmHWM lu dans l'enfant ;
- verrous testés par `flock -n` ;
- C7 « après » calculé sur le CPU hors nice ;
- au moins 10 échauffements pour `compute` ;
- Deno vérifié contre le sha256 du §1 ;
- statistique par processus ;
- JSON brut au format §6.

Elle est branchée sur `scripts/aphrody/perf-gate.ts --arena` : fork contre amont bloquant, Deno informatif. Les sources
de `shared/` sont nouvelles, donc leurs sommes de contrôle ne sont pas comparables aux mesures du §3.

Écarts du §2 fermés dans le cœur du fork (non construits, non testés à cette date) :

- locale par défaut issue de LC_ALL / LC_MESSAGES / LANG (`efc1be764f0`) ;
- `--max-old-space-size` et `v8.setHeapSnapshotNearHeapLimit` (`046736e6c49`) ;
- `vm.Script` qui adopte le `cachedData` (`1ae176a457e`) ;
- cache de bytecode des modules internes, en opt-in (`010b4bcf97d`).

Le snapshot de démarrage reste un trou, renvoyé au chantier P (fork WebKit). Tant que la passe finale de W n'a pas tourné,
ce paragraphe ne vaut pas mesure.
