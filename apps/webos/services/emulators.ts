// SPDX-License-Identifier: Apache-2.0
// Emulator delivery: built WebAssembly cores and test fixtures from the local objects directory (the
// native service's object store; R2 is not used), the emulator list and the qualification report.
//   GET /api/emulators                         catalog merged with the last qualification result
//   GET /api/emulators/qualification           full report written by qualify-webos.ts
//   GET /api/emulators/qualification/<id>.png  screenshot of the qualified run
//   GET /emulation/<core>/<path>               core files (also runtime/ and fixtures/), content-addressed
import {
  EMULATORS,
  type QualificationEntry,
  type QualificationReport,
} from "../../../packages/bun-engine/web-emulation/emulators";
import { ISOLATION } from "./isolation";

interface Objects {
  get(
    key: string,
  ): Promise<{ body: ReadableStream; size: number; httpEtag: string } | null>;
}

const TYPES: Record<string, string> = {
  wasm: "application/wasm",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
};

function headers(type: string, cache: string, size?: number, etag?: string) {
  const out = new Headers({
    "content-type": type,
    "cache-control": cache,
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    ...ISOLATION,
  });
  if (size !== undefined) out.set("content-length", String(size));
  if (etag) out.set("etag", etag);
  return out;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: headers("application/json; charset=utf-8", "no-cache"),
  });

async function readJSON<T>(
  objects: Objects,
  key: string,
): Promise<T | undefined> {
  const object = await objects.get(key).catch(() => null);
  if (!object) return undefined;
  return JSON.parse(await new Response(object.body).text()) as T;
}

export async function emulatorsResponse(
  request: Request,
  objects: Objects,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname;
  const emulation = /^\/emulation\/([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(path);
  if (!path.startsWith("/api/emulators") && !emulation) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });

  if (path === "/api/emulators" || path === "/api/emulators/qualification") {
    const report = await readJSON<QualificationReport>(
      objects,
      "emulators/qualification.json",
    );
    if (path.endsWith("/qualification"))
      return json(report ?? { schemaVersion: 1, entries: {} });
    const emulators = await Promise.all(
      EMULATORS.map(async (emulator) => {
        const served = emulator.core
          ? Boolean(
              await objects
                .get(`emulation/${emulator.core}/manifest.json`)
                .catch(() => null),
            )
          : false;
        const entry: QualificationEntry =
          report?.entries[emulator.id] ??
          ({
            id: emulator.id,
            status: emulator.mode === "native" ? "unsupported" : "untested",
            errors: [],
            detail: emulator.reason,
          } satisfies QualificationEntry);
        return { ...emulator, served, qualification: entry };
      }),
    );
    return json({
      schemaVersion: 1,
      generatedAt: report?.generatedAt ?? null,
      sourceCommit: report?.sourceCommit ?? null,
      totals: {
        emulators: emulators.length,
        pass: emulators.filter((e) => e.qualification.status === "pass").length,
        fail: emulators.filter((e) => e.qualification.status === "fail").length,
        untested: emulators.filter((e) => e.qualification.status === "untested")
          .length,
        unsupported: emulators.filter(
          (e) => e.qualification.status === "unsupported",
        ).length,
      },
      emulators,
    });
  }

  const shot =
    /^\/api\/emulators\/qualification\/([a-z0-9][a-z0-9-]*)\.png$/.exec(path);
  let key: string | undefined;
  if (shot) key = `emulators/shots/${shot[1]}.png`;
  else if (emulation) {
    const rest = emulation[2]!;
    if (
      rest.includes("\\") ||
      rest
        .split("/")
        .some(
          (part) =>
            !part || part === "." || part === ".." || /[%:\0]/.test(part),
        )
    )
      return new Response("Not found", { status: 404 });
    key = `emulation/${emulation[1]}/${rest}`;
  }
  if (!key) return new Response("Not found", { status: 404 });
  const object = await objects.get(key).catch(() => null);
  // Cores that are not in the qualified package registry fall through to it.
  if (!object)
    return emulation ? undefined : new Response("Not found", { status: 404 });
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  const immutable =
    /\/[0-9a-f]{12}\//.test(key) && (ext === "wasm" || ext === "js");
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: headers(
      TYPES[ext] ?? "application/octet-stream",
      immutable ? "public, max-age=31536000, immutable" : "no-cache",
      object.size,
      object.httpEtag,
    ),
  });
}
