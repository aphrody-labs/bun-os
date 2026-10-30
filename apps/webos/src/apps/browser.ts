// SPDX-License-Identifier: Apache-2.0
import { h, icon } from "../dom";
import { APPS, ownHost } from "../config";

const HOME_URL = "aphrody://home";
const SEARCH = APPS.browser.search;
const BOOKMARKS = APPS.browser.bookmarks;

interface Tab {
  title: string;
  url: string;
  past: string[];
  future: string[];
  frame: HTMLIFrameElement;
  view: HTMLElement;
  btn: HTMLElement;
}

export function normalize(input: string): string {
  const text = input.trim();
  if (!text || text.startsWith("aphrody://")) return text || HOME_URL;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text) && !/\s/.test(text)) return `https://${text}`;
  return SEARCH + encodeURIComponent(text);
}

/** Tabbed browser. Pages load through /api/browse: scripts stripped, sandboxed, links routed back here. */
export function browserApp(root: HTMLElement, start?: string, openOwn?: (url: URL) => boolean) {
  const tabs: Tab[] = [];
  let current: Tab | undefined;
  const tabStrip = h("div", { class: "btabs", role: "tablist" });
  const address = h("input", {
    class: "fld grow",
    "aria-label": "Address",
    spellcheck: "false",
    placeholder: "Search or enter address",
  });
  const views = h("div", { class: "bviews" });
  const status = h(
    "div",
    { class: "files-status" },
    "Pages are fetched by the Aphrody edge, scripts removed and sandboxed.",
  );

  const homePage = () =>
    h(
      "div",
      { class: "bhome" },
      h("h2", {}, "Bun Browser"),
      h("p", {}, "Search the web or open a bookmark. Pages render in a script-free sandbox."),
      h(
        "div",
        { class: "bmarks" },
        ...BOOKMARKS.map(([name, url]) => h("button", { class: "chip", onclick: () => navigate(url) }, name)),
      ),
    );

  function show(tab: Tab) {
    current = tab;
    for (const t of tabs) {
      t.view.hidden = t !== tab;
      t.btn.setAttribute("aria-selected", String(t === tab));
    }
    address.value = tab.url === HOME_URL ? "" : tab.url;
  }

  function load(tab: Tab, url: string) {
    tab.url = url;
    if (url === HOME_URL) {
      tab.title = "Start";
      tab.frame.hidden = true;
      tab.view.querySelector(".bhome")?.removeAttribute("hidden");
    } else {
      tab.title = new URL(url).hostname;
      tab.view.querySelector(".bhome")?.setAttribute("hidden", "");
      tab.frame.hidden = false;
      tab.frame.src = `/api/browse?url=${encodeURIComponent(url)}`;
    }
    (tab.btn.firstChild as HTMLElement).textContent = tab.title;
    if (tab === current) address.value = url === HOME_URL ? "" : url;
  }

  function navigate(input: string, tab = current, record = true) {
    if (!tab) return;
    const url = normalize(input);
    // Aphrody hosts refuse framing: an address that is an app of this desktop opens in its own window.
    if (url !== HOME_URL && ownHost(new URL(url).hostname)) {
      if (openOwn?.(new URL(url))) return;
      status.textContent = "This address is an Aphrody app that cannot be framed; open it from the launcher.";
      return;
    }
    if (record && tab.url) {
      tab.past.push(tab.url);
      tab.future.length = 0;
    }
    load(tab, url);
  }

  function newTab(url = HOME_URL) {
    const frame = h("iframe", {
      class: "bframe",
      title: "Page",
      sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox",
      referrerpolicy: "no-referrer",
      hidden: true,
    });
    const view = h("div", { class: "bview" }, homePage(), frame);
    const label = h("span", { class: "btab-label" }, "Start");
    const closeBtn = h(
      "button",
      {
        class: "btab-x",
        "aria-label": "Close tab",
        onclick: (e: Event) => {
          e.stopPropagation();
          closeTab(tab);
        },
      },
      icon("close"),
    );
    const btn = h("div", { class: "btab", role: "tab", tabindex: 0, onclick: () => show(tab) }, label, closeBtn);
    const tab: Tab = { title: "Start", url: "", past: [], future: [], frame, view, btn };
    tabs.push(tab);
    tabStrip.insertBefore(btn, plus);
    views.append(view);
    show(tab);
    navigate(url, tab, false);
  }

  function closeTab(tab: Tab) {
    const i = tabs.indexOf(tab);
    tabs.splice(i, 1);
    tab.btn.remove();
    tab.view.remove();
    if (!tabs.length) newTab();
    else if (tab === current) show(tabs[Math.max(0, i - 1)]!);
  }

  const plus = h(
    "button",
    { class: "tbtn", "aria-label": "New tab", title: "New tab", onclick: () => newTab() },
    icon("plus"),
  );
  const tool = (name: string, label: string, fn: () => void) =>
    h("button", { class: "tbtn", title: label, "aria-label": label, onclick: fn }, icon(name));
  const bar = h(
    "div",
    { class: "files-bar" },
    tool("back", "Back", () => {
      if (!current?.past.length) return;
      current.future.push(current.url);
      load(current, current.past.pop()!);
    }),
    tool("fwd", "Forward", () => {
      if (!current?.future.length) return;
      current.past.push(current.url);
      load(current, current.future.pop()!);
    }),
    tool("reload", "Reload", () => current && load(current, current.url)),
    address,
    tool("globe", "Start page", () => navigate(HOME_URL)),
  );
  address.addEventListener("keydown", e => {
    if (e.key === "Enter") navigate(address.value);
  });

  const onMessage = (e: MessageEvent) => {
    const tab = tabs.find(t => t.frame.contentWindow === e.source);
    const data = e.data as { aph?: string; url?: string; title?: string } | undefined;
    if (!tab || data?.aph !== "nav" || typeof data.url !== "string") return;
    if (data.title === undefined) {
      navigate(data.url, tab);
      return;
    }
    tab.url = data.url;
    tab.title = data.title || new URL(data.url).hostname;
    (tab.btn.firstChild as HTMLElement).textContent = tab.title;
    if (tab === current) address.value = data.url;
  };
  window.addEventListener("message", onMessage);

  tabStrip.append(plus);
  root.append(h("div", { class: "browser" }, tabStrip, bar, views, status));
  newTab(start ?? HOME_URL);
  return () => window.removeEventListener("message", onMessage);
}
