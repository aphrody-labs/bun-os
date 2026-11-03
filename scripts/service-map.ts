#!/usr/bin/env bun
// Generates the service and API map of the monorepo: every direct member of crates/, packages/, apps/ and cloud/
// classified by what it exposes (HTTP API, MCP, A2A, CLI, OpenAPI), linked to the systemd units that run it, the
// ports it binds and the public hosts nginx routes to it, plus the API catalogue of the gateway services
// (infra/fleet/api.toml): one OpenAPI 3.1 document per service, checked against the standard of docs/ops/API.md.
//   bun scripts/service-map.ts            write docs/generated/services.json, docs/generated/openapi/ and
//                                         docs/ops/SERVICES.md
//   bun scripts/service-map.ts --check    exit 1 when the committed outputs are stale or a document breaks the standard
//   bun scripts/service-map.ts --check-api   the same for the API catalogue only (the gate's api-standard step)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { checkDocument } from "../packages/bun-os-platform/src/api/index.ts";
import apiToml from "../infra/fleet/api.toml";

const root = join(import.meta.dir, "..");
const groups = ["crates", "packages", "apps", "cloud"];
const SKIP = new Set(["node_modules", "target", "dist", "build", ".git", "vendor", "fixtures", "test", "tests"]);

type Kind = "http" | "mcp" | "a2a" | "cli" | "openapi" | "wasm" | "lib";
/**
 * What an `http` member is: `gateway` (public through api.aphrody.com), `deployed` (a host unit runs it outside the
 * gateway), `server` (has a binary that binds a listener, not deployed), `library` (a router or listener embedded by
 * another server), `dev` (development, demo or test servers only), `client` (an HTTP dependency, no listener).
 */
type Role = "gateway" | "deployed" | "server" | "library" | "dev" | "client";
type Member = {
  path: string;
  name: string;
  lang: "rust" | "bun" | "mixed";
  kinds: Kind[];
  role?: Role;
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
const rustListen = /axum::serve\(|TcpListener::bind|HttpServer::new|warp::serve|Server::bind|tiny_http::Server/;
const tsRoute =
  /(?:pathname\s*===?\s*|case\s+|\.(?:get|post|put|delete|patch|route)\(\s*)["'`](\/(?:api|v\d|mcp|a2a|health)[^"'`]*)["'`]/g;
/** Bun.serve in these files is a development, demo or test server, not a deployable service. */
const devPath =
  /(^|\/)(scripts|demo|demos|test|tests|e2e|examples?|bench|fixtures|playground|storybook|tools)\/|(^|\/)(dev|preview)[-.]/;
const binPath = /(^|\/)(main\.rs|bin\/)/;

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
  let listenBin = false;
  let listenLib = false;
  let listenFromLib = false;
  let devServer = false;

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
      const rel = relative(join(dir, "src"), f).replaceAll("\\", "/");
      for (const m of text.matchAll(rustRoute)) routes.add(m[1]);
      for (const m of text.matchAll(portRe)) ports.add(Number(m[1]));
      if (/hyper::server|TcpListener::bind/.test(text) && !kinds.has("http") && /http/i.test(text)) kinds.add("http");
      if (rustListen.test(text)) {
        if (binPath.test(rel)) listenBin = true;
        else listenLib = listenFromLib = true;
      }
      if (/aphrody_http_error::api::/.test(text)) kinds.add("openapi");
      if (/\bRouter::new\(\)|-> (axum::)?Router\b/.test(text) && !binPath.test(rel)) listenLib = true;
    }
    // A library listener reached from the crate's own binary (`serve()` in lib.rs called by main.rs) is a server.
    if (listenFromLib && bins.size) listenBin = true;
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
      const rel = relative(dir, f).replaceAll("\\", "/");
      if (/Bun\.serve\(|new Hono\(|new Elysia\(/.test(text)) {
        kinds.add("http");
        if (devPath.test(rel)) devServer = true;
        else listenBin = true;
      }
      if (/\bdefineApi\(/.test(text) && !rel.startsWith("src/api/")) kinds.add("openapi");
      for (const m of text.matchAll(tsRoute)) routes.add(m[1]);
      if (/Bun\.serve\(/.test(text)) for (const m of text.matchAll(portRe)) ports.add(Number(m[1]));
    }
  }
  for (const f of ["openapi.json", "openapi.yaml", "openapi.yml"]) if (await exists(join(dir, f))) kinds.add("openapi");
  if (/(^|[-/@])mcp([-/]|$)/.test(name)) kinds.add("mcp");
  if (/(^|[-/@])a2a([-/]|$)/.test(name)) kinds.add("a2a");
  if (bins.size) kinds.add("cli");
  if (kinds.size === 0) kinds.add("lib");
  const role: Role | undefined = !kinds.has("http")
    ? undefined
    : listenBin
      ? "server"
      : listenLib
        ? "library"
        : devServer
          ? "dev"
          : "client";
  return {
    path: relative(root, dir).replaceAll("\\", "/"),
    name,
    lang: hasCargo && hasPkg ? "mixed" : hasCargo ? "rust" : "bun",
    kinds: [...kinds].sort(),
    role,
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

// ---------------------------------------------------------------------------------------------------------------
// API catalogue: the gateway services of infra/fleet/api.toml and their OpenAPI documents.

type GatewayService = {
  description: string;
  host: string;
  port: number;
  upstream?: string;
  realtime?: boolean;
  source?: string;
  openapi?: string;
  unit?: string;
};
const gatewayApi = apiToml as unknown as { domain: string; services: Record<string, GatewayService> };
const apiBase = `https://${gatewayApi.domain}/v1`;
const openapiDir = join(root, "docs", "generated", "openapi");
const violations: string[] = [];

type Entry = {
  name: string;
  description: string;
  base: string;
  openapi: string;
  health: string;
  source: string | null;
  unit: string | null;
  upstream: string;
  realtime: boolean;
  origin: "bun" | "cargo" | null;
  title: string | null;
  version: string | null;
  operations: number;
  paths: string[];
};

async function documentOf(name: string, s: GatewayService): Promise<Record<string, any> | null> {
  if (!s.openapi) return null;
  if (s.openapi === "cargo") {
    // Kept by the crate's openapi_snapshot_is_current test (APHRODY_OPENAPI_WRITE=1 cargo test).
    return Bun.file(join(openapiDir, `${name}.json`))
      .json()
      .catch(() => null);
  }
  const [file, exported] = s.openapi.split("#");
  const mod = (await import(join(root, file!))) as Record<string, { document?: Record<string, any> }>;
  return mod[exported!]?.document ?? null;
}

const catalogue: Entry[] = [];
const documents = new Map<string, Record<string, any>>();
for (const [name, s] of Object.entries(gatewayApi.services).sort(([a], [b]) => a.localeCompare(b))) {
  let doc: Record<string, any> | null = null;
  try {
    doc = await documentOf(name, s);
  } catch (e) {
    violations.push(`${name}: OpenAPI document of ${s.openapi} failed to load: ${(e as Error).message}`);
  }
  if (!doc) violations.push(`${name}: no OpenAPI document (set openapi in infra/fleet/api.toml)`);
  else {
    for (const v of checkDocument(doc, name)) violations.push(`${name}: ${v}`);
    documents.set(name, doc);
  }
  const ops = doc
    ? Object.values(doc.paths ?? {}).reduce<number>(
        (n, item) => n + Object.keys(item as object).filter(k => /^(get|put|post|delete|patch|head)$/.test(k)).length,
        0,
      )
    : 0;
  catalogue.push({
    name,
    description: s.description,
    base: `${apiBase}/${name}/`,
    openapi: `${apiBase}/${name}/openapi.json`,
    health: `${apiBase}/${name}/health`,
    source: s.source ?? null,
    unit: s.unit ?? null,
    upstream: s.upstream ?? "/",
    realtime: !!s.realtime,
    origin: s.openapi === "cargo" ? "cargo" : s.openapi ? "bun" : null,
    title: doc?.info?.title ?? null,
    version: doc?.info?.version ?? null,
    operations: ops,
    paths: Object.keys(doc?.paths ?? {}),
  });
}

/** One document of every service: paths under /<service>, operation ids and tags prefixed. */
function merged(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const tags: { name: string; description: string }[] = [];
  const groups: { name: string; tags: string[] }[] = [];
  let components: Record<string, any> = {};
  for (const [name, doc] of documents) {
    const own = new Set<string>();
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      const copy: Record<string, any> = {};
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        const tagged = (op.tags ?? [name]).map((t: string) => `${name}/${t}`);
        tagged.forEach((t: string) => own.add(t));
        copy[method] = { ...op, operationId: `${name}_${op.operationId}`, tags: tagged };
      }
      paths[`/${name}${path === "/" ? "/" : path}`] = copy;
    }
    for (const t of [...own].sort()) tags.push({ name: t, description: `${doc.info?.title}: ${t.split("/")[1]}` });
    groups.push({ name: doc.info?.title ?? name, tags: [...own].sort() });
    components = {
      schemas: { ...components.schemas, ...doc.components?.schemas },
      responses: { ...components.responses, ...doc.components?.responses },
      ...(doc.components?.securitySchemes || components.securitySchemes
        ? { securitySchemes: { ...components.securitySchemes, ...doc.components?.securitySchemes } }
        : {}),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Bun OS API",
      version: "1",
      description: `Every service behind ${gatewayApi.domain}, one document (docs/ops/API.md). Each service also serves its own document at /v1/<service>/openapi.json.`,
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
    },
    servers: [{ url: apiBase, description: "Bun OS API gateway" }],
    tags,
    "x-tagGroups": groups,
    paths,
    components,
  };
}

const index = {
  schema: 1,
  generator: "scripts/service-map.ts",
  gateway: `${apiBase}/`,
  standard: "https://github.com/aphrody-labs/bun-os/blob/main/docs/ops/API.md",
  openapi: `${apiBase}/openapi.json`,
  services: catalogue,
};

// ---------------------------------------------------------------------------------------------------------------

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
const gatewaySources = new Map(
  Object.entries(gatewayApi.services)
    .filter(([, s]) => s.source)
    .map(([n, s]) => [s.source!, n]),
);
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
  if (gatewaySources.has(m.path)) {
    if (!m.kinds.includes("http")) m.kinds.push("http");
    if (!m.kinds.includes("openapi") && documents.has(gatewaySources.get(m.path)!)) m.kinds.push("openapi");
    m.kinds.sort();
    m.role = "gateway";
  } else if (m.role && m.units.length) m.role = "deployed";
}
members.sort((a, b) => a.path.localeCompare(b.path));

const services = members.filter(m => m.kinds.some(k => k === "http" || k === "mcp" || k === "a2a"));
const count = (k: Kind) => members.filter(m => m.kinds.includes(k)).length;
const ROLES: Role[] = ["gateway", "deployed", "server", "library", "dev", "client"];
const http = members.filter(m => m.kinds.includes("http"));
const byRole = Object.fromEntries(ROLES.map(r => [r, http.filter(m => m.role === r).length]));
const json = `${JSON.stringify(
  {
    schema: 2,
    generator: "scripts/service-map.ts",
    totals: Object.fromEntries(
      (["http", "mcp", "a2a", "cli", "openapi", "wasm", "lib"] as Kind[]).map(k => [k, count(k)]),
    ),
    http: byRole,
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
  `  api(["${gatewayApi.domain}"])`,
  ...[...new Set(nginx.map(r => r.host))].sort().map(h => `  ${id(`h_${h}`)}(["${h}"])`),
  ...services
    .filter(s => s.hosts.length || s.units.length || s.role === "gateway")
    .map(s => `  ${id(s.path)}["${s.name}<br/>${s.kinds.join(" ")}"]`),
  ...catalogue.filter(e => e.source).map(e => `  api -- "/v1/${e.name}/" --> ${id(e.source!)}`),
  ...services.flatMap(s => s.hosts.map(h => `  ${id(`h_${h}`)} --> ${id(s.path)}`)),
  "```",
].join("\n");

const ROLE_TEXT: Record<Role, string> = {
  gateway: "public through the API gateway; OpenAPI document, `/health` and problem+json errors required",
  deployed: "run by a host unit outside the gateway (internal, loopback or host-local)",
  server: "a binary that binds a listener but is not deployed (desktop apps, local tools, standalone servers)",
  library: "a router or listener embedded by another server (merged into its document when routed)",
  dev: "development, demo or test servers only",
  client: "uses an HTTP framework or client without binding a listener",
};

const md = `# Services and APIs

Generated by \`bun scripts/service-map.ts\` from the source tree, \`infra/config/host\` units, nginx sites and
\`infra/fleet/api.toml\`; do not edit by hand. Machine-readable form:
[\`docs/generated/services.json\`](../generated/services.json); API catalogue:
[\`docs/generated/openapi/\`](../generated/openapi/index.json), served at ${apiBase}/.

Totals over ${members.length} members: ${(["http", "mcp", "a2a", "cli", "openapi", "wasm"] as Kind[]).map(k => `${count(k)} ${k}`).join(", ")}.
Every service routed by the gateway publishes an OpenAPI 3.1 document, answers \`/health\` in the standard shape and
returns problem+json errors ([API.md](API.md)); \`bun scripts/service-map.ts --check\` fails otherwise.

## API catalogue

| Service | Base | OpenAPI | Operations | Source | Unit |
| ------- | ---- | ------- | ---------- | ------ | ---- |
${catalogue
  .map(
    e =>
      `| ${e.name} | \`${e.base}\` | [${e.origin ?? "missing"}](../generated/openapi/${e.name}.json) | ${e.operations} | \`${e.source ?? ""}\` | ${e.unit ?? ""} |`,
  )
  .join("\n")}

The merged document of every service is [\`openapi.json\`](../generated/openapi/openapi.json)
(${apiBase}/openapi.json).

## HTTP members by role

| Role | Members | Meaning |
| ---- | ------- | ------- |
${ROLES.map(r => `| ${r} | ${byRole[r]} | ${ROLE_TEXT[r]} |`).join("\n")}

${ROLES.filter(r => r !== "gateway")
  .map(
    r =>
      `- **${r}**: ${
        http
          .filter(m => m.role === r)
          .map(m => `\`${m.path}\``)
          .join(", ") || "none"
      }`,
  )
  .join("\n")}

## Public routing

${graph}

## Service matrix

| Member | Lang | Role | Exposes | Binaries | Deployed ports | Units | Public hosts | Routes (sample) |
| ------ | ---- | ---- | ------- | -------- | ----- | ----- | ------------ | --------------- |
${services
  .map(
    s =>
      `| \`${s.path}\` | ${s.lang} | ${s.role ?? ""} | ${s.kinds.filter(k => k !== "cli").join(", ")} | ${esc(s.bins.join(", "))} | ${s.unitPorts.join(", ")} | ${s.units.join(", ")} | ${s.hosts.join(", ")} | ${esc(
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

const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const outputs = new Map<string, string>([
  [join(root, "docs", "generated", "services.json"), json],
  [join(root, "docs", "ops", "SERVICES.md"), md],
  [join(openapiDir, "index.json"), pretty(index)],
  [join(openapiDir, "openapi.json"), pretty(merged())],
]);
// Bun documents are generated here; Rust ones are written by their crate's snapshot test and only validated.
for (const [name, s] of Object.entries(gatewayApi.services))
  if (s.openapi && s.openapi !== "cargo" && documents.has(name))
    outputs.set(join(openapiDir, `${name}.json`), pretty(documents.get(name)));

// The outputs are committed as the repository formatter writes them (the gate's `bun fmt --check`).
{
  const stage = mkdtempSync(join(tmpdir(), "service-map-"));
  const staged = [...outputs.keys()].map((path, i) => {
    const file = join(stage, `${i}-${path.split(/[\\/]/).pop()}`);
    writeFileSync(file, outputs.get(path)!);
    return [path, file] as const;
  });
  const fmt = Bun.spawnSync(
    [
      process.execPath,
      "fmt",
      "--no-script",
      "--write",
      "--config",
      join(root, "bun-format.json"),
      ...staged.map(([, f]) => f),
    ],
    { cwd: stage, stdout: "ignore", stderr: "pipe" },
  );
  if (fmt.exitCode === 0) for (const [path, file] of staged) outputs.set(path, readFileSync(file, "utf8"));
  else console.error(`service-map: formatter failed, writing unformatted outputs\n${fmt.stderr.toString()}`);
  rmSync(stage, { recursive: true, force: true });
}

for (const v of violations) console.error(`api standard: ${v}`);
const apiOnly = process.argv.includes("--check-api");
if (apiOnly || process.argv.includes("--check")) {
  const stale: string[] = [];
  for (const [path, text] of outputs) {
    if (apiOnly && !path.startsWith(openapiDir)) continue;
    const committed = await Bun.file(path)
      .text()
      .catch(() => "");
    if (committed !== text) stale.push(relative(root, path).replaceAll("\\", "/"));
  }
  for (const f of stale) console.error(`${f} is stale: run bun scripts/service-map.ts`);
  process.exit(stale.length || violations.length ? 1 : 0);
}
for (const [path, text] of outputs) await Bun.write(path, text);
console.log(
  `members ${members.length}, services ${services.length}, http ${http.length} (${ROLES.map(r => `${byRole[r]} ${r}`).join(", ")}), ` +
    `gateway ${catalogue.length} with ${documents.size} OpenAPI documents, units ${units.length}, nginx routes ${nginx.length}` +
    (violations.length ? `, ${violations.length} violations` : ""),
);
