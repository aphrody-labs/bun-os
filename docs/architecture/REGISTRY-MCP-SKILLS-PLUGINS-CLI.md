# Registre Canonique : MCPs, Skills, Plugins & CLIs de Bun OS

<!-- SPDX-License-Identifier: Apache-2.0 -->
*Consolidation majeure : Novembre 2026 • Révision Bun OS v1.4.7*

Ce document constitue la **source unique de vérité** pour l'ensemble des serveurs MCP (Model Context Protocol), collections de Skills pour agents IA, plugins du runtime Bun & Tauri, et outils en ligne de commande (CLIs) du monorepo Bun OS (`aphrody-labs/bun-os`).
Le registre programmatique typé et auditable est implémenté dans `@aphrody/registry` (`packages/registry`).

---

## 1. Cartographie des Serveurs MCP (Model Context Protocol)

Suite à la consolidation architecturale, les 17 serveurs et stubs fragmentés historiques sont regroupés en **7 Hubs MCP de domaine majeurs** :

| Nom / Hub MCP | Runtime | Emplacement | Rôle & Capacités Principales | Composants Consolidés & Subsumés |
|---|---|---|---|---|
| **`aphrody-mcp`** | Rust | `crates/aphrody-mcp` | Serveur maître MCP stdio/HTTP : navigateur Obscura, WebGPU, OCR/STT local, A2A agent mesh, moteur de décision JEV. | Subsume les clients stubs et helpers réseau. |
| **`craft-suite-mcp`** | Rust | `crates/craft-suite-mcp` | **Suite créative unifiée** : CAD, vectoriel, slides, feuilles de calcul, documents riches, inspection de calques et retouche photo. | Subsume les 8 anciens MCPs : `cadcraft-mcp`, `deckcraft-mcp`, `designcraft-mcp`, `figcraft-mcp`, `gridcraft-mcp`, `lightcraft-mcp`, `vectorcraft-mcp`, `wordcraft-mcp`. |
| **`playwright-mcp`** | Bun / TS | `packages/playwright-mcp` | Rapatrié et standardisé : navigation headless autonome, snapshots DOM, captures d'écran, formulaires et évaluation JS. | Rapatrié depuis `.playwright-mcp` isolé. |
| **`m3-mcp`** | Bun / TS | `packages/m3-mcp` | Hub de design et 3D : tokens Material 3, contraste WCAG 2.2, parité Replica, outils 3Dviz Pro Max et automatisation de scènes Blender 4+. | Subsume `bun-blender-mcp` et les scripts 3D isolés. |
| **`bun-arch-mcp`** | Bun / TS | `packages/bun-arch-mcp` | Hub systèmes Linux & packaging : recherche Arch Wiki & Omarchy offline (SQLite FTS5), RPC AUR, pacman, systemd et linter PKGBUILD. | FTS5 unifié et requêtes directes. |
| **`gws-mcp`** | Bun / TS | `packages/google` | Serveur officiel Google Workspace : Drive, Docs, Sheets, Gmail, Calendar, Vertex AI. | Outil intégré au CLI `gws`. |
| **`aphrody-nie-mcp`** | Rust | `crates/aphrody-nie-mcp` | Hub de rétro-ingénierie jeu & formats propriétaires (Level-5, VFS, PE, shaders, modèles 3D). | Moteur spécialisé Level-5. |

---

## 2. Cartographie des Collections de Skills (pour Agents IA)

Les 52 skills étendent les capacités des agents autonomes (Antigravity `agy`, Claude Code, Codex, Gemini CLI) via des instructions `SKILL.md` normalisées avec frontmatter YAML canonique (`name` + `description`).

### A. Skills Systèmes, Design et 3D
- **`arch-linux`** (`packages/bun-arch-mcp/skills/arch-linux`) : Administration Arch/CachyOS/Omarchy, packaging PKGBUILD, pacman, systemd.
- **`ui-ux-pro-max`** (`packages/m3-design/skill/ui-ux-pro-max`) : Intelligence UI/UX complète : 79 styles, 192 palettes, 74 typographies, 123 règles UX, 25 stacks.
- **`3dviz-pro-max`** (`packages/viz3d/plugin/skills/3dviz-pro-max`) : Conception de scènes 3D, kits WebGPU, validation géométrique et capture CDP.
- **`spacedrive-cli`** (`apps/spacedrive/.agents/skills/spacedrive-cli`) : Guide de commande et gestion de fichiers Spacedrive VMM.

### B. Collection Replica (Rétro-Ingénierie & Reproduction)
Unifiée dans `packages/replica-skills/skills/` :
- `replica-architect`, `replica-backend`, `replica-brand`, `replica-build`, `replica-deploy`, `replica-design`, `replica-diff`, `replica-entrepreneur`, `replica-launch`, `replica-recon`, `replica-test`.

### C. Collection NIE & Emulation (Level-5 / Inazuma Eleven)
Standardisée dans `packages/iecode-docs/.agents/skills/` et `packages/nie-ui/skills/` :
- `assembler-modeles-textures`, `cpp-cmake-vcpkg`, `creer-assets-3d`, `aphrody-dust-cli`, `formats-level5`, `ievr-terminologie`, `jouer-ievr`, `level5-universe`, `nie-architecture`, `nie-monorepo`, `nie-re-workflow`, `nie-render-pipeline`, `niers-vfs`, `pe-symbol-recovery`, `peaufiner-rendu-3d`, `pixel-perfect`, `pixel-perfect-aphrody`, `rose-griffon`, `source-of-truth`, `workflow-unifie`.

---

## 3. Cartographie des Plugins

Les plugins sont structurés en 4 ensembles cohérents :

### A. Suite de Plugins Bun OS (`packages/bun-os-plugins`)
Préchargée une seule fois via `bunfig.toml` sur le runtime upstream Bun canary (`1.4.4+`), elle regroupe 4 domaines majeurs :
1. **`dev`** : Devtools de compilation, renames journalisés (`bunos rename`), AST TypeScript (`oxc`), micro-benchmarks (`bunos bench`), inspection de transpilation (`bunos parse`).
2. **`host`** : Intégration hôte `.NET` via `hostfxr`, environnement Python/uv, toolchain MSVC, intégration PowerShell native.
3. **`windows`** : Métadonnées WinMD, intégration WinGet, gestion d'énergie et hooks système bas niveau.
4. **`ai`** : Registre d'agent plugins, injection de skills et orchestration de contextes MCP.

*(Les alias redondants comme `bunos-migrate` dupliquant `bunos-n2b` ont été purgés des points d'entrée de binaires).*

### B. Plugins Tauri 3 & Shells Natifs
- **`tauri-plugin-aphrody`** (`crates/tauri-plugin-aphrody`) : Runtime Bun comme backend natif Tauri 3 (subsume les wrappers HTTP et Lu).
- **`tauri-plugin-mcp-bridge`** (`crates/tauri-plugin-mcp-bridge`) : Pont WebSocket reliant les webviews Tauri au protocole MCP.
- **`nu_plugin_windows`** (`crates/nu_plugin_windows`) : Extension native Windows pour Nushell (`nu`).

---

## 4. Cartographie des Outils CLI (Ligne de Commande)

Le nombre de binaires CLI indépendants a été consolidé autour de **5 CLIs Principaux de Référence** :

| Binaire Principal | Emplacement | Scope & Rôle | Sous-commandes & CLIs Fusionnés |
|---|---|---|---|
| **`bunos`** | `packages/bunos-run/src/bunos.ts` | **Porte d'entrée unifiée de Bun OS** : détection et exécution de binaires hétérogènes (ELF, APK, PE, MSI, WASM), routeur des 30 commandes du runtime. | Subsume `cli-wasm` (`bunos wasm`), `m3-design` (`bunos m3`), et élimine les wrappers binaires fragmentés. |
| **`aphrody`** | `crates/aphrody/src/main.rs` | **Binaire système multicall natif** : mesh WireGuard de la flotte, appels kernel, VFS, orchestrateur A2A et migration n2b. | Subsume `cadcraft-cli` (`aphrody craft cad`), `nie` (`aphrody nie`), et `n2b` (`aphrody n2b`). |
| **`buncc`** | `packages/buncc/src/cli.ts` | **Compilateur C/C++ et gestionnaire de toolchains** : builds multi-cibles (posix, mingw, msys2, wine), configuration d'architectures et cache distribué. | Pilote unifié de compilation système. |
| **`yolo`** | `packages/yolo-cli/src/index.ts` | **Agent d'automatisation IA autonome** : refactorings transversaux, audit de code, vérification de conformité. | Agent de workspace. |
| **`gws`** | `packages/google/src/gws-cli.ts` | **CLI Google Workspace & Cloud unifié** : gestion de documents, Drive, Sheets, Gmail, et serveur MCP intégré. | CLI de productivité cloud. |

---

## 5. API Programmatique du Registre (`@aphrody/registry`)

```typescript
import { listMcpServers, listSkills, listPlugins, listClis, getRegistry } from "@aphrody/registry";

// Inspection de la cartographie consolidée
const mcps = listMcpServers();      // 7 Hubs majeurs (avec historique des composants subsumés)
const skills = listSkills();        // 52 Skills normalisés
const plugins = listPlugins();      // 4 Suites de plugins
const clis = listClis();            // 5 CLIs phares

// Détail d'un composant consolidé
const craftSuite = mcps.find(s => s.id === "craft-suite-mcp");
console.log(craftSuite?.subsumes); 
// ["cadcraft-mcp", "deckcraft-mcp", "designcraft-mcp", "figcraft-mcp", "gridcraft-mcp", "lightcraft-mcp", "vectorcraft-mcp", "wordcraft-mcp"]
```
