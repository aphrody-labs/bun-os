// SPDX-License-Identifier: Apache-2.0
/** Only the Play homepage enters WebOS; the Play origin owns streaming and APIs. */
import { ROUTES, WORKSPACE_ROUTES } from "../src/config";

const PUBLIC_ORIGIN = ROUTES.origin;
/** The old Play host is the catalogued host whose path is the Play app. */
const PLAY_PATH = Object.entries(ROUTES.apps).find(
  ([, id]) => id === "play",
)?.[0];
const PLAY_HOST = Object.entries(ROUTES.hosts).find(
  ([, entry]) => PLAY_PATH && entry.path === PLAY_PATH,
)?.[0];
const PLAY_ROUTE = WORKSPACE_ROUTES.find((entry) => entry.id === "play")?.route;

export function playRedirect(url: URL): string | undefined {
  if (
    !PLAY_HOST ||
    !PLAY_ROUTE ||
    url.hostname !== PLAY_HOST ||
    url.pathname !== "/"
  )
    return undefined;
  const target = new URL(`/workspace/${PLAY_ROUTE}`, PUBLIC_ORIGIN);
  target.search = url.search;
  target.searchParams.delete("app");
  target.searchParams.delete("category");
  return target.href;
}

interface Assets {
  fetch(request: Request): Promise<Response>;
}

/** Keep old read-only emulator URLs backed by the qualified product registry. */
export async function playResponse(
  request: Request,
  assets: Assets,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const listing =
    url.pathname === "/api/emulation" ||
    url.pathname === "/emulation/index.json";
  const match = /^\/emulation\/([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(url.pathname);
  if (!listing && !match) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  const registry = await assets.fetch(
    new Request(new URL("/registry.json", url).href),
  );
  if (!registry.ok)
    return new Response("Gaming registry unavailable", { status: 503 });
  const data = (await registry.json()) as {
    packages?: { id: string; category: string }[];
  };
  const games = (data.packages ?? []).filter(
    (entry) => entry.category === "games" && /^game-[a-z0-9-]+$/.test(entry.id),
  );
  if (listing) {
    const cores = await Promise.all(
      games.map(async (entry) => {
        const core = entry.id.slice(5);
        const response = await assets.fetch(
          new Request(
            new URL(`/apps/${entry.id}/payload/${core}/manifest.json`, url)
              .href,
          ),
        );
        if (!response.ok)
          throw new Error(`Qualified emulator manifest unavailable: ${core}`);
        return {
          ...((await response.json()) as object),
          base: `/emulation/${core}/`,
          package: `/apps/${entry.id}/app.json`,
          player: `/apps/${entry.id}/index.html`,
        };
      }),
    );
    return new Response(
      request.method === "HEAD"
        ? null
        : JSON.stringify(
            url.pathname === "/api/emulation"
              ? cores
              : { schemaVersion: 1, cores },
          ),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-cache",
        },
      },
    );
  }
  const [, core, path] = match!;
  if (
    !games.some((entry) => entry.id === `game-${core}`) ||
    path!.includes("\\") ||
    path!
      .split("/")
      .some(
        (part) => part === "." || part === ".." || /%2e|%2f|%5c/i.test(part),
      )
  )
    return new Response("Not found", { status: 404 });
  const inventoryResponse = await assets.fetch(
    new Request(new URL(`/apps/game-${core}/app.json`, url).href),
  );
  if (!inventoryResponse.ok)
    return new Response("Gaming package unavailable", { status: 503 });
  const inventory = (await inventoryResponse.json()) as {
    files?: { path: string }[];
  };
  if (!inventory.files?.some((file) => file.path === `payload/${core}/${path}`))
    return new Response("Not found", { status: 404 });
  return assets.fetch(
    new Request(
      new URL(`/apps/game-${core}/payload/${core}/${path}`, url).href,
      request,
    ),
  );
}
