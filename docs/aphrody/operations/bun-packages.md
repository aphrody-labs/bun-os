> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Packages Bun : installation et release

Bun ≥ 1.4.2 est requis. Le runtime Bun lui-même et `@aphrody/bun-types`, `@aphrody/bun-runtime` viennent du [fork aphrody-labs/bun](../reference/upstream-bun/APHRODY-FORK.md), pas de ce catalogue. Depuis le clone Aphrody, une seule commande installe dans un projet consommateur les versions npm qualifiées du catalogue :

```sh
bun run packages:install --cwd /chemin/du/projet
```

Le projet doit avoir son `package.json` (`bun init`). PowerShell utilise la même commande avec un chemin Windows. Le programme vérifie d’abord la disponibilité de toutes les versions sélectionnées sur npm, puis appelle `bun add` avec des versions exactes. Il ne change pas implicitement le monorepo et ne configure aucun serveur MCP.

```sh
bun run packages:install --list
bun run packages:install --cwd /chemin/du/projet --only @aphrody/fuzzy,@aphrody/qr
```

Le [catalogue](../../../tools/aphrody/config/npm-packages.json) distingue les versions publiées des packages bloqués. Les applications et exemples privés ne sont pas publiés sur npm. Les versions Tauri alpha et canary sont publiées sous `next` ; l’installateur utilise leurs versions exactes. Les API Tauri nécessitent un hôte compatible pour agir sur le système ; l’installation du JavaScript ne remplace pas l’installation d’un hôte natif.

## Gates et archives

`bun run packages:audit` fabrique les vraies archives avec `bun pm pack`, exécute les scripts de prépack et contrôle les exports, imports relatifs, dépendances résolues, métadonnées de licence et noms de fichiers protégés. Les archives en échec sont retirées du répertoire temporaire. Les fichiers publiés passent par des listes explicites ; les dépendances `workspace:` et `catalog:` sont transformées par Bun dans l’archive, jamais à la main dans le lockfile.

```sh
bun run bun:check
bun run typecheck
bun run packages:audit --only @aphrody/fuzzy,@aphrody/qr --out /tmp/aphrody-npm
```

Une archive valide ne suffit pas à qualifier une release : les tests, lint, format, build applicable et l’installation depuis npm restent nécessaires. Les artefacts WASM sont construits par la fabrique VPS et les packages natifs exigent leurs artefacts et tests propres. Canvas vérifie ses copies contre la release npm officielle immuable et son SHA-512 lorsque le checkout upstream absorbé est absent.

## Capacité et placement

Directive propriétaire du 2026-10-07 : tout Shenron (production et builds) sur DBFR ; VPS réservé à Aphrody. Libérer substantiellement l’espace lorsque le disque bloque un gate, en préservant les données protégées, les copies vérifiées, le travail actif et les caches partagés.

Le runbook `scripts/audit/infra/reclaim-cargo-test-binaries.py` a retiré 27 exécutables de tests inactifs de plus de deux heures, sans lien partagé, et a libéré 14 389 207 040 octets sur `/srv`. Les bibliothèques, sccache, sources Cargo/Bun, stores et binaires installés restent préservés. Le routage Cargo de Shenron est épinglé à DBFR ; la migration des stores reste dans le lot Infra de cutover existant.

## Catalogue de cette livraison

Le tableau ci-dessous est produit depuis les archives auditées et les réponses de publication, puis vérifié contre npm.

| Paquet                              | Version           | État                                                      | Source                                                                                                |
| ----------------------------------- | ----------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@aphrody/a2a`                      | `0.1.1`           | Publié                                                    | [manifest](../../../packages/a2a/package.json)                                                        |
| `@aphrody/agent-browser`            | `1.0.0-canary`    | Qualification restante                                    | [manifest](../../packages/web/agent-browser/package.json)                                             |
| `@aphrody/api`                      | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-api/package.json)                                         |
| `@aphrody/app-ui`                   | `0.1.0`           | Qualification restante                                    | [manifest](../../m3/packages/app-ui/package.json)                                                     |
| `@aphrody/assets`                   | `0.1.1`           | Publié                                                    | [manifest](../../m3/packages/assets/package.json)                                                     |
| `@aphrody/bun`                      | `3.3.7`           | Qualification restante                                    | [manifest](../../../packages/aphrody-bun/package.json)                                                |
| `@aphrody/canvas`                   | `1.0.9-aphrody.4` | Publié                                                    | [manifest](../../m3/packages/canvas/package.json)                                                     |
| `@aphrody/cli-wasm`                 | `0.1.1`           | Publié                                                    | [manifest](../../../packages/cli-wasm/package.json)                                                |
| `@aphrody/discord-kit`              | `0.1.1`           | Publié                                                    | [manifest](../../../packages/discord-kit/package.json)                                                   |
| `@aphrody/doc-ai`                   | `3.2.7`           | Publié                                                    | [manifest](../../../packages/doc-ai/package.json)                                                     |
| `@aphrody/drive-client`             | `0.1.1`           | Publié                                                    | [manifest](../../../packages/drive-client/package.json)                                               |
| `@aphrody/eslint-plugin-m3`         | `3.3.4`           | Publié                                                    | [manifest](../../m3/packages/eslint-plugin-m3/package.json)                                           |
| `@aphrody/fuzzy`                    | `0.1.1`           | Publié                                                    | [manifest](../../packages/web/fuzzy/package.json)                                                     |
| `@aphrody/google`                   | `1.0.0-canary.1`  | Publié                                                    | [manifest](../../packages/google/google/package.json)                                                 |
| `@aphrody/http`                     | `0.1.1`           | Retiré du dépôt (dernière version npm conservée)          | —                                                                                                     |
| `@aphrody/identity`                 | `0.1.1`           | Publié                                                    | [manifest](../../m3/packages/identity/package.json)                                                   |
| `@aphrody/inference`                | `0.1.1`           | Retiré du dépôt (dernière version npm conservée)          | —                                                                                                     |
| `@aphrody/m3`                       | `3.3.7`           | Qualification restante                                    | [manifest](../../m3/packages/m3/package.json)                                                         |
| `@aphrody/m3-ai`                    | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-ai/package.json)                                                      |
| `@aphrody/m3-baseui`                | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-baseui/package.json)                                                  |
| `@aphrody/m3-bun`                   | `3.3.7`           | Qualification restante                                    | [manifest](../../m3/packages/m3-bun/package.json)                                                     |
| `@aphrody/m3-codemods`              | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-codemods/package.json)                                                |
| `@aphrody/m3-config`                | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-config/package.json)                                                  |
| `@aphrody/m3-design`                | `3.3.7`           | Qualification restante                                    | [manifest](../../m3/packages/m3-design/package.json)                                                  |
| `@aphrody/m3-explorer`              | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-explorer/package.json)                                                |
| `@aphrody/m3-fonts`                 | `3.3.7`           | Publié                                                    | [manifest](https://github.com/aphrody-labs/material/blob/main/packages/m3-fonts/package.json)         |
| `@aphrody/m3-forms`                 | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-forms/package.json)                                                   |
| `@aphrody/m3-front`                 | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-front/package.json)                                                   |
| `@aphrody/m3-icons`                 | `3.3.7`           | Qualification restante                                    | [manifest](../../m3/packages/m3-icons/package.json)                                                   |
| `@aphrody/m3-mcp`                   | `3.3.7`           | Publié                                                    | [manifest](../../../bun/packages/aphrody-migrated/m3/aphrody-m3-mcp/package.json)                                                     |
| `@aphrody/m3-motion`                | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-motion/package.json)                                                  |
| `@aphrody/m3-next`                  | `3.3.7`           | Qualification restante                                    | [manifest](../../m3/packages/m3-next/package.json)                                                    |
| `@aphrody/m3-next-migrate`          | `3.3.7`           | Qualification restante                                    | [manifest](../../m3/packages/m3-next-migrate/package.json)                                            |
| `@aphrody/m3-os-themes`             | `3.3.7`           | Publié                                                    | [manifest](../../../bun/packages/aphrody-migrated/m3/aphrody-m3-os-themes/package.json)                                               |
| `@aphrody/m3-primitives`            | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-primitives/package.json)                                              |
| `@aphrody/m3-react`                 | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-react/package.json)                                                   |
| `@aphrody/m3-reader`                | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-reader/package.json)                                                  |
| `@aphrody/m3-tailwind`              | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-tailwind/package.json)                                                |
| `@aphrody/m3-theme`                 | `3.3.7`           | Qualification restante                                    | [manifest](../../m3/packages/m3-theme/package.json)                                                   |
| `@aphrody/m3-tokens`                | `3.3.7`           | Publié                                                    | [manifest](../../m3/packages/m3-tokens/package.json)                                                  |
| `@aphrody/material-design-icons`    | `1.0.1`           | Publié                                                    | [manifest](../../m3/packages/material-design-icons/package.json)                                      |
| `@aphrody/n2b-core`                 | `0.6.4`           | Publié ; remplacé par `@aphrody/bun-plugin-n2b`           | [`aphrody-labs/bun/packages/bun-n2b`](https://github.com/aphrody-labs/bun/tree/main/packages/bun-n2b) |
| `@aphrody/os`                       | `0.1.0`           | Qualification restante                                    | [manifest](../../packages/os/kernel-client/package.json)                                              |
| `@aphrody/ovh`                      | `0.2.1`           | Publié                                                    | [manifest](../../packages/infra/ovh/package.json)                                                     |
| `@aphrody/paths`                    | `0.1.1`           | Publié                                                    | [manifest](../../packages/infra/paths/package.json)                                                   |
| `@aphrody/plugin-autostart`         | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-autostart/package.json)                            |
|||| `@aphrody/plugin-clipboard-manager` | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-clipboard-manager/package.json)                    |
| `@aphrody/plugin-deep-link`         | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-deep-link/package.json)                            |
| `@aphrody/plugin-dialog`            | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-dialog/package.json)                               |
| `@aphrody/plugin-fs`                | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-fs/package.json)                                   |
|| `@aphrody/plugin-global-shortcut`   | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-global-shortcut/package.json)                      |
||| `@aphrody/plugin-log`               | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-log/package.json)                                  |
|| `@aphrody/plugin-notification`      | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-notification/package.json)                         |
| `@aphrody/plugin-opener`            | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-opener/package.json)                               |
| `@aphrody/plugin-os`                | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-os/package.json)                                   |
|| `@aphrody/plugin-process`           | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-process/package.json)                              |
||| `@aphrody/plugin-store`             | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-store/package.json)                                |
|| `@aphrody/plugin-updater`           | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-updater/package.json)                              |
||| `@aphrody/plugin-window-state`      | `3.0.0-alpha.3`   | Publié                                                    | [manifest](../../crates/tauri/aphrody-tauri-plugin-window-state/package.json)                         |
| `@aphrody/plugins`                  | `1.0.1`           | Retiré du dépôt (dernière version npm conservée)          | —                                                                                                     |
| `@aphrody/qr`                       | `0.1.1`           | Publié                                                    | [manifest](../../packages/web/qr/package.json)                                                        |
| `@aphrody/rag-core`                 | `0.1.1`           | Publié                                                    | [manifest](../../../packages/rag-core/package.json)                                                   |
| `@aphrody/runtime-sdk`              | `0.1.1`           | Publié                                                    | [manifest](../../../packages/runtime-sdk/package.json)                                                |
| `@aphrody/scaffold`                 | `1.0.0-canary.1`  | Publié                                                    | [manifest](../../m3/packages/scaffold/package.json)                                                   |
| `@aphrody/shell-web`                | `0.1.1`           | Publié                                                    | [manifest](../../../packages/shell-web/package.json)                                                     |
| `@aphrody/sql`                      | `0.1.1`           | Publié                                                    | [manifest](../../../packages/sql/package.json)                                                     |
| `@aphrody/update`                   | `0.1.1`           | Publié                                                    | [manifest](../../../packages/update/package.json)                                                  |
| `@aphrody/web-test`                 | `0.2.6`           | Qualification restante                                    | [manifest](../../packages/web/aphrody-web-test/package.json)                                          |
| `@aphrody/web-to-tauri`             | `1.0.0-canary`    | Qualification restante                                    | [manifest](../../m3/packages/web-to-tauri/package.json)                                               |
| `@aphrody/webview-page`             | `0.1.1`           | Publié ; remplacé par `@aphrody/bun-webview-page` du fork | [manifest](https://github.com/aphrody-labs/bun/blob/main/packages/bun-webview-page/package.json)      |
| `@aphrody/winclean`                 | `0.1.0`           | Qualification restante                                    | [manifest](../../../packages/winclean/package.json)                                                   |
| `@aphrody/workspace`                | `0.1.0`           | Qualification restante                                    | [manifest](../../../packages/workspace/package.json)                                               |
| `@aphrody/x`                        | `1.3.0`           | Qualification restante                                    | [manifest](../../packages/web/x/package.json)                                                         |
| `@aphrody/xai`                      | `1.1.6`           | Retiré du dépôt (dernière version npm conservée)          | —                                                                                                     |
| `@aphrody/yolo-cli`                 | `1.0.0`           | Qualification restante                                    | [manifest](../../../packages/yolo-cli/package.json)                                                   |
| `@aphrody/yolo-core`                | `1.0.1`           | Publié                                                    | [manifest](../../../packages/yolo-core/package.json)                                                   |
