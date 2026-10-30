// SPDX-License-Identifier: Apache-2.0
// Bun OS Store: browse, search, install, update and remove apps from every source the host serves
// (browser apps, pacman, apk, flatpak, npm, cargo, Android). Catalog and qualification come from
// /api/store/*; with no catalog the browser app registry still works. Only real data is shown.
import { h, icon } from "../dom";
import "../m3";
import { install, installed, needsUpdate, registry, uninstall, type RegistryEntry } from "../pkg";
import type { StoreApp, StoreCatalog, StoreQualification, StoreSource } from "../../store/types";

type View = "home" | "categories" | "search" | "installed" | "updates" | "sources" | "app";
const NAV: { id: Exclude<View, "search" | "app">; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "categories", label: "Categories", icon: "category" },
  { id: "installed", label: "Installed", icon: "download_done" },
  { id: "updates", label: "Updates", icon: "update" },
  { id: "sources", label: "Sources", icon: "dns" },
];
const AGENT_KEY = "aph.store.agent";
const AGENT_INSTALLED = "aph.store.installed";

const fmt = (n?: number) =>
  n === undefined
    ? ""
    : n < 1048576
      ? `${Math.max(1, Math.round(n / 1024))} KB`
      : n < 1073741824
        ? `${(n / 1048576).toFixed(1)} MB`
        : `${(n / 1073741824).toFixed(2)} GB`;
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Tracked = Record<string, { version: string; at: string }>;
const commandInstalled = (): Tracked => {
  try {
    return JSON.parse(localStorage.getItem(AGENT_INSTALLED) ?? "{}") as Tracked;
  } catch {
    return {};
  }
};
const saveCommandInstalled = (v: Tracked) => localStorage.setItem(AGENT_INSTALLED, JSON.stringify(v));

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
    permissions: e.threads ? ["threads"] : undefined,
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
    categories: [...cats].map(([id, count]) => ({ id, label: label(id), count })),
    apps,
    featured: [],
  };
}

async function loadCatalog(): Promise<{ catalog: StoreCatalog; offline: boolean }> {
  try {
    const res = await fetch("/api/store/catalog", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    return { catalog: (await res.json()) as StoreCatalog, offline: false };
  } catch {
    return { catalog: fromRegistry(await registry()), offline: true };
  }
}
const loadQualification = (): Promise<StoreQualification | undefined> =>
  fetch("/api/store/qualification", { cache: "no-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<StoreQualification>) : undefined))
    .catch(() => undefined);

/** Bun OS agent API: the URL the user stored, else same-origin /api/agent/status. */
async function probeAgent(): Promise<string | undefined> {
  const stored = localStorage.getItem(AGENT_KEY)?.replace(/\/+$/, "");
  const bases = stored ? [stored, ""] : [""];
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/agent/status`, { cache: "no-store" });
      if (res.ok) return base;
    } catch {
      /* not connected */
    }
  }
  return undefined;
}

function copy(text: string, button: HTMLElement) {
  void navigator.clipboard?.writeText(text).then(() => {
    const before = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = before), 1200);
  });
}

export async function appStore(
  root: HTMLElement,
  onChange: () => void,
  launch: (entry: RegistryEntry) => void,
  initialCategory: RegistryEntry["category"] | "all" = "all",
) {
  const [{ catalog, offline }, entries, qual, agent] = await Promise.all([
    loadCatalog(),
    registry(),
    loadQualification(),
    probeAgent(),
  ]);
  const regById = new Map(entries.map((e) => [e.id, e]));
  const byId = new Map(catalog.apps.map((a) => [a.id, a]));
  const qualBySource = new Map<string, boolean>();
  for (const r of qual?.results ?? []) qualBySource.set(r.format, r.ok);
  const qualified = (a: StoreApp) => a.qualified ?? qualBySource.get(a.source === "arch" ? "pacman" : a.source);

  const params = new URLSearchParams(location.search);
  const state = {
    view: "home" as View,
    category: initialCategory === "all" ? "" : initialCategory,
    query: "",
    source: "",
    appId: "",
  };
  const deep = params.get("store");
  if (deep && byId.has(deep)) Object.assign(state, { view: "app", appId: deep });
  else if (params.get("category")) Object.assign(state, { view: "categories", category: params.get("category")! });
  else if (state.category) state.view = "categories";

  const main = h("main", { class: "st-main", tabindex: "-1" });
  const search = h("input", {
    class: "st-search",
    type: "search",
    placeholder: "Search apps, packages and crates",
    "aria-label": "Search the Store",
  }) as HTMLInputElement;
  search.addEventListener("input", () => {
    state.query = search.value;
    if (state.query.trim()) state.view = "search";
    else if (state.view === "search") state.view = "home";
    render();
  });
  const rail = h("nav", { class: "st-rail", "aria-label": "Store sections" });
  const shell = h("div", { class: "st" }, rail, h("div", { class: "st-body" }, h("div", { class: "st-top" }, search), main));
  root.append(shell);

  const go = (view: View, extra: Partial<typeof state> = {}) => {
    Object.assign(state, extra, { view });
    render();
    main.scrollTop = 0;
  };
  const open = (a: StoreApp) => go("app", { appId: a.id });

  // ---- installed state -----------------------------------------------------------------------------------
  const isInstalled = (a: StoreApp) => (a.install.pwa ? !!installed()[a.install.pwa] : !!commandInstalled()[a.id]);
  const installedVersion = (a: StoreApp) =>
    a.install.pwa ? installed()[a.install.pwa]?.version : commandInstalled()[a.id]?.version;
  const updatable = (a: StoreApp) => {
    const e = a.install.pwa ? regById.get(a.install.pwa) : undefined;
    return !!e && needsUpdate(e);
  };

  // ---- pieces --------------------------------------------------------------------------------------------
  const sourceLabel = (id: string) => catalog.sources.find((s) => s.id === id)?.label ?? id;
  const iconTile = (a: StoreApp, big = false) =>
    h("span", { class: `st-icon src-${a.source}${big ? " big" : ""}`, "aria-hidden": "true" }, (a.icon ?? a.name).slice(0, 3));
  const badge = (text: string, cls = "") => h("span", { class: `st-badge ${cls}` }, text);

  function tile(a: StoreApp) {
    const meta = [a.version, a.size ? fmt(a.size) : "", a.license ?? ""].filter(Boolean).join(" · ");
    return h(
      "button",
      { class: "st-tile", type: "button", onclick: () => open(a), "aria-label": `${a.name}, ${sourceLabel(a.source)}` },
      iconTile(a),
      h(
        "span",
        { class: "st-tile-text" },
        h("span", { class: "st-name" }, a.name),
        h("span", { class: "st-sum" }, a.summary),
        h("span", { class: "st-meta" }, badge(sourceLabel(a.source)), isInstalled(a) ? badge("Installed", "ok") : null, meta),
      ),
    );
  }
  const grid = (apps: StoreApp[], empty: string) =>
    apps.length ? h("div", { class: "st-grid" }, ...apps.map(tile)) : h("p", { class: "st-empty" }, empty);
  const shelf = (title: string, apps: StoreApp[], more?: () => void) =>
    apps.length
      ? h(
          "section",
          { class: "st-shelf" },
          h(
            "div",
            { class: "st-shelf-head" },
            h("h2", {}, title),
            more ? h("button", { class: "dlg-text", onclick: more }, "See all") : null,
          ),
          h("div", { class: "st-row" }, ...apps.slice(0, 12).map(tile)),
        )
      : null;

  // ---- actions on an app ---------------------------------------------------------------------------------
  function actions(a: StoreApp) {
    const box = h("div", { class: "st-actions" });
    const status = h("div", { class: "st-status", role: "status" });
    const progress = document.createElement("md-linear-progress") as HTMLElement & { value: number };
    progress.value = 0;
    progress.hidden = true;
    const guard = (fn: () => Promise<void>) => async (ev: Event) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      progress.hidden = false;
      try {
        await fn();
        onChange();
        render();
      } catch (error) {
        status.textContent = `Failed: ${String((error as Error).message ?? error)}`;
        status.classList.add("err");
        btn.disabled = false;
        progress.hidden = true;
      }
    };
    const reg = a.install.pwa ? regById.get(a.install.pwa) : undefined;
    if (reg) {
      const doInstall = guard(() =>
        install(reg, (d, t) => {
          progress.value = d / t;
          status.textContent = `Downloading… ${Math.round((d / t) * 100)}%`;
        }),
      );
      if (!installed()[reg.id]) box.append(h("button", { class: "btn", onclick: doInstall }, "Install"));
      else {
        box.append(h("button", { class: "btn", onclick: () => launch(reg) }, "Open"));
        if (needsUpdate(reg)) box.append(h("button", { class: "btn tonal", onclick: doInstall }, "Update"));
        box.append(h("button", { class: "btn tonal", onclick: guard(() => uninstall(reg.id)) }, "Remove"));
      }
    }
    if (a.install.download)
      box.append(
        h(
          "a",
          { class: "st-link-btn", href: a.install.download.url, download: a.install.download.name ?? "" },
          icon("download"),
          `Download${a.install.download.size ? ` (${fmt(a.install.download.size)})` : ""}`,
        ),
      );
    if (a.install.agent) {
      const ag = a.install.agent;
      const call = (action: "install" | "remove") =>
        guard(async () => {
          const res = await fetch(`${agent}/api/pkg`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ manager: ag.manager, name: ag.name, action }),
          });
          if (!res.ok) throw new Error(`agent answered ${res.status}`);
          const next = commandInstalled();
          if (action === "install") next[a.id] = { version: a.version, at: new Date().toISOString() };
          else delete next[a.id];
          saveCommandInstalled(next);
        });
      if (agent === undefined)
        box.append(
          h("span", { class: "st-note" }, "No Bun OS agent connected: copy the command below, or set an agent URL in Sources."),
        );
      else if (commandInstalled()[a.id]) box.append(h("button", { class: "btn tonal", onclick: call("remove") }, "Uninstall"));
      else box.append(h("button", { class: "btn", onclick: call("install") }, `Install with ${ag.manager}`));
    }
    box.append(status, progress);
    return box;
  }

  function commands(a: StoreApp) {
    const list: { id: string; text: string }[] = [];
    if (a.install.command) list.push({ id: a.install.agent?.manager ?? "install", text: a.install.command });
    if (a.install.removeCommand) list.push({ id: "remove", text: a.install.removeCommand });
    if (!list.length) return null;
    const out = h("div", { class: "st-cmds" });
    for (const c of list)
      out.append(
        h(
          "div",
          { class: "st-cmd" },
          h("span", { class: "st-cmd-id" }, c.id),
          h("code", {}, c.text),
          h("button", { class: "dlg-text", onclick: (e: Event) => copy(c.text, e.currentTarget as HTMLElement) }, "Copy"),
        ),
      );
    return out;
  }

  // ---- views ---------------------------------------------------------------------------------------------
  function viewApp() {
    const a = byId.get(state.appId);
    if (!a) return h("p", { class: "st-empty" }, "This app is not in the catalog.");
    const q = qualified(a);
    const inst = installedVersion(a);
    const page = h("article", { class: "st-detail" });
    page.append(
      h("button", { class: "dlg-text st-back", onclick: () => go(state.query.trim() ? "search" : "home") }, "Back"),
      h(
        "header",
        { class: "st-detail-head" },
        iconTile(a, true),
        h(
          "div",
          {},
          h("h1", {}, a.name),
          h(
            "div",
            { class: "st-meta" },
            badge(sourceLabel(a.source)),
            badge(label(a.category)),
            q === true ? badge("Qualified", "ok") : q === false ? badge("Qualification failed", "err") : null,
            inst ? badge(`Installed v${inst}`, "ok") : null,
          ),
          h("p", { class: "st-sum" }, a.summary),
        ),
      ),
      actions(a),
      commands(a) ?? "",
    );
    const facts: [string, string][] = [
      ["Version", a.version],
      ["Size", fmt(a.size)],
      ["License", a.license ?? ""],
      ["Source", sourceLabel(a.source)],
      ["Package", a.pkg],
      ["Repository path", a.member?.path ?? ""],
    ];
    page.append(
      h("dl", { class: "st-facts" }, ...facts.filter(([, v]) => v).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    );
    if (a.homepage)
      page.append(h("p", {}, h("a", { href: a.homepage, target: "_blank", rel: "noopener noreferrer" }, "Homepage")));
    if (a.screenshots?.length)
      page.append(
        h("div", { class: "st-shots" }, ...a.screenshots.map((s) => h("img", { src: s, alt: `${a.name} screenshot`, loading: "lazy" }))),
      );
    if (a.description) page.append(h("section", {}, h("h2", {}, "About"), h("p", { class: "st-desc" }, a.description)));
    if (a.permissions?.length)
      page.append(h("section", {}, h("h2", {}, "Permissions"), h("ul", { class: "st-perms" }, ...a.permissions.map((p) => h("li", {}, p)))));
    if (a.versions?.length)
      page.append(
        h(
          "section",
          {},
          h("h2", {}, "Versions"),
          h(
            "table",
            { class: "st-table" },
            h("thead", {}, h("tr", {}, h("th", {}, "Version"), h("th", {}, "Size"), h("th", {}, "Date"))),
            h(
              "tbody",
              {},
              ...a.versions.map((v) => h("tr", {}, h("td", {}, v.version), h("td", {}, fmt(v.size)), h("td", {}, v.date?.slice(0, 10) ?? ""))),
            ),
          ),
        ),
      );
    page.append(h("section", {}, h("h2", {}, "Ratings"), h("p", { class: "st-note" }, "No ratings yet.")));
    return page;
  }

  function viewHome() {
    const parts: (Node | null)[] = [];
    if (offline) parts.push(h("p", { class: "st-note st-banner" }, "The store catalog is not reachable: showing browser apps only."));
    const featured = catalog.featured.map((id) => byId.get(id)).filter(Boolean) as StoreApp[];
    const hero = featured.length ? featured : catalog.apps.filter((a) => a.source === "bunos").slice(0, 6);
    if (hero.length)
      parts.push(
        h(
          "section",
          { class: "st-hero", "aria-label": "Featured" },
          ...hero.slice(0, 8).map((a) =>
            h(
              "button",
              { class: `st-feature src-${a.source}`, type: "button", onclick: () => open(a) },
              iconTile(a, true),
              h("span", { class: "st-name" }, a.name),
              h("span", { class: "st-sum" }, a.summary),
            ),
          ),
        ),
      );
    for (const c of catalog.categories.slice(0, 6))
      parts.push(shelf(c.label, catalog.apps.filter((a) => a.category === c.id), () => go("categories", { category: c.id })));
    const recent = catalog.apps
      .filter((a) => a.versions?.[0]?.date)
      .sort((x, y) => (y.versions![0]!.date ?? "").localeCompare(x.versions![0]!.date ?? ""));
    parts.push(shelf("Recently updated", recent));
    return h("div", {}, ...parts);
  }

  const filterSource = (apps: StoreApp[]) => (state.source ? apps.filter((a) => a.source === state.source) : apps);
  function sourceChips() {
    return h(
      "div",
      { class: "st-chips", role: "group", "aria-label": "Sources" },
      h("button", { class: `st-chip${state.source ? "" : " on"}`, onclick: () => go(state.view, { source: "" }) }, "All sources"),
      ...catalog.sources.map((s) =>
        h("button", { class: `st-chip${state.source === s.id ? " on" : ""}`, onclick: () => go(state.view, { source: s.id }) }, `${s.label} (${s.count})`),
      ),
    );
  }

  function viewCategories() {
    const chips = h(
      "div",
      { class: "st-chips", role: "group", "aria-label": "Categories" },
      h("button", { class: `st-chip${state.category ? "" : " on"}`, onclick: () => go("categories", { category: "" }) }, `All (${catalog.apps.length})`),
      ...catalog.categories.map((c) =>
        h("button", { class: `st-chip${state.category === c.id ? " on" : ""}`, onclick: () => go("categories", { category: c.id }) }, `${c.label} (${c.count})`),
      ),
    );
    const apps = catalog.apps.filter((a) => !state.category || a.category === state.category);
    return h("div", {}, chips, sourceChips(), grid(filterSource(apps).slice(0, 400), "Nothing in this category."));
  }

  function viewSearch() {
    const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits: { a: StoreApp; score: number }[] = [];
    for (const a of catalog.apps) {
      const name = `${a.name} ${a.pkg}`.toLowerCase();
      const text = `${name} ${a.summary} ${a.category}`.toLowerCase();
      if (!terms.every((t) => text.includes(t))) continue;
      hits.push({ a, score: terms.reduce((n, t) => n + (name.startsWith(t) ? 3 : name.includes(t) ? 2 : 1), 0) });
    }
    hits.sort((x, y) => y.score - x.score);
    const shown = filterSource(hits.map((x) => x.a));
    return h(
      "div",
      {},
      sourceChips(),
      h("p", { class: "st-note" }, `${shown.length} result${shown.length === 1 ? "" : "s"}`),
      grid(shown.slice(0, 200), "No app matches your search."),
    );
  }

  const viewInstalled = () =>
    h("div", {}, h("h2", {}, "Installed"), grid(catalog.apps.filter(isInstalled), "Nothing installed from the Store yet."));
  const viewUpdates = () =>
    h("div", {}, h("h2", {}, "Updates"), grid(catalog.apps.filter(updatable), "Everything installed in your browser is up to date."));

  function viewSources() {
    const wrap = h("div", { class: "st-sources" });
    const agentInput = h("input", {
      class: "st-search",
      type: "url",
      placeholder: "Bun OS agent URL (optional)",
      value: localStorage.getItem(AGENT_KEY) ?? "",
      "aria-label": "Bun OS agent URL",
    }) as HTMLInputElement;
    wrap.append(
      h("h2", {}, "Sources"),
      h(
        "div",
        { class: "st-agent" },
        h(
          "span",
          {},
          agent === undefined
            ? "Bun OS agent: not connected. One-click installs need it; commands always work."
            : `Bun OS agent: connected${agent ? ` (${agent})` : ""}.`,
        ),
        agentInput,
        h(
          "button",
          {
            class: "btn tonal",
            onclick: () => {
              localStorage.setItem(AGENT_KEY, agentInput.value.trim());
              location.reload();
            },
          },
          "Save and reconnect",
        ),
      ),
    );
    for (const s of catalog.sources as StoreSource[]) {
      const key = s.id === "arch" ? "pacman" : s.id;
      const r = qual?.results.find((x) => x.format === key);
      const logs = r
        ? h(
            "details",
            { class: "st-qual" },
            h("summary", {}, `Qualification: ${r.ok ? "pass" : "fail"} · ${r.at.slice(0, 16).replace("T", " ")}${r.image ? ` · ${r.image}` : ""}`),
            ...r.steps.map((st) =>
              h("div", { class: `st-step ${st.ok ? "ok" : "err"}` }, h("strong", {}, `${st.ok ? "PASS" : "FAIL"} ${st.name} (${st.ms} ms)`), h("pre", {}, st.log)),
            ),
          )
        : h("p", { class: "st-note" }, "Not qualified yet.");
      const setup = s.setup
        ? h(
            "div",
            { class: "st-cmd" },
            h("code", {}, s.setup),
            h("button", { class: "dlg-text", onclick: (e: Event) => copy(s.setup!, e.currentTarget as HTMLElement) }, "Copy"),
          )
        : null;
      wrap.append(
        h(
          "section",
          { class: "st-source" },
          h(
            "div",
            { class: "st-shelf-head" },
            h("h3", {}, s.label),
            r ? badge(r.ok ? "Pass" : "Fail", r.ok ? "ok" : "err") : null,
            h("button", { class: "dlg-text", onclick: () => go("categories", { source: s.id, category: "" }) }, `Browse ${s.count}`),
          ),
          h("p", { class: "st-sum" }, s.desc),
          s.repo ? h("p", {}, "Repository: ", h("code", {}, s.repo)) : null,
          setup,
          logs,
        ),
      );
    }
    return wrap;
  }

  function render() {
    rail.replaceChildren(
      ...NAV.map((n) => {
        const count = n.id === "updates" ? catalog.apps.filter(updatable).length : 0;
        const on = state.view === n.id;
        return h(
          "button",
          {
            class: `st-nav${on ? " on" : ""}`,
            type: "button",
            "aria-current": on ? "page" : undefined,
            onclick: () => {
              search.value = "";
              go(n.id, { query: "" });
            },
          },
          icon(n.icon),
          h("span", {}, n.label),
          count ? h("span", { class: "st-count" }, String(count)) : null,
        );
      }),
    );
    const view =
      state.view === "app"
        ? viewApp()
        : state.view === "search"
          ? viewSearch()
          : state.view === "categories"
            ? viewCategories()
            : state.view === "installed"
              ? viewInstalled()
              : state.view === "updates"
                ? viewUpdates()
                : state.view === "sources"
                  ? viewSources()
                  : viewHome();
    main.replaceChildren(view);
  }
  render();
}
