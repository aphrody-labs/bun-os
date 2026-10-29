<!-- SPDX-License-Identifier: Apache-2.0 -->
# Automatisations partagées

> **Carte de migration historique.** Les catégories et wrappers hérités ne
> constituent pas l’inventaire courant. L’implémentation Infra partagée du
> monorepo appartient à `packages/infra/workspace`; vérifie les commandes dans
> son `package.json`, `src/ops.ts` et les manifests racine avant d’utiliser un
> wrapper mentionné ci-dessous.

`packages/infra/workspace` est l’autorité pour les automatisations qui ne
portent ni données produit, ni contrat d’application, ni dépendance upstream.
Chaque dépôt conserve une entrée `bun run`, `just` ou wrapper compatible qui
appelle `yolo ops`.

## Opérations centralisées

| Opération | Usage |
| --- | --- |
| `docs-links`, `docs-overlaps` | Contrôles de documentation locaux et routes web |
| `imports-exports`, `monorepo-audit`, `monorepo-gate` | Structure TypeScript/Rust/Bun |
| `python-quality`, `powershell-syntax`, `runtime-versions` | Gates de runtime et langage |
| `workspace-clean`, `workspace-deps`, `workspace-repair`, `gitignored-audit` | Hygiène de checkout, références et dépendances |
| `agent-home`, `agent-plugin-sync`, `git-attribution` | Contexte, plugin et historique de poste |
| `automation-inventory`, `repository-health` | Mesure et contrôle de santé des scripts sous `~/src` |

## Frontière

Les scripts restent dans leur dépôt lorsqu’ils pilotent un build, un test, une
publication, une source externe, une base de données ou une règle de domaine.
Les miroirs upstream et dépendances vendored ne sont pas modifiés par cette
migration.

Exécuter l’inventaire courant :

```sh
yolo ops automation-inventory --root ~/src --json
```

## Périmètre contrôlé

L’inventaire `yolo ops automation-inventory --root ~/src --json`
est relu après chaque migration. Les surfaces restantes ont la frontière suivante :

| Surface | Raison de conserver les scripts locaux |
| --- | --- |
| `bun`, `oxc` | Forks upstream; leurs scripts de build, publication et synchronisation restent alignés sur leurs projets sources. |
| `aphrody-ui/drive`, `aphrody-os/drive` | Arbres Drive upstream synchronisés. |
| `nie` | Reconstruction, assets de jeu, Steam, forge et validations mathématiques propres au produit. |
| `aphrody-ai` | Tests d’inférence et déploiements de fournisseurs IA propres à ses services. |
| `aphrody-os` | WinClean, WSLg, noyau et intégration Windows propres au système. |

Les wrappers locaux d’automatismes partagés sont conservés pour les commandes
existantes; leur implémentation vit sous `packages/infra/workspace`.
