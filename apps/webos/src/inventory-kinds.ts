// SPDX-License-Identifier: Apache-2.0
// Kinds of the Bun OS inventory (apps/webos/inventory.ts). The generator, the Worker and the Atlas window
// share this one table, so a kind cannot exist without a label and a place in the desktop.
export const KINDS = {
  apps: { label: "Apps", desc: "Every apps/ member: browser apps run in a window, the others get downloads, status and source." },
  packages: { label: "Packages", desc: "Every packages/ member with README, version and npm link." },
  crates: { label: "Crates", desc: "Every crates/ member with README, version, crates.io link and WebAssembly capability." },
  factory: { label: "Factory", desc: "Images, compositions (Server, COSMIC, Gaming), pacman catalogs and build catalogs." },
  ospackages: { label: "OS packages", desc: "Pacman packages and recipes of the Omarchy, CachyOS and ChimeraOS catalogs." },
  engines: { label: "Engines", desc: "Bun Engine cores, consoles and emulators." },
  games: { label: "Games", desc: "Installable games of the WebOS registry." },
  tools: { label: "Tools", desc: "Scripts, command-line tools and installers." },
  infra: { label: "Infrastructure", desc: "Hosts, routes, services and release configuration." },
  releases: { label: "Releases", desc: "Published release manifests and the live downloads catalogue." },
  sources: { label: "Sources", desc: "Pinned upstream source owners (Git submodules)." },
  workspace: { label: "Workspace", desc: "Every top-level entry of the repository." },
  collections: { label: "Collections", desc: "Cross-cutting groups: Android owners, Material 3, engines, compositions." },
} as const;
export type Kind = keyof typeof KINDS;
export const KIND_IDS = Object.keys(KINDS) as Kind[];
export type SurfaceType = "app" | "wasm" | "viewer" | "download" | "api";
/** Real backing of a surface. There is no placeholder backing: a member without one fails the gate. */
export type Backing = "desktop-app" | "wasm-module" | "api" | "download" | "repository";
export const BACKINGS: readonly Backing[] = ["desktop-app", "wasm-module", "api", "download", "repository"];
export const SURFACE_LABEL: Record<SurfaceType, string> = {
  app: "Opens in the desktop",
  wasm: "WebAssembly module",
  viewer: "Repository page",
  download: "Downloads",
  api: "API",
};
