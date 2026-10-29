# @aphrody/menu-render

Renderer React pixel-perfect pour les écrans de menu IEVR, depuis un `menu-layout.json`.

## Usage rapide

```tsx
import { GameMenu } from "@aphrody/menu-render";
import layout from "./50_title.layout.json";

<GameMenu layout={layout} assetBase="https://cdn.example.com" />;
```

## Lua runtime ownership

Import `LuaRuntimeAdapter` from `@aphrody/menu-render/lua-host` and supply
the real interpreter and game host to `useLuaScreen` from
`@aphrody/menu-render/use-lua-screen`. Its options require `runtime` and
`layerIds`. No default game runtime is provided; missing adapters fail explicitly.
The adapter executes source and resolves menu names, includes and hashes using
the owning game implementation. The renderer does not synthesize those APIs.

## Stratégie pixel-perfect

### Canvas de référence : 1280×720

Toutes les coordonnées du contrat `menu-layout.json` sont en pixels sur un canvas 1280×720
(résolution native IEVR, source G4PKM). Le composant :

1. Crée un conteneur `aspect-ratio: 1280/720` qui remplit son parent.
2. Inscrit un div interne exactement 1280×720 px, centré et scalé via `transform: scale(k)` où
   `k = min(containerW/1280, containerH/720)` (letterbox), calculé par `ResizeObserver`.
3. Place chaque objet en **absolu** avec `left = x − anchorX×w` / `top = y − anchorY×h`.

### Transforms absolus depuis G4PKM

Chaque `MenuObject.transform` vient directement du squelette G4PKM (bones 2D de pose repos +
frame final de la motion `open`). Aucune approximation : les valeurs x/y/scaleX/scaleY/rot/anchor
sont copiées telles quelles depuis les données iecode.

### PNG lossless

Les sprites sont des PNG lossless exportés par `MenuPngService` depuis les G4TX originaux —
pixels byte-identiques aux textures du jeu. Pas de compression lossy. `image-rendering: pixelated`
empêche l'anti-aliasing navigateur sur les zooms < 100%.

### Police du jeu (nie_main / nie_bold)

- Les fonts IEVR (nie_main, nie_bold, nie_mono) doivent être extraites des CPK et converties en
  `.woff2`/`.ttf`, puis placées sous `assetBase/fonts/nie_main.woff2`.
- Un `@font-face` est injecté dynamiquement au mount depuis `assetBase`.
- Fallback : `"Noto Sans JP", sans-serif` (couvre kanji, rendu correct pour validation de layout).

### Diff pixel de validation

1. Capturer l'écran réel : le harnais headless IEVR (lavapipe) rend le menu via `iecode run` →
   screenshot 1280×720 (PNG).
2. Capturer azalee : Playwright `page.screenshot()` sur `/menu/50_title` à 1280×720.
3. Diff : `pixelmatch` ou `ssim` — cible < 0.5% de pixels différents (tolérance ±2 niveaux par canal).
4. Itérer sur les écarts : transforms mal lus → corriger le parser G4PKM ; police incorrecte →
   extraire la vraie font ; z-order → vérifier drawPriority.

---

## Intégration azalee (Next.js, monorepo rg)

Les fichiers sont dans `re/azalee-integration/` (à copier manuellement, sans modifier azalee
directement tant que le renderer est en cours de stabilisation).

### 1. Ajouter la dépendance

Dans `apps/azalee/package.json` (catalog rg ou chemin direct) :

```json
"dependencies": {
  "@aphrody/menu-render": "workspace:*"
}
```

Ou copier les sources `packages/menu-render/src/` dans `apps/azalee/components/menu/renderer/`.

### 2. Composant client

Copier `re/azalee-integration/components/menu/GameMenuClient.tsx`
→ `apps/azalee/components/menu/GameMenuClient.tsx`

```tsx
"use client";
import { GameMenu, type MenuLayout } from "@aphrody/menu-render";

export function GameMenuClient({
  layout,
  assetBase = "https://cdn.example.com",
}) {
  return <GameMenu layout={layout} assetBase={assetBase} />;
}
```

### 3. Route de démo

Copier `re/azalee-integration/app/menu/[screen]/page.tsx`
→ `apps/azalee/app/menu/[screen]/page.tsx`

URL : `https://inagle.example.com/menu/50_title`

Le layout est chargé depuis :

- `public/menu-layouts/<screen>.json` (statique, pre-généré par `iecode menu export`)
- `IECODE_DATA_URL/menu/<screen>` (API iecode-data, dev)

### 4. Layouts statiques (pre-génération)

```bash
# Générer le layout pour un écran (quand iecode menu export sera implémenté)
bun run iecode menu export 50_title --locale fr --out apps/azalee/public/menu-layouts/
```

### 5. Variables d'environnement

```env
NEXT_PUBLIC_CDN_BASE=https://cdn.example.com   # Base URL des PNG sprites
IECODE_DATA_URL=http://localhost:4242               # API iecode-data (dev seulement)
```

---

## Types

```ts
interface MenuLayout {
  screen: string; // "50_title"
  locale: string; // "fr"
  canvas: { w: number; h: number }; // 1280×720
  objects: MenuObject[];
}

interface MenuObject {
  name: string;
  parent: string | null;
  transform: { x; y; scaleX; scaleY; rot; anchorX; anchorY };
  drawPriority: number; // z-index
  drawType: number; // 0=normal 1=additive 2=multiply
  camera: string;
  sprite: { pngUrl; w; h; logicalPath } | null;
  text: { value; font; size; color; align } | null;
  anim: { open; close } | null;
  primitive: { type; w; h; color; alpha } | null;
  charModel: null; // phase 3D (à venir)
}
```
