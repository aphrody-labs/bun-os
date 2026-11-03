#!/usr/bin/env bun
// Renders, applies, deploys and verifies the public API gateway from infra/fleet/api.toml (docs/ops/API.md).
//   bun infra/fleet/api.ts render [--tls]     write infra/fleet/generated/nginx/{gateway,mesh-<host>}.conf
//   bun infra/fleet/api.ts apply              install nginx and the API catalogue on the gateway, certificate, sites
//   bun infra/fleet/api.ts deploy <service>   release one service from origin/main: build, install, restart, gate
//                                             on <upstream>health reporting the commit, roll back on failure
//   bun infra/fleet/api.ts verify [service]   check https://<domain>/v1/<service>/{health,openapi.json} against
//                                             the standard and the committed document
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { checkDocument } from "../../packages/bun-os-platform/src/api/index.ts";
import apiToml from "./api.toml";
import fleetToml from "./fleet.toml";

type Deploy = {
  kind: "bun" | "cargo" | "command";
  entry?: string;
  install?: string;
  unit_file?: string;
  package?: string;
  bin?: string;
  features?: string;
  command?: string;
};
type Service = {
  description: string;
  host: string;
  port: number;
  upstream?: string;
  health?: string;
  realtime?: boolean;
  source?: string;
  openapi?: string;
  unit?: string;
  deploy?: Deploy;
};
type Api = {
  domain: string;
  gateway: string;
  mesh_port: number;
  origins: string[];
  catalogue_root: string;
  services: Record<string, Service>;
};
const api = apiToml as unknown as Api;
const fleet = fleetToml as unknown as { hosts: Record<string, { mesh_ip: string; user?: string }> };
const repo = join(import.meta.dir, "..", "..");
const outDir = join(import.meta.dir, "generated", "nginx");
const catalogueDir = join(repo, "docs", "generated", "openapi");
const meshCidr = "10.200.77.0/24";
const webroot = "/var/www/letsencrypt";
const upstreamOf = (s: Service) => (s.upstream ?? "/").replace(/^\/?/, "/").replace(/\/?$/, "/");

const proxyCommon = (realtime: boolean) => `        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $fleet_connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /v1/$fleet_api_service;
        proxy_set_header traceparent $http_traceparent;
${realtime ? "        proxy_buffering off;\n        proxy_read_timeout 1h;\n        proxy_send_timeout 1h;\n" : "        proxy_read_timeout 60s;\n"}`;

// The gateway is the only CORS authority: upstream Access-Control-* headers are dropped and preflights answered here.
const cors = `        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Credentials;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Access-Control-Expose-Headers;
        add_header Access-Control-Allow-Origin $fleet_api_origin always;
        add_header Access-Control-Allow-Credentials true always;
        add_header Access-Control-Expose-Headers "Content-Type, Retry-After, traceparent" always;
        add_header Vary Origin always;
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin $fleet_api_origin always;
            add_header Access-Control-Allow-Credentials true always;
            add_header Access-Control-Allow-Methods "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Authorization, Content-Type, traceparent, Last-Event-ID" always;
            add_header Access-Control-Max-Age 86400 always;
            add_header Vary Origin always;
            return 204;
        }
`;

function gateway(tls: boolean): string {
  const names = Object.keys(api.services).sort();
  const locations = names
    .map(name => {
      const s = api.services[name];
      const local = s.host === api.gateway;
      const upstream = local
        ? `http://127.0.0.1:${s.port}${upstreamOf(s)}`
        : `http://${fleet.hosts[s.host]?.mesh_ip ?? die(`unknown host ${s.host}`)}:${api.mesh_port}/v1/${name}/`;
      return `    # ${s.description} (${s.host}:${s.port}${upstreamOf(s)})
    location /v1/${name}/ {
        set $fleet_api_service ${name};
        proxy_pass ${upstream};
${proxyCommon(!!s.realtime)}${cors}    }`;
    })
    .join("\n\n");
  const body = `    location = /v1/health {
        default_type application/json;
        add_header Cache-Control no-store always;
        return 200 '{"status":"ok","service":"gateway","version":"1"}';
    }

    # API catalogue (docs/generated/openapi, written by scripts/service-map.ts and installed by \`api.ts apply\`):
    # /v1/ the index, /v1/openapi.json the merged document, /v1/openapi/<service>.json the committed documents.
    location = /v1/ {
        alias ${api.catalogue_root}/index.json;
        default_type application/json;
        add_header Access-Control-Allow-Origin * always;
        add_header Cache-Control "public, max-age=60" always;
    }

    location = /v1/openapi.json {
        alias ${api.catalogue_root}/openapi.json;
        default_type application/json;
        add_header Access-Control-Allow-Origin * always;
        add_header Cache-Control "public, max-age=60" always;
    }

    location /v1/openapi/ {
        alias ${api.catalogue_root}/;
        default_type application/json;
        add_header Access-Control-Allow-Origin * always;
        add_header Cache-Control "public, max-age=60" always;
    }

${locations}

    location / {
        default_type application/problem+json;
        return 404 '{"type":"about:blank","title":"Not Found","status":404,"detail":"See https://${api.domain}/v1/ for the API catalogue"}';
    }`;
  const acme = `    location /.well-known/acme-challenge/ {
        root ${webroot};
    }`;
  return `# Generated by \`bun infra/fleet/api.ts render\` from infra/fleet/api.toml. Do not edit on the host.
map $http_upgrade $fleet_connection_upgrade {
    default upgrade;
    '' close;
}

map $http_origin $fleet_api_origin {
    default "";
${api.origins.map(o => `    "${o}" $http_origin;`).join("\n")}
}

server {
    listen 80;
    listen [::]:80;
    server_name ${api.domain};
${acme}
${tls ? "\n    location / {\n        return 301 https://$host$request_uri;\n    }\n" : `\n${body}\n`}}
${
  tls
    ? `
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${api.domain};
    ssl_certificate /etc/letsencrypt/live/${api.domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${api.domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=63072000" always;
    set $fleet_api_service "";
${acme}

${body}
}
`
    : ""
}`;
}

function meshListener(host: string): string {
  const ip = fleet.hosts[host].mesh_ip;
  const services = Object.entries(api.services).filter(([, s]) => s.host === host);
  return `# Generated by \`bun infra/fleet/api.ts render\` from infra/fleet/api.toml. Do not edit on the host.
# Mesh-only listener: the API gateway (${api.gateway}) reaches the loopback services of ${host} through it.
map $http_upgrade $fleet_connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen ${ip}:${api.mesh_port};
    allow ${meshCidr};
    deny all;
    set $fleet_api_service "";

${services
  .map(
    ([name, s]) => `    location /v1/${name}/ {
        set $fleet_api_service ${name};
        proxy_pass http://127.0.0.1:${s.port}${upstreamOf(s)};
${proxyCommon(!!s.realtime)}    }`,
  )
  .join("\n\n")}
}
`;
}

function die(message: string): never {
  console.error(`api: ${message}`);
  process.exit(2);
}

const meshHosts = [...new Set(Object.values(api.services).map(s => s.host))].filter(h => h !== api.gateway);

async function render(tls: boolean): Promise<Record<string, string>> {
  await mkdir(outDir, { recursive: true });
  const files: Record<string, string> = { "gateway.conf": gateway(tls) };
  for (const h of meshHosts) files[`mesh-${h}.conf`] = meshListener(h);
  for (const [f, text] of Object.entries(files)) await Bun.write(join(outDir, f), text);
  return files;
}

async function ssh(host: string, script: string, input?: Uint8Array): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["ssh", host, input ? script : "bash -s"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  if (input) proc.stdin.write(input);
  else proc.stdin.write(`fleet_main() {\nset -euo pipefail\n${script}\n}\nfleet_main </dev/null\n`);
  await proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, out };
}

async function install(host: string, file: string, text: string): Promise<void> {
  const { code } = await ssh(
    host,
    `command -v nginx >/dev/null || { sudo -n apt-get update -qq && sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx >/dev/null; }
sudo -n install -d ${webroot}
sudo -n cp -f /etc/nginx/conf.d/${file} /etc/nginx/conf.d/.${file}.prev 2>/dev/null || true
sudo -n tee /etc/nginx/conf.d/${file} >/dev/null <<'CONF'
${text}CONF
if ! sudo -n nginx -t 2>&1 | tail -1; then
  sudo -n mv -f /etc/nginx/conf.d/.${file}.prev /etc/nginx/conf.d/${file} 2>/dev/null || true
  echo "nginx rejected ${file}; previous version restored" >&2
  exit 1
fi
sudo -n rm -f /etc/nginx/conf.d/.${file}.prev
sudo -n systemctl enable --now nginx >/dev/null 2>&1
sudo -n systemctl reload nginx`,
  );
  if (code !== 0) die(`installing ${file} on ${host} failed`);
  console.log(`${host}: /etc/nginx/conf.d/${file} loaded`);
}

/** Upload docs/generated/openapi to the catalogue root of the gateway. */
async function installCatalogue(): Promise<void> {
  const files = (await readdir(catalogueDir)).filter(f => f.endsWith(".json")).sort();
  if (!files.includes("index.json")) die("docs/generated/openapi/index.json missing: run bun scripts/service-map.ts");
  const parts = files.map(f => ({ f, text: Bun.file(join(catalogueDir, f)) }));
  const script = [
    `set -euo pipefail`,
    `stage=$(mktemp -d)`,
    ...(await Promise.all(
      parts.map(
        async ({ f, text }) =>
          `base64 -d > "$stage/${f}" <<'B64'\n${Buffer.from(await text.arrayBuffer()).toString("base64")}\nB64`,
      ),
    )),
    `sudo -n install -d -m 0755 ${api.catalogue_root}`,
    `sudo -n find ${api.catalogue_root} -maxdepth 1 -name '*.json' -delete`,
    `sudo -n install -m 0644 "$stage"/*.json ${api.catalogue_root}/`,
    `rm -rf "$stage"`,
  ].join("\n");
  const { code } = await ssh(api.gateway, "bash -s", new TextEncoder().encode(script));
  if (code !== 0) die("installing the API catalogue failed");
  console.log(`${api.gateway}: ${files.length} catalogue files in ${api.catalogue_root}`);
}

const remotePath = (p: string) => p.replace(/^~\//, "$HOME/");
const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** The remote release script of one service (runs on the gateway host, in the checkout). */
function deployScript(name: string, s: Service, dry: boolean): string {
  const d = s.deploy ?? die(`${name} has no [services.${name}.deploy]`);
  const unit = s.unit ?? die(`${name} has no unit`);
  const health = `http://127.0.0.1:${s.port}${upstreamOf(s)}health`;
  const openapi = `http://127.0.0.1:${s.port}${upstreamOf(s)}openapi.json`;
  const install = d.install ? remotePath(d.install) : "";
  const gate = `
gate() {
  local want="$1" i body
  for i in $(seq 1 150); do
    body=$(curl -fsS -m 5 ${sq(health)} 2>/dev/null) || body=""
    if [ -n "$body" ] && echo "$body" | jq -e --arg c "$want" '(.status == "ok" or .status == "degraded") and (.commit == $c or .sourceCommit == $c)' >/dev/null; then
      curl -fsS -m 5 ${sq(openapi)} | jq -e '.openapi | startswith("3.1.")' >/dev/null && { echo "gate: $body"; return 0; }
    fi
    sleep 2
  done
  echo "gate failed: \${body:-no answer}" >&2
  return 1
}`;
  const restoreUnit = d.unit_file
    ? `[ -f "$rel/unit.prev" ] && sudo -n install -m 0644 "$rel/unit.prev" /etc/systemd/system/${unit} && sudo -n systemctl daemon-reload || true`
    : ":";
  const installUnit = d.unit_file
    ? `sudo -n cp /etc/systemd/system/${unit} "$rel/unit.prev" 2>/dev/null && sudo -n chown "$(id -u)" "$rel/unit.prev" || true
git show "origin/main:${d.unit_file}" > "$rel/unit"
if ! cmp -s "$rel/unit" /etc/systemd/system/${unit}; then
  sudo -n install -m 0644 "$rel/unit" /etc/systemd/system/${unit} && sudo -n systemctl daemon-reload
fi`
    : ":";
  const swap = (artifact: string) => `
mkdir -p "$(dirname "${install}")"
[ -e "${install}" ] && cp -a "${install}" "$rel/previous" || true
${installUnit}
install -m 0755 "${artifact}" "${install}.next" && mv -f "${install}.next" "${install}"
sudo -n systemctl restart ${unit}
if ! gate "$want"; then
  echo "rolling back ${name}" >&2
  if [ -e "$rel/previous" ]; then cp -a "$rel/previous" "${install}.next" && mv -f "${install}.next" "${install}"; fi
  ${restoreUnit}
  sudo -n systemctl restart ${unit}
  exit 1
fi`;
  let build: string;
  if (d.kind === "bun") {
    const entry = d.entry ?? die(`${name}: deploy.entry missing`);
    const file = install.split("/").pop()!;
    build = `
want=$(git rev-parse origin/main)
rel="$HOME/apps/api-releases/${name}/$want-$(date +%s%3N)"
mkdir -p "$rel"
bun build ${sq(entry)} --target bun --outfile "$rel/${file}" --metafile="$rel/meta.json" \\
  --define "process.env.APHRODY_COMMIT=\\"$want\\"" --define 'process.env.APHRODY_CHANNEL="stable"' >/dev/null
# Provenance: every bundled source of the checkout equals origin/main.
jq -r '.inputs | keys[]' "$rel/meta.json" | grep -v '^node_modules/\\|/node_modules/\\|^<\\|^bun:' | while read -r f; do
  git ls-files --error-unmatch -- "$f" >/dev/null 2>&1 || { echo "untracked bundle input $f" >&2; exit 1; }
  git diff --quiet origin/main -- "$f" || { echo "bundle input $f differs from origin/main" >&2; exit 1; }
done
echo "built $rel/${file} ($(stat -c %s "$rel/${file}") bytes) from $want"
${dry ? "exit 0" : swap(`$rel/${file}`)}`;
  } else if (d.kind === "cargo") {
    const pkg = d.package ?? die(`${name}: deploy.package missing`);
    const bin = d.bin ?? pkg;
    build = `
want=$(git rev-parse origin/main)
for p in ${sq(s.source ?? "")} crates/${pkg} crates/aphrody-http-error Cargo.toml Cargo.lock; do
  [ -z "$p" ] || git diff --quiet origin/main -- "$p" || { echo "$p differs from origin/main in the build checkout" >&2; exit 1; }
done
rel="$HOME/apps/api-releases/${name}/$want-$(date +%s%3N)"
mkdir -p "$rel"
lane="$HOME/.cache/aphrody/lanes/api"; target="$HOME/build/storage/targets/api"; mkdir -p "$lane" "$target"
APHRODY_COMMIT="$want" APHRODY_CHANNEL=stable CARGO_BUILD_JOBS="" APHRODY_BUILD_HOST='' APHRODY_LOCAL_CARGO=1 \\
  APHRODY_CARGO_LOCK_DIR="$lane" APHRODY_CARGO_TARGET_DIR="$target" CARGO_BUILD_BUILD_DIR="$target/build" \\
  scripts/aphrody/build/rust/cargo-serial.sh build --release --locked -p ${pkg} --bin ${bin}${d.features ? ` --features ${d.features}` : ""}
install -m 0755 "$target/release/${bin}" "$rel/${bin}"
echo "built $rel/${bin} from $want"
${dry ? "exit 0" : swap(`$rel/${bin}`)}`;
  } else {
    const command = d.command ?? die(`${name}: deploy.command missing`);
    build = `
# The checkout builds HEAD (the sync may still be rebasing other agents' commits): it must contain the latest
# origin/main change of the service's own sources and of the contract helpers, and carry no edit to them.
for p in ${sq(s.source ?? ".")} packages/bun-os-platform/src/api crates/aphrody-http-error; do
  last=$(git log -1 --format=%H origin/main -- "$p")
  [ -z "$last" ] || git merge-base --is-ancestor "$last" HEAD ||
    { echo "the build checkout lacks $last ($p); sync pending" >&2; exit 1; }
  git diff --quiet HEAD -- "$p" || { echo "$p has uncommitted edits in the build checkout" >&2; exit 1; }
done
want=$(git rev-parse HEAD)
rel="$HOME/apps/api-releases/${name}/$want-$(date +%s%3N)"
mkdir -p "$(dirname "$rel")"
${dry ? `echo "would run: ${command.replaceAll('"', '\\"')}"; exit 0` : ""}
${command.replaceAll("{out}", '"$rel/artifact"')}
${install ? swap('"$rel/artifact"') : `gate "$want" || { echo "${name}: the release did not go live" >&2; exit 1; }`}`;
  }
  return `cd "$HOME/src/bun-os"
git fetch -q origin main
${gate}
${build}
echo "${name}: live at $want"`;
}

async function deploy(name: string, dry: boolean): Promise<void> {
  const s = api.services[name] ?? die(`unknown service ${name}`);
  console.log(`deploy ${name} on ${s.host}${dry ? " (dry run)" : ""}`);
  const { code, out } = await ssh(s.host, deployScript(name, s, dry));
  process.stdout.write(out);
  if (code !== 0) die(`deploy ${name} failed`);
}

type Verdict = { service: string; health: string; openapi: string; problems: string[] };

async function verify(names: string[]): Promise<Verdict[]> {
  const out: Verdict[] = [];
  for (const name of names) {
    const base = `https://${api.domain}/v1/${name}/`;
    const problems: string[] = [];
    let health = "-";
    let openapi = "-";
    try {
      const r = await fetch(`${base}health`, { signal: AbortSignal.timeout(15_000) });
      health = String(r.status);
      const body = (await r.json()) as Record<string, unknown>;
      if (!["ok", "degraded", "down"].includes(String(body.status))) problems.push("health.status not standard");
      if (typeof body.version !== "string") problems.push("health.version missing");
      if (!("commit" in body)) problems.push("health.commit missing");
      health += ` ${body.status} ${String(body.commit ?? "").slice(0, 12)}`;
    } catch (e) {
      problems.push(`health: ${(e as Error).message}`);
    }
    try {
      const r = await fetch(`${base}openapi.json`, { signal: AbortSignal.timeout(15_000) });
      openapi = String(r.status);
      const doc = await r.json();
      problems.push(...checkDocument(doc, name).map(p => `openapi: ${p}`));
      const committed = await Bun.file(join(catalogueDir, `${name}.json`))
        .json()
        .catch(() => null);
      if (committed && JSON.stringify(sortKeys(committed)) !== JSON.stringify(sortKeys(doc)))
        problems.push("openapi: live document differs from docs/generated/openapi (deploy pending)");
      openapi += ` ${Object.keys((doc as { paths?: object }).paths ?? {}).length} paths`;
    } catch (e) {
      problems.push(`openapi: ${(e as Error).message}`);
    }
    out.push({ service: name, health, openapi, problems });
  }
  return out;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  return v;
}

const cmd = process.argv[2];
if (cmd === "render") {
  const files = await render(process.argv.includes("--tls"));
  console.log(`wrote ${Object.keys(files).join(", ")} to ${outDir}`);
} else if (cmd === "apply") {
  for (const h of meshHosts) await install(h, `fleet-api-mesh.conf`, meshListener(h));
  // The gateway host serves its services directly; a mesh listener left from an earlier layout would also redefine
  // the shared upgrade map.
  if (!meshHosts.includes(api.gateway))
    await ssh(
      api.gateway,
      "sudo -n rm -f /etc/nginx/conf.d/fleet-api-mesh.conf; sudo -n install -d /var/www/letsencrypt",
    );
  await installCatalogue();
  const certCheck = await ssh(
    api.gateway,
    `sudo -n test -f /etc/letsencrypt/live/${api.domain}/fullchain.pem && echo yes || echo no`,
  );
  const hasCert = certCheck.out.trim() === "yes";
  await install(api.gateway, "fleet-api.conf", gateway(hasCert));
  if (!hasCert) {
    const issued = await ssh(
      api.gateway,
      `sudo -n certbot certonly --webroot -w ${webroot} -d ${api.domain} --non-interactive --agree-tos --quiet $(account=$(sudo -n ls /etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory 2>/dev/null | head -1); [ -n "$account" ] && echo --account "$account" || echo --register-unsafely-without-email) && echo issued`,
    );
    if (!issued.out.includes("issued"))
      die(`certificate for ${api.domain} not issued (DNS must point at ${api.gateway})`);
    await install(api.gateway, "fleet-api.conf", gateway(true));
  }
  await render(true);
} else if (cmd === "deploy") {
  const names = process.argv.slice(3).filter(a => !a.startsWith("--"));
  if (!names.length) die("usage: api.ts deploy <service>... [--dry-run]");
  for (const n of names) await deploy(n, process.argv.includes("--dry-run"));
} else if (cmd === "verify") {
  const names = process.argv.slice(3).filter(a => !a.startsWith("--"));
  const results = await verify(names.length ? names : Object.keys(api.services).sort());
  for (const r of results)
    console.log(
      `${r.service.padEnd(10)} health ${r.health.padEnd(28)} openapi ${r.openapi.padEnd(14)} ${r.problems.length ? r.problems.join("; ") : "conforms"}`,
    );
  process.exitCode = results.some(r => r.problems.length) ? 1 : 0;
} else {
  console.log(
    "usage: bun infra/fleet/api.ts <render [--tls] | apply | deploy <service>... [--dry-run] | verify [service]...>",
  );
  process.exitCode = cmd ? 2 : 0;
}
