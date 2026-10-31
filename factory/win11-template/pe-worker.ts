// SPDX-License-Identifier: Apache-2.0
// Worker of scan.ts: PE facts of one file (bun:windows pe.parse + catalog lookup + SHA-256). Metadata only:
// the bytes are read, parsed and hashed here and never leave the worker.
import windows from "bun:windows";
import { openSync, readSync, closeSync, fstatSync } from "node:fs";

declare const self: Worker;

export interface PeFacts {
  kind: string;
  machine: string;
  bits: number;
  subsystem: string;
  characteristics: number;
  dllCharacteristics: number;
  timestamp: number;
  imageSize: number;
  dotnet: boolean;
  exportName: string | null;
  version: Record<string, string>;
  /** [name | null, ordinal, forwarder | null] */
  exports: [string | null, number, string | null][];
  /** [module, delay, functions] */
  imports: [string, boolean, string[]][];
  embeddedSigner: string | null;
  catalog: string | null;
  catalogSigner: string | null;
  sha256: string;
  /** Resource tree summary when the runtime's pe.parse reports one: [type, name, language, size]. */
  resources?: [string, string, number, number][];
  /** `.apiset` section of apisetschema.dll, parsed: contract -> hosts. */
  apiSets?: Record<string, string[]>;
  warnings: number;
}

export type Job = { id: number; path: string; name: string; catalog: boolean };
export type Result = {
  id: number;
  facts: PeFacts | null;
  error?: string;
  notPe?: boolean;
  catalogOnly?: { catalog: string | null; signer: string | null };
};

const MAX_BYTES = 512 << 20;

function readAll(path: string): Uint8Array | null {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    if (size > MAX_BYTES) return null;
    const buf = new Uint8Array(size);
    let at = 0;
    while (at < size) {
      const n = readSync(fd, buf, at, size - at, at);
      if (n <= 0) break;
      at += n;
    }
    return buf.subarray(0, at);
  } finally {
    closeSync(fd);
  }
}

function catalogOf(path: string): { catalog: string | null; signer: string | null } {
  try {
    const sig = windows.pe.catalogSignature(path);
    return { catalog: sig?.catalog ?? null, signer: sig?.signer ?? null };
  } catch {
    return { catalog: null, signer: null };
  }
}

export function peFacts(path: string, name: string, withCatalog: boolean): Result & { id: -1 } {
  const bytes = readAll(path);
  if (!bytes) return { id: -1, facts: null, error: "too large" };
  if (!windows.pe.looksLikePe(bytes)) {
    return { id: -1, facts: null, notPe: true, catalogOnly: withCatalog ? catalogOf(path) : undefined };
  }
  const info = windows.pe.parse(bytes, name) as any;
  if (!info) return { id: -1, facts: null, notPe: true, catalogOnly: withCatalog ? catalogOf(path) : undefined };
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  const cat = withCatalog ? catalogOf(path) : { catalog: null, signer: null };
  const strings: Record<string, string> = info.version?.strings ?? {};
  const facts: PeFacts = {
    kind: info.kind,
    machine: info.machine,
    bits: info.bits,
    subsystem: info.subsystem,
    characteristics: info.characteristics,
    dllCharacteristics: info.dllCharacteristics,
    timestamp: info.timestamp,
    imageSize: info.imageSize,
    dotnet: info.isDotnet,
    exportName: info.exportName,
    version: Object.fromEntries(
      [
        "CompanyName",
        "FileDescription",
        "FileVersion",
        "ProductVersion",
        "OriginalFilename",
        "InternalName",
        "ProductName",
      ]
        .filter(k => typeof strings[k] === "string")
        .map(k => [k, strings[k]!.slice(0, 256)]),
    ),
    exports: info.exports.map((e: any) => [e.name, e.ordinal, e.forwarder]),
    imports: info.imports.map((i: any) => [i.module, i.delay, i.functions]),
    embeddedSigner: info.authenticode?.signer ?? null,
    catalog: cat.catalog,
    catalogSigner: cat.signer,
    sha256: hasher.digest("hex"),
    warnings: info.warnings.length,
  };
  if (Array.isArray(info.resources))
    facts.resources = info.resources.map((r: any) => [String(r.type), String(r.name), r.language ?? 0, r.size ?? 0]);
  if (name.toLowerCase() === "apisetschema.dll") {
    const section = info.sections.find((s: any) => s.name === ".apiset");
    if (section) {
      const map = windows.pe.parseApiSetSchema(
        bytes.subarray(section.rawOffset, section.rawOffset + section.rawSize),
      ) as Map<string, string[]>;
      facts.apiSets = Object.fromEntries(map);
    }
  }
  return { id: -1, facts };
}

if (typeof self !== "undefined" && !Bun.isMainThread) {
  self.onmessage = (event: MessageEvent<Job[]>) => {
    const out: Result[] = [];
    for (const job of event.data) {
      try {
        const r = peFacts(job.path, job.name, job.catalog);
        out.push({ ...r, id: job.id });
      } catch (e) {
        out.push({ id: job.id, facts: null, error: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
    postMessage(out);
  };
}
