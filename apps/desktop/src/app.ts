import "@aphrody/tauri-theme/boot";
import { bunFetch } from "@aphrody/tauri/bun";
import type { Catalog, Inspection, Library } from "../shared.ts";

declare const __APHRODY_CATALOG__: Catalog;

type Category = "all" | "image" | "design" | "motion" | "audio" | "documents" | "shared";
const categories: { id: Category; title: string; path: string }[] = [
  {
    id: "all",
    title: "All libraries",
    path: "M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z",
  },
  {
    id: "image",
    title: "Images and photos",
    path: "M3 4h18v16H3zM3 16l5-5 4 4 4-6 5 7M7 8h.01",
  },
  {
    id: "design",
    title: "Design and geometry",
    path: "m5 16 11-11 3 3L8 19l-5 2zM13 8l3 3M4 4h5M4 4v5",
  },
  {
    id: "motion",
    title: "Video and compositing",
    path: "M3 7h18v13H3zM3 3h18v4H3zM7 3l3 4m4-4 3 4m-7 5 5 3-5 3z",
  },
  {
    id: "audio",
    title: "Audio",
    path: "M9 18V5l11-2v13M9 8l11-2M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3zm11-2a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3z",
  },
  {
    id: "documents",
    title: "Documents and tables",
    path: "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6",
  },
  {
    id: "shared",
    title: "Shared resources",
    path: "M4 4h16v5H4zm0 11h16v5H4zM8 9v6m8-6v6",
  },
];
const libraryCategories: Record<string, Category> = {
  artcraft: "design",
  photocraft: "image",
  lightcraft: "image",
  vectorcraft: "design",
  designcraft: "design",
  cadcraft: "design",
  figcraft: "design",
  filmcraft: "motion",
  effectcraft: "motion",
  soundcraft: "audio",
  pdfcraft: "documents",
  wordcraft: "documents",
  gridcraft: "documents",
  deckcraft: "documents",
  "craft-libs": "shared",
  "craft-fonts": "shared",
};

let catalog = __APHRODY_CATALOG__;
let selected: Category = "all";
let query = "";
let connected = false;
let refreshing = false;
let poll: ReturnType<typeof setTimeout> | undefined;

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("Missing element: " + id);
  return node as T;
}
function svg(path: string): SVGSVGElement {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const drawing = document.createElementNS(icon.namespaceURI, "path");
  drawing.setAttribute("d", path);
  icon.append(drawing);
  return icon;
}
function category(library: Library): Category {
  return libraryCategories[library.id] ?? "shared";
}
function latest(id: string): Inspection | undefined {
  return catalog.inspections.findLast(item => item.libraryId === id);
}
function notify(message: string, error = false) {
  const node = element("notification");
  node.textContent = message;
  node.classList.toggle("error", error);
  node.hidden = false;
}
async function request(path: string, method = "GET", body?: unknown): Promise<Response> {
  const init = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(catalog.session ? { "X-Aphrody-Session": catalog.session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  return "__TAURI_INTERNALS__" in window ? bunFetch(path, init) : fetch(path, init);
}
async function inspect(library: Library) {
  notify("Inspecting " + library.title + " CLI…");
  try {
    const response = await request("/api/inspect", "POST", { id: library.id });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "CLI inspection failed.");
    catalog.inspections.push(result as Inspection);
    render();
    schedulePoll();
  } catch (error) {
    notify(error instanceof Error ? error.message : "CLI inspection failed.", true);
  }
}
function inspectButton(library: Library): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "launch-button";
  const running = latest(library.id)?.state === "running";
  button.textContent = running ? "Inspecting" : "Inspect CLI";
  button.setAttribute("aria-label", (running ? "Inspecting " : "Inspect ") + library.title + " CLI");
  button.disabled = !connected || !library.inspectable || running;
  button.title = !connected
    ? "The local service is disconnected."
    : !library.inspectable
      ? "No headless CLI is configured."
      : "Inspect the headless CLI; native compilation may be required.";
  button.addEventListener("click", () => void inspect(library));
  return button;
}
function libraryIcon(library: Library): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "app-icon icon-" + category(library);
  node.setAttribute("aria-hidden", "true");
  node.append(svg(categories.find(item => item.id === category(library))!.path));
  return node;
}
function libraryState(library: Library): string {
  if (latest(library.id)?.state === "running") return "Inspecting";
  if (!library.initialized) return "Source unavailable";
  if (library.priority) return "Priority";
  return library.inspectable ? "CLI available" : "Library source";
}
function card(library: Library): HTMLElement {
  const node = document.createElement("article");
  node.className = "app-card";
  const top = document.createElement("div");
  top.className = "card-top";
  top.append(libraryIcon(library));
  const status = document.createElement("span");
  status.className = "app-state";
  status.textContent = libraryState(library);
  top.append(status);
  const title = document.createElement("h3");
  title.textContent = library.title;
  const description = document.createElement("p");
  description.className = "description";
  description.textContent = library.description;
  const bottom = document.createElement("div");
  bottom.className = "card-bottom";
  const license = document.createElement("span");
  license.textContent = "Open source";
  license.title = library.license;
  bottom.append(license, inspectButton(library));
  node.append(top, title, description, bottom);
  if (!library.inspectable && library.inspectReason) {
    const reason = document.createElement("p");
    reason.className = "launch-reason";
    reason.textContent = library.inspectReason;
    node.append(reason);
  }
  return node;
}
function render() {
  const navigation = element("categories");
  navigation.replaceChildren(
    ...categories.map(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = item.id === selected ? "nav-item active" : "nav-item";
      button.setAttribute("aria-pressed", String(item.id === selected));
      button.setAttribute("aria-label", item.title);
      button.title = item.title;
      button.append(svg(item.path), document.createTextNode(item.title));
      button.addEventListener("click", () => {
        selected = item.id;
        render();
      });
      return button;
    }),
  );
  const matches = catalog.libraries.filter(
    library =>
      (selected === "all" || category(library) === selected) &&
      (library.title + " " + library.description).toLocaleLowerCase("en").includes(query),
  );
  element("apps").replaceChildren(...matches.map(card));
  element("library-title").textContent = categories.find(item => item.id === selected)!.title;
  element("count").textContent = matches.length + (matches.length === 1 ? " library" : " libraries");
  element("empty").hidden = matches.length > 0;
  const featured = element("featured");
  featured.hidden = selected !== "all" || Boolean(query);
  if (!featured.hidden) {
    const copy = document.createElement("div");
    copy.className = "featured-copy";
    const title = document.createElement("h2");
    title.textContent = "Aphrody";
    const description = document.createElement("p");
    description.textContent = catalog.video?.nativeAvailable
      ? "Video first. Native media and exact timelines."
      : "Video first. Native Bun video is not available in this binary.";
    copy.append(title, description);
    const mark = document.createElement("div");
    mark.className = "featured-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "a";
    featured.replaceChildren(copy, mark);
  }
  element("runtime").textContent = connected ? "Local service connected" : "Local catalog";
  element("footer-runtime").textContent = "Bun " + catalog.runtime.version;
}
function schedulePoll() {
  if (poll) clearTimeout(poll);
  if (catalog.inspections.some(item => item.state === "running")) poll = setTimeout(() => void refresh(true), 1500);
}
async function refresh(quiet = false) {
  if (refreshing) return;
  refreshing = true;
  const button = element<HTMLButtonElement>("refresh");
  button.disabled = true;
  try {
    const response = await request("/api/catalog");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Catalog unavailable.");
    const previous = catalog.inspections;
    catalog = result as Catalog;
    connected = true;
    for (const inspection of catalog.inspections) {
      if (previous.find(item => item.id === inspection.id)?.state === "running" && inspection.state !== "running") {
        const title = catalog.libraries.find(library => library.id === inspection.libraryId)?.title ?? "Library";
        notify(
          inspection.state === "completed"
            ? title + ": CLI inspection completed."
            : title +
                ": CLI inspection failed" +
                (inspection.exitCode === undefined ? "." : " (exit " + inspection.exitCode + ")."),
          inspection.state === "failed",
        );
      }
    }
  } catch (error) {
    connected = false;
    if (!quiet) notify(error instanceof Error ? error.message : "Catalog unavailable.", true);
  } finally {
    refreshing = false;
    button.disabled = false;
    render();
    schedulePoll();
  }
}
element<HTMLInputElement>("search").addEventListener("input", event => {
  query = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase("en");
  render();
});
element("refresh").addEventListener("click", () => void refresh());
render();
void refresh();
