// SPDX-License-Identifier: Apache-2.0
// S06 Install flows: browser install with progress, download with checksum, copyable package-manager commands,
// one-click install through the Bun OS agent when one answers, and a sticky install bar.
import { h } from "../../dom";
import { install, installed, needsUpdate, uninstall } from "../../pkg";
import type { StoreApp } from "../../../store/types";
import { commandInstalled, copy, fmt, mi, saveCommandInstalled, sourceById, type Store } from "./core";

export function commandBox(a: StoreApp) {
  const list: { id: string; text: string }[] = [];
  if (a.install.command) list.push({ id: a.install.agent?.manager ?? "install", text: a.install.command });
  if (a.install.removeCommand) list.push({ id: "remove", text: a.install.removeCommand });
  if (!list.length) return null;
  return h(
    "div",
    { class: "st-cmds" },
    ...list.map((c) =>
      h(
        "div",
        { class: "st-cmd" },
        h("span", { class: "st-cmd-id" }, c.id),
        h("code", { tabindex: "0" }, c.text),
        h("button", { class: "st-link", type: "button", "aria-label": `Copy the ${c.id} command`, onclick: (e: Event) => copy(c.text, e.currentTarget as HTMLElement) }, "Copy"),
      ),
    ),
  );
}

/** The one action that installs or opens this app, for the sticky bar. */
const primaries = new WeakMap<HTMLElement, HTMLElement>();

export function installGroup(s: Store, a: StoreApp): HTMLElement {
  const box = h("section", { class: "st-install", "aria-label": "Install", "data-install": "" });
  if (a.unavailable && !a.install.pwa && !a.install.command && !a.install.download) {
    box.append(h("p", { class: "st-note" }, mi("info"), ` Not installable from the Store: ${a.unavailable}`));
    return box;
  }
  const status = h("div", { class: "st-status", role: "status", "aria-live": "polite" });
  const progress = document.createElement("md-linear-progress") as HTMLElement & { value: number };
  progress.value = 0;
  progress.hidden = true;
  const actions = h("div", { class: "st-actions" });
  const guard = (fn: () => Promise<void>, done: string) => async (ev: Event) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    progress.hidden = false;
    status.classList.remove("err");
    try {
      await fn();
      s.onChange();
      s.toast(done);
      s.render();
    } catch (error) {
      status.textContent = `Failed: ${String((error as Error).message ?? error)}`;
      status.classList.add("err");
      btn.disabled = false;
      progress.hidden = true;
    }
  };
  let primary: HTMLElement | undefined;
  const reg = a.install.pwa ? s.regById.get(a.install.pwa) : undefined;
  if (reg) {
    const doInstall = (done: string) =>
      guard(
        () =>
          install(reg, (d, t) => {
            progress.value = d / t;
            status.textContent = `Downloading and verifying ${Math.round((d / t) * 100)}%`;
          }),
        done,
      );
    if (!installed()[reg.id]) {
      primary = h("button", { class: "btn", type: "button", onclick: doInstall(`${a.name} installed`) }, mi("download"), `Install (${fmt(reg.size)})`);
      actions.append(primary);
    } else {
      primary = h("button", { class: "btn", type: "button", onclick: () => s.launch(reg) }, mi("open_in_new"), "Open");
      actions.append(primary);
      if (needsUpdate(reg)) actions.append(h("button", { class: "btn tonal", type: "button", onclick: doInstall(`${a.name} updated`) }, mi("update"), "Update"));
      actions.append(h("button", { class: "btn tonal", type: "button", onclick: guard(() => uninstall(reg.id), `${a.name} removed`) }, mi("delete"), "Remove"));
    }
  }
  if (a.install.download) {
    const d = a.install.download;
    const link = h("a", { class: reg ? "st-link-btn tonal" : "st-link-btn", href: d.url, download: d.name ?? "" }, mi("download"), `Download${d.size ? ` (${fmt(d.size)})` : ""}`);
    actions.append(link);
    primary ??= link;
  }
  if (a.install.agent) {
    const ag = a.install.agent;
    const call = (action: "install" | "remove") =>
      guard(async () => {
        const res = await fetch(`${s.agent}/api/pkg`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manager: ag.manager, name: ag.name, action }) });
        if (!res.ok) throw new Error(`the agent answered ${res.status}`);
        const next = commandInstalled();
        if (action === "install") next[a.id] = { version: a.version, at: new Date().toISOString() };
        else delete next[a.id];
        saveCommandInstalled(next);
      }, action === "install" ? `${a.name} installed with ${ag.manager}` : `${a.name} removed`);
    if (s.agent !== undefined) {
      const done = !!commandInstalled()[a.id];
      const b = done
        ? h("button", { class: "btn tonal", type: "button", onclick: call("remove") }, mi("delete"), `Uninstall (${ag.manager})`)
        : h("button", { class: "btn", type: "button", onclick: call("install") }, mi("download"), `Install with ${ag.manager}`);
      actions.append(b);
      primary ??= b;
    }
  }
  box.append(actions, status, progress);
  const cmd = commandBox(a);
  if (cmd) {
    box.append(h("h3", {}, s.agent === undefined && a.install.agent ? "Install from a terminal" : "Or run it yourself"), cmd);
    if (s.agent === undefined && a.install.agent) box.append(h("p", { class: "st-note" }, "No Bun OS agent is connected, so one-click install is off. Connect one in Sources, or copy the command."));
    primary ??= cmd.querySelector<HTMLElement>("button") ?? undefined;
    const src = sourceById(s.catalog, a.source);
    if (src?.setup)
      box.append(
        h(
          "details",
          { class: "st-setup" },
          h("summary", {}, `First time with ${src.label}? Add the repository`),
          h("div", { class: "st-cmd" }, h("code", { tabindex: "0" }, src.setup), h("button", { class: "st-link", type: "button", onclick: (e: Event) => copy(src.setup!, e.currentTarget as HTMLElement) }, "Copy")),
        ),
      );
  }
  if (primary) primaries.set(box, primary);
  return box;
}

/** Bottom bar that appears once the install group has scrolled out of view. */
export function stickyBar(s: Store, a: StoreApp): Node | null {
  const bar = h("div", { class: "st-sticky", hidden: true, "aria-hidden": "true" });
  queueMicrotask(() => {
    const group = bar.parentElement?.querySelector<HTMLElement>("[data-install]");
    const primary = group && primaries.get(group);
    if (!group || !primary) return;
    const label = primary.textContent?.trim() || "Install";
    bar.append(
      h("span", { class: "st-name" }, a.name),
      h("button", { class: "btn", type: "button", tabindex: "-1", onclick: () => (group.scrollIntoView({ block: "center" }), primary.click()) }, label.startsWith("Copy") ? "Install" : label),
    );
    const root = bar.closest(".st-main");
    new IntersectionObserver(([e]) => {
      bar.hidden = !!e?.isIntersecting;
    }, { root, threshold: 0 }).observe(group);
  });
  void s;
  return bar;
}
