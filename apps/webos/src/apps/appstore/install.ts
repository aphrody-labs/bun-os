// SPDX-License-Identifier: Apache-2.0
// S06 Install flows (S05 ships the read-only part: unavailable reason and copyable commands).
import { h } from "../../dom";
import type { StoreApp } from "../../../store/types";
import { copy, type Store } from "./core";

export function commandBox(a: StoreApp) {
  const list: { id: string; text: string }[] = [];
  if (a.install.command) list.push({ id: a.install.agent?.manager ?? "install", text: a.install.command });
  if (a.install.removeCommand) list.push({ id: "remove", text: a.install.removeCommand });
  if (!list.length) return null;
  return h(
    "div",
    { class: "st-cmds" },
    ...list.map((c) =>
      h("div", { class: "st-cmd" }, h("span", { class: "st-cmd-id" }, c.id), h("code", {}, c.text), h("button", { class: "st-link", type: "button", "aria-label": `Copy the ${c.id} command`, onclick: (e: Event) => copy(c.text, e.currentTarget as HTMLElement) }, "Copy")),
    ),
  );
}

export function installGroup(s: Store, a: StoreApp): HTMLElement {
  if (a.unavailable && !a.install.pwa && !a.install.command && !a.install.download)
    return h("div", { class: "st-install" }, h("p", { class: "st-note" }, `Not installable from the Store: ${a.unavailable}`));
  return h("div", { class: "st-install" }, commandBox(a));
}

export function stickyBar(_s: Store, _a: StoreApp): Node | null {
  return null;
}
