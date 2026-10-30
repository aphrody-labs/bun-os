// SPDX-License-Identifier: Apache-2.0
// Shared pieces: icon tile, badge, app tile, grid, shelf, chips.
import { h } from "../../dom";
import type { StoreApp } from "../../../store/types";
import { fmt, mi, type Store } from "./core";

export const badge = (text: string, cls = "") => h("span", { class: `st-badge ${cls}` }, text);

/** App icon: the glyph of the registry entry, else the first letters of the name; tonal colour follows the source. */
export function iconTile(a: StoreApp, big = false) {
  return h("span", { class: `st-icon src-${a.source}${big ? " big" : ""}`, "aria-hidden": "true" }, (a.icon ?? a.name).replace(/^@aphrody\//, "").slice(0, 3));
}

export function tile(s: Store, a: StoreApp) {
  const meta = [a.version, a.size ? fmt(a.size) : ""].filter(Boolean).join(" · ");
  return h(
    "button",
    { class: "st-tile", type: "button", onclick: () => s.open(a), "aria-label": `${a.name}, ${s.sourceLabel(a.source)}` },
    iconTile(a),
    h(
      "span",
      { class: "st-tile-text" },
      h("span", { class: "st-name" }, a.name),
      h("span", { class: "st-sum" }, a.summary || a.pkg),
      h(
        "span",
        { class: "st-meta" },
        badge(s.sourceLabel(a.source)),
        s.isInstalled(a) ? badge("Installed", "ok") : null,
        a.unavailable ? badge("Not installable here") : null,
        meta,
      ),
    ),
  );
}

export const grid = (s: Store, apps: StoreApp[]) => h("div", { class: "st-grid" }, ...apps.map((a) => tile(s, a)));

/** Horizontal shelf with a heading, an optional "See all" link and scroll buttons. */
export function shelf(s: Store, title: string, apps: StoreApp[], opts: { more?: () => void; note?: string; limit?: number } = {}) {
  if (!apps.length) return null;
  const row = h("div", { class: "st-row", tabindex: "-1" }, ...apps.slice(0, opts.limit ?? 14).map((a) => tile(s, a)));
  const scroll = (dir: number) => row.scrollBy({ left: dir * Math.max(240, row.clientWidth * 0.8), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  return h(
    "section",
    { class: "st-shelf", "aria-label": title },
    h(
      "div",
      { class: "st-shelf-head" },
      h("h2", {}, title),
      opts.note ? h("span", { class: "st-note" }, opts.note) : null,
      opts.more ? h("button", { class: "st-link", type: "button", onclick: opts.more }, "See all") : null,
      h("button", { class: "st-icon-btn st-scroll", type: "button", "aria-label": `Scroll ${title} back`, onclick: () => scroll(-1) }, mi("chevron_left")),
      h("button", { class: "st-icon-btn st-scroll", type: "button", "aria-label": `Scroll ${title} forward`, onclick: () => scroll(1) }, mi("chevron_right")),
    ),
    row,
  );
}

export interface Chip {
  id: string;
  label: string;
}
/** Single-choice chip row with arrow-key navigation. */
export function chips(name: string, items: Chip[], current: string, pick: (id: string) => void) {
  const row = h("div", { class: "st-chips", role: "radiogroup", "aria-label": name });
  for (const c of items)
    row.append(
      h(
        "button",
        { class: `st-chip${current === c.id ? " on" : ""}`, type: "button", role: "radio", "aria-checked": String(current === c.id), tabindex: current === c.id ? "0" : "-1", onclick: () => pick(c.id) },
        c.label,
      ),
    );
  row.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const list = [...row.querySelectorAll<HTMLElement>(".st-chip")];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    list[(i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length]!.focus();
  });
  return row;
}
