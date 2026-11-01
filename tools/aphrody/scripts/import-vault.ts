// Import a password-manager CSV (name,url,username,password,note) into the local
// encrypted vault: bun:sqlite at ~/.aphrody/db/vault.sqlite, passwords sealed with
// AES-256-GCM under a master key wrapped by Windows DPAPI (~/.aphrody/keys/vault.dpapi).
// Values are never printed. The source CSV is deleted once the round trip is verified.
//
//   bun tools/aphrody/scripts/import-vault.ts <file.csv> [--keep]
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home = process.env.APHRODY_HOME ?? join(homedir(), ".aphrody");
const src = Bun.argv[2];
if (!src) throw new Error("usage: import-vault.ts <file.csv> [--keep]");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const ps = async (script: string, stdin: string) => {
  const r = await Bun.$`pwsh -NoProfile -NonInteractive -Command ${script} < ${new Response(stdin)}`.quiet();
  return r.text().trim();
};
const dpapi = (mode: "Protect" | "Unprotect", b64: string) =>
  ps(
    `Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${mode}($b,$null,'CurrentUser'))`,
    b64,
  );

async function masterKey(): Promise<CryptoKey> {
  const path = join(home, "keys/vault.dpapi");
  const f = Bun.file(path);
  let raw: string;
  if (await f.exists()) raw = await dpapi("Unprotect", (await f.text()).trim());
  else {
    raw = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    mkdirSync(join(home, "keys"), { recursive: true });
    await Bun.write(path, await dpapi("Protect", raw));
  }
  return crypto.subtle.importKey("raw", Buffer.from(raw, "base64"), "AES-GCM", false, ["encrypt", "decrypt"]);
}

const seal = async (key: CryptoKey, text: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  return Buffer.concat([iv, ct]);
};
const open = async (key: CryptoKey, blob: Uint8Array) =>
  new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, key, blob.slice(12)),
  );

const [header, ...rows] = parseCsv(await Bun.file(src).text());
const col = (n: string) => header.indexOf(n);
const idx = Object.fromEntries(["name", "url", "username", "password", "note"].map(n => [n, col(n)]));
if (Object.values(idx).some(i => i < 0)) throw new Error("unexpected CSV header");

mkdirSync(join(home, "db"), { recursive: true });
const db = new Database(join(home, "db/vault.sqlite"), { create: true });
db.run(`CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, username TEXT NOT NULL,
  password BLOB NOT NULL, note TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (url, username))`);

const key = await masterKey();
const insert = db.prepare(
  "INSERT INTO credentials (name,url,username,password,note) VALUES (?,?,?,?,?) ON CONFLICT(url,username) DO UPDATE SET name=excluded.name,password=excluded.password,note=excluded.note",
);
const sealed: [string, string, string, Buffer, string][] = [];
for (const r of rows)
  sealed.push([r[idx.name], r[idx.url], r[idx.username], await seal(key, r[idx.password]), r[idx.note]]);
db.transaction(() => sealed.forEach(s => insert.run(...s)))();

// Round trip: every distinct (url, username) must decrypt to the CSV password.
const want = new Map(rows.map(r => [`${r[idx.url]}\0${r[idx.username]}`, r[idx.password]]));
let bad = 0;
for (const row of db.query("SELECT url, username, password FROM credentials").all() as {
  url: string;
  username: string;
  password: Uint8Array;
}[]) {
  const expected = want.get(`${row.url}\0${row.username}`);
  if (expected !== undefined && (await open(key, row.password)) !== expected) bad++;
}
const stored = (db.query("SELECT count(*) AS n FROM credentials").get() as { n: number }).n;
console.log(`${rows.length} lignes CSV, ${want.size} identifiants distincts, ${stored} en base, ${bad} écarts`);
if (bad || stored < want.size) process.exit(1);
if (!Bun.argv.includes("--keep")) {
  const { unlink } = await import("node:fs/promises");
  await unlink(src);
  console.log("CSV source supprimé");
}
