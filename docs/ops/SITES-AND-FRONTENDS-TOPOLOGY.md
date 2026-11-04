# Bun OS — Sites, Frontends & Craft Suite Architecture Topology

This document is the authoritative inventory of all public websites, WebOS session endpoints, Craft Pro Suite studios, and desktop frontends across the Bun OS sovereign repository.

---

## 1. Architectural Covenant & Standards

1. **One Canonical Owner per Capability**:
   - Every first-party application is a direct child under `apps/` or `crates/`.
   - Every reusable library/token set is under `packages/` or `crates/`.
2. **Pure WebGPU & WebAssembly (Strict Zero-WebGL Directive)**:
   - All interactive viewports, studio canvases, and creative rendering pipelines strictly target **native WebGPU** (`wgpu 30` / WGSL compute pipelines) and **Rust WebAssembly** (`wasm32-unknown-unknown`).
   - Obsolete WebGL 1/2 fallbacks, slow CPU canvas rasterizers, and 2015-era canvas hacks are forbidden.
   - High-throughput rendering uses `OffscreenCanvas` in dedicated Web Workers, `SharedArrayBuffer` with Atomics, and local-first persistence via the Origin Private File System (OPFS).
3. **Sovereign Brand & Mascot**:
   - **Sole Mascot & Soul**: **Byron Love** (*Aphrodi* / 亜風炉 照美) — Divine grace, golden radiance (`#fce881`, `#f5c451`), *God Knows* and *Heaven's Time* perfection.
   - **Sovereign Color Spectrum**: **Gemini Light Blue** (`#8ab4f8` Primary, `#c2e7ff` Sky Luster, `#7cd8e8` Ambient Cyan, `#0f141c` Cosmic Surface).
   - **Tri-System Convergence**: Microsoft 365 Fluent UI 2 (dual-mode Ribbon, Backstage view, CommandBar) + Material 3 Expressive (Tonal Spot surfaces, Smart Canvas `@` chips) + Craft Pro Studio canvas.

---

## 2. Public Websites & Web Services

| Domain | Canonical Repository Source | Runtime / Stack | Host & Port | Isolation & Headers |
| :--- | :--- | :--- | :--- | :--- |
| **`aphrody.com`** | `crates/aphrody-webos-server` (`site.rs`, `site.css`, `site.js`, `landing.html`) + `crates/aphrody-webos-client` | Pure Rust Axum server, WebOS WASM client (`wasm32-unknown-unknown`, WebGPU) | `vps` (`10.200.77.1`) `:8790` via Nginx `:80/:443` | H3/QUIC, HTTP/2, strict CSP, COOP/COEP, Clear-Site-Data, PWA |
| **`craft.aphrody.app`** | `scripts/aphrody/tools/infra/craft-site.ts` (`craft-landing.html`, `craft.css`, `craft.js`) + `apps/*craft-web` | Static release via `deploy-craft-frontends.ts`, pure Rust WASM + WebGPU studios | `vps` (`10.200.77.1`) `/home/ubuntu/apps/craft-web/current` via Nginx | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` (OPFS/Workers) |
| **`dragonballfr.com`** | Dedicated CDN origin on Shenron | Bun CDN origin (`shenron-cdn-origin.service`), Redis edge | `prod` (`10.200.77.5`) `:9077` via Cloudflare Tunnel | HSTS (63072000s), 103 Early Hints |
| **`downloads.aphrody.com`** | `packages/product/src/downloads` | Bun HTTP server serving OS images, APKs, desktop bundles | `vps` (`10.200.77.1`) via Nginx | Range requests, SHA256 receipts |
| **`api.aphrody.com`** | `crates/aphrody-webos-server` & `infra/fleet/` | Rust Axum JSON API gateway (`/v1/health`, OpenAPI catalog) | `vps` (`10.200.77.1`) `:8790` via Nginx | Rate limiting (50r/s burst 100), JSON schemas |

---

## 3. The 14 Sovereign Craft Studios (`craft.aphrody.app/<studio>/`)

All 14 studios are direct children under `apps/` with clean Rust WebAssembly + WebGPU targets, published under `craft.aphrody.app`:

### Document & Office (Google Workspace & Microsoft 365 Parity)
1. **WordCraft** (`/word/`):
   - Location: `apps/wordcraft` & `apps/wordcraft-web`
   - Parity: **Microsoft Word & Google Docs**
   - Architecture: Sovereign typography & prose editor. Pure Rust layout engine with real-time OPFS persistence, Smart Canvas `@` chips, and CRDT co-authoring without cloud telemetry.
2. **GridCraft** (`/grid/`):
   - Location: `apps/gridcraft` & `apps/gridcraft-web`
   - Parity: **Microsoft Excel & Google Sheets**
   - Architecture: High-throughput spreadsheet computing powered by Rust WebAssembly. WebGPU virtualized grid (1,000,000+ cells at 120 FPS), 450+ formulas, formula trees, and zero telemetry.
3. **DeckCraft** (`/deck/`):
   - Location: `apps/deckcraft` & `apps/deckcraft-web`
   - Parity: **Microsoft PowerPoint & Google Slides**
   - Architecture: Architect cinematic presentations with hardware-accelerated layouts, vector charts, slide masters, and instant deck export.
4. **PDFCraft** (`/pdf/`):
   - Location: `apps/pdfcraft` & `apps/pdfcraft-web`
   - Parity: **Adobe Acrobat Pro**
   - Architecture: Inspect, annotate, sign, and compile PDF documents locally with native Rust parsing. Confidential files never leave the browser.

### Visual & Graphic (Adobe Creative Cloud & Figma Parity)
5. **PhotoCraft** (`/photo/`):
   - Location: `apps/photocraft` & `apps/photocraft-web`
   - Parity: **Adobe Photoshop & Lightroom RAW**
   - Architecture: Non-destructive 32-bit float photo editing and RAW grading in Display P3 color space. WebGPU compute shaders deliver instant 120 FPS adjustments on gigapixel images.
6. **VectorCraft** (`/vector/`):
   - Location: `apps/vectorcraft` & `apps/vectorcraft-web`
   - Parity: **Adobe Illustrator & Figma**
   - Architecture: Infinite canvas vector precision. High-performance bezier math, path booleans, and scalable SVG/PDF export compiled from Rust to WASM.
7. **DesignCraft** (`/design/`):
   - Location: `apps/designcraft` & `apps/designcraft-web`
   - Parity: **Adobe InDesign**
   - Architecture: Publication layout studio fusing typography, multi-page grids, bleed guides, and CMYK workflows directly in the browser.
8. **FigCraft** (`/fig/`):
   - Location: `apps/figcraft` & `apps/figcraft-web`
   - Parity: **Figma & Adobe XD**
   - Architecture: Sovereign UI/UX interface design studio. Vector networks, auto-layout constraints, interactive components, and offline-first design systems.
9. **LightCraft** (`/light/`):
   - Location: `apps/lightcraft` & `apps/lightcraft-web`
   - Parity: **Capture One & Lightroom Library**
   - Architecture: Catalog, cull, and develop entire RAW libraries in the browser using multi-threaded WebAssembly workers and color science tone curves.

### Motion, Audio & 3D (Premiere, After Effects, Audition & AutoCAD Parity)
10. **FilmCraft** (`/film/`):
    - Location: `apps/filmcraft` & `apps/filmcraft-web`
    - Parity: **Adobe Premiere Pro & DaVinci Resolve**
    - Architecture: Multi-track non-linear video editing studio. WebGPU timeline playback, WebCodecs hardware decoding, frame-accurate trimming, and cross-origin isolated worker rendering.
11. **EffectCraft** (`/effect/`):
    - Location: `apps/effectcraft` & `apps/effectcraft-web`
    - Parity: **Adobe After Effects**
    - Architecture: Layer-based motion graphics and compositor. Procedural keyframe graphs, particle engines, and WebGPU compute shaders.
12. **SoundCraft** (`/sound/`):
    - Location: `apps/soundcraft` & `apps/soundcraft-web`
    - Parity: **Adobe Audition & Logic Pro**
    - Architecture: Multi-track audio workstation. Spectral waveform editing, parametric EQ, sovereign DSP plugins, and low-latency WebAudio buffers.
13. **CADCraft** (`/cad/`):
    - Location: `apps/cadcraft-web`
    - Parity: **AutoCAD & Autodesk Fusion 360**
    - Architecture: Parametric drafting and technical CAD modelling. Precise geometric dimensioning, constraints, and DXF/STEP geometry kernels.
14. **ArtCraft** (`/art/`):
    - Location: `apps/artcraft` & `apps/artcraft-web-app`
    - Parity: **Generative Creative Studio**
    - Architecture: Sovereign 3D generation and creative canvas studio. Native desktop engine with real-time WebGPU browser preview.

---

## 4. Native Applications & Desktop Shells

- **`apps/desktop`**: Native COSMIC / Rust Wayland desktop shell.
- **`apps/spacedrive`**: Spacedrive VMM spatial file explorer (Tauri + Web frontend).
- **`apps/spotcraft`**: Native Spotlight / WGA fast-action search app (SQLite FTS5 + WGA protocol handler).
- **`apps/bunos-wsl`**: WSL container desktop bridge.

---

## 5. Purged Legacy & Empty Folders

The following legacy, empty, or duplicate mock folders were permanently purged:
- `apps/azalee-web`: Empty abandoned prototype folder.
- `apps/rg-website`: Leftover Vercel configuration without source code.
- `apps/rg-bot`: Leftover environment file without source code.
- Temporary build/test output directories (`target/test-craft`, `.tmp-migrate-debug`).
