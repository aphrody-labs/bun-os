#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-control-regex -- Queries reject raw control characters. */
import { lstat, open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createPublicIndexSearch, type PublicIndexCollection } from "./public-index.ts";

const HELP = {
  command: "bun-google-index-public",
  usage:
    "bun-google-index-public --root <absolute-export-root> --collections-file <absolute-policy.json> --collection <slug> --query <text> [--num 1..20] [--start 0..1000]",
  source: "public-crawl-cache",
};
const FLAGS = new Set(["--root", "--collections-file", "--collection", "--query", "--num", "--start"]);

async function readCollections(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 65536 || before.nlink !== 1)
    throw new Error("Public index configuration unavailable");
  const file = await open(path, "r");
  try {
    signal?.throwIfAborted();
    const actual = await file.stat();
    if (!actual.isFile() || actual.ino !== before.ino || actual.dev !== before.dev || actual.size !== before.size)
      throw new Error("Public index configuration unavailable");
    const buffer = Buffer.alloc(actual.size + 1);
    let size = 0;
    while (size < buffer.length) {
      signal?.throwIfAborted();
      const result = await file.read(buffer, size, buffer.length - size, null);
      signal?.throwIfAborted();
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size !== actual.size) throw new Error("Public index configuration unavailable");
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Public index configuration unavailable");
    return value as Record<string, PublicIndexCollection>;
  } finally {
    await file.close();
  }
}

/** Reads only caller-selected public policy/export paths; no provider authentication. */
export async function runPublicIndexCommand(args: string[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (args.length === 1 && args[0] === "--help") return { ...HELP };
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    const value = args[i + 1];
    if (!FLAGS.has(key) || flags.has(key) || typeof value !== "string")
      throw new TypeError("Invalid public index arguments; use --help");
    flags.set(key, value);
  }
  const root = flags.get("--root");
  const configuration = flags.get("--collections-file");
  const collection = flags.get("--collection");
  const query = flags.get("--query");
  const rawNum = flags.get("--num") ?? "10";
  const rawStart = flags.get("--start") ?? "0";
  const num = Number(rawNum);
  const start = Number(rawStart);
  if (
    !root ||
    !isAbsolute(root) ||
    !configuration ||
    !isAbsolute(configuration) ||
    !collection ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(collection) ||
    !query ||
    !query.trim() ||
    Buffer.byteLength(query) > 4096 ||
    /[\u0000-\u001f\u007f]/.test(query) ||
    !/^\d+$/.test(rawNum) ||
    num < 1 ||
    num > 20 ||
    !/^\d+$/.test(rawStart) ||
    start > 1000 ||
    !Number.isSafeInteger(start)
  )
    throw new TypeError("Invalid public index arguments; use --help");
  try {
    const collections = await readCollections(configuration, signal);
    signal?.throwIfAborted();
    const search = createPublicIndexSearch({ root, collections });
    try {
      return await search({ query, collection, num, start }, signal);
    } finally {
      search.close();
    }
  } catch {
    signal?.throwIfAborted();
    throw new Error("Public index unavailable");
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    console.log(JSON.stringify(await runPublicIndexCommand(Bun.argv.slice(2), controller.signal)));
  } catch {
    console.error("Public index command failed; verify explicit public configuration and input");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
