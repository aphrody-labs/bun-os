// Materialise the per-app .env files from the protected Aphrody secret store.
// Sources (later wins): ~/.aphrody/env/**/*.env, credentials/google-account.env,
// process.env, then derived values (Google cookie jar, gcloud access token).
// Only keys an app declares in its .env.example (or already holds) are written;
// existing non-empty values are kept unless --force. Values are never printed.
//
//   bun tools/aphrody/scripts/sync-env.ts [--check] [--force]
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const home = process.env.APHRODY_HOME ?? join(homedir(), ".aphrody");
const root = resolve(import.meta.dir, "../../..");
const check = Bun.argv.includes("--check");
const force = Bun.argv.includes("--force");

type Env = Map<string, string>;

function parse(text: string): Env {
  const out: Env = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(".*"|'.*')$/s.test(v)) v = v.startsWith('"') ? JSON.parse(v) : v.slice(1, -1);
    out.set(m[1], v);
  }
  return out;
}

async function load(path: string): Promise<Env> {
  const f = Bun.file(path);
  return (await f.exists()) ? parse(await f.text()) : new Map();
}

function usable(v: string | undefined): v is string {
  return !!v && v !== "undefined" && v !== "null";
}

async function storeFiles(): Promise<string[]> {
  const files = [join(home, "credentials/google-account.env")];
  for await (const p of new Bun.Glob("env/**/*.env").scan({
    cwd: home,
    absolute: true,
  }))
    files.push(p);
  for await (const p of new Bun.Glob("env/**/.env*").scan({
    cwd: home,
    absolute: true,
    dot: true,
  }))
    files.push(p);
  // Production snapshots first, narrower files last so they win.
  return [...new Set(files)].sort((a, b) => Number(/production|vps/.test(b)) - Number(/production|vps/.test(a)));
}

async function googleCookie(): Promise<string | undefined> {
  const f = Bun.file(join(home, "cookies/google.json"));
  if (!(await f.exists())) return;
  const jar = (await f.json()) as {
    domain: string;
    name: string;
    value: string;
    expirationDate?: number;
  }[];
  const now = Date.now() / 1000;
  const live = jar.filter(
    c => /(^|\.)google\.com$/.test(c.domain.replace(/^\./, "")) && (!c.expirationDate || c.expirationDate > now),
  );
  return live.length ? live.map(c => `${c.name}=${c.value}`).join("; ") : undefined;
}

async function gcloudToken(): Promise<string | undefined> {
  const bin =
    Bun.which("gcloud") ??
    [
      "C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd",
      join(process.env.LOCALAPPDATA ?? "", "Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"),
    ].find(p => existsSync(p));
  if (!bin) return;
  const r = await Bun.$`${bin} auth print-access-token`.quiet().nothrow();
  return r.exitCode === 0 ? r.text().trim() || undefined : undefined;
}

const store: Env = new Map();
for (const file of await storeFiles()) for (const [k, v] of await load(file)) if (usable(v)) store.set(k, v);
for (const [k, v] of Object.entries(process.env)) if (usable(v) && store.has(k)) store.set(k, v!);
const cookie = await googleCookie();
if (cookie) store.set("GOOGLE_COOKIE", cookie);
const token = await gcloudToken();
if (token) store.set("GOOGLE_ACCESS_TOKEN", token);

const rootKeys = [
  "NEON_API_KEY",
  "NEON_ORG_ID",
  "NEON_PROJECT_ID",
  "INAGLE_DATABASE_URL",
  "INAGLE_DATABASE_DIRECT_URL",
  "MULLVAD_ACCOUNT",
  "GOOGLE_ACCOUNT_EMAIL",
  "GOOGLE_ACCOUNT_PASSWORD",
  "GOOGLE_COOKIE",
  "GOOGLE_ACCESS_TOKEN",
];
const targets = [
  { dir: "", file: ".env", keys: rootKeys },
  { dir: "packages/inagle", file: ".env" },
];

let missingTotal = 0;
for (const t of targets) {
  const base = join(root, t.dir);
  const path = join(base, t.file);
  const current = await load(path);
  const wanted = new Set<string>([...(t.keys ?? []), ...current.keys()]);
  const example = await load(join(base, ".env.example"));
  for (const k of example.keys()) wanted.add(k);

  const next = new Map(current);
  const filled: string[] = [];
  const missing: string[] = [];
  for (const k of wanted) {
    const have = usable(current.get(k));
    const from = store.get(k) ?? (usable(example.get(k)) ? example.get(k) : undefined);
    if (have && !force) continue;
    if (from && from !== current.get(k)) {
      next.set(k, from);
      filled.push(k);
    } else if (!have) missing.push(k);
  }
  missingTotal += missing.length;
  const label = join(t.dir, t.file) || t.file;
  console.log(
    `${label}: +${filled.length} synchronisées, ${missing.length} manquantes${missing.length ? ` (${missing.join(", ")})` : ""}`,
  );
  if (check || !filled.length) continue;
  const body = [...next].map(([k, v]) => `${k}=${/[\s#"'\\]/.test(v) ? JSON.stringify(v) : v}`).join("\n");
  await Bun.write(path, `${body}\n`);
}
// Contract gate: every required secret of a locally-hosted service must be present.
const contract = (await Bun.file(join(root, "tools/aphrody/config/secrets-contract.json")).json()) as {
  services: Record<string, { envFile?: string; secrets: { name: string; required: boolean }[] }>;
};
let contractMissing = 0;
for (const [id, svc] of Object.entries(contract.services)) {
  if (!svc.envFile || svc.envFile.startsWith("/") || svc.envFile.startsWith("~")) continue;
  const env = await load(join(root, svc.envFile));
  const absent = svc.secrets.filter(s => s.required && !usable(env.get(s.name))).map(s => s.name);
  contractMissing += absent.length;
  if (absent.length) console.log(`contrat ${id}: requis manquants ${absent.join(", ")}`);
}
process.exit(check && (missingTotal || contractMissing) ? 1 : contractMissing ? 1 : 0);
