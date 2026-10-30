// SPDX-License-Identifier: Apache-2.0
/** Bun docs pages of upstream oven-sh/bun, read from the corpus chosen by `resolveBunDocs` (no copy in Aphrody). */
import { join } from "node:path";
import { resolveBunDocs, type ResolveBunDocsOptions } from "./bun-upstream-docs.ts";

export const BUN_DOCUMENTS = [
  {
    title: "Bun documentation index",
    source: "https://bun.com/docs",
    page: "index.mdx",
  },
  {
    title: "Package manager: workspaces",
    source: "https://bun.com/docs/pm/workspaces",
    page: "pm/workspaces.mdx",
  },
  {
    title: "Package manager: catalogs",
    source: "https://bun.com/docs/pm/catalogs",
    page: "pm/catalogs.mdx",
  },
  {
    title: "Package manager: install and release-age policy",
    source: "https://bun.com/docs/pm/cli/install",
    page: "pm/cli/install.mdx",
  },
  {
    title: "Package manager: isolated installs",
    source: "https://bun.com/docs/pm/isolated-installs",
    page: "pm/isolated-installs.mdx",
  },
  {
    title: "Package manager: filtering workspaces",
    source: "https://bun.com/docs/pm/filter",
    page: "pm/filter.mdx",
  },
  {
    title: "Package manager: lockfile",
    source: "https://bun.com/docs/pm/lockfile",
    page: "pm/lockfile.mdx",
  },
  {
    title: "Runtime: native APIs",
    source: "https://bun.com/docs/runtime/bun-apis",
    page: "runtime/bun-apis.mdx",
  },
  {
    title: "Runtime: spawning child processes",
    source: "https://bun.com/docs/runtime/child-process",
    page: "runtime/child-process.mdx",
  },
  {
    title: "Runtime: TOML",
    source: "https://bun.com/docs/runtime/toml",
    page: "runtime/toml.mdx",
  },
  {
    title: "Bundler: standalone executables",
    source: "https://bun.com/docs/bundler/executables",
    page: "bundler/executables.mdx",
  },
] as const;

export interface BunDocMatch {
  title: string;
  source: string;
  score: number;
  excerpt: string;
}

export interface BunDocument {
  title: string;
  source: string;
  page: string;
  content: string;
}

/** The pages of {@link BUN_DOCUMENTS} with their Markdown, from the fork checkout or its versioned download. */
export async function loadBunDocuments(options?: ResolveBunDocsOptions): Promise<BunDocument[]> {
  const { dir } = await resolveBunDocs(options);
  return await Promise.all(
    BUN_DOCUMENTS.map(async document =>
      Object.assign({}, document, {
        content: await Bun.file(join(dir, document.page)).text(),
      }),
    ),
  );
}

/** Search the documented pages without network access once the corpus is local. */
export async function searchBunDocs(query: string, limit = 5, options?: ResolveBunDocsOptions): Promise<BunDocMatch[]> {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return (await loadBunDocuments(options))
    .flatMap(document => {
      const title = document.title.toLocaleLowerCase();
      const lines = document.content.split(/\r?\n/);
      let best = { score: 0, excerpt: "" };
      for (const line of lines) {
        const normalized = line.toLocaleLowerCase();
        const score = terms.reduce(
          (total, term) => total + (normalized.includes(term) ? 2 : 0) + (title.includes(term) ? 1 : 0),
          0,
        );
        if (score > best.score) best = { score, excerpt: line.trim().slice(0, 320) };
      }
      return best.score > 0 ? [{ title: document.title, source: document.source, ...best }] : [];
    })
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit);
}
