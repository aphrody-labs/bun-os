// SPDX-License-Identifier: Apache-2.0
// S04 Search (field; suggestions and results screen are completed in the S04 commit).
import { h } from "../../dom";
import { mi, type Store } from "./core";

export function searchBox(s: Store): HTMLElement {
  const input = h("input", { class: "st-search", type: "search", placeholder: "Search apps, packages and crates", "aria-label": "Search the Store", autocomplete: "off" }) as HTMLInputElement;
  input.addEventListener("input", () => {
    const q = input.value;
    if (q.trim()) s.go("search", { query: q, source: "" });
    else if (s.state.view === "search") s.go("home", { query: "" });
  });
  return h("div", { class: "st-searchbox", role: "search" }, mi("search"), input);
}
