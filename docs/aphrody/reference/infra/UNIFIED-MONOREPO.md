<!-- SPDX-License-Identifier: Apache-2.0 -->
# Unified Monorepo Architecture & Operations

Dernière consolidation : 2026-10-05.

Ce document constitue la référence unique pour l'architecture, la topologie et l'outillage unifié du grand monorepo **Aphrody / Yolo / M3 / Python**.

## 1. Topologie Canonique des Espaces de Travail

| Emplacement | Sous-système | Stack & Rôle |
|---|---|---|
| `/home/aphro/aphrody` | **Grand Monorepo Produit & Applications** | Monorepo racine Bun + Cargo (Apps, packages TS, Crates Rust, Web) |
| `/home/aphro/aphrody/m3` | **Aphrody Material 3 UI** | Submodule Git racine unifié (Forks Google M3, Base-UI, Fonts, TailwindCSS, Nie-UI) |
| `/home/aphro/aphrody/crates/compat` | **Tooling & N2B Bridge** | `yolo-tooling` (C ABI), `aphrody-n2b*`, `aphrody-oxc-bridge` bornés |
| `/home/aphro/yolo` | **Runtime & Engine Factory** | Fork Bun natif, Obscura V8/Headless, Tauri (CEF), FFI C ABI |
| `/home/aphro/aphrody-py` | **ML, Training & Python RAG** | Workspace UV autonome (Python 3.12, DeepMind Gemma 4, Jan, LoRA/QLoRA) |
| `/mnt/c/iecode` | **Hôte Windows Gaming & IEVR** | Dépôt natif Windows (`nie`, `ievr`, `rg`, `packages/nie-ui` (not in repo)) |

## 2. Résolution des Chemins Absolue & Cross-Platform

Tous les packages et outils consomment [`@aphrody/paths`](../../../packages/infra/paths/src/index.ts) :
- `workspacePath(...parts)` : Chemins résolus depuis la racine du monorepo sans dépendance au répertoire courant.
- `checkoutRoot("m3")` : Détecte `aphrody/m3` en priorité locale ou via `APHRODY_M3_ROOT`.
- `checkoutRoot("yolo")` : Résolution canonique vers `../yolo` ou `APHRODY_YOLO_ROOT`.
- `checkoutRoot("aphrody-py")` : Détecte le dossier `py/` ou sibling `aphrody-py`.
- `checkoutRoot("iecode")` : Résolution directe vers `/mnt/c/iecode` ou `APHRODY_IECODE_ROOT`.
- `portablePath(p)` : Normalisation déterministe des séparateurs pour manifestes et audits (`/`).

## 3. Déduplication des Scripts & Commandes d'Exploitation

Les commandes d'infrastructure et d'exploitation partagées sont centralisées via :
1. **`aphrody` CLI** (`~/.local/bin/aphrody`) : Point d'entrée produit, RAG, IA, kernel OS.
2. **`yolo` CLI** (`~/.local/bin/yolo`) : Moteur de compilation, scan wyhash, N2B in-process, tests de conformité, et les commandes des paquets Bun (`yolo ops|workspace|optimize|update|google|doc-ai|browser`) : workflow d'optimisation, édition de code par lot (`yolo workspace code-edit`), synchronisation de plugins (`yolo workspace plugins`).

Les doublons de scripts de build et de déploiement direct dans les sous-dossiers sont dépréciés au profit de `scripts/release/` et de l'orchestrateur d'inventaire `config/infra/` (not in repo).
