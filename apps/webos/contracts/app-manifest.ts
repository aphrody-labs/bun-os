// SPDX-License-Identifier: Apache-2.0
// The one app model of WebOS (docs/webos/ARCHITECTURE.md, section "App model"). Every desktop app is a package with
// a manifest of this shape; the shell, the launcher, the dock, the Store, the inventory gate and the server read
// nothing else. Client and server import this file, so the contract has a single definition.

/** What actually runs the app. There is no placeholder backing; the inventory gate fails a manifest without one. */
export const BACKINGS = [
  "wasm", // native code compiled to WebAssembly, run in the page or a worker (Rust crates, Spacedrive core, Rio core...)
  "wayland", // real Wayland client in the headless Hyprland session on the host, surfaced per window as its own WebOS window (Rio, Spacedrive, COSMIC apps, Craft)
  "stream", // other host-side native program (non-Wayland) whose display/audio/input is streamed into the window
  "webview", // real web content hosted in a WebOS window: own chrome, sandboxed, history/navigation (never a browser tab)
  "app-ui", // React App UI island (packages/app-ui) in a sandboxed iframe
  "api", // UI over a typed HTTP/RPC API of this deployment (chat, search, Store, Atlas)
  "browser", // web-platform feature only (Settings, Calculator chrome, Disk Usage)
] as const;
export type Backing = (typeof BACKINGS)[number];

export const PERMISSIONS = [
  "fs", // OPFS home directory
  "network", // fetch through the edge proxy
  "clipboard",
  "audio",
  "gpu", // WebGPU / WebGL
  "camera",
  "microphone",
  "notifications",
  "storage", // IndexedDB / persistent storage
  "stream", // open a display stream session on the host
  "inference", // call the Bun OS model endpoint
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Icon convention: a real upstream icon, license-compliant, stored in the app package as SVG (preferred) or PNG >= 128px. */
export interface AppIcon {
  /** Path relative to the app package, e.g. "assets/icon.svg"; staged to /apps/<id>/<path>. */
  src: string;
  /** Upstream the icon comes from (project name or URL) and its SPDX license id; mandatory, there are no generic glyphs. */
  origin: string;
  license: string;
  /** Optional monochrome glyph (Material Symbols name) used only for tiny UI like the status bar. */
  glyph?: string;
}

export interface WasmSpec {
  /** Module path relative to the package, staged under /wasm/ or /apps/<id>/. */
  module: string;
  /** Worker entry when the module runs off the main thread. */
  worker?: string;
  sha256?: string;
}

export interface StreamSpec {
  /** Host-side program the service starts for a session (resolved by the services layer, never by the client). */
  program: string;
  protocol: "wayland-webrtc" | "vnc-ws" | "rdp-ws";
}

export interface WaylandSpec {
  /** Command the services layer launches inside the Hyprland session (resolved server-side, never by the client). */
  command: string[];
  /** Wayland app_id / window class Hyprland reports, used to bind the client surface to this WebOS window. */
  appId: string;
  /** true: every toplevel becomes its own WebOS window; false: one shared surface. */
  perWindow?: boolean;
}

export interface WebViewSpec {
  url: string;
  /** Hosts the window may navigate to; everything else opens in the system handler after a prompt. */
  allow?: string[];
  /** iframe sandbox tokens beyond the default "allow-scripts allow-forms". */
  sandbox?: string[];
}

export interface AppManifest {
  /** Stable kebab-case id; also the deep-link key in infra/config/routes.catalog.json. */
  id: string;
  /** The real product name shown everywhere (dock, launcher, title bar). Generic labels ("PDF", "Documents") fail validation. */
  name: string;
  icon: AppIcon;
  backing: Backing;
  /** Module that mounts the app (backing wasm/api/browser/app-ui) or the route/URL (webview/app-ui). */
  entry: string;
  wasm?: WasmSpec;
  stream?: StreamSpec;
  wayland?: WaylandSpec;
  webview?: WebViewSpec;
  permissions: Permission[];
  /** Capability ids from @aphrody/bun-workspace/capabilities this app serves (file types, protocols, share targets). */
  capabilities: string[];
  desc: string;
  group: "core" | "advanced";
  window?: {
    width?: number;
    height?: number;
    float?: boolean;
    singleton?: boolean;
  };
  version?: string;
  license?: string;
}

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const GENERIC = new Set([
  "app",
  "apps",
  "pdf",
  "documents",
  "files",
  "terminal",
  "browser",
  "editor",
  "viewer",
  "media",
  "tool",
  "tools",
  "web app",
  "native app",
]);

/** Returns a list of problems; empty means valid. `genericOk` is for the legacy built-ins until they are renamed. */
export function validateManifest(
  m: AppManifest,
  options: { genericOk?: boolean } = {},
): string[] {
  const e: string[] = [];
  const need = (ok: unknown, msg: string) =>
    ok || e.push(`${m.id || "?"}: ${msg}`);
  need(KEBAB.test(m.id ?? ""), "id must be kebab-case");
  need(m.name?.trim(), "name is required");
  need(
    options.genericOk || !GENERIC.has(m.name?.trim().toLowerCase()),
    `name "${m.name}" is a generic label; use the real product name`,
  );
  need(
    m.icon?.src && m.icon.origin && m.icon.license,
    "icon needs src, origin and license",
  );
  need(
    (BACKINGS as readonly string[]).includes(m.backing),
    `backing must be one of ${BACKINGS.join(", ")}`,
  );
  need(m.entry, "entry is required");
  need(
    m.backing !== "wasm" || m.wasm?.module,
    "backing wasm needs wasm.module",
  );
  need(
    m.backing !== "stream" || m.stream?.program,
    "backing stream needs stream.program",
  );
  need(
    m.backing !== "webview" || m.webview?.url,
    "backing webview needs webview.url",
  );
  need(
    m.permissions?.every((p) => (PERMISSIONS as readonly string[]).includes(p)),
    "unknown permission",
  );
  need(
    m.backing !== "wayland" || (m.wayland?.command?.length && m.wayland.appId),
    "backing wayland needs wayland.command and wayland.appId",
  );
  need(
    !["stream", "wayland"].includes(m.backing) ||
      m.permissions?.includes("stream"),
    "backing stream/wayland needs permission stream",
  );
  return e;
}
