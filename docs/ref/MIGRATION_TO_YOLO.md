# Migration bun-os -> YOLO Ecosystem

Ce document consigne la consolidation et le délestage de `bun-os` vers la suite universelle `yolo`.

---

## 1. Composants Rapatriés et Unifiés dans YOLO (`C:\src\yolo-*`)
- **Ingénierie Inverse & Décompilation** :
  - `crates/re`, `packages/rea`, `replica/` -> [`yolo-re`](file:///C:/src/yolo-re) (`crates/yolo-re-core`, `packages/yolo-rea`, `replica/`).
- **Moteur d'Interface Utilisateur** :
  - `vendor/bun-ui`, `vendor/ui-ux-pro-max-skill` -> [`yolo-ui`](file:///C:/src/yolo-ui) (34 stacks, 7 thèmes, 10 moteurs, `skills/yolo-ui-pro-max`).
- **Moteur Web & Scraping Headless** :
  - -> [`yolo-web`](file:///C:/src/yolo-web) (Obscura CDP, Stylo CSS, Brave Search).
- **Marketplace Multi-Plateforme** :
  - -> [`yolo-plugins`](file:///C:/src/yolo-plugins) (Signatures Ed25519, serveurs de distribution).
- **Standards POSIX & Matériel** :
  - -> [`yolo-standards`](file:///C:/src/yolo-standards) (`crates/yolo-posix`, `packages/yolo-hardware-db`).

---

## 2. Dépendances Déclarées dans le Catalogue bun-os
`bun-os` consomme désormais `yolo` via `package.json` (`catalog:`) et `Cargo.toml` :
- `@yolo-rs/ui-plugin`
- `@yolo-rs/ui-mcp`
- `@yolo-rs/react`
- `@yolo-rs/rea`
- `@yolo-rs/hardware-db`
- `@yolo-rs/posix-bun`
- Crates Rust : `yolo-re-core`, `yolo-posix`, `yolo-shared`

---

## 3. Périmètre Résiduel Sanctuarisé dans bun-os
- **Applications Utilisateur Créatives** : `wordcraft`, `filmcraft`, `photocraft`, `soundcraft`, `gridcraft`, `vectorcraft`, `pdfcraft`, `lightcraft`, `figcraft`, `animcraft`, `spotcraft`.
- **Environnement de Bureau** : `webos`, `spacedrive`.
- **Identité & Bus Privé** : `aphrody-*`, `coordkit-bus`.
- **Infrastructure de Déploiement** : `infra/fleet`.
