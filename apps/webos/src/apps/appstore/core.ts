// SPDX-License-Identifier: Apache-2.0
// Store core: catalog loading, shared state, formatting and the handle every screen receives.
import { h } from "../../dom";
import { installed, needsUpdate, registry, type RegistryEntry } from "../../pkg";
import type { StoreApp, StoreCatalog, StoreQualification, StoreSource } from "../../../store/types";

export type View = "home" | "collection" | "search" | "library" | "sources" | "app" | "notfound";
export type Tab = "home" | "apps" | "games" | "libraries" | "linux";
export type Sort = "name" | "size" | "version";

/** Top-level tabs and the catalog categories each one gathers. */
export const TABS: { id: Tab; label: string; icon: string; categories: string[] }[] = [
  { id: "home", label: "Home", icon: "home", categories: [] },
  { id: "apps", label: "Apps", icon: "apps", categories: ["create", "tools", "system", "android"] },
  { id: "games", label: "Games", icon: "sports_esports", categories: ["games"] },
  { id: "libraries", label: "Libraries", icon: "deployed_code", categories: ["libraries"] },
  { id: "linux", label: "Linux", icon: "terminal", categories: ["linux"] },
];

export interface State {
  view: View;
  tab: Tab;
  category: string;
  source: string;
  query: string;
  appId: string;
  sort: Sort;
  library: "installed" | "updates";
}

/** Everything a screen needs; built once the catalog is loaded. */
export interface Store {
  catalog: StoreCatalog;
  offline: boolean;
  qual?: StoreQualification;
  /** Agent base URL ("" = same origin) or undefined when no Bun OS agent answers. */
  agent?: string;
  byId: Map<string, StoreApp>;
  regById: Map<string, RegistryEntry>;
  state: State;
  onChange(): void;
  launch(entry: RegistryEntry): void;
  go(view: View, extra?: Partial<State>): void;
  back(): void;
  open(app: StoreApp): void;
  render(): void;
  toast(text: string): void;
  qualified(app: StoreApp): boolean | undefined;
  isInstalled(app: StoreApp): boolean;
  installedVersion(app: StoreApp): string | undefined;
  updatable(app: StoreApp): boolean;
  sourceLabel(id: string): string;
  categoryLabel(id: string): string;
}

export const AGENT_KEY = "aph.store.agent";
const AGENT_INSTALLED = "aph.store.installed";

export const fmt = (n?: number) =>
  n === undefined
    ? ""
    : n < 1048576
      ? `${Math.max(1, Math.round(n / 1024))} KB`
      : n < 1073741824
        ? `${(n / 1048576).toFixed(1)} MB`
        : `${(n / 1073741824).toFixed(2)} GB`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Material Symbols glyph by its real name (the full symbol font is shipped). */
export function mi(name: string): HTMLSpanElement {
  const s = h("span", { class: "mi material-symbols-rounded", "aria-hidden": "true" });
  s.textContent = name;
  return s;
}

export type Tracked = Record<string, { version: string; at: string }>;
export const commandInstalled = (): Tracked => {
  try {
    return JSON.parse(localStorage.getItem(AGENT_INSTALLED) ?? "{}") as Tracked;
  } catch {
    return {};
  }
};
export const saveCommandInstalled = (v: Tracked) => localStorage.setItem(AGENT_INSTALLED, JSON.stringify(v));

function fromRegistry(entries: RegistryEntry[]): StoreCatalog {
  const apps: StoreApp[] = entries.map((e) => ({
    id: `bunos:${e.id}`,
    name: e.name,
    pkg: e.id,
    source: "bunos",
    category: e.category,
    summary: e.description,
    version: e.version,
    size: e.size,
    license: e.license,
    icon: e.glyph,
    permissions: e.threads ? ["Uses worker threads (SharedArrayBuffer)"] : undefined,
    install: { pwa: e.id },
    rating: null,
  }));
  const cats = new Map<string, number>();
  for (const a of apps) cats.set(a.category, (cats.get(a.category) ?? 0) + 1);
  return {
    schemaVersion: 1,
    generated: "",
    origin: location.origin,
    sources: [{ id: "bunos", label: "Bun OS", desc: "Apps installed into your browser", count: apps.length }],
    categories: [...cats].map(([id, count]) => ({ id, label: cap(id), count })),
    apps,
    featured: [],
  };
}

/** Catalog from /api/store/catalog; the browser app registry when the Store API is unreachable; throws when neither answers. */
export async function loadCatalog(): Promise<{ catalog: StoreCatalog; offline: boolean }> {
  try {
    const res = await fetch("/api/store/catalog", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    return { catalog: (await res.json()) as StoreCatalog, offline: false };
  } catch {
    return { catalog: fromRegistry(await registry()), offline: true };
  }
}
export const loadQualification = (): Promise<StoreQualification | undefined> =>
  fetch("/api/store/qualification", { cache: "no-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<StoreQualification>) : undefined))
    .catch(() => undefined);

/** Bun OS agent API: the URL the user stored, else same-origin /api/agent/status. */
export async function probeAgent(): Promise<string | undefined> {
  const stored = localStorage.getItem(AGENT_KEY)?.replace(/\/+$/, "");
  for (const base of stored ? [stored, ""] : [""]) {
    try {
      const res = await fetch(`${base}/api/agent/status`, { cache: "no-store" });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) return base;
    } catch {
      /* not connected */
    }
  }
  return undefined;
}

export function copy(text: string, button: HTMLElement, done?: () => void) {
  void navigator.clipboard?.writeText(text).then(() => {
    const before = button.textContent;
    button.textContent = "Copied";
    done?.();
    setTimeout(() => (button.textContent = before), 1200);
  });
}

export function sourceById(catalog: StoreCatalog, id: string): StoreSource | undefined {
  return catalog.sources.find((s) => s.id === id);
}

export { installed, needsUpdate };
