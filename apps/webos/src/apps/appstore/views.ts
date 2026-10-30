// SPDX-License-Identifier: Apache-2.0
// View table: one entry per screen.
import { h } from "../../dom";
import type { Store, View } from "./core";
import { grid } from "./parts";
import { emptyState } from "./states";

type ViewFn = (s: Store) => HTMLElement;
/** Plain catalog grid; screens replace their entry as they are built. */
const basic: ViewFn = (s) => {
  const q = s.state.query.toLowerCase();
  const apps = s.catalog.apps.filter((a) => (!s.state.category || a.category === s.state.category) && (!q || `${a.name} ${a.summary}`.toLowerCase().includes(q)));
  return apps.length ? h("div", {}, grid(s, apps.slice(0, 200))) : emptyState("Nothing here", "No app matches.");
};

export const views: Record<View, ViewFn> = {
  home: basic,
  collection: basic,
  search: basic,
  library: basic,
  sources: basic,
  app: basic,
  notfound: basic,
};
