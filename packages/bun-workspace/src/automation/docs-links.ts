import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

/** Default location of the declared third-party documentation trees. */
export const IMPORTED_UPSTREAM_DOCS_CONFIG = "tools/config/docs/imported-upstream-docs.json";

interface ImportedTree {
  id: string;
  include: string[];
  except?: string[];
}

/** Load the declared imported upstream trees and return a matcher for root-relative paths. */
export function importedUpstreamMatcher(
  root: string,
  configPath = IMPORTED_UPSTREAM_DOCS_CONFIG,
): (relativePath: string) => string | undefined {
  const file = resolve(root, configPath);
  if (!existsSync(file)) return () => undefined;
  const config = JSON.parse(readFileSync(file, "utf8")) as {
    trees?: ImportedTree[];
  };
  const trees = (config.trees ?? []).map(tree => ({
    id: tree.id,
    include: tree.include.map(pattern => new Bun.Glob(pattern)),
    except: (tree.except ?? []).map(pattern => new Bun.Glob(pattern)),
  }));
  return relativePath => {
    for (const tree of trees)
      if (tree.include.some(glob => glob.match(relativePath)) && !tree.except.some(glob => glob.match(relativePath)))
        return tree.id;
    return undefined;
  };
}

/** Default location of documents whose backtick-path check is explicitly deferred. */
export const DOC_PATH_CHECK_DEFERRED_CONFIG = "tools/config/docs/doc-path-check-deferred.json";

function deferredPathCheckFiles(root: string): Set<string> {
  const file = resolve(root, DOC_PATH_CHECK_DEFERRED_CONFIG);
  if (!existsSync(file)) return new Set();
  const config = JSON.parse(readFileSync(file, "utf8")) as {
    deferred?: Array<{ file: string }>;
  };
  return new Set((config.deferred ?? []).map(entry => entry.file));
}

/** Evidence trees whose backtick paths deliberately record historical or source-repository paths. */
const HISTORICAL_PATH_TREES = [new Bun.Glob("docs/migration/**")];

/** Document-level opt-out: the document's backtick paths name another repository layout or git history. */
export const EXTERNAL_PATHS_MARKER = "<!-- docs-links: external-paths";
/** Inline marker placed right after a code span whose path is intentionally absent from this checkout. */
const ABSENT_PATH_SUFFIX = /^\s*\(not in repo\)/;

// MCP method names can share a root segment with tools/, but name protocol operations.
const MCP_TOOL_METHODS = new Set(["tools/list", "tools/call"]);

const BACKTICK_PATH = /^[A-Za-z0-9_.@-][A-Za-z0-9_.@+/-]*$/;

/**
 * Extract inline-code spans that name a repository path: no whitespace, no glob or
 * placeholder syntax, at least one `/`, and a first segment that exists at the root.
 */
export function backtickRepositoryPaths(content: string, rootEntries: Set<string>): string[] {
  const paths: string[] = [];
  const prose = content.replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
  for (const match of prose.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) {
    if (ABSENT_PATH_SUFFIX.test(prose.slice(match.index! + match[0].length, match.index! + match[0].length + 16)))
      continue;
    let value = match[1]!.trim();
    value = value.replace(/:\d+(?:[-:]\d+)?$/, "").replace(/#.*$/, "");
    if (value.startsWith("./")) value = value.slice(2);
    if (!BACKTICK_PATH.test(value) || !value.includes("/") || value.includes("//")) continue;
    if (value.includes("...") || MCP_TOOL_METHODS.has(value)) continue;
    const first = value.split("/", 1)[0]!;
    if (!rootEntries.has(first)) continue;
    paths.push(value.replace(/\/+$/, ""));
  }
  return paths;
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

async function getFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(entry => {
      const res = join(dir, entry.name);
      return entry.isDirectory() ? getFiles(res) : res;
    }),
  );
  return files.flat().filter(f => f.endsWith(".md") || f.endsWith(".mdx"));
}

async function verifyPath(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile() || s.isDirectory();
  } catch {
    return false;
  }
}

/** Extract inline Markdown destinations, including wrapped paths and balanced parentheses. */
export function markdownLinkDestinations(content: string): string[] {
  const links: string[] = [];
  const labels = /!?\[(?:\\.|[^\]\\])*\]\(/g;
  while (labels.exec(content) !== null) {
    let cursor = labels.lastIndex;
    while (/\s/.test(content[cursor] ?? "") && cursor < content.length) cursor++;
    let destination = "";
    if (content[cursor] === "<") {
      const start = ++cursor;
      while (cursor < content.length && content[cursor] !== ">" && content[cursor] !== "\n") {
        cursor += content[cursor] === "\\" ? 2 : 1;
      }
      if (content[cursor] !== ">") continue;
      destination = content.slice(start, cursor++);
    } else {
      const start = cursor;
      let depth = 0;
      while (cursor < content.length) {
        const char = content[cursor]!;
        if (char === "\\") {
          cursor += 2;
          continue;
        }
        if (char === "(") depth++;
        else if (char === ")") {
          if (!depth) break;
          depth--;
        } else if (/\s/.test(char) && !depth) break;
        cursor++;
      }
      if (depth) continue;
      destination = content.slice(start, cursor);
    }
    // A destination may be followed by a quoted or parenthesized title.
    const ending = /^(?:\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)))?\s*\)/.exec(
      content.slice(cursor),
    );
    if (!ending) continue;
    links.push(destination.replace(/\\([\\()[\]<>])/g, "$1"));
    labels.lastIndex = cursor + ending[0].length;
  }
  return links;
}

function documentationRouteCandidates(docsDir: string, route: string): string[] {
  const relativeRoute = route.replace(/^\/+/, "");
  if (relativeRoute.split(/[\\/]/).includes("..")) return [];
  const page = join(docsDir, relativeRoute);
  return [page, `${page}.md`, `${page}.mdx`, join(page, "index.md"), join(page, "index.mdx")];
}

export async function runDocsLinks(args: string[]): Promise<number> {
  let root = process.cwd();
  let docs = "docs";
  let scope: "docs" | "repository" = "docs";
  let webRoutes = false;
  let json = false;
  const excludedFiles: string[] = [];
  let importedConfig = IMPORTED_UPSTREAM_DOCS_CONFIG;
  let backtickPaths = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--docs") docs = args[++index] ?? "";
    else if (arg === "--exclude-file") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--exclude-file requires a path");
      excludedFiles.push(value);
    } else if (arg === "--imported-config") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--imported-config requires a path");
      importedConfig = value;
    } else if (arg === "--no-backtick-paths") backtickPaths = false;
    else if (arg === "--scope") {
      const value = args[++index];
      if (value !== "docs" && value !== "repository") throw new Error("--scope must be docs or repository");
      scope = value;
    } else if (arg === "--web-routes") webRoutes = true;
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops docs-links [--root <repository>] [--docs <directory>] [--scope docs|repository] [--exclude-file <root-relative path>] [--imported-config <json>] [--no-backtick-paths] [--web-routes] [--json]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root || !docs) throw new Error("--root and --docs require a path");
  const ROOT_DIR = resolve(root);
  const DOCS_DIR = resolve(ROOT_DIR, docs);
  if (!json) console.log("🔗 Vérification des liens de documentation...");

  const files = await getFiles(DOCS_DIR);
  if (scope === "repository") {
    const rootEntries = await readdir(ROOT_DIR, { withFileTypes: true });
    for (const entry of rootEntries)
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(join(ROOT_DIR, entry.name));
  }
  const excluded = new Set<string>();
  for (const requested of excludedFiles) {
    const file = resolve(ROOT_DIR, requested);
    if (!files.includes(file)) throw new Error(`Excluded file is not an inventoried Markdown document: ${requested}`);
    excluded.add(file);
  }
  const isImported = importedUpstreamMatcher(ROOT_DIR, importedConfig);
  const rootEntries = new Set(await readdir(ROOT_DIR));
  const deferredPathCheck = deferredPathCheckFiles(ROOT_DIR);
  const checkedFiles: string[] = [];
  const importedSkipped = new Map<string, number>();
  let totalLinks = 0;
  let brokenLinks = 0;
  let totalBacktickPaths = 0;
  const findings: Array<{ file: string; link: string; target: string }> = [];
  const deadPaths: Array<{ file: string; path: string }> = [];

  for (const file of files) {
    if (excluded.has(file)) continue;
    const rootRelative = relative(ROOT_DIR, file).replaceAll("\\", "/");
    const importedTree = isImported(rootRelative);
    if (importedTree) {
      importedSkipped.set(importedTree, (importedSkipped.get(importedTree) ?? 0) + 1);
      continue;
    }
    checkedFiles.push(rootRelative);

    // oxlint-disable-next-line no-await-in-loop -- Bound memory while scanning imported documentation.
    const content = await readFile(file, "utf-8");
    const fileDir = dirname(file);

    if (
      backtickPaths &&
      !HISTORICAL_PATH_TREES.some(glob => glob.match(rootRelative)) &&
      !deferredPathCheck.has(rootRelative) &&
      !content.includes(EXTERNAL_PATHS_MARKER) &&
      // Generated pages are validated by their generator (docs:check), not by hand edits.
      !content.slice(0, 400).includes("<!-- @generated")
    ) {
      for (const path of backtickRepositoryPaths(content, rootEntries)) {
        totalBacktickPaths++;
        if (pathExists(join(ROOT_DIR, path)) || pathExists(join(fileDir, path))) continue;
        deadPaths.push({ file: rootRelative, path });
        if (!json) console.error(`❌ Chemin mort dans [${rootRelative}] : \`${path}\``);
      }
    }

    // Retirer les blocs de code (fenced et inline) pour éviter de valider de faux liens dans des exemples de code
    const cleanContent = content.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");

    for (const linkUrl of markdownLinkDestinations(cleanContent)) {
      // Ignorer les liens externes
      if (linkUrl.startsWith("http://") || linkUrl.startsWith("https://") || linkUrl.startsWith("mailto:")) {
        continue;
      }

      // Ignorer les ancres de même page (#...)
      if (linkUrl.startsWith("#")) {
        continue;
      }

      totalLinks++;
      let path: string;
      try {
        // Strip URL metadata before decoding so %23 and %3F remain filename characters.
        path = decodeURIComponent(linkUrl.split(/[?#]/, 1)[0] ?? "");
      } catch {
        findings.push({
          file: rootRelative,
          link: linkUrl,
          target: "<invalid URL encoding>",
        });
        brokenLinks++;
        continue;
      }
      let targets: string[];
      if (path.startsWith("file:///")) {
        targets = [join(ROOT_DIR, path.slice("file:///".length))];
      } else if (webRoutes && path.startsWith("/")) {
        targets = documentationRouteCandidates(DOCS_DIR, path);
      } else {
        targets = [resolve(fileDir, path)];
      }

      // oxlint-disable-next-line no-await-in-loop -- Bound outstanding filesystem probes to one destination.
      const exists = (await Promise.all(targets.map(verifyPath))).some(Boolean);
      if (!exists) {
        const targetPath = targets[0] ?? "<invalid route>";
        findings.push({
          file: rootRelative,
          link: linkUrl,
          target: targetPath,
        });
        if (!json)
          console.error(`❌ Lien cassé dans [${rootRelative}] : "${linkUrl}" (Cible non trouvée: ${targetPath})`);
        brokenLinks++;
      }
    }
  }

  if (json)
    console.log(
      JSON.stringify(
        {
          scanned: files.length,
          checked: checkedFiles.length,
          checkedFiles,
          excluded: [...excluded].map(file => relative(ROOT_DIR, file).replaceAll("\\", "/")),
          importedSkipped: Object.fromEntries(importedSkipped),
          links: totalLinks,
          broken: brokenLinks,
          findings,
          backtickPaths: totalBacktickPaths,
          deadBacktickPaths: deadPaths.length,
          deadPaths,
        },
        null,
        2,
      ),
    );
  else {
    console.log(`\n📊 Bilan de la vérification :`);
    console.log(`   - Documents inventoriés : ${files.length}`);
    console.log(`   - Documents vérifiés : ${checkedFiles.length}`);
    console.log(`   - Liens locaux vérifiés : ${totalLinks}`);
    console.log(`   - Liens cassés trouvés  : ${brokenLinks}`);
    console.log(`   - Chemins \`code\` vérifiés : ${totalBacktickPaths}`);
    console.log(`   - Chemins \`code\` morts    : ${deadPaths.length}`);
    for (const [tree, count] of importedSkipped)
      console.log(`   - Arbre amont importé ignoré (${tree}) : ${count} documents`);
    for (const file of excluded) console.log(`   - Fichier exclu explicitement : ${relative(ROOT_DIR, file)}`);
  }

  if (brokenLinks > 0 || deadPaths.length > 0) {
    return 1;
  } else {
    if (!json) console.log("💚 Tous les liens internes sont valides !");
    return 0;
  }
}

if (import.meta.main) process.exit(await runDocsLinks(process.argv.slice(2)));
