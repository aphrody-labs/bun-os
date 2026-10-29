> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Architecture Agent-First & Maturation de la Stack

Document normatif définissant l'arbre de décision technologique, la rigueur d'auditabilité Agent-First, la boucle récursive d'outillage et l'exposition multiprotocole (MCP, FFI, API).

---

## 1. Rigueur & Auditabilité

### Mesure absolue
Toute opération doit être systématiquement mesurée, testée et vérifiée :
- Horodatages ISO-8601 stricts (`startedAt`, `timestamp`).
- Durées et débits en haute précision nanoseconde (`Bun.nanoseconds()`).
- Empreintes d'intégrité et détection de modifications ultra-rapides (`Bun.hash.wyhash`, `crc32`). La provenance cryptographique formelle et les pins d'intégrité de sécurité demeurent rigoureusement garantis sur SHA-256 (comme les pins de l'arbre Aphrody).
- Métriques d'accélération et de parallélisme (`wallMs`, `sumGateMs`, `speedup`).

### Agent-First
Toutes les sorties de la CLI interne (`yolo`) doivent être directement exploitables sans scraping textuel ou regex fragile :
- **`--json` :** Schémas versionnés stricts (`yolo.verify/1`, `yolo.status/1`, `yolo.scan/1`, `yolo.parse/1`, `yolo.bench/1`, `yolo.doctor/1`, `yolo.tools/1`).
- **`--md` :** Tableaux Markdown GitHub-Flavored propres, sans codes d'échappement ANSI.

---

## 2. Boucle Récursive de l'Outillage (CLI ↔ Projet)

```
┌─────────────────────────────────────────────────────────┐
│               BOUCLE RÉCURSIVE DE L'OUTILLAGE          │
└─────────────────────────────────────────────────────────┘
        ▲                                         │
        │ Projets & Besoins                       │ Outillage interne
        │ (tests, scans, FFI,                     │ (`yolo` CLI, MCP,
        │  diagnostics, gates)                    │  serveur REST)
        │                                         ▼
   ┌─────────┐    Factorisation Native     ┌──────────────┐
   │ One-    │ ─────────────────────────► │ yolo CLI     │
   │ Liners  │    (Bun.Glob, wyhash,      │  (Bun / TS7) │
   │ Éliminés│     Bun.serve, FFI)        └──────────────┘
```

- **Symbiose :** La CLI répond immédiatement aux besoins du projet ; chaque besoin récurrent ou opération d'inspection enrichit la CLI sous forme de commande typée.
- **Factorisation immédiate :** Élimination systématique des commandes lentes et des *one-liners* (`find | xargs wc -l`, scripts Python ad-hoc, inline `bun -e`) au profit de sous-commandes natives intégrées (`yolo scan`, `yolo parse`, `yolo bench`, `yolo doctor`).
- **Exécution YOLO autonome :** Workflows nativement récursifs, massivement parallèles (via limiteurs de concurrence partagés), automatisables sans intervention humaine intermédiaire.

---

## 3. Maturation de la Stack (Arbre de Décision)

```
                         Besoin Fonctionnel / Technique
                                       │
                                       ▼
          ┌────────────────────────────────────────────────────────┐
          │  Tier 1 : Bun / TypeScript Natif (Socle par défaut)    │
          │  Orchestration, CLI interne, I/O zero-copy, prototypage│
          └────────────────────────────────────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
        ▼ Bibliothèque officielle ?    ▼ Chemin critique / perf ?     ▼ Écosystème tiers IA/ML ?
 ┌───────────────────────────┐  ┌───────────────────────────┐  ┌──────────────────────────────┐
 │ Tier 3 : C / C++          │  │ Tier 2 : Rust (Maturation)│  │ Tier 5 : Python via `uv`     │
 │ Adoption immédiate        │  │ Crates workspace, C ABI,  │  │ Modèles IA (Gemma 4, SFT/DPO,│
 │ WebKitGTK, SQLite, zstd   │  │ calcul intensif, SIMD, FFI│  │ GGUF), envs isolés sans     │
 │ C ABI / `bun:ffi` direct  │  └───────────────────────────┘  │ pollution globale            │
 └───────────────────────────┘                                 └──────────────────────────────┘
                                                                              │
                                                                              ▼ Bas niveau interpréteur ?
                                                                ┌─────────────────────────────┐
                                                                │ Tier 4 : CPython (Restreint)│
                                                                └─────────────────────────────┘
```

1. **Bun / TypeScript (Natif) :** Socle par défaut pour l'orchestration, l'outillage interne, la CLI et le prototypage rapide. Exploite les primitives natives Bun (`Bun.file`, `Bun.Glob`, `Bun.hash.wyhash`, `Bun.serve`, `Bun.TOML`, `Bun.JSONL`).
2. **C / C++ (Adoption immédiate) :** Dès qu'une bibliothèque officielle de référence existe déjà en C/C++ (WebKitGTK, Wry, SQLite, zstd), adoption immédiate sans réimplémentation redondante, interfacée via le C ABI ou `bun:ffi`.
3. **Rust (Maturation ciblée) :** Cible finale pour remplacer le code TypeScript/Bun sur le chemin critique dès que la performance brute, le calcul intensif, la sûreté mémoire sans GC ou la distribution binaire autonome l'exigent ([yolo-core du SDK Bun épinglé](https://github.com/aphrody-labs/bun/tree/6181424bc2fca4349560832161c07ba85c33e8ef/packages/bun-runtime-sdk/crates/yolo-core), `crates/engine/yolo-runtime`, `crates/engine/yolo-desktop` (not in repo)).
4. **Python via `uv` (Écosystème IA / ML) :** Mobilisé dès qu'un écosystème externe de modèles ou bibliothèques spécialisées (Gemma 4, PyTorch, Hugging Face, Unsloth) est requis, strictement conteneurisé sous des environnements `uv` isolés.
5. **CPython (Restreint) :** Réservé exclusivement aux besoins système très bas niveau liés aux détails internes de l'interpréteur.

---

## 4. Exposition & Protocoles Modulaires

Chaque fonctionnalité de la CLI `yolo` est conçue pour être exposée via quatre protocoles complémentaires :

### 1. CLI Entrypoint
- Exécutable autonome ou script repo `./bin/yolo`.
- Formatage adaptatif : terminal couleur ANSI pour l'humain, `--json` et `--md` pour les agents IA.

### 2. MCP (Model Context Protocol 2024-11-05)
- Commande `aphrody-mcp`.
- Serveur stdio JSON-RPC 2.0 natif zéro dépendance npm.
- Expose le catalogue d'outils aux agents IA (Antigravity, Claude Code, Gemini CLI, etc.) :
  - `yolo_verify` : exécution parallèle des quality gates.
  - `yolo_status` : état des submodules, crates vendored et Cargo workspace.
  - `yolo_scan` : scan récursif rapide (lignes, octets, wyhash).
  - `yolo_parse` : analyse AST, imports, exports et checksum.
  - `yolo_bench` : micro-benchmarks wyhash, crc32, stringWidth.
  - `yolo_doctor` : diagnostic toolchain et runtime.
  - `yolo_host_space` : mesure d'espace disque avec déduplication d'inodes.

### 3. API / REST / OpenAPI 3.1
- Commande `yolo api [--port N] [--host H]`.
- Serveur HTTP haute performance sous `Bun.serve` avec support CORS.
- Endpoints REST : `/health`, `/api/status`, `/api/verify`, `/api/parse`, `/api/bench`, `/api/doctor`, `/api/scan`, `/api/tools`, `/api/openapi.json`.

### 4. FFI (Foreign Function Interface) & PyO3 Native Interop
- **TypeScript / Bun (`bun:ffi`) :** Couche `packages/engine/runtime` (`@aphrody/yolo-runtime`) interfacée avec `crates/engine/yolo-runtime` via `bun:ffi` zéro-copie (`ptr(Float64Array)` direct sans sérialisation).
- **Python / PyO3 0.29 ([yolo-pyo3 du SDK Bun](https://github.com/aphrody-labs/bun/tree/84a5f33140cef2a63088d8484e84c0a2e5aba785/packages/bun-runtime-sdk/crates/yolo-pyo3)) :** Extension native `_yolo_native` compilée avec Maturin, exploitant `py.detach()` pour relâcher instantanément le GIL et basculer sur les cœurs de calcul Rayon SIMD, prête pour CPython 3.14t Free-Threaded (PEP 703 No-GIL).
- **Package Python `yolo` (`packages/python` (not in repo)) :** Intégration Pydantic V2, Apache Arrow IPC / Polars DataFrame, stubs typés PEP 484/561 (`py.typed`, `_yolo_native.pyi`).
- C ABI versionné (`EXPECTED_ABI_MAJOR = 1`, `EXPECTED_ABI_MINOR = 4`).
- Zéro dépendance d'en-tête externe, gestion stricte des lifetimes et panic boundaries.
