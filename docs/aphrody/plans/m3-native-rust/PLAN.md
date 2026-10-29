<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody en Rust natif et M3 pour Rust/Bun

Directive propriétaire du 2026-10-09. Statut : plan d'exécution, migration non
qualifiée. Ce document fixe la nouvelle répartition demandée pendant le nettoyage
et remplace les anciens choix de runtime pour les sites et serveurs Aphrody.

## Résultat attendu

Tous les serveurs applicatifs Aphrody exécutent du Rust natif : HTTP, API, IA,
cloud, MCP, rendu serveur et orchestration de l'interface. Les applications web
Aphrody écrivent également leur interface en Rust, compilée en WASM lorsque
l'interactivité l'exige. Le navigateur reçoit HTML, CSS, assets et WASM ; les
liaisons JavaScript générées par les outils WASM sont admises. Aucune logique
métier JavaScript, VM JavaScript serveur ou exécution Next.js n'est nécessaire
dans le déploiement final de ces applications.

M3 conserve deux cibles utilisables, Bun et Rust. Le backend Rust sert les sites
Aphrody ; le backend Bun demeure une capacité du framework et du produit Bun.
L'existence du backend Bun ne constitue pas une dépendance de production des sites
Rust. La migration rapide livre d'abord des routes réelles en Rust, puis complète
la conversion des interfaces ; les étapes intermédiaires ont un statut explicite.

## Répartition des propriétaires

| Famille | Destination et responsabilité |
| --- | --- |
| Bun, API natives Bun, runtime JavaScript générique | Fork Bun, session Claude et propriétaires du fork |
| Next.js, Turbopack, adaptateurs de bundling/framework génériques | Fork Bun ; conserver provenance et propriétaires upstream |
| Tailwind, Base UI et code générique de ces dépendances | Fork Bun ; Material owns the shared M3 design and tokens |
| Tauri et code générique d'intégration des hôtes desktop | Fork Bun ; écrans et commandes métier restent Aphrody |
| Obscura, V8 et moteurs web génériques | Fork Bun ; adaptateurs produit consomment le SDK qualifié |
| OS, kernel, shell et terminal génériques | Fork Bun ; identité des crates, ABI et artefacts conservée |
| API, IA, cloud, HTTP, MCP métier | Aphrody, propriétaires Rust existants |
| M3, web UI et app UI | Material repository (`@aphrody/m3-*`, `@aphrody/app-ui`); Aphrody consumes the published package and pinned crate interfaces |
| WebOS de démonstration du runtime | `packages/bun-webos` (not in repo) dans le fork, relais OS/Claude |
| Site produit, documentation, templates et branding Aphrody | Aphrody, cible serveur Rust et composants M3 Rust |

« Pure JS » désigne ici un mécanisme générique de runtime/framework. Une règle
métier ne change pas de propriétaire parce qu'elle est actuellement écrite en TS.
Les fichiers mixtes sont séparés par fonction avant leur suppression. Les
historiques, bases, modèles, cookies et authentifications restent dans leurs
stores. Nginx, bases de données et moteurs de calcul tiers gardent leurs contrats
d'infrastructure : leurs endpoints applicatifs Aphrody sont possédés en Rust.

La session qui reçoit les sources choisit les chemins d'intégration génériques
du fork en respectant son arbre upstream. Ne pas injecter tous les moteurs dans
le démarrage de Bun : fonctionnalités optionnelles, initialisation paresseuse,
artefacts précompilés par cible et SDK léger. Préserver V8 jusqu'à qualification
Obscura/JSC et conserver le runtime desktop CEF jusqu'à remplacement qualifié.

## État constaté et sources de travail

- [Plan Aphrody](../../PLAN.md) : ABI, permissions, ressources et propriétaires.
- [Material plan](https://github.com/aphrody-labs/material/blob/main/PLAN.md) and framework guide own M3 changes.
- `packages/m3/src/app/scan.ts` in the Material checkout recognizes App Router conventions;
  parallel routes et intercepting routes y sont explicitement ignorées.
- `m3/packages/m3/src/app/server.ts` et `m3/packages/m3-bun` exécutent aujourd'hui
  le serveur Bun ; ils ne prouvent aucune cible serveur Rust existante.
- `m3/packages/m3-next-migrate` et `m3/packages/m3-codemods` possèdent déjà
  l'analyse Next et les transformations : étendre ces propriétaires.
- `crates/m3-tokens` in Material owns the native token contract. Reuse the
  propriétaires UI, API, IA, Infra et MCP, sans reconstruire leurs moteurs.
- Le catalogue `tools/config/service-catalog.json` déclare notamment les fonts
  et downloads en Bun, le web API en Bun, et certains endpoints déjà en Rust.
  Une déclaration de catalogue ne prouve pas le processus réellement déployé.
- Le relais local `.coord/handoff-apps-web.md` prévoit le transfert WebOS vers
  `packages/bun-webos` (not in repo), puis la suppression après réception du SHA Bun.

## Stack retenue

| Besoin | Choix | Règle d'intégration |
| --- | --- | --- |
| HTTP/routage | Axum 0.8, Tower, tower-http 0.7 | Réutiliser les pins du workspace ; modules dans les propriétaires existants |
| Async/arrêt | Tokio 1, tokio-util | Annulation, délais, files bornées, arrêt et join des tâches |
| TLS/client | Rustls 0.23, Reqwest 0.13 | Fournisseur crypto déjà configuré ; aucun second client/TLS |
| UI fullstack | Leptos 0.8 + leptos_axum 0.8 | SSR/SSG côté serveur, hydratation WASM seulement là où nécessaire |
| Assets/tokens | Propriétaires M3 Rust/CSS existants | CSS, fontes et icônes identiques entre les deux cibles |
| Données | Clients/pools Rust déjà détenus par les domaines | Garder schémas et stores ; aucune conversion de DB imposée |
| Contrats | Serde et schémas versionnés des propriétaires | REST/SSE/WS conservés ; bindings Rust/TS générés |
| Build web Rust | cargo-leptos et wasm-bindgen | Workspace/Infra orchestre ; version verrouillée après qualification |
| Packaging | Factories et release Infra existants | Binaire natif + assets vérifiés, artefacts par OS/architecture |

Consultation crates.io du 2026-10-09 : leptos 0.8.22, leptos_axum 0.8.10,
cargo-leptos 0.3.11 ; les deux premiers déclarent Rust minimum 1.88 et MIT.
leptos_axum 0.8.10 dépend d'Axum `^0.8` et Leptos `^0.8.20`. Ce sont des
candidats vérifiés pour ce plan, pas des dependencies déjà ajoutées au lockfile.
Axum est actuellement résolu en 0.8.9 dans le workspace.

Le skill best-stack-2026 propose Leptos ou Dioxus pour le frontend Rust. Leptos
est retenu pour l'intégration Axum, SSR et server functions documentées. Dioxus
reste une option à réexaminer seulement si un besoin réel non couvert apparaît.
Askama peut répondre à un besoin de templates existant ; il n'est pas ajouté
comme second moteur UI général. SQLx n'est pas ajouté pour remplacer les pools
existants sans besoin de domaine démontré.

## Architecture M3 commune

1. Un contrat versionné décrit routes, paramètres, erreurs, assets, cache,
   métadonnées, permissions et formulaires. Les tokens viennent du propriétaire
   Rust actuel. Le format reste indépendant de React, Bun et Leptos.
2. Le backend Bun adapte ses exports actuels au contrat ; le backend Rust le
   compile vers Axum/Leptos. Les fonctions métier vivent dans les crates de
   domaine Aphrody. Un backend ne recopie pas leurs implémentations.
3. Ajouter les modules Rust aux propriétaires UI/Web appropriés. Une nouvelle
   crate n'est créée qu'à une frontière de build ou de publication justifiée.
   SSR et hydratation ont des features distinctes ; les clients WASM n'embarquent
   ni secrets, ni credentials serveur, ni clients DB natifs.
4. Les composants M3 partagent noms de tokens, états, rôles ARIA, clavier,
   validation et snapshots de comportements. JSX et `view!` sont deux rendus
   de ces contrats, sans prétendre exécuter JSX nativement comme du Rust.
5. Les API, MCP, CLI et endpoints HTTP utilisent les mêmes crates métier.
   Le SSR accède en processus aux domaines locaux ; les domaines distants
   passent par leurs contrats authentifiés, avec isolation de profil.

## Migration rapide Bun/Next vers Rust

Le workflow suivant est à implémenter dans Workspace et `m3-next-migrate` ;
les commandes illustrent le contrat cible et ne sont pas des CLI disponibles :

```text
m3 migrate plan --from next|bun --to rust --root <checkout> --out <manifest>
m3 migrate apply --manifest <manifest> --batch <id>
m3 dev --backend rust
m3 build --backend rust --profile release
m3 migrate verify --manifest <manifest>
```

Chaque manifeste porte source SHA, destination SHA, hashes, URLs, permissions,
features, consommateur, transformation, statut et preuve de qualification.
L'application par lot est idempotente et refuse les fichiers modifiés depuis le
manifest. Elle conserve un diff révisable et le commit de rollback. Les rapports
signalent explicitement les cas manuels ; aucun shim JS durable n'est généré pour
faire croire que la migration full Rust est terminée.

| Source | Transformation Rust | Qualification obligatoire |
| --- | --- | --- |
| pages statiques, docs, assets | SSG/SSR Leptos, assets fingerprintés | URLs, SEO, locale, accessibilité, cache |
| `app/page`, `layout`, route groups | arborescence commune + vues/layouts Leptos | routes dynamiques, priorités, 404, navigation |
| `route.ts`, Bun.serve, API handlers | Axum + crates métier existantes | codes HTTP, headers, schémas, auth, limites |
| Server Actions et formulaires | fonctions Rust + server functions/REST selon contrat | CSRF, validation, erreurs, permissions, idempotence |
| RSC/streaming/Suspense | SSR streaming et ressources Leptos | ordre, annulation, erreurs et hydratation déterministe |
| React hooks et effets | signaux/ressources/effets Leptos | séparation SSR/client, événements, teardown |
| cookies, middleware, redirects | couches Axum et politiques de session | same-site, proxies de confiance, isolation |
| image/font/metadata | pipeline asset Rust et rendu des métadonnées | tailles, srcset, licences, CSP, SEO |
| cache/revalidate/ISR | cache versionné et invalidation du propriétaire | isolation utilisateurs, TTL, invalidation, concurrence |
| WebSocket/SSE | transport Rust avec queues bornées | backpressure, reconnect, déconnexion, arrêt |
| MDX et composants arbitraires | contenu structuré et composants Rust enregistrés | refuser le code inconnu ; conversion explicite |
| parallel/intercepting routes, auth SDK, navigateur, modules natifs | lot manuel avec adaptateur du propriétaire | preuve spécifique ; aucune équivalence supposée |

La génération automatique couvre structure de routes, assets, schémas et code
simple qualifié. La sémantique générale JS/TS, les effets React et les bibliothèques
Next privées nécessitent une conversion révisée. Le compilateur OXC et les
inventaires AST existants fournissent les données ; ne pas écrire un transpileur
universel TSX-vers-Rust. Une build statique Next exportée peut accélérer la première
bascule HTTP, mais ce résultat intermédiaire reste « frontend JS conservé ».

## Lots d'exécution ordonnés

| Lot | Travail concret | Condition de fin |
| --- | --- | --- |
| R0 | Fixer propriétaires, lots de transfert et contrats de routes/permissions ; chaque runtime reçoit un destinataire fork | manifestes de transfert complets ; conflits de claims résolus |
| R1 | Livrer contrats M3, SSR Rust, serveur Axum et une page réelle avec API/formulaire | page SSR + hydration, API/auth, artefact natif Windows/Linux qualifiés |
| R2 | Livrer composants essentiels : thème, texte, bouton, lien, champ, menu, dialogue, table, notification | parité accessibilité/design et tests Rust/browser ; aucun serveur JS |
| R3 | Étendre l'outil de migration existant : AST, route manifest, génération, lots manuels, vérification | fixtures Bun et Next migrées avec tests fonctionnels et erreurs explicites |
| R4 | Migrer site produit/docs/downloads/fonts/proxy/API Aphrody dans l'ordre des dépendances | URLs et comportements conservés, inventaire réel des processus natifs |
| R5 | Migrer couches IA/cloud/UI/MCP restantes en Rust, en réutilisant leurs propriétaires | CLI/HTTP/MCP utilisent les mêmes domaines et permissions |
| R6 | Transférer socle pur Bun/JS/Next/Tailwind/Base UI/Turbopack/Tauri/Obscura/V8/OS/kernel/shell/terminal | commit fork, artefacts SDK qualifiés, consumers Aphrody repointés |
| R7 | Retirer sources remplacées, serveurs JS, scripts/deps inutiles ; publier et basculer par Infra | taille mesurée, rollback testé, production native, zéro chemin remplacé actif |

R6 se prépare dès R0 et avance par familles pendant R1–R5 ; une source n'est
supprimée qu'après qualification de sa destination et de tous ses consommateurs.
Les familles ont des claims disjoints. Pas de déplacement brut des dossiers qui
contiennent simultanément moteur générique, intégration produit et modifications
d'une autre session. La vitrine bun-webos suit son relais OS/Claude ; le site produit
conserve ses contenus et convertit ses composants vers la cible M3 Rust.

## Protocole de transfert au fork et à Claude

- Codex annonce lot, source SHA et hashes dans les handoffs `.coord`.
- Le destinataire fork copie le lot, préserve notices/patches/identités, intègre
  ses dépendances et consommateurs, réalise ses gates, commit et push.
- Le destinataire écrit destination SHA, chemin, commandes/résultats et artefacts.
- Codex vérifie source/destination, repointe tous les consumers Aphrody, réalise
  les gates, puis retire la source et les dépendances remplacées.
- Les sources sales gardent leur auteur/session ; leurs changements sont intégrés
  explicitement avant la clôture du lot. Un PID vivant ne prouve pas qu'un agent
  a accepté le handoff. L'absence de reçu empêche la suppression de la source.

## Rapidité : objectif et mesures

Objectifs à calibrer après la première référence mesurée : plan de migration en
moins d'une minute sur une application de référence de 100 routes ; modification
incrémentale d'une route Rust avec feedback en moins de 5 secondes sur l'hôte
qualifié ; première route statique servie en Rust dans un lot court ; cache d'assets
partagé et recompilation limitée à la crate modifiée. Ce sont des objectifs, pas
des performances constatées ni une garantie de conversion d'une application réelle.

Séparer temps de conversion humaine, génération, build cold/warm, téléchargement
d'artefacts et activation. Comparer mêmes routes, données, cible, compression,
limites CPU/RAM, concurrence, état de cache et versions. Enregistrer p50/p95/p99,
TTFB, débit, erreurs, RSS, taille binaire/assets/image et taille Git/checkout.
Budgets initiaux : aucune régression supérieure à 5 % au-delà du bruit de mesure
sur latence p95 et débit ; accessibilité/auth/contrats restent des critères bloquants.

## Gates et bascule

1. Rust : checks/tests/Clippy strict par crate, `--locked`, sérialisation Cargo et
   sccache du contexte ; SSR natif et client WASM compilés séparément.
2. Bun conservé : TypeScript, lint/format et suites des packages modifiés.
   Les deux backends passent les fixtures de contrat communes.
3. HTTP : redirects/404/5xx, cookies, cache, upload, pagination, SSE/WS, limites,
   erreurs et annulation ; auth testée avec profils aphrody/dbfr/ie isolés.
4. UI : SSR SEO sans WASM pour contenu statique, hydratation sans divergence,
   clavier/lecteur d'écran, locales, responsive, thème clair/sombre, rendu réel.
5. Packaging : binaire et assets checksumés, dépendances natives déclarées,
   health/readiness, graceful shutdown, installation et rollback par cible.
6. Production : replay hors écritures, canary de routes choisies, mesures,
   bascule catalogue Infra, retour au SHA précédent testé. DB expand/contract ;
   conserver DB et secrets existants. Le retrait du serveur historique vient après
   la fenêtre de qualification, avec preuve qu'aucun consommateur ne le requiert.

Builds sur un hôte natif, SSH ou Docker qualifié, résolu depuis la configuration. Le poste actuel utilise Windows natif. Les host applies conservent leurs autorités : Yoyo pour Aphrody Labs, Omar pour DBFR.

## Critères de clôture

- [ ] Tous les services applicatifs Aphrody catalogués ont un processus Rust réel.
- [ ] Frontend applicatif Aphrody en Rust/WASM ou HTML statique généré depuis Rust.
- [ ] M3 Bun et M3 Rust livrés, documentés et testés sur les contrats communs.
- [ ] Fixtures Bun/Next et une application réelle migrées par le workflow reproductible.
- [ ] Toutes les familles runtime demandées ont un reçu fork, consumers qualifiés et source retirée.
- [ ] Routes, données, design, auth, SEO et accessibilité conservés.
- [ ] Aucun moteur serveur JS, shim métier TS ni dépendance de l'ancien serveur dans la release native.
- [ ] Builds, installation, activation, rollback et gains de taille/performance prouvés séparément.

## Documentation primaire consultée

- [Leptos : SSR et hydratation](https://book.leptos.dev/ssr/23_ssr_modes.html).
- [Leptos : intégration Axum et extracteurs](https://book.leptos.dev/server/26_extractors.html).
- [Leptos : server functions](https://book.leptos.dev/server/25_server_functions.html).
- [Axum 0.8.9](https://docs.rs/axum/0.8.9/axum/).
- [Leptos sur crates.io](https://crates.io/crates/leptos),
  [leptos_axum](https://crates.io/crates/leptos_axum),
  [cargo-leptos](https://crates.io/crates/cargo-leptos).

Les exemples Context7 retournés pour Leptos 0.8.14 comprennent des snippets
historiques : les signatures d'implémentation doivent être vérifiées sur les
versions effectivement résolues, et pas copiées sans gate de compilation.
