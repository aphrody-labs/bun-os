<!-- SPDX-License-Identifier: Apache-2.0 -->
# Livraison Bun du 2026-10-07

98 manifests first-party inventoriés : 92 paquets distribuables et six privés. Les 92 archives npm réelles passent l’audit des points d’entrée, imports relatifs, dépendances résolues et chemins protégés. Les applications de démonstration restent privées.

74 versions qualifiées sont publiées et vérifiées via les métadonnées publiques npm et leur intégrité SHA-512. Certaines versions ont initialement été reçues en staging : HTTP 404 à la lecture et HTTP 409 à une tentative de republication. La vérification a attendu leur disponibilité effective ; aucune version n’a été écrasée. Les versions alpha/canary conservent le tag `next`.

Le [catalogue](../../../tools/aphrody/config/npm-packages.json) conserve versions exactes, SHA-256/SHA-512 et dépendances de production. Le [guide](bun-packages.md) fournit la commande d’installation. Un projet vierge a installé les 74 paquets depuis npm ; les imports testés incluent fuzzy, HTTP, QR, core, runtime SDK, Google, scaffold, React, API/dialog Tauri, Canvas et RAG.

## Validation

- Doctrine Bun : 98 manifests, zéro violation ; TypeScript workspace passé.
- Audit de dépendances : zéro avis pour le consommateur des 74 paquets et pour le dépôt après mise à jour de React Router vers 7.18.2 ; app-ui conserve 215 tests passés et un typecheck valide.
- oxlint/oxfmt des modifications et contrôle whitespace passés ; avertissements globaux préexistants conservés.
- Archives : 92 valides, zéro échec. Outils de release et copies des configurations canoniques : dix tests passés.
- Routage de la fabrique : 24 tests passés.
- Canvas : 11 tests passés, un contrôle checkout-only ignoré ; provenance upstream immuable et Skia natif vérifiés.
- RAG : 14 tests passés ; WASM optimisé construit par la fabrique VPS.
- Shell web : dix tests passés, trois contrôles plateforme/intégration ignorés ; WASM optimisé construit par la fabrique.
- Scaffold : 23 tests passés ; Google : 16 ; workflows déplacés chez leur propriétaire : 35.
- Workspace : 297 tests passés, 20 contrôles externes ignorés ; xAI/WinClean/web-to-tauri : 139 tests passés, deux contrôles Grok live ignorés. Leur publication reste conditionnée aux dépendances et gates hôte.
- Tests source core passés. Catalogue hôte validé sur le snapshot suivi ; des unités de sauvegarde Infra concurrentes manquaient temporairement dans le catalogue du worktree actif.
- Génération, fraîcheur documentaire et liens internes passés.
- Aide CLI installée régénérée : 1 084 pages ; l’inventaire rapporte encore 27 échecs de capture, 36 commandes absentes et une entrée non résolue.

## Qualification restante

18 paquets restent exclus de la publication : Yolo CLI, app-ui, m3-bun, m3-design, m3-icons, m3-next-migrate, m3-next, m3-theme, m3, web-to-tauri, xai, workspace, bindings Bun natifs, os, winclean, agent-browser, web-test et x. Leurs gates runtime natif, adaptateurs hôte, navigateur/CDP ou intégration ne sont pas tous satisfaits. La suite complète du dépôt n’est donc pas verte. La compilation FFI release avec GPU a réussi sur la fabrique VPS en 17 min 32 s ; le binaire Linux GNU a été transféré avec contrôle de checksum et charge sous glibc 2.39. Les contrats FFI passent et m3-theme compte 13 tests passés. La suite native complète compte 28 tests passés, deux contrôles de bridges historiques ignorés et deux erreurs de tests de dérive pointant encore vers le propriétaire N2B retiré (ancien crate n2b-native). Aucun binaire non qualifié n’est publié.

## Capacité et placement

Directive propriétaire conservée dans le contexte opératoire durable : VPS réservé à Aphrody. La migration des stores protégés appartient au lot Infra de cutover existant.

Le nettoyage borné a retiré 27 anciens exécutables de tests inactifs à lien unique et observé 14 389 207 040 octets libérés sur `/srv` (environ 13,4 Gio). Binaires actifs, bibliothèques, caches de dépendances, sccache, installations et stores protégés sont préservés. Le [runbook](../../../scripts/aphrody/audit/infra/reclaim-cargo-test-binaries.py) planifie par défaut et revérifie l’identité des candidats avant une application explicite.
