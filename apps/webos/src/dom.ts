// SPDX-License-Identifier: Apache-2.0
type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined>;

/** Tiny hyperscript: `h("button", { class: "x", onclick }, "label")`. Text is always set as text nodes. */
import "./m3";
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  // Buttons marked .btn / .btn.tonal are Material 3 elements; everything else is plain HTML.
  const cls = String(attrs.class ?? "");
  const real =
    tag === "button" && /(^| )dlg-text( |$)/.test(cls)
      ? "md-text-button"
      : tag === "button" && /(^| )btn( |$)/.test(cls)
        ? /(^| )tonal( |$)/.test(cls)
          ? "md-filled-tonal-button"
          : "md-filled-button"
        : tag;
  const el = document.createElement(real) as HTMLElementTagNameMap[K];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Material Symbols (Rounded) glyph names for the shell icon vocabulary. */
const SYMBOLS: Record<string, string> = {
  app: "apps",
  grid: "apps",
  folder: "folder",
  file: "draft",
  terminal: "terminal",
  globe: "language",
  bolt: "bolt",
  store: "storefront",
  gear: "settings",
  info: "info",
  search: "search",
  close: "close",
  min: "remove",
  max: "crop_square",
  back: "arrow_back",
  fwd: "arrow_forward",
  reload: "refresh",
  plus: "add",
  up: "arrow_upward",
  trash: "delete",
  code: "code",
  cube: "deployed_code",
  moon: "dark_mode",
  sun: "light_mode",
  upload: "upload",
  doc: "description",
  image: "image",
  music: "music_note",
  film: "movie",
  table: "table_chart",
  pen: "edit",
  android: "android",
  game: "sports_esports",
  chat: "chat",
};

export function icon(name: string): HTMLSpanElement {
  const s = document.createElement("span");
  // "img:<path>" is a real upstream icon asset (see app-icons.ts); anything else is a shell glyph.
  if (name.startsWith("img:")) {
    s.className = "mi-img";
    s.setAttribute("aria-hidden", "true");
    const img = document.createElement("img");
    img.src = name.slice(4);
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    s.append(img);
    return s;
  }
  s.className = "mi material-symbols-rounded";
  s.setAttribute("aria-hidden", "true");
  s.textContent = SYMBOLS[name] ?? "apps";
  return s;
}

/** Material 3 dialog with a text field; resolves with the entered text, or null when cancelled. */
export function ask(title: string, label: string, value = ""): Promise<string | null> {
  return new Promise(resolve => {
    const field = document.createElement("md-outlined-text-field") as HTMLElement & { value: string };
    field.setAttribute("label", label);
    field.value = value;
    field.style.width = "100%";
    const dialog = document.createElement("md-dialog") as HTMLElement & { show(): void; close(): void };
    const done = (v: string | null) => {
      resolve(v);
      dialog.close();
    };
    const cancel = h("button", { slot: "actions", class: "dlg-text", onclick: () => done(null) }, "Cancel");
    const ok = h("button", { slot: "actions", class: "btn", onclick: () => done(field.value.trim() || null) }, "OK");
    const headline = h("div", { slot: "headline" }, title);
    const form = h("div", { slot: "content" });
    form.append(field);
    field.addEventListener("keydown", (e: Event) => {
      if ((e as KeyboardEvent).key === "Enter") done(field.value.trim() || null);
    });
    dialog.append(headline, form, cancel, ok);
    dialog.addEventListener("closed", () => {
      resolve(null);
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.show();
    queueMicrotask(() => field.focus());
  });
}
