# Référence des Dépôts Externes et Projets Découplés (docs/ref)

<!-- SPDX-License-Identifier: Apache-2.0 -->
*Dernière consolidation : Novembre 2026 • Bun OS Architecture*

Ce document recense les dépôts amont (upstream), bibliothèques et outils tiers qui ne sont **plus maintenus comme des clones ou forks lourds dans l'arborescence `vendor/`** de Bun OS.

Pour rendre le dépôt Bun OS aussi léger et véloce que possible, les composants non-vitaux, les doublons amont et les outils standard ont été découplés du monorepo et documentés ici avec leurs liens amont, leur rôle et leur guide d'installation.

---

## 1. Principes de Découplage

1. **Priorité au Code OS et Produits Finaux** : Le dépôt Bun OS conserve uniquement le code du système d'exploitation (`crates/`), les applications utilisateur (`apps/`), les packages réutilisables (`packages/`), et les projets amont activement patchés nécessaires à la compilation (COSMIC, Obscura, Waydroid, Niri, Rio, etc.).
2. **Élimination des Forks Inutiles** : Les outils identiques à upstream ou disponibles via `pacman`, `cargo`, ou le gestionnaire de paquets de l'OS hôte ne doivent pas encombrer `vendor/`.
3. **Consolidation UI/UX** : L'ancien écosystème statique M3 (`vendor/bun-ui`, `3dviz-pro-max`) a été absorbé et unifié dans le moteur dynamique `src/yolo-ui` (pur Rust + WebGPU).

---

## 2. Catalogue des Projets Découplés & Documentation de Setup

| Projet | Dépôt Amont (Upstream) | Catégorie | Rôle & Motif du Découplage | Instructions de Setup / Utilisation |
|---|---|---|---|---|
| **`3dviz-pro-max`** (3Dviz Pro Max) | [Upstream](https://github.com/viettranx/3dviz-pro-max.git) | `superseded` | 3D scene composition and visualization framework.<br>*Motif : Superseded by pure Rust + Bun OS unified engine in `src/yolo-ui`.* | `Now integrated natively into `src/yolo-ui`. To run stand-alone: git clone https://github.com/viettranx/3dviz-pro-max && npm install` |
| **`bun-ui`** (Bun UI (Legacy M3)) | [Upstream](https://github.com/aphrody-labs/bun-ui.git) | `superseded` | Historical Material 3 token and theme stack.<br>*Motif : Superseded by YOLO UI (dynamic, fully customizable, pure Rust + Bun OS).* | `Legacy repository. Replaced by `src/yolo-ui`. Use `yolo-ui` CLI and `@aphrody/yolo-ui`.` |
| **`atuin`** (Atuin Shell History) | [Upstream](https://github.com/atuinsh/atuin.git) | `utility-tool` | Magical shell history sync and search using SQLite.<br>*Motif : Unmodified upstream CLI tool; use system pacman/cargo rather than maintaining an in-tree fork.* | `cargo install atuin || pacman -S atuin. Config lives in ~/.config/atuin/config.toml.` |
| **`bottom`** (Bottom (btm)) | [Upstream](https://github.com/ClementTsang/bottom.git) | `utility-tool` | Cross-platform graphical process and system monitor.<br>*Motif : Standard terminal utility; installed directly via package manager on fleet hosts.* | `cargo install bottom || pacman -S bottom.` |
| **`delta`** (Git Delta) | [Upstream](https://github.com/dandavison/delta.git) | `utility-tool` | A syntax-highlighting pager for git, diff, and grep output.<br>*Motif : Standard developer tool, identical to upstream; installed via pacman/cargo.* | `cargo install git-delta || pacman -S git-delta. Configure in ~/.gitconfig: [pager] diff = delta.` |
| **`altsnap`** (AltSnap) | [Upstream](https://github.com/RamonUnch/AltSnap.git) | `utility-tool` | Windows window management and Alt-drag snapping utility.<br>*Motif : Desktop convenience binary; does not require in-tree compilation for core Bun OS.* | `Download binary releases from https://github.com/RamonUnch/AltSnap/releases.` |
| **`detours`** (Microsoft Detours) | [Upstream](https://github.com/microsoft/Detours.git) | `external-upstream` | Software package for monitoring and instrumenting API calls on Windows.<br>*Motif : Unmodified C++ library from Microsoft; consumed via standard vcpkg or NuGet if needed.* | `nmake -f Makefile under MSVC developer prompt.` |
| **`bevy`** (Bevy Engine) | [Upstream](https://github.com/bevyengine/bevy.git) | `external-upstream` | Data-driven game engine built in Rust.<br>*Motif : Multi-gigabyte heavy game engine; excluded from cargo workspace and consumed via crates.io.* | `Use cargo dependencies `bevy = "0.15"` directly in Rust crates.` |
| **`buzz`** (Buzz STT) | [Upstream](https://github.com/chidiwilliams/buzz.git) | `utility-tool` | Desktop speech-to-text transcriber using OpenAI Whisper.<br>*Motif : Transcription capabilities are natively integrated inside `aphrody-mcp`.* | `aphrody-mcp provides native local STT/transcription. Standalone: pip install buzz-captions.` |
| **`chimeraos-family`** (ChimeraOS Sub-repos Suite) | [Upstream](https://github.com/ChimeraOS/chimeraos.git) | `redundant-clone` | ChimeraOS device quirks, gamescope session scripts, and flathub proxies.<br>*Motif : 6 fragmented submodule clones (chimera, device-quirks, flathub-proxy, gamescope-session, install-media) consolidated to package-level references.* | `Maintained upstream at https://github.com/ChimeraOS. Managed as Arch packages in PKGBUILDs.` |
| **`bash`** (GNU Bash) | [Upstream](https://git.savannah.gnu.org/git/bash.git) | `external-upstream` | GNU Bourne Again SHell.<br>*Motif : System core package supplied directly by Arch Linux base repository.* | `Packaged in Arch Linux rootfs (`pacman -S bash`).` |
| **`powershell`** (PowerShell Core) | [Upstream](https://github.com/PowerShell/PowerShell.git) | `external-upstream` | Cross-platform automation and configuration tool/framework.<br>*Motif : Standard Microsoft toolchain; integrated via `bunos-pwsh` plugin without in-tree source clone.* | `Available on Windows natively (pwsh) or `winget install Microsoft.PowerShell`.` |

---

## 3. Guide de Réactivation (si requis par un sous-système)

Si un environnement de qualification ou une cible spécifique nécessite de récupérer un de ces composants :

```bash
# 1. Cloner la source amont officielle dans un répertoire temporaire ou build externe
git clone <URL_UPSTREAM> build/external/<nom>

# 2. Utiliser directement le binaire système de la flotte
pacman -S <paquet>   # Arch / CachyOS
cargo install <nom>  # Utilitaires Rust
```

---

## 4. Composants Vitaux Maintenus en Source (`vendor/`)

Les projets suivants sont **vitaux** et font l'objet de patches Bun OS spécifiques (maintenus dans `vendor/` et `Cargo.toml`) :
- **COSMIC Desktop** : `cosmic-epoch`, `libcosmic`, `iced`, `pop-launcher`.
- **Compositeur & Fenêtrage** : `niri`, `smithay`, `wayland`.
- **Terminal & Shell** : `rio`, `nushell`.
- **Navigateur** : `obscura`.
- **Conteneurs Android 17** : `waydroid`.
- **Noyau & Drivers** : `linux-cachyos`, `kernel-patches`, `wine-cachyos`, `uutils`.
- **Émulateurs 60 FPS** : `pcsx2`, `rpcs3`, `vita3k`, `flycast`, `xemu`, `shadps4`, `starpsx`, `zakuro`, `tetanes`, `rustboyadvance-ng`.
