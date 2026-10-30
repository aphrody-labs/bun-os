// SPDX-License-Identifier: Apache-2.0
/**
 * Bun.serve routes of the platform for web hosts (web hosts). Spread `platformRoutes()`
 * into `routes`; pass the host's auth wrapper as `guard` for routes that act on the host
 * (plugin commands, file inspection, transfers). Locale: `?lang=` > `bun-os-locale` cookie >
 * Accept-Language > `en`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFile, previewFile } from "./files";
import { catalogSources, locales, localizer, negotiate } from "./i18n";
import { readSettings } from "./paths";
import { plugins } from "./plugins";
import { currentTheme, loadTheme, themeCss } from "./theme";
import { type TransferEvent, transfers } from "./transfer";

type Handler = (request: Request & { params?: Record<string, string> }) => Response | Promise<Response>;
export type Guard = (handler: Handler) => Handler;

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

function cookie(request: Request, name: string): string | null {
  const m = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/** The negotiated locale of a web request. */
export function requestLocale(request: Request) {
  const url = new URL(request.url);
  return negotiate({
    override: url.searchParams.get("lang") ?? cookie(request, "bun-os-locale"),
    acceptLanguage: request.headers.get("accept-language"),
  });
}

/** A localizer for a web request (server-rendered strings, errors). */
export function requestLocalizer(request: Request, domains: string[] = ["common"]) {
  return localizer(requestLocale(request).chain, domains);
}

const MAX_INSPECT_BYTES = 512 * 1024 * 1024;

export function platformRoutes(options: { guard?: Guard; domains?: string[] } = {}) {
  const guard: Guard = options.guard ?? (h => h);
  const allowed = new Set(options.domains ?? ["common", "engine"]);
  return {
    "/api/platform/i18n": {
      GET: (request: Request) => {
        const url = new URL(request.url);
        const domains = (url.searchParams.get("domains") ?? "common").split(",").filter(d => allowed.has(d));
        const n = requestLocale(request);
        const sources: Record<string, string[]> = {};
        for (const tag of n.chain) sources[tag] = catalogSources(tag, domains);
        return json({ ...n, locales: locales(), sources }, 200, {
          vary: "accept-language, cookie",
        });
      },
    },
    "/api/platform/locales": { GET: () => json(locales()) },
    "/api/platform/theme": {
      GET: async (request: Request) => {
        const id = new URL(request.url).searchParams.get("theme");
        return json(id ? loadTheme(id) : await currentTheme());
      },
    },
    "/api/platform/theme.css": {
      GET: async (request: Request) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("theme");
        const file = id ? loadTheme(id) : await currentTheme();
        return new Response(themeCss(file), {
          headers: {
            "content-type": "text/css; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      },
    },
    "/api/platform/plugins": {
      GET: async (request: Request) => {
        const registry = await plugins();
        const l10n = requestLocalizer(request);
        return json({
          plugins: registry.plugins.map(p => ({
            name: p.manifest.name,
            version: p.manifest.version,
            trust: p.trust,
            permissions: p.manifest.permissions,
          })),
          blocked: registry.blocked.map(b => ({
            name: b.name,
            reason: b.reason,
          })),
          menu: registry.menuFor(l10n),
          themes: registry.themes.map(t => ({
            id: t.id,
            name: t.name ?? null,
            plugin: t.plugin,
          })),
        });
      },
    },
    "/api/platform/plugins/run": {
      POST: guard(async request => {
        const body = (await request.json()) as {
          command: string;
          args?: Record<string, unknown>;
        };
        return json({
          result: await (await plugins()).run(body.command, body.args ?? {}),
        });
      }),
    },
    /** Body: the file bytes; `?name=` keeps the user's file name. Detection + preview, nothing stored. */
    "/api/platform/files/inspect": {
      POST: guard(async request => {
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > MAX_INSPECT_BYTES) return json({ error: "file too large to inspect" }, 413);
        const name = (new URL(request.url).searchParams.get("name") ?? "upload.bin").replace(/[\\/:*?"<>|]/g, "_");
        const dir = mkdtempSync(join(tmpdir(), "bun-os-inspect-"));
        try {
          const path = join(dir, name);
          await Bun.write(path, request);
          const detection = await detectFile(path);
          const preview = await previewFile(path, { detection, width: 320 });
          const thumbnail = preview.thumbnail
            ? `data:image/webp;base64,${Buffer.from(preview.thumbnail).toString("base64")}`
            : null;
          return json({
            detection: { ...detection, path: undefined },
            preview: { ...preview, detection: undefined, thumbnail },
          });
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
    },
    "/api/platform/transfers": {
      GET: guard(async () => json((await transfers()).list())),
      POST: guard(async request => json((await transfers()).enqueue((await request.json()) as never), 202)),
    },
    "/api/platform/transfers/:id/:action": {
      POST: guard(async request => {
        const { id = "", action = "" } = request.params ?? {};
        const service = await transfers();
        if (action === "pause") service.pause(id);
        else if (action === "resume") service.resume(id);
        else if (action === "cancel") service.cancel(id);
        else return json({ error: `unknown action ${action}` }, 400);
        return json(service.get(id));
      }),
    },
  };
}

/** Forwards transfer progress to a realtime publisher (play's WebSocket topic `transfers`). */
export async function attachTransfers(publish: (event: TransferEvent) => void): Promise<() => void> {
  const service = await transfers();
  const listener = (e: Event) => publish((e as CustomEvent<TransferEvent>).detail);
  service.addEventListener("progress", listener);
  return () => service.removeEventListener("progress", listener);
}

export { readSettings };
