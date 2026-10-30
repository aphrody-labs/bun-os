// SPDX-License-Identifier: Apache-2.0
// View table: one entry per screen.
import type { Store, View } from "./core";
import { viewCollection } from "./collection";
import { viewDetail } from "./detail";
import { viewHome } from "./home";
import { viewLibrary } from "./library";
import { viewSearch } from "./search";
import { viewSources } from "./sources";
import { viewNotFound } from "./states";

type ViewFn = (s: Store) => HTMLElement;

export const views: Record<View, ViewFn> = {
  home: viewHome,
  collection: viewCollection,
  search: viewSearch,
  library: viewLibrary,
  sources: viewSources,
  app: viewDetail,
  notfound: viewNotFound,
};
