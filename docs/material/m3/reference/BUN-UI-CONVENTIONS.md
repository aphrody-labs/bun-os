<!-- SPDX-License-Identifier: Apache-2.0 -->

# Spécification de Référence des Conventions Bun UI

> **Document de Référence Canonique**  
> Catégorie : `reference/ui`  
> Contrats d'API, protocoles, schémas SQLite et variables d'environnement.

---

## 1. Preset de Build Natif Bun (`@aphrody/m3-config/bun-build`)

### 1.1 Interface TypeScript

```ts
import type { BunPlugin, BuildArtifact } from "bun";

export interface M3BunBuildOptions {
  /** Points d'entrée (fichiers sources). Défaut : ["src/index.ts"] */
  entry?: string | string[];
  /** Répertoire de destination. Défaut : "dist" */
  outDir?: string;
  /** Cible d'exécution : "browser" (défaut), "bun", ou "node" */
  target?: "browser" | "bun" | "node";
  /** Format de module : "esm" (défaut) ou "cjs" */
  format?: "esm" | "cjs";
  /** Activation du code-splitting. Défaut : true */
  splitting?: boolean;
  /** Mode des sourcemaps : "external" (défaut), "inline", "none" */
  sourcemap?: "external" | "inline" | "none";
  /** Contrôle de la minification. Défaut : false */
  minify?: boolean | { whitespace?: boolean; syntax?: boolean; identifiers?: boolean };
  /** Packages externes additionnels */
  external?: string[];
  /**
   * Injection de la directive 'use client'; :
   * true (défaut sur tous les .js émis), liste de fichiers ciblés, ou false.
   */
  useClient?: boolean | readonly string[];
  /** Plugins Bun additionnels */
  plugins?: BunPlugin[];
  /** Constantes de compilation `define` */
  define?: Record<string, string>;
  /** Répertoire de travail. Défaut : process.cwd() */
  cwd?: string;
}

export interface M3BunBuildResult {
  success: boolean;
  outDir: string;
  outputs: BuildArtifact[];
  logs: string[];
}

export function m3BunBuild(options?: M3BunBuildOptions): Promise<M3BunBuildResult>;
export function prependUseClient(dir: string, only?: readonly string[]): Promise<number>;
```

### 1.2 Packages Externes par Défaut (`M3_EXTERNAL`)

```ts
export const M3_EXTERNAL: string[] = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "lit",
  "lit/*",
  "@lit/*",
  "motion",
  "motion/*",
  "tailwindcss",
  "@aphrody/*",
];
```

---

## 2. Cache In-Process SQLite (`@aphrody/m3-config/cache-db`)

### 2.1 Schéma de la Base de Données

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS ui_cache (
  key TEXT NOT NULL,
  namespace TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_ui_cache_ns ON ui_cache (namespace);
```

### 2.2 Méthodes de la Classe `M3UiCache`

| Méthode | Signature | Description |
| :--- | :--- | :--- |
| `get<T>` | `(namespace: string, key: string): T \| null` | Récupère et désérialise un objet JSON mis en cache |
| `set<T>` | `(namespace: string, key: string, value: T): void` | Stocke ou remplace une entrée avec mise à jour du timestamp |
| `delete` | `(namespace: string, key: string): boolean` | Supprime une entrée ciblée |
| `clear` | `(namespace?: string): number` | Purge un namespace donné ou la base entière |
| `stats` | `(): CacheStats` | Retourne le total d'entrées et les volumes par namespace |
| `close` | `(): void` | Ferme proprement la connexion SQLite |

---

## 3. Endpoints REST du Serveur Desktop UI

Serveur exécuté sur `http://127.0.0.1:1421` (ou configuré via `PORT`/`HOST`) :

### 3.1 `/health` & `/api/health`
- **Méthode** : `GET`, `HEAD`
- **Statut** : `200 OK`
- **Payload** :
```json
{
  "status": "ok",
  "app": "aphrody-app",
  "desktop": "tauri-v3",
  "ui": "unified-m3-desktop",
  "mode": "standalone-web",
  "port": 1421,
  "host": "127.0.0.1",
  "views": ["main", "splash", "pet", "widget", "quickbar"],
  "areas": ["chat", "files", "models", "settings"],
  "dist": ".../crates/ui/app/ui-dist",
  "uptime": 128.45,
  "bun": {
    "version": "1.4.2",
    "revision": "...",
    "features": ["zero-copy-file", "wyhash-etags", "gzip", "websocket", "sqlite-cache"]
  }
}
```

### 3.2 `/api/tauri/invoke`
- **Méthode** : `POST`
- **Description** : Dispatcher universel de commandes natives Tauri pour exécution transparente en mode web standalone (`aphrody_meta`, `aphrody_hardware_telemetry`, `aphrody_model_*`, `aphrody_fs_*`, `koharu_rpc`, `aphrody_rpc`).
- **Corps de requête** : `{ "cmd": "nom_commande", "args": { ... } }`

### 3.3 `/api/apps`
- **Méthode** : `GET`
- **Description** : Retourne l'inventaire structuré de tout l'écosystème unifié (`aphrody-app`, `koharu-editor`, `cli`, `m3-framework`).

### 3.4 `/api/capabilities`
- **Méthode** : `GET`
- **Description** : Reflète l'état réel et dynamique des 7 sous-systèmes du backend natif Aphrody (`ffi`, `appServer`, `kernel`, `drive`, `koharu`, `shell`, `cli`).

### 3.5 `/api/i18n` et `/api/i18n/:lang`
- **Méthode** : `GET`
- **Paramètres** : `:lang` = `en` ou `fr`
- **Description** : Retourne les catalogues de traduction 100% symétriques générés depuis les modèles backend.

### 3.6 `/api/tokens`
- **Méthode** : `GET`
- **Description** : Expose la métrique et les dimensions du design system M3 (36 rôles de couleur, 13 palettes tonales, 6 niveaux d'élévation, 7 rayons de courbure, 10 pas temporels de motion).

### 3.7 `/api/cache/stats`
- **Méthode** : `GET`
- **Description** : Retourne les statistiques d'utilisation du cache SQLite local (`totalEntries`, `namespaces`, `databasePath`).

---

## 4. Protocole WebSocket (`/ws`)

- **URL** : `ws://127.0.0.1:1421/ws`
- **Handshake** : Mise à niveau via `server.upgrade(req)` dans `Bun.serve`.
- **Canal de diffusion** : Topic `desktop-ui-broadcast`.
- **Message initial de connexion** :
```json
{
  "type": "ready",
  "uptime": 12.34
}
```
- **Diffusion d'événements** :
  Tout message envoyé par un client est re-diffusé (`ws.publish`) aux autres fenêtres (ex. changement de thème, ouverture de vue, synchronisation de focus).

---

## 5. Variables d'Environnement

| Variable | Défaut | Rôle |
| :--- | :--- | :--- |
| `PORT` | `1421` | Port d'écoute du serveur webview desktop (aligné sur `devUrl` Tauri 3) |
| `HOST` | `127.0.0.1` | Interface réseau locale d'écoute |
| `APHRODY_FFI_DEV` | `0` | Active le fallback sur la bibliothèque compilée locale `target/debug` ou `target/release` |
| `APHRODY_UI_CACHE_PATH` | `~/.aphrody/cache/ui.sqlite` | Chemin de persistance de la base SQLite UI |
| `APHRODY_CARGO_JOBS` | `6` | Nombre maximum de jobs concurrents pour le wrapper sérialisé Cargo |
