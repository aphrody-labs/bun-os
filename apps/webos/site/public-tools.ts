export const PUBLIC_BUN_TOOLS = [
  {
    name: "bun_site_snapshot",
    path: "/api/site/snapshot",
    description: "Read the active public Bun source snapshot and its coverage receipt.",
    properties: {},
    required: [],
  },
  {
    name: "bun_site_docs_search",
    path: "/api/site/docs",
    description: "Search public Bun documentation and return source citations.",
    properties: {
      q: { type: "string", minLength: 1, maxLength: 500, description: "Documentation search terms." },
      limit: { type: "integer", minimum: 1, maximum: 8, description: "Maximum results, from 1 to 8." },
    },
    required: ["q"],
  },
  {
    name: "bun_site_graph",
    path: "/api/site/graph",
    description: "Inspect the public Bun source graph, including its snapshot and extraction limits.",
    properties: {
      q: { type: "string", maxLength: 500, description: "Symbol or source search terms." },
      domain: { type: "string", maxLength: 500, description: "Source domain under src, packages, docs or scripts." },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum domains, from 1 to 100." },
    },
    required: [],
  },
  {
    name: "bun_site_releases",
    path: "/api/site/releases",
    description: "Read public Bun release assets and their recorded qualification.",
    properties: {},
    required: [],
  },
] as const;
export type PublicBunToolName = (typeof PUBLIC_BUN_TOOLS)[number]["name"];
export function publicBunToolRequest(name: string, input: unknown, base: string | URL): Request {
  const tool = PUBLIC_BUN_TOOLS.find(tool => tool.name === name);
  if (!tool) throw new TypeError("Unknown public Bun tool");
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new TypeError("Tool input must be an object");
  const parameters = input as Record<string, unknown>;
  const fields = tool.properties as Record<
    string,
    { type: string; minLength?: number; maxLength?: number; minimum?: number; maximum?: number }
  >;
  for (const required of tool.required)
    if (parameters[required] === undefined) throw new TypeError(`Missing ${required}`);
  const url = new URL(tool.path, base);
  for (const [name, value] of Object.entries(parameters)) {
    const schema = fields[name];
    if (!schema) throw new TypeError(`Unknown parameter ${name}`);
    if (schema.type === "string") {
      if (
        typeof value !== "string" ||
        value.length < (schema.minLength ?? 0) ||
        value.length > (schema.maxLength ?? 500)
      )
        throw new TypeError(`Invalid ${name}`);
    } else if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < schema.minimum! ||
      value > schema.maximum!
    )
      throw new TypeError(`Invalid ${name}`);
    url.searchParams.set(name, String(value));
  }
  return new Request(url.href, { method: "GET" });
}
