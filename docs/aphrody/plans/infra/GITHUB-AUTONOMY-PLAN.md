<!-- SPDX-License-Identifier: Apache-2.0 -->
# GitHub et livraison autonome — plan Infra

Statut : plan, pas activation démontrée. Le relevé initial date du 2026-09-28.
Autorité courante : [PLAN racine](../../PLAN.md), [AGENTS.md](../../AGENTS.md).
Infra/`aphrody-git` possède inventaire, GitHub, CI et delivery ; Web/Contracts
possèdent auth/session ; UI réside dans le monorepo Aphrody.

## P0 — Inventaire et contrats

Relever dépôts/remotes/heads, forks/gitlinks, manifests/licences, CI,
artefacts, hôtes/domaines et états servis. Réutiliser les déclarations Infra
et le client Git existant, pas un deuxième contrôleur.
Les anciens décomptes, endpoints et versions ne prouvent pas l'état actuel.

Séparer login utilisateur, credentials développement/CI, scopes MCP et stores
de domaine. Secrets restent hors docs/logs/binaries ; variables OAuth locales
ne prouvent ni callback actif ni identité GitHub autorisée pour automatisation.
Réutiliser les identités autorisées ; aucune nouvelle app/bot ajouté aux orgs.

## P1 — Auth Web/GUI/MCP

| Contrat | Qualification |
| --- | --- |
| Login GitHub | Implémentation Web choisie et testée ; pas parité Better Auth supposée |
| OAuth | state imprévisible, PKCE S256, redirect exact, code unique, scopes minimaux |
| Session | ID GitHub stable, liaison de compte explicite, rôles distincts du login |
| Cookies | Secure/HttpOnly/SameSite, CSRF, expiration/révocation et rotation |
| Web | DNS/TLS/route/service/migration qualifiés, callback/logout et refus state |
| Desktop | Navigateur système et retour app lié à la tentative ; pas session navigateur copiée |
| MCP resource server | Issuer/audience/scopes/découverte selon version négociée ; chaque jeton/session vérifiés |

Préserver les routes Web/Files, PostgreSQL et stores secrets.
La GitHub OAuth App utilisateur n'émet pas automatiquement les tokens Aphrody.
Gate : parcours réel, refus d'accès et rollback schéma/release.
Aucun service retiré n'est activé par cette rédaction.

## P2 — Dépôts et Git

Dépôts privés et remotes existants ; transferts/publication seulement dans leur autorité explicite. Conserver redirects, identities packages/npm, upstreams, règles et gitlinks. Pas force-push, reset/stash/clean de changements concurrents.

Travailler sur la branche autorisée dans le checkout existant ; claims disjoints,
un intégrateur et gates requis. Pas worktree jetable par agent.
Déclarations README/licence/CONTRIBUTING/SECURITY/CODEOWNERS chez les owners ;
ne pas remplacer les notices upstream/FSL. Identité de commit : AGENTS.md.

## P3 — Build, release et déploiement

1. Réutiliser la CI propriétaire : callers épinglés, permissions par job,
   secrets absents des PR non fiables, caches isolés, gates/manifest par cible.
2. Construire l'artefact immuable : SHA, provenance/SBOM, empreinte, signatures
   pertinentes ; requalifier le commit intégré.
3. Canary sur cible déclarée puis santé/TLS/parcours/rollback ; promotion via
   Infra uniquement dans le périmètre de déploiement autorisé.
4. Versions par package et graphes réels : contraintes/lockfiles, API/schémas
   compatibles, canary/nightly identifiés. Publication registry selon authority
   explicite et noms possédés, pas sur la seule réussite d'un dry-run.
5. Release/tag : assets par cible, checksums/provenance ; URL de téléchargement
   active seulement si elle résout des assets qualifiés.
6. CLI/GUI : manifeste HTTPS/signé, hash/cible/canal/compatibilité, remplacement
   atomique et rollback ; respecter package managers et signatures OS.

Réutiliser le contrôle plane Infra, aucun workflow parallèle ni service créé
pour contourner un défaut d'auth/CI. Consigner les échecs réels sans bypass.
No human in the loop dans le périmètre autorisé ; les gates restent obligatoires.

## P4 — Fraîcheur des forks

Sources, licences, refs suivies, patch stacks et consommateurs déclarés chez
leurs owners. Relever drift/advisories/API puis intégrer par workflow Git natif
dans les checkouts existants, sans copie source ou nouveau clone de recherche.
Qualifier les commits enfants avant mise à jour des gitlinks racine.
Divergence/test cassé : conserver la version et enregistrer le travail restant.
Ne pas annoncer parité ou fraîcheur exhaustive à partir d'une seule collecte.

## Clôture

P0 → pilotes P1/P2 → P3 → P4. Chaque lot possède chemins, scope et preuve.
Mesurer couverture d'inventaire, drift/âge upstream, taux CI, délai PR/merge,
commit→production, rollback, publication et clients à jour, avec fenêtre et
révision. Source, tests, release, installation et activation restent distincts.
