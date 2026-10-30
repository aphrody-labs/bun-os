// SPDX-License-Identifier: Apache-2.0
// Aphrody Search: /api/search ranks the catalogs and the member inventory this deployment serves (docs, apps, packages,
// crates, factory, engines, tools). Results open as WebOS WebView windows.
import { h } from "../dom";

interface Hit {
  title: string;
  url: string;
  snippet: string;
}

export function searchApp(root: HTMLElement, open: (url: string) => void) {
  const field = h("input", { class: "fld grow", type: "search", "aria-label": "Search", placeholder: "Search Bun OS" }) as HTMLInputElement;
  const results = h("div", { class: "search-results" });
  const status = h("div", { class: "files-status" }, "Search apps, packages, crates, docs and tools.");
  let seq = 0;
  async function run() {
    const q = field.value.trim();
    if (!q) return;
    const n = ++seq;
    status.textContent = "Searching…";
    try {
      const res = await fetch(`/api/search?query=${encodeURIComponent(q)}&num=20`);
      if (!res.ok) throw new Error(`search answered ${res.status}`);
      const body = (await res.json()) as { organic: Hit[]; total: number };
      if (n !== seq) return;
      status.textContent = `${body.total} result${body.total === 1 ? "" : "s"}`;
      results.replaceChildren(
        ...body.organic.map((hit) =>
          h(
            "a",
            {
              class: "search-hit",
              href: new URL(hit.url, location.origin).href,
              onclick: (e: Event) => {
                e.preventDefault();
                open(new URL(hit.url, location.origin).href);
              },
            },
            h("strong", {}, hit.title),
            h("small", {}, hit.url),
            h("span", {}, hit.snippet),
          ),
        ),
      );
    } catch (error) {
      status.textContent = `Search failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  field.addEventListener("keydown", (e) => e.key === "Enter" && void run());
  root.append(h("div", { class: "search" }, h("div", { class: "search-bar" }, field, h("button", { class: "btn", onclick: () => void run() }, "Search")), status, results));
  queueMicrotask(() => field.focus());
}
