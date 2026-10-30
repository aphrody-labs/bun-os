// SPDX-License-Identifier: Apache-2.0
// Bun OS Store: browse, search, install, update and remove apps from every source the host serves
// (browser apps, pacman, apk, flatpak, npm, cargo, Android). Catalog and qualification come from
// /api/store/*; with no catalog the browser app registry still works. Only real data is shown.
// Screens live in ./appstore/*.ts (S01 shell, S02 home, S03 collection, S04 search, S05 detail,
// S06 install flows, S07 library, S08 sources, S09 states).
import "../m3";
import { installed, needsUpdate, registry, type RegistryEntry } from "../pkg";
import type { StoreApp } from "../../store/types";
import {
  cap,
  commandInstalled,
  loadCatalog,
  loadQualification,
  probeAgent,
  TABS,
  type State,
  type Store,
  type View,
} from "./appstore/core";
import { buildShell } from "./appstore/shell";
import { views } from "./appstore/views";
import { searchBox } from "./appstore/search";
import { skeleton, errorState } from "./appstore/states";

export async function appStore(
  root: HTMLElement,
  onChange: () => void,
  launch: (entry: RegistryEntry) => void,
  initialCategory: RegistryEntry["category"] | "all" = "all",
) {
  const boot = async () => {
    root.replaceChildren(skeleton("home"));
    let loaded;
    try {
      loaded = await Promise.all([loadCatalog(), registry(), loadQualification(), probeAgent()]);
    } catch (error) {
      root.replaceChildren(errorState("The Store could not load its catalog.", String((error as Error).message ?? error), () => void boot()));
      return;
    }
    const [{ catalog, offline }, entries, qual, agent] = loaded;
    root.replaceChildren();
    start(root, { catalog, offline, entries, qual, agent }, onChange, launch, initialCategory);
  };
  void boot();
}

function start(
  root: HTMLElement,
  data: { catalog: Store["catalog"]; offline: boolean; entries: RegistryEntry[]; qual: Store["qual"]; agent: Store["agent"] },
  onChange: () => void,
  launch: (entry: RegistryEntry) => void,
  initialCategory: RegistryEntry["category"] | "all",
) {
  const { catalog, offline, entries, qual, agent } = data;
  const byId = new Map(catalog.apps.map((a) => [a.id, a]));
  const regById = new Map(entries.map((e) => [e.id, e]));
  const qualBySource = new Map<string, boolean>();
  for (const r of qual?.results ?? []) qualBySource.set(r.format, r.ok);
  const tabOf = (category: string) => TABS.find((t) => t.categories.includes(category))?.id ?? "apps";
  const state: State = { view: "home", tab: "home", category: "", source: "", query: "", appId: "", sort: "name", library: "installed" };
  const params = new URLSearchParams(location.search);
  const deepApp = params.get("store");
  const deepCategory = params.get("category") ?? (initialCategory === "all" ? "" : initialCategory);
  const deepView = params.get("view");
  if (deepApp) Object.assign(state, byId.has(deepApp) ? { view: "app", appId: deepApp } : { view: "notfound", query: deepApp });
  else if (params.get("q")) Object.assign(state, { view: "search", query: params.get("q")! });
  else if (deepView === "library" || deepView === "updates") Object.assign(state, { view: "library", library: deepView === "updates" ? "updates" : "installed" });
  else if (deepView === "sources") state.view = "sources";
  else if (deepCategory) Object.assign(state, { view: "collection", category: deepCategory, tab: tabOf(deepCategory) });
  const stack: State[] = [];
  const shellRef: { current?: ReturnType<typeof buildShell> } = {};

  const s: Store = {
    catalog,
    offline,
    qual,
    agent,
    byId,
    regById,
    state,
    onChange,
    launch,
    go(view: View, extra: Partial<State> = {}) {
      if (view !== state.view || state.view === "app") stack.push({ ...state });
      if (stack.length > 40) stack.shift();
      Object.assign(state, extra, { view });
      s.render();
      shellRef.current?.main.scrollTo(0, 0);
    },
    back() {
      const prev = stack.pop();
      if (prev) Object.assign(state, prev);
      else Object.assign(state, { view: "home", tab: "home", category: "" });
      s.render();
    },
    open(app: StoreApp) {
      const tab = state.tab === "home" ? state.tab : tabOf(app.category);
      s.go("app", { appId: app.id, tab });
      history.replaceState(null, "", `?store=${encodeURIComponent(app.id)}`);
    },
    render() {
      const shell = shellRef.current!;
      shell.sync();
      const make = views[state.view] ?? views.home;
      shell.main.replaceChildren(make(s));
    },
    toast: (text) => shellRef.current?.toast(text),
    qualified: (a) => a.qualified ?? qualBySource.get(a.source === "arch" ? "pacman" : a.source),
    isInstalled: (a) => (a.install.pwa ? !!installed()[a.install.pwa] : !!commandInstalled()[a.id]),
    installedVersion: (a) => (a.install.pwa ? installed()[a.install.pwa]?.version : commandInstalled()[a.id]?.version),
    updatable(a) {
      const e = a.install.pwa ? regById.get(a.install.pwa) : undefined;
      return !!e && needsUpdate(e);
    },
    sourceLabel: (id) => catalog.sources.find((x) => x.id === id)?.label ?? id,
    categoryLabel: (id) => catalog.categories.find((c) => c.id === id)?.label ?? cap(id),
  };
  const shell = buildShell(s, searchBox(s));
  shellRef.current = shell;
  root.append(shell.el);
  s.render();
}

