// SPDX-License-Identifier: Apache-2.0
// /api/downloads: the release catalogue (latest.json) of the downloads service, read by the member windows
// of native apps. The page itself may only connect to its own origin, so the edge fetches it.
import { serviceOrigin } from "../src/config";

interface Artifact {
  name: string;
  version: string;
  platform: string;
  kind?: string;
  url: string;
  sha256: string;
  size: number;
  file?: string;
}

const json = (body: unknown, cache = "public, max-age=300") =>
  Response.json(body, { headers: { "cache-control": cache } });
/** The service being down is an answer, not an edge failure: the window shows the reason. */
const unavailable = (error: string, base?: string) =>
  json({ available: false, error, base: base ?? null }, "no-store");

export async function downloadsResponse(request: Request): Promise<Response> {
  if (request.method !== "GET")
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET" },
    });
  const base = serviceOrigin("downloads");
  if (!base)
    return unavailable(
      "No downloads service is declared in the route catalog.",
    );
  const upstream = await fetch(`${base}/latest.json`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  }).catch((error: unknown) => error);
  if (!(upstream instanceof Response))
    return unavailable(`${new URL(base).host} did not answer.`, base);
  if (!upstream.ok)
    return unavailable(
      `${new URL(base).host} answered HTTP ${upstream.status}.`,
      base,
    );
  const manifest = (await upstream.json().catch(() => undefined)) as
    | {
        schemaVersion?: number;
        release?: { id?: string };
        artifacts?: Artifact[];
      }
    | undefined;
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.artifacts))
    return unavailable("The release catalogue has an unknown format.", base);
  // Only artifacts that stay on the downloads service are offered.
  const artifacts = manifest.artifacts.filter(
    (artifact) =>
      typeof artifact.url === "string" &&
      artifact.url.startsWith(`${base}/files/`) &&
      /^[0-9a-f]{64}$/i.test(artifact.sha256),
  );
  return json({
    available: true,
    base,
    release: manifest.release?.id ?? null,
    artifacts: artifacts.map(
      ({ name, version, platform, kind, url, sha256, size }) => ({
        name,
        version,
        platform,
        kind,
        url,
        sha256,
        size,
      }),
    ),
  });
}
