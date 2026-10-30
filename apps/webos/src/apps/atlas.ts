// SPDX-License-Identifier: Apache-2.0
// Atlas: the window onto the whole Bun OS inventory (/api/inventory). Every member of the repository (apps, packages,
// crates, docs, factory, engines, games, tools, infra, releases, sources, root entries, collections) has a page here:
// README or document rendered, metadata, versions and registry links, the desktop app that runs it, published
// downloads, WebAssembly status and the JSON of the member. Nothing is simulated; what cannot run in a browser says so.
import { h } from "../dom";
import { KIND_IDS, KINDS, SURFACE_LABEL, type Kind, type SurfaceType } from "../inventory-kinds";
import { renderMarkdown } from "./docs";

export interface InvMember {
  kind: Kind;
  id: string;
  name: string;
  desc: string;
  path?: string;
  version?: string;
  license?: string;
  run?: string;
  tags: string[];
  links: { label: string; url: string }[];
  surface: {
    type: SurfaceType;
    page: string;
    api: string;
    opens?: string;
    module?: string;
    reason: string;
  };
  readme?: boolean;
  meta?: Record<string, unknown>;
}
interface InvDetail extends InvMember {
  readme?: string;
  text?: string;
  lang?: string;
  files?: string[];
  members?: string[];
  data?: unknown;
}
export interface InvIndex {
  generated: string;
  commit: string;
  counts: Record<Kind, number>;
  total: number;
  members: InvMember[];
}

let indexPromise: Promise<InvIndex> | undefined;
/** The whole inventory index, fetched once. */
export function inventory(): Promise<InvIndex> {
  indexPromise ??= fetch("/api/inventory")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<InvIndex>;
    })
    .catch((error) => {
      indexPromise = undefined;
      throw error;
    });
  return indexPromise;
}

const encodeId = (id: string) => id.split("/").map(encodeURIComponent).join("/");
/** Deep-link path of a member: /inventory/<kind>/<id>. */
export const inventoryPath = (kind: string, id?: string) =>
  `/inventory/${kind}${id ? `/${encodeId(id)}` : ""}`;
/** Window id of a member or kind: inv:<kind>[/<id>]. */
export const inventoryWindowId = (kind: string, id?: string) =>
  `inv:${kind}${id ? `/${id}` : ""}`;
export function parseInventoryId(
  windowId: string,
): { kind: Kind; id?: string } | undefined {
  if (!windowId.startsWith("inv:")) return undefined;
  const rest = windowId.slice(4);
  const slash = rest.indexOf("/");
  const kind = (slash < 0 ? rest : rest.slice(0, slash)) as Kind;
  if (!(kind in KINDS)) return undefined;
  return { kind, id: slash < 0 ? undefined : rest.slice(slash + 1) };
}

interface Artifact {
  name: string;
  version: string;
  platform: string;
  kind?: string;
  url: string;
  sha256: string;
  size: number;
}
const bytes = (n: number) =>
  n > 1e9
    ? `${(n / 1e9).toFixed(1)} GB`
    : n > 1e6
      ? `${(n / 1e6).toFixed(1)} MB`
      : `${Math.max(1, Math.round(n / 1e3))} KB`;

export interface AtlasHost {
  /** Open a desktop app, package or member by id; false when this deployment has none. */
  open(id: string): boolean;
  /** Open the member in its own window. */
  openMember(kind: Kind, id: string): void;
  /** Open an external or same-origin URL in a new tab. */
  openUrl(url: string): void;
}

/** One member's page: used inside the Atlas and as the content of a member window. */
export async function memberPage(
  root: HTMLElement,
  kind: Kind,
  id: string,
  host: AtlasHost,
) {
  root.replaceChildren(h("div", { class: "muted pad" }, "Loading…"));
  let detail: InvDetail;
  try {
    const res = await fetch(`/api/inventory/${kind}/${encodeId(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    detail = (await res.json()) as InvDetail;
  } catch (error) {
    root.replaceChildren(
      h(
        "div",
        { class: "pkg-status err pad", role: "status" },
        `This member could not be loaded: ${String((error as Error).message ?? error)}`,
      ),
    );
    return;
  }
  const s = detail.surface;
  const actions = h("div", { class: "sact" });
  if (s.opens)
    actions.append(
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            if (!host.open(s.opens!)) host.openUrl(s.page);
          },
        },
        `Open ${s.opens}`,
      ),
    );
  for (const link of detail.links)
    actions.append(
      h(
        "button",
        { class: "btn tonal", onclick: () => host.openUrl(link.url) },
        link.label,
      ),
    );
  actions.append(
    h("button", { class: "btn tonal", onclick: () => host.openUrl(s.api) }, "JSON"),
  );
  const body = h("div", { class: "atlas-body" });
  root.replaceChildren(
    h(
      "article",
      { class: "atlas-detail" },
      h(
        "header",
        { class: "catalog-intro" },
        h("h1", {}, detail.name),
        h("p", {}, detail.desc),
        h(
          "div",
          { class: "sact" },
          h("span", { class: "chip" }, KINDS[detail.kind].label),
          h("span", { class: "chip" }, SURFACE_LABEL[s.type]),
          detail.run ? h("span", { class: "chip" }, detail.run) : null,
          detail.version ? h("span", { class: "chip" }, `v${detail.version}`) : null,
          detail.license ? h("span", { class: "chip" }, detail.license) : null,
          ...detail.tags.slice(0, 6).map((t) => h("span", { class: "chip" }, t)),
        ),
      ),
      h("p", { class: "muted" }, s.reason),
      detail.path ? h("p", { class: "muted mono" }, detail.path) : null,
      actions,
      body,
    ),
  );

  if (s.type === "download" || (detail.kind === "apps" && !s.opens)) {
    const list = h(
      "div",
      { class: "store-list" },
      h("div", { class: "muted" }, "Looking for published builds…"),
    );
    body.append(h("h3", {}, "Published builds"), list);
    const names = new Set(
      [detail.id, detail.meta?.artifact as string | undefined].filter(
        Boolean,
      ) as string[],
    );
    void fetch("/api/downloads")
      .then(
        async (r) =>
          (await r.json()) as {
            available?: boolean;
            error?: string;
            release?: string;
            artifacts?: Artifact[];
          },
      )
      .then((d) => {
        if (!d.available || !d.artifacts) throw new Error(d.error ?? "unavailable");
        const mine =
          detail.id === "downloads"
            ? d.artifacts
            : d.artifacts.filter((a) => names.has(a.name));
        list.replaceChildren(
          ...(mine.length
            ? mine.map((a) =>
                h(
                  "article",
                  { class: "scard" },
                  h("div", { class: "sname" }, `${a.name} ${a.version}`),
                  h(
                    "div",
                    { class: "muted" },
                    `${a.platform}${a.kind ? ` · ${a.kind}` : ""} · ${bytes(a.size)}`,
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
                  `Release ${d.release ?? "(unnamed)"} publishes no build of ${[...names].join(" or ")}; this page, its README and its source are the surface until it does.`,
                ),
              ]),
        );
      })
      .catch((error) =>
        list.replaceChildren(
          h(
            "div",
            { class: "muted" },
            `The downloads service is unavailable: ${String(error.message ?? error)}`,
          ),
        ),
      );
  }
  if (s.type === "wasm")
    body.append(
      h("h3", {}, "WebAssembly"),
      h(
        "p",
        {},
        s.module
          ? `Module served at ${s.module}.`
          : "This crate can target WebAssembly; the factory has not published a module for it in this deployment, so this page offers its metadata, README and API instead.",
      ),
    );
  if (detail.kind === "crates" || detail.kind === "packages") {
    const m = detail.meta ?? {};
    const rows: [string, string][] = [
      ["Package", String(m.crateName ?? m.npm ?? detail.name)],
      ["Version", detail.version ?? "unversioned"],
      [
        "Registry",
        detail.tags.includes("crates.io") || m.npm
          ? "published or publishable"
          : "not published",
      ],
    ];
    if (m.dependencies !== undefined)
      rows.push(["Dependencies", String(m.dependencies)]);
    if (m.files !== undefined) rows.push(["Files", String(m.files)]);
    body.append(
      h("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    );
  }
  if (detail.members?.length) {
    body.append(h("h3", {}, `Members (${detail.members.length})`));
    const list = h("div", { class: "atlas-members" });
    for (const ref of detail.members) {
      const slash = ref.indexOf("/");
      const k = ref.slice(0, slash) as Kind;
      const i = ref.slice(slash + 1);
      list.append(
        h(
          "button",
          { class: "docs-link", onclick: () => host.openMember(k, i) },
          `${KINDS[k]?.label ?? k}: ${i}`,
        ),
      );
    }
    body.append(list);
  }
  if (detail.readme !== undefined) {
    body.append(h("h3", {}, "Document"));
    const doc = h("div", { class: "docs-view member-readme" });
    doc.innerHTML = renderMarkdown(detail.readme.replace(/<!--[\s\S]*?-->/g, ""));
    body.append(doc);
  }
  if (detail.text !== undefined)
    body.append(h("h3", {}, "Content"), h("pre", { class: "atlas-pre" }, detail.text));
  if (detail.data !== undefined)
    body.append(
      h("h3", {}, "Data"),
      h("pre", { class: "atlas-pre" }, JSON.stringify(detail.data, null, 2).slice(0, 60000)),
    );
  if (detail.files?.length)
    body.append(
      h("h3", {}, `Files (${detail.meta?.files ?? detail.files.length})`),
      h("pre", { class: "atlas-pre" }, detail.files.join("\n")),
    );
}

const PAGE = 150;

/** The Atlas window: kinds, search, member list and the member page side by side. */
export async function atlasApp(
  root: HTMLElement,
  host: AtlasHost,
  initial?: { kind?: Kind; id?: string },
) {
  const index = await inventory();
  let kind: Kind | "all" = initial?.kind ?? "apps";
  let query = "";
  let limit = PAGE;
  let selected: string | undefined;
  const search = h("input", {
    class: "fld grow",
    type: "search",
    placeholder: "Search every member of Bun OS",
    "aria-label": "Search inventory",
  });
  const nav = h("nav", { class: "atlas-kinds", "aria-label": "Kinds" });
  const list = h("div", { class: "atlas-list", role: "list" });
  const view = h("section", { class: "atlas-view" });
  const status = h("div", { class: "files-status" });

  const words = (s: string) =>
    s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  function rows(): InvMember[] {
    const pool =
      kind === "all" ? index.members : index.members.filter((m) => m.kind === kind);
    const terms = words(query);
    if (!terms.length) return pool;
    return pool
      .map((m) => {
        const name = m.name.toLowerCase();
        const hay =
          `${name} ${m.id} ${m.desc} ${m.tags.join(" ")} ${m.path ?? ""}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (!hay.includes(t)) return { m, score: -1 };
          score += name === t ? 20 : name.startsWith(t) ? 10 : name.includes(t) ? 5 : 1;
        }
        return { m, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.m);
  }

  function renderNav() {
    nav.replaceChildren(
      ...(["all", ...KIND_IDS] as const).map((k) =>
        h(
          "button",
          {
            class: `docs-link${k === kind ? " sel" : ""}`,
            title: k === "all" ? "Every member" : KINDS[k].desc,
            onclick: () => {
              kind = k;
              limit = PAGE;
              render();
            },
          },
          `${k === "all" ? "All" : KINDS[k].label} · ${k === "all" ? index.total : index.counts[k]}`,
        ),
      ),
    );
  }
  function render() {
    renderNav();
    const items = rows();
    const shown = items.slice(0, limit);
    list.replaceChildren(
      ...shown.map((m) =>
        h(
          "button",
          {
            class: `docs-link atlas-row${selected === `${m.kind}/${m.id}` ? " sel" : ""}`,
            role: "listitem",
            title: m.desc,
            onclick: () => select(m),
            ondblclick: () => host.openMember(m.kind, m.id),
          },
          h("span", { class: "atlas-name" }, m.name),
          h(
            "span",
            { class: "muted atlas-sub" },
            `${kind === "all" ? `${KINDS[m.kind].label} · ` : ""}${SURFACE_LABEL[m.surface.type]}`,
          ),
        ),
      ),
      ...(items.length > shown.length
        ? [
            h(
              "button",
              {
                class: "btn tonal",
                onclick: () => {
                  limit += PAGE * 2;
                  render();
                },
              },
              `Show more (${items.length - shown.length})`,
            ),
          ]
        : []),
    );
    status.textContent = `${items.length} member${items.length === 1 ? "" : "s"} · ${kind === "all" ? "all kinds" : KINDS[kind].label} · commit ${index.commit.slice(0, 9)}`;
  }
  function select(m: InvMember) {
    selected = `${m.kind}/${m.id}`;
    for (const b of list.querySelectorAll(".atlas-row"))
      b.classList.toggle(
        "sel",
        b.querySelector(".atlas-name")?.textContent === m.name,
      );
    void memberPage(view, m.kind, m.id, host);
  }

  search.addEventListener("input", () => {
    query = search.value;
    limit = PAGE;
    render();
  });
  view.append(
    h(
      "div",
      { class: "atlas-intro" },
      h("h2", {}, "Bun OS inventory"),
      h(
        "p",
        {},
        `${index.total} members across ${KIND_IDS.length} kinds. Every one has a page, an API record and a place in search. Pick one to read it, double-click to open it in its own window.`,
      ),
      h(
        "p",
        { class: "muted" },
        "Machine-readable: /api/inventory, /api/apps, /api/packages, /api/crates, /api/docs/<page>, /api/factory, /api/engines, /api/sources.",
      ),
    ),
  );
  root.append(
    h(
      "div",
      { class: "docs atlas" },
      h("div", { class: "files-bar" }, search),
      h("div", { class: "docs-main" }, nav, list, view),
      status,
    ),
  );
  render();
  if (initial?.id) {
    const found = index.members.find(
      (m) => m.kind === initial.kind && m.id === initial.id,
    );
    if (found) select(found);
  }
}
