// SPDX-License-Identifier: Apache-2.0
// S09 States: loading skeleton, empty, error with retry.
import { h } from "../../dom";
import { mi } from "./core";

/** Skeleton placeholders shaped like the screen that is loading (no animation under prefers-reduced-motion). */
export function skeleton(kind: "home" | "list" | "detail") {
  const block = (cls: string) => h("span", { class: `st-sk ${cls}` });
  const tiles = (n: number) => h("div", { class: "st-grid" }, ...Array.from({ length: n }, () => h("div", { class: "st-tile st-sk-tile" }, block("ic"), h("span", { class: "st-tile-text" }, block("l1"), block("l2"), block("l3")))));
  const body =
    kind === "detail"
      ? [h("div", { class: "st-sk-head" }, block("ic big"), h("span", { class: "st-tile-text" }, block("l1"), block("l2"))), block("bar"), block("para"), block("para")]
      : kind === "list"
        ? [tiles(8)]
        : [block("hero"), block("h2"), tiles(4), block("h2"), tiles(4)];
  return h("div", { class: "st st-loading", role: "status", "aria-busy": "true", "aria-label": "Loading the Store" }, h("div", { class: "st-main" }, ...body));
}

export function emptyState(title: string, text: string, action?: { label: string; run: () => void }) {
  return h(
    "div",
    { class: "st-state", role: "status" },
    mi("inbox"),
    h("h2", {}, title),
    h("p", { class: "st-note" }, text),
    action ? h("button", { class: "btn tonal", type: "button", onclick: action.run }, action.label) : null,
  );
}

export function errorState(title: string, detail: string, retry: () => void) {
  return h(
    "div",
    { class: "st-state err", role: "alert" },
    mi("error"),
    h("h2", {}, title),
    h("p", { class: "st-note" }, detail),
    h("button", { class: "btn", type: "button", onclick: retry }, "Try again"),
  );
}
