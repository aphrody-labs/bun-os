// SPDX-License-Identifier: Apache-2.0
/**
 * Google services facade (Drive, Docs, Gemini) on upstream Bun `fetch`, ported from aphrody-labs/bun-google, which
 * depended on the abandoned fork builtin `bun:google`. Bearer tokens come from `token()`: the Bun OS backend broker
 * (`GET /api/google/token?account=owner|service`, crates/bun-os-google) or any Google Auth Library client.
 */

export interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  size?: string;
  [key: string]: unknown;
}

export interface DrivePage {
  files?: DriveFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

export interface GoogleDocument {
  documentId?: string;
  title?: string;
  revisionId?: string;
  [key: string]: unknown;
}

export interface ServiceOptions {
  /** Current bearer token (called per request; cache inside). */
  token: () => Promise<string> | string;
  fetch?: typeof fetch;
  endpoints?: { drive?: string; docs?: string; gemini?: string };
}

/** Token provider over the Bun OS backend broker (`/api/google/token`), cached until 60 s before expiry. */
export function backendToken(options: { base?: string; adminToken: string; account?: "owner" | "service"; scope?: string }) {
  let cached: { token: string; until: number } | undefined;
  return async (): Promise<string> => {
    if (cached && cached.until > Date.now()) return cached.token;
    const url = new URL("/api/google/token", options.base ?? "http://127.0.0.1:8790");
    url.searchParams.set("account", options.account ?? "owner");
    if (options.scope) url.searchParams.set("scope", options.scope);
    const res = await fetch(url, { headers: { authorization: `Bearer ${options.adminToken}` } });
    const body = (await res.json()) as { ok?: boolean; access_token?: string; error?: string };
    if (!res.ok || !body.access_token) throw new Error(`Google token broker: ${body.error ?? res.status}`);
    cached = { token: body.access_token, until: Date.now() + 50 * 60_000 };
    return body.access_token;
  };
}

function id(value: string): string {
  if (typeof value !== "string" || !value || value === "." || value === "..")
    throw new TypeError("Google resource ID must be non-empty");
  return encodeURIComponent(value);
}

function query(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value));
  return params.size ? `?${params}` : "";
}

function record(value: unknown, resource: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Google ${resource} response is invalid`);
  return value as Record<string, unknown>;
}

function driveFile(value: unknown): DriveFile {
  const file = record(value, "Drive file");
  for (const field of ["id", "name", "mimeType", "modifiedTime", "md5Checksum", "size"])
    if (file[field] !== undefined && file[field] !== null && typeof file[field] !== "string")
      throw new Error("Google Drive file response is invalid");
  return file as DriveFile;
}

async function drivePage(response: Response): Promise<DrivePage> {
  const page = record(await response.json(), "Drive list");
  if (page.files !== undefined && !Array.isArray(page.files)) throw new Error("Google Drive list response is invalid");
  if (page.nextPageToken !== undefined && typeof page.nextPageToken !== "string")
    throw new Error("Google Drive list response is invalid");
  return {
    files: (page.files as unknown[] | undefined)?.map(driveFile),
    nextPageToken: page.nextPageToken as string | undefined,
    incompleteSearch: page.incompleteSearch as boolean | undefined,
  };
}

function client(base: string, options: ServiceOptions) {
  const doFetch = options.fetch ?? fetch;
  return {
    async request(path: string, init: RequestInit = {}): Promise<Response> {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${await options.token()}`);
      const res = await doFetch(new URL(path, base), { ...init, headers });
      if (!res.ok) {
        let message = `${res.status}`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          message = body.error?.message ?? message;
        } catch {}
        throw new Error(`Google API ${res.status}: ${message}`);
      }
      return res;
    },
  };
}

export function createGoogleServices(options: ServiceOptions) {
  const drive = client(options.endpoints?.drive ?? "https://www.googleapis.com/drive/v3/", options);
  const docs = client(options.endpoints?.docs ?? "https://docs.googleapis.com/v1/", options);
  const gemini = client(options.endpoints?.gemini ?? "https://generativelanguage.googleapis.com/v1beta/", options);
  return {
    drive: {
      async listFiles(
        params: { q?: string; fields?: string; pageSize?: number; pageToken?: string; supportsAllDrives?: boolean; includeItemsFromAllDrives?: boolean } = {},
        signal?: AbortSignal,
      ): Promise<DrivePage> {
        if (params.pageSize !== undefined && (!Number.isInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 1000))
          throw new RangeError("Drive pageSize must be an integer from 1 through 1000");
        return drivePage(await drive.request(`files${query(params)}`, { signal }));
      },
      async getFile(fileId: string, fields?: string, signal?: AbortSignal): Promise<DriveFile> {
        return driveFile(await (await drive.request(`files/${id(fileId)}${query({ fields })}`, { signal })).json());
      },
      async exportFile(fileId: string, mimeType: string, signal?: AbortSignal): Promise<Response> {
        if (!mimeType) throw new TypeError("Drive export requires a MIME type");
        return drive.request(`files/${id(fileId)}/export${query({ mimeType })}`, { signal });
      },
      async *files(
        params: { q?: string; fields?: string; pageSize?: number } = {},
        opts: { maxPages?: number; signal?: AbortSignal } = {},
      ): AsyncGenerator<DriveFile> {
        const maxPages = opts.maxPages ?? 100;
        if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new RangeError("Drive maxPages must be a positive integer");
        if (params.fields && !params.fields.includes("nextPageToken"))
          throw new TypeError("Drive pagination fields must include nextPageToken");
        const seen = new Set<string>();
        let pageToken: string | undefined;
        for (let page = 0; page < maxPages; page++) {
          const result = await this.listFiles({ ...params, pageToken }, opts.signal);
          for (const file of result.files ?? []) yield file;
          if (!result.nextPageToken) return;
          if (seen.has(result.nextPageToken)) throw new Error("Drive returned a repeated page token");
          seen.add(result.nextPageToken);
          pageToken = result.nextPageToken;
        }
        throw new Error("Drive pagination exceeded maxPages");
      },
    },
    docs: {
      async get(documentId: string, signal?: AbortSignal): Promise<GoogleDocument> {
        return record(await (await docs.request(`documents/${id(documentId)}`, { signal })).json(), "Docs document") as GoogleDocument;
      },
      async batchUpdate(documentId: string, requests: readonly Record<string, unknown>[], requiredRevisionId: string, signal?: AbortSignal): Promise<unknown> {
        if (!requiredRevisionId?.trim()) throw new TypeError("Docs batchUpdate requires the reviewed revision ID");
        const res = await docs.request(`documents/${id(documentId)}:batchUpdate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requests, writeControl: { requiredRevisionId } }),
          signal,
        });
        return res.json();
      },
    },
    gemini: {
      async generate(model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
        const res = await gemini.request(`models/${id(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        return res.json();
      },
      /** Returns the SSE response; the caller owns reading and cancelling its body. */
      stream(model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
        return gemini.request(`models/${id(model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
      },
    },
  };
}
