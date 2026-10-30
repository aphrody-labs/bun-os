// SPDX-License-Identifier: Apache-2.0
// S08 Sources: every repository the Store serves with its URL, client setup, count and the result of the last
// install test (run in clean containers on the VPS), plus the Bun OS agent connection.
import { h } from "../../dom";
import { AGENT_KEY, copy, mi, type Store } from "./core";
import { badge } from "./parts";

export function viewSources(s: Store): HTMLElement {
  const { catalog, qual } = s;
  const agentInput = h("input", { class: "st-field", type: "url", placeholder: "https://your-agent.example (optional)", value: localStorage.getItem(AGENT_KEY) ?? "", "aria-label": "Bun OS agent URL" }) as HTMLInputElement;
  const results = qual?.results ?? [];
  const passing = results.filter((r) => r.ok).length;
  const out = h(
    "div",
    { class: "st-sources" },
    h("h1", {}, "Sources"),
    h("p", { class: "st-note" }, qual ? `${passing} of ${results.length} repository formats passed their last install test (${qual.generated.slice(0, 16).replace("T", " ")} UTC).` : "No install test has been recorded yet."),
    h(
      "section",
      { class: "st-source" },
      h("div", { class: "st-shelf-head" }, h("h2", {}, "Bun OS agent"), badge(s.agent === undefined ? "Not connected" : "Connected", s.agent === undefined ? "" : "ok")),
      h("p", { class: "st-note" }, s.agent === undefined ? "One-click install needs a Bun OS agent that answers /api/agent/status. Without one, every app still offers its command to copy." : `Installs go to ${s.agent || "this origin"}.`),
      h("div", { class: "st-agent" }, agentInput, h("button", { class: "btn tonal", type: "button", onclick: () => (localStorage.setItem(AGENT_KEY, agentInput.value.trim()), location.reload()) }, "Save and reconnect")),
    ),
  );
  for (const src of catalog.sources) {
    const r = results.find((x) => x.format === (src.id === "arch" ? "pacman" : src.id));
    const steps = r
      ? h(
          "details",
          { class: "st-qual" },
          h("summary", {}, `Install test ${r.ok ? "passed" : "failed"} · ${r.at.slice(0, 16).replace("T", " ")} UTC${r.image ? ` · ${r.image}` : ""}`),
          ...r.steps.map((st) => h("div", { class: `st-step ${st.ok ? "ok" : "err"}` }, h("strong", {}, `${st.ok ? "Passed" : "Failed"}: ${st.name} (${st.ms} ms)`), h("pre", { tabindex: "0" }, st.log || "(no output)"))),
        )
      : h("p", { class: "st-note" }, src.id === "bunos" ? "Browser apps are verified by SHA-256 on every install." : src.id === "arch" ? "Installed from upstream repositories; the Bun OS pacman result is shown on its own card." : "Not tested yet.");
    const row = (text: string, name: string) =>
      h("div", { class: "st-cmd" }, h("code", { tabindex: "0" }, text), h("button", { class: "st-link", type: "button", "aria-label": `Copy ${name}`, onclick: (e: Event) => copy(text, e.currentTarget as HTMLElement) }, "Copy"));
    out.append(
      h(
        "section",
        { class: "st-source", "aria-label": src.label },
        h(
          "div",
          { class: "st-shelf-head" },
          h("h2", {}, src.label),
          r ? badge(r.ok ? "Install test passed" : "Install test failed", r.ok ? "ok" : "err") : null,
          h("button", { class: "st-link", type: "button", onclick: () => s.go("collection", { source: src.id, category: "", tab: "apps" }) }, `Browse ${src.count}`),
        ),
        h("p", { class: "st-note" }, src.desc),
        src.repo ? h("div", {}, h("span", { class: "st-cmd-id" }, "Repository"), row(src.repo, "the repository URL")) : null,
        src.setup ? h("div", {}, h("span", { class: "st-cmd-id" }, "Set up your client"), row(src.setup, "the setup command")) : null,
        steps,
      ),
    );
  }
  out.append(h("p", { class: "st-note" }, mi("verified"), " Checksums and signing keys: every repository publishes its public key next to the packages; private keys never leave the server."));
  return out;
}
