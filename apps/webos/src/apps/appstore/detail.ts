// SPDX-License-Identifier: Apache-2.0
// S05 App detail: header, fact strip, install group, about, permissions, requirements, versions,
// ratings (none yet: no reviews are collected), similar apps. Only fields present in the catalog are shown.
import { h } from "../../dom";
import type { StoreApp } from "../../../store/types";
import { cap, fmt, mi, type Store } from "./core";
import { installGroup, stickyBar } from "./install";
import { badge, iconTile, shelf } from "./parts";
import { emptyState } from "./states";

const REQUIRES: Record<string, string> = {
  bunos: "A browser with WebAssembly and Cache Storage. Works offline after the first launch.",
  pacman: "An x86_64 Arch-family system with the aphrody repository enabled (see Sources).",
  arch: "An x86_64 Arch, CachyOS, Omarchy or ChimeraOS system; the package comes from its upstream repository.",
  apk: "An x86_64 Alpine 3.22 system with the aphrody repository and its signing key (see Sources).",
  flatpak: "Flatpak with the aphrody remote added; the launcher opens the web app in your default browser.",
  npm: "Bun (or another npm-compatible client) with the @aphrody scope pointing at this registry.",
  cargo: "Cargo with the aphrody sparse registry configured (see Sources).",
  android: "An Android device; install the APK after checking its SHA-256.",
};

function expandable(text: string) {
  const p = h("p", { class: "st-desc clamp" }, text);
  const out = h("div", {}, p);
  if (text.length > 280)
    out.append(
      h("button", { class: "st-link", type: "button", "aria-expanded": "false", onclick: (e: Event) => {
        const open = p.classList.toggle("clamp") === false;
        (e.currentTarget as HTMLElement).textContent = open ? "Show less" : "Read more";
        (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(open));
      } }, "Read more"),
    );
  return out;
}

export function viewDetail(s: Store): HTMLElement {
  const a = s.byId.get(s.state.appId);
  if (!a) return emptyState("This app is not in the catalog", "It may have been removed or renamed.", { label: "Back to Home", run: () => s.go("home", { tab: "home" }) });
  const q = s.qualified(a);
  const inst = s.installedVersion(a);
  const facts: [string, string][] = ([
    ["Version", a.version],
    ["Size", fmt(a.size)],
    ["License", a.license ?? ""],
    ["Source", s.sourceLabel(a.source)],
    ["Package", a.pkg],
  ] as [string, string][]).filter(([, v]) => v);
  const page = h(
    "article",
    { class: "st-detail", "aria-labelledby": "st-detail-title" },
    h("button", { class: "st-link st-back", type: "button", onclick: () => s.back() }, mi("arrow_back"), "Back"),
    h(
      "header",
      { class: "st-detail-head" },
      iconTile(a, true),
      h(
        "div",
        { class: "st-detail-title" },
        h("h1", { id: "st-detail-title" }, a.name),
        h(
          "div",
          { class: "st-meta" },
          badge(s.sourceLabel(a.source)),
          badge(s.categoryLabel(a.category)),
          q === true ? badge("Install-tested", "ok") : q === false ? badge("Install test failed", "err") : null,
          inst ? badge(`Installed v${inst}`, "ok") : null,
        ),
        h("p", { class: "st-lead" }, a.summary),
      ),
    ),
    h("dl", { class: "st-facts" }, ...facts.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))),
    installGroup(s, a),
  );
  const side = h("div", { class: "st-detail-side" });
  const main = h("div", { class: "st-detail-main" });
  if (a.screenshots?.length)
    main.append(h("section", { "aria-label": "Screenshots" }, h("div", { class: "st-shots" }, ...a.screenshots.map((src) => h("img", { src, alt: `${a.name} screenshot`, loading: "lazy" })))));
  main.append(h("section", {}, h("h2", {}, "About this app"), expandable(a.description || a.summary)));
  if (a.permissions?.length) main.append(h("section", {}, h("h2", {}, "What it uses"), h("ul", { class: "st-perms" }, ...a.permissions.map((p) => h("li", {}, mi("check_circle"), p)))));
  main.append(
    h(
      "section",
      { class: "st-ratings" },
      h("h2", {}, "Ratings and reviews"),
      h("p", { class: "st-note" }, "No ratings yet. Bun OS does not collect reviews; version, size, license and install-test results above are measured from the repositories."),
    ),
  );
  side.append(
    h("section", {}, h("h2", {}, "Requirements"), h("p", { class: "st-note" }, REQUIRES[a.source] ?? "")),
  );
  if (a.versions?.length)
    side.append(
      h(
        "section",
        {},
        h("h2", {}, "Versions"),
        h(
          "table",
          { class: "st-table" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Version"), h("th", { scope: "col" }, "Size"), h("th", { scope: "col" }, "Date"))),
          h("tbody", {}, ...a.versions.map((v) => h("tr", {}, h("td", {}, v.version), h("td", {}, fmt(v.size)), h("td", {}, v.date?.slice(0, 10) ?? "")))),
        ),
      ),
    );
  const links: Node[] = [];
  if (a.homepage) links.push(h("a", { href: a.homepage, target: "_blank", rel: "noopener noreferrer" }, a.homepage.startsWith("/inventory") ? "Open in the Bun OS inventory" : "Homepage"));
  if (a.member?.path) links.push(h("span", { class: "st-note" }, `Source: ${a.member.path}`));
  if (links.length) side.append(h("section", {}, h("h2", {}, "More"), h("div", { class: "st-links" }, ...links)));
  page.append(h("div", { class: "st-detail-cols" }, main, side));
  const similar = s.catalog.apps
    .filter((x) => x.id !== a.id && !x.unavailable && (x.category === a.category || (a.member && x.member?.kind === a.member.kind && x.source === a.source)))
    .sort((x, y) => Number(y.source === a.source) - Number(x.source === a.source))
    .slice(0, 10);
  page.append(shelf(s, `More in ${cap(s.categoryLabel(a.category))}`, similar) ?? "");
  page.append(stickyBar(s, a));
  return page;
}
