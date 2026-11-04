// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const sourcesPath = join(root, "vendor", "sources.json");
const sourcesData = JSON.parse(readFileSync(sourcesPath, "utf-8"));
const sources: Record<string, any> = sourcesData.sources;

const refDir = join(root, "docs", "ref");
mkdirSync(refDir, { recursive: true });

// Define non-vital / redundant vendor categories
interface NonVitalItem {
  id: string;
  name: string;
  origin: string;
  upstream: string;
  category: "utility-tool" | "superseded" | "redundant-clone" | "external-upstream";
  description: string;
  setupInstructions: string;
  reason: string;
}

const nonVitalList: NonVitalItem[] = [
  {
    id: "3dviz-pro-max",
    name: "3Dviz Pro Max",
    origin: "https://github.com/aphrody-labs/3dviz-pro-max.git",
    upstream: "https://github.com/viettranx/3dviz-pro-max.git",
    category: "superseded",
    description: "3D scene composition and visualization framework.",
    setupInstructions: "Now integrated natively into `src/yolo-ui`. To run stand-alone: git clone https://github.com/viettranx/3dviz-pro-max && npm install",
    reason: "Superseded by pure Rust + Bun OS unified engine in `src/yolo-ui`.",
  },
  {
    id: "bun-ui",
    name: "Bun UI (Legacy M3)",
    origin: "https://github.com/aphrody-labs/bun-ui.git",
    upstream: "https://github.com/aphrody-labs/bun-ui.git",
    category: "superseded",
    description: "Historical Material 3 token and theme stack.",
    setupInstructions: "Legacy repository. Replaced by `src/yolo-ui`. Use `yolo-ui` CLI and `@aphrody/yolo-ui`.",
    reason: "Superseded by YOLO UI (dynamic, fully customizable, pure Rust + Bun OS).",
  },
  {
    id: "atuin",
    name: "Atuin Shell History",
    origin: "https://github.com/aphrody-labs/atuin.git",
    upstream: "https://github.com/atuinsh/atuin.git",
    category: "utility-tool",
    description: "Magical shell history sync and search using SQLite.",
    setupInstructions: "cargo install atuin || pacman -S atuin. Config lives in ~/.config/atuin/config.toml.",
    reason: "Unmodified upstream CLI tool; use system pacman/cargo rather than maintaining an in-tree fork.",
  },
  {
    id: "bottom",
    name: "Bottom (btm)",
    origin: "https://github.com/aphrody-labs/bottom.git",
    upstream: "https://github.com/ClementTsang/bottom.git",
    category: "utility-tool",
    description: "Cross-platform graphical process and system monitor.",
    setupInstructions: "cargo install bottom || pacman -S bottom.",
    reason: "Standard terminal utility; installed directly via package manager on fleet hosts.",
  },
  {
    id: "delta",
    name: "Git Delta",
    origin: "https://github.com/aphrody-labs/delta.git",
    upstream: "https://github.com/dandavison/delta.git",
    category: "utility-tool",
    description: "A syntax-highlighting pager for git, diff, and grep output.",
    setupInstructions: "cargo install git-delta || pacman -S git-delta. Configure in ~/.gitconfig: [pager] diff = delta.",
    reason: "Standard developer tool, identical to upstream; installed via pacman/cargo.",
  },
  {
    id: "altsnap",
    name: "AltSnap",
    origin: "https://github.com/aphrody-labs/AltSnap.git",
    upstream: "https://github.com/RamonUnch/AltSnap.git",
    category: "utility-tool",
    description: "Windows window management and Alt-drag snapping utility.",
    setupInstructions: "Download binary releases from https://github.com/RamonUnch/AltSnap/releases.",
    reason: "Desktop convenience binary; does not require in-tree compilation for core Bun OS.",
  },
  {
    id: "detours",
    name: "Microsoft Detours",
    origin: "https://github.com/aphrody-labs/Detours.git",
    upstream: "https://github.com/microsoft/Detours.git",
    category: "external-upstream",
    description: "Software package for monitoring and instrumenting API calls on Windows.",
    setupInstructions: "nmake -f Makefile under MSVC developer prompt.",
    reason: "Unmodified C++ library from Microsoft; consumed via standard vcpkg or NuGet if needed.",
  },
  {
    id: "bevy",
    name: "Bevy Engine",
    origin: "https://github.com/aphrody-labs/bevy.git",
    upstream: "https://github.com/bevyengine/bevy.git",
    category: "external-upstream",
    description: "Data-driven game engine built in Rust.",
    setupInstructions: "Use cargo dependencies `bevy = \"0.15\"` directly in Rust crates.",
    reason: "Multi-gigabyte heavy game engine; excluded from cargo workspace and consumed via crates.io.",
  },
  {
    id: "buzz",
    name: "Buzz STT",
    origin: "https://github.com/aphrody-labs/buzz.git",
    upstream: "https://github.com/chidiwilliams/buzz.git",
    category: "utility-tool",
    description: "Desktop speech-to-text transcriber using OpenAI Whisper.",
    setupInstructions: "aphrody-mcp provides native local STT/transcription. Standalone: pip install buzz-captions.",
    reason: "Transcription capabilities are natively integrated inside `aphrody-mcp`.",
  },
  {
    id: "chimeraos-family",
    name: "ChimeraOS Sub-repos Suite",
    origin: "https://github.com/aphrody-labs/chimeraos.git",
    upstream: "https://github.com/ChimeraOS/chimeraos.git",
    category: "redundant-clone",
    description: "ChimeraOS device quirks, gamescope session scripts, and flathub proxies.",
    setupInstructions: "Maintained upstream at https://github.com/ChimeraOS. Managed as Arch packages in PKGBUILDs.",
    reason: "6 fragmented submodule clones (chimera, device-quirks, flathub-proxy, gamescope-session, install-media) consolidated to package-level references.",
  },
  {
    id: "bash",
    name: "GNU Bash",
    origin: "https://github.com/aphrody-labs/bash.git",
    upstream: "https://git.savannah.gnu.org/git/bash.git",
    category: "external-upstream",
    description: "GNU Bourne Again SHell.",
    setupInstructions: "Packaged in Arch Linux rootfs (`pacman -S bash`).",
    reason: "System core package supplied directly by Arch Linux base repository.",
  },
  {
    id: "powershell",
    name: "PowerShell Core",
    origin: "https://github.com/aphrody-labs/PowerShell.git",
    upstream: "https://github.com/PowerShell/PowerShell.git",
    category: "external-upstream",
    description: "Cross-platform automation and configuration tool/framework.",
    setupInstructions: "Available on Windows natively (pwsh) or `winget install Microsoft.PowerShell`.",
    reason: "Standard Microsoft toolchain; integrated via `bunos-pwsh` plugin without in-tree source clone.",
  },
];

// Generate markdown documentation
let md = `# Référence des Dépôts Externes et Projets Découplés (docs/ref)

<!-- SPDX-License-Identifier: Apache-2.0 -->
*Dernière consolidation : Novembre 2026 • Bun OS Architecture*

Ce document recense les dépôts amont (upstream), bibliothèques et outils tiers qui ne sont **plus maintenus comme des clones ou forks lourds dans l'arborescence \`vendor/\`** de Bun OS.

Pour rendre le dépôt Bun OS aussi léger et véloce que possible, les composants non-vitaux, les doublons amont et les outils standard ont été découplés du monorepo et documentés ici avec leurs liens amont, leur rôle et leur guide d'installation.

---

## 1. Principes de Découplage

1. **Priorité au Code OS et Produits Finaux** : Le dépôt Bun OS conserve uniquement le code du système d'exploitation (\`crates/\`), les applications utilisateur (\`apps/\`), les packages réutilisables (\`packages/\`), et les projets amont activement patchés nécessaires à la compilation (COSMIC, Obscura, Waydroid, Niri, Rio, etc.).
2. **Élimination des Forks Inutiles** : Les outils identiques à upstream ou disponibles via \`pacman\`, \`cargo\`, ou le gestionnaire de paquets de l'OS hôte ne doivent pas encombrer \`vendor/\`.
3. **Consolidation UI/UX** : L'ancien écosystème statique M3 (\`vendor/bun-ui\`, \`3dviz-pro-max\`) a été absorbé et unifié dans le moteur dynamique \`src/yolo-ui\` (pur Rust + WebGPU).

---

## 2. Catalogue des Projets Découplés & Documentation de Setup

| Projet | Dépôt Amont (Upstream) | Catégorie | Rôle & Motif du Découplage | Instructions de Setup / Utilisation |
|---|---|---|---|---|
`;

for (const item of nonVitalList) {
  md += `| **\`${item.id}\`** (${item.name}) | [Upstream](${item.upstream}) | \`${item.category}\` | ${item.description}<br>*Motif : ${item.reason}* | \`${item.setupInstructions}\` |\n`;
}

md += `
---

## 3. Guide de Réactivation (si requis par un sous-système)

Si un environnement de qualification ou une cible spécifique nécessite de récupérer un de ces composants :

\`\`\`bash
# 1. Cloner la source amont officielle dans un répertoire temporaire ou build externe
git clone <URL_UPSTREAM> build/external/<nom>

# 2. Utiliser directement le binaire système de la flotte
pacman -S <paquet>   # Arch / CachyOS
cargo install <nom>  # Utilitaires Rust
\`\`\`

---

## 4. Composants Vitaux Maintenus en Source (\`vendor/\`)

Les projets suivants sont **vitaux** et font l'objet de patches Bun OS spécifiques (maintenus dans \`vendor/\` et \`Cargo.toml\`) :
- **COSMIC Desktop** : \`cosmic-epoch\`, \`libcosmic\`, \`iced\`, \`pop-launcher\`.
- **Compositeur & Fenêtrage** : \`niri\`, \`smithay\`, \`wayland\`.
- **Terminal & Shell** : \`rio\`, \`nushell\`.
- **Navigateur** : \`obscura\`.
- **Conteneurs Android 17** : \`waydroid\`.
- **Noyau & Drivers** : \`linux-cachyos\`, \`kernel-patches\`, \`wine-cachyos\`, \`uutils\`.
- **Émulateurs 60 FPS** : \`pcsx2\`, \`rpcs3\`, \`vita3k\`, \`flycast\`, \`xemu\`, \`shadps4\`, \`starpsx\`, \`zakuro\`, \`tetanes\`, \`rustboyadvance-ng\`.
`;

writeFileSync(join(refDir, "VENDOR-REFERENCES.md"), md, "utf-8");
console.log("Wrote docs/ref/VENDOR-REFERENCES.md successfully.");
