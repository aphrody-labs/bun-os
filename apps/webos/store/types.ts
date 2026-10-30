// SPDX-License-Identifier: Apache-2.0
// Wire types of /api/store/*: shared by the catalog generator (VPS), the HTTP handler and the Store window.
// Only real data: fields without a source stay undefined/null, the UI shows nothing for them.

/** Where an app comes from. One source = one repository the Store serves or links. */
export type SourceId =
  | "bunos" //     Bun OS web apps and games installed into the browser (PWA registry)
  | "pacman" //    Bun OS pacman repository (libalpm) built from factory PKGBUILDs
  | "arch" //      Arch/CachyOS/Omarchy/ChimeraOS catalogs of the factory (upstream mirrors, install via pacman)
  | "apk" //       Bun OS Alpine repository
  | "flatpak" //   Bun OS Flatpak (OSTree) repository
  | "npm" //       Bun OS npm registry (@aphrody/*)
  | "cargo" //     Bun OS cargo sparse registry
  | "android" //   Android APK catalog
  | "winget" //    winget REST source (Windows binaries)
  | "apt"; //      Bun OS apt repository (Debian)

export interface StoreSource {
  id: SourceId;
  label: string;
  /** Short description for the source picker. */
  desc: string;
  /** Repository URL clients are configured with (absent for sources without a served repository). */
  repo?: string;
  /** One-line client setup, shown on the source page. */
  setup?: string;
  count: number;
}

export interface StoreInstall {
  /** Browser install: id in /registry.json. */
  pwa?: string;
  /** Direct download. */
  download?: { url: string; size?: number; sha256?: string; name?: string };
  /** Package manager install command for the user's Bun OS target. */
  command?: string;
  /** Command that removes it. */
  removeCommand?: string;
  /** Bun OS agent API call ({manager, name}) for one-click install when an agent is connected. */
  agent?: { manager: "pacman" | "apk" | "flatpak" | "bun" | "cargo"; name: string };
}

export interface StoreApp {
  /** Stable id: `<source>:<name>`. */
  id: string;
  name: string;
  /** Package or app name in its source. */
  pkg: string;
  source: SourceId;
  category: string;
  summary: string;
  description?: string;
  version: string;
  size?: number;
  license?: string;
  homepage?: string;
  /** Repository member (inventory kind/id) that owns it, when it belongs to Bun OS. */
  member?: { kind: string; id: string; path?: string };
  icon?: string;
  screenshots?: string[];
  /** Capabilities it asks for: e.g. network, threads, wasm, native-root. */
  permissions?: string[];
  versions?: { version: string; size?: number; date?: string }[];
  install: StoreInstall;
  /** Result of the last qualification of this app's source (not a user rating). */
  qualified?: boolean;
  featured?: boolean;
  /** Why it cannot be installed from the Store right now (real reason, shown on its page). */
  unavailable?: string;
  /** Always null until real review data exists. */
  rating: null;
}

export interface StoreCatalog {
  schemaVersion: 1;
  generated: string;
  origin: string;
  sources: StoreSource[];
  categories: { id: string; label: string; count: number }[];
  apps: StoreApp[];
  featured: string[];
}

export interface FormatQualification {
  format: string;
  ok: boolean;
  at: string;
  image?: string;
  steps: { name: string; ok: boolean; ms: number; log: string }[];
}
export interface StoreQualification {
  schemaVersion: 1;
  generated: string;
  ok: boolean;
  results: FormatQualification[];
}
