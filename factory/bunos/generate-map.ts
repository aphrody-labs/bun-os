#!/usr/bin/env bun
/**
 * Generates docs/ARCHITECTURE-MAP.md and the pin table of docs/BUNCC.md from the repository, so no table is typed by hand:
 *   bun factory/bunos/generate-map.ts          rewrite both files
 *   bun factory/bunos/generate-map.ts --check  exit 1 if either is stale (no write)
 * Inputs: factory/bunos/architecture.json (curated: layers, entries, canonical owners), factory/bunos/components.json (runtime pin),
 * buncc.toolchain.json, rust-toolchain.toml, package.json, .github/workflows/*.yml, justfile, vendor/microsoft/PINS.json.
 * factory/bunos/consistency.ts validates the curated entries against the same facts.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dir, "../..");
const read = (path: string) => Bun.file(join(root, path)).text();
const json = async (path: string) => JSON.parse(await read(path));

export interface Entry {
  id: string;
  layer: string;
  title: string;
  owner: string;
  module: string | null;
  entry: string[];
  docs: string[];
  ci: string[];
  pins: string[];
  status: "built" | "ci-verified" | "unverified";
  pending?: boolean;
  covers?: string[];
  note?: string;
}
export interface Workflow {
  file: string;
  name: string;
  triggers: string;
  jobs: Record<string, string>;
  usesSetup: boolean;
  usesContainer: boolean;
}
export interface Facts {
  architecture: any;
  components: any;
  toolchain: any;
  rustChannel: string;
  packageManager: string;
  workflows: Workflow[];
  recipes: Map<string, string>;
  msPins: Record<string, any>;
}

export async function loadFacts(): Promise<Facts> {
  const architecture = await json("factory/bunos/architecture.json");
  const components = await json("factory/bunos/components.json");
  const toolchain = await json("buncc.toolchain.json");
  const rustChannel = (await read("rust-toolchain.toml")).match(/^channel\s*=\s*"([^"]+)"/m)?.[1] ?? "";
  const pkg = await json("package.json");
  const workflows: Workflow[] = [];
  const dir = join(root, ".github/workflows");
  for (const file of readdirSync(dir)
    .filter(f => /\.ya?ml$/.test(f))
    .sort()) {
    const text = await Bun.file(join(dir, file)).text();
    const doc = Bun.YAML.parse(text) as any;
    const on = doc.on ?? doc[true as unknown as string] ?? {};
    const events = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on);
    const parts = events.map((event: string) => {
      const cfg = (typeof on === "object" && !Array.isArray(on) ? on[event] : undefined) ?? {};
      const bits: string[] = [];
      if (cfg.branches) bits.push(cfg.branches.join(", "));
      if (cfg.paths)
        bits.push(
          `paths ${cfg.paths.length}: ${cfg.paths.slice(0, 2).join(", ")}${cfg.paths.length > 2 ? ", ..." : ""}`,
        );
      if (cfg.cron) bits.push(String(cfg.cron));
      return bits.length ? `${event} (${bits.join("; ")})` : event;
    });
    const jobs: Record<string, string> = {};
    for (const [id, job] of Object.entries<any>(doc.jobs ?? {})) jobs[id] = String(job.name ?? id);
    workflows.push({
      file,
      name: String(doc.name ?? file),
      triggers: parts.join(", "),
      jobs,
      usesSetup: text.includes("./.github/actions/setup-workspace") || text.includes("./.github/actions/setup-bun"),
      usesContainer: /^\s+container:|arch-chroot|docker run/m.test(text),
    });
  }
  const recipes = new Map<string, string>();
  const lines = (await read("justfile")).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^([a-z][a-z0-9-]*)(?:\s+\*?[A-Za-z_]\w*(?:="[^"]*"|=\S+)?)*\s*:(?!=)/);
    if (!m) continue;
    let doc = "";
    for (let j = i - 1; j >= 0 && lines[j]!.startsWith("["); j--)
      doc = lines[j]!.match(/^\[doc\('(.*)'\)\]$/)?.[1] ?? doc;
    if (!recipes.has(m[1]!) || doc) recipes.set(m[1]!, doc || recipes.get(m[1]!) || "");
  }
  const msPins = (await json("vendor/microsoft/PINS.json")).pins ?? {};
  return {
    architecture,
    components,
    toolchain,
    rustChannel,
    packageManager: pkg.packageManager ?? "",
    workflows,
    recipes,
    msPins,
  };
}

const cell = (s: string) => s.replace(/\|/g, "\\|");
const code = (items: string[]) => (items.length ? items.map(i => `\`${cell(i)}\``).join("<br>") : "-");

export function pinTable(f: Facts): string {
  const rows: string[][] = [
    [
      "Bun runtime",
      f.components.runtime.source.version,
      "`package.json` packageManager, `factory/bunos/components.json` runtime",
    ],
    ["Rust", f.rustChannel, "`rust-toolchain.toml`"],
  ];
  for (const [tool, spec] of Object.entries<any>(f.toolchain.tools)) {
    const bits = [`min ${spec.min}`];
    for (const key of Object.keys(spec).filter(k => k.startsWith("latest"))) bits.push(`${key} ${spec[key]}`);
    rows.push([tool, bits.join(", "), "`buncc.toolchain.json`"]);
  }
  if (f.toolchain.msvc) rows.push(["MSVC toolset", String(f.toolchain.msvc.toolset), "`buncc.toolchain.json`"]);
  const out = ["| Pin | Value | Source of truth |", "| --- | --- | --- |"];
  for (const [a, b, c] of rows) out.push(`| ${cell(a!)} | ${cell(b!)} | ${c} |`);
  return out.join("\n");
}

export function renderMap(f: Facts): string {
  const a = f.architecture;
  const entries: Entry[] = a.entries;
  const byLayer = (id: string) => entries.filter(e => e.layer === id);
  const L: string[] = [];
  L.push("# Architecture map", "");
  L.push(
    "Generated by `bun factory/bunos/generate-map.ts` from `factory/bunos/architecture.json` and the repository (workflows, justfile, pins); do not edit by hand. `just map` regenerates it, `buncc doctor --repo` fails when it is stale or when an entry points at something that does not exist.",
    "",
  );
  L.push(
    "Status: **built** = code present and unit-tested locally; **ci-verified** = the listed CI job passed on `os`; **unverified** = not run, or CI red; **pending** = announced by its owner, not landed.",
    "",
  );
  L.push("## Layers", "", "```text");
  const width = Math.max(...a.layers.map((l: any) => l.title.length)) + 2;
  a.layers.forEach((layer: any, i: number) => {
    const items = byLayer(layer.id)
      .map(e => e.id + (e.pending ? "*" : ""))
      .join(", ");
    L.push(`${layer.title.padEnd(width)}| ${items}`);
    if (i < a.layers.length - 1) L.push(`${" ".repeat(width)}v`);
  });
  L.push(
    "```",
    "",
    "`*` = pending. Each layer uses only the layers above it: the runtime is upstream Bun canary; everything else is TypeScript on Bun, Rust crates, shell for Linux image builds.",
    "",
  );
  L.push("## One way to do each thing", "", "| Capability | Owner | Entry |", "| --- | --- | --- |");
  for (const c of a.canonical ?? []) L.push(`| ${cell(c.capability)} | \`${c.owner}\` | \`${cell(c.entry)}\` |`);
  L.push("", "## Components", "");
  L.push(
    "| Layer | Component | Owner | Entry | Docs | CI | Pins | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const layer of a.layers)
    for (const e of byLayer(layer.id)) {
      const status = e.pending ? `${e.status} (pending)` : e.status;
      L.push(
        `| ${layer.id} | **${cell(e.id)}**: ${cell(e.title)}${e.note ? ` (${cell(e.note)})` : ""} | \`${e.owner}\` | ${code(e.entry)} | ${code(e.docs)} | ${code(e.ci)} | ${code(e.pins)} | ${status} |`,
      );
    }
  L.push("", "## Pins", "", pinTable(f), "");
  const ms = Object.entries<any>(f.msPins);
  if (ms.length)
    L.push(
      `Microsoft references (\`vendor/microsoft/PINS.json\`, ${ms.length} pins): ${ms.map(([k, v]) => `${k} ${v.ref}`).join(", ")}.`,
      "",
    );
  L.push("## CI", "");
  L.push("| Workflow | Trigger | Jobs | Proves (entries) | Bun setup |", "| --- | --- | --- | --- | --- |");
  for (const w of f.workflows) {
    const proves = entries.filter(e => e.ci.some(c => c.startsWith(`${w.file}#`))).map(e => e.id);
    const setup = w.usesSetup
      ? "setup-workspace"
      : (a.noBunSetup?.[w.file] ?? (w.usesContainer ? "container" : "none"));
    L.push(
      `| \`${w.file}\` (${cell(w.name)}) | ${cell(w.triggers)} | ${Object.keys(w.jobs)
        .map(j => `\`${j}\``)
        .join(", ")} | ${proves.join(", ") || "-"} | ${cell(setup)} |`,
    );
  }
  const pendingCi = entries.flatMap(e =>
    e.ci.filter(c => !f.workflows.some(w => c.startsWith(`${w.file}#`))).map(c => `\`${c.split("#")[0]}\` (${e.id})`),
  );
  if (pendingCi.length) L.push("", `Announced, not landed: ${[...new Set(pendingCi)].join(", ")}.`);
  L.push(
    "",
    `Required status checks for \`os\`: ${a.ci.required.map((r: string) => `\`${r}\``).join(", ")}. The one setup action is \`${a.ci.setupAction}\`; ${a.ci.note}`,
    "",
  );
  L.push("## Task entry (justfile)", "", "| Recipe | Does |", "| --- | --- |");
  for (const [name, doc] of f.recipes) L.push(`| \`just ${name}\` | ${cell(doc) || "-"} |`);
  L.push("");
  return L.join("\n");
}

export const PIN_BEGIN = "<!-- generated:pins begin (factory/bunos/generate-map.ts) -->";
export const PIN_END = "<!-- generated:pins end -->";

export function withPins(text: string, f: Facts): string {
  const block = `${PIN_BEGIN}\n${pinTable(f)}\n${PIN_END}`;
  const a = text.indexOf(PIN_BEGIN);
  const b = text.indexOf(PIN_END);
  if (a < 0 || b < a) throw new Error("docs/BUNCC.md: pin markers missing");
  return text.slice(0, a) + block + text.slice(b + PIN_END.length);
}

if (import.meta.main) {
  const checkOnly = process.argv.includes("--check");
  const f = await loadFacts();
  const targets: [string, string][] = [
    ["docs/ARCHITECTURE-MAP.md", renderMap(f)],
    ["docs/BUNCC.md", withPins(await read("docs/BUNCC.md"), f)],
  ];
  let stale = 0;
  for (const [path, next] of targets) {
    const now = existsSync(join(root, path)) ? (await read(path)).replace(/\r\n/g, "\n") : "";
    if (now === next.replace(/\r\n/g, "\n")) continue;
    stale++;
    if (checkOnly) console.error(`stale: ${path}`);
    else {
      await Bun.write(join(root, path), next);
      console.log(`updated: ${path}`);
    }
  }
  console.log(`architecture map: ${stale} stale file(s)`);
  process.exit(checkOnly && stale ? 1 : 0);
}
