// SPDX-License-Identifier: Apache-2.0
// S07 Library: what is installed (browser installs and agent installs) and what has an update.
import { h } from "../../dom";
import { install } from "../../pkg";
import { mi, type Store } from "./core";
import { chips, grid } from "./parts";
import { emptyState } from "./states";

export function viewLibrary(s: Store): HTMLElement {
  const { catalog, state } = s;
  const have = catalog.apps.filter((a) => s.isInstalled(a));
  const due = catalog.apps.filter((a) => s.updatable(a));
  const out = h(
    "div",
    { class: "st-library" },
    h("h1", {}, "Library"),
    chips(
      "Library view",
      [
        { id: "installed", label: `Installed (${have.length})` },
        { id: "updates", label: `Updates (${due.length})` },
      ],
      state.library,
      (id) => s.go("library", { library: id as "installed" | "updates" }),
    ),
  );
  if (state.library === "updates") {
    if (!due.length) {
      out.append(emptyState("Everything is up to date", have.length ? "Apps installed in your browser match the versions the Store serves." : "Nothing is installed yet, so there is nothing to update.", have.length ? undefined : { label: "Browse apps", run: () => s.go("collection", { tab: "apps", category: "", source: "" }) }));
      return out;
    }
    const status = h("p", { class: "st-note", role: "status", "aria-live": "polite" });
    const all = h(
      "button",
      {
        class: "btn",
        type: "button",
        onclick: async (e: Event) => {
          (e.currentTarget as HTMLButtonElement).disabled = true;
          let n = 0;
          for (const a of due) {
            const reg = a.install.pwa ? s.regById.get(a.install.pwa) : undefined;
            if (!reg) continue;
            try {
              status.textContent = `Updating ${a.name} (${++n} of ${due.length})`;
              await install(reg, () => {});
            } catch (error) {
              status.textContent = `${a.name} failed: ${String((error as Error).message ?? error)}`;
              (e.currentTarget as HTMLButtonElement).disabled = false;
              return;
            }
          }
          s.onChange();
          s.toast(`${n} update${n === 1 ? "" : "s"} installed`);
          s.render();
        },
      },
      mi("update"),
      `Update all (${due.length})`,
    );
    out.append(h("div", { class: "st-toolbar" }, status, all), grid(s, due));
    return out;
  }
  if (!have.length) {
    out.append(emptyState("Nothing installed from the Store yet", "Apps you install in your browser, and packages you install with the Bun OS agent, appear here.", { label: "Browse apps", run: () => s.go("collection", { tab: "apps", category: "", source: "" }) }));
    return out;
  }
  out.append(grid(s, have));
  return out;
}
