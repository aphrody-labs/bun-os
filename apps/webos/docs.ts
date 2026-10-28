// SPDX-License-Identifier: Apache-2.0
// Builds the Docs app corpus: the Bun fork documentation (feature catalog, runtime, bundler, test, pm, lint, format,
// guides) and the Bun OS documentation (architecture, goals, plans, products). Output: dist/docs/<collection>/index.json
// (titles, groups, search text) and one markdown file per page, loaded on demand.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

/** Prefer the declared source owner; packaged runtime executables need not live in a checkout. */
function bunCheckout(): string | undefined {
  const fromEnv = process.env.APHRODY_BUN_CHECKOUT;
  if (fromEnv) {
    const checkout = resolve(root, fromEnv);
    if (!existsSync(join(checkout, "docs/docs.json")))
      throw new Error("APHRODY_BUN_CHECKOUT does not contain the Bun documentation catalog.");
    return checkout;
  }
  const pinned = join(root, "sources/bun");
  if (existsSync(join(pinned, "docs/docs.json"))) return pinned;
  let dir = dirname(process.execPath);
  for (let i = 0; i < 6; i++, dir = dirname(dir)) if (existsSync(join(dir, "docs/docs.json"))) return dir;
  return undefined;
}

interface Collection {
  id: string;
  label: string;
  root: string;
  include: string[];
  exclude: RegExp;
}

const SKIP = /(^|\/)(images|icons|logo|snippets|node_modules|aphrody-source|chromium)\//;

interface Entry {
  id: string;
  title: string;
  description: string;
  group: string;
  bytes: number;
  text: string;
}

function frontmatter(source: string): { meta: Record<string, string>; body: string } {
  if (!source.startsWith("---")) return { meta: {}, body: source };
  const end = source.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of source.slice(3, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: source.slice(end + 4).replace(/^\r?\n/, "") };
}

/** Remove MDX-only syntax (imports, exports, JSX wrappers) so the page is plain Markdown. */
function plain(body: string): string {
  const lines: string[] = [];
  let fence = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) fence = !fence;
    if (!fence && (/^(import|export) /.test(line) || /^\s*<\/?[A-Z][A-Za-z]*[^>]*>\s*$/.test(line))) continue;
    lines.push(line);
  }
  return lines.join("\n");
}

async function collect(c: Collection, dist: string): Promise<number> {
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const pattern of c.include) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: c.root })) {
      const rel = file.replaceAll("\\", "/");
      if (seen.has(rel) || SKIP.test(rel) || c.exclude.test(rel)) continue;
      seen.add(rel);
      const raw = await Bun.file(join(c.root, rel)).text();
      const { meta, body } = frontmatter(raw);
      const text = plain(body).slice(0, 80_000);
      const id = rel.replace(/\.(mdx|md)$/, "");
      const heading = /^#\s+(.+)$/m.exec(text)?.[1];
      const title = meta.title || heading || id.split("/").pop()!;
      const entry: Entry = {
        id,
        title,
        description: meta.description ?? "",
        group: id.includes("/") ? id.split("/")[0]! : "overview",
        bytes: text.length,
        text: text.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|_-]+/g, " ").replace(/\s+/g, " ").slice(0, 1200),
      };
      entries.push(entry);
      const out = join(dist, "docs", c.id, `${id}.md`);
      await mkdir(dirname(out), { recursive: true });
      await Bun.write(out, `# ${title}\n\n${text}`);
    }
  }
  entries.sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
  await Bun.write(join(dist, "docs", c.id, "index.json"), JSON.stringify({ id: c.id, label: c.label, pages: entries }));
  return entries.length;
}

export async function buildDocs(dist: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const bun = bunCheckout();
  const collections: Collection[] = [
    {
      id: "bunos",
      label: "Bun OS",
      root: join(root, "docs"),
      include: ["*.md", "architecture/**/*.md", "agent-goals/**/*.md", "product/**/*.md", "webos/**/*.md", "aphrody/plans/**/*.md", "aphrody/architecture/**/*.md", "aphrody/products/**/*.md"],
      exclude: /(^|\/)(node_modules|vendor)\//,
    },
  ];
  if (bun) {
    collections.unshift({
      id: "bun",
      label: "Bun (Aphrody fork)",
      root: join(bun, "docs"),
      include: ["**/*.mdx", "**/*.md"],
      exclude: /^(README|style)\./,
    });
  } else console.warn("docs: no Bun checkout found (set APHRODY_BUN_CHECKOUT); the Bun collection is skipped");
  for (const c of collections) out[c.id] = await collect(c, dist);
  await Bun.write(join(dist, "docs", "collections.json"), JSON.stringify(collections.map(c => ({ id: c.id, label: c.label }))));

  return out;
}
