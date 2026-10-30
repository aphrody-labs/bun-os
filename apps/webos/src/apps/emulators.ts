// SPDX-License-Identifier: Apache-2.0
// Emulators: every emulator of the repository with its WebOS delivery mode and last qualification result
// (/api/emulators). WebAssembly cores run in an emulator window (iframe of /emulator.html); entries without a
// browser build show their real status and blocker.
import { h } from "../dom";
import css from "./emulators.css" with { type: "text" };

interface Row {
  id: string;
  name: string;
  systems: string[];
  mode: "wasm" | "v86" | "native";
  owner: string;
  license?: string;
  reason?: string;
  served: boolean;
  fixture?: { file: string; license: string; source: string };
  qualification: {
    status: "pass" | "fail" | "untested" | "unsupported";
    testedAt?: string;
    frames?: number;
    renderer?: string;
    audio?: string;
    saveState?: string;
    errors: string[];
    detail?: string;
  };
}
interface Listing {
  generatedAt: string | null;
  sourceCommit: string | null;
  totals: Record<"emulators" | "pass" | "fail" | "untested" | "unsupported", number>;
  emulators: Row[];
}

export async function emulatorsApp(root: HTMLElement, host: { open(id: string): boolean }) {
  if (!document.getElementById("emu-css")) document.head.append(h("style", { id: "emu-css" }, css));
  const list = h("div", { class: "emu-list" });
  const summary = h("div", { class: "emu-summary" }, "Loading…");
  const main = h("div", { class: "emu-main" }, h("div", { class: "emu-info" }, "Choose an emulator."));
  root.append(h("div", { class: "emu" }, h("div", { class: "emu-side" }, summary, list), main));

  const data = (await (await fetch("/api/emulators", { cache: "no-cache" })).json()) as Listing;
  const t = data.totals;
  summary.textContent = `${t.emulators} emulators: ${t.pass} qualified, ${t.fail} failing, ${t.untested} untested, ${t.unsupported} without a browser build. ${
    data.generatedAt ? `Last run ${new Date(data.generatedAt).toLocaleString()}` : "Never qualified"
  }${data.sourceCommit ? ` at ${data.sourceCommit.slice(0, 10)}` : ""}.`;

  const rows = new Map<string, HTMLElement>();
  function select(row: Row) {
    for (const [id, el] of rows) el.setAttribute("aria-current", String(id === row.id));
    const q = row.qualification;
    const mode =
      row.mode === "wasm" ? "WebAssembly in this browser" : row.mode === "v86" ? "x86 machine (Alpine Linux app)" : "Native only";
    const result = `${q.status}${q.testedAt ? `, ${new Date(q.testedAt).toLocaleString()}` : ""}${q.frames ? `, ${q.frames} frames` : ""}${
      q.renderer ? `, ${q.renderer}` : ""
    }${q.audio ? `, audio ${q.audio}` : ""}${q.saveState ? `, save state ${q.saveState}` : ""}`;
    const facts: [string, string][] = [
      ["Systems", row.systems.join(", ")],
      ["Mode", mode],
      ["Owner", row.owner],
      ["License", row.license ?? "see owner"],
      ["Served", row.mode === "wasm" ? (row.served ? "yes, from /emulation/" : "not built yet") : "n/a"],
      ["Qualification", result],
    ];
    if (row.fixture) facts.push(["Test ROM", `${row.fixture.file} (${row.fixture.license})`]);
    if (q.detail || row.reason) facts.push(["Note", q.detail ?? row.reason ?? ""]);
    if (q.errors.length) facts.push(["Errors", q.errors.slice(0, 5).join(" | ")]);
    const info = h(
      "div",
      { class: "emu-info" },
      h("h2", {}, row.name),
      h("dl", {}, ...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    );
    if (q.status === "pass" || q.status === "fail")
      info.append(
        h("img", {
          src: `/api/emulators/qualification/${row.id}.png`,
          alt: `${row.name} qualification frame`,
          onerror: (e: Event) => (e.target as HTMLElement).remove(),
        }),
      );
    if (row.mode === "wasm" && row.served) {
      info.style.maxHeight = "230px";
      main.replaceChildren(
        info,
        h("iframe", {
          src: `/emulator.html?core=${encodeURIComponent(row.id)}`,
          allow: "fullscreen; gamepad; autoplay; cross-origin-isolated",
          title: row.name,
        }),
      );
    } else {
      if (row.mode === "v86")
        info.append(h("button", { class: "btn", onclick: () => host.open("linux") }, "Open Alpine Linux"));
      main.replaceChildren(info);
    }
  }
  for (const row of data.emulators) {
    const el = h(
      "button",
      { class: "emu-row", onclick: () => select(row) },
      h("span", {}, row.name),
      h("span", { class: "emu-badge", "data-s": row.qualification.status }, row.qualification.status),
      h("small", {}, row.systems.join(", ")),
    );
    rows.set(row.id, el);
    list.append(el);
  }
  const first = data.emulators.find((r) => r.served) ?? data.emulators[0];
  if (first) select(first);
}
