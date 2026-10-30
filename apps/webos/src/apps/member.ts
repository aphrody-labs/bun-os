// SPDX-License-Identifier: Apache-2.0
// Member window: one apps/ member of the monorepo that does not run inside a browser tab. It shows what the
// member really offers here: why it runs elsewhere, its in-browser counterpart, its published builds on the
// downloads service (/api/downloads), its README and its source. Nothing is simulated.
import { h } from "../dom";
import { appPath, sourceUrl, type MemberKind } from "../config";
import type { CatalogApp } from "../os";
import { renderMarkdown } from "../markdown";

/** Why a member of this kind runs outside the browser, in one sentence. */
const REASON: Record<MemberKind, string> = {
  web: "A browser app: the WebOS factory packages its build into the registry, and it opens here directly whenever that package is present.",
  native:
    "A native desktop application: it draws with the operating system's windows and GPU and reads your disks directly, which a browser tab cannot do. Install it from a published build or build it from source.",
  cli: "A command-line tool: it runs in a terminal on Linux, Windows or macOS, outside the browser.",
  server:
    "A server application: it runs as a network service with its own backend, so a static browser tab cannot host it. Its documentation, published builds and source are here.",
  android: "An Android application: it installs on an Android device.",
  library: "A library used by other apps: it has no window of its own.",
  example: "A developer example: read it here and run it locally with Bun.",
};

const KIND_LABEL: Record<MemberKind, string> = {
  web: "Browser app",
  native: "Desktop app",
  cli: "Command line",
  server: "Server",
  android: "Android",
  library: "Library",
  example: "Example",
};

export const memberKindLabel = (kind: MemberKind) => KIND_LABEL[kind];

interface Artifact {
  name: string;
  version: string;
  platform: string;
  kind?: string;
  url: string;
  sha256: string;
  size: number;
}

const size = (n: number) =>
  n > 1e9
    ? `${(n / 1e9).toFixed(1)} GB`
    : n > 1e6
      ? `${(n / 1e6).toFixed(1)} MB`
      : `${Math.max(1, Math.round(n / 1e3))} KB`;

export interface MemberOptions {
  /** Open a desktop app, package or member by id. */
  open(id: string): void;
  /** Display name of a desktop app, package or member id. */
  label(id: string): string;
  /** Shown first when the member was asked for but its browser build is missing from this deployment. */
  missing?: string;
}

export async function memberApp(
  root: HTMLElement,
  member: CatalogApp,
  options: MemberOptions,
) {
  const downloads = h(
    "div",
    { class: "store-list" },
    h("div", { class: "muted" }, "Looking for published builds…"),
  );
  const readme = h("article", { class: "docs-view member-readme" });
  const actions = h("div", { class: "sact" });
  if (member.related) {
    const target = member.related;
    actions.append(
      h(
        "button",
        { class: "btn", onclick: () => options.open(target) },
        `Open ${options.label(target)}`,
      ),
    );
  }
  actions.append(
    h(
      "button",
      {
        class: "btn tonal",
        onclick: () =>
          window.open(sourceUrl(`apps/${member.id}`), "_blank", "noopener"),
      },
      "Source",
    ),
  );
  const path = appPath(`src:${member.id}`);
  root.append(
    h(
      "div",
      { class: "store member" },
      h(
        "header",
        { class: "catalog-intro" },
        h("h1", {}, member.id),
        h("p", {}, member.d || "No description in its manifest."),
        h(
          "div",
          { class: "sact" },
          h("span", { class: "chip" }, KIND_LABEL[member.run]),
          path ? h("span", { class: "muted mono" }, path) : null,
        ),
      ),
      options.missing
        ? h("p", { class: "pkg-status err", role: "status" }, options.missing)
        : null,
      h("p", {}, REASON[member.run]),
      actions,
      h("h3", {}, "Published builds"),
      downloads,
      member.readme ? h("h3", {}, "README") : null,
      member.readme ? readme : null,
    ),
  );

  const names = new Set(
    [member.id, member.artifact].filter(Boolean) as string[],
  );
  const listing = fetch("/api/downloads").then(async (response) => {
    const body = (await response.json()) as {
      available?: boolean;
      error?: string;
      release?: string;
      artifacts?: Artifact[];
    };
    if (!response.ok || !body.available || !body.artifacts)
      throw new Error(body.error ?? `HTTP ${response.status}`);
    return body as { release: string | null; artifacts: Artifact[] };
  });
  const text = member.readme
    ? fetch(`/readme/${encodeURIComponent(member.id)}.md`).then((r) =>
        r.ok ? r.text() : "",
      )
    : Promise.resolve("");
  const [list, md] = await Promise.allSettled([listing, text]);
  if (list.status === "rejected") {
    downloads.replaceChildren(
      h(
        "div",
        { class: "muted" },
        `The downloads service is unavailable: ${String((list.reason as Error).message ?? list.reason)}`,
      ),
    );
  } else {
    const mine = list.value.artifacts.filter((a) => names.has(a.name));
    downloads.replaceChildren(
      ...(mine.length
        ? mine.map((a) =>
            h(
              "article",
              { class: "scard" },
              h("div", { class: "sname" }, `${a.name} ${a.version}`),
              h(
                "div",
                { class: "muted" },
                `${a.platform}${a.kind ? ` · ${a.kind}` : ""} · ${size(a.size)}`,
              ),
              h("div", { class: "sdesc mono" }, `sha256 ${a.sha256}`),
              h(
                "div",
                { class: "sact" },
                h(
                  "a",
                  { class: "chip", href: a.url, rel: "noopener", download: "" },
                  "Download",
                ),
              ),
            ),
          )
        : [
            h(
              "div",
              { class: "muted" },
              `Release ${list.value.release ?? "(unnamed)"} publishes no build of ${[...names].join(" or ")}.`,
            ),
          ]),
    );
  }
  if (member.readme) {
    if (md.status === "fulfilled" && md.value)
      readme.innerHTML = renderMarkdown(md.value.replace(/<!--[sS]*?-->/g, ""));
    else
      readme.replaceChildren(
        h("div", { class: "muted" }, "The README could not be loaded."),
      );
  }
}
