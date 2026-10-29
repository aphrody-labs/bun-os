> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Méthode du banc V8 / JSC : liste de comparabilité et seuils

> Contexte courant (2026-10-09) : développement et builds selon l'hôte, la cible et les ressources disponibles ; aucun produit n'est réservé à un poste. Voir le [contexte](../../../operations/workspace/windows-native.md).


Version 1.1 du 2026-10-05, 22:49 (Europe/Paris) ; la version 1.0 de 22:19 a été rédigée avant tout verdict (voir « Révisions de la méthode » en fin de fichier). Tenue par l'arbitre `claude-bench-arbiter` ; journal en temps réel : partie 4 du plan, §13 (`docs/plans/fusion/drive/PLAN-FUSION-APHRODY (4 de 4).md`). Reçu d'équivalence des symboles : `docs/plans/fusion/engine-equivalence-2026-10-05.json` (`scripts/audit/engine-equivalence.ts`).

Règle d'or : **un chiffre `indicatif` ou `invalide` ne change jamais une décision du §12.** Un chiffre de vitesse ne peut jamais, seul, lever la directive « V8 conservé jusqu'à la parité » (§12 #8) : il peut seulement faire échouer le portage JSC sur un critère de performance. Seule la suite de parité (tests `runtime.rs`, `obscura-cdp`, 119 tests `Bun.WebView`, obstacles, WPT) et les sondes de capacité peuvent lever V8.

## 1. Révisions épinglées des deux côtés

| Côté | Révision exacte | Binaire à mesurer | Preuve à relever à chaque banc |
| --- | --- | --- | --- |
| Bun / JSC | fork `aphrody-labs/bun` `main` `c439b6fbdaeb00722a54e8ad3b1df7a7e7c10bb4` ; WebKit `5718a6ec579b98362ea7276a426deedcc6281ef5` (fork `aphrody-labs/WebKit@bun-pin`) | VPS : `/srv/aphrody-build/cache/bun-forge/artifacts/latest/bun`, release LTO, 80 910 048 octets, sha256 `0358a371f66029a10f9d08e92a541cfb8d40c656362bd9e93bf408adb439bf81` (reçu `aphrody.bun-forge/1`) | `sha256`, `--revision` = `1.4.3-canary.1+c439b6fbd`, `process.versions.webkit` = `5718a6ec…` |
| Deno / V8 | Deno 2.9.7 (tag `v2.9.7` = `0c071246a412575e07423263404a5d13e7ed6aa2`, fork `aphrody-labs/deno`), `deno_core 0.412.0`, `deno_v8 0.4.0`, crate `v8 150.4.0` | binaire officiel `deno-x86_64-unknown-linux-gnu.zip` v2.9.7, SHA-256 du zip vérifié contre `.sha256sum`, SHA-256 du binaire relevé | `deno --version` : `v8 15.0.245.2-rusty` ; `Deno.version` |
| V8 d'Obscura (référence) | crate `v8 150.4.0` (`denoland/rusty_v8` `v150.4.0` = `5c15a699…`, fork `aphrody-labs/rusty_v8@obscura-pin-v150.4.0`) avec `deno_core 0.412.0` | — | `v8-150.4.0/v8/include/v8-version.h` = 15.0.245.2 (lu sur le VPS) ; `Cargo.lock` de `vendor/deno` : `v8 150.4.0` et `deno_core 0.412.0` |

Binaires **exclus** (toute mesure faite avec eux est au mieux `indicatif`) :

- le `bun` installé dans WSL et sur le VPS (`~/.bun/bin/bun`), 1.4.2+744846f84, `process.versions.webkit` = `2e2aa2290fac856d6f451ceacb58f7f5b44dd057`, qui **n'est pas** le WebKit épinglé ;
- `/srv/aphrody-build/cache/bun-forge/bin/bun`, un script `sh` qui exécute le Bun d'amorçage de l'utilisateur `ubuntu` (le même 1.4.2), pas le binaire du fork ;
- le binaire du fork ne démarre pas dans WSL (glibc 2.39 contre 2.43) : il s'exécute sur le VPS seulement.

Limite assumée : le Deno officiel et Obscura consomment la même version de source de V8 (15.0.245.2) ; l'identité des drapeaux de compilation de l'archive `librusty_v8` n'est pas vérifiée.

## 2. Liste de comparabilité (chaque ligne : PASS ou FAIL, nommée dans le verdict)

| # | Contrôle | Comment le vérifier |
| --- | --- | --- |
| C1 | Bun = binaire du fork au pin | sha256, `--revision`, `process.versions.webkit` (§1) |
| C2 | V8 = Deno 2.9.7, V8 15.0.245.2 | `deno --version`, sha256 du binaire, zip vérifié |
| C3 | Même source de charge, octet pour octet | sha256 du fichier ; entrées issues d'un PRNG à graine fixe ; sorties (sommes de contrôle) identiques sur les deux moteurs, sinon `invalide` |
| C4 | Builds de production des deux côtés | pas de debug, pas d'ASAN ; reçu du forge `profile: release, lto: true` |
| C5 | JIT dans le même état | défaut des deux (DFG/FTL contre Maglev/TurboFan) ou désactivé des deux (`BUN_JSC_useJIT=0` et `--v8-flags=--jitless`) ; variables et drapeaux consignés |
| C6 | Échauffement puis ≥ 10 itérations mesurées | min, médiane, p95 ; la première itération (à froid) est rapportée à part ; stationnarité contrôlée (médiane de la 1re moitié des mesures contre la 2de : écart ≤ 5 % par moteur, ou dérive commune aux deux moteurs, auquel cas le rapport reste interprétable et les absolus non) ; 3 échauffements ne suffisent pas pour `compute` sous V8 (révision 1.1) |
| C7 | Hôte calme, relevé avant et après | `uptime` (charge 1/5/15 min), gouverneur CPU (`n/d` si absent : WSL et VM n'en exposent pas), noyau, RAM libre, vol CPU ; verrous d'usine libres, vérifiés par `flock -n` sur chaque `*.lock` (le fichier existe toujours, sa présence ne prouve rien ; `/srv/aphrody-build/locks` sur le VPS, `/home/ubuntu/aphrody-build/locks` sur dbfr) ; `nice -n 10` ; les deux moteurs dans la même session sur le même hôte, exécutions entrelacées (A, B, A, B…) |
| C8 | Démarrage processus, création d'isolat, création de realm supplémentaire et évaluation de `bootstrap.js` mesurés séparément | §4, mesures S1 à S4 |
| C9 | Chemin chronométré sans API propre au runtime | uniquement ECMAScript et API Web identiques ; pas de `Bun.*`, `Deno.*`, `node:*` dans la boucle chronométrée ; E/S et chargement de module hors chronomètre. Sinon la mesure est de la voie « runtime » (R), jamais utilisée pour #8, #16, #17 |
| C10 | RSS crête et réglages GC par défaut consignés | `process.memoryUsage().rss` / `Deno.memoryUsage().rss`, `VmHWM` lu dans l'enfant avant sa sortie ; **pas `resourceUsage().maxRSS` du parent** : sous Linux le `ru_maxrss` d'un enfant lancé par fork inclut le RSS du parent au moment du lancement (reproduit : enfant minuscule d'un parent de 260 Mo, 275 Mo rapportés ; 263,65234375 Mo identiques pour 10 couples charge/runtime dans le résultat de 22:25) (révision 1.1) |
| C11 | Asymétrie de snapshot déclarée | V8 : snapshot de démarrage de `bootstrap.js` (17 932 lignes) restauré par `create_snapshot`/`startup_snapshot`, mesurable seulement avec le vrai runtime d'Obscura ; JSC : évaluation au démarrage avec ou sans cache de bytecode. Une comparaison « Deno sans snapshot » contre JSC ne dit rien du snapshot d'Obscura |
| C12 | Capacités (limite de tas, arrêt) testées comme sondes PASS/FAIL, pas comme vitesse | §5 |
| C13 | Intégrité des compétiteurs : fichiers de l'arbitre inchangés (sha256), pas de traitement spécial de la somme de contrôle, même complexité algorithmique | hachage avant et après ; relecture de la différence |
| C14 | Résultat brut archivé | `docs/plans/fusion/bench/<UTC>-<nom>.json` : commande exacte, spécification de l'hôte, révisions, n, hachages des sources |

Verdicts : `valide` (C1 à C14 tous PASS), `indicatif` (utilisable comme indice ; le contrôle en défaut est nommé), `invalide` (défaut de méthode qui change la conclusion), `à reproduire` (préciser quoi relancer et où).

## 3. Protocole commun

1. Relever l'hôte avant : `uptime`, `/proc/loadavg`, `nproc`, mémoire, noyau, état des verrous, version de glibc.
2. Hôte calme (proposé) : charge 1 min ≤ 0,17 par vCPU (≤ 2,0 sur les 12 vCPU du VPS), aucun processus tiers au-dessus de 10 % de CPU pendant les 60 s précédentes, vol CPU < 2 %, aucun `heavy.lock` ni `cargo-build.lock` tenu (`flock -n`). Sinon : attendre, ou rendre le verdict `indicatif` (C7).
3. Chaque moteur : ≥ 5 processus frais (proposé) ; dans chacun, échauffement (≥ 3 itérations jetées) puis ≥ 10 itérations mesurées. Démarrage processus : `hyperfine --warmup 5 --runs ≥ 30` (100 pour le budget du noyau, partie 1).
4. Statistique : min, médiane, p95 et écart absolu médian (MAD). Une différence n'est rapportée comme réelle que si l'écart des médianes dépasse max(5 %, 3 × MAD) et que les plages [min, p95] ne se chevauchent pas (proposé ; règle de pré-contrôle de l'arène, conservatrice sur échantillons regroupés). Les itérations d'un même processus ne sont pas indépendantes : pour le verdict, l'unité statistique est le processus (médiane par processus, test exact de somme des rangs sur les médianes ; avec 5 processus par côté, p minimal 0,0079 quand les plages sont disjointes) (révision 1.1).
5. Relever l'hôte après. La charge à 1 min relevée après la mesure inclut le banc lui-même (un fil actif ajoute environ 1) : elle ne sert pas de critère. Critères : vol CPU < 2 % de la durée, et temps CPU hors banc (`user` hors `nice` dans `/proc/stat`, le banc tournant à nice 10) ≤ 5 % d'un vCPU sur la durée ; sinon `invalide` pour cette session (révision 1.1 ; le critère d'origine « charge plus que doublée » comptait le banc).
6. Une session de banc ≤ 5 minutes ; au plus trois sessions sans accord de `main`.

## 4. Métriques, décisions informées et seuils

`déclaré` = chiffre écrit dans le plan ; `proposé` = seuil proposé ici, à valider par le propriétaire.

| Id | Mesure | Décision / section informée | PASS | FAIL | Origine du seuil |
| --- | --- | --- | --- | --- | --- |
| S1 | Démarrage processus (`bun -e 1` ou script vide, hyperfine) avant/après un patch du noyau | budget de démarrage du noyau (partie 1, tableau « noyau / plugins ») ; J0 « démarrage mesuré = base » (partie 2) | Δ ≤ +0,5 ms et binaire Δ ≤ +1 Mo | au-delà : patch refusé ou déplacé en plugin | `déclaré` (partie 1) ; 100 exécutions |
| S2 | Création d'isolat/VM (V8 : isolat + snapshot ; JSC : VM d'un `Worker`) | #16, #8 | valeurs consignées ; Δ(JSC − V8) médiane ≤ 20 ms | Δ > 100 ms au p95 | `proposé` (borne de l'estimation « 20 à 100 ms de plus par page », partie 3, ligne risque démarrage) |
| S3 | Realm supplémentaire dans la même VM (`vm.createContext` / `ShadowRealm` contre `v8::Context`) ×100 | §11.4 ligne contextes ; frames (§11.2 point 2) | médiane ≤ 2 ms par realm vide | > 10 ms | `proposé` |
| S4 | Évaluation de `bootstrap.js` dans un realm neuf : (a) sans cache, (b) avec cache de bytecode, (c) V8 avec snapshot (runtime Obscura seulement) | #16 (snapshot), #14 (essai `node:vm`), partie 3 risque « démarrage de page lent sans snapshot » | (b) médiane ≤ 20 ms et (a) p95 ≤ 100 ms | (a) p95 > 100 ms et (b) médiane > 50 ms | `proposé`, encadrement de l'estimation de la partie 3 ; le déclencheur « latence `fetch` > 85 ms » (partie 3) mesure la page entière |
| S5 | Latence `fetch` complète d'une page locale fixe, Obscura V8 aujourd'hui puis port JSC | partie 3 : 85 ms et 30 Mo RSS (README Obscura, non vérifiés) ; #8 | ≤ 85 ms ou ≤ 1,2 × la référence V8 relevée ici | > 1,5 × la référence V8 | `déclaré` pour 85 ms (à refaire sur notre hôte) ; ratios `proposé` |
| S6 | RSS par page (realm JSC contre isolat V8) | partie 3 « RSS par page » (mesuré en J2 sans objectif) | consigné ; ≤ 1,5 × V8 | > 2 × V8 | `proposé` |
| S7 | Coût d'un appel d'op synchrone (10⁶ appels) : fonction hôte JSC contre op rapide `deno_core` | #17, §11.4 ligne fonctions hôtes | JSC ≤ 1,5 × V8 | > 3 × | `proposé` ; **non mesurable** avec les binaires Bun/Deno seuls : demande un harnais Rust sur le VPS (`obscura-js`) |
| E1 | Voie moteur : charge pure (`arena/shared/compute.js` : nbody, fannkuch, collections, texte, tri), moyenne géométrique JSC/V8 sur les médianes | information pour #8 (jamais décisive) | ≤ 1,25 neutre | > 2,0 sur une charge : alerte documentée | `proposé` |
| E2 | Voie moteur : intégrées ECMAScript (`json` : `JSON.stringify` + `JSON.parse`, source identique des deux côtés, `de5a0c2f7fca`), rapport JSC/V8 | information pour #8 (jamais décisive) | ≤ 1,25 neutre | > 2,0 sur une charge : alerte documentée | `proposé` |
| R1 | Voie runtime (API `Bun.*` contre `Deno.*`) | aucune décision (compare des runtimes, pas des moteurs) | — | — | — |

## 5. Sondes de capacité (PASS/FAIL, pas de vitesse)

| Sonde | Ce que fait Obscura aujourd'hui | PASS côté JSC (fork au pin) |
| --- | --- | --- |
| P1 limite de tas | `add_near_heap_limit_callback` : à l'approche de la limite, pose un drapeau, appelle `terminate_execution()` sur le fil de l'isolat et rend une marge de secours ; la page reste utilisable après `cancel_terminate_execution` (`runtime.rs` 161-177, 1088-1110) | Un script qui alloue sans fin est arrêté par l'hôte (sondage `heapStats().heapSize`, `memoryUsage()`, `percentAvailableMemoryInUse()` puis arrêt) avant que le RSS dépasse L (proposé : 512 Mo) ; réaction ≤ 250 ms (proposé) ; le processus survit ; le contexte suivant évalue `1+1` |
| P2 arrêt d'un script | `spawn_watchdog(handle, budget)` + `terminate_execution` (`cdp_watchdog.rs`) | `for(;;){}` terminé dans ≤ 2 × l'échéance (`vm.runInContext(..., {timeout})`, `JSContextGroupSetExecutionTimeLimit`, `VM::notifyNeedTermination`) ; la VM reste utilisable |
| P3 locale ICU par défaut | `v8::icu::set_default_locale` (bug #734) | `Intl.DateTimeFormat().resolvedOptions().locale` suit la langue posée par l'hôte (`WTF::overrideUserPreferredLanguages`) ; **`bun:jsc.setTimeZone` règle le fuseau horaire, pas la locale** : ne le compter que pour le fuseau |
| P4 drapeaux moteur | `set_v8_flags` | `BUN_JSC_<option>` accepté, option inconnue rejetée ; aucune équivalence 1:1 des chaînes de drapeaux V8 |
| P5 microtâches | `perform_microtask_checkpoint` | `bun:jsc.drainMicrotasks()` vide la file avant retour |

Option JSC `gcMaxHeapSize` (déclarée dans `OptionsList.h` du préconstruit) : au pin `5718a6ec`, `Heap.cpp` l'utilise comme **seuil de demande de GC** (octets alloués dans le cycle), pas comme plafond de tas avec rappel ou arrêt. Elle borne le garbage, pas la mémoire vivante : elle ne couvre pas P1.

## 6. Format des résultats bruts

`docs/plans/fusion/bench/<UTC>-<nom>.json` : `{ command, host: { name, kernel, nproc, ramMiB, load: { before, after }, governor, glibc }, revisions: { bun, webkit, deno, v8 }, hashes: { binaries, sources }, n, flags, results: { <mesure>: { min, median, p95, mad, samples } }, verdict, failedChecks }`. Aucune mesure de performance n'est affirmée sans cet artefact.

## Annexe A. Cartographie des vérifications des showcases (état du 2026-10-05, 22:27)

Sources : `vendor/bun/scripts/showcase/bun-core.ts` (54 vérifications) et `bun-jsc-web.ts` (38). Chaque vérification est `check(zone, nom, source, exécution)` ; une zone n'est reliée à une capacité du §11.4 que si elle exerce vraiment l'API concernée.

| Script / zone | Vérifications utiles | Capacité §11.4, sonde ou décision | Portée |
| --- | --- | --- | --- |
| `bun-jsc-web.ts` · jsc | « WebKit/JSC pinné » | pin WebKit : lit `WEBKIT_VERSION` dans les sources, ne le compare pas à `process.versions.webkit` du binaire exécuté | ne prouve pas C1 |
| jsc | « Mémoire : heapStats / memoryUsage / protected / % », « estimateShallowMemoryUsageOf » | ligne limite de tas (trou) ; #16 : API de sondage existantes | atténuation, sonde P1 non faite |
| jsc | « drainMicrotasks / callerSourceOrigin » | ligne microtâches ; sonde P5 | existence de l'API |
| jsc | « setTimeZone (ICU) » | fuseau horaire seulement : **pas** la ligne locale (P3) | hors capacité 6 |
| jsc | « serialize / deserialize », « Heap snapshot (format V8) », « Sampling profiler », « Couverture » | outils de diagnostic | hors des sept capacités |
| jsc | « GC : edenGC / fullGC / gcAndSweep / releaseWeakRefs », « setRandomSeed » | comportement du GC ; graine fixe pour la reproductibilité | méthode |
| jit (5) | « Paliers Baseline / DFG / FTL », « noInline / noFTL », « Interpréteur seul (useJIT=0) vs JIT », « Option JSC inconnue rejetée » | C5 (état du JIT) ; ligne drapeaux, sonde P4 (`BUN_JSC_*` accepté, inconnu rejeté) | côté JSC seulement |
| web (10) | EventTarget, MessageChannel, URL, AbortSignal, Performance, Streams, Fetch, crypto, WebSocket et Worker | API Web fournies par JSC/WebCore : appuient « 17 des 59 ops remplaçables » (partie 4, §3) | aucune capacité moteur |
| es (9) | ShadowRealm, Temporal, WebAssembly, SharedArrayBuffer et Atomics, Intl, `using` | ShadowRealm : alternative de realm de frame (ligne contextes) ; Intl : fonctionnalité, pas le réglage de locale par défaut | parité de fonctionnalités |
| `bun-core.ts` · runtime (16) | « Bun.gc & heapStats », « bun:jsc serialize / describe / mémoire », « bun:jsc JIT », « Worker (thread JS + VM enfant) » | S2 (VM d'un Worker) ; lignes limite de tas et contextes | existence des API |
| node (2) | « fs / path / Buffer / zlib / crypto / vm / child_process » | `node:vm` : contextes isolés, cache de bytecode, interruption ; essai d'une heure (#14), mesures S3 et S4 | à exercer pour de bon |
| runtime (12 autres), net (7), compile (7), data (8), crypto (5), webcore (5), ffi (3), test (1) | — | voie R : bibliothèques de runtime | aucune décision V8/JSC |

## Annexe B. Banc B3 : S3, S4 et sondes P1 à P5 (harnais `micro/`)

Harnais : `micro/b3.ts` (pilote, processus frais entrelacés, nice 10), `b3-boot.mjs` (S3 et S4), `b3-probes.mjs` et `b3-p1.mjs` (sondes), `patch-bootstrap.ts` (une ligne de `bootstrap.js`). Identique sous le fork Bun et Deno ; résultat archivé : `20261005T210927Z-B3-dbfr-bootstrap-eval-and-probes.json`.

- **S4** : une évaluation = `vm.createContext` + `new vm.Script(bootstrap.js)` + `runInContext`, avec `Deno.core` simulé (ops qui renvoient `undefined`, `createTimer`, `cancelTimer` et les trois rappels d'exception et de rejet vides). Modes : à froid (première évaluation d'un processus frais, n = 5 processus), à chaud avec le même nom de fichier (cache de compilation en processus) et avec des noms uniques, et avec un cache de code lu dans un fichier produit par un autre processus.
- **S3** : 100 `vm.createContext({})` vides par processus.
- **Limites déclarées** : les mesures passent par le `node:vm` de chaque runtime (C9) et le snapshot V8 d'Obscura n'est pas mesurable avec le binaire Deno (C11) : verdict `indicatif` pour S3 et S4, bon indicateur relatif ; une mesure fidèle du côté V8 demande un harnais Rust sur `obscura-js`. La seule modification de `bootstrap.js` : la ligne qui masque `Performance*` conserve valeur et attributs (le `node:vm` de Deno remplaçait la valeur par `undefined`), identique pour les deux moteurs.
- **P1** (plafond mémoire) est une émulation JS : un Worker qui alloue sans fin, le fil principal sonde le RSS du processus et appelle `terminate()` au franchissement de 300 Mo (`bun:jsc.heapStats` ne voit que la VM appelante). La version native, un fil de garde de l'hôte de realm, reste à faire. Côté V8, le même montage échoue (le `terminate()` d'un Worker Deno ne borne pas l'allocation) et n'est pas représentatif : Obscura utilise un rappel de limite de tas dans l'isolat, que le binaire Deno ne permet pas d'installer ; V8 sans rappel abandonne le processus (SIGTRAP).

## Révisions de la méthode

- **1.1 (2026-10-05, 22:49)**, après examen des bancs B1 et B2 sur dbfr ; aucun seuil de décision n'est modifié, aucun verdict déjà rendu n'est rendu plus favorable. (1) Critère d'hôte calme d'après-banc : la charge à 1 min inclut le banc, remplacée par le vol CPU et le temps CPU hors banc (§3, point 5) ; (2) unité statistique = le processus, test exact sur les médianes de processus (§3, point 4) ; (3) stationnarité contrôlée, 3 échauffements insuffisants sous V8 pour `compute` (C6) ; (4) RSS : ne pas lire `resourceUsage().maxRSS` du parent, lire `VmHWM` dans l'enfant (C10) ; (5) verrous d'usine testés par `flock -n`, pas par la présence du fichier (C7) ; (6) voie E2 ajoutée (`json`, source identique des deux côtés).
  Le mode `--quick` de l'arène (3 mesures, 1 échauffement) est réservé à l'optimisation des concurrents et n'est jamais cité : il inverse le signe de `compute` par rapport à 10 mesures (journal §13, 22:47).
- **1.0 (2026-10-05, 22:19)** : version initiale, écrite avant tout verdict.
