// SPDX-License-Identifier: Apache-2.0
/** Snapshot extraction inputs without changing any source checkout. */
import { createHash } from "node:crypto";
import { execFileSync } from "@aphrody/update/process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { inventoryNestedFiles, inventorySubmodules } from "./submodule-inventory.ts";
import { importInfraConfig } from "./infra-config-import.ts";
import { importInfraScripts } from "./infra-scripts-import.ts";
import { importSourceLicenses } from "./source-licenses-import.ts";

/** True when `target` is strictly below `root`, with either path separator. */
function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== "" && !isAbsolute(path) && path.split(sep)[0] !== "..";
}

type Mode = "extract" | "orchestrator-split" | "upstream-pinned" | "deferred" | "classify";
type RootSpec = {
  key: string;
  path: string;
  owner: string;
  mode: Mode;
  rootDocsOnly?: boolean;
  markdownDocsAnywhere?: boolean;
  excludedPrefixes?: string[];
  license?: string;
  sourcePath?: string;
};
type Entry = {
  source: string;
  kind: string;
  category?: string;
  size: number | null;
  status: string;
  sha256?: string;
  target: string | null;
  importedTarget?: string;
  importedSha256?: string;
  importedSourceSha256?: string;
  duplicateOf?: string;
  targetReason?: string;
};
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".adoc", ".txt", ".pdf"]);
const UPSTREAM_DOC_TEXT_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".adoc", ".txt"]);
const UPSTREAM_AGENT_INSTRUCTION_FILE =
  /(?:^|\/)(?:(?:CLAUDE|AGENTS|GEMINI|CODEX)\.md|copilot-instructions\.md|\.cursorrules)$|(?:^|\/)\.(?:cursor|claude|agents|codex|gemini)\/|(?:^|\/)\.env/;
const UPSTREAM_EXCLUDED_DOC_SOURCES = new Set(["upstream-WSL2-Linux-Kernel"]);
const SCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".sh", ".bash", ".nu", ".py", ".ps1"]);
const EXTERNAL_PARTS = new Set(["vendor", "third_party", "thirdparty", "upstream", "node_modules"]);
const WITHDRAWN_IECODE_BUN_PATHS = ["packages/nie/", "packages/nie-plugin/", "packages/iecode-ffi/"];

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}
function argsOf(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") continue;
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    result.set(arg, value);
  }
  return result;
}
function classifyDoc(path: string): string {
  const lower = path.toLowerCase();
  if (/\b(plan|roadmap|backlog)\b/.test(lower) || /(^|\/)plans?\//.test(lower)) return "plans";
  if (/architect|design|system-map/.test(lower)) return "architecture";
  if (/api|protocol|schema|contract|format/.test(lower)) return "apis";
  if (/decision|adr|rfc/.test(lower)) return "decisions";
  if (/guide|tutorial|howto|contribut|setup|install/.test(lower)) return "guides";
  if (/deploy|operations?|infra|release|ci-cd|runbook/.test(lower)) return "operations";
  if (/audit|research|report|benchmark|security|parity/.test(lower)) return "research";
  if (/readme|product|app\//.test(lower)) return "products";
  return "reference";
}
function classifyScript(path: string): string {
  const s = path.toLowerCase();
  if (/audit|check|lint|test|verify|scan|validate|doctor/.test(s)) return "audit";
  if (/release|publish|version|tag/.test(s)) return "release";
  if (/migrat|import|extract|transfer/.test(s)) return "migration";
  if (/build|bundle|compile|package/.test(s)) return "build";
  if (/dev|watch|serve|format/.test(s)) return "dev";
  return "tools";
}
function kindOf(path: string): { kind: string; category?: string } {
  const parts = path.split("/");
  const name = basename(path);
  const ext = name.includes(".") ? `.${name.split(".").at(-1)!.toLowerCase()}` : "";
  // Keep proprietary game dumps and derived fixture datasets in their protected
  // stores. Import adjacent Markdown analysis, but never move structured game
  // data into the source/documentation workspace.
  if (/^docs\/game-data\/(?:oc|menu-fixtures)\//.test(path) && !DOC_EXTENSIONS.has(ext))
    return { kind: "protected-game-data" };
  if (DOC_EXTENSIONS.has(ext) || /^(AGENTS|CONTRIBUTING|ARCHITECTURE|PLAN|README)(\.|$)/i.test(name))
    return { kind: "documentation", category: classifyDoc(path) };
  if (parts.includes("scripts") || parts.includes("script") || parts.includes("tools"))
    if (SCRIPT_EXTENSIONS.has(ext)) return { kind: "script", category: classifyScript(path) };
  if (name === "Cargo.toml") return { kind: "cargo-manifest" };
  if (name === "package.json") return { kind: "bun-manifest" };
  if (name === "pyproject.toml") return { kind: "python-manifest" };
  if (parts[0] === "packages") return { kind: "bun-package" };
  if (parts[0] === "apps") return { kind: "bun-app" };
  if (ext === ".rs") return { kind: "rust-source" };
  if (parts.includes("scripts") || parts.includes("script") || parts.includes("tools"))
    if (SCRIPT_EXTENSIONS.has(ext)) return { kind: "script", category: classifyScript(path) };
  if (parts[0] === "docs") return { kind: "documentation", category: classifyDoc(path) };
  return { kind: "source-or-config" };
}
function safeKey(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}
export function targetPath(owner: string, path: string, info: ReturnType<typeof kindOf>): string | null {
  if (info.kind === "protected-game-data") return null;
  const parts = path.split("/");
  const ext = basename(path).split(".").at(-1)?.toLowerCase();
  if (info.kind === "documentation") {
    const remainder = parts[0] === "docs" ? parts.slice(1).join("/") : path;
    return `docs/${info.category ?? "reference"}/${owner}/${remainder || basename(path)}`;
  }
  if (ext === "py" || ext === "pyi" || ext === "ipynb") {
    if (owner === "infra" && parts[0] === "scripts")
      return "../aphrody-py/tools/infra/scripts/python-workspace-dispatch.py";
    return `../aphrody-py/${parts[0] === "scripts" ? "tools" : parts[0] === "apps" ? "apps" : "packages"}/${owner}/${path}`;
  }
  if (info.kind === "script") return `scripts/${info.category ?? "tools"}/${owner}/${path}`;
  if (info.kind === "rust-source") {
    const remainder =
      parts[0] === "crates"
        ? parts.slice(1).join("/")
        : parts[0] === "apps"
          ? `apps/${parts.slice(1).join("/")}`
          : path;
    return `crates/${owner}/${remainder}`;
  }
  if (info.kind === "bun-package") return `packages/${owner}/${path.slice("packages/".length)}`;
  if (info.kind === "bun-app") return `apps/${owner}/${path.slice("apps/".length)}`;
  if (info.kind === "cargo-manifest" && ["crates", "apps"].includes(parts[0]!)) {
    const remainder = parts[0] === "crates" ? parts.slice(1).join("/") : `apps/${parts.slice(1).join("/")}`;
    return `crates/${owner}/${remainder}`;
  }
  if (info.kind === "bun-manifest" && ["packages", "apps"].includes(parts[0]!)) {
    const kind = parts[0] === "crates" ? "crates" : parts[0]!;
    return `${kind}/${owner}/${path.slice(kind.length + 1)}`;
  }
  if (parts[0] === "crates") return `crates/${owner}/${parts.slice(1).join("/")}`;
  if (parts[0] === "packages") return `packages/${owner}/${parts.slice(1).join("/")}`;
  if (parts[0] === "apps") return `apps/${owner}/${parts.slice(1).join("/")}`;
  if (info.kind.endsWith("manifest")) return `migration/manifests/${owner}/${path}`;
  return `migration/source-refs/${owner}/${path}`;
}
export function isInfraPythonScript(path: string, info: ReturnType<typeof kindOf>): boolean {
  return info.kind === "script" && /^scripts\/.*\.(?:py|pyi|ipynb)$/i.test(path);
}
function parseStatus(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of raw.split("\0")) {
    if (item.length < 4) continue;
    result.set(safeKey(item.slice(3)), item.slice(0, 2).trim() || "M");
  }
  return result;
}

async function rootSnapshot(spec: RootSpec): Promise<{ root: Record<string, unknown>; entries: Entry[] }> {
  const top = resolve(spec.path);
  const gitRoot = resolve(git(top, ["rev-parse", "--show-toplevel"]).trim());
  const head = git(gitRoot, ["rev-parse", "HEAD"]).trim();
  const branch = git(gitRoot, ["branch", "--show-current"]).trim() || "detached";
  const statusRaw = git(gitRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const statuses = parseStatus(statusRaw);
  const tracked = git(gitRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean)
    .map(safeKey);
  const entries: Entry[] = [];
  // oxlint-disable no-await-in-loop -- file hashing runs one file at a time so memory stays bounded to a single file across the checkout
  for (const path of [...new Set(tracked)].toSorted()) {
    if (
      spec.rootDocsOnly &&
      !(
        /^(?:docs?|documentation)\//i.test(path) ||
        /^(README|PLAN|AGENTS|ARCHITECTURE|\.gitmodules|manifest\.json)/i.test(path) ||
        (spec.markdownDocsAnywhere &&
          (/\.(?:md|mdx)$/i.test(path) ||
            (/^(?:docs?|documentation)\//i.test(path) &&
              DOC_EXTENSIONS.has(`.${path.split(".").at(-1)?.toLowerCase() ?? ""}`))))
      )
    )
      continue;
    const source = join(gitRoot, path);
    const info = kindOf(path);
    const exists = await Bun.file(source).exists();
    let size: number | null = null;
    let sha256: string | undefined;
    if (exists) {
      const st = await stat(source);
      size = st.size;
      const firstPartyCode =
        ["rust-source", "cargo-manifest", "bun-manifest", "bun-package", "bun-app"].includes(info.kind) ||
        ["crates", "apps", "packages"].includes(path.split("/")[0]!);
      const infraCatalog =
        spec.mode === "orchestrator-split" &&
        (path.startsWith("config/") ||
          path.startsWith("inventory/") ||
          path.startsWith("systemd/") ||
          path === "rust-toolchain.toml");
      if (
        (["documentation", "script"].includes(info.kind) || firstPartyCode || infraCatalog) &&
        st.isFile() &&
        st.size <= 10 * 1024 * 1024
      ) {
        const bytes = await readFile(source);
        sha256 = createHash("sha256").update(bytes).digest("hex");
      }
    }
    const external = path.split("/").some(part => EXTERNAL_PARTS.has(part));
    const infraCatalog =
      spec.mode === "orchestrator-split" &&
      (path.startsWith("config/") ||
        path.startsWith("inventory/") ||
        path.startsWith("systemd/") ||
        path === "rust-toolchain.toml");
    const rootLicense =
      (spec.mode === "extract" || spec.mode === "orchestrator-split") &&
      spec.key !== "aphrody-ui" &&
      /^(?:LICENSE|NOTICE|COPYING)(?:[.-][A-Za-z0-9._-]+)?$/i.test(path);
    const upstreamLicense =
      spec.key === "oxc" && spec.mode === "upstream-pinned" && /^LICENSE(?:[.-][A-Za-z0-9._-]+)?$/i.test(path);
    const infraOwnedControl =
      spec.mode === "orchestrator-split" &&
      (path.startsWith("scripts/") || path.startsWith("packages/aphrody-workspace/"));
    const withdrawnIecodeBunStage =
      spec.key === "iecode" &&
      info.kind !== "documentation" &&
      WITHDRAWN_IECODE_BUN_PATHS.some(prefix => path.startsWith(prefix));
    const excludedDocumentation =
      info.kind === "documentation" && (spec.excludedPrefixes ?? []).some(prefix => path.startsWith(prefix));
    const unavailableUpstreamDocumentation =
      spec.key.startsWith("upstream-") && info.kind === "documentation" && !exists;
    const oversizedUpstreamDocumentation =
      spec.key.startsWith("upstream-") && info.kind === "documentation" && (size ?? 0) > 10 * 1024 * 1024;
    // Upstream documentation imports keep text documents only: no media, notebooks,
    // lockfiles or env files, no upstream agent instruction files (agents would load
    // them as rules), and no WSL kernel tree (WSL work waits for the Aphrody deploy).
    const policyExcludedUpstreamDocumentation =
      spec.key.startsWith("upstream-") &&
      info.kind === "documentation" &&
      (!UPSTREAM_DOC_TEXT_EXTENSIONS.has(`.${path.split(".").at(-1)?.toLowerCase() ?? ""}`) ||
        UPSTREAM_AGENT_INSTRUCTION_FILE.test(path) ||
        UPSTREAM_EXCLUDED_DOC_SOURCES.has(spec.key));
    const destination =
      rootLicense || upstreamLicense
        ? `docs/migration/source-licenses/${spec.key}/${path}`
        : infraCatalog
          ? path
          : spec.mode === "deferred" ||
              spec.mode === "classify" ||
              excludedDocumentation ||
              unavailableUpstreamDocumentation ||
              oversizedUpstreamDocumentation ||
              policyExcludedUpstreamDocumentation ||
              infraOwnedControl ||
              withdrawnIecodeBunStage
            ? null
            : external
              ? `upstream/${spec.owner}/${path}`
              : spec.mode === "upstream-pinned" && info.kind !== "documentation"
                ? `upstream/${spec.owner}/${path}`
                : targetPath(spec.mode === "upstream-pinned" ? `upstream-${spec.owner}` : spec.owner, path, info);
    entries.push({
      source: `${spec.key}/${path}`,
      kind: external && info.kind !== "documentation" ? "upstream-source" : info.kind,
      ...(info.category ? { category: info.category } : {}),
      size,
      status: exists ? (statuses.get(path) ?? "clean") : "missing",
      ...(sha256 ? { sha256 } : {}),
      target: destination,
      ...(withdrawnIecodeBunStage
        ? {
            targetReason: "withdrawn-unqualified-bun-stage-no-aphrody-consumer",
          }
        : excludedDocumentation
          ? { targetReason: "excluded-by-source-license-boundary" }
          : spec.key.startsWith("upstream-") && info.kind === "documentation" && external
            ? { targetReason: "external-vendor-document-stays-with-source" }
            : unavailableUpstreamDocumentation
              ? { targetReason: "not-present-in-source-worktree" }
              : oversizedUpstreamDocumentation
                ? {
                    targetReason: "documentation-asset-over-10-mib-import-limit",
                  }
                : policyExcludedUpstreamDocumentation
                  ? { targetReason: "excluded-by-upstream-docs-import-policy" }
                  : spec.key === "upstream-openfox" && info.kind === "documentation"
                    ? { targetReason: "source-license-unverified-no-copy" }
                    : {}),
    });
  }
  // oxlint-enable no-await-in-loop
  const summary = {
    key: spec.key,
    owner: spec.owner,
    policy: spec.mode,
    sourcePath:
      spec.sourcePath ?? (spec.key === "iecode" ? "../iecode" : spec.key === "src-root-docs" ? "." : `src/${spec.key}`),
    head,
    branch,
    ...(spec.license ? { license: spec.license } : {}),
    dirty: statuses.size > 0,
    dirtyPathCount: statuses.size,
    trackedAndUntrackedPathCount: entries.length,
    documentationCount: entries.filter(entry => entry.kind === "documentation").length,
    rustManifestCount: entries.filter(entry => entry.kind === "cargo-manifest").length,
    bunManifestCount: entries.filter(entry => entry.kind === "bun-manifest").length,
    pythonManifestCount: entries.filter(entry => entry.kind === "python-manifest").length,
  };
  return { root: summary, entries };
}

export type DocumentationIndexEntry = Pick<Entry, "source" | "kind" | "target"> &
  Partial<Pick<Entry, "importedTarget">>;
const DOCUMENTATION_INDEX_MARKER =
  "<!-- Generated from migration/source-map.json by yolo ops consolidation docs-import. -->";

/** Render recorded destinations without accessing their source checkouts. */
export function renderDocumentationIndex(entries: readonly DocumentationIndexEntry[], aphrodyRoot: string): string {
  for (const entry of entries) {
    const destination = entry.importedTarget ?? entry.target;
    if (entry.kind !== "documentation" || !destination?.startsWith("docs/")) continue;
    if (!inside(resolve(aphrodyRoot, "docs"), resolve(aphrodyRoot, destination)))
      throw new Error(`documentation destination escaped docs: ${destination}`);
  }
  return [
    DOCUMENTATION_INDEX_MARKER,
    "# Documentation importée — références canoniques",
    "",
    "Navigation courante : [llms.txt](../llms.txt).",
    "Inventaire unique : [documentation.json](../reference/workspace/documentation.json).",
    "Provenance des imports : [source-map.json](source-map.json).",
    "",
    "Les chemins d'import historiques ne sont pas un second catalogue courant.",
    "",
  ].join("\n");
}

async function writeDocumentationIndex(aphrodyRoot: string, content: string): Promise<string | null> {
  const indexPath = join(aphrodyRoot, "docs/migration/IMPORTED-DOCS-INDEX.md");
  if (existsSync(indexPath)) {
    const existing = await readFile(indexPath, "utf8");
    if (!existing.startsWith(DOCUMENTATION_INDEX_MARKER))
      return "preserved existing handwritten documentation index; no index was written";
  }
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, content);
  return null;
}

export async function runConsolidation(args: string[]): Promise<number> {
  const [action = "inventory", ...rest] = args;
  if (action === "--help" || action === "-h" || action === "help") {
    console.log(
      "Usage: yolo ops consolidation <inventory|submodules-inventory|infra-config-import|infra-scripts-import|source-licenses-import|docs-import|docs-index|scripts-import> [--owner name] [--source-root path] [--upstreams-root path] [--upstreams-only true] [--iecode-root path] [--aphrody-root path] [--python-root path]",
    );
    return 0;
  }
  if (
    action !== "inventory" &&
    action !== "submodules-inventory" &&
    action !== "infra-config-import" &&
    action !== "infra-scripts-import" &&
    action !== "source-licenses-import" &&
    action !== "docs-import" &&
    action !== "docs-index" &&
    action !== "scripts-import"
  )
    throw new Error(
      "Usage: yolo ops consolidation <inventory|submodules-inventory|infra-config-import|infra-scripts-import|source-licenses-import|docs-import|docs-index|scripts-import> [--owner name] [options]",
    );
  const options = argsOf(rest);
  const ownerFilter = options.get("--owner");
  const upstreamsOnly = options.get("--upstreams-only") === "true";
  const sourceRoot = resolve(options.get("--source-root") ?? join(homedir(), "src"));
  const iecodeRoot = resolve(options.get("--iecode-root") ?? join(dirname(sourceRoot), "iecode"));
  const aphrodyRoot = resolve(options.get("--aphrody-root") ?? join(dirname(sourceRoot), "aphrody"));
  const pythonRoot = resolve(options.get("--python-root") ?? join(dirname(sourceRoot), "aphrody-py"));
  const output = join(aphrodyRoot, "docs/migration/source-map.json");
  const nestedOutput = join(aphrodyRoot, "docs/migration/nested-source-map.json");
  const pythonOutput = join(pythonRoot, "docs/migration/source-map.json");
  if (action === "docs-index") {
    if (ownerFilter) throw new Error("docs-index regenerates the complete map; --owner is unsupported");
    const report = JSON.parse(await readFile(output, "utf8")) as {
      entries: Entry[];
    };
    const entries = report.entries.filter(
      entry => entry.kind === "documentation" && (entry.importedTarget ?? entry.target)?.startsWith("docs/"),
    );
    const content = renderDocumentationIndex(entries, aphrodyRoot);
    const missingTargets = entries
      .map(entry => entry.importedTarget ?? entry.target!)
      .filter(destination => !existsSync(join(aphrodyRoot, destination)));
    const failure = await writeDocumentationIndex(aphrodyRoot, content);
    console.log(
      JSON.stringify(
        {
          index: "docs/migration/IMPORTED-DOCS-INDEX.md",
          sourceMap: "docs/migration/source-map.json",
          indexedDocuments: entries.length,
          missingTargets,
          failures: failure ? [failure] : [],
        },
        null,
        2,
      ),
    );
    return failure || missingTargets.length ? 1 : 0;
  }
  const upstreamManifest = JSON.parse(
    await readFile(join(aphrodyRoot, "tools/config/upstream-sources.json"), "utf8"),
  ) as {
    root?: string;
    sources?: Array<{ id: string; kind: string; license?: string }>;
  };
  const upstreamRoot = resolve(
    options.get("--upstreams-root") ?? resolve(aphrodyRoot, upstreamManifest.root ?? ".cache/upstream"),
  );
  if (action === "infra-config-import") {
    const result = await importInfraConfig(sourceRoot, aphrodyRoot);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === "infra-scripts-import") {
    const result = await importInfraScripts(sourceRoot, aphrodyRoot);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === "source-licenses-import") {
    const result = await importSourceLicenses(sourceRoot, aphrodyRoot);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === "scripts-import") {
    const report = JSON.parse(await readFile(output, "utf8")) as {
      entries: Entry[];
      roots: Array<{ key: string }>;
    };
    const sourceRoots = new Map<string, string>([
      ["src-root-docs", sourceRoot],
      ["iecode", iecodeRoot],
    ]);
    for (const root of report.roots)
      if (root.key.startsWith("upstream-"))
        sourceRoots.set(root.key, join(upstreamRoot, root.key.slice("upstream-".length)));
      else if (root.key !== "src-root-docs" && root.key !== "iecode")
        sourceRoots.set(root.key, join(sourceRoot, root.key));
    const index = [
      "<!-- Generated by yolo ops consolidation scripts-import. -->",
      "# Imported scripts",
      "",
      "Scripts retain their source-relative paths below category and owner. Relocated commands have not been qualified or executed.",
      "",
    ];
    const failures: string[] = [];
    let copied = 0;
    let identical = 0;
    let aliases = 0;
    let conflicts = 0;
    // oxlint-disable no-await-in-loop -- script import is stateful: each step reads targets written by earlier steps and updates shared counters and index order
    for (const entry of report.entries) {
      if (entry.kind !== "script" || (ownerFilter && !entry.source.startsWith(`${ownerFilter}/`))) continue;
      if (entry.duplicateOf) {
        aliases++;
        continue;
      }
      const planned = entry.target;
      if (!planned || !(planned.startsWith("scripts/") || planned.startsWith("../aphrody-py"))) continue;
      if (!entry.sha256) {
        failures.push(`no safe script hash: ${entry.source}`);
        continue;
      }
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase) {
        failures.push(`unknown source root: ${entry.source}`);
        continue;
      }
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      if (!existsSync(source)) {
        failures.push(`script source missing: ${entry.source}`);
        continue;
      }
      const sourceHash = createHash("sha256")
        .update(await readFile(source))
        .digest("hex");
      if (sourceHash !== entry.sha256) {
        failures.push(`script source changed after inventory: ${entry.source}`);
        continue;
      }
      const intoPython = planned.startsWith("../aphrody-py");
      const destinationRoot = intoPython ? pythonRoot : aphrodyRoot;
      let destination = intoPython ? planned.slice("../aphrody-py".length) : planned;
      let target = resolve(destinationRoot, destination);
      if (!inside(destinationRoot, target)) {
        failures.push(`script target escaped: ${planned}`);
        continue;
      }
      if (existsSync(target)) {
        const existingHash = createHash("sha256")
          .update(await readFile(target))
          .digest("hex");
        if (existingHash === sourceHash || existingHash === entry.importedSha256) {
          identical++;
          entry.importedSha256 = existingHash;
          entry.importedSourceSha256 = sourceHash;
        } else if (entry.importedSha256 === existingHash && entry.importedSourceSha256 !== sourceHash) {
          await copyFile(source, target);
          copied++;
          entry.importedSha256 = sourceHash;
          entry.importedSourceSha256 = sourceHash;
        } else {
          conflicts++;
          const owner = entry.source.slice(0, slash);
          const category = entry.category ?? "tools";
          destination = `${intoPython ? `tools/${category}/${owner}` : `scripts/${category}/${owner}`}/_source/${entry.source.slice(slash + 1)}`;
          target = resolve(destinationRoot, destination);
          if (existsSync(target)) {
            const fallbackHash = createHash("sha256")
              .update(await readFile(target))
              .digest("hex");
            if (fallbackHash === sourceHash) {
              identical++;
              entry.importedTarget = intoPython ? `../aphrody-py/${destination}` : destination;
              entry.importedSha256 = sourceHash;
              entry.importedSourceSha256 = sourceHash;
              continue;
            }
            destination = `${destination}.${sourceHash.slice(0, 12)}`;
            target = resolve(destinationRoot, destination);
          }
          entry.importedTarget = intoPython ? `../aphrody-py/${destination}` : destination;
          await mkdir(dirname(target), { recursive: true });
          await copyFile(source, target);
          copied++;
          entry.importedSha256 = sourceHash;
          entry.importedSourceSha256 = sourceHash;
        }
      } else {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
        copied++;
        entry.importedSha256 = sourceHash;
        entry.importedSourceSha256 = sourceHash;
      }
      index.push(
        `- \`${entry.category ?? "tools"}\` — \`${entry.source}\` → \`${entry.importedTarget ?? planned}\` (sha256 \`${sourceHash}\`)`,
      );
    }
    // oxlint-enable no-await-in-loop
    const indexPath = join(aphrodyRoot, "docs/migration/IMPORTED-SCRIPTS-INDEX.md");
    await mkdir(dirname(indexPath), { recursive: true });
    let indexContent = index;
    if (ownerFilter && existsSync(indexPath)) {
      const priorRows = (await readFile(indexPath, "utf8"))
        .split("\n")
        .filter(line => line.startsWith("- `") && !line.includes(`\`${ownerFilter}/`));
      indexContent = [...index.slice(0, 5), ...priorRows.concat(index.slice(5)).toSorted()];
    }
    await writeFile(indexPath, `${indexContent.join("\n")}\n`);
    await writeFile(output, `${JSON.stringify(report)}\n`);
    const result = {
      generatedAt: new Date().toISOString(),
      copied,
      identical,
      exactDuplicateAliases: aliases,
      conflicts,
      failures,
      indexedScripts: indexContent.length - 5,
      report: relative(aphrodyRoot, indexPath),
    };
    const importReport = join(aphrodyRoot, "docs/migration/script-import.json");
    await writeFile(importReport, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    return failures.length ? 1 : 0;
  }
  if (action === "docs-import") {
    const report = JSON.parse(await readFile(output, "utf8")) as {
      entries: Entry[];
      roots: Array<{ key: string }>;
    };
    const sourceRoots = new Map<string, string>([
      ["src-root-docs", sourceRoot],
      ["iecode", iecodeRoot],
    ]);
    for (const root of report.roots)
      if (root.key.startsWith("upstream-"))
        sourceRoots.set(root.key, join(upstreamRoot, root.key.slice("upstream-".length)));
      else if (root.key !== "src-root-docs" && root.key !== "iecode")
        sourceRoots.set(root.key, join(sourceRoot, root.key));
    let copied = 0;
    let identical = 0;
    let aliases = 0;
    let conflicts = 0;
    let removedGeneratedFallbacks = 0;
    let updatedImportedDocs = 0;
    const failures: string[] = [];
    const imported: Entry[] = [];
    const rewriteSources = new Set<string>();
    const protectedConflicts = new Set([
      "docs/reference/ai/CLI.md",
      "docs/products/ai/README.md",
      "docs/products/compat/README.md",
      "docs/products/os/README.md",
      "docs/products/ui/README.md",
      "docs/products/nie/README.md",
    ]);
    const isSelected = (entry: Entry) => {
      const rootKey = entry.source.slice(0, entry.source.indexOf("/"));
      return upstreamsOnly
        ? rootKey.startsWith("upstream-")
        : !ownerFilter || entry.source.startsWith(`${ownerFilter}/`);
    };
    // oxlint-disable no-await-in-loop -- fallback reconciliation mutates shared entries and removes files that later steps check
    for (const entry of report.entries) {
      if (
        entry.kind !== "documentation" ||
        !isSelected(entry) ||
        !entry.importedTarget?.includes("/_source/") ||
        !entry.target ||
        protectedConflicts.has(entry.target)
      )
        continue;
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase || !entry.sha256) continue;
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      const fallback = resolve(aphrodyRoot, entry.importedTarget);
      const preferred = resolve(aphrodyRoot, entry.target);
      if (
        !inside(aphrodyRoot, fallback) ||
        !inside(aphrodyRoot, preferred) ||
        !existsSync(source) ||
        !existsSync(fallback) ||
        !existsSync(preferred)
      )
        continue;
      const sourceHash = createHash("sha256")
        .update(await readFile(source))
        .digest("hex");
      if (sourceHash !== entry.sha256) {
        failures.push(`generated fallback kept because source changed: ${entry.source}`);
        continue;
      }
      const preferredHash = createHash("sha256")
        .update(await readFile(preferred))
        .digest("hex");
      if (preferredHash === sourceHash) {
        entry.importedSha256 = preferredHash;
        await unlink(fallback);
        delete entry.importedTarget;
        removedGeneratedFallbacks++;
      } else {
        const fallbackHash = createHash("sha256")
          .update(await readFile(fallback))
          .digest("hex");
        if (fallbackHash !== sourceHash && fallbackHash !== entry.importedSha256) {
          conflicts++;
          failures.push(`preserved edited imported fallback: ${entry.source}`);
          continue;
        }
        entry.importedSha256 = fallbackHash;
        entry.importedSourceSha256 = sourceHash;
      }
    }
    // oxlint-enable no-await-in-loop
    // oxlint-disable no-await-in-loop -- docs import is order-dependent: copies, conflict fallbacks and counters depend on earlier writes to the same targets
    for (const entry of report.entries) {
      if (entry.kind !== "documentation" || !isSelected(entry)) continue;
      if (entry.duplicateOf) {
        aliases++;
        continue;
      }
      if (!entry.target?.startsWith("docs/")) continue;
      if (!entry.sha256) {
        failures.push(`no safe import hash: ${entry.source}`);
        continue;
      }
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase) {
        failures.push(`unknown source root: ${entry.source}`);
        continue;
      }
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      let destination = entry.importedTarget ?? entry.target;
      let target = resolve(aphrodyRoot, destination);
      if (!inside(aphrodyRoot, target)) {
        failures.push(`target escaped destination: ${destination}`);
        continue;
      }
      if (!existsSync(source)) {
        failures.push(`source vanished after inventory; preserved mapping: ${entry.source}`);
        continue;
      }
      const sourceBytes = await readFile(source);
      const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
      if (actualHash !== entry.sha256) {
        failures.push(`source changed after inventory: ${entry.source}`);
        continue;
      }
      if (existsSync(target)) {
        const existingHash = createHash("sha256")
          .update(await readFile(target))
          .digest("hex");
        if (entry.importedSha256 === existingHash && entry.importedSourceSha256 !== actualHash) {
          await copyFile(source, target);
          entry.importedSha256 = actualHash;
          entry.importedSourceSha256 = actualHash;
          rewriteSources.add(entry.source);
          updatedImportedDocs++;
          continue;
        }
        if (entry.importedSha256 === existingHash) {
          entry.importedSourceSha256 = actualHash;
          identical++;
          continue;
        }
        if (existingHash === actualHash) {
          identical++;
          entry.importedSourceSha256 = actualHash;
          entry.importedSha256 = existingHash;
          rewriteSources.add(entry.source);
          continue;
        }
        if (entry.importedTarget || entry.importedSha256) {
          conflicts++;
          entry.importedSha256 = existingHash;
          continue;
        }
        conflicts++;
        const parts = entry.target.split("/");
        destination = `${parts.slice(0, 3).join("/")}/_source/${parts.slice(3).join("/")}`;
        target = resolve(aphrodyRoot, destination);
        if (existsSync(target)) {
          const fallbackHash = createHash("sha256")
            .update(await readFile(target))
            .digest("hex");
          if (fallbackHash === actualHash || fallbackHash === entry.importedSha256) {
            identical++;
            entry.importedTarget = destination;
            entry.importedSha256 = fallbackHash;
            if (fallbackHash === actualHash) rewriteSources.add(entry.source);
            continue;
          }
          destination = `${destination}.${actualHash.slice(0, 12)}`;
          target = resolve(aphrodyRoot, destination);
        }
        entry.importedTarget = destination;
      }
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      copied++;
      entry.importedSourceSha256 = actualHash;
      entry.importedSha256 = actualHash;
      rewriteSources.add(entry.source);
      imported.push(entry);
    }
    // oxlint-enable no-await-in-loop
    const docsByCategory = new Map<string, Entry[]>();
    const importedBySource = new Map<string, string>();
    for (const entry of report.entries) {
      const destination = entry.importedTarget ?? entry.target;
      if (entry.kind !== "documentation" || !destination?.startsWith("docs/")) continue;
      const category = destination.split("/")[1] ?? "reference";
      const group = docsByCategory.get(category) ?? [];
      group.push(entry);
      docsByCategory.set(category, group);
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (sourceBase) importedBySource.set(resolve(sourceBase, entry.source.slice(slash + 1)), destination);
    }
    for (const entry of report.entries) {
      if (entry.kind !== "documentation" || !entry.duplicateOf) continue;
      const canonicalTarget = report.entries.find(
        candidate => candidate.target === entry.duplicateOf || candidate.importedTarget === entry.duplicateOf,
      );
      const destination = canonicalTarget?.importedTarget ?? canonicalTarget?.target;
      if (!destination?.startsWith("docs/")) continue;
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (sourceBase) importedBySource.set(resolve(sourceBase, entry.source.slice(slash + 1)), destination);
    }
    // oxlint-disable no-await-in-loop -- later duplicates override earlier importedBySource mappings, so entries are processed in order
    for (const entry of report.entries) {
      if (entry.kind === "documentation" || entry.duplicateOf || !entry.sha256) continue;
      const destination = entry.importedTarget ?? entry.target;
      if (!destination || !/^(?:apps|crates|packages|scripts)\//.test(destination)) continue;
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase) continue;
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      const target = resolve(aphrodyRoot, destination);
      if (!target.startsWith(`${aphrodyRoot}/`) || !existsSync(source) || !existsSync(target)) continue;
      const sourceBytes = await readFile(source);
      if (createHash("sha256").update(sourceBytes).digest("hex") !== entry.sha256) continue;
      const targetBytes = await readFile(target);
      const targetHash = createHash("sha256").update(targetBytes).digest("hex");
      let matchesImport =
        targetHash === entry.sha256 ||
        (entry.importedSourceSha256 === entry.sha256 && entry.importedSha256 === targetHash);
      if (!matchesImport && entry.kind === "bun-manifest") {
        try {
          const sourceName = (JSON.parse(sourceBytes.toString()) as { name?: string }).name;
          const targetName = (JSON.parse(targetBytes.toString()) as { name?: string }).name;
          matchesImport = !!sourceName && sourceName === targetName;
        } catch {
          // A manifest without a matching package identity is not an imported file target.
        }
      }
      if (matchesImport) importedBySource.set(source, destination);
    }
    // oxlint-enable no-await-in-loop
    let rewrittenLinks = 0;
    const unresolvedLinks: string[] = [];
    // oxlint-disable no-await-in-loop -- link rewrites read and write target documents and share per-source replacement state and counters
    for (const entry of report.entries) {
      if (!isSelected(entry) || entry.kind !== "documentation" || entry.duplicateOf) continue;
      const destination = entry.importedTarget ?? entry.target;
      if (!destination?.startsWith("docs/") || !/\.(md|mdx)$/i.test(destination)) continue;
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase) continue;
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      const target = resolve(aphrodyRoot, destination);
      if (!existsSync(source) || !existsSync(target)) continue;
      const original = await readFile(source, "utf8");
      if (createHash("sha256").update(original).digest("hex") !== entry.sha256) continue;
      const linkReplacements = new Map<string, string>();
      const rewritten = original.replace(
        /(!?\[[^\]]*\]\()([^\s)]+)(\s+[^)]*\)|\))/g,
        (whole, before: string, rawUrl: string, after: string) => {
          const wrapped = rawUrl.startsWith("<") && rawUrl.endsWith(">");
          const url = wrapped ? rawUrl.slice(1, -1) : rawUrl;
          if (!url || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return whole;
          const splitAt = url.search(/[?#]/);
          const localPart = splitAt < 0 ? url : url.slice(0, splitAt);
          const suffix = splitAt < 0 ? "" : url.slice(splitAt);
          let decoded: string;
          try {
            decoded = decodeURIComponent(localPart);
          } catch {
            return whole;
          }
          const sourceTarget = importedBySource.get(resolve(dirname(source), decoded));
          if (!sourceTarget) {
            if (localPart) unresolvedLinks.push(`${entry.source}: ${url}`);
            return whole;
          }
          let relativeTarget = relative(dirname(target), resolve(aphrodyRoot, sourceTarget)).replaceAll("\\", "/");
          if (!relativeTarget.startsWith(".")) relativeTarget = `./${relativeTarget}`;
          rewrittenLinks++;
          const replacement = wrapped ? `<${relativeTarget}${suffix}>` : `${relativeTarget}${suffix}`;
          linkReplacements.set(rawUrl, replacement);
          return `${before}${replacement}${after}`;
        },
      );
      if (rewritten !== original) {
        const currentTarget = await readFile(target, "utf8");
        const currentTargetHash = createHash("sha256").update(currentTarget).digest("hex");
        if (currentTargetHash === entry.sha256 || currentTargetHash === entry.importedSha256) {
          const updatedTarget = currentTarget.replace(
            /(!?\[[^\]]*\]\()([^\s)]+)(\s+[^)]*\)|\))/g,
            (whole, before: string, rawUrl: string, after: string) => {
              const replacement = linkReplacements.get(rawUrl);
              return replacement ? `${before}${replacement}${after}` : whole;
            },
          );
          if (updatedTarget !== currentTarget) {
            await writeFile(target, updatedTarget);
            entry.importedSha256 = createHash("sha256").update(updatedTarget).digest("hex");
          }
        } else if (rewriteSources.has(entry.source)) {
          conflicts++;
          failures.push(`link rewrite preserved target edited outside importer: ${destination}`);
        }
      }
      entry.importedSourceSha256 = entry.sha256;
    }
    // oxlint-enable no-await-in-loop
    const indexFailure = await writeDocumentationIndex(
      aphrodyRoot,
      renderDocumentationIndex([...docsByCategory.values()].flat(), aphrodyRoot),
    );
    if (indexFailure) failures.push(indexFailure);
    const preservedTargetConflicts = report.entries.filter(
      entry =>
        isSelected(entry) &&
        entry.kind === "documentation" &&
        entry.importedTarget?.includes("/_source/") &&
        !!entry.target,
    ).length;
    const result = {
      generatedAt: new Date().toISOString(),
      sourceMap: relative(aphrodyRoot, output),
      target: aphrodyRoot,
      copied,
      updatedImportedDocs,
      identical,
      exactDuplicateAliases: aliases,
      removedGeneratedFallbacks,
      indexedDocuments: docsByCategory.size ? [...docsByCategory.values()].reduce((n, docs) => n + docs.length, 0) : 0,
      conflicts: Math.max(conflicts, preservedTargetConflicts),
      preservedTargetConflicts,
      failures,
      importedPaths: imported.length,
      mappedLocalMarkdownLinks: rewrittenLinks,
      unresolvedLocalMarkdownLinkCount: unresolvedLinks.length,
      unresolvedLocalMarkdownLinkSample: unresolvedLinks.slice(0, 200),
      linkRewriting:
        "relative Markdown links to imported documents and verified local files rewritten; anchors preserved; unresolved attachments and reference-style links are not rewritten",
    };
    const importReport = join(aphrodyRoot, "docs/migration/document-import.json");
    await writeFile(output, `${JSON.stringify(report)}\n`, { flag: "w" });
    await writeFile(importReport, `${JSON.stringify(result, null, 2)}\n`, {
      flag: "w",
    });
    console.log(JSON.stringify({ ...result, report: relative(aphrodyRoot, importReport) }, null, 2));
    return failures.length > 0 ? 1 : 0;
  }
  const allSpecs: RootSpec[] = [
    {
      key: "src-root-docs",
      path: sourceRoot,
      owner: "workspace",
      mode: "extract",
      rootDocsOnly: true,
    },
    ...[
      ["aphrody-ai", "ai", "extract"],
      ["aphrody-compat", "compat", "extract"],
      ["aphrody-contracts", "contracts", "extract"],
      ["aphrody-infra", "infra", "orchestrator-split"],
      ["aphrody-koharu", "koharu", "extract"],
      ["aphrody-native", "native", "extract"],
      ["aphrody-os", "os", "extract"],
      ["aphrody-shell", "shell", "extract"],
      ["aphrody-ui", "ui", "extract"],
      ["aphrody-web", "web", "extract"],
      ["nie", "nie", "extract"],
      ["fut", "fut", "extract"],
      ["rg", "rg", "deferred"],
      ["bun", "bun", "upstream-pinned"],
      ["oxc", "oxc", "upstream-pinned"],
      ["bevy", "bevy", "classify"],
      ["dust", "dust", "classify"],
      ["emu.nintendo.wii.gecko", "emu", "classify"],
    ].map(([key, owner, mode]) => ({
      key: key!,
      path: join(sourceRoot, key!),
      owner: owner!,
      mode: mode as Mode,
    })),
    { key: "iecode", path: iecodeRoot, owner: "iecode", mode: "extract" },
    ...(upstreamManifest.sources ?? []).flatMap(source => {
      if (source.kind !== "git") return [];
      const sourcePath = join(upstreamRoot, source.id);
      const rootLicense = ["LICENSE", "LICENSE.md", "COPYING", "NOTICE"].some(file =>
        existsSync(join(sourcePath, file)),
      );
      const license =
        source.license ?? (rootLicense ? "See root license file; SPDX expression not normalized" : "unverified");
      return [
        {
          key: `upstream-${source.id}`,
          path: sourcePath,
          owner: source.id,
          mode:
            source.id === "openfox" && !source.license && !rootLicense
              ? ("classify" as const)
              : ("upstream-pinned" as const),
          rootDocsOnly: true,
          markdownDocsAnywhere: true,
          ...(source.id === "litellm" ? { excludedPrefixes: ["enterprise/"] } : {}),
          license,
          sourcePath: relative(aphrodyRoot, sourcePath).replaceAll("\\", "/"),
        },
      ];
    }),
  ];
  const specs = allSpecs.filter(spec =>
    upstreamsOnly
      ? spec.key.startsWith("upstream-")
      : !ownerFilter || spec.key === ownerFilter || spec.owner === ownerFilter,
  );
  if (ownerFilter && !specs.length) throw new Error(`unknown consolidation owner: ${ownerFilter}`);
  if (action === "submodules-inventory") {
    const result = inventorySubmodules(specs);
    const nested = await inventoryNestedFiles(result.submodules, specs);
    const reportPath = join(aphrodyRoot, "docs/migration/submodule-inventory.json");
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(nestedOutput, `${JSON.stringify(nested)}\n`);
    if (existsSync(output)) {
      const sourceMap = JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
      sourceMap.submoduleInventory = relative(aphrodyRoot, reportPath);
      sourceMap.submoduleInventoryObservedAt = result.observedAt;
      sourceMap.submodules = result.submodules;
      sourceMap.missingRoots = result.missingRoots;
      sourceMap.nestedSourceMap = relative(aphrodyRoot, nestedOutput);
      sourceMap.nestedSourceMapObservedAt = nested.observedAt;
      sourceMap.nestedSourceTotals = nested.totals;
      await writeFile(output, `${JSON.stringify(sourceMap)}\n`);
    }
    console.log(
      JSON.stringify(
        {
          report: relative(aphrodyRoot, reportPath),
          nestedSourceMap: relative(aphrodyRoot, nestedOutput),
          nestedTotals: nested.totals,
          counts: result.counts,
          missingRoots: result.missingRoots,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const snapshots = [];
  // oxlint-disable no-await-in-loop -- roots are snapshotted one at a time to bound git and hashing I/O; report order follows spec order
  for (const spec of specs) {
    if (!existsSync(join(spec.path, ".git"))) {
      console.error(`skip missing checkout: ${spec.key} (${spec.path})`);
      continue;
    }
    snapshots.push(await rootSnapshot(spec));
  }
  // oxlint-enable no-await-in-loop
  const entries = snapshots.flatMap(snapshot => snapshot.entries);
  let previousReport: Record<string, unknown> | undefined;
  let previousEntries: Entry[] = [];
  let previousRoots: Array<Record<string, unknown>> = [];
  if (existsSync(output)) {
    try {
      previousReport = JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
      previousEntries = (previousReport.entries as Entry[] | undefined) ?? [];
      previousRoots = (previousReport.roots as Array<Record<string, unknown>> | undefined) ?? [];
      const priorBySource = new Map(previousEntries.map(entry => [entry.source, entry]));
      for (const entry of entries) {
        const prior = priorBySource.get(entry.source);
        if (!prior || prior.target !== entry.target || !entry.target) continue;
        if (prior.importedTarget) entry.importedTarget = prior.importedTarget;
        if (prior.importedSha256) entry.importedSha256 = prior.importedSha256;
        if (prior.importedSourceSha256 || prior.sha256)
          entry.importedSourceSha256 = prior.importedSourceSha256 ?? prior.sha256;
      }
    } catch (error) {
      console.error(`could not preserve prior import state: ${String(error)}`);
    }
  }
  const seen = new Map<string, string>();
  const seenScripts = new Map<string, { target: string; python: boolean }>();
  const replacedRootKeys = new Set(snapshots.map(snapshot => snapshot.root.key));
  if (upstreamsOnly) {
    for (const entry of previousEntries) {
      if (
        entry.kind !== "documentation" ||
        !entry.sha256 ||
        !entry.target ||
        [...replacedRootKeys].some(key => entry.source.startsWith(`${key}/`))
      )
        continue;
      seen.set(entry.sha256, entry.importedTarget ?? entry.target);
    }
  }
  for (const entry of entries) {
    if (!entry.sha256 || !entry.target) continue;
    if (entry.kind === "documentation") {
      const first = seen.get(entry.sha256);
      if (first) {
        entry.duplicateOf = first;
        entry.target = null;
      } else seen.set(entry.sha256, entry.target);
    } else if (
      entry.kind === "script" &&
      (entry.target.startsWith("scripts/") || entry.target.startsWith("../aphrody-py"))
    ) {
      const python = entry.target.startsWith("../aphrody-py");
      const first = seenScripts.get(entry.sha256);
      if (first && first.python === python) {
        entry.duplicateOf = first.target;
        entry.target = null;
      } else seenScripts.set(entry.sha256, { target: entry.target, python });
    }
  }
  const submoduleInventory = upstreamsOnly ? undefined : inventorySubmodules(specs);
  const nestedSourceMap = upstreamsOnly ? undefined : await inventoryNestedFiles(submoduleInventory!.submodules, specs);
  if (nestedSourceMap) await writeFile(nestedOutput, `${JSON.stringify(nestedSourceMap)}\n`);
  const retainedEntries = upstreamsOnly
    ? previousEntries.filter(entry => ![...replacedRootKeys].some(key => entry.source.startsWith(`${key}/`)))
    : [];
  const allEntries = upstreamsOnly ? [...retainedEntries, ...entries] : entries;
  const retainedRoots = upstreamsOnly ? previousRoots.filter(root => !replacedRootKeys.has(String(root.key))) : [];
  const roots = upstreamsOnly
    ? [...retainedRoots, ...snapshots.map(snapshot => snapshot.root as unknown as Record<string, unknown>)]
    : snapshots.map(snapshot => snapshot.root as unknown as Record<string, unknown>);
  const report = {
    ...previousReport,
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    scope:
      "Inventory only. Source checkouts are unchanged. Exact document duplicates are identified by SHA-256; semantic overlap is not auto-merged. Git histories remain in their source repositories until an explicit import gate.",
    targets: {
      aphrody: aphrodyRoot,
      python: pythonRoot,
    },
    roots,
    totals: {
      roots: roots.length,
      paths: allEntries.length,
      byKind: Object.fromEntries(
        [...new Set(allEntries.map(entry => entry.kind))]
          .toSorted()
          .map(kind => [kind, allEntries.filter(entry => entry.kind === kind).length]),
      ),
    },
    ...(submoduleInventory
      ? {
          submodules: submoduleInventory.submodules,
          missingRoots: submoduleInventory.missingRoots,
          submoduleInventoryObservedAt: submoduleInventory.observedAt,
        }
      : {}),
    nestedSourceMap: relative(aphrodyRoot, nestedOutput),
    ...(nestedSourceMap
      ? {
          nestedSourceMapObservedAt: nestedSourceMap.observedAt,
          nestedSourceTotals: nestedSourceMap.totals,
        }
      : {}),
    entries: allEntries,
  };
  await mkdir(dirname(output), { recursive: true });
  await mkdir(dirname(pythonOutput), { recursive: true });
  await writeFile(output, `${JSON.stringify(report)}\n`, { flag: "w" });
  const pythonEntries = entries.filter(
    entry => entry.kind === "python-manifest" || /\.py(i)?$|\.ipynb$/i.test(entry.source),
  );
  const pythonReport = {
    ...report,
    entries: pythonEntries,
    totals: { roots: snapshots.length, paths: pythonEntries.length },
  };
  if (!upstreamsOnly)
    await writeFile(pythonOutput, `${JSON.stringify(pythonReport)}\n`, {
      flag: "w",
    });
  console.log(
    JSON.stringify(
      {
        output: relative(aphrodyRoot, output),
        pythonOutput: relative(pythonRoot, pythonOutput),
        totals: report.totals,
        roots: report.roots.map(root => ({
          key: root.key,
          policy: root.policy,
          head: root.head,
          dirty: root.dirty,
          paths: root.trackedAndUntrackedPathCount,
        })),
      },
      null,
      2,
    ),
  );
  return 0;
}

if (import.meta.main) process.exit(await runConsolidation(process.argv.slice(2)));
