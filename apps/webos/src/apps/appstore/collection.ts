// SPDX-License-Identifier: Apache-2.0
// S03 Collection: a tab, category or source as a filterable, sortable grid.
import { h } from "../../dom";
import type { StoreApp } from "../../../store/types";
import { TABS, fmt, type Sort, type Store } from "./core";
import { chips, grid } from "./parts";
import { emptyState } from "./states";

const PAGE = 120;
const SORTS: { id: Sort; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "size", label: "Size, largest first" },
  { id: "version", label: "Version" },
];

const cmp: Record<Sort, (a: StoreApp, b: StoreApp) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  size: (a, b) => (b.size ?? 0) - (a.size ?? 0) || a.name.localeCompare(b.name),
  version: (a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }) || a.name.localeCompare(b.name),
};

export function viewCollection(s: Store, shown = PAGE): HTMLElement {
  const { state, catalog } = s;
  const tab = TABS.find((t) => t.id === state.tab);
  const tabCats = tab && tab.categories.length ? tab.categories : catalog.categories.map((c) => c.id);
  const cats = catalog.categories.filter((c) => tabCats.includes(c.id));
  const heading = state.category ? s.categoryLabel(state.category) : state.source ? s.sourceLabel(state.source) : (tab?.label ?? "All apps");
  let apps = catalog.apps.filter((a) => (state.category ? a.category === state.category : tabCats.includes(a.category)) && (!state.source || a.source === state.source));
  apps = [...apps].sort((a, b) => Number(!!a.unavailable) - Number(!!b.unavailable) || cmp[state.sort](a, b));
  const sourcesHere = catalog.sources.filter((x) => x.count && catalog.apps.some((a) => a.source === x.id && tabCats.includes(a.category)));
  const select = h("select", { class: "st-select", "aria-label": "Sort by", onchange: (e: Event) => s.go("collection", { sort: (e.target as HTMLSelectElement).value as Sort }) }, ...SORTS.map((o) => h("option", { value: o.id, selected: state.sort === o.id }, o.label)));
  const out = h(
    "div",
    { class: "st-collection" },
    h("h1", {}, heading),
    cats.length > 1 ? chips("Categories", [{ id: "", label: "All" }, ...cats.map((c) => ({ id: c.id, label: `${c.label} (${c.count})` }))], state.category, (id) => s.go("collection", { category: id })) : null,
    sourcesHere.length > 1 ? chips("Sources", [{ id: "", label: "Any source" }, ...sourcesHere.map((x) => ({ id: x.id, label: x.label }))], state.source, (id) => s.go("collection", { source: id })) : null,
    h("div", { class: "st-toolbar" }, h("span", { class: "st-note", "aria-live": "polite" }, `${apps.length} app${apps.length === 1 ? "" : "s"}${apps.length ? ` · ${fmt(apps.reduce((n, a) => n + (a.size ?? 0), 0))} total` : ""}`), select),
  );
  if (!apps.length) {
    out.append(emptyState("Nothing here", "No app matches these filters.", { label: "Clear filters", run: () => s.go("collection", { category: "", source: "" }) }));
    return out;
  }
  out.append(grid(s, apps.slice(0, shown)));
  if (apps.length > shown)
    out.append(
      h(
        "div",
        { class: "st-more" },
        h("button", { class: "btn tonal", type: "button", onclick: () => out.replaceWith(viewCollection(s, shown + PAGE)) }, `Show ${Math.min(PAGE, apps.length - shown)} more of ${apps.length - shown}`),
      ),
    );
  return out;
}
