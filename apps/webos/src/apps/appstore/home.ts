// SPDX-License-Identifier: Apache-2.0
// S02 Home: hero carousel of real featured members, source chips, shelves per category and source, ranked lists
// from real metrics (size, qualification). No popularity or rating ranking exists, so none is shown.
import { h } from "../../dom";
import type { StoreApp } from "../../../store/types";
import { fmt, mi, type Store, type Tab } from "./core";
import { badge, chips, iconTile, shelf } from "./parts";
import { emptyState } from "./states";

function hero(s: Store, slides: StoreApp[]) {
  let index = 0;
  let timer = 0;
  let playing = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const track = h("div", { class: "st-slides" });
  const dots = h("div", { class: "st-dots", role: "group", "aria-label": "Choose a featured app" });
  for (const [i, a] of slides.entries()) {
    track.append(
      h(
        "article",
        { class: `st-slide src-${a.source}`, role: "group", "aria-roledescription": "slide", "aria-label": `${i + 1} of ${slides.length}: ${a.name}` },
        iconTile(a, true),
        h(
          "div",
          { class: "st-slide-text" },
          h("div", { class: "st-meta" }, badge(s.sourceLabel(a.source)), badge(s.categoryLabel(a.category)), s.qualified(a) ? badge("Install-tested", "ok") : null),
          h("h2", {}, a.name),
          h("p", {}, a.summary),
          h("p", { class: "st-meta" }, [a.version, a.size ? fmt(a.size) : "", a.license].filter(Boolean).join(" · ")),
          h("button", { class: "btn", type: "button", onclick: () => s.open(a) }, "View details"),
        ),
      ),
    );
    dots.append(h("button", { class: "st-dot", type: "button", "aria-label": `Show ${a.name}`, onclick: () => show(i) }));
  }
  const show = (i: number, focus = false) => {
    index = (i + slides.length) % slides.length;
    track.style.transform = `translateX(${index * -100}%)`;
    [...track.children].forEach((c, k) => c.toggleAttribute("inert", k !== index));
    [...dots.children].forEach((d, k) => d.classList.toggle("on", k === index));
    if (focus) (dots.children[index] as HTMLElement).focus();
  };
  const toggle = h("button", { class: "st-icon-btn", type: "button", "aria-label": "Start automatic slide change", onclick: () => setPlaying(!playing) }, mi("play_arrow"));
  const setPlaying = (on: boolean) => {
    playing = on && !reduced;
    clearInterval(timer);
    if (playing) timer = window.setInterval(() => show(index + 1), 6000);
    toggle.setAttribute("aria-label", playing ? "Pause automatic slide change" : "Start automatic slide change");
    toggle.replaceChildren(mi(playing ? "pause" : "play_arrow"));
  };
  const el = h(
    "section",
    { class: "st-hero", role: "region", "aria-roledescription": "carousel", "aria-label": "Featured" },
    h("div", { class: "st-viewport" }, track),
    h(
      "div",
      { class: "st-hero-ctl" },
      h("button", { class: "st-icon-btn", type: "button", "aria-label": "Previous featured app", onclick: () => show(index - 1) }, mi("chevron_left")),
      dots,
      h("button", { class: "st-icon-btn", type: "button", "aria-label": "Next featured app", onclick: () => show(index + 1) }, mi("chevron_right")),
      toggle,
    ),
  );
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      show(index + 1, true);
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      show(index - 1, true);
    }
  });
  el.addEventListener("mouseenter", () => playing && clearInterval(timer));
  el.addEventListener("mouseleave", () => playing && setPlaying(true));
  show(0);
  return el;
}

function ranked(s: Store, title: string, note: string, apps: StoreApp[], metric: (a: StoreApp) => string) {
  if (!apps.length) return null;
  return h(
    "section",
    { class: "st-ranked", "aria-label": title },
    h("h2", {}, title),
    h("p", { class: "st-note" }, note),
    h(
      "ol",
      {},
      ...apps.map((a) =>
        h(
          "li",
          {},
          h(
            "button",
            { class: "st-rank-row", type: "button", onclick: () => s.open(a) },
            iconTile(a),
            h("span", { class: "st-tile-text" }, h("span", { class: "st-name" }, a.name), h("span", { class: "st-meta" }, s.sourceLabel(a.source))),
            h("span", { class: "st-metric" }, metric(a)),
          ),
        ),
      ),
    ),
  );
}

const TAB_OF: Record<string, Tab> = { games: "games", libraries: "libraries", linux: "linux" };

export function viewHome(s: Store): HTMLElement {
  const { catalog } = s;
  if (!catalog.apps.length) return emptyState("The catalog is empty", "No source has published anything yet.");
  const parts: (Node | null)[] = [];
  if (s.offline) parts.push(h("p", { class: "st-banner", role: "status" }, mi("cloud_off"), "The Store catalog is not reachable: showing browser apps only."));
  const featured = catalog.featured.map((id) => s.byId.get(id)).filter((a): a is StoreApp => !!a);
  const slides = featured.length ? featured : catalog.apps.filter((a) => a.source === "bunos" && !a.unavailable).slice(0, 6);
  if (slides.length) parts.push(hero(s, slides.slice(0, 8)));
  parts.push(
    chips("Browse by source", [{ id: "", label: "All sources" }, ...catalog.sources.filter((x) => x.count).map((x) => ({ id: x.id, label: `${x.label} (${x.count})` }))], "", (id) =>
      s.go("collection", { source: id, category: "", tab: "apps" }),
    ),
  );
  const installable = catalog.apps.filter((a) => !a.unavailable);
  for (const c of catalog.categories)
    parts.push(
      shelf(
        s,
        c.label,
        installable.filter((a) => a.category === c.id),
        { more: () => s.go("collection", { category: c.id, source: "", tab: TAB_OF[c.id] ?? "apps" }), note: `${c.count} in catalog` },
      ),
    );
  const sized = installable.filter((a) => a.size).sort((x, y) => y.size! - x.size!).slice(0, 8);
  const tested = installable.filter((a) => s.qualified(a) === true && a.source !== "arch").slice(0, 8);
  const lists = [
    ranked(s, "Largest downloads", "Ordered by package size; this is not a popularity chart.", sized, (a) => fmt(a.size)),
    ranked(s, "Install-tested", "Packages whose source passed the last install test in a clean container.", tested, (a) => s.sourceLabel(a.source)),
  ].filter(Boolean) as Node[];
  if (lists.length) parts.push(h("div", { class: "st-lists" }, ...lists));
  return h("div", { class: "st-home" }, ...parts);
}
