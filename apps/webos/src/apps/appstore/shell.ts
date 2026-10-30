// SPDX-License-Identifier: Apache-2.0
// S01 Shell: top bar with tabs, search slot, Library and Sources, content region, toast.
import { h } from "../../dom";
import { TABS, mi, type Store, type Tab } from "./core";

export interface Shell {
  el: HTMLElement;
  main: HTMLElement;
  /** Re-sync tab selection and badges with the state. */
  sync(): void;
  toast(text: string): void;
}

export function buildShell(s: Store, searchBox: HTMLElement): Shell {
  const main = h("main", { class: "st-main", id: "st-main", tabindex: "-1" });
  const tabs = h("div", { class: "st-tabs", role: "tablist", "aria-label": "Store sections" });
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  for (const t of TABS) {
    const b = h(
      "button",
      {
        class: "st-tab",
        type: "button",
        role: "tab",
        onclick: () => {
          const q = document.querySelector<HTMLInputElement>(".st-search");
          if (q) q.value = "";
          s.go(t.id === "home" ? "home" : "collection", { tab: t.id, category: "", source: "", query: "" });
        },
      },
      mi(t.icon),
      h("span", {}, t.label),
    );
    tabButtons.set(t.id, b);
    tabs.append(b);
  }
  tabs.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const list = [...tabButtons.values()];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    list[(i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length]!.focus();
  });
  const updates = h("span", { class: "st-count", hidden: true });
  const library = h(
    "button",
    { class: "st-icon-btn", type: "button", "aria-label": "Library", title: "Library", onclick: () => s.go("library") },
    mi("video_library"),
    updates,
  );
  const sources = h(
    "button",
    { class: "st-icon-btn", type: "button", "aria-label": "Sources and qualification", title: "Sources", onclick: () => s.go("sources") },
    mi("dns"),
  );
  const toast = h("div", { class: "st-toast", role: "status", "aria-live": "polite" });
  const el = h(
    "div",
    { class: "st" },
    h("a", { class: "st-skip", href: "#st-main", onclick: (e: Event) => (e.preventDefault(), main.focus()) }, "Skip to content"),
    h(
      "header",
      { class: "st-bar" },
      h("div", { class: "st-brand" }, mi("storefront"), h("span", {}, "Store")),
      tabs,
      searchBox,
      h("div", { class: "st-bar-actions" }, library, sources),
    ),
    main,
    toast,
  );
  let timer = 0;
  return {
    el,
    main,
    sync() {
      for (const [id, b] of tabButtons) {
        const on = ["home", "collection", "app"].includes(s.state.view) && id === s.state.tab;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
        b.classList.toggle("on", on);
      }
      const n = s.catalog.apps.filter((a) => s.updatable(a)).length;
      updates.hidden = !n;
      updates.textContent = String(n);
      library.classList.toggle("on", s.state.view === "library");
      sources.classList.toggle("on", s.state.view === "sources");
    },
    toast(text: string) {
      toast.textContent = text;
      toast.classList.add("show");
      clearTimeout(timer);
      timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
    },
  };
}
