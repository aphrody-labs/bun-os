<!-- SPDX-License-Identifier: Apache-2.0 -->
# MISSION AUTONOME : SETUP COMPLET APHRODYOS, CONFIGURATION, CRATES, PACKAGES, APPS, DOCKER & INFRA

> **Directive d'exécution :** NHITL / YOLO — Exécution directe, intégrale et autonome.
> **Canal de coordination & rapports :** Salon Discord `#prompts` (`1557354132543766569`) — Guilde `1554189180030947338`.
> **Auteur des commits :** `aphrody-dev <contact@aphrody.com>` (aucune attribution d'assistant ou co-auteur).
> **Préservation des secrets :** Zéro fuite de credential, clé API ou token privé.

---

## 1. OBJECTIF GLOBAL ET PÉRIMÈTRE D'ACTION

Tu es l'agent d'ingénierie système en charge du déploiement, de la compilation, de la configuration et de l'activation intégrale de l'environnement **AphrodyOS**. Tu dois installer et qualifier l'ensemble des couches de l'écosystème :
1. **Toolchain & Prérequis** : Bun, Rust/Cargo, sccache, uv/Python (`vu`), Docker Compose, WireGuard.
2. **Noyau & Runtime AphrodyOS** : `aphrody_ffi` (cdylib), `aphrody-kernel`, agent PC unifié (`aphrody-pc-agent.service`), WinClean desktop broker.
3. **Crates Rust** : Compilation et validation de toutes les crates first-party (`aphrody`, `aphrody-mcp`, `rag-core`, `obscura`, `ui`, `ffi`).
4. **Packages Bun / TypeScript** : Installation des dépendances du monorepo, gates `@aphrody/*` (`workspace`, `product`, `discord-kit`, `sql`, `interop-native`, `web`).
5. **Applications Client & Surfaces Produit** : Application desktop CEF (`tauri-runtime-cef`), canonical UI (`m3/packages/app-ui`).
6. **Conteneurs Docker** : Déploiement et vérification du projet compose unique de chaque hôte (`~/apps/compose.yaml`), vaults de conteneurs et tunnels PostgreSQL.
7. **Infrastructure & Services Systemd** : Activation et surveillance des services VPS, DBFR et PC local selon le catalogue d'unités `tools/config/host/systemd/`.
8. **Maillage Réseau & Agent Home** : Vérification du réseau WireGuard `wg1`, synchronisation RAG / Agent Home (`~/.aphrody/db/aphrody.sqlite`).

---

## 2. DÉROULEMENT OPÉRATIONNEL ÉTAPE PAR ÉTAPE

### PHASE 1 : INITIALISATION DE L'ENVIRONNEMENT & TOOLCHAINS
1. Vérifier la présence et les versions des outils fondamentaux :
   - `bun --version` (requis : >= 1.4.2)
   - `cargo --version` et `rustc --version` (toolchain Rust stable/nightly)
   - `docker --version` et `docker compose version`
   - `uv --version` (pour le runtime Python `vu`)
2. Vérifier la configuration du compilateur et du cache partagé :
   - Configurer `sccache` (`RUSTC_WRAPPER=sccache`) pour accélérer les compilations Rust.
   - Respecter le plafond de parallélisme CPU (`APHRODY_CARGO_JOBS=4` sur machine partagée).

### PHASE 2 : NOYAU APHRODYOS, FFI & RUNTIMES NATIFS
1. **Compilation de la couche FFI native** :
   ```sh
   cargo build --release -p aphrody-ffi
   ```
   - Vérifier la présence de `target/release/libaphrody_ffi.so` (not in repo) (Linux, build output) ou `aphrody_ffi.dll` (Windows).
2. **Compilation du binaire multicall canonique `aphrody`** :
   ```sh
   cargo build --release -p aphrody
   # Installation du binaire sur le PATH
   install -m 755 target/release/aphrody ~/.local/bin/aphrody
   aphrody version
   aphrody doctor
   ```
3. **Déploiement de l'agent PC unifié (`aphrody-pc-agent`)** :
   - Point d'entrée : `packages/interop/native/src/pc-agent.ts`
   - Unité associée : `aphrody-pc-agent.service` (ou broker Windows natif).
   - Valider la communication IPC locale via socket Unix / Named Pipe.

### PHASE 3 : COMPILATION ET GATES DES CRATES RUST
Exécuter les vérifications strictes sur les crates du monorepo :
1. **Crates d'Infrastructure & CLI** :
   - `cargo check -p aphrody -p aphrody-command -p aphrody-config`
   - `cargo test -p aphrody-command --lib`
2. **Crates IA & MCP** :
   - `cargo check -p aphrody-mcp -p aphrody-rag-core`
   - `cargo clippy -p aphrody-mcp -- -D warnings`
3. **Moteur Web Obscura** :
   - `cargo check -p obscura -p obscura-cdp -p obscura-dom`
4. **Couche UI & Rendu** :
   - `cargo check -p aphrody-render -p aphrody-tauri-wrap`

### PHASE 4 : PACKAGES BUN & WORKSPACE TS
1. **Résolution & synchronisation des dépendances** :
   ```sh
   bun install --frozen-lockfile
   ```
2. **Exécution des gates monorepo** :
   ```sh
   bun run typecheck
   bun run lint
   bun run format:check
   bun run test
   ```
3. **Vérification du Discord Kit** :
   ```sh
   bun run packages/discord/kit/src/index.ts
   aphrody discord inspect
   ```

### PHASE 5 : APPLICATIONS & CANONICAL UI
1. **Canonical UI (`m3/packages/app-ui`)** :
   - Build et validation des composants M3.
   - S'assurer de l'absence de régression visuelle ou de casse d'import.
2. **Desktop CEF Runtime** :
   - Qualifier l'exécutable `aphrody-app` avec `tauri-runtime-cef` (CEF + `tauri-winit`).
   - S'assurer qu'aucune page distante n'obtient de privilège Bun ou hôte implicite.

### PHASE 6 : CONTENEURS DOCKER & SERVICES ASSOCIÉS
1. **Vérification de l'état Docker** :
   ```sh
   docker ps -a
   ```
2. **Stacks conteneurisées** :
   - Sur les hôtes déclarés (VPS / DBFR), s'assurer de l'état des conteneurs :
     - `aphrody-bot-1` (Gateway Discord, health check OK)
     - `aphrody-site-1` (Site web public et interface)
3. **Vaults** :
   - Vault de conteneurs chiffré (`aphrody-container-vault.service`).

### PHASE 7 : DÉPLOIEMENT INFRASTRUCTURE & SYSTEMD
1. **Catalogue des services d'hôte (`tools/config/host/systemd/`)** :
   - Vérifier la conformité syntaxique : `systemd-analyze verify <unit>`
   - Recharger et activer les services clés :
     - `aphrody-discord-ai-lab.service`
     - `aphrody-discord-control-plane.timer`
     - `aphrody-discord-lab-telemetry.timer`
     - `aphrody-drive-sync.timer`
     - `aphrody-mcp-http.service`
2. **Réseau WireGuard (`wg1`)** :
   - Vérifier la connectivité et les handshakes du maillage :
     - Hub VPS : `10.200.77.1`
     - DBFR : `10.200.77.3`
     - PC Aphro : `10.200.77.4`
     - WSL Omar : `10.200.77.10`
   - Commande de vérification : `sudo wg show wg1`

### PHASE 8 : AGENT HOME & BASE DE CONNAISSANCES UNIFIÉE
1. Mettre à jour l'indexation locale du code et des chunks :
   ```sh
   aphrody home index .
   aphrody graph build
   ```
2. Vérifier la santé du store SQLite (`~/.aphrody/db/aphrody.sqlite`).

---

## 3. CONTRAT DE RESTITUTION & REÇUS VERS DISCORD (SALON 1557354132543766569)

À l'issue de chaque cycle de configuration ou en cas d'étape majeure, émets systématiquement un rapport JSON structuré dans le salon Discord `#prompts` (`1557354132543766569`) sous le format suivant :

```json
{
  "channelId": "1557354132543766569",
  "phase": "SETUP_COMPLETE",
  "status": "HEALTHY",
  "timestamp": "<ISO8601>",
  "git_commit": "<rev>",
  "components": {
    "aphrody_ffi": "COMPILED",
    "aphrody_cli": "INSTALLED",
    "rust_crates": { "total": "<n>", "checked": "<n>", "failures": "<n>" },
    "bun_packages": { "status": "PASS", "typecheck": "PASS", "lint": "PASS" },
    "desktop_app": "READY",
    "docker": { "aphrody_bot": "RUNNING", "aphrody_site": "RUNNING" },
    "infra_services": { "systemd_active": "<n>", "timers_active": "<n>" },
    "wireguard_mesh": { "vps": "OK", "dbfr": "OK", "aphro_pc": "OK", "omar_wsl": "PENDING" }
  },
  "next_action": "CONTINUOUS_MONITORING"
}
```

---

## 4. INVARIANTS TECHNIQUES & RÈGLES DE SÉCURITÉ INVIOLABLES
- **Secret Zero Disclosure** : Aucun secret ou mot de passe dans les logs, les commits ou les messages Discord.
- **Sauvegarde Préalable** : Toute mutation de schéma ou base de données requiert une sauvegarde validée par somme de contrôle (SHA-256).
- **Stabilité Git** : Ne committer que du code qualifié par les tests et gates monorepo.
- **Résilience** : En cas d'échec sur un composant non bloquant, isoler le sous-système, documenter l'écart dans le rapport de statut et continuer le déploiement des composants indépendants.
