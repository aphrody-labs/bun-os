# Bun OS — Sites, Frontends & Craft Suite Architecture Topology

This document is the exhaustive, authoritative inventory of all public websites, WebOS session endpoints, Craft Pro Suite studios, desktop applications, mobile runtimes, and engine packages across the Bun OS sovereign monorepo.

---

## 1. Architectural Covenant & Standards

1. **One Canonical Owner per Capability**:
   - Every first-party application is a direct child under `apps/` or `crates/`.
   - Every reusable engine/token package is under `packages/` or `crates/`.
2. **Pure WebGPU & WebAssembly (Strict Zero-WebGL Directive)**:
   - All interactive viewports, studio canvases, emulation frontends, and creative rendering pipelines strictly target **native WebGPU** (`wgpu 30` / WGSL compute pipelines) and **Rust WebAssembly** (`wasm32-unknown-unknown`).
   - Obsolete WebGL 1/2 fallbacks, slow CPU canvas rasterizers, and 2015-era canvas hacks are forbidden.
   - High-throughput rendering uses `OffscreenCanvas` in dedicated Web Workers, `SharedArrayBuffer` with Atomics, and local-first persistence via the Origin Private File System (OPFS).
3. **Sovereign Brand & Mascot**:
   - **Sole Mascot & Soul**: **Byron Love** (*Aphrodi* / 亜風炉 照美) — Divine grace, golden radiance (`#fce881`, `#f5c451`), *God Knows* and *Heaven's Time* perfection.
   - **Sovereign Color Spectrum**: **Gemini Light Blue** (`#8ab4f8` Primary, `#c2e7ff` Sky Luster, `#7cd8e8` Ambient Cyan, `#0f141c` Cosmic Surface).
   - **Tri-System Convergence**: Microsoft 365 Fluent UI 2 (dual-mode Ribbon, Backstage view, CommandBar) + Material 3 Expressive (Tonal Spot surfaces, Smart Canvas `@` chips) + Craft Pro Studio canvas.

---

## 2. Public Websites & Web Services (Complete Catalog)

| Site & Domain | Canonical Repository Source | Runtime / Stack | Host & Port | Isolation & Headers | Role & Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`aphrody.com`** | `crates/aphrody-webos-server` (`src/site.rs`, `site.css`, `site.js`, `landing.html`) + `crates/aphrody-webos-client` | Serveur Axum en Rust pur, client WebOS WASM (`wasm32-unknown-unknown`, WebGPU) | `vps` (`10.200.77.1`) `:8790` proxifié Nginx `:80/:443` | HTTP/2 + H3/QUIC, CSP strict, COOP/COEP, Clear-Site-Data, PWA | Portail principal et session WebOS en streaming |
| **`craft.aphrody.app`** | `scripts/aphrody/tools/infra/craft-site.ts` (`craft-landing.html`, `craft.css`, `craft.js`) + `apps/*craft-web` | Déploiement statique via `deploy-craft-frontends.ts`, 14 studios WASM + WebGPU natifs | `vps` (`10.200.77.1`) `/home/ubuntu/apps/craft-web/current` | `COOP: same-origin`, `COEP: require-corp` (isolation multithread OPFS/Workers) | Répertoire et lanceur des 14 studios créatifs et bureautiques |
| **`creator.aphrody.com`** | `packages/product/resources/creator/site` & `packages/product/resources/creator/web` | Site créateur Nginx + compresseur d'images WebGPU | `vps` (`10.200.77.1`) via Nginx | Cache statique, WebAssembly image optimizer | Outils créateur, compresseur d'images, assets |
| **`play.aphrody.app`** | `apps/iecode-web` (`./wasm/ds`, `./wasm/wii`) & `packages/bun-engine` | Émulation WASM Nintendo DS & Wii/GameCube, rendu WebGPU | `vps` (`10.200.77.1`) via Nginx | Cross-Origin Isolated (SharedArrayBuffer) | Plateforme de jeux et émulation rétro in-browser |
| **`dragonballfr.com`** | Origine CDN dédiée sur Shenron | Origine Bun CDN (`shenron-cdn-origin.service`), cache Redis edge | `prod` (`10.200.77.5`) `:9077` via Tunnel Cloudflare | HSTS 2 ans, Early Hints 103 | Portail média et univers Dragon Ball |
| **`downloads.aphrody.com`** | `packages/product/src/downloads` (`server.ts`) | Serveur HTTP Bun pour images OS, APKs, bundles desktop | `vps` (`10.200.77.1`) `:8797` via Nginx | Requêtes partielles par plage (Range), reçus SHA256 | Téléchargements publics des ISOs, APKs, binaires Bun OS |
| **`api.aphrody.com`** | `crates/aphrody-webos-server` & `infra/fleet/` | Passerelle API JSON Rust Axum (`/v1/health`, OpenAPI) | `vps` (`10.200.77.1`) `:8790` via Nginx | Limitation de débit (50r/s burst 100), schémas JSON stricts | API publique, découverte OpenAPI, passerelle A2A |
| **`os.aphrody.com`** | `crates/aphrody-webos-server` (route `/os`) | Redirection vers la vitrine Bun OS | `vps` (`10.200.77.1`) `:8790` | Redirection 301 vers `aphrody.com/os` | Vitrine produit du système d'exploitation |
| **`deploy.aphrody.app`** | Déploiement Komodo supervisor | Gestionnaire de conteneurs et déploiement VPS | `vps` (`10.200.77.1`) | Authentification session propriétaire | Superviseur de déploiement d'infrastructure |
| **`cdn.aphrody.com`** | `packages/cdn` & Cloudflare edge | Edge CDN mondial pour assets et polices M3 | Global Edge | Cache immuable 1 an, compression brotli/zstd | Distribution des assets statiques et typographies |
| **`assets.aphrody.app`** | Stockage d'assets Cloudflare R2 | Stockage objet d'assets médias et builds | Cloudflare R2 | Cache public | Bucket d'assets média |

---

## 3. Les 14 Studios Craft Pro (`craft.aphrody.app/<studio>/`)

Tous les studios résident directement sous `apps/` et compilent en **WebGPU pur + Rust WASM** avec persistance locale OPFS sans télémétrie :

### Document & Bureautique (Parité Google Workspace / Microsoft 365)
1. **WordCraft** (`apps/wordcraft` & `apps/wordcraft-web`) : Parité **Word & Google Docs** (moteur de mise en page print Rust, puces `@`, synchronisation CRDT sans cloud).
2. **GridCraft** (`apps/gridcraft` & `apps/gridcraft-web`) : Parité **Excel & Google Sheets** (grille WebGPU virtualisée 1M+ cellules à 120 FPS, 450+ formules réactives).
3. **DeckCraft** (`apps/deckcraft` & `apps/deckcraft-web`) : Parité **PowerPoint & Google Slides** (présentations cinématiques, transitions matérielles, masques).
4. **PDFCraft** (`apps/pdfcraft` & `apps/pdfcraft-web`) : Parité **Adobe Acrobat Pro** (analyseur PDF vectoriel natif, AcroForms, signature électronique locale).

### Visuel & Graphisme (Parité Adobe Creative Cloud & Figma)
5. **PhotoCraft** (`apps/photocraft` & `apps/photocraft-web`) : Parité **Photoshop & Lightroom RAW** (shaders compute WebGPU 32-bit float Display P3 à 120 FPS).
6. **VectorCraft** (`apps/vectorcraft` & `apps/vectorcraft-web`) : Parité **Illustrator & Figma** (canevas vectoriel infini, précision Bézier en WASM, booleans).
7. **DesignCraft** (`apps/designcraft` & `apps/designcraft-web`) : Parité **InDesign** (PAO, grilles multi-pages, repères de coupe, profil CMYK).
8. **FigCraft** (`apps/figcraft` & `apps/figcraft-web`) : Parité **Figma & Adobe XD** (réseaux vectoriels, contraintes auto-layout, composants hors-ligne).
9. **LightCraft** (`apps/lightcraft` & `apps/lightcraft-web`) : Parité **Capture One & Lightroom Library** (développement par lots de photothèques RAW).

### Motion, Audio, CAD & 3D (Parité Premiere, After Effects, Audition & AutoCAD)
10. **FilmCraft** (`apps/filmcraft` & `apps/filmcraft-web`) : Parité **Premiere Pro & DaVinci Resolve** (montage multipiste, décodage WebCodecs).
11. **EffectCraft** (`apps/effectcraft` & `apps/effectcraft-web`) : Parité **After Effects** (motion graphics procédural, moteur de particules WebGPU).
12. **SoundCraft** (`apps/soundcraft` & `apps/soundcraft-web`) : Parité **Audition & Logic Pro** (DAW audio, spectrogramme FFT en temps réel, DSP WebAudio).
13. **CADCraft** (`apps/cadcraft-web`) : Parité **AutoCAD & Fusion 360** (modélisation paramétrique 2D/3D, noyaux STEP/DXF).
14. **ArtCraft** (`apps/artcraft` & `apps/artcraft-web-app`) : Parité **Studio Créatif Génératif** (moteur 3D natif avec aperçu WebGPU temps réel).

---

## 4. Applications Systèmes & Desktop Natives (`apps/`)

- **`apps/desktop`** : Environnement de bureau natif COSMIC / Rust Wayland.
- **`apps/spacedrive`** : Explorateur spatial de fichiers VMM (Tauri + frontend Web, mode bureau et mobile).
- **`apps/spotcraft`** : Recherche instantanée native Spotlight / WGA (moteur SQLite FTS5 et actions `wga://`).
- **`apps/lu` (`@aphrody/lu`)** : Studio IA local tout-en-un (chat, génération d'images, vidéo, agent de code en Tauri + Vite).
- **`apps/bunos-flutter-store`** : Magasin d'applications officiel Bun OS en Flutter pour Linux, Android et Web via `flutter_rust_bridge`.
- **`apps/bun-android`** : Runtime d'exécution natif du conteneur Android 17 pour Bun OS.
- **`apps/bunos-wsl`** : Passerelle de pont conteneurisée WSL pour environnement Windows.
- **`apps/aphrody-model-view`** : Visionneuse 3D de modèles en Tauri + Rust.
- **`apps/m3-showcase`** : Vitrine adaptative des composants M3 Bun OS pour mobile, desktop et TV.
- **`apps/m3-next-example` & `apps/m3-next-tauri-example`** : Références d'intégration Next.js et Tauri sous Material 3.
- **`apps/aphrody-examples/crystal-universe`** : Dragon Pixel — mini-jeu d'Omar avec moteur WebGPU (`webgpu.js`), multijoueur Rust WebSocket et atelier d'avatars.

---

## 5. Moteurs & Paquets Web Souverains (`packages/`)

- **`packages/gemma-web`** : Moteur d'IA in-browser Gemma 4 E2B (ONNX Runtime Web, décodeur WebGPU, cache OPFS).
- **`packages/bun-gamestream`** : Client de streaming de jeu Bun OS (WebRTC, mise à l'échelle WebGPU FSR1, capture d'entrées).
- **`packages/android-web`** : Passerelle Web et gestionnaire d'appareils Android 17 (`adb`, `logcat`, `ndk`).
- **`packages/viz3d`** : Moteur spatial 3Dviz Pro Max (Three.js WebGPU, shaders nodaux TSL, scènes célestes PBR).
- **`packages/iecode-web`** : Émulateurs WebAssembly Nintendo DS (`./wasm/ds`) et Wii/GameCube (`./wasm/wii`).
- **`packages/m3-os-themes`** : Moteur de génération de thèmes M3 unifié pour 5 cibles de bureau (`cosmic`, `hyprland`, `iced`, `gtk`, `chromium`).
- **`packages/google`** : Outils CLI et bibliothèques Google Workspace (Docs, Sheets, Slides, Drive, Search).

---

## 6. Purge & Nettoyage des Dossiers Obsolètes / Faux Doublons

1. **`apps/azalee-web`** : Dossier complètement vide (0 fichier), vestige d'un ancien prototype -> **Supprimé**.
2. **`apps/rg-website`** : Configuration `.vercel` orpheline sans code source -> **Supprimé**.
3. **`apps/rg-bot`** : Fichier `.env` isolé sans implémentation -> **Supprimé**.
4. **Dossiers de tests temporaires (`target/test-craft`, `.tmp-migrate-debug`)** -> **Plein nettoyage effectué**.
