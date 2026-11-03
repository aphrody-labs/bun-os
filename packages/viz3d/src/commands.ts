// SPDX-License-Identifier: MIT
// The command-line surface shared by `viz3d <command>` and the skill's scripts/*.js entry points. Each command
// takes argv and returns the JSON value the upstream Python script printed, or throws UsageError (exit 2).
import { parseArgs } from "node:util";
import { loadCatalog } from "./catalog.ts";
import { gather } from "./design-context.ts";
import { type Collection, COLLECTIONS, KNOWLEDGE_KINDS } from "./manifest-contract.ts";
import { DEFAULT_DELIVERY, DELIVERY, loadHost, PROBE } from "./quality-brief.ts";
import { resolveRecords } from "./resolve.ts";
import { type Algorithm, search } from "./search.ts";

export class UsageError extends Error {}

type Spec = NonNullable<Parameters<typeof parseArgs>[0]>["options"];

export type ParsedValues = Record<string, string | boolean | (string | boolean)[] | undefined>;

export function parse(argv: string[], options: Spec): { values: ParsedValues; positionals: string[] } {
  try {
    return parseArgs({ args: argv, options: { help: { type: "boolean", short: "h" }, ...options }, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function choice<T extends string>(value: string | undefined, allowed: Iterable<T>, flag: string): T | undefined {
  if (value === undefined) return undefined;
  const set = new Set<string>(allowed);
  if (!set.has(value)) throw new UsageError(`${flag}: invalid choice '${value}' (choose from ${[...set].sort().join(", ")})`);
  return value as T;
}

export const SEARCH_HELP = `usage: search.js <query> [--limit N] [--direction ID] [--collection all|recipes|knowledge]
                 [--kind KIND] [--exclude-id ID]... [--algorithm overlap|weighted-field-bm25]
Lexical suggestions, not a semantic router or a probability of correctness.`;

export function searchCommand(argv: string[]) {
  const { values, positionals } = parse(argv, {
    limit: { type: "string" },
    direction: { type: "string" },
    collection: { type: "string" },
    kind: { type: "string" },
    "exclude-id": { type: "string", multiple: true },
    algorithm: { type: "string" },
  });
  if (values.help) return SEARCH_HELP;
  const [query, ...extra] = positionals;
  if (query === undefined || extra.length) throw new UsageError(SEARCH_HELP);
  const collection = choice(values.collection as string | undefined, COLLECTIONS, "--collection") ?? "all";
  const kind = choice(values.kind as string | undefined, KNOWLEDGE_KINDS, "--kind") ?? null;
  const algorithm = choice<Algorithm>(values.algorithm as string | undefined, ["overlap", "weighted-field-bm25"], "--algorithm") ?? null;
  const limit = values.limit === undefined ? 5 : Number(values.limit);
  if (!Number.isInteger(limit)) throw new UsageError(`--limit: invalid int value '${values.limit}'`);
  try {
    const { manifest, records } = loadCatalog(undefined, collection as Collection);
    return search(query, manifest, records, {
      limit,
      direction: (values.direction as string | undefined) ?? null,
      excludeIds: (values["exclude-id"] as string[] | undefined) ?? [],
      algorithm,
      collection: collection as Collection,
      kind,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

export const RESOLVE_HELP = `usage: resolve.js <id>... [--related]
Resolve explicitly selected records and their sources without guessing intent.`;

export function resolveCommand(argv: string[]) {
  const { values, positionals } = parse(argv, { related: { type: "boolean" } });
  if (values.help) return RESOLVE_HELP;
  if (!positionals.length) throw new UsageError(RESOLVE_HELP);
  try {
    const { manifest, records, sources } = loadCatalog(undefined, "all");
    return resolveRecords(positionals, manifest, records, sources, Boolean(values.related));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

export const CONTEXT_HELP = `usage: design-context.js <objective> [--direction ID] [--kind KIND]... [--exclude-id ID]...
                         [--blueprints [--look ID]... [--host host.json [--delivery TARGET] [--hero ID]...]]
Gather optional lexical context for the agent to synthesize a 3D design.
--host takes the report of: ${PROBE}; --delivery is one of ${Object.keys(DELIVERY).sort().join(", ")}.`;

export function contextCommand(argv: string[]) {
  const { values, positionals } = parse(argv, {
    direction: { type: "string" },
    kind: { type: "string", multiple: true },
    "exclude-id": { type: "string", multiple: true },
    blueprints: { type: "boolean" },
    look: { type: "string", multiple: true },
    host: { type: "string" },
    delivery: { type: "string" },
    hero: { type: "string", multiple: true },
  });
  if (values.help) return CONTEXT_HELP;
  const [query, ...extra] = positionals;
  if (query === undefined || extra.length) throw new UsageError(CONTEXT_HELP);
  for (const kind of (values.kind as string[] | undefined) ?? []) choice(kind, KNOWLEDGE_KINDS, "--kind");
  const delivery = choice(values.delivery as string | undefined, Object.keys(DELIVERY), "--delivery") ?? DEFAULT_DELIVERY;
  try {
    const catalog = loadCatalog(undefined, "all");
    return gather(query, catalog, {
      direction: (values.direction as string | undefined) ?? null,
      kinds: (values.kind as string[] | undefined) ?? [],
      excludeIds: (values["exclude-id"] as string[] | undefined) ?? [],
      blueprints: Boolean(values.blueprints),
      looks: (values.look as string[] | undefined) ?? [],
      host: values.host ? loadHost(values.host as string) : null,
      delivery,
      heroes: (values.hero as string[] | undefined) ?? [],
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

/** Print a command's JSON (or help text) and exit like upstream: 0, or 2 on a usage error. */
export async function main(run: (argv: string[]) => unknown | Promise<unknown>, argv = Bun.argv.slice(2)): Promise<void> {
  try {
    const out = await run(argv);
    if (out !== undefined) console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
}
