#!/usr/bin/env bun
// Generates the service and API map of the monorepo: every direct member of crates/, packages/, apps/ and cloud/
// classified by what it exposes (HTTP API, MCP, A2A, CLI, OpenAPI), linked to the systemd units that run it, the
// ports it binds and the public hosts nginx routes to it.
//   bun scripts/service-map.ts            write docs/generated/services.json and docs/ops/SERVICES.md
//   bun scripts/service-map.ts --check    exit 1 when the committed outputs are stale
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const groups = ["crates", "packages", "apps", "cloud"];
const SKIP = new Set(["node_modules", "target", "dist", "build", ".git", "vendor", "fixtures", "test", "tests"]);

type Kind = "http" | "mcp" | "a2a" | "cli" | "openapi" | "wasm" | "lib";
type Member = {
  path: string;
  name: string;
  lang: "rust" | "bun" | "mixed";
  kinds: Kind[];
  bins: string[];
  ports: number[];
  unitPorts: number[];
  routes: string[];
  units: string[];
  hosts: string[];
  description?: string;
};

async function exists(p: string) {
  return Bun.file(p).exists();
}

async function* sources(dir: string, exts: string[], depth = 0): AsyncGenerator<string> {
  if (depth > 6) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p, exts, depth + 1);
    else if (exts.some(x => e.name.endsWith(x)) && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) yield p;
  }
}

const rustHttp = /^\s*(axum|actix-web|poem|warp|salvo|rocket)\s*=/m;
const rustMcp = /^\s*rmcp\s*=/m;
const rustOpenapi = /^\s*(utoipa|aide|poem-openapi|okapi)\s*=/m;
const portRe = /(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::\]|PORT[^\n]{0,24}?)[:= "']+(\d{4,5})\b/g;
const rustRoute = /\.route\(\s*"([^"]+)"/g;
const tsRoute =
  /(?:pathname\s*===?\s*|case\s+|\.(?:get|post|put|delete|patch|route)\(\s*)["'`](\/(?:api|v\d|mcp|a2a|health)[^"'`]*)["'`]/g;

async function scanMember(group: string, dir: string): Promise<Member | undefined> {
  const cargo = join(dir, "Cargo.toml");
  const pkg = join(dir, "package.json");
  const hasCargo = await exists(cargo);
  const hasPkg = await exists(pkg);
  if (!hasCargo && !hasPkg) return;
  const kinds = new Set<Kind>();
  const bins = new Set<string>();
  const ports = new Set<number>();
  const routes = new Set<string>();
  let name = dir.split(/[\\/]/).pop()!;
  let description: string | undefined;

  if (hasCargo) {
    const toml = await Bun.file(cargo).text();
    name = /^\s*name\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? name;
    description = /^\s*description\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
    if (rustHttp.test(toml)) kinds.add("http");
    if (rustMcp.test(toml)) kinds.add("mcp");
    if (rustOpenapi.test(toml)) kinds.add("openapi");
    if (/cdylib/.test(toml) && /wasm-bindgen/.test(toml)) kinds.add("wasm");
    for (const m of toml.matchAll(/\[\[bin\]\][^[]*?name\s*=\s*"([^"]+)"/g)) bins.add(m[1]);
    if (bins.size === 0 && (await exists(join(dir, "src", "main.rs")))) bins.add(name);
    for await (const f of sources(join(dir, "src"), [".rs"])) {
      const text = await Bun.file(f).text();
      for (const m of text.matchAll(rustRoute)) routes.add(m[1]);
      for (const m of text.matchAll(portRe)) ports.add(Number(m[1]));
      if (/hyper::server|TcpListener::bind/.test(text) && !kinds.has("http") && /http/i.test(text)) kinds.add("http");
    }
  }
  if (hasPkg) {
    const json = (await Bun.file(pkg).json()) as {
      name?: string;
      description?: string;
      bin?: string | Record<string, string>;
      dependencies?: Record<string, string>;
    };
    if (!hasCargo && json.name) name = json.name;
    description ??= json.description;
    if (json.bin) for (const b of typeof json.bin === "string" ? [name] : Object.keys(json.bin)) bins.add(b);
    if (json.dependencies?.["@modelcontextprotocol/sdk"]) kinds.add("mcp");
    for await (const f of sources(dir, [".ts", ".tsx", ".mjs"])) {
      const text = await Bun.file(f).text();
      if (/Bun\.serve\(|new Hono\(|new Elysia\(/.test(text)) kinds.add("http");
      for (const m of text.matchAll(tsRoute)) routes.add(m[1]);
      if (/Bun\.serve\(/.test(text)) for (const m of text.matchAll(portRe)) ports.add(Number(m[1]));
    }
  }
  for (const f of ["openapi.json", "openapi.yaml", "openapi.yml"]) if (await exists(join(dir, f))) kinds.add("openapi");
  if (/(^|[-/@])mcp([-/]|$)/.test(name)) kinds.add("mcp");
  if (/(^|[-/@])a2a([-/]|$)/.test(name)) kinds.add("a2a");
  if (bins.size) kinds.add("cli");
  if (kinds.size === 0) kinds.add("lib");
  return {
    path: relative(root, dir).replaceAll("\\", "/"),
    name,
    lang: hasCargo && hasPkg ? "mixed" : hasCargo ? "rust" : "bun",
    kinds: [...kinds].sort(),
    bins: [...bins].sort(),
    ports: [...ports].filter(p => p >= 1024 && p < 65536).sort((a, b) => a - b),
    routes: [...routes].sort().slice(0, 40),
    unitPorts: [],
    units: [],
    hosts: [],
    description,
  };
}

type Unit = { name: string; exec: string; ports: number[] };

async function scanUnits(): Promise<Unit[]> {
  const units: Unit[] = [];
  for await (const f of sources(join(root, "infra", "config", "host"), [".service"])) {
    const text = await Bun.file(f).text();
    const exec = /^ExecStart=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
    const ports = [...text.matchAll(/(?:127\.0\.0\.1|0\.0\.0\.0|PORT=|--port[ =]|:)(\d{4,5})\b/g)].map(m =>
      Number(m[1]),
    );
    units.push({ name: f.split(/[\\/]/).pop()!, exec, ports: [...new Set(ports)] });
  }
  return units;
}

type Route = { host: string; port: number };

async function scanNginx(): Promise<Route[]> {
  const routes: Route[] = [];
  for await (const f of sources(join(root, "infra", "config", "host", "nginx"), [".conf", ".inc", ""])) {
    const text = await Bun.file(f).text();
    const upstreams = new Map<string, number>();
    for (const m of text.matchAll(/upstream\s+(\S+)\s*\{[^}]*?server\s+[\d.]+:(\d+)/g))
      upstreams.set(m[1], Number(m[2]));
    for (const block of text.split(/\bserver\s*\{/).slice(1)) {
      const names =
        /server_name\s+([^;]+);/
          .exec(block)?.[1]
          ?.split(/\s+/)
          .filter(n => n && n !== "_") ?? [];
      for (const m of block.matchAll(/proxy_pass\s+https?:\/\/([^/;\s]+)/g)) {
        const target = m[1];
        const port = upstreams.get(target) ?? Number(/:(\d+)$/.exec(target)?.[1]);
        if (port) for (const host of names) routes.push({ host, port });
      }
    }
  }
  return routes;
}

const members: Member[] = [];
for (const g of groups) {
  let entries;
  try {
    entries = await readdir(join(root, g), { withFileTypes: true });
  } catch {
    continue;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const m = await scanMember(g, join(root, g, e.name));
    if (m) members.push(m);
  }
}
const units = await scanUnits();
const nginx = await scanNginx();
for (const m of members) {
  for (const u of units) {
    const bin =
      u.exec
        .split(/\s+/)
        .find(t => !t.startsWith("-") && !t.includes("="))
        ?.split("/")
        .pop() ?? "";
    if (m.bins.includes(bin) || u.exec.includes(`/${m.path}/`) || u.exec.includes(` ${m.path}/`)) {
      m.units.push(u.name);
      for (const p of u.ports) if (!m.unitPorts.includes(p)) m.unitPorts.push(p);
    }
  }
  m.units.sort();
  m.unitPorts.sort((a, b) => a - b);
  m.hosts = [...new Set(nginx.filter(r => m.unitPorts.includes(r.port)).map(r => r.host))].sort();
}
members.sort((a, b) => a.path.localeCompare(b.path));

const services = members.filter(m => m.kinds.some(k => k === "http" || k === "mcp" || k === "a2a"));
const count = (k: Kind) => members.filter(m => m.kinds.includes(k)).length;
const json = `${JSON.stringify(
  {
    schema: 1,
    generator: "scripts/service-map.ts",
    totals: Object.fromEntries(
      (["http", "mcp", "a2a", "cli", "openapi", "wasm", "lib"] as Kind[]).map(k => [k, count(k)]),
    ),
    nginx,
    members,
  },
  null,
  2,
)}\n`;

const esc = (s: string) => s.replaceAll("|", "\\|");
const id = (s: string) => s.replace(/[^A-Za-z0-9]/g, "_");
const graph = [
  "```mermaid",
  "flowchart LR",
  ...[...new Set(nginx.map(r => r.host))].sort().map(h => `  ${id(`h_${h}`)}(["${h}"])`),
  ...services
    .filter(s => s.hosts.length || s.units.length)
    .map(s => `  ${id(s.path)}["${s.name}<br/>${s.kinds.join(" ")}"]`),
  ...services.flatMap(s => s.hosts.map(h => `  ${id(`h_${h}`)} --> ${id(s.path)}`)),
  "```",
].join("\n");

const md = `# Services and APIs

Generated by \`bun scripts/service-map.ts\` from the source tree, \`infra/config/host\` units and nginx sites; do not
edit by hand. Machine-readable form: [\`docs/generated/services.json\`](../generated/services.json).

Totals over ${members.length} members: ${(["http", "mcp", "a2a", "cli", "openapi", "wasm"] as Kind[]).map(k => `${count(k)} ${k}`).join(", ")}.
An HTTP service without \`openapi\` has no published contract yet (target: every public API ships an OpenAPI 3.1
document, see [API.md](API.md)).

## Public routing

${graph}

## Service matrix

| Member | Lang | Exposes | Binaries | Deployed ports | Units | Public hosts | Routes (sample) |
| ------ | ---- | ------- | -------- | ----- | ----- | ------------ | --------------- |
${services
  .map(
    s =>
      `| \`${s.path}\` | ${s.lang} | ${s.kinds.filter(k => k !== "cli").join(", ")} | ${esc(s.bins.join(", "))} | ${s.unitPorts.join(", ")} | ${s.units.join(", ")} | ${s.hosts.join(", ")} | ${esc(
        s.routes
          .slice(0, 6)
          .map(r => `\`${r}\``)
          .join(" "),
      )} |`,
  )
  .join("\n")}

## Command-line tools

| Member | Lang | Binaries |
| ------ | ---- | -------- |
${members
  .filter(m => m.kinds.includes("cli") && !services.includes(m))
  .map(m => `| \`${m.path}\` | ${m.lang} | ${esc(m.bins.join(", "))} |`)
  .join("\n")}
`;

const outJson = join(root, "docs", "generated", "services.json");
const outMd = join(root, "docs", "ops", "SERVICES.md");
if (process.argv.includes("--check")) {
  const stale =
    (await Bun.file(outJson)
      .text()
      .catch(() => "")) !== json;
  if (stale) console.error("docs/generated/services.json is stale: run bun scripts/service-map.ts");
  process.exit(stale ? 1 : 0);
}
await Bun.write(outJson, json);
await Bun.write(outMd, md);
console.log(
  `members ${members.length}, services ${services.length}, units ${units.length}, nginx routes ${nginx.length} -> ${relative(root, outMd)}`,
);
