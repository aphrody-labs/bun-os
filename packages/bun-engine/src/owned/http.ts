// Signed-in routes for owned dumps on play.aphrody.app. The play server wraps every handler with
// its session guard; these routes are never part of the public frontend API, never return dump
// bytes and list key files by key name only.
//   GET  /api/owned                       the owned store (metadata)
//   GET  /api/owned/drop(.js)             drag-and-drop page and its script (CSP script-src 'self')
//   GET  /api/owned/upload/:id            bytes received so far (resume)
//   PUT  /api/owned/upload/:id?offset=N   one chunk (<= 8 MiB, the engine caps bodies at 16 MiB)
//   POST /api/owned/upload/:id/done       {name, size, system?}: ingest through the inbox
import { existsSync, statSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { inboxDir, processInboxEntry } from "./inbox";
import { describe, listOwned } from "./store";
// @ts-expect-error TS2307: Bun text import of the generated sheet (inlined by bun build); TypeScript has no .css text type.
import brandSheet from "../../../app-ui/src/brand.css" with { type: "text" };

export const uploadChunkBytes = 8 * 1024 * 1024;

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });

function uploadPath(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("bad upload id");
  return join(inboxDir(), ".uploads", `${id}.part`);
}

function safeName(name: string): string {
  const clean = basename(name.replaceAll("\\", "/"))
    .replace(/[^\w.() +-]+/g, "_")
    .slice(0, 160);
  if (!clean || clean.startsWith(".")) throw new Error("bad file name");
  return clean;
}

type Handler = (request: Bun.BunRequest, server?: Bun.Server<unknown>) => Response | Promise<Response>;

function safe(handler: Handler): Handler {
  return async (request, server) => {
    try {
      return await handler(request, server);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  };
}

/** Route table for Bun.serve; the caller adds authentication and same-origin checks. */
export function ownedRoutes(): Record<string, Record<string, Handler>> {
  return {
    "/api/owned": { GET: safe(() => json(listOwned().map(describe))) },
    "/api/owned/drop": {
      GET: () =>
        new Response(dropPage, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'",
          },
        }),
    },
    "/api/owned/drop.js": {
      GET: () =>
        new Response(dropScript, {
          headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
        }),
    },
    "/api/owned/upload/:id": {
      GET: safe(request => {
        const path = uploadPath((request.params as { id: string }).id);
        return json({ received: existsSync(path) ? statSync(path).size : 0 });
      }),
      PUT: safe(async request => {
        const path = uploadPath((request.params as { id: string }).id);
        const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
        const received = existsSync(path) ? statSync(path).size : 0;
        if (offset !== received) return json({ error: "offset mismatch", received }, 409);
        await mkdir(join(inboxDir(), ".uploads"), { recursive: true });
        const handle = await open(path, "a");
        let bytes = 0;
        try {
          for await (const chunk of request.body ?? []) {
            bytes += chunk.byteLength;
            if (bytes > uploadChunkBytes) throw new Error("chunk too large");
            await handle.write(chunk);
          }
        } finally {
          await handle.close();
        }
        return json({ received: received + bytes });
      }),
    },
    "/api/owned/upload/:id/done": {
      POST: safe(async (request, server) => {
        // Hashing and verifying a disc image can outlast the idle timeout.
        server?.timeout(request, 0);
        const id = (request.params as { id: string }).id;
        const path = uploadPath(id);
        const { name, size, system } = (await request.json()) as { name: string; size: number; system?: string };
        if (!existsSync(path) || statSync(path).size !== size) return json({ error: "upload incomplete" }, 409);
        const folder = join(inboxDir(), ".uploads", id);
        await mkdir(folder, { recursive: true });
        const file = join(folder, safeName(name));
        await rename(path, file);
        try {
          return json(await processInboxEntry(file, { via: "web", system: system || undefined }));
        } finally {
          await rm(folder, { recursive: true, force: true });
        }
      }),
    },
  };
}

// The generated Aphrody brand roles (packages/app-ui/src/brand.css, product seed), switched by the system scheme
// because this page loads no script before first paint.
const brandRoles = (brandSheet as string)
  .replace(/:root\.light,\s*\.light\s*\{([^}]*)\}/g, "@media (prefers-color-scheme: light) {\n:root {$1}\n}")
  .replace(/:root,\s*\.dark\s*\{([^}]*)\}/g, "@media (prefers-color-scheme: dark) {\n:root {$1}\n}");

const dropPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Owned dumps</title>
<style>
${brandRoles}
body{margin:0;font:15px/1.45 "Google Sans Flex","Roboto Flex",sans-serif;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface)}
main{max-width:960px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 4px}p{color:var(--md-sys-color-on-surface-variant);margin:0 0 16px}
#drop{border:2px dashed var(--md-sys-color-outline);border-radius:16px;padding:40px;text-align:center;cursor:pointer}
#drop.over{border-color:var(--md-sys-color-primary);background:var(--md-sys-color-surface-container)}
#drop:focus-visible,select:focus-visible{outline:2px solid var(--md-sys-color-secondary);outline-offset:2px}
table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--md-sys-color-outline-variant);vertical-align:top}
.verified{color:var(--md-sys-color-primary)}.bad-dump{color:var(--md-sys-color-error)}.unverified-good-dump{color:var(--md-sys-color-tertiary)}
select{background:var(--md-sys-color-surface-container);color:inherit;border:1px solid var(--md-sys-color-outline);border-radius:8px;padding:4px}
</style></head><body><main>
<h1>Owned dumps</h1>
<p>Private: BIOS, firmware and keys dumped from consoles you own, ROMs and disc images dumped from games you bought.
Files are verified, stored in the private store and never published. Key files are listed by key name only.</p>
<label>System for ambiguous images <select id="system"><option value="">auto</option>
<option>psx</option><option>ps2</option><option>psp</option><option>gc</option><option>wii</option><option>dreamcast</option><option>arcade</option></select></label>
<div id="drop" tabindex="0">Drop files here or click to choose</div><input id="pick" type="file" multiple hidden>
<table><thead><tr><th>File</th><th>Kind</th><th>System</th><th>Status</th><th>Detail</th></tr></thead><tbody id="rows"></tbody></table>
</main><script src="/api/owned/drop.js"></script></body></html>`;

const dropScript = `const chunk = ${uploadChunkBytes};
const rows = document.getElementById("rows"), drop = document.getElementById("drop"), pick = document.getElementById("pick");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function row(name, kind, system, status, detail) {
  const tr = document.createElement("tr");
  tr.innerHTML = "<td>"+esc(name)+"</td><td>"+esc(kind)+"</td><td>"+esc(system)+"</td><td class='"+esc(status)+"'>"+esc(status)+"</td><td>"+esc(detail)+"</td>";
  rows.prepend(tr); return tr;
}
async function upload(file) {
  const line = row(file.name, "", "", "uploading", "0%");
  const key = "owned-upload:" + file.name + ":" + file.size + ":" + file.lastModified;
  const id = localStorage.getItem(key) || crypto.randomUUID();
  localStorage.setItem(key, id);
  let { received } = await (await fetch("/api/owned/upload/" + id)).json();
  while (received < file.size) {
    const res = await fetch("/api/owned/upload/" + id + "?offset=" + received, { method: "PUT", body: file.slice(received, received + chunk) });
    const body = await res.json();
    if (!res.ok && res.status !== 409) throw new Error(body.error || res.status);
    received = body.received;
    line.cells[4].textContent = Math.floor(received * 100 / file.size) + "%";
  }
  const res = await fetch("/api/owned/upload/" + id + "/done", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, system: document.getElementById("system").value }) });
  const results = await res.json();
  localStorage.removeItem(key);
  line.remove();
  if (!res.ok) throw new Error(results.error || res.status);
  for (const r of results) row(r.input, r.kind, r.system, r.error ? "error" : r.status + (r.duplicate ? " (already stored)" : ""),
    r.error || (r.keyNames ? r.keyNames.length + " keys: " + r.keyNames.slice(0, 12).join(", ") : [r.title, r.reason].filter(Boolean).join(" - ")));
}
async function take(files) { for (const file of files) await upload(file).catch(e => row(file.name, "", "", "error", e.message)); }
drop.onclick = () => pick.click(); pick.onchange = () => take([...pick.files]);
drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); take([...e.dataTransfer.files]); };
fetch("/api/owned").then(r => r.json()).then(list => { for (const d of list.reverse()) row(d.names[0], d.kind, d.system || d.console, d.status,
  d.kind === "keys" ? d.keyNames.length + " keys: " + d.keyNames.slice(0, 12).join(", ") : [d.title, d.reason].filter(Boolean).join(" - ")); });
`;
