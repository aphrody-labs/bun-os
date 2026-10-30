// SPDX-License-Identifier: Apache-2.0
/**
 * Documentation consolidation for a topic scope (UI, GUI, wgpu, Tauri, Google
 * design, Material Design 3 and the M3 3D layer).
 *
 * - `scan`   inventories the scope (hash, title, topic, dates, links, flags) and
 *            clusters exact and near duplicates.
 * - `plan`   proposes removal of exact duplicates that shadow a tracked owner copy.
 * - `apply`  executes a plan (move / remove-duplicate / merge): every precondition
 *            is verified first, inbound links and path mentions are rewritten, the
 *            source map records the alias, and a machine-readable report is written.
 * - `verify` re-checks the postconditions recorded in a report.
 * - `hubs`   refreshes the generated tables of hub README files.
 *
 * Dated evidence under `docs/migration/` is never rewritten. Deletions are plain
 * file removals so Git keeps the history; nothing is committed or staged.
 *
 * Usage: aphrody-ops docs-consolidate <scan|plan|apply|verify|hubs> [options]
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { importedUpstreamMatcher, markdownLinkDestinations } from "./docs-links.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Topic =
  | "spaceui"
  | "agent-skills"
  | "tauri"
  | "gpu-render"
  | "google-design"
  | "icons-fonts"
  | "design-tokens"
  | "components"
  | "m3-spec"
  | "plans"
  | "research"
  | "guides"
  | "ui-architecture"
  | "other";

export type Status = "canonical" | "historical" | "imported" | "generated" | "notice" | "pointer" | "legacy";

export type OwnerKind = "docs" | "package" | "crate" | "app" | "config" | "root";

export interface ScopeConfig {
  name: string;
  /** Paths always in scope. */
  includePaths: RegExp[];
  /** Owner-side documentation roots (README / docs next to the code). */
  ownerRoots: RegExp[];
  /** Extra documents are in scope when they mention these terms often enough. */
  mentionTerms: RegExp;
  mentionThreshold: number;
  /** Imported third-party trees that mention the terms but are not ours to reorganize. */
  excludePaths: RegExp[];
}

export const UI_SCOPE: ScopeConfig = {
  name: "ui",
  includePaths: [
    /^docs\/(architecture|apis|decisions|guides|operations|plans|products|reference|research)\/ui\//,
    /^docs\/rg\/azalee/,
    /^docs\/plans\/ai\/plans\/tauri-app\.md$/,
    /^docs\/architecture\/rust-crate-gpu-window-ownership\.md$/,
  ],
  ownerRoots: [/^(packages\/ui|crates\/ui)\//],
  mentionTerms:
    /wgpu|webgpu|softraster|render3d|scene3d|md-3d-scene|tauri-3d|\btauri\b|material design|material-web|\bmd3\b|\bm3\b|material 3|material symbols|google design|google sans|material\.io|\bstitch\b|design\.md|spaceui|spacedrive/gi,
  mentionThreshold: 5,
  excludePaths: [
    /(^|\/)node_modules\//,
    /\/iecode\/(engine|libraries|emulators|crates)\//,
    /(^|\/)bevy[^/]*\//,
    /drive\/patches\//,
    /\/(upstream-bun|upstream-oxc)\//,
    /^docs\/migration\//,
    /^upstream\//,
    /\/compat\/n2b\/(bun|node)\//,
  ],
};

/** Owner trees whose copies outrank a docs/ copy (the AI plugin tree is excluded while it relocates). */
export const OWNER_DUPLICATE_ROOTS: RegExp[] = [/^(packages\/ui|crates\/ui)\//];

/** First-party documentation across domains; imported trees are also excluded by their manifest. */
export const ALL_SCOPE: ScopeConfig = {
  name: "all",
  includePaths: [/^docs\//],
  ownerRoots: [/^(crates|packages|apps)\//],
  mentionTerms: /$^/g,
  mentionThreshold: 1,
  excludePaths: [
    /(^|\/)(node_modules|target|dist|vendor|third_party|upstream|upstream-bun|upstream-oxc|archive|archives|history)\//,
    /(^|\/)(privateMarkdown|private-markdown|\.coord)(\/|$)/i,
    /(^|\/)(MEMORY|CONVERSATIONS|TRANSCRIPTS|LIVE)\.md$/i,
    /^docs\/migration\//,
    /(^|\/)HISTORY\.md$/i,
  ],
};

/** Copies shipped in templates/plugins/distribution and legal notices are intentional. */
export function retainDocumentationCopy(path: string): string | null {
  if (isNoticeFile(path)) return "license or notice file is retained in place";
  if (/(^|\/)(templates?|plugins?|distribution)\//i.test(path))
    return "template, plugin or distribution documentation is retained in place";
  return null;
}

/** Global consolidation never follows aliases or accesses paths outside its real root. */
function safeGlobalPath(root: string, path: string): boolean {
  if (
    /(^|\/)(privateMarkdown|private-markdown|\.coord)(\/|$)|(^|\/)(MEMORY|CONVERSATIONS|TRANSCRIPTS|LIVE)\.md$/i.test(
      path,
    )
  )
    return false;
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some(part => !part || part === "." || part === "..")
  )
    return false;
  const base = realpathSync(root);
  const target = resolve(base, path);
  const local = relative(base, target);
  if (!local || local === ".." || local.startsWith("../") || isAbsolute(local)) return false;
  for (let current = target; current !== base; current = dirname(current))
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) return false;
  return true;
}

export interface DocEntry {
  path: string;
  bytes: number;
  sha256: string;
  title: string;
  domain: string;
  category: string;
  ownerKind: OwnerKind;
  topic: Topic;
  tags: string[];
  scopeReason: "path" | "owner" | "mention";
  lastGitDate: string | null;
  untracked: boolean;
  modified: boolean;
  status: Status;
  generated: boolean;
  imported: boolean;
  licensed: boolean;
  upstream: boolean;
  outbound: string[];
  unresolvedOutbound: string[];
  inbound: string[];
}

export interface ExactCluster {
  sha256: string;
  bytes: number;
  paths: string[];
}

export interface NearPair {
  left: string;
  right: string;
  jaccard: number;
  containment: number;
  relation: "equal-modulo-paths" | "translation-or-variant" | "diverged";
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function sha256Of(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

const blank = (text: string) => text.replace(/[^\n]/g, " ");

/** Replace fenced blocks and inline code with spaces so offsets stay stable. */
export function maskCode(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/~~~[\s\S]*?~~~/g, blank)
    .replace(/`[^`\n]+`/g, blank);
}

export function titleOf(text: string, fallback: string): string {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (front) {
    const title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(front[1] ?? "");
    if (title?.[1]) return title[1];
  }
  const body = text.replace(/<!--[\s\S]*?-->/g, "");
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(body);
  if (heading?.[1]) return heading[1].replace(/[`*_]/g, "");
  const first = body.split(/\r?\n/).find(line => line.trim() && !line.startsWith("---"));
  return first ? first.trim().slice(0, 120) : fallback;
}

/** First sentence of the first prose paragraph (blockquote notes only as a fallback), for hub tables. */
export function describeDocument(text: string, max = 150): string {
  const body = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "");
  const blocks = body.split(/\r?\n\s*\r?\n/);
  const sentenceOf = (block: string): string => {
    const lines = block
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const first = lines[0];
    if (!first || /^(#|\||\{:|!\[|<|-{3,}$|={3,}$)/.test(first)) return "";
    const paragraph = lines
      .map(line => line.replace(/^>\s*/, ""))
      .join(" ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[`*]/g, "")
      .replace(/(?<![\w])_([^_\n]+)_(?![\w])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    const sentence = /^(.+?[.!?])(\s|$)/.exec(paragraph)?.[1] ?? paragraph;
    return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
  };
  for (const quoted of [false, true])
    for (const block of blocks)
      if (block.trimStart().startsWith(">") === quoted) {
        const sentence = sentenceOf(block);
        if (sentence) return sentence;
      }
  return "";
}

/** Lower-cased word tokens of the prose, with link destinations and comments removed. */
export function normalizedTokens(text: string): string[] {
  const prose = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, "");
  return prose.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/** Hash of the text with every path-like token and link destination neutralized. */
export function pathNormalizedSha(text: string): string {
  const normalized = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\]\([^)]*\)/g, "](_)")
    .replace(/(?:[\w@.~-]+\/)+[\w@.~-]*/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return sha256Of(normalized);
}

function shingleSet(tokens: string[], size: number): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index + size <= tokens.length; index++) result.add(tokens.slice(index, index + size).join(" "));
  return result;
}

export function shingleSimilarity(left: Set<string>, right: Set<string>): { jaccard: number; containment: number } {
  if (!left.size || !right.size) return { jaccard: 0, containment: 0 };
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let common = 0;
  for (const shingle of small) if (large.has(shingle)) common++;
  return {
    jaccard: common / (left.size + right.size - common),
    containment: common / small.size,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function domainOf(path: string): {
  domain: string;
  category: string;
  ownerKind: OwnerKind;
} {
  const parts = path.split("/");
  const first = parts[0] ?? "";
  if (first === "docs") {
    const category = parts[1] ?? "";
    const domain = parts.length > 3 ? (parts[2] ?? "") : "";
    return { domain, category, ownerKind: "docs" };
  }
  if (first === "packages")
    return {
      domain: parts[1] ?? "",
      category: "package",
      ownerKind: "package",
    };
  if (first === "crates") return { domain: parts[1] ?? "", category: "crate", ownerKind: "crate" };
  if (first === "apps") return { domain: parts[1] ?? "", category: "app", ownerKind: "app" };
  if (first === "config") return { domain: parts[1] ?? "", category: "config", ownerKind: "config" };
  return { domain: "", category: "root", ownerKind: "root" };
}

const TOPIC_RULES: Array<[RegExp, Topic]> = [
  [/(^|\/)ui\/drive\/|^crates\/web\/drive-server\/|spaceui/i, "spaceui"],
  [/\/skills\/|\/\.agents\/|\/agents\/|^config\/ai\/plugins\//i, "agent-skills"],
  [/tauri|desktop|native-desktop|(^|\/)gui\.md$/i, "tauri"],
  [/render|softraster|wgpu|webgpu|(^|\/)wasm\/|3d|gpu|scene3d/i, "gpu-render"],
  [/google|stitch|material-io|(^|\/)design\.md$/i, "google-design"],
  [/icons?|fonts?|typography|symbols|svg/i, "icons-fonts"],
  [/tokens?|theme|dynamic-color|palette/i, "design-tokens"],
  [/component|matrix|catalog|elements/i, "components"],
  [/(^|[/_-])(m3|md3|material)/i, "m3-spec"],
  [/(^|\/)plans?\/|plan\.md$/i, "plans"],
  [/(^|\/)research\/|audit|parity|report/i, "research"],
  [/(^|\/)guides\/|contributing|setup|getting-started/i, "guides"],
];

export function classifyTopic(path: string, text = ""): Topic {
  for (const [pattern, topic] of TOPIC_RULES) if (pattern.test(path)) return topic;
  if (/^docs\/[^/]+\/ui\/|^(packages|crates)\/ui\//.test(path)) return "ui-architecture";
  const counts: Array<[Topic, number]> = [
    ["tauri", (text.match(/tauri/gi) ?? []).length],
    ["gpu-render", (text.match(/wgpu|webgpu|render3d|scene3d|md-3d-scene/gi) ?? []).length],
    ["google-design", (text.match(/google design|material\.io|stitch|design\.md/gi) ?? []).length],
    ["m3-spec", (text.match(/material design|material-web|\bm3\b|\bmd3\b/gi) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : "other";
}

/** Cross-cutting tags: the same document can concern GUI, Tauri, wgpu, Google design and M3 / M3D. */
export function tagsOf(path: string, text: string): string[] {
  const haystack = `${path}\n${text}`;
  const tags: string[] = [];
  if (/\bgui\b|webview|desktop app|spaceui|lit\b/i.test(haystack)) tags.push("gui");
  if (/wgpu|webgpu|softraster|\bgpu\b|wasm/i.test(haystack)) tags.push("wgpu");
  if (/tauri/i.test(haystack)) tags.push("tauri");
  if (/google design|google sans|material\.io|m3\.material|\bstitch\b|design\.md/i.test(haystack))
    tags.push("google-design");
  if (/material design|material-web|material 3|\bmd3\b|\bm3\b/i.test(haystack)) tags.push("m3");
  if (/md-3d-scene|md-native-3d|scene3d|render3d|tauri-3d|aphrody-m3|3d scene/i.test(haystack)) tags.push("m3d");
  return tags;
}

export function isNoticeFile(path: string): boolean {
  const name = basename(path);
  return /^(LICENSE|NOTICE|COPYING|UPSTREAM)/i.test(name) || /(^|[-_.])(OFL|LICENSE-NOTICE)\./i.test(name);
}

export function isGeneratedDocument(path: string, text: string): boolean {
  if (/\/(autogenerated|gen)\//.test(path) || /\.generated\./.test(path)) return true;
  return /(^|\n)\s*(<!--\s*)?(this file is )?(auto-?)?generated (by|from)\b|@generated|do not edit/i.test(
    text.slice(0, 300),
  );
}

/** A one-line "canonical reference" stub left where a duplicate used to live. */
export function isPointerStub(text: string): boolean {
  return text.length < 400 && /^# Référence canonique/m.test(text);
}

export function deriveStatus(input: {
  path: string;
  text: string;
  imported: boolean;
  generated: boolean;
  notice: boolean;
}): Status {
  if (isPointerStub(input.text)) return "pointer";
  if (input.notice) return "notice";
  if (input.generated) return "generated";
  const head = input.text.slice(0, 1200);
  if (
    /tauri[-_ ]?v?2(\.0)?\b/i.test(`${input.path}\n${titleOf(input.text, "")}`) ||
    /\*\*(Status: historical \(Tauri 2 context\)|Statut : historique \(contexte Tauri 2\)|Tauri version note \(historical\))/.test(
      head,
    )
  )
    return "legacy";
  if (
    /-20\d\d-\d\d-\d\d|\/archive\/|-previous\./.test(input.path) ||
    /supersed|historical|archived? (plan|document)|snapshot|audit date|^# Archive/im.test(head)
  )
    return "historical";
  if (input.imported) return "imported";
  return "canonical";
}

// ---------------------------------------------------------------------------
// Markdown link scanning and rewriting
// ---------------------------------------------------------------------------

export interface LinkSite {
  start: number;
  end: number;
  raw: string;
  dest: string;
}

/** Inline link destinations with their offsets (same grammar as `markdownLinkDestinations`). */
export function scanLinkSites(content: string): LinkSite[] {
  const masked = maskCode(content);
  const sites: LinkSite[] = [];
  const labels = /!?\[(?:\\.|[^\]\\])*\]\(/g;
  while (labels.exec(masked) !== null) {
    let cursor = labels.lastIndex;
    while (/\s/.test(masked[cursor] ?? "") && cursor < masked.length) cursor++;
    let start = cursor;
    let end = cursor;
    if (masked[cursor] === "<") {
      start = ++cursor;
      while (cursor < masked.length && masked[cursor] !== ">" && masked[cursor] !== "\n")
        cursor += masked[cursor] === "\\" ? 2 : 1;
      if (masked[cursor] !== ">") continue;
      end = cursor++;
    } else {
      let depth = 0;
      while (cursor < masked.length) {
        const char = masked[cursor]!;
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
      end = cursor;
    }
    const ending = /^(?:\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)))?\s*\)/.exec(
      masked.slice(cursor),
    );
    if (!ending) continue;
    const raw = content.slice(start, end);
    sites.push({
      start,
      end,
      raw,
      dest: raw.replace(/\\([\\()[\]<>])/g, "$1"),
    });
    labels.lastIndex = cursor + ending[0].length;
  }
  return sites;
}

/** Reference-style definitions `[label]: destination`. */
export function scanDefinitionSites(content: string): LinkSite[] {
  const masked = maskCode(content);
  const sites: LinkSite[] = [];
  const pattern = /^[ ]{0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)>?/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    const raw = match[1] ?? "";
    const start = match.index + match[0].length - raw.length - (match[0].endsWith(">") ? 1 : 0);
    sites.push({ start, end: start + raw.length, raw, dest: raw });
  }
  return sites;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Repo-relative target of a local link written in `fromFile`, or null for external or site routes. */
export function resolveLocalLink(fromFile: string, dest: string): string | null {
  if (!dest || dest.startsWith("#") || dest.startsWith("/") || SCHEME.test(dest)) return null;
  let path: string;
  try {
    path = decodeURIComponent(dest.split(/[?#]/, 1)[0] ?? "");
  } catch {
    return null;
  }
  if (!path) return null;
  const joined = posix.normalize(posix.join(posix.dirname(fromFile), path));
  if (joined.startsWith("../") || joined === "..") return null;
  return joined.replace(/\/$/, "");
}

function encodeDestination(path: string): string {
  return path
    .split("/")
    .map(segment =>
      /^[\w@.~+=,-]*$/.test(segment)
        ? segment
        : encodeURIComponent(segment).replace(/\(/g, "%28").replace(/\)/g, "%29"),
    )
    .join("/");
}

/** Destination text for `target` written from `fromFile`, keeping the original query/anchor and `./` style. */
export function relativeDestination(fromFile: string, target: string, original: string): string {
  let destination = posix.relative(posix.dirname(fromFile), target) || ".";
  if (original.startsWith("./") && !destination.startsWith(".")) destination = `./${destination}`;
  const suffix = /[?#].*$/.exec(original)?.[0] ?? "";
  return `${encodeDestination(destination)}${suffix}`;
}

export interface RewriteResult {
  content: string;
  links: number;
  mentions: number;
  unresolved: string[];
}

/**
 * Rewrite one Markdown file as if it moved from `oldPath` to `newPath` while
 * `finalOf` relocates its link targets. Local links are re-pointed only when the
 * relative text must change; literal repo-relative path mentions are replaced.
 */
export function rewriteMarkdown(
  content: string,
  oldPath: string,
  newPath: string,
  finalOf: (path: string) => string,
  mentionPattern: RegExp | null,
  mentionTarget: (path: string) => string,
): RewriteResult {
  const sites = [...scanLinkSites(content), ...scanDefinitionSites(content)].toSorted((a, b) => b.start - a.start);
  let result = content;
  let links = 0;
  const unresolved: string[] = [];
  for (const site of sites) {
    const target = resolveLocalLink(oldPath, site.dest);
    if (!target) continue;
    const finalTarget = finalOf(target);
    if (finalTarget === target && oldPath === newPath) continue;
    if (site.raw !== site.dest) {
      unresolved.push(site.raw);
      continue;
    }
    const replacement = relativeDestination(newPath, finalTarget, site.dest);
    if (replacement === site.raw) continue;
    result = `${result.slice(0, site.start)}${replacement}${result.slice(site.end)}`;
    links++;
  }
  let mentions = 0;
  if (mentionPattern)
    result = result.replace(mentionPattern, whole => {
      const next = mentionTarget(whole);
      if (next !== whole) mentions++;
      return next;
    });
  return { content: result, links, mentions, unresolved };
}

export function buildMentionPattern(paths: Iterable<string>): RegExp | null {
  const escaped = [...paths]
    .toSorted((a, b) => b.length - a.length)
    .map(path => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return null;
  return new RegExp(`(?<![A-Za-z0-9_./~-])(?:${escaped.join("|")})(?![A-Za-z0-9_-])`, "g");
}

/** Pointer stub left in place of a duplicate whose canonical copy lives elsewhere. */
export function pointerStub(path: string, canonical: string): string {
  const destination = posix.relative(posix.dirname(path), canonical);
  return `# Référence canonique\n\nCe document est maintenu dans [${canonical}](${encodeDestination(destination)}).\n`;
}

// ---------------------------------------------------------------------------
// Scan: file discovery, inventory and clustering
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const DATA_EXTENSIONS = new Set([".json"]);
const CORPUS_EXCLUDES = [
  /(^|\/)node_modules\//,
  /^docs\/migration\//,
  /^upstream\//,
  /(^|\/)target\//,
  /(^|\/)third_party\//,
  /\.llms\.txt$|(^|\/)llms(-full)?\.txt$/,
];

function extensionOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, "-c", "core.quotepath=off", ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
  return new TextDecoder().decode(result.stdout);
}

export function listRepositoryFiles(root: string, trackedOnly = false): { files: string[]; untracked: Set<string> } {
  const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const others = trackedOnly
    ? []
    : git(root, ["ls-files", "-z", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
  const present = [...new Set([...tracked, ...others])].filter(path => existsSync(join(root, path)));
  return { files: present.toSorted(), untracked: new Set(others) };
}

export function dirtyFiles(root: string): Set<string> {
  const status = git(root, ["status", "--porcelain", "-z"]).split("\0").filter(Boolean);
  const dirty = new Set<string>();
  for (let index = 0; index < status.length; index++) {
    const line = status[index] ?? "";
    const path = line.slice(3);
    if (line[0] === "R" || line[0] === "C") index++;
    dirty.add(path);
  }
  return dirty;
}

export function lastGitDates(root: string): Map<string, string> {
  const dates = new Map<string, string>();
  let current = "";
  for (const line of git(root, ["log", "--name-only", "--format=@@%cs", "--no-renames"]).split("\n")) {
    if (line.startsWith("@@")) current = line.slice(2);
    else if (line && !dates.has(line)) dates.set(line, current);
  }
  return dates;
}

export interface SourceMapEntry {
  source: string;
  kind: string;
  target?: string | null;
  importedTarget?: string;
  duplicateOf?: string;
  targetReason?: string;
  sha256?: string;
  importedSha256?: string;
  importedSourceSha256?: string;
  [key: string]: unknown;
}

export interface SourceMapFile {
  entries: SourceMapEntry[];
  [key: string]: unknown;
}

export function documentDestination(entry: SourceMapEntry): string | null {
  return entry.importedTarget ?? entry.target ?? null;
}

export interface ScanOptions {
  root: string;
  scope?: ScopeConfig;
  nearThreshold?: number;
  sourceMap?: SourceMapFile | null;
  /** New path -> previous path, so relocated documents keep their last Git date. */
  pathHistory?: Map<string, string>;
}

export interface ScanResult {
  scope: string;
  nearThreshold: number;
  entries: DocEntry[];
  exactClusters: ExactCluster[];
  nearPairs: NearPair[];
  byTopic: Record<string, number>;
  unresolvedOutbound: number;
}

export function inScope(path: string, text: string, scope: ScopeConfig): "path" | "owner" | "mention" | null {
  if (scope.excludePaths.some(rule => rule.test(path))) return null;
  if (scope.includePaths.some(rule => rule.test(path))) return "path";
  if (scope.ownerRoots.some(rule => rule.test(path))) return "owner";
  if (!path.startsWith("docs/")) return null;
  const hits = text.match(scope.mentionTerms)?.length ?? 0;
  return hits >= scope.mentionThreshold ? "mention" : null;
}

export function classifyRelation(
  left: { text: string; sha256: string },
  right: { text: string; sha256: string },
): NearPair["relation"] | "identical" {
  if (left.sha256 === right.sha256) return "identical";
  if (pathNormalizedSha(left.text) === pathNormalizedSha(right.text)) return "equal-modulo-paths";
  return "translation-or-variant";
}

export async function scanScope(options: ScanOptions): Promise<ScanResult> {
  const root = resolve(options.root);
  const scope = options.scope ?? UI_SCOPE;
  const importedUpstream = scope.name === "all" ? importedUpstreamMatcher(root) : () => undefined;
  const threshold = options.nearThreshold ?? 0.8;
  const { files, untracked } = listRepositoryFiles(root);
  const dirty = dirtyFiles(root);
  const dates = lastGitDates(root);
  const importedBy = new Map<string, SourceMapEntry>();
  for (const entry of options.sourceMap?.entries ?? []) {
    const destination = documentDestination(entry);
    if (entry.kind === "documentation" && destination) importedBy.set(destination, entry);
  }

  const texts = new Map<string, string>();
  const candidates: Array<{
    path: string;
    reason: "path" | "owner" | "mention";
    text: string;
  }> = [];
  const corpus: Array<{ path: string; text: string }> = [];
  const readable: Array<{ path: string; extension: string }> = [];
  for (const path of files) {
    if (scope.name === "all" && !safeGlobalPath(root, path)) continue;
    if (scope.name === "all" && (scope.excludePaths.some(rule => rule.test(path)) || importedUpstream(path))) continue;
    const extension = extensionOf(path);
    const isText = TEXT_EXTENSIONS.has(extension);
    const isData = DATA_EXTENSIONS.has(extension) && /^docs\/[^/]+\/ui\//.test(path);
    if (!isText && !isData) continue;
    if (CORPUS_EXCLUDES.some(rule => rule.test(path)) && !scope.includePaths.some(r => r.test(path))) continue;
    if (!existsSync(join(root, path))) continue;
    readable.push({ path, extension });
  }
  const loaded = await Promise.all(
    readable.map(async ({ path, extension }) => ({
      path,
      extension,
      text: await readFile(join(root, path), "utf8"),
    })),
  );
  for (const { path, extension, text } of loaded) {
    texts.set(path, text);
    if (extension === ".md" || extension === ".mdx") corpus.push({ path, text });
    const reason = inScope(path, text, scope);
    if (reason) candidates.push({ path, reason, text });
  }

  // Inbound links (markdown destinations and literal path mentions) over the whole corpus.
  const scopePaths = new Set(candidates.map(candidate => candidate.path));
  const inbound = new Map<string, Set<string>>();
  const addInbound = (target: string, from: string) => {
    if (!scopePaths.has(target) || target === from) return;
    const set = inbound.get(target) ?? new Set<string>();
    set.add(from);
    inbound.set(target, set);
  };
  const mentionRegex = /\b(?:docs|packages|crates|apps|config)\/[\w@.+~/-]+\.(?:md|mdx|txt|json)\b/g;
  const outboundOf = new Map<string, string[]>();
  const unresolvedOf = new Map<string, string[]>();
  for (const { path, text } of corpus) {
    const masked = maskCode(text);
    const outbound: string[] = [];
    const unresolved: string[] = [];
    for (const dest of markdownLinkDestinations(masked)) {
      const target = resolveLocalLink(path, dest);
      if (!target) continue;
      outbound.push(target);
      addInbound(target, path);
      if (scopePaths.has(path) && !existsSync(join(root, target))) unresolved.push(dest);
    }
    for (const mention of text.match(mentionRegex) ?? []) addInbound(mention, path);
    outboundOf.set(path, outbound);
    unresolvedOf.set(path, unresolved);
  }

  const entries: DocEntry[] = [];
  const hashes = await Promise.all(candidates.map(async ({ path }) => sha256Of(await readFile(join(root, path)))));
  for (const [index, { path, reason, text }] of candidates.entries()) {
    const bytes = Buffer.byteLength(text);
    const sha256 = hashes[index]!;
    const { domain, category, ownerKind } = domainOf(path);
    const imported = importedBy.get(path);
    const notice = isNoticeFile(path);
    const generated = isGeneratedDocument(path, text);
    const importedUnchanged = !!imported && (imported.importedSha256 === sha256 || imported.sha256 === sha256);
    const topic = classifyTopic(path, text);
    entries.push({
      path,
      bytes,
      sha256,
      title: titleOf(text, basename(path)),
      domain,
      category,
      ownerKind,
      topic,
      tags: tagsOf(path, text),
      scopeReason: reason,
      lastGitDate: dates.get(path) ?? dates.get(options.pathHistory?.get(path) ?? "") ?? null,
      untracked: untracked.has(path),
      modified: dirty.has(path),
      status: deriveStatus({
        path,
        text,
        imported: importedUnchanged,
        generated,
        notice,
      }),
      generated,
      imported: !!imported,
      licensed:
        notice ||
        /SIL Open Font License|Licensed under|Apache License|MIT License|GNU (Affero )?General Public/i.test(
          text.slice(0, 2400),
        ),
      upstream: /(^|\/)(drive|upstream)\//.test(path) || basename(path).startsWith("UPSTREAM"),
      outbound: [...new Set(outboundOf.get(path) ?? [])].toSorted(),
      unresolvedOutbound: [...new Set(unresolvedOf.get(path) ?? [])].toSorted(),
      inbound: [...(inbound.get(path) ?? [])].toSorted(),
    });
  }

  // Exact clusters.
  const byHash = new Map<string, DocEntry[]>();
  for (const entry of entries) {
    if (entry.bytes < 40) continue;
    const group = byHash.get(entry.sha256) ?? [];
    group.push(entry);
    byHash.set(entry.sha256, group);
  }
  const exactClusters: ExactCluster[] = [...byHash.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([sha256, group]) => ({
      sha256,
      bytes: group[0]?.bytes ?? 0,
      paths: group.map(entry => entry.path).toSorted(),
    }))
    .toSorted((a, b) => (a.paths[0] ?? "").localeCompare(b.paths[0] ?? ""));

  // Near duplicates: 5-word shingles, Jaccard / containment, via an inverted index.
  const comparable = entries.filter(
    entry => /\.(md|mdx|txt)$/.test(entry.path) && !entry.generated && entry.bytes >= 200,
  );
  const tokenSets = comparable.map(entry => shingleSet(normalizedTokens(texts.get(entry.path) ?? ""), 5));
  const index = new Map<string, number[]>();
  tokenSets.forEach((set, position) => {
    for (const shingle of set) {
      const list = index.get(shingle) ?? [];
      list.push(position);
      index.set(shingle, list);
    }
  });
  const shared = new Map<number, number>();
  for (const list of index.values()) {
    if (list.length < 2 || list.length > 12) continue;
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const key = (list[a] as number) * comparable.length + (list[b] as number);
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
  }
  const nearPairs: NearPair[] = [];
  for (const key of shared.keys()) {
    const a = Math.floor(key / comparable.length);
    const b = key % comparable.length;
    const left = comparable[a]!;
    const right = comparable[b]!;
    if (left.sha256 === right.sha256) continue;
    const { jaccard, containment } = shingleSimilarity(tokenSets[a]!, tokenSets[b]!);
    if (jaccard < threshold) continue;
    nearPairs.push({
      left: left.path,
      right: right.path,
      jaccard: Math.round(jaccard * 1000) / 1000,
      containment: Math.round(containment * 1000) / 1000,
      relation: classifyRelation(
        { text: texts.get(left.path) ?? "", sha256: left.sha256 },
        { text: texts.get(right.path) ?? "", sha256: right.sha256 },
      ) as NearPair["relation"],
    });
  }
  nearPairs.sort((a, b) => b.jaccard - a.jaccard || a.left.localeCompare(b.left));

  const byTopic: Record<string, number> = {};
  for (const entry of entries) byTopic[entry.topic] = (byTopic[entry.topic] ?? 0) + 1;
  return {
    scope: scope.name,
    nearThreshold: threshold,
    entries,
    exactClusters,
    nearPairs,
    byTopic,
    unresolvedOutbound: entries.reduce((sum, entry) => sum + entry.unresolvedOutbound.length, 0),
  };
}

// ---------------------------------------------------------------------------
// Plan: exact duplicates that shadow a tracked owner copy
// ---------------------------------------------------------------------------

export type ActionKind = "remove-duplicate" | "move" | "merge" | "retain" | "fix-paths";

export interface PlanAction {
  id: string;
  action: ActionKind;
  /** Subject file (remove-duplicate, move, retain). */
  path?: string;
  sha256?: string;
  /** Canonical copy that survives (remove-duplicate, merge). */
  canonical?: string;
  canonicalSha256?: string;
  /** Destination (move). */
  to?: string;
  /** Sources folded into `canonical` (merge), with their hashes. */
  sources?: Array<{
    path: string;
    sha256: string;
    disposition?: "remove" | "pointer";
  }>;
  /**
   * How the removed copy relates to the canonical one (remove-duplicate):
   * `identical`, `equal-modulo-paths`, `identical-at-head` (the canonical file has uncommitted
   * edits but its committed version is identical) or `superseded` (reviewed: the canonical copy
   * is newer and the copy only carries stale text; `reviewed` records the finding).
   */
  equivalence?: "identical" | "equal-modulo-paths" | "identical-at-head" | "superseded";
  reviewed?: string;
  /** Root-relative globs (fix-paths): files whose legacy repository paths are updated. */
  patterns?: string[];
  reason: string;
}

export interface Plan {
  schemaVersion: 1;
  scope: string;
  actions: PlanAction[];
}

function logicalSegments(path: string): string[] {
  return path
    .split("/")
    .toReversed()
    .map(segment => segment.replace(/^aphrody-/, ""));
}

/** Number of trailing path segments two paths share once the legacy `aphrody-` prefix is ignored. */
export function ownerRank(candidate: string, subject: string): number {
  if (basename(candidate) !== basename(subject)) return -1;
  const a = logicalSegments(candidate);
  const b = logicalSegments(subject);
  let score = 0;
  while (score < a.length && score < b.length && a[score] === b[score]) score++;
  return score;
}

export interface ReviewItem {
  path: string;
  canonical: string;
  jaccard: number;
  containment: number;
  note: string;
}

/**
 * Remove docs copies that duplicate a tracked owner copy under packages/, crates/ or apps/:
 * byte-identical copies (exact clusters) and copies equal once path-like text is ignored
 * (links and layout paths rewritten by later moves). Diverged copies are listed for manual merge.
 */
export function planOwnerDuplicates(
  scan: ScanResult,
  ownerRoots: RegExp[],
  retain: (path: string) => string | null,
): Plan & { review: ReviewItem[] } {
  const actions: PlanAction[] = [];
  const review: ReviewItem[] = [];
  const entryByPath = new Map(scan.entries.map(entry => [entry.path, entry]));
  const isOwner = (entry: DocEntry) =>
    entry.ownerKind !== "docs" && !entry.untracked && !entry.modified && ownerRoots.some(rule => rule.test(entry.path));
  const planned = new Set<string>();
  const plan = (copy: DocEntry, owner: DocEntry, equivalence: "identical" | "equal-modulo-paths", reason: string) => {
    if (planned.has(copy.path)) return;
    planned.add(copy.path);
    const held = retain(copy.path);
    actions.push(
      held
        ? {
            id: `retain:${copy.path}`,
            action: "retain",
            path: copy.path,
            sha256: copy.sha256,
            canonical: owner.path,
            reason: held,
          }
        : {
            id: `dedup:${copy.path}`,
            action: "remove-duplicate",
            path: copy.path,
            sha256: copy.sha256,
            canonical: owner.path,
            canonicalSha256: owner.sha256,
            equivalence,
            reason,
          },
    );
  };
  for (const cluster of scan.exactClusters) {
    const members = cluster.paths.map(path => entryByPath.get(path)).filter((e): e is DocEntry => !!e);
    const owners = members.filter(isOwner);
    for (const copy of members.filter(entry => entry.ownerKind === "docs")) {
      const best = owners
        .map(owner => ({ owner, rank: ownerRank(owner.path, copy.path) }))
        .filter(candidate => candidate.rank >= 0)
        .toSorted((a, b) => b.rank - a.rank)[0];
      if (best) plan(copy, best.owner, "identical", "exact duplicate of the owner copy kept next to the code");
    }
  }
  for (const pair of scan.nearPairs) {
    const left = entryByPath.get(pair.left);
    const right = entryByPath.get(pair.right);
    if (!left || !right) continue;
    const [copy, owner] = left.ownerKind === "docs" ? [left, right] : [right, left];
    if (copy.ownerKind !== "docs" || !isOwner(owner) || ownerRank(owner.path, copy.path) < 2) continue;
    if (planned.has(copy.path)) continue;
    if (pair.relation === "equal-modulo-paths")
      plan(copy, owner, "equal-modulo-paths", "same text as the owner copy; only link and layout paths differ");
    else if (!isNoticeFile(copy.path))
      review.push({
        path: copy.path,
        canonical: owner.path,
        jaccard: pair.jaccard,
        containment: pair.containment,
        note: "diverged copy: merge unique facts into the owner copy before removal",
      });
  }
  actions.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? ""));
  return { schemaVersion: 1, scope: scan.scope, actions, review };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface AppliedAction extends PlanAction {
  inboundRewritten: Array<{ file: string; links: number; mentions: number }>;
  pathFixes?: Array<{ file: string; replacements: number }>;
  sourceMapEntries: number;
  outcome: "applied" | "dry-run" | "recorded";
}

export interface ApplyReport {
  schemaVersion: 1;
  generatedAt: string;
  tool: string;
  dryRun: boolean;
  scope: string;
  root: string;
  actions: AppliedAction[];
  rewrittenFiles: Array<{ file: string; links: number; mentions: number }>;
  skippedFiles: Array<{ file: string; reason: string }>;
  unresolvedRewrites: Array<{ file: string; destination: string }>;
  removedDirectories: string[];
  sourceMap: { path: string; entriesUpdated: number } | null;
}

export interface ApplyOptions {
  root: string;
  plan: Plan;
  write: boolean;
  sourceMapPath?: string | null;
  /** Dirty files under these prefixes are ours to rewrite. */
  allowDirtyPrefixes?: string[];
  reportName: string;
  /** Files never rewritten (other agents' pages). */
  protectedFiles?: string[];
  /** Legacy -> current repository paths used by fix-paths actions. */
  legacyPathMap?: PathMap;
}

export type PathMap = Map<string, string>;

/**
 * Old -> current repository paths derived from the recorded layout migrations
 * (`short-paths` and `layout-reorganization`), including the pre-consolidation
 * `crates/aphrody-*` spelling used by documents imported from the UI source repository.
 */
export function buildLegacyPathMap(shortMoves: Record<string, string>, layoutMoves: Record<string, string>): PathMap {
  const resolveChain = (path: string): string => {
    let current = path;
    const seen = new Set<string>();
    for (;;) {
      const moved = layoutMoves[current] ?? shortMoves[current];
      if (!moved || seen.has(current)) return current;
      seen.add(current);
      current = moved;
    }
  };
  const map: PathMap = new Map();
  for (const key of new Set([...Object.keys(shortMoves), ...Object.keys(layoutMoves)])) {
    const final = resolveChain(key);
    if (final === key) continue;
    if (!/^(crates\/ui\/|packages\/)/.test(key) || !/^(crates|packages)\/ui\//.test(final)) continue;
    map.set(key, final);
    const legacy = /^crates\/ui\/(aphrody-.+)$/.exec(key);
    if (legacy?.[1]) map.set(`crates/${legacy[1]}`, final);
  }
  return map;
}

export async function loadLegacyPathMap(root: string): Promise<PathMap> {
  const read = async (name: string): Promise<Record<string, string>> => {
    const file = join(root, "docs/migration", name);
    if (!existsSync(file)) return {};
    return ((
      JSON.parse(await readFile(file, "utf8")) as {
        moves?: Record<string, string>;
      }
    ).moves ?? {}) as Record<string, string>;
  };
  return buildLegacyPathMap(
    await read("short-paths-2026-10-01.json"),
    await read("layout-reorganization-2026-10-01.json"),
  );
}

/** Replace legacy repository paths in prose and code spans; link destinations are left to link repair. */
export function applyPathMap(content: string, map: PathMap): { content: string; replacements: number } {
  if (!map.size) return { content, replacements: 0 };
  const keys = [...map.keys()]
    .toSorted((a, b) => b.length - a.length)
    .map(key => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![A-Za-z0-9_./~-])(?:${keys.join("|")})(?![A-Za-z0-9_-])`, "g");
  const protectedRanges = [...scanLinkSites(content), ...scanDefinitionSites(content)].map(
    site => [site.start, site.end] as const,
  );
  let replacements = 0;
  const result = content.replace(pattern, (whole: string, offset: number) => {
    if (protectedRanges.some(([start, end]) => offset >= start && offset < end)) return whole;
    replacements++;
    return map.get(whole) ?? whole;
  });
  return { content: result, replacements };
}

/** Record exact-duplicate removals and moves in the generated source map. */
export function recordInSourceMap(
  map: SourceMapFile,
  removed: Array<{ path: string; canonical: string }>,
  moved: Array<{ path: string; to: string; sha256: string }>,
  reportName: string,
): number {
  let updated = 0;
  const removals = new Map(removed.map(item => [item.path, item.canonical]));
  const moves = new Map(moved.map(item => [item.path, item]));
  for (const entry of map.entries) {
    if (entry.kind !== "documentation") continue;
    const destination = documentDestination(entry);
    if (!destination) continue;
    const canonical = removals.get(destination);
    if (canonical) {
      entry.duplicateOf = canonical;
      entry.targetReason = `consolidated ${reportName}: ${destination} removed as a duplicate of ${canonical}`;
      entry.target = null;
      delete entry.importedTarget;
      updated++;
      continue;
    }
    const move = moves.get(destination);
    if (move) {
      entry.importedTarget = move.to;
      entry.importedSha256 = move.sha256;
      entry.targetReason = `consolidated ${reportName}: moved from ${destination}`;
      updated++;
    }
  }
  return updated;
}

function isAllowedDirty(path: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => path.startsWith(prefix));
}

/** SHA-256 of the committed (HEAD) version of a file, or null when it is not committed. */
export function committedSha(root: string, path: string): string | null {
  const result = Bun.spawnSync(["git", "-C", root, "show", `HEAD:${path}`], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.exitCode === 0 ? sha256Of(new Uint8Array(result.stdout)) : null;
}

export async function applyPlan(options: ApplyOptions): Promise<ApplyReport> {
  const root = resolve(options.root);
  const { plan } = options;
  if (plan.scope === "all") {
    const paths = plan.actions
      .flatMap(action => [
        action.path,
        action.canonical,
        action.to,
        ...(action.sources ?? []).map(source => source.path),
      ])
      .filter((path): path is string => path !== undefined);
    if (options.sourceMapPath) paths.push(options.sourceMapPath);
    for (const path of paths)
      if (!safeGlobalPath(root, path)) throw new Error(`Unsafe global documentation path: ${path}`);
  }
  const errors: string[] = [];
  const read = async (path: string) => readFile(join(root, path));
  const fileHash = async (path: string) => sha256Of(await read(path));

  // 1. Preconditions for every action, before touching anything.
  const moves = new Map<string, string>();
  const removals = new Map<string, string>();
  const pointers = new Map<string, string>();
  const claimedTargets = new Set<string>();
  // oxlint-disable no-await-in-loop -- validation séquentielle : claimedTargets, l'ordre des erreurs et les maps moves/removals/pointers dépendent des actions précédentes
  for (const action of plan.actions) {
    if (action.action === "retain") continue;
    if (action.action === "fix-paths") {
      if (!action.patterns?.length) errors.push(`${action.id}: patterns are required`);
      continue;
    }
    if (action.action === "move") {
      const { path, to } = action;
      if (!path || !to || !action.sha256) errors.push(`${action.id}: path, to and sha256 are required`);
      else if (!existsSync(join(root, path))) errors.push(`${action.id}: ${path} does not exist`);
      else if ((await fileHash(path)) !== action.sha256) errors.push(`${action.id}: ${path} changed`);
      else if (existsSync(join(root, to))) errors.push(`${action.id}: destination ${to} exists (never overwritten)`);
      else if (claimedTargets.has(to)) errors.push(`${action.id}: destination ${to} claimed twice`);
      else {
        claimedTargets.add(to);
        moves.set(path, to);
      }
    } else if (action.action === "remove-duplicate") {
      const { path, canonical } = action;
      if (!path || !canonical || !action.sha256) errors.push(`${action.id}: path, canonical and sha256 are required`);
      else if (!existsSync(join(root, path))) errors.push(`${action.id}: ${path} does not exist`);
      else if (!existsSync(join(root, canonical))) errors.push(`${action.id}: canonical ${canonical} does not exist`);
      else if ((await fileHash(path)) !== action.sha256) errors.push(`${action.id}: ${path} changed`);
      else {
        const text = await readFile(join(root, path), "utf8");
        const canonicalText = await readFile(join(root, canonical), "utf8");
        let equivalent: boolean;
        switch (action.equivalence ?? "identical") {
          case "equal-modulo-paths":
            equivalent = pathNormalizedSha(text) === pathNormalizedSha(canonicalText);
            break;
          case "identical-at-head":
            equivalent = committedSha(root, canonical) === action.sha256;
            break;
          case "superseded":
            equivalent = !!action.reviewed?.trim();
            break;
          default:
            equivalent = (await fileHash(canonical)) === action.sha256;
        }
        if (!equivalent)
          errors.push(`${action.id}: ${canonical} is not ${action.equivalence ?? "identical"} to ${path}`);
        else removals.set(path, canonical);
      }
    } else if (action.action === "merge") {
      const { canonical, sources } = action;
      if (!canonical || !sources?.length) errors.push(`${action.id}: canonical and sources are required`);
      else if (!existsSync(join(root, canonical))) errors.push(`${action.id}: canonical ${canonical} does not exist`);
      else {
        const canonicalText = await readFile(join(root, canonical), "utf8");
        if (!/^#{2,3}\s+(Historique|Provenance|History)/im.test(canonicalText))
          errors.push(`${action.id}: ${canonical} has no Historique/Provenance section`);
        for (const source of sources) {
          if (!existsSync(join(root, source.path))) errors.push(`${action.id}: ${source.path} does not exist`);
          else if ((await fileHash(source.path)) !== source.sha256) errors.push(`${action.id}: ${source.path} changed`);
          else if (!canonicalText.includes(source.path))
            errors.push(`${action.id}: ${canonical} does not name merged source ${source.path}`);
          else if (source.disposition === "pointer") pointers.set(source.path, canonical);
          else removals.set(source.path, canonical);
        }
      }
    }
  }
  // oxlint-enable no-await-in-loop
  if (errors.length) throw new Error(`plan rejected:\n${errors.join("\n")}`);

  // Canonical copies may themselves move in the same plan.
  const finalOf = (path: string): string => {
    const moved = moves.get(path);
    if (moved) return moved;
    const canonical = removals.get(path);
    if (canonical) return moves.get(canonical) ?? canonical;
    return path;
  };
  const relocated = new Set([...moves.keys(), ...removals.keys()]);
  const mentionPattern = buildMentionPattern(relocated);
  const mentionTarget = (whole: string) => finalOf(whole);

  // 2. Rewrite plan over the Markdown corpus.
  const { files } = listRepositoryFiles(root);
  const dirty = dirtyFiles(root);
  const allowed = options.allowDirtyPrefixes ?? [];
  const importedUpstream = plan.scope === "all" ? importedUpstreamMatcher(root) : () => undefined;
  const protectedFiles = new Set(options.protectedFiles ?? []);
  const rewrittenFiles: ApplyReport["rewrittenFiles"] = [];
  const skippedFiles: ApplyReport["skippedFiles"] = [];
  const unresolvedRewrites: ApplyReport["unresolvedRewrites"] = [];
  const pending: Array<{ from: string; to: string; content: string }> = [];
  const perAction = new Map<string, Map<string, { links: number; mentions: number }>>();

  const corpusPaths: string[] = [];
  for (const path of files) {
    if (!/\.(md|mdx)$/.test(path)) continue;
    if (plan.scope === "all" && !safeGlobalPath(root, path)) continue;
    if (plan.scope === "all" && (ALL_SCOPE.excludePaths.some(rule => rule.test(path)) || importedUpstream(path)))
      continue;
    if (CORPUS_EXCLUDES.some(rule => rule.test(path))) continue;
    if (removals.has(path)) continue;
    if (!existsSync(join(root, path))) continue;
    corpusPaths.push(path);
  }
  const contents = await Promise.all(corpusPaths.map(path => readFile(join(root, path), "utf8")));
  for (const [index, path] of corpusPaths.entries()) {
    const content = contents[index]!;
    const newPath = moves.get(path) ?? path;
    const result = rewriteMarkdown(content, path, newPath, finalOf, mentionPattern, mentionTarget);
    for (const destination of result.unresolved) unresolvedRewrites.push({ file: path, destination });
    if (result.content === content && newPath === path) continue;
    if (protectedFiles.has(path)) {
      skippedFiles.push({
        file: path,
        reason: "protected file (another agent's page)",
      });
      continue;
    }
    if (newPath === path && dirty.has(path) && !isAllowedDirty(path, allowed)) {
      skippedFiles.push({
        file: path,
        reason: "uncommitted changes outside the allowed prefixes",
      });
      continue;
    }
    pending.push({ from: path, to: newPath, content: result.content });
    if (result.links || result.mentions) {
      rewrittenFiles.push({
        file: newPath,
        links: result.links,
        mentions: result.mentions,
      });
      // Attribute inbound rewrites to the action whose subject they reference.
      for (const dest of [...scanLinkSites(content), ...scanDefinitionSites(content)]) {
        const target = resolveLocalLink(path, dest.dest);
        if (target && relocated.has(target)) {
          const bucket = perAction.get(target) ?? new Map();
          const current = bucket.get(newPath) ?? { links: 0, mentions: 0 };
          current.links++;
          bucket.set(newPath, current);
          perAction.set(target, bucket);
        }
      }
      for (const mention of content.match(mentionPattern ?? /$^/g) ?? []) {
        if (!relocated.has(mention)) continue;
        const bucket = perAction.get(mention) ?? new Map();
        const current = bucket.get(newPath) ?? { links: 0, mentions: 0 };
        current.mentions++;
        bucket.set(newPath, current);
        perAction.set(mention, bucket);
      }
    }
  }

  // 2b. Legacy path fixes (applied on top of any rewritten content).
  const pathFixes = new Map<string, Array<{ file: string; replacements: number }>>();
  for (const action of plan.actions) {
    if (action.action !== "fix-paths") continue;
    const matched = matchHubPatterns("", action.patterns ?? [], files).filter(
      path =>
        (plan.scope !== "all" || safeGlobalPath(root, path)) &&
        !removals.has(path) &&
        !protectedFiles.has(path) &&
        !(plan.scope === "all" && (ALL_SCOPE.excludePaths.some(rule => rule.test(path)) || importedUpstream(path))),
    );
    const fixes: Array<{ file: string; replacements: number }> = [];
    // Each matched path is queued at most once, so the queue state read here is the state each iteration sees.
    const onDisk = new Map(
      // oxlint-disable-next-line no-await-in-loop -- chaque action lit la file pending produite par les actions précédentes : l'itération suivante ne peut pas être lancée avant
      await Promise.all(
        matched
          .filter(path => !pending.some(item => item.to === path))
          .map(async path => [path, await readFile(join(root, path), "utf8")] as const),
      ),
    );
    for (const path of matched) {
      const queued = pending.find(item => item.to === path);
      const current = queued?.content ?? onDisk.get(path)!;
      const fixed = applyPathMap(current, options.legacyPathMap ?? new Map());
      if (!fixed.replacements) continue;
      if (dirty.has(path) && !isAllowedDirty(path, allowed)) {
        if (!skippedFiles.some(item => item.file === path))
          skippedFiles.push({
            file: path,
            reason: "uncommitted changes outside the allowed prefixes",
          });
        continue;
      }
      if (queued) queued.content = fixed.content;
      else pending.push({ from: path, to: path, content: fixed.content });
      fixes.push({ file: path, replacements: fixed.replacements });
    }
    pathFixes.set(action.id, fixes);
  }

  // 3. Source map.
  let sourceMapSummary: ApplyReport["sourceMap"] = null;
  let updatedMap: SourceMapFile | null = null;
  const movedRecords = plan.actions
    .filter(action => action.action === "move" && action.path && action.to)
    .map(action => ({ path: action.path!, to: action.to!, sha256: "" }));
  const removedRecords = [...removals.entries()].map(([path, canonical]) => ({
    path,
    canonical: moves.get(canonical) ?? canonical,
  }));
  const sourceMapPath = options.sourceMapPath ? join(root, options.sourceMapPath) : null;
  if (sourceMapPath && existsSync(sourceMapPath)) {
    updatedMap = JSON.parse(await readFile(sourceMapPath, "utf8")) as SourceMapFile;
    // A moved document's recorded hash is the hash of its rewritten content.
    await Promise.all(
      movedRecords.map(async record => {
        const rewritten = pending.find(item => item.from === record.path);
        record.sha256 = rewritten ? sha256Of(rewritten.content) : await fileHash(record.path);
      }),
    );
    const updated = recordInSourceMap(updatedMap, removedRecords, movedRecords, options.reportName);
    sourceMapSummary = {
      path: options.sourceMapPath as string,
      entriesUpdated: updated,
    };
  }

  // 4. Execute.
  const removedDirectories: string[] = [];
  if (options.write) {
    // oxlint-disable no-await-in-loop -- exécution séquentielle des mutations de fichiers : un échec laisse un état partiel prévisible, et le rmdir doit suivre le vidage des enfants (plus profond d'abord)
    for (const item of pending) {
      const destination = join(root, item.to);
      await mkdir(dirname(destination), { recursive: true });
      if (item.from !== item.to) {
        await rename(join(root, item.from), destination);
      }
      await writeFile(destination, item.content);
    }
    for (const path of removals.keys()) await unlink(join(root, path));
    for (const [path, canonical] of pointers) await writeFile(join(root, path), pointerStub(path, finalOf(canonical)));
    const emptied = new Set<string>();
    for (const path of [...removals.keys(), ...moves.keys()]) {
      let directory = dirname(path);
      while (directory && directory !== "." && directory !== "docs") {
        emptied.add(directory);
        directory = dirname(directory);
      }
    }
    for (const directory of [...emptied].toSorted((a, b) => b.length - a.length)) {
      const absolute = join(root, directory);
      try {
        if ((await readdir(absolute)).length === 0) {
          await rmdir(absolute);
          removedDirectories.push(directory);
        }
      } catch {
        // Directory already gone or not empty.
      }
    }
    if (sourceMapPath && updatedMap) await writeFile(sourceMapPath, `${JSON.stringify(updatedMap)}\n`);
    // oxlint-enable no-await-in-loop
  }

  const applied: AppliedAction[] = plan.actions.map(action => {
    const subjects =
      action.action === "merge" ? (action.sources ?? []).map(source => source.path) : [action.path ?? ""];
    const inboundRewritten = subjects.flatMap(subject =>
      [...(perAction.get(subject) ?? new Map()).entries()].map(([file, counts]) => ({
        file,
        links: counts.links,
        mentions: counts.mentions,
      })),
    );
    const mapEntries = recordedEntries(updatedMap, action);
    return {
      ...action,
      ...(action.action === "fix-paths" ? { pathFixes: pathFixes.get(action.id) ?? [] } : {}),
      inboundRewritten: inboundRewritten.toSorted((a, b) => a.file.localeCompare(b.file)),
      sourceMapEntries: mapEntries,
      outcome: action.action === "retain" ? "recorded" : options.write ? "applied" : "dry-run",
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tool: "aphrody-ops docs-consolidate apply",
    dryRun: !options.write,
    scope: plan.scope,
    root,
    actions: applied,
    rewrittenFiles: rewrittenFiles.toSorted((a, b) => a.file.localeCompare(b.file)),
    skippedFiles,
    unresolvedRewrites,
    removedDirectories,
    sourceMap: sourceMapSummary,
  };
}

function recordedEntries(map: SourceMapFile | null, action: PlanAction): number {
  if (!map) return 0;
  const subjects = action.action === "merge" ? (action.sources ?? []).map(source => source.path) : [action.path];
  let count = 0;
  for (const entry of map.entries) {
    if (entry.kind !== "documentation") continue;
    if (entry.duplicateOf && subjects.some(subject => entry.targetReason?.includes(`${subject} removed`))) count++;
    else if (action.action === "move" && entry.importedTarget === action.to) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export interface VerifyFinding {
  action: string;
  problem: string;
}

export async function verifyReport(
  root: string,
  report: Pick<ApplyReport, "actions" | "sourceMap"> & Partial<Pick<ApplyReport, "scope">>,
): Promise<VerifyFinding[]> {
  const findings: VerifyFinding[] = [];
  if (report.scope === "all") {
    const paths = report.actions
      .flatMap(action => [
        action.path,
        action.canonical,
        action.to,
        ...(action.sources ?? []).map(source => source.path),
      ])
      .filter((path): path is string => path !== undefined);
    if (report.sourceMap) paths.push(report.sourceMap.path);
    for (const path of paths)
      if (!safeGlobalPath(root, path))
        findings.push({
          action: "paths",
          problem: `Unsafe global documentation path: ${path}`,
        });
    if (findings.length) return findings;
  }
  const absolute = (path: string) => join(resolve(root), path);
  let map: SourceMapFile | null = null;
  if (report.sourceMap && existsSync(absolute(report.sourceMap.path)))
    map = JSON.parse(await readFile(absolute(report.sourceMap.path), "utf8")) as SourceMapFile;
  const destinations = new Set<string>();
  if (map)
    for (const entry of map.entries)
      if (entry.kind === "documentation") {
        const destination = documentDestination(entry);
        if (destination) destinations.add(destination);
      }
  for (const action of report.actions) {
    if (action.action === "remove-duplicate" && action.path && action.canonical) {
      if (existsSync(absolute(action.path)))
        findings.push({
          action: action.id,
          problem: `${action.path} still exists`,
        });
      if (!existsSync(absolute(action.canonical)))
        findings.push({
          action: action.id,
          problem: `canonical ${action.canonical} missing`,
        });
      if (destinations.has(action.path))
        findings.push({
          action: action.id,
          problem: `source map still lists ${action.path}`,
        });
    } else if (action.action === "move" && action.path && action.to) {
      if (existsSync(absolute(action.path)))
        findings.push({
          action: action.id,
          problem: `${action.path} still exists`,
        });
      if (!existsSync(absolute(action.to))) findings.push({ action: action.id, problem: `${action.to} missing` });
      if (destinations.has(action.path))
        findings.push({
          action: action.id,
          problem: `source map still lists ${action.path}`,
        });
    } else if (action.action === "merge") {
      // oxlint-disable no-await-in-loop -- les findings sont ajoutés dans l'ordre des sources : lecture séquentielle pour un rapport déterministe
      for (const source of action.sources ?? []) {
        if (source.disposition === "pointer") {
          const isStub =
            existsSync(absolute(source.path)) && isPointerStub(await readFile(absolute(source.path), "utf8"));
          if (!isStub)
            findings.push({
              action: action.id,
              problem: `${source.path} is not a pointer stub`,
            });
        } else if (existsSync(absolute(source.path)))
          findings.push({
            action: action.id,
            problem: `${source.path} still exists`,
          });
      }
      // oxlint-enable no-await-in-loop
      if (action.canonical && !existsSync(absolute(action.canonical)))
        findings.push({
          action: action.id,
          problem: `canonical ${action.canonical} missing`,
        });
    }
  }
  // No Markdown link or mention may still point at a removed or moved path.
  const gone = new Set<string>();
  for (const action of report.actions) {
    if (action.action === "remove-duplicate" && action.path) gone.add(action.path);
    if (action.action === "move" && action.path) gone.add(action.path);
    if (action.action === "merge")
      for (const source of action.sources ?? []) if (source.disposition !== "pointer") gone.add(source.path);
  }
  const { files } = listRepositoryFiles(resolve(root));
  const importedUpstream = report.scope === "all" ? importedUpstreamMatcher(resolve(root)) : () => undefined;
  const mentionPattern = buildMentionPattern(gone);
  const corpusPaths: string[] = [];
  for (const path of files) {
    if (!/\.(md|mdx)$/.test(path) || CORPUS_EXCLUDES.some(rule => rule.test(path))) continue;
    if (report.scope === "all" && !safeGlobalPath(root, path)) continue;
    if (report.scope === "all" && (ALL_SCOPE.excludePaths.some(rule => rule.test(path)) || importedUpstream(path)))
      continue;
    if (!existsSync(absolute(path))) continue;
    corpusPaths.push(path);
  }
  const contents = await Promise.all(corpusPaths.map(path => readFile(absolute(path), "utf8")));
  for (const [index, path] of corpusPaths.entries()) {
    const content = contents[index]!;
    for (const site of [...scanLinkSites(content), ...scanDefinitionSites(content)]) {
      const target = resolveLocalLink(path, site.dest);
      if (target && gone.has(target))
        findings.push({
          action: "links",
          problem: `${path} still links to ${target}`,
        });
    }
    for (const target of new Set(content.match(mentionPattern ?? /$^/g) ?? []))
      findings.push({
        action: "links",
        problem: `${path} still mentions ${target}`,
      });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Hubs: generated tables between markers
// ---------------------------------------------------------------------------

const HUB_BEGIN = /<!--\s*docs-hub:begin\s+(.*?)\s*-->/;
const HUB_END = "<!-- docs-hub:end -->";

export interface HubSpec {
  /** Repo-relative paths or directory-relative globs (`*`, `**`), `!` prefix excludes. */
  patterns: string[];
}

export function parseHubMarker(line: string): HubSpec | null {
  const match = HUB_BEGIN.exec(line);
  if (!match) return null;
  const attribute = /include="([^"]*)"/.exec(match[1] ?? "");
  if (!attribute?.[1]) return null;
  return {
    patterns: attribute[1]
      .split(";")
      .map(part => part.trim())
      .filter(Boolean),
  };
}

export function matchHubPatterns(hubDirectory: string, patterns: string[], paths: string[]): string[] {
  const includes: Bun.Glob[] = [];
  const excludes: Bun.Glob[] = [];
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const raw = negated ? pattern.slice(1) : pattern;
    const absolute = raw.startsWith("/") ? raw.slice(1) : posix.join(hubDirectory, raw);
    (negated ? excludes : includes).push(new Bun.Glob(absolute));
  }
  return paths
    .filter(path => includes.some(rule => rule.match(path)) && !excludes.some(rule => rule.match(path)))
    .toSorted();
}

export interface HubRow {
  path: string;
  title: string;
  description: string;
  status: Status;
  date: string;
}

export function renderHubTable(hubPath: string, rows: HubRow[]): string {
  const lines = ["| Document | Contenu | Statut | Mis à jour |", "| --- | --- | --- | --- |"];
  for (const row of rows) {
    const href = encodeDestination(posix.relative(posix.dirname(hubPath), row.path));
    const label = row.title.replace(/\|/g, "\\|").replace(/\[|\]/g, "");
    const description = (row.description || "—").replace(/\|/g, "\\|");
    lines.push(`| [${label}](${href}) | ${description} | ${row.status} | ${row.date || "—"} |`);
  }
  return lines.join("\n");
}

/** Replace the generated blocks of a hub; returns null when nothing changed. */
export function refreshHub(hubPath: string, content: string, rowsFor: (spec: HubSpec) => HubRow[]): string | null {
  const lines = content.split("\n");
  const output: string[] = [];
  let changed = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const spec = parseHubMarker(line);
    output.push(line);
    if (!spec) continue;
    let close = index + 1;
    while (close < lines.length && (lines[close] ?? "").trim() !== HUB_END) close++;
    if (close >= lines.length) throw new Error(`${hubPath}: docs-hub block is not closed`);
    const generated = renderHubTable(hubPath, rowsFor(spec)).split("\n");
    if (generated.join("\n") !== lines.slice(index + 1, close).join("\n")) changed = true;
    output.push(...generated);
    index = close - 1;
  }
  return changed ? output.join("\n") : null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

const USAGE =
  "Usage: aphrody-ops docs-consolidate <scan|plan|apply|verify|hubs|report> [--root <repository>] [--scope ui|all] [--near-threshold <0..1>] [--output <file>] [--plan <file>] [--report <file>] [--history <apply report>]... [--write] [--source-map <file>] [--no-source-map] [--allow-dirty-prefix <path>]... [--protect <file>]... [--name <report name>] [--check] | report: --before <scan> --after <scan> --apply <apply report>... [--metrics <json>] --output <file>";

export interface ConsolidationReportInput {
  name: string;
  before: {
    summary: Record<string, unknown>;
    exactClusters: ExactCluster[];
    nearPairs: NearPair[];
  };
  after: { summary: Record<string, unknown> };
  applies: ApplyReport[];
  metrics: Record<string, unknown>;
}

/** Merge phase reports, cluster evidence and measured numbers into one auditable record. */
export function buildConsolidationReport(input: ConsolidationReportInput): Record<string, unknown> {
  const actions = input.applies.flatMap(report => report.actions);
  const count = (predicate: (action: AppliedAction) => boolean) => actions.filter(predicate).length;
  const rewritten = new Map<string, { links: number; mentions: number }>();
  for (const report of input.applies)
    for (const item of report.rewrittenFiles) {
      const current = rewritten.get(item.file) ?? { links: 0, mentions: 0 };
      current.links += item.links;
      current.mentions += item.mentions;
      rewritten.set(item.file, current);
    }
  return {
    schemaVersion: 1,
    name: input.name,
    generatedAt: new Date().toISOString(),
    tool: "aphrody-ops docs-consolidate",
    scope: input.before.summary["scope"] ?? "ui",
    nearDuplicateMethod: `5-word shingle Jaccard on normalized text (links, comments, front matter removed); threshold ${String(input.before.summary["nearThreshold"])}; relation equal-modulo-paths when the text is identical once path-like tokens are neutralized`,
    summary: {
      before: input.before.summary,
      after: input.after.summary,
      actions: {
        removeDuplicate: count(a => a.action === "remove-duplicate"),
        removeIdentical: count(a => a.action === "remove-duplicate" && a.equivalence === "identical"),
        removeEqualModuloPaths: count(a => a.equivalence === "equal-modulo-paths"),
        removeIdenticalAtHead: count(a => a.equivalence === "identical-at-head"),
        removeSuperseded: count(a => a.equivalence === "superseded"),
        moves: count(a => a.action === "move"),
        merges: count(a => a.action === "merge"),
        retained: count(a => a.action === "retain"),
        pathFixFiles: actions.reduce((sum, a) => sum + (a.pathFixes?.length ?? 0), 0),
        sourceMapEntriesUpdated: input.applies.reduce(
          (sum, report) => sum + (report.sourceMap?.entriesUpdated ?? 0),
          0,
        ),
      },
      ...input.metrics,
    },
    clustersBefore: {
      exact: input.before.exactClusters,
      near: input.before.nearPairs,
    },
    actions,
    rewrittenFiles: [...rewritten.entries()]
      .map(([file, counts]) => Object.assign({ file }, counts))
      .toSorted((a, b) => a.file.localeCompare(b.file)),
    skippedFiles: input.applies.flatMap(report => report.skippedFiles),
    unresolvedRewrites: input.applies.flatMap(report => report.unresolvedRewrites),
    removedDirectories: input.applies.flatMap(report => report.removedDirectories),
  };
}

async function loadSourceMap(root: string, path: string): Promise<SourceMapFile | null> {
  const file = join(root, path);
  return existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as SourceMapFile) : null;
}

export function summarizeScan(scan: ScanResult): Record<string, unknown> {
  const sum = (predicate: (entry: DocEntry) => boolean) => scan.entries.filter(predicate).length;
  const removable = scan.exactClusters.reduce((total, cluster) => total + cluster.paths.length - 1, 0);
  return {
    scope: scan.scope,
    documents: scan.entries.length,
    bytes: scan.entries.reduce((total, entry) => total + entry.bytes, 0),
    byScopeReason: {
      path: sum(entry => entry.scopeReason === "path"),
      owner: sum(entry => entry.scopeReason === "owner"),
      mention: sum(entry => entry.scopeReason === "mention"),
    },
    byTopic: scan.byTopic,
    byStatus: Object.fromEntries(
      ["canonical", "historical", "imported", "generated", "notice", "pointer", "legacy"].map(status => [
        status,
        sum(entry => entry.status === status),
      ]),
    ),
    imported: sum(entry => entry.imported),
    generated: sum(entry => entry.generated),
    licensed: sum(entry => entry.licensed),
    untracked: sum(entry => entry.untracked),
    exactClusters: scan.exactClusters.length,
    filesInExactClusters: scan.exactClusters.reduce((total, cluster) => total + cluster.paths.length, 0),
    redundantFilesInExactClusters: removable,
    nearThreshold: scan.nearThreshold,
    nearPairs: scan.nearPairs.length,
    nearByRelation: {
      "equal-modulo-paths": scan.nearPairs.filter(pair => pair.relation === "equal-modulo-paths").length,
      "translation-or-variant": scan.nearPairs.filter(pair => pair.relation === "translation-or-variant").length,
    },
    unresolvedOutboundLinks: scan.unresolvedOutbound,
  };
}

export async function runDocsConsolidation(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  let root = process.cwd();
  let nearThreshold = 0.8;
  let scope = UI_SCOPE;
  let output: string | undefined;
  let planFile: string | undefined;
  let reportFile: string | undefined;
  let write = false;
  let check = false;
  let sourceMapPath: string | null = "docs/migration/source-map.json";
  let reportName = "ui-docs-consolidation";
  const allowDirty: string[] = [];
  const protect: string[] = [];
  const history: string[] = [];
  const applies: string[] = [];
  let beforeFile: string | undefined;
  let afterFile: string | undefined;
  let metricsFile: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === "--root") root = takeValue(rest, ++index, arg);
    else if (arg === "--scope") {
      const name = takeValue(rest, ++index, arg);
      if (name !== "ui" && name !== "all") throw new Error("--scope must be ui or all");
      scope = name === "all" ? ALL_SCOPE : UI_SCOPE;
    } else if (arg === "--near-threshold") nearThreshold = Number(takeValue(rest, ++index, arg));
    else if (arg === "--output") output = takeValue(rest, ++index, arg);
    else if (arg === "--plan") planFile = takeValue(rest, ++index, arg);
    else if (arg === "--report") reportFile = takeValue(rest, ++index, arg);
    else if (arg === "--source-map") sourceMapPath = takeValue(rest, ++index, arg);
    else if (arg === "--no-source-map") sourceMapPath = null;
    else if (arg === "--name") reportName = takeValue(rest, ++index, arg);
    else if (arg === "--allow-dirty-prefix") allowDirty.push(takeValue(rest, ++index, arg));
    else if (arg === "--protect") protect.push(takeValue(rest, ++index, arg));
    else if (arg === "--history") history.push(takeValue(rest, ++index, arg));
    else if (arg === "--apply") applies.push(takeValue(rest, ++index, arg));
    else if (arg === "--before") beforeFile = takeValue(rest, ++index, arg);
    else if (arg === "--after") afterFile = takeValue(rest, ++index, arg);
    else if (arg === "--metrics") metricsFile = takeValue(rest, ++index, arg);
    else if (arg === "--write") write = true;
    else if (arg === "--check") check = true;
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  if (!Number.isFinite(nearThreshold) || nearThreshold <= 0 || nearThreshold > 1)
    throw new Error("--near-threshold must be in (0, 1]");
  root = resolve(root);
  if (scope.name === "all" && sourceMapPath && !safeGlobalPath(root, sourceMapPath))
    throw new Error(`Unsafe global documentation path: ${sourceMapPath}`);

  const pathHistory = new Map<string, string>();
  const earlierReports = await Promise.all(
    history.map(async file => JSON.parse(await readFile(resolve(file), "utf8")) as ApplyReport),
  );
  for (const earlier of earlierReports) {
    for (const action of earlier.actions)
      if (action.action === "move" && action.path && action.to) pathHistory.set(action.to, action.path);
  }

  if (command === "report") {
    if (!beforeFile || !afterFile || !output) throw new Error("report requires --before, --after and --output");
    const before = JSON.parse(await readFile(resolve(beforeFile), "utf8")) as ConsolidationReportInput["before"];
    const after = JSON.parse(await readFile(resolve(afterFile), "utf8")) as ConsolidationReportInput["after"];
    const reports = await Promise.all(
      applies.map(async file => JSON.parse(await readFile(resolve(file), "utf8")) as ApplyReport),
    );
    const metrics = metricsFile
      ? (JSON.parse(await readFile(resolve(metricsFile), "utf8")) as Record<string, unknown>)
      : {};
    await writeFile(
      resolve(output),
      `${JSON.stringify(buildConsolidationReport({ name: reportName, before, after, applies: reports, metrics }), null, 2)}\n`,
    );
    console.log(
      JSON.stringify(
        {
          report: output,
          actions: reports.reduce((n, r) => n + r.actions.length, 0),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === "scan" || command === "plan") {
    const sourceMap = sourceMapPath ? await loadSourceMap(root, sourceMapPath) : null;
    const scan = await scanScope({
      root,
      scope,
      nearThreshold,
      sourceMap,
      pathHistory,
    });
    if (command === "scan") {
      if (output)
        await writeFile(resolve(output), `${JSON.stringify({ summary: summarizeScan(scan), ...scan }, null, 2)}\n`);
      console.log(JSON.stringify(summarizeScan(scan), null, 2));
      return 0;
    }
    const plan = planOwnerDuplicates(
      scan,
      scope.name === "all" ? ALL_SCOPE.ownerRoots : OWNER_DUPLICATE_ROOTS,
      scope.name === "all"
        ? retainDocumentationCopy
        : path => (isNoticeFile(path) ? "license or notice file is retained in place" : null),
    );
    if (output) await writeFile(resolve(output), `${JSON.stringify(plan, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          scope: plan.scope,
          removeDuplicate: plan.actions.filter(a => a.action === "remove-duplicate").length,
          removeEqualModuloPaths: plan.actions.filter(a => a.equivalence === "equal-modulo-paths").length,
          retained: plan.actions.filter(a => a.action === "retain").length,
          reviewDiverged: plan.review.length,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === "apply") {
    if (!planFile) throw new Error("apply requires --plan <file>");
    const plan = JSON.parse(await readFile(resolve(planFile), "utf8")) as Plan;
    const report = await applyPlan({
      root,
      plan,
      write,
      sourceMapPath,
      allowDirtyPrefixes: allowDirty,
      reportName,
      protectedFiles: protect,
      legacyPathMap: await loadLegacyPathMap(root),
    });
    if (reportFile) await writeFile(resolve(reportFile), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          dryRun: report.dryRun,
          actions: report.actions.length,
          rewrittenFiles: report.rewrittenFiles.length,
          skippedFiles: report.skippedFiles,
          unresolvedRewrites: report.unresolvedRewrites.length,
          removedDirectories: report.removedDirectories.length,
          sourceMap: report.sourceMap,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === "verify") {
    if (!reportFile) throw new Error("verify requires --report <file>");
    const report = JSON.parse(await readFile(resolve(reportFile), "utf8")) as ApplyReport;
    const findings = await verifyReport(root, report);
    console.log(JSON.stringify({ findings }, null, 2));
    return findings.length ? 1 : 0;
  }

  if (command === "hubs") {
    const sourceMap = sourceMapPath ? await loadSourceMap(root, sourceMapPath) : null;
    const scan = await scanScope({
      root,
      scope,
      nearThreshold,
      sourceMap,
      pathHistory,
    });
    const byPath = new Map(scan.entries.map(entry => [entry.path, entry]));
    const { files } = listRepositoryFiles(root);
    const hubs = files.filter(
      path =>
        /^docs\/.*README\.md$/.test(path) &&
        existsSync(join(root, path)) &&
        (scope.name !== "all" || safeGlobalPath(root, path)),
    );
    let stale = 0;
    // oxlint-disable no-await-in-loop -- hubs traités un par un : lecture, écriture et sortie console suivent l'ordre des hubs, et une erreur de lecture arrête les écritures déjà faites
    for (const hub of hubs) {
      const content = await readFile(join(root, hub), "utf8");
      if (!HUB_BEGIN.test(content)) continue;
      const refreshed = refreshHub(hub, content, spec =>
        matchHubPatterns(posix.dirname(hub), spec.patterns, files)
          .filter(path => scope.name !== "all" || safeGlobalPath(root, path))
          .map((path): HubRow => {
            const entry = byPath.get(path);
            const text = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "";
            return {
              path,
              title: entry?.title ?? titleOf(text, basename(path)),
              description: describeDocument(text),
              status:
                entry?.status ??
                deriveStatus({
                  path,
                  text,
                  imported: false,
                  generated: isGeneratedDocument(path, text),
                  notice: isNoticeFile(path),
                }),
              date: entry?.lastGitDate ?? "",
            };
          }),
      );
      if (refreshed === null) continue;
      stale++;
      if (write) await writeFile(join(root, hub), refreshed);
      console.log(`${write ? "refreshed" : "stale"}: ${hub}`);
    }
    // oxlint-enable no-await-in-loop
    if (check && stale) return 1;
    return 0;
  }
  throw new Error(`Unknown command: ${command}\n${USAGE}`);
}

if (import.meta.main) process.exit(await runDocsConsolidation(process.argv.slice(2)));
