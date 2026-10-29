import { unmanaged } from "./hostfxr";
import { ptr } from "bun:ffi";
import { join } from "node:path";
import { build, isBuilt, outputDirectory } from "./build";

export { build, isBuilt, outputDirectory };

export interface DsPlugin {
  id: string;
  type: string;
  name: string;
  developer?: string;
  publisher?: string;
  extensions?: string[];
}

export interface DsEntry {
  path: string;
  size: number;
}

export interface DsImageInfo {
  name: string;
  width: number;
  height: number;
  format: number;
  indexed: boolean;
}

export type DsListing =
  | { plugin: DsPlugin; kind: "archive"; entries: DsEntry[] }
  | { plugin: DsPlugin; kind: "image"; images: DsImageInfo[] }
  | { plugin: DsPlugin; kind: "text" | "font" | "other" };

export interface H3dSummary {
  models: string[];
  textures: { name: string; width: number; height: number; format: string }[];
  skeletalAnimations: number;
  materialAnimations: number;
}

type Invoke = (request: unknown, length: number, response: unknown, capacity: number) => number;

let invoke: Invoke | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function host(): Invoke {
  if (invoke) return invoke;
  if (!isBuilt()) build();
  invoke = unmanaged<Invoke>(
    { assembly: join(outputDirectory, "Aphrody.Ds.dll"), type: "Aphrody.Ds.Exports, Aphrody.Ds", method: "Invoke" },
    { args: ["ptr", "i32", "ptr", "i32"], returns: "i32" },
  );
  return invoke;
}

function call<T>(request: Record<string, unknown>): T {
  const fn = host();
  const bytes = encoder.encode(JSON.stringify(request));
  let capacity = 1 << 16;
  for (;;) {
    const response = new Uint8Array(capacity);
    const length = fn(ptr(bytes), bytes.length, ptr(response), capacity);
    if (length < 0) {
      capacity = -length;
      continue;
    }
    const body = JSON.parse(decoder.decode(response.subarray(0, length))) as {
      ok: boolean;
      result?: T;
      error?: string;
      type?: string;
    };
    if (!body.ok) throw new Error(`${body.type ?? "DotnetError"}: ${body.error}`);
    return body.result as T;
  }
}

/** Kuriimu2 file plugins available to the host (Nintendo and Level-5 formats). */
export function plugins(): { plugins: DsPlugin[]; errors: string[] } {
  return call({ op: "plugins" });
}

/** Detects the format of a file (NDS, NARC, CIA, NCSD/CCI, NCCH/CXI, GARC, BCLIM, BCH, CGFX, CTPK, Level-5 containers, ...). */
export function identify(path: string): { plugin: DsPlugin | null; candidates?: DsPlugin[] } {
  return call({ op: "identify", path });
}

/** Opens a file with the detected plugin (content, then extension match; `plugin` is an id or name) and lists its entries or images. */
export function list(path: string, plugin?: string): DsListing {
  return call({ op: "list", path, plugin });
}

/** Extracts one archive entry to `out`. */
export function extract(path: string, entry: string, out: string, plugin?: string): { bytes: number } {
  return call({ op: "extract", path, entry, out, plugin });
}

/** Extracts every entry of an archive into the directory `out`. */
export function extractAll(path: string, out: string, plugin?: string): { files: number; bytes: number } {
  return call({ op: "extractAll", path, out, plugin });
}

/** Decodes an image file (or an image entry of an archive) to PNG. */
export function toPng(path: string, out: string, entry?: string, plugin?: string): { width: number; height: number } {
  return call({ op: "png", path, out, entry, plugin });
}

/** Summarizes a BCH or CGFX model container (SPICA). */
export function h3d(path: string): H3dSummary {
  return call({ op: "h3d", path });
}

/** Unpacks a 3DS ExeFS (pk3DS). */
export function exefs(path: string, out: string): { ok: boolean; files: string[] } {
  return call({ op: "exefs", path, out });
}

/** Reports how each plugin assembly loads (exported types, plugin count, load errors). */
export function diagnose(): unknown[] {
  return call({ op: "diagnose" });
}
