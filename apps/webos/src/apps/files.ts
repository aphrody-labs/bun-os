// SPDX-License-Identifier: Apache-2.0
// Files: the explorer of the Web OS. File data comes from the Rust VFS (`os.fs`); libraries, locations,
// volumes, devices, name search and rename go through the explorer wire protocol (`os.rpc`, served by
// crates/aphrody-webos-wasm/src/rpc.rs).
import { ask, h, icon } from "../dom";
import { HOME, webos } from "../os";
import { defaultAppFor } from "../prefs";
import {
  TRASH,
  type Entry,
  base,
  copyTo,
  emptyTrash,
  exists,
  fmtSize,
  inTrash,
  isInside,
  join,
  listDir,
  moveTo,
  parent,
  protectedPath,
  restore,
  trash,
  usage,
} from "./files-ops";
import { type Context, type ContentHit, byPath, call, loadContext, sdPath, searchContents, searchFiles } from "./files-wire";
import {
  craftHostForPath,
  craftHostMaxFileBytes,
  type CraftHostId,
} from "./craft-host";

export interface FilesAppOptions {
  start?: string;
  /** Open a file with the app chosen in Settings (files.openWith); false when that app cannot take it. */
  openWith?: (appId: string, path: string, name: string, bytes: Uint8Array) => boolean;
  openCraft?: (
    id: CraftHostId,
    path: string,
    name: string,
    bytes: Uint8Array,
  ) => boolean;
}

type SortKey = "name" | "size" | "kind";
interface Prefs {
  view: "grid" | "list";
  sort: SortKey;
  desc: boolean;
  hidden: boolean;
  preview: boolean;
}
const PREF_KEY = "aphrody.files.prefs";
const DND = "application/x-aphrody-paths";

const ICON: Record<string, string> = {
  png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", webp: "Image", svg: "Image", bmp: "Image", ico: "Image", avif: "Image",
  mp3: "Audio", wav: "Audio", ogg: "Audio", flac: "Audio", m4a: "Audio", opus: "Audio",
  mp4: "Movie", webm: "Movie", mkv: "Movie", mov: "Movie", ogv: "Movie",
  pdf: "Document_pdf", doc: "Document_doc", docx: "Document_doc", odt: "Document_doc",
  xls: "Document_xls", xlsx: "Document_xls", csv: "Document_xls",
  txt: "Text_txt", md: "Text", json: "Text", toml: "Text", yaml: "Text", yml: "Text", html: "Text", css: "Text",
  ts: "Text", js: "Text", rs: "Text", sh: "Terminal",
  zip: "Archive", tar: "Archive", gz: "Archive", "7z": "Archive", rar: "Archive", xz: "Archive", zst: "Archive",
  exe: "Application", bin: "Application", wasm: "Package", db: "Database", sqlite: "Database",
  nds: "Game", gba: "Game", iso: "Drive",
};
const KIND_LABEL: Record<string, string> = {
  Folder: "Folder", Image: "Image", Audio: "Audio", Movie: "Video", Document_pdf: "PDF", Document_doc: "Document",
  Document_xls: "Spreadsheet", Text_txt: "Text", Text: "Text / code", Terminal: "Script", Archive: "Archive",
  Application: "Application", Package: "Package", Database: "Database", Game: "Game ROM", Drive: "Disk image",
  Document: "File",
};
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", opus: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", mov: "video/quicktime", ogv: "video/ogg",
};
const iconOf = (e: Entry) => (e.kind === "dir" ? "Folder" : (ICON[e.ext] ?? "Document"));
const kindLabel = (e: Entry) => KIND_LABEL[iconOf(e)] ?? "File";
const isMedia = (e: Entry, type: string) => e.kind === "file" && (MIME[e.ext] ?? "").startsWith(type);
const THUMB_MAX = 400_000;

const img = (name: string, size: number) =>
  h("img", { class: "ficon", src: `/icons/${name}.png`, alt: "", width: size, height: size, loading: "lazy", draggable: false });
/** Raw Material Symbols Rounded glyph (icon() only knows the shell vocabulary). */
const sym = (glyph: string) => {
  const s = icon("app");
  s.textContent = glyph;
  return s;
};

function loadPrefs(): Prefs {
  const d: Prefs = { view: "grid", sort: "name", desc: false, hidden: false, preview: false };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return d;
  }
}

/** Shared by every Files window, like the clipboard of a desktop. */
let clip: { paths: string[]; cut: boolean } | undefined;

interface MenuItem {
  label: string;
  glyph: string;
  run: () => void;
  danger?: boolean;
  hint?: string;
}

/**
 * Explorer over the Rust VFS (aphrody-shell-vfs) persisted in OPFS.
 * `openText(path, text)` receives text files opened with Enter or double click.
 */
export async function filesApp(
  root: HTMLElement,
  openText: (path: string, text: string) => void,
  options: FilesAppOptions = {},
) {
  const os = await webos();
  const start = options.start ?? HOME;
  const prefs = loadPrefs();
  let cwd = start;
  const back: string[] = [];
  const fwd: string[] = [];
  let entries: Entry[] = []; // what the pane shows, sorted
  const selected = new Set<string>();
  let anchor: string | undefined;
  let search: { q: string; everywhere: boolean; hits: ContentHit[] } | undefined;
  let ctx: Context | undefined;
  let renaming = false;
  let previewToken = 0;
  let typed = "";
  let typedAt = 0;
  const thumbs = new Map<string, string>();
  const els = new Map<string, HTMLElement>();

  const savePrefs = () => localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  const selEntries = () => entries.filter(e => selected.has(e.path));

  // ---- chrome ---------------------------------------------------------------------------------
  const crumbs = h("div", { class: "fx-crumbs", "aria-label": "Path" });
  const pathInput = h("input", { class: "fld fx-path", "aria-label": "Path", spellcheck: "false", hidden: true });
  const searchInput = h("input", { class: "fld fx-search", type: "search", placeholder: "Search files", "aria-label": "Search files" });
  const scopeBtn = h("button", { class: "fx-chip", title: "Search scope" }, "This folder");
  const pane = h("div", { class: "fx-pane", tabindex: 0, role: "listbox", "aria-multiselectable": true, "aria-label": "Files" });
  const side = h("nav", { class: "fx-side", "aria-label": "Places" });
  const preview = h("aside", { class: "fx-preview", "aria-label": "Preview" });
  const actions = h("div", { class: "fx-actions" });
  const status = h("div", { class: "fx-status" });
  const quota = h("div", { class: "fx-quota", title: "Storage used" });
  const fileInput = h("input", { type: "file", multiple: true, hidden: true });
  const shell = h("div", { class: "fx", tabindex: -1 });

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (msg: string, error = false) => {
    status.classList.toggle("err", error);
    status.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      status.classList.remove("err");
      paintStatus();
    }, error ? 5000 : 2500);
  };
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), true);

  const tbtn = (glyph: string, label: string, fn: (e: Event) => void, extra = "") =>
    h("button", { class: `tbtn ${extra}`.trim(), title: label, "aria-label": label, onclick: fn }, sym(glyph));

  // ---- data -----------------------------------------------------------------------------------
  function sorted(list: Entry[]): Entry[] {
    const dir = prefs.desc ? -1 : 1;
    const by: Record<SortKey, (a: Entry, b: Entry) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      size: (a, b) => a.size - b.size || a.name.localeCompare(b.name),
      kind: (a, b) => kindLabel(a).localeCompare(kindLabel(b)) || a.name.localeCompare(b.name),
    };
    return list.toSorted((a, b) => (a.kind === b.kind ? dir * by[prefs.sort](a, b) : a.kind === "dir" ? -1 : 1));
  }

  function load() {
    for (const url of thumbs.values()) URL.revokeObjectURL(url);
    thumbs.clear();
    const keep = new Set(selected);
    selected.clear();
    if (search) {
      // Results come from the wire; see runSearch().
    } else {
      let list = listDir(os, cwd).filter(e => e.name !== ".origins.json");
      if (!prefs.hidden) list = list.filter(e => !e.name.startsWith("."));
      entries = sorted(list);
    }
    const paths = new Set(entries.map(e => e.path));
    for (const p of keep) if (paths.has(p)) selected.add(p);
    if (anchor && !paths.has(anchor)) anchor = undefined;
    render();
  }

  async function go(to: string, push = true) {
    try {
      const target = to.replace(/\/+$/, "") || "/";
      const st = JSON.parse(os.fs.stat(target)) as { kind: string };
      if (st.kind !== "dir") throw new Error(`${target} is not a folder`);
      if (push && target !== cwd) {
        back.push(cwd);
        fwd.length = 0;
      }
      cwd = target;
      search = undefined;
      searchInput.value = "";
      selected.clear();
      anchor = undefined;
      load();
      pane.scrollTop = 0;
    } catch (e) {
      fail(e);
      paintCrumbs();
    }
  }
  const refresh = () => (search ? void runSearch() : load());

  async function run(fn: () => void | Promise<void>, then?: () => void) {
    try {
      await fn();
      await os.flush();
    } catch (e) {
      fail(e);
    }
    refresh();
    then?.();
    scheduleUsage();
  }

  // ---- search ---------------------------------------------------------------------------------
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  async function runSearch() {
    const q = searchInput.value.trim();
    if (!q) {
      if (search) {
        search = undefined;
        load();
      }
      return;
    }
    const everywhere = search?.everywhere ?? false;
    try {
      const found = await searchFiles(os, q, everywhere ? null : cwd);
      const visible = prefs.hidden ? found : found.filter(e => !e.path.split("/").some(s => s.startsWith(".")));
      const hits = searchContents(os, q).filter(x => everywhere || isInside(x.path, cwd));
      search = { q, everywhere, hits };
      entries = sorted(visible);
      selected.clear();
      render();
    } catch (e) {
      fail(e);
    }
  }
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void runSearch(), 220);
  });
  searchInput.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") void runSearch();
    if (e.key === "Escape") {
      searchInput.value = "";
      void runSearch();
      pane.focus();
    }
  });
  scopeBtn.addEventListener("click", () => {
    const everywhere = !(search?.everywhere ?? scopeBtn.dataset.all === "1");
    scopeBtn.dataset.all = everywhere ? "1" : "0";
    scopeBtn.textContent = everywhere ? "Everywhere" : "This folder";
    if (search) search.everywhere = everywhere;
    void runSearch();
  });

  // ---- rendering ------------------------------------------------------------------------------
  function paintCrumbs() {
    crumbs.hidden = false;
    pathInput.hidden = true;
    crumbs.replaceChildren();
    if (search) {
      crumbs.append(h("span", { class: "fx-crumb cur" }, `Search: ${search.q}`));
      return;
    }
    const parts = cwd.split("/").filter(Boolean);
    const seg = (label: string, to: string) => {
      const b = h("button", { class: "fx-crumb", onclick: () => void go(to) }, label);
      dropTarget(b, () => to);
      return b;
    };
    crumbs.append(seg("/", "/"));
    let acc = "";
    parts.forEach((p, i) => {
      acc += `/${p}`;
      crumbs.append(h("span", { class: "fx-sep", "aria-hidden": "true" }, "›"), seg(p, acc));
      if (i === parts.length - 1) crumbs.lastElementChild?.classList.add("cur");
    });
    crumbs.scrollLeft = crumbs.scrollWidth;
  }
  function editPath() {
    crumbs.hidden = true;
    pathInput.hidden = false;
    pathInput.value = cwd;
    pathInput.focus();
    pathInput.select();
  }
  pathInput.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") void go(pathInput.value.trim() || "/");
    if (e.key === "Escape") paintCrumbs();
  });
  pathInput.addEventListener("blur", () => setTimeout(() => !pathInput.hidden && paintCrumbs(), 100));
  crumbs.addEventListener("dblclick", e => {
    if (e.target === crumbs) editPath();
  });

  function paintStatus() {
    const sel = selEntries();
    const bytes = sel.reduce((a, e) => a + (e.kind === "file" ? e.size : 0), 0);
    const left = search
      ? `${entries.length} result${entries.length === 1 ? "" : "s"}${search.hits.length ? ` · ${search.hits.length} in contents` : ""}`
      : `${entries.length} item${entries.length === 1 ? "" : "s"}`;
    status.textContent = `${left}${sel.length ? ` · ${sel.length} selected${bytes ? ` (${fmtSize(bytes)})` : ""}` : ""} · ${os.persistent ? "saved in this browser (OPFS)" : "memory only"}`;
  }

  function paintActions() {
    const sel = selEntries();
    const n = sel.length;
    const inT = !search && inTrash(cwd);
    actions.replaceChildren();
    const add = (g: string, l: string, f: () => void, on = true) => {
      const b = tbtn(g, l, f);
      if (!on) b.setAttribute("disabled", "");
      actions.append(b);
    };
    add("content_cut", "Cut (Ctrl+X)", () => doCopy(true), n > 0 && !inT);
    add("content_copy", "Copy (Ctrl+C)", () => doCopy(false), n > 0);
    add("content_paste", "Paste (Ctrl+V)", () => void paste(cwd), Boolean(clip) && !inT && !search);
    add("drive_file_rename_outline", "Rename (F2)", () => startRename(sel[0]), n === 1 && !inT);
    if (inT) {
      add("restore_from_trash", "Restore", () => void doRestore(), n > 0);
      add("delete_forever", "Delete forever", () => void doDelete(true), n > 0);
      add("delete_sweep", "Empty trash", () => void doEmptyTrash(), entries.length > 0);
    } else add("delete", "Move to trash (Delete)", () => void doDelete(false), n > 0);
  }

  function paintSide() {
    side.replaceChildren();
    const item = (iconName: string, label: string, to: string, sub?: string, trashCount?: boolean) => {
      const b = h(
        "button",
        { class: `fx-place${!search && cwd === to ? " cur" : ""}`, onclick: () => void go(to), title: to },
        img(iconName, 22),
        h("span", { class: "fx-pl" }, label, sub ? h("small", {}, sub) : null),
      );
      if (trashCount && exists(os, TRASH)) {
        const n = listDir(os, TRASH).filter(e => e.name !== ".origins.json").length;
        if (n) b.append(h("span", { class: "fx-badge" }, String(n)));
      }
      dropTarget(b, () => to, to === TRASH);
      return b;
    };
    const home = ctx?.places.find(p => p.path === HOME);
    side.append(
      h("div", { class: "fx-head" }, "Places"),
      item("Home", "Home", HOME, home ? `${home.files} files · ${fmtSize(home.size)}` : undefined),
    );
    for (const name of ["Documents", "Projects"]) if (exists(os, join(HOME, name))) side.append(item("Folder", name, join(HOME, name)));
    side.append(item("Drive", "Root", "/"), item("Trash", "Trash", TRASH, undefined, true));
    const extra = (ctx?.places ?? []).filter(p => p.path !== HOME);
    if (extra.length) {
      side.append(h("div", { class: "fx-head" }, "Locations"));
      for (const p of extra) side.append(item("HDD", p.name, p.path, `${p.files} files · ${fmtSize(p.size)}`));
    }
    // The Drive library sections exist only where the Drive explorer wire is served; the browser desktop omits them.
    if (ctx?.served) {
      side.append(
        h("div", { class: "fx-head" }, "Library"),
        h("div", { class: "fx-meta" }, img("Collection", 18), h("span", {}, ctx.library ?? "Library")),
        ...(ctx.spaces.length ? [h("div", { class: "fx-meta" }, img("Scrapbook", 18), h("span", {}, `Space: ${ctx.spaces.join(", ")}`))] : []),
        ...(ctx.device ? [h("div", { class: "fx-meta" }, img("Laptop", 18), h("span", {}, `${ctx.device.name}${ctx.device.arch ? ` · ${ctx.device.arch}` : ""}`))] : []),
        ...(ctx.volume ? [h("div", { class: "fx-meta" }, img("HDD", 18), h("span", {}, ctx.volume.name))] : []),
      );
    }
    side.append(quota);
  }

  let usageTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleUsage() {
    clearTimeout(usageTimer);
    usageTimer = setTimeout(() => {
      try {
        const u = usage(os, "/");
        const cap = ctx?.volume?.capacity ?? 80 * 1024 * 1024;
        const pct = Math.min(100, (u.bytes / cap) * 100);
        const bar = h("div", { class: "fx-bar" }, h("i", { style: `width:${pct.toFixed(2)}%` }));
        quota.replaceChildren(
          bar,
          h("small", {}, `${fmtSize(u.bytes)} of ${fmtSize(cap)} · ${u.files} files, ${u.dirs} folders`),
        );
      } catch {
        quota.replaceChildren();
      }
      paintSide();
    }, 200);
  }

  function thumb(e: Entry, holder: HTMLElement) {
    if (e.kind !== "file" || !isMedia(e, "image") || e.size > THUMB_MAX) return;
    const cached = thumbs.get(e.path);
    const apply = (url: string) =>
      holder.replaceChildren(h("img", { class: "fx-thumb", src: url, alt: "", draggable: false }));
    if (cached) return apply(cached);
    const io = new IntersectionObserver(items => {
      if (!items.some(i => i.isIntersecting)) return;
      io.disconnect();
      try {
        const url = URL.createObjectURL(new Blob([os.fs.read(e.path) as BlobPart], { type: MIME[e.ext] }));
        thumbs.set(e.path, url);
        apply(url);
      } catch {
        // Keep the type icon.
      }
    });
    io.observe(holder);
  }

  function render() {
    els.clear();
    paintCrumbs();
    pane.classList.toggle("grid", prefs.view === "grid");
    pane.classList.toggle("list", prefs.view === "list");
    const kids: HTMLElement[] = [];
    if (prefs.view === "list") kids.push(header());
    for (const e of entries) kids.push(item(e));
    if (!entries.length) {
      kids.push(h("div", { class: "empty" }, search ? "No file name matches" : inTrash(cwd) ? "Trash is empty" : "This folder is empty"));
    }
    if (search?.hits.length) {
      kids.push(h("div", { class: "fx-hsec" }, "Matches in file contents"));
      for (const hit of search.hits) {
        kids.push(
          h(
            "button",
            { class: "fx-hit", onclick: () => void reveal(hit.path) },
            img("Text", 20),
            h("span", { class: "fx-hp" }, `${hit.path}:${hit.line}`),
            h("span", { class: "fx-ht" }, hit.text),
          ),
        );
      }
    }
    pane.replaceChildren(...kids);
    paintSelection();
    paintSide();
    paintActions();
    paintStatus();
  }

  function header() {
    const col = (key: SortKey, label: string, cls: string) =>
      h(
        "button",
        {
          class: `fx-col ${cls}`,
          onclick: () => setSort(key),
          "aria-sort": prefs.sort === key ? (prefs.desc ? "descending" : "ascending") : "none",
        },
        label,
        prefs.sort === key ? sym(prefs.desc ? "arrow_downward" : "arrow_upward") : null,
      );
    return h("div", { class: "fx-hdr" }, col("name", "Name", "n"), search ? h("span", { class: "fx-col w" }, "Location") : null, col("kind", "Kind", "k"), col("size", "Size", "s"));
  }

  function item(e: Entry): HTMLElement {
    const holder = h("span", { class: "fx-ico" }, img(iconOf(e), prefs.view === "grid" ? 56 : 28));
    if (prefs.view === "grid") thumb(e, holder);
    const name = h("span", { class: "fx-name", title: e.name }, e.name);
    const el =
      prefs.view === "grid"
        ? h("div", { class: "fx-item", role: "option", draggable: true, "data-path": e.path }, holder, name)
        : h(
            "div",
            { class: "fx-row", role: "option", draggable: true, "data-path": e.path },
            holder,
            name,
            search ? h("span", { class: "fx-w", title: parent(e.path) }, parent(e.path)) : null,
            h("span", { class: "fx-k" }, kindLabel(e)),
            h("span", { class: "fx-s" }, e.kind === "dir" ? "" : fmtSize(e.size)),
          );
    els.set(e.path, el);
    if (clip?.cut && clip.paths.includes(e.path)) el.classList.add("cut");
    el.addEventListener("click", ev => {
      if (renaming) return;
      select(e, ev);
      pane.focus({ preventScroll: true });
    });
    el.addEventListener("dblclick", () => void open(e));
    el.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!selected.has(e.path)) select(e, { ctrlKey: false, shiftKey: false, metaKey: false } as MouseEvent);
      showMenu(ev.clientX, ev.clientY, menuFor(e));
    });
    el.addEventListener("dragstart", ev => {
      if (!selected.has(e.path)) select(e, { ctrlKey: false, shiftKey: false, metaKey: false } as MouseEvent);
      const paths = [...selected];
      ev.dataTransfer?.setData(DND, JSON.stringify(paths));
      ev.dataTransfer?.setData("text/plain", paths.join("\n"));
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copyMove";
    });
    if (e.kind === "dir") dropTarget(el, () => e.path, inTrash(e.path) && e.path === TRASH);
    return el;
  }

  function paintSelection() {
    for (const [p, el] of els) {
      const on = selected.has(p);
      el.classList.toggle("sel", on);
      el.setAttribute("aria-selected", String(on));
    }
    paintActions();
    paintStatus();
    void paintPreview();
  }

  // ---- selection and keyboard -----------------------------------------------------------------
  function select(e: Entry, ev: Pick<MouseEvent, "ctrlKey" | "shiftKey" | "metaKey">) {
    if (ev.shiftKey && anchor) {
      const a = entries.findIndex(x => x.path === anchor);
      const b = entries.findIndex(x => x.path === e.path);
      if (a >= 0 && b >= 0) {
        if (!ev.ctrlKey) selected.clear();
        for (const x of entries.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(x.path);
      }
    } else if (ev.ctrlKey || ev.metaKey) {
      if (!selected.delete(e.path)) selected.add(e.path);
      anchor = e.path;
    } else {
      selected.clear();
      selected.add(e.path);
      anchor = e.path;
    }
    paintSelection();
  }

  function focusIndex(i: number, ev: KeyboardEvent) {
    const e = entries[Math.max(0, Math.min(entries.length - 1, i))];
    if (!e) return;
    select(e, ev.shiftKey ? { ctrlKey: false, shiftKey: true, metaKey: false } : { ctrlKey: false, shiftKey: false, metaKey: false });
    if (ev.shiftKey && !anchor) anchor = e.path;
    els.get(e.path)?.scrollIntoView({ block: "nearest" });
  }
  const current = () => {
    const last = [...selected].pop();
    return Math.max(-1, entries.findIndex(e => e.path === (anchor && selected.has(anchor) && selected.size === 1 ? anchor : last)));
  };
  function columns() {
    if (prefs.view !== "grid") return 1;
    const first = pane.querySelector<HTMLElement>(".fx-item");
    if (!first) return 1;
    return Math.max(1, [...pane.querySelectorAll<HTMLElement>(".fx-item")].filter(n => n.offsetTop === first.offsetTop).length);
  }

  shell.addEventListener("keydown", ev => {
    if (renaming || (ev.target instanceof HTMLInputElement && ev.target !== pane)) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const i = current();
    const grid = prefs.view === "grid";
    const step = columns();
    const act = (fn: () => void) => {
      ev.preventDefault();
      fn();
    };
    switch (ev.key) {
      case "ArrowDown": return act(() => focusIndex(i < 0 ? 0 : i + step, ev));
      case "ArrowUp": return act(() => focusIndex(i < 0 ? 0 : i - step, ev));
      case "ArrowRight": if (grid) return act(() => focusIndex(i + 1, ev)); break;
      case "ArrowLeft": if (grid) return act(() => focusIndex(i - 1, ev)); break;
      case "Home": return act(() => focusIndex(0, ev));
      case "End": return act(() => focusIndex(entries.length - 1, ev));
      case "Enter": return act(() => { const e = selEntries()[0]; if (e) void open(e); });
      case "Backspace": return act(() => void go(parent(cwd)));
      case "Delete": return act(() => void doDelete(ev.shiftKey || inTrash(cwd)));
      case "F2": return act(() => selEntries().length === 1 && startRename(selEntries()[0]!));
      case "F5": return act(refresh);
      case "Escape": return act(() => { selected.clear(); paintSelection(); });
      case " ": return act(() => { prefs.preview = !prefs.preview; savePrefs(); layout(); void paintPreview(); });
    }
    if (ev.altKey && ev.key === "ArrowLeft") return act(goBack);
    if (ev.altKey && ev.key === "ArrowRight") return act(goFwd);
    if (mod) {
      const k = ev.key.toLowerCase();
      if (k === "a") return act(() => { for (const e of entries) selected.add(e.path); paintSelection(); });
      if (k === "c") return act(() => doCopy(false));
      if (k === "x") return act(() => doCopy(true));
      if (k === "v") return act(() => void paste(cwd));
      if (k === "l") return act(editPath);
      if (k === "f") return act(() => searchInput.focus());
      if (k === "n") return act(() => void newItem(ev.shiftKey ? "folder" : "file"));
    }
    if (ev.key.length === 1 && !mod && !ev.altKey) {
      const now = Date.now();
      typed = now - typedAt > 700 ? ev.key.toLowerCase() : typed + ev.key.toLowerCase();
      typedAt = now;
      const j = entries.findIndex(e => e.name.toLowerCase().startsWith(typed));
      if (j >= 0) act(() => focusIndex(j, { shiftKey: false } as KeyboardEvent));
    }
  });

  function goBack() {
    const p = back.pop();
    if (p === undefined) return;
    fwd.push(cwd);
    void go(p, false);
  }
  function goFwd() {
    const p = fwd.pop();
    if (p === undefined) return;
    back.push(cwd);
    void go(p, false);
  }

  // ---- opening and preview --------------------------------------------------------------------
  const looksText = (b: Uint8Array) => !b.subarray(0, 4096).includes(0);

  async function open(e: Entry) {
    if (e.kind === "dir") return go(e.path);
    try {
      // The default app of this file kind (Settings > Files) comes first; "editor" is the text path below.
      const chosen = defaultAppFor(e.name);
      if (chosen && chosen !== "editor" && options.openWith?.(chosen, e.path, e.name, os.fs.read(e.path))) return;
      const craft = chosen === "editor" ? undefined : craftHostForPath(e.path);
      const openCraft = options.openCraft;
      if (craft && openCraft) {
        const maxFileBytes = craftHostMaxFileBytes(craft);
        if (e.size > maxFileBytes)
          return toast(
            `Craft can open files up to ${Math.floor(maxFileBytes / (1024 * 1024))} MiB from Drive`,
            true,
          );
        if (!openCraft(craft, e.path, e.name, os.fs.read(e.path)))
          return toast(`Install ${craft} from Apps, then open this file again`, true);
        return;
      }
      if (isMedia(e, "image") || isMedia(e, "audio") || isMedia(e, "video")) {
        prefs.preview = true;
        savePrefs();
        layout();
        selected.clear();
        selected.add(e.path);
        paintSelection();
        return;
      }
      if (e.size > 2_000_000) return toast("File too large to open in the editor");
      const bytes = os.fs.read(e.path);
      if (!looksText(bytes)) {
        prefs.preview = true;
        savePrefs();
        layout();
        selected.clear();
        selected.add(e.path);
        paintSelection();
        return;
      }
      openText(e.path, new TextDecoder().decode(bytes));
    } catch (err) {
      fail(err);
    }
  }
  async function reveal(path: string) {
    await go(parent(path));
    const e = entries.find(x => x.path === path);
    if (e) {
      select(e, { ctrlKey: false, shiftKey: false, metaKey: false });
      els.get(path)?.scrollIntoView({ block: "center" });
    }
  }

  let previewUrl: string | undefined;
  async function paintPreview() {
    if (!prefs.preview) return;
    const token = ++previewToken;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    const sel = selEntries();
    const body = h("div", { class: "fx-pbody" });
    const rows: [string, string][] = [];
    if (sel.length === 0) {
      const where = search ? "search results" : cwd;
      body.append(img("Folder", 64), h("div", { class: "fx-ptitle" }, base(cwd) || "/"), h("div", { class: "dim" }, `${entries.length} items in ${where}`));
    } else if (sel.length > 1) {
      const total = sel.reduce((a, e) => a + (e.kind === "file" ? e.size : 0), 0);
      body.append(img("Collection", 64), h("div", { class: "fx-ptitle" }, `${sel.length} items`), h("div", { class: "dim" }, fmtSize(total)));
    } else {
      const e = sel[0]!;
      const media = h("div", { class: "fx-pmedia" });
      try {
        if (e.kind === "file" && (isMedia(e, "image") || isMedia(e, "audio") || isMedia(e, "video"))) {
          previewUrl = URL.createObjectURL(new Blob([os.fs.read(e.path) as BlobPart], { type: MIME[e.ext] }));
          const type = MIME[e.ext]!.split("/")[0];
          media.append(
            type === "image"
              ? h("img", { src: previewUrl, alt: e.name })
              : h(type === "audio" ? "audio" : "video", { src: previewUrl, controls: true, preload: "metadata" }),
          );
        } else if (e.kind === "file" && e.size <= 1_000_000) {
          const bytes = os.fs.read(e.path);
          if (looksText(bytes)) media.append(h("pre", { class: "fx-ptext" }, new TextDecoder().decode(bytes.subarray(0, 4000)) + (bytes.length > 4000 ? "\n…" : "")));
          else media.append(img(iconOf(e), 64));
        } else media.append(img(iconOf(e), 64));
      } catch (err) {
        media.append(h("div", { class: "dim" }, String(err)));
      }
      body.append(media, h("div", { class: "fx-ptitle", title: e.name }, e.name));
      rows.push(["Kind", kindLabel(e)], ["Location", parent(e.path)]);
      if (e.kind === "file") rows.push(["Size", `${fmtSize(e.size)} (${e.size} bytes)`]);
      else {
        try {
          const u = usage(os, e.path);
          rows.push(["Contains", `${u.files} files, ${u.dirs} folders`], ["Size", fmtSize(u.bytes)]);
        } catch {
          // Unreadable folder.
        }
      }
      try {
        const meta = await byPath(os, e.path);
        rows.push(["Content", meta.content_kind]);
      } catch {
        // Wire not served.
      }
      if (e.kind === "file" && !MIME[e.ext]) {
        try {
          const tri = JSON.parse(os.fs.triage(e.path)) as Record<string, unknown>;
          for (const [k, v] of Object.entries(tri).slice(0, 12)) {
            if (v === null || typeof v === "object") {
              if (Array.isArray(v)) rows.push([`Triage ${k}`, `${v.length} entries`]);
              continue;
            }
            rows.push([`Triage ${k}`, String(v).slice(0, 80)]);
          }
        } catch {
          // Not a binary format aphrody-re knows.
        }
      }
    }
    if (token !== previewToken) return;
    if (rows.length) {
      const dl = h("dl", { class: "fx-info" });
      for (const [k, v] of rows) dl.append(h("dt", {}, k), h("dd", {}, v));
      body.append(dl);
    }
    preview.replaceChildren(body);
  }

  // ---- operations -----------------------------------------------------------------------------
  function doCopy(cut: boolean) {
    const paths = [...selected];
    if (!paths.length) return;
    clip = { paths, cut };
    for (const [p, el] of els) el.classList.toggle("cut", cut && paths.includes(p));
    paintActions();
    toast(`${paths.length} item${paths.length === 1 ? "" : "s"} ${cut ? "cut" : "copied"}`);
  }
  async function paste(dir: string) {
    if (!clip) return;
    if (inTrash(dir)) return toast("Cannot paste into the trash", true);
    const { paths, cut } = clip;
    await run(() => {
      for (const p of paths) {
        if (!exists(os, p)) continue;
        if (cut) moveTo(os, p, dir);
        else copyTo(os, p, dir);
      }
      if (cut) clip = undefined;
    });
  }
  async function doDelete(permanent: boolean) {
    const paths = [...selected];
    if (!paths.length) return;
    if (permanent && !confirm(`Delete ${paths.length} item${paths.length === 1 ? "" : "s"} forever?`)) return;
    await run(() => {
      if (permanent && !inTrash(paths[0]!)) {
        for (const p of paths) if (protectedPath(p)) throw new Error(`${p} is protected`);
        for (const p of paths) os.fs.remove(p);
      } else trash(os, paths);
    });
  }
  async function doRestore() {
    const paths = [...selected];
    await run(() => restore(os, paths));
  }
  async function doEmptyTrash() {
    if (confirm("Delete everything in the trash forever?")) await run(() => emptyTrash(os));
  }
  async function newItem(kind: "folder" | "file") {
    if (inTrash(cwd) || search) return;
    const n = await ask(kind === "folder" ? "New folder" : "New file", kind === "folder" ? "Folder name" : "File name");
    if (!n) return;
    if (n.includes("/")) return toast("Names cannot contain /", true);
    const target = join(cwd, n);
    if (exists(os, target)) return toast(`${n} already exists`, true);
    await run(() => (kind === "folder" ? os.fs.mkdir(target) : os.fs.write(target, new Uint8Array())), () => {
      const e = entries.find(x => x.path === target);
      if (e) select(e, { ctrlKey: false, shiftKey: false, metaKey: false });
    });
  }
  const importFiles = (files: Iterable<File>, dir: string) =>
    run(async () => {
      let n = 0;
      for (const f of files) {
        os.fs.write(join(dir, f.name), new Uint8Array(await f.arrayBuffer()));
        n++;
      }
      toast(`${n} file${n === 1 ? "" : "s"} imported`);
    });
  function download(e: Entry) {
    const url = URL.createObjectURL(new Blob([os.fs.read(e.path) as BlobPart], { type: MIME[e.ext] ?? "application/octet-stream" }));
    const a = h("a", { href: url, download: e.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function startRename(e?: Entry) {
    const el = e && els.get(e.path);
    const label = el?.querySelector<HTMLElement>(".fx-name");
    if (!e || !el || !label || renaming) return;
    renaming = true;
    const input = h("input", { class: "fx-rename", value: e.name, spellcheck: "false", "aria-label": "New name" });
    label.replaceWith(input);
    input.focus();
    input.setSelectionRange(0, e.kind === "file" && e.name.lastIndexOf(".") > 0 ? e.name.lastIndexOf(".") : e.name.length);
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      renaming = false;
      const name = input.value.trim();
      if (!commit || !name || name === e.name) {
        refresh();
        pane.focus();
        return;
      }
      try {
        if (name.includes("/")) throw new Error("Names cannot contain /");
        if (exists(os, join(parent(e.path), name))) throw new Error(`${name} already exists`);
        await call(os, "Action", "action:files.rename", { target: sdPath(e.path), new_name: name });
        await os.flush();
        const to = join(parent(e.path), name);
        if (search) await runSearch();
        else load();
        const n = entries.find(x => x.path === to);
        if (n) select(n, { ctrlKey: false, shiftKey: false, metaKey: false });
      } catch (err) {
        fail(err);
        refresh();
      }
      pane.focus();
    };
    input.addEventListener("keydown", ev => {
      ev.stopPropagation();
      if (ev.key === "Enter") void finish(true);
      if (ev.key === "Escape") void finish(false);
    });
    input.addEventListener("blur", () => void finish(true));
    input.addEventListener("click", ev => ev.stopPropagation());
    input.addEventListener("dblclick", ev => ev.stopPropagation());
    input.addEventListener("dragstart", ev => ev.preventDefault());
  }

  // ---- drag and drop --------------------------------------------------------------------------
  function dropTarget(el: HTMLElement, dir: () => string, toTrash = false) {
    const accepts = (ev: DragEvent) => {
      const t = ev.dataTransfer?.types ?? [];
      return t.includes(DND) || t.includes("Files");
    };
    el.addEventListener("dragover", ev => {
      if (!accepts(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = ev.ctrlKey && !toTrash ? "copy" : "move";
      el.classList.add("drop");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop"));
    el.addEventListener("drop", ev => {
      el.classList.remove("drop");
      if (!accepts(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const target = dir();
      const raw = ev.dataTransfer?.getData(DND);
      if (raw) {
        const paths = (JSON.parse(raw) as string[]).filter(p => p !== target);
        const copy = ev.ctrlKey && !toTrash;
        void run(() => {
          if (toTrash) trash(os, paths);
          else if (inTrash(target)) throw new Error("Cannot drop into the trash folder");
          else for (const p of paths) (copy ? copyTo : moveTo)(os, p, target);
        });
      } else if (ev.dataTransfer?.files.length) void importFiles(Array.from(ev.dataTransfer.files), target);
    });
  }

  // ---- context menu ---------------------------------------------------------------------------
  let menu: HTMLElement | undefined;
  function closeMenu() {
    menu?.remove();
    menu = undefined;
  }
  function showMenu(x: number, y: number, items: (MenuItem | "-")[]) {
    closeMenu();
    const m = h("div", { class: "fx-menu", role: "menu" });
    for (const it of items) {
      if (it === "-") {
        m.append(h("div", { class: "fx-msep", role: "separator" }));
        continue;
      }
      m.append(
        h(
          "button",
          {
            class: `fx-mi${it.danger ? " danger" : ""}`,
            role: "menuitem",
            onclick: () => {
              closeMenu();
              it.run();
            },
          },
          sym(it.glyph),
          h("span", {}, it.label),
          it.hint ? h("kbd", {}, it.hint) : null,
        ),
      );
    }
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    menu = m;
    m.querySelector<HTMLElement>("button")?.focus();
    m.addEventListener("keydown", ev => {
      if (ev.key === "Escape") closeMenu();
      const bs = [...m.querySelectorAll<HTMLElement>("button")];
      const i = bs.indexOf(document.activeElement as HTMLElement);
      if (ev.key === "ArrowDown") bs[(i + 1) % bs.length]?.focus();
      if (ev.key === "ArrowUp") bs[(i - 1 + bs.length) % bs.length]?.focus();
      ev.stopPropagation();
    });
  }
  document.addEventListener("pointerdown", ev => menu && !menu.contains(ev.target as Node) && closeMenu(), true);

  function menuFor(e: Entry): (MenuItem | "-")[] {
    const n = selected.size;
    const inT = inTrash(cwd) && !search;
    const items: (MenuItem | "-")[] = [{ label: e.kind === "dir" ? "Open" : "Open / preview", glyph: "open_in_new", run: () => void open(e), hint: "Enter" }];
    if (e.kind === "file" && e.size <= 2_000_000 && !isMedia(e, "image") && !isMedia(e, "audio") && !isMedia(e, "video"))
      items.push({ label: "Open in editor", glyph: "edit_note", run: () => { try { openText(e.path, new TextDecoder().decode(os.fs.read(e.path))); } catch (err) { fail(err); } } });
    if (search) items.push({ label: "Show in folder", glyph: "folder_open", run: () => void reveal(e.path) });
    items.push("-");
    if (inT) {
      items.push({ label: "Restore", glyph: "restore_from_trash", run: () => void doRestore() }, { label: "Delete forever", glyph: "delete_forever", run: () => void doDelete(true), danger: true, hint: "Del" });
      return items;
    }
    items.push(
      { label: "Cut", glyph: "content_cut", run: () => doCopy(true), hint: "Ctrl+X" },
      { label: "Copy", glyph: "content_copy", run: () => doCopy(false), hint: "Ctrl+C" },
    );
    if (e.kind === "dir" && clip) items.push({ label: "Paste into folder", glyph: "content_paste", run: () => void paste(e.path), hint: "Ctrl+V" });
    items.push("-");
    if (n === 1) items.push({ label: "Rename", glyph: "drive_file_rename_outline", run: () => startRename(e), hint: "F2" });
    if (e.kind === "file" && n === 1) items.push({ label: "Download", glyph: "download", run: () => download(e) });
    items.push(
      { label: "Info", glyph: "info", run: () => { prefs.preview = true; savePrefs(); layout(); void paintPreview(); } },
      "-",
      { label: n > 1 ? `Move ${n} items to trash` : "Move to trash", glyph: "delete", run: () => void doDelete(false), danger: true, hint: "Del" },
      { label: "Delete forever", glyph: "delete_forever", run: () => void doDelete(true), danger: true, hint: "Shift+Del" },
    );
    return items;
  }

  function menuBackground(): (MenuItem | "-")[] {
    if (search) return [{ label: "Clear search", glyph: "close", run: () => { searchInput.value = ""; void runSearch(); } }];
    if (inTrash(cwd)) return [{ label: "Empty trash", glyph: "delete_sweep", run: () => void doEmptyTrash() }, { label: "Refresh", glyph: "refresh", run: refresh, hint: "F5" }];
    return [
      { label: "New folder", glyph: "create_new_folder", run: () => void newItem("folder"), hint: "Ctrl+Shift+N" },
      { label: "New file", glyph: "note_add", run: () => void newItem("file"), hint: "Ctrl+N" },
      { label: "Paste", glyph: "content_paste", run: () => void paste(cwd), hint: "Ctrl+V" },
      "-",
      { label: "Upload files", glyph: "upload", run: () => fileInput.click() },
      { label: prefs.hidden ? "Hide hidden files" : "Show hidden files", glyph: "visibility", run: toggleHidden },
      { label: "Refresh", glyph: "refresh", run: refresh, hint: "F5" },
    ];
  }
  pane.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    if (ev.target === pane || (ev.target as HTMLElement).closest(".empty")) {
      selected.clear();
      paintSelection();
    }
    showMenu(ev.clientX, ev.clientY, menuBackground());
  });
  pane.addEventListener("click", ev => {
    if (ev.target === pane) {
      selected.clear();
      paintSelection();
    }
  });
  dropTarget(pane, () => cwd);

  // ---- toolbar --------------------------------------------------------------------------------
  function setSort(key: SortKey) {
    if (prefs.sort === key) prefs.desc = !prefs.desc;
    else {
      prefs.sort = key;
      prefs.desc = false;
    }
    savePrefs();
    entries = sorted(entries);
    render();
  }
  function toggleHidden() {
    prefs.hidden = !prefs.hidden;
    savePrefs();
    refresh();
    paintTools();
  }
  function layout() {
    shell.classList.toggle("with-preview", prefs.preview);
    preview.hidden = !prefs.preview;
    paintTools();
  }
  const viewBtn = tbtn("grid_view", "Grid / list view", () => {
    prefs.view = prefs.view === "grid" ? "list" : "grid";
    savePrefs();
    render();
    paintTools();
  });
  const sortBtn = tbtn("sort", "Sort", ev => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const mark = (k: SortKey) => (prefs.sort === k ? (prefs.desc ? " (descending)" : " (ascending)") : "");
    showMenu(r.left, r.bottom + 4, [
      { label: `Name${mark("name")}`, glyph: "sort_by_alpha", run: () => setSort("name") },
      { label: `Size${mark("size")}`, glyph: "straighten", run: () => setSort("size") },
      { label: `Kind${mark("kind")}`, glyph: "category", run: () => setSort("kind") },
    ]);
  });
  const hiddenBtn = tbtn("visibility_off", "Show hidden files", toggleHidden);
  const previewBtn = tbtn("view_sidebar", "Preview pane (Space)", () => {
    prefs.preview = !prefs.preview;
    savePrefs();
    layout();
    void paintPreview();
  });
  function paintTools() {
    viewBtn.firstElementChild!.textContent = prefs.view === "grid" ? "view_list" : "grid_view";
    hiddenBtn.firstElementChild!.textContent = prefs.hidden ? "visibility" : "visibility_off";
    hiddenBtn.classList.toggle("on", prefs.hidden);
    previewBtn.classList.toggle("on", prefs.preview);
  }

  fileInput.addEventListener("change", async () => {
    await importFiles(Array.from(fileInput.files ?? []), cwd);
    fileInput.value = "";
  });

  const toolbar = h(
    "div",
    { class: "fx-bar" },
    tbtn("arrow_back", "Back (Alt+Left)", goBack),
    tbtn("arrow_forward", "Forward (Alt+Right)", goFwd),
    tbtn("arrow_upward", "Parent folder (Backspace)", () => void go(parent(cwd))),
    tbtn("refresh", "Refresh (F5)", refresh),
    h("div", { class: "fx-pathwrap" }, crumbs, pathInput),
    h("div", { class: "fx-searchwrap" }, sym("search"), searchInput, scopeBtn),
  );
  const toolbar2 = h(
    "div",
    { class: "fx-bar sub" },
    tbtn("create_new_folder", "New folder (Ctrl+Shift+N)", () => void newItem("folder")),
    tbtn("note_add", "New file (Ctrl+N)", () => void newItem("file")),
    tbtn("upload", "Upload files", () => fileInput.click()),
    h("span", { class: "fx-vsep" }),
    actions,
    h("span", { class: "fx-grow" }),
    sortBtn,
    hiddenBtn,
    viewBtn,
    previewBtn,
  );

  shell.append(
    toolbar,
    toolbar2,
    h("div", { class: "fx-main" }, side, pane, preview),
    h("div", { class: "fx-foot" }, status),
    fileInput,
  );
  root.append(shell);
  layout();
  scopeBtn.dataset.all = "0";

  await go(cwd, false);
  ctx = await loadContext(os);
  paintSide();
  scheduleUsage();
  pane.focus({ preventScroll: true });
}
