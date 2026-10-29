// SPDX-License-Identifier: Apache-2.0
// Client of the explorer wire protocol (`{"Query"|"Action": {method, library_id, payload}}`) served by
// crates/aphrody-webos-wasm/src/rpc.rs through `os.rpc`. Explorer wire envelopes of the webos VFS (the native build talks to the Spacedrive daemon instead).
import type { WebOs } from "@aphrody/webos-wasm";
import { type Entry, extOf, base } from "./files-ops";

const DEVICE = "webos";

export const sdPath = (path: string) => ({ Physical: { device_slug: DEVICE, path } });

export async function call<T = unknown>(
  os: WebOs,
  kind: "Query" | "Action",
  method: string,
  payload: unknown = null,
): Promise<T> {
  const reply = (await os.rpc({ [kind]: { method, library_id: null, payload } })) as { json?: T; error?: string };
  if (reply.error !== undefined) throw new Error(reply.error);
  return reply.json as T;
}

export interface Place {
  name: string;
  path: string;
  files: number;
  dirs: number;
  size: number;
}
export interface Context {
  /** True when the wire answered at least one query. */
  served: boolean;
  library?: string;
  places: Place[];
  volume?: { name: string; capacity: number; available: number; mount: string };
  device?: { name: string; online: boolean; arch: string | null };
  spaces: string[];
}

interface WireFile {
  name: string;
  kind: "File" | "Directory";
  size: number;
  sd_path: { Physical?: { path: string } };
}
const toEntry = (f: WireFile): Entry => {
  const path = f.sd_path.Physical?.path ?? f.name;
  return { name: f.name || base(path), path, kind: f.kind === "Directory" ? "dir" : "file", size: f.size, ext: extOf(f.name) };
};

const soft = async <T>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/** Libraries, locations, volumes, devices and spaces; each query that is not served is skipped. */
export async function loadContext(os: WebOs): Promise<Context> {
  const [libs, locs, vols, devs, spaces] = await Promise.all([
    soft(call<{ name: string }[]>(os, "Query", "query:libraries.list")),
    soft(
      call<{ locations: { name: string; sd_path: WireFile["sd_path"]; file_count: number; directory_count: number; total_size: number }[] }>(
        os,
        "Query",
        "query:locations.list",
      ),
    ),
    soft(
      call<{ volumes: { name: string; mount_point: string; total_capacity: number; available_space: number }[] }>(
        os,
        "Query",
        "query:volumes.list",
      ),
    ),
    soft(call<{ name: string; is_online: boolean; cpu_architecture: string | null }[]>(os, "Query", "query:devices.list")),
    soft(call<{ spaces: { name: string }[] }>(os, "Query", "query:spaces.list")),
  ]);
  const v = vols?.volumes?.[0];
  const d = devs?.[0];
  return {
    served: Boolean(libs || locs || vols || devs || spaces),
    library: libs?.[0]?.name,
    places: (locs?.locations ?? []).map(l => ({
      name: l.name,
      path: l.sd_path.Physical?.path ?? "/",
      files: l.file_count,
      dirs: l.directory_count,
      size: l.total_size,
    })),
    volume: v && { name: v.name, capacity: v.total_capacity, available: v.available_space, mount: v.mount_point },
    device: d && { name: d.name, online: d.is_online, arch: d.cpu_architecture },
    spaces: (spaces?.spaces ?? []).map(s => s.name),
  };
}

/** `query:search.files` (file-name search, scoped to a folder or the whole library). */
export async function searchFiles(os: WebOs, query: string, folder: string | null): Promise<Entry[]> {
  const res = await call<{ files: WireFile[] }>(os, "Query", "query:search.files", {
    query,
    scope: folder === null ? "Library" : { Path: { path: sdPath(folder) } },
  });
  return res.files.map(toEntry);
}

export interface ContentHit {
  path: string;
  line: number;
  text: string;
}
/** BM25 over text files of the home folder (`aphrody-rag-core`, `os.fs.ragSearch`). */
export function searchContents(os: WebOs, query: string, limit = 20): ContentHit[] {
  try {
    const res = JSON.parse(os.fs.ragSearch(query, limit)) as {
      results?: { path: string; start_line: number; content: string }[];
    };
    return (res.results ?? []).map(r => ({ path: r.path, line: r.start_line, text: r.content.slice(0, 160) }));
  } catch {
    return [];
  }
}

/** `query:files.by_path` through the wire (used for the info pane). */
export async function byPath(os: WebOs, path: string) {
  return call<{ content_kind: string; extension: string | null; modified_at: string; kind: string }>(
    os,
    "Query",
    "query:files.by_path",
    { path },
  );
}
