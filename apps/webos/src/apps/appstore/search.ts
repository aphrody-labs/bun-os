// SPDX-License-Identifier: Apache-2.0
// S04 Search: field with live suggestions (combobox) and the results screen.
import { h } from "../../dom";
import type { StoreApp } from "../../../store/types";
import { mi, type Store } from "./core";
import { chips, grid, iconTile } from "./parts";
import { emptyState } from "./states";

/** Ranked matches: every term must appear in name, package, summary or category; names weigh most. */
export function searchApps(s: Store, query: string): StoreApp[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: { a: StoreApp; score: number }[] = [];
  for (const a of s.catalog.apps) {
    const name = `${a.name} ${a.pkg}`.toLowerCase();
    const text = `${name} ${a.summary} ${a.category}`.toLowerCase();
    if (!terms.every((t) => text.includes(t))) continue;
    hits.push({ a, score: terms.reduce((n, t) => n + (name.startsWith(t) ? 4 : name.split(/[^a-z0-9]+/).includes(t) ? 3 : name.includes(t) ? 2 : 1), 0) - (a.unavailable ? 0.5 : 0) });
  }
  return hits.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name)).map((x) => x.a);
}

export function searchBox(s: Store): HTMLElement {
  const input = h("input", {
    class: "st-search",
    type: "search",
    placeholder: "Search apps, packages and crates",
    "aria-label": "Search the Store",
    autocomplete: "off",
    role: "combobox",
    "aria-expanded": "false",
    "aria-controls": "st-suggest",
    "aria-autocomplete": "list",
  }) as HTMLInputElement;
  const list = h("ul", { class: "st-suggest", id: "st-suggest", role: "listbox", "aria-label": "Suggestions", hidden: true });
  let items: StoreApp[] = [];
  let active = -1;
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const submit = () => {
    const q = input.value.trim();
    close();
    if (q) s.go("search", { query: q, source: "" });
  };
  const mark = () => {
    [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    if (active >= 0) input.setAttribute("aria-activedescendant", `st-sg-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };
  const refresh = () => {
    const q = input.value.trim();
    items = q ? searchApps(s, q).slice(0, 6) : [];
    list.replaceChildren(
      ...items.map((a, i) =>
        h(
          "li",
          { id: `st-sg-${i}`, role: "option", "aria-selected": "false", onmousedown: (e: Event) => (e.preventDefault(), close(), s.open(a)) },
          iconTile(a),
          h("span", { class: "st-tile-text" }, h("span", { class: "st-name" }, a.name), h("span", { class: "st-meta" }, `${s.sourceLabel(a.source)} · ${a.version}`)),
        ),
      ),
      ...(q ? [h("li", { id: "st-sg-all", role: "option", "aria-selected": "false", class: "all", onmousedown: (e: Event) => (e.preventDefault(), submit()) }, mi("search"), `Search all for "${q}"`)] : []),
    );
    list.hidden = !q;
    input.setAttribute("aria-expanded", String(!!q));
    active = -1;
  };
  input.addEventListener("input", () => {
    refresh();
    if (!input.value.trim() && s.state.view === "search") s.go("home", { query: "" });
  });
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    const n = list.children.length;
    if (e.key === "ArrowDown" && n) (e.preventDefault(), (active = (active + 1) % n), mark());
    else if (e.key === "ArrowUp" && n) (e.preventDefault(), (active = (active - 1 + n) % n), mark());
    else if (e.key === "Escape") close();
    else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) (close(), s.open(items[active]!));
      else submit();
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("focus", () => input.value.trim() && refresh());
  return h("div", { class: "st-searchbox", role: "search" }, mi("search"), input, list);
}

export function viewSearch(s: Store): HTMLElement {
  const q = s.state.query.trim();
  const all = searchApps(s, q);
  const counts = new Map<string, number>();
  for (const a of all) counts.set(a.source, (counts.get(a.source) ?? 0) + 1);
  const shown = s.state.source ? all.filter((a) => a.source === s.state.source) : all;
  const out = h(
    "div",
    { class: "st-results" },
    h("h1", {}, `Results for "${q}"`),
    counts.size > 1
      ? chips("Filter by source", [{ id: "", label: `All (${all.length})` }, ...[...counts].map(([id, n]) => ({ id, label: `${s.sourceLabel(id)} (${n})` }))], s.state.source, (id) => s.go("search", { source: id }))
      : null,
    h("p", { class: "st-note", role: "status", "aria-live": "polite" }, `${shown.length} result${shown.length === 1 ? "" : "s"}`),
  );
  if (!shown.length) {
    out.append(emptyState("No match", "Try a package name, a format such as flatpak, or fewer words.", { label: "Browse everything", run: () => s.go("collection", { tab: "apps", category: "", source: "" }) }));
    return out;
  }
  out.append(grid(s, shown.slice(0, 200)));
  if (shown.length > 200) out.append(h("p", { class: "st-note" }, `Showing the first 200 of ${shown.length}; narrow the search to see the rest.`));
  return out;
}
