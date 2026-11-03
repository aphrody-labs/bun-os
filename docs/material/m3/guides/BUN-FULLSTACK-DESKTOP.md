<!-- SPDX-License-Identifier: Apache-2.0 -->

# Guide Pratique : Développement Fullstack & Desktop avec Bun

> **Guide Pratique Développeur**  
> Catégorie : `guides/ui`  
> Flux de travail pas à pas pour le développement, bundling, test et audit.

---

## 1. Démarrer le Serveur Desktop Persistant

Pour lancer le serveur webview unifié (Tauri 3 / M3) servant `crates/ui/app/ui-dist` sur `http://127.0.0.1:1421` :

```bash
# Démarrage standard
bun run desktop:ui:serve

# Avec port et hôte personnalisés
bun scripts/dev/ui/serve-desktop-ui.ts --port 1421 --host 127.0.0.1
```

### Vérification Rapide

```bash
# Vérifier la santé du serveur
curl -s http://127.0.0.1:1421/health | jq .

# Vérifier la réflexion en direct des sous-systèmes backend
curl -s http://127.0.0.1:1421/api/capabilities | jq .

# Tester les catalogues bilingues
curl -s http://127.0.0.1:1421/api/i18n/fr | jq .common

# Consulter les statistiques du cache SQLite in-process
curl -s http://127.0.0.1:1421/api/cache/stats | jq .
```

---

## 2. Compiler un Package UI avec le Preset Natif Bun

Pour compiler un package sous `packages/*` sans dépendance vers `tsup` :

```bash
# Depuis la racine du monorepo
bun packages/m3-config/bun-build.ts --entry src/index.ts --outdir dist

# Avec minification production
bun packages/m3-config/bun-build.ts --entry src/index.ts --outdir dist --minify
```

### Exemple dans un Script de Package

```ts
import { m3BunBuild } from "@aphrody/m3-config/bun-build";

await m3BunBuild({
  entry: ["src/index.ts", "src/react.tsx"],
  outDir: "dist",
  target: "browser",
  useClient: true,
});
```

---

## 3. Utiliser le Cache In-Process SQLite (`M3UiCache`)

Pour stocker et récupérer des données complexes à latence sous-milliseconde :

```ts
import { getSharedUiCache } from "@aphrody/m3-config/cache-db";
import { schemeFromSeed } from "@aphrody/m3-tokens/dynamic-color";

const cache = getSharedUiCache();

// Mettre en cache le schéma calculé par le moteur canonique (aphrody-m3-tokens)
cache.set("theme", "seed:#6750a4", schemeFromSeed("#6750a4"));

// Récupérer la valeur typée
const palette = cache.get<Record<string, string>>("theme", "seed:#6750a4");

// Consulter les métriques
console.log(cache.stats());
```

---

## 4. Gestion Bilingue et Parité Strict (EN / FR)

Le système interdit tout texte hardcodé. Toute nouvelle entrée doit être déclarée dans le générateur :

```bash
# 1. Générer automatiquement les catalogues symétriques (en.json et fr.json)
bun run i18n:generate

# 2. Auditer la stricte parité des clés (100% de concordance, 0 valeur vide)
bun run i18n:audit
```

### Utilisation dans l'UI TypeScript / React

```ts
import { t, setLocale, getLocale } from "@aphrody/m3/i18n";

// Traduction type-safe
console.log(t("common.save")); // "Save" ou "Enregistrer"

// Bascule de langue
setLocale("fr");
console.log(t("nav.chat")); // "Chat & Agents"
```

---

## 5. Exécution des Tests Unitaires avec `bun:test`

Les tests s'exécutent avec `bun test` :

```bash
# Tester le preset bun-build et le cache SQLite
bun test packages/m3-config/test/

# Tester le framework Material 3 principal
APHRODY_FFI_DEV=1 bun test --cwd packages/m3

# Tester les composants React adaptatifs
bun test --cwd packages/m3-react

# Tester le serveur desktop et ses fonctionnalités Bun
bun test scripts/dev/ui/serve-desktop-ui.test.ts
```

---

## 6. Gates de Validation du Monorepo

Avant toute intégration ou commit par l'agent intégrateur :

```bash
# 1. Manifestes Bun
bun run bun:check

# 2. Layout du monorepo
bun run monorepo:layout

# 3. Projets Tauri v3
bun run tauri:apps:check

# 4. Qualification bundles navigateur (aucun symbole natif/Node dans le browser)
bun run ui:browser-audit

# 5. Parité bilingue
bun run i18n:audit
```
