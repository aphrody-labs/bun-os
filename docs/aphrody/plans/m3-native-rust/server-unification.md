<!-- SPDX-License-Identifier: Apache-2.0 -->
# Site, app, CLI et MCP : mêmes services Rust

Directive propriétaire du 2026-10-09 : unifier les surfaces autour du même code
Rust. Complément du [plan de migration](PLAN.md). État de ce document : sources
inspectées, composition et qualification en cours ; aucune activation globale
des services ou suppression générale de JavaScript n'est revendiquée.

## Propriétaires constatés

| Surface | Propriétaire réel et source | Contrat actuel |
| --- | --- | --- |
| Site produit HTTP/SSR | `crates/web/site`, `src/lib.rs`, `src/main.rs` | Axum, docs/templates/Material 3, origine WebOS explicite ; serveur natif |
| Catalogue produit commun | `crates/web/site/src/catalog.rs` | `Catalog::load(root)`, `render(section)`, `search_docs(SearchFilter)` ; JSON sérialisable et règles de filtre uniques |
| CLI site | `crates/infra/aphrody-command/src/site_cmd.rs` | Charge `aphrody_site::Catalog`, catalogue/rendu/serve ; adaptateur CLI sur le même propriétaire |
| Outil MCP catalogue | `crates/ai/mcp/src/site_tools.rs`, `src/lib.rs`, `src/protocol.rs` | `aphrody_site_catalog` charge le même `Catalog` ; lecture, racine explicite, schéma MCP distinct |
| App-server agent | `crates/ai/app-server/src/lib.rs` | Même moteur JSON-RPC sur stdio/HTTP, `/rpc`, `/events`, `/notifications` ; HTTP non authentifié limité au loopback |
| Application desktop | `crates/ui/app` | Hôte desktop et broker app-server en processus ; surfaces métier, transport et runtime desktop distincts |
| Contrôle Infra | `crates/infra/infra/src/api.rs` | API TCP Rust loopback, catalogue/services/validation/pipeline ; propriétaire lifecycle/catalog/validate existant |
| Capacités runtime système | Fork Bun, selon `docs/aphrody/LAYERS.md` (not in repo) du fork | OS/Windows/Linux/interop/moteurs ; Aphrody consomme les artefacts/SDK qualifiés |

Ces observations viennent des fichiers nommés, pas d'un inventaire de processus
de production. Elles ne prouvent ni les versions installées, ni l'activation sur
VPS/DBFR. Le transport MCP reste le serveur canonique `aphrody-mcp` ; une
composition HTTP ne crée pas un second MCP.

## Composition cible

La logique métier réside dans les crates propriétaires. Chaque surface traduit
sa requête en types communs, appelle le même service, puis adapte la réponse au
protocole. Elle ne reproduit ni parseur, ni règle de recherche, ni gestionnaire de
modèles, ni store, ni lifecycle Infra.

Le site expose déjà `router_from_catalog(Arc<Catalog>, webos_url)`. L'app peut
composer ces routes avec ses routes produit en injectant le même snapshot. CLI
et MCP appellent `Catalog::load` et la même recherche ; ils ne téléchargent pas
le JSON depuis leur propre serveur pour réintroduire une dépendance HTTP locale.
La composition app/site est implémentée derrière la feature `site` du propriétaire
app-server : `http_router_with_site` et `serve_http_with_site` placent le site à
`/`, l'interface agent existante à `/app`, et conservent les routes RPC/events et
le health JSON. La CLI expose `aphrody site serve --app --root <checkout>` pour
ce listener loopback unique. Son installation et son activation restent à qualifier.

Le 2026-10-09, les quinze tests du propriétaire site passent sur Windows. Le
binaire natif répond HTTP 200 sans script ; les cinq articles sont identiques à
l'ancien catalogue. Les six templates ont les mêmes enregistrements et le même
ordre de déclaration ; l'ordre des fichiers diffère du `localeCompare` historique.
Le check app-server avec feature `site` passe. Ces preuves ne qualifient pas les
interactions de l'interface agent ni les transports installés CLI/MCP.

Pour IA et cloud, introduire ou étendre les fonctions typées dans les propriétaires
existants utilisés par CLI/MCP/REST. Conserver les réponses OpenAI, JSON-RPC et MCP
comme contrats de transport ; partager le moteur n'autorise pas à modifier leurs
formes de réponse ou leurs méthodes de flux. Les modèles et connecteurs lourds
restent paresseux ; charger le catalogue public ne doit pas initialiser un moteur
IA, un WebView ou un processus Bun.

## Profils, autorité et transports

Le partage de code n'additionne pas les permissions. Les catalogues publics en
lecture peuvent être composés avec le site ; les mutations Infra, données RAG,
stores modèles, appels fournisseurs et historiques restent derrière leurs
politiques et transports. Garder séparés les profils `aphrody`, `dbfr` et `ie`,
les bases, cookies, conversations et credentials.

Préserver la règle loopback de l'app-server non authentifié. Ne pas fusionner ses routes publiques avec les endpoints privilégiés sans authentification explicite. Un accès réseau existant n'accorde pas l'administration DBFR : Yoyo administre Aphrody Labs et Omar DBFR. Les changements d'hôte suivent Infra et son allocation.

Les collisions de routes (`/`, `/health`, `/healthz`, `/api/*`) doivent être
résolues explicitement lors de la composition : choisir un préfixe produit et
documenter les chemins de compatibilité. Le runtime WebOS reste une origine
distincte configurée ; le site fait une redirection sans accès hôte implicite.

## Travail concret restant

1. Qualifier le snapshot `Catalog` identique depuis HTTP, CLI et MCP : mêmes cinq
   articles et six templates, mêmes contenus/dépendances, distinction des écarts
   d'ordre de tables TOML et de fichiers. Tester les filtres et IDs sur les trois
   adaptateurs ; les schémas propres au transport ne dupliquent pas les règles.
2. Finir la composition app/site au propriétaire app-server, avec contexte injecté,
   gestion des routes et arrêt gracieux. Vérifier stdio/HTTP/events et broker
   desktop restent compatibles ; ne pas remplacer ces contrats par un serveur
   catalogue limité.
3. Le serveur app-server inspecté sert encore `/app.js` et `/app.css`. Un serveur
   écrit en Rust avec frontend JS ne satisfait pas encore la cible UI Rust/WASM.
   Migrer les interactions de l'app et du site vers HTML/forms/SSR ou Rust/WASM,
   puis retirer les consommateurs JS après qualification.
4. Restaurer les interactions produit : recherche/catégories/sélection et copie
   de liens/code, sélection des fichiers templates, contrôles M3. Le rendu natif
   statique et ses disclosures ne prouvent pas la parité complète de l'ancien UI.
5. Étendre les propriétaires IA/cloud/Infra existants avec interfaces typées
   partagées, puis brancher les adaptateurs HTTP/MCP/CLI. Garder toutes les gardes
   actuelles ; tests d'autorisation/profil et annulation avant bascule.
6. Repointer les scripts produit `web:dev/build/start` vers les artefacts Rust
   qualifiés. Les gates web-engine/Obscura ne doivent pas être remplacées par des
   tests de site ; ajouter les checks de site à côté de la couverture moteur.
7. Produire les artefacts par cible et qualifier l'installation/activation séparées
   du check source. Déploiement et rollback restent possédés par Infra.

## Preuves de réception

- Scoped check/tests/Clippy strict sérialisés des propriétaires touchés, sans
  compilation des moteurs pour un simple changement catalogue.
- Exécution du binaire natif et comparaison HTTP/CLI/MCP sur le même root/snapshot ;
  route, statut, contenu, erreurs et autorisation vérifiés.
- Rendu navigateur sans serveur JS : HTML/CSS/WASM, contrôles clavier/accessibilité,
  filtres/copie/sélection et contenu, avec tests réellement adaptés à ces fonctions.
- StdIO et HTTP JSON-RPC, flux événements, broker desktop, services IA existants
  et refus d'accès hors profil testés après composition.
- Aucun service privilégié implicitement publié, aucune synchronisation provider,
  aucun secret ou store déplacé au titre de l'unification.
- Retrait des implémentations remplacées seulement après qualification des
  consommateurs et du rollback. Une table de routes ou un build vert isolé ne
  prouve pas l'ensemble de la migration.
