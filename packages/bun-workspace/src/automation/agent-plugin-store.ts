// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { markdownLinkDestinations } from "./docs-links.ts";

export type Json = Record<string, unknown>;
export type Plugin = {
  name: string;
  version: string;
  description: string;
  path: string;
  manifest: Json;
};
export type Change = { path: string; action: string; detail?: string };

export function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value as Json;
}
export function readJson(path: string): Json {
  return object(JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")));
}
export function validName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}
export function inside(root: string, path: string): boolean {
  const local = relative(resolve(root), resolve(path));
  return !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`);
}
export function containedPath(root: string, path: string): string {
  const full = resolve(root, path);
  if (!inside(root, full)) throw new Error(`Path escapes plugin root: ${path}`);
  let ancestor = full;
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
  if (!inside(realpathSync(root), realpathSync(ancestor))) throw new Error(`Symlink escapes plugin root: ${path}`);
  return full;
}
export function files(root: string): string[] {
  if (!existsSync(root)) return [];
  if (lstatSync(root).isSymbolicLink()) return [];
  const found: string[] = [];
  const visit = (path: string): void => {
    for (const e of readdirSync(path, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", "node_modules", "target", ".cache"].includes(e.name) || e.isSymbolicLink()) continue;
      const full = join(path, e.name);
      if (e.isDirectory()) visit(full);
      else if (e.isFile()) found.push(full);
    }
  };
  visit(root);
  return found;
}
function releaseVersion(value: unknown): number[] | undefined {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value) ? value.split(".").map(Number) : undefined;
}
export function plugins(store: string): Plugin[] {
  if (!existsSync(store)) return [];
  if (lstatSync(store).isSymbolicLink()) throw new Error("Plugin store must not be a symlink");
  const found: Plugin[] = [];
  for (const e of readdirSync(store, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;
    const path = join(store, e.name);
    const manifestPath = ["plugin.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]
      .map(p => join(path, p))
      .find(existsSync);
    if (!manifestPath) continue;
    let manifest = readJson(manifestPath);
    // Provider fusion can advance before the compact root manifest is regenerated.
    // Preserve the newest matching identity rather than downgrading its overlays.
    for (const overlay of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
      const candidatePath = join(path, overlay);
      if (!existsSync(candidatePath)) continue;
      const candidate = readJson(candidatePath);
      const current = releaseVersion(manifest.version);
      const next = releaseVersion(candidate.version);
      if (candidate.name === manifest.name && current && next) {
        const difference = next.findIndex((part, index) => part !== current[index]);
        if (difference >= 0 && next[difference]! > current[difference]!) manifest = candidate;
      }
    }
    const name = String(manifest.name ?? "");
    if (!validName(name) || name !== e.name) throw new Error(`Plugin name must match its directory: ${path}`);
    if (found.some(p => p.name === name)) throw new Error(`Duplicate plugin name: ${name}`);
    found.push({
      name,
      version: String(manifest.version ?? "1.0.0"),
      description: String(manifest.description ?? name),
      path,
      manifest,
    });
  }
  return found;
}
export function writeChanged(path: string, text: string, apply: boolean, changes: Change[]): void {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return;
  changes.push({ path, action: "write" });
  if (apply) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}
export function writeJson(path: string, value: unknown, apply: boolean, changes: Change[]): void {
  if (existsSync(path)) {
    try {
      if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) === JSON.stringify(value)) return;
    } catch {
      /* A malformed generated document is replaced by its canonical representation. */
    }
  }
  writeChanged(path, `${JSON.stringify(value, null, 2)}\n`, apply, changes);
}
export function skillFrontmatter(path: string): Json {
  const match = readFileSync(path, "utf8")
    .replace(/^\uFEFF/, "")
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${path}`);
  return object(Bun.YAML.parse(match[1]!));
}

/** Convert provider overlays from one portable manifest; never generate installations. */
export function prepareStore(store: string, marketplace: string, apply: boolean): Change[] {
  const changes: Change[] = [];
  const entries = plugins(store);
  for (const plugin of entries) {
    const { name, version, description, path, manifest } = plugin;
    for (const target of [
      ".claude-plugin",
      ".codex-plugin",
      ".mcp.json",
      "mcp_config.json",
      "mcp.json",
      "hooks.json",
      "plugin.json",
    ])
      containedPath(path, target);
    const common: Json = {
      name,
      version,
      description,
      author: { name: "aphrody-dev", email: "contact@aphrody.com" },
    };
    for (const key of ["author", "license", "keywords", "homepage", "repository"])
      if (manifest[key]) common[key] = manifest[key];
    if (typeof common.author === "string") {
      const match = common.author.match(/^(.*?)\s*<([^>]+)>$/);
      common.author = match ? { name: match[1]!.trim(), email: match[2] } : { name: common.author };
    }
    const claude: Json = { ...common };
    const codex: Json = {
      ...common,
      interface: {
        displayName: name,
        shortDescription: description.slice(0, 120),
        developerName: "Aphrody",
      },
    };
    if (existsSync(join(path, "skills"))) {
      claude.skills = "./skills/";
      codex.skills = "./skills/";
    }
    if (existsSync(join(path, ".mcp.json")) || existsSync(join(path, "mcp_config.json"))) {
      const mcp = readJson(join(path, existsSync(join(path, ".mcp.json")) ? ".mcp.json" : "mcp_config.json"));
      const servers = object(mcp.mcpServers ?? {});
      if (name === "aphrody" && servers.aphrody) servers.aphrody = { type: "stdio", command: "aphrody-mcp", args: [] };
      for (const filename of [".mcp.json", "mcp_config.json", "mcp.json"])
        writeJson(join(path, filename), { mcpServers: servers }, apply, changes);
      claude.mcpServers = "./.mcp.json";
      codex.mcpServers = "./.mcp.json";
    }
    // Claude discovers default component directories. Preserve explicit non-default declarations.
    for (const overlay of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
      const old = existsSync(join(path, overlay)) ? readJson(join(path, overlay)) : {};
      const generated = overlay.startsWith(".claude") ? claude : codex;
      const target = { ...old, ...generated };
      if (generated.interface)
        target.interface = {
          ...object(old.interface ?? {}),
          ...object(generated.interface),
        };
      writeJson(join(path, overlay), target, apply, changes);
    }
    writeJson(join(path, "plugin.json"), { ...manifest, name, version, description }, apply, changes);
    const hookPath = join(path, "hooks/hooks.json");
    if (name === "aphrody" && existsSync(hookPath) && existsSync(join(path, "hooks/scripts/session-context.ts"))) {
      const source = readJson(hookPath);
      const events = object(source.hooks ?? {});
      let changed = false;
      for (const event of ["SessionStart", "PermissionRequest"]) {
        if (!Array.isArray(events[event])) continue;
        events[event] = (events[event] as Json[]).flatMap(group => {
          if (!Array.isArray(group.hooks)) return [group];
          const hooks = (group.hooks as Json[]).flatMap(hook => {
            if (hook.command === 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh"') {
              changed = true;
              return [
                {
                  ...hook,
                  command:
                    'bun --no-install --no-env-file run "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-context.ts"',
                },
              ];
            }
            if (hook.command === 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/permission-allow.sh"') {
              // The provider's permission policy remains authoritative on every host.
              changed = true;
              return [];
            }
            return [hook];
          });
          return hooks.length ? [{ ...group, hooks }] : [];
        });
        if (!(events[event] as unknown[]).length) delete events[event];
      }
      if (changed) {
        writeJson(hookPath, { ...source, hooks: events }, apply, changes);
        const portable = JSON.stringify({
          [name]: { enabled: true, ...events },
        }).replaceAll("${CLAUDE_PLUGIN_ROOT}", path.replaceAll("\\", "/"));
        writeJson(join(path, "hooks.json"), JSON.parse(portable), apply, changes);
      }
    }
    const nested = join(path, ".claude-plugin/marketplace.json");
    if (existsSync(nested)) {
      changes.push({ path: nested, action: "remove-obsolete-marketplace" });
      if (apply) rmSync(nested);
    }
    if (!existsSync(join(path, "hooks.json")) && existsSync(join(path, "hooks/hooks.json"))) {
      const hooks = readJson(join(path, "hooks/hooks.json"));
      const serialized = JSON.stringify(
        { [name]: { enabled: true, ...object(hooks.hooks ?? {}) } },
        null,
        2,
      ).replaceAll("${CLAUDE_PLUGIN_ROOT}", path.replaceAll("\\", "/"));
      writeChanged(join(path, "hooks.json"), `${serialized}\n`, apply, changes);
    }
  }
  for (const target of [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"])
    containedPath(store, target);
  writeJson(
    join(store, ".agents/plugins/marketplace.json"),
    {
      name: marketplace,
      interface: { displayName: "Aphrody user plugins" },
      plugins: entries.map(p => ({
        name: p.name,
        source: { source: "local", path: `./${p.name}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Developer Tools",
      })),
    },
    apply,
    changes,
  );
  writeJson(
    join(store, ".claude-plugin/marketplace.json"),
    {
      name: marketplace,
      owner: { name: "aphrody-dev", email: "contact@aphrody.com" },
      description: "Private canonical Aphrody plugins managed by aphrody-workspace",
      plugins: entries.map(p => ({
        name: p.name,
        source: `./${p.name}`,
        version: p.version,
        description: p.description,
      })),
    },
    apply,
    changes,
  );
  return changes;
}

export type Problem = { path: string; message: string };
export function validateStore(store: string, names: string[] = []): Problem[] {
  const problems: Problem[] = [];
  for (const plugin of plugins(store).filter(p => !names.length || names.includes(p.name))) {
    for (const path of files(plugin.path)) {
      try {
        if (path.endsWith(".json")) {
          const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
          if (Array.isArray(parsed) || !parsed || typeof parsed !== "object") continue;
          const value = object(parsed);
          if (basename(path) === "plugin.json") {
            if (value.name !== plugin.name) throw new Error("Overlay plugin name differs from root");
            if (value.version !== plugin.version) throw new Error("Overlay version differs from root");
            for (const key of ["skills", "mcpServers", "hooks", "commands", "agents"]) {
              for (const ref of Array.isArray(value[key]) ? value[key] : [value[key]]) {
                if (typeof ref !== "string") continue;
                if (!ref.startsWith("./")) throw new Error(`${key} must be a ./ relative path`);
                if (!existsSync(containedPath(plugin.path, ref))) throw new Error(`Missing ${key}: ${ref}`);
              }
            }
          }
          if (value.mcpServers && typeof value.mcpServers === "object") {
            for (const [name, entry] of Object.entries(object(value.mcpServers))) {
              if (!validName(name)) throw new Error(`Invalid MCP name: ${name}`);
              const server = object(entry);
              if (typeof server.command !== "string" && typeof server.url !== "string")
                throw new Error(`MCP ${name} needs command or URL`);
              if (server.command && (String(server.command).includes("${") || !Array.isArray(server.args)))
                throw new Error(`MCP ${name}: command must be executable and args an array`);
            }
          }
        }
        if (basename(path) === "SKILL.md") {
          const fm = skillFrontmatter(path);
          if (!validName(String(fm.name ?? "")) || fm.name !== basename(dirname(path)))
            throw new Error("Skill name must be kebab-case and match directory");
          if (typeof fm.description !== "string" || !fm.description.trim())
            throw new Error("Skill description is required");
        }
        if (path.endsWith(".md"))
          for (const link of markdownLinkDestinations(markdownProse(readFileSync(path, "utf8")))) {
            if (!link || link.startsWith("#") || /^(?:[a-z][\w+.-]*:|\/)/i.test(link) || link.includes("${")) continue;
            const target = decodeURIComponent(link.split(/[?#]/)[0]!);
            if (!existsSync(resolve(dirname(path), target)))
              problems.push({ path, message: `Missing local link: ${link}` });
          }
      } catch (e) {
        problems.push({
          path,
          message: String(e instanceof Error ? e.message : e),
        });
      }
    }
  }
  return problems;
}

/** Only proven relocation prefixes are rewritten; historical reports stay unchanged. */
export function fixReferences(store: string, apply: boolean, extraRoots: string[] = []): Change[] {
  const changes: Change[] = [];
  const reportPath = join(store, "relocation-2026-10-03.json");
  const mappings: [string, string][] = [];
  if (existsSync(reportPath))
    for (const move of readJson(reportPath).moves as Json[]) {
      if (move.kind === "canonical-plugin") mappings.push([String(move.source), String(move.destination)]);
    }
  const home = dirname(store);
  for (const p of plugins(store)) {
    mappings.push([`${home}/.gemini/config/plugins/${p.name}`, p.path], [`${home}/.gemini/plugins/${p.name}`, p.path]);
  }
  const absoluteMappings = mappings.slice();
  for (const [before, after] of absoluteMappings) {
    if (before.startsWith(`${home}/`)) mappings.push([`~/${before.slice(home.length + 1)}`, after]);
  }
  mappings.sort((a, b) => b[0].length - a[0].length);
  const paths = [...plugins(store).flatMap(p => files(p.path)), ...extraRoots.flatMap(files)];
  for (const path of new Set(paths)) {
    if (
      !/\.(?:md|json|toml|sh|ps1|ts|js|yaml|yml)$/.test(path) ||
      /(?:CHANGELOG|relocation-|cleanup-|\/history\/)/.test(path)
    )
      continue;
    let text = readFileSync(path, "utf8");
    for (const [before, after] of mappings) {
      const escaped = before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`${escaped}(?![a-zA-Z0-9_-])`, "g"), () => after);
    }
    if (path.endsWith(".md")) {
      const plugin = plugins(store).find(p => inside(p.path, path));
      const original = plugin ? mappings.find(([, target]) => target === plugin.path) : undefined;
      if (original)
        for (const link of markdownLinkDestinations(markdownProse(text))) {
          if (!link || /^(?:[a-z][\w+.-]*:|[/#])/i.test(link)) continue;
          const clean = link.split(/[?#]/)[0]!;
          let decoded: string;
          try {
            decoded = decodeURIComponent(clean);
          } catch {
            continue;
          }
          if (existsSync(resolve(dirname(path), decoded))) continue;
          const oldFile = join(original[0], relative(plugin!.path, path));
          let target = resolve(dirname(oldFile), decoded);
          for (const [before, after] of mappings)
            if (inside(before, target)) target = join(after, relative(before, target));
          // Some old skills already had one too few ../ segments. Canonical docs remain in the workspace.
          const doc = decoded.match(/(?:^|\/)docs\/(.+)$/);
          if (!existsSync(target) && doc) target = join(home, "aphrody/docs", doc[1]!);
          if (existsSync(target)) text = text.replaceAll(link, target + link.slice(clean.length));
        }
    }
    if (basename(path) === "SKILL.md" || (path.includes(`${sep}agents${sep}`) && path.endsWith(".md"))) {
      // Quote plain YAML descriptions containing colon-space without altering the body.
      text = text.replace(/^(description:\s*)([^\r\n]*: [^\r\n]*)$/m, (all, prefix: string, value: string) => {
        return /^["'|>]/.test(value.trim()) ? all : prefix + JSON.stringify(value);
      });
    }
    if (path.endsWith("hooks.json"))
      text = text.replace(/bash \$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g, 'bash \\"${CLAUDE_PLUGIN_ROOT}/$1\\"');
    writeChanged(path, text, apply, changes);
  }
  // _shared was rejected by the existing Rust skill validator; retain its resources under a valid name.
  const old = join(store, "aphrody/skills/_shared"),
    next = join(store, "aphrody/skills/shared-winclean");
  if (existsSync(old)) {
    if (existsSync(next)) throw new Error("Both old and new WinClean shared skill directories exist");
    changes.push({ path: old, action: "rename", detail: next });
    if (apply) {
      renameSync(old, next);
      const skill = join(next, "SKILL.md");
      writeFileSync(skill, readFileSync(skill, "utf8").replace(/^name: _shared$/m, "name: shared-winclean"));
    }
    for (const path of plugins(store).flatMap(p => files(p.path)))
      if (path.endsWith(".md"))
        writeChanged(
          path,
          readFileSync(path, "utf8").replaceAll("skills/_shared/", "skills/shared-winclean/"),
          apply,
          changes,
        );
  }
  const dangling = join(store, "google-gemini/skills/google-style-guide/google-style-guide");
  if (existsSync(dirname(dangling)))
    try {
      if (lstatSync(dangling).isSymbolicLink() && !existsSync(dangling)) {
        changes.push({ path: dangling, action: "remove-dangling-link" });
        if (apply) rmSync(dangling);
      }
    } catch (e) {
      if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e;
    }
  return changes;
}

function markdownProse(text: string): string {
  return text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "").replace(/(`+)[^`\n]*?\1/g, "");
}

const hash = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
/** Drop detached caches, preserving every unique plugin file once before removal. */
export function cleanStore(
  store: string,
  apply: boolean,
): {
  changes: Change[];
  bytes: number;
  recovered: number;
  aliases: { source: string; canonical: string; sha256: string }[];
} {
  const changes: Change[] = [];
  const aliases: { source: string; canonical: string; sha256: string }[] = [];
  let bytes = 0,
    recovered = 0;
  const known = new Map(
    [...plugins(store).flatMap(p => files(p.path)), ...files(join(store, "_recovered"))].map(path => [
      hash(path),
      path,
    ]),
  );
  const copies = join(store, "_copies");
  for (const path of files(copies)) {
    if (path.endsWith("/relocation-2026-10-03.json")) continue;
    // Full marketplace clones contain unrelated repository files. Only detached plugin trees are source assets.
    const local = relative(copies, path).split(sep).join("/");
    if (!/(?:^|\/)plugins\/(?!marketplace\.json)|\/cache\/aphrody-ai\//.test(local)) continue;
    const digest = hash(path);
    const canonical = known.get(digest);
    if (canonical) {
      aliases.push({ source: path, canonical, sha256: digest });
      continue;
    }
    recovered++;
    let output = join(store, "_recovered", local);
    if (existsSync(output)) output += `.${digest}`;
    known.set(digest, output);
    changes.push({ path: output, action: "recover", detail: digest });
    if (apply) {
      mkdirSync(dirname(output), { recursive: true });
      copyFileSync(path, output);
    }
  }
  for (const name of ["_copies", "_registrations"]) {
    const path = join(store, name);
    if (!existsSync(path)) continue;
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing linked cleanup directory: ${path}`);
    for (const file of files(path)) bytes += statSync(file).size;
    changes.push({ path, action: "remove-cache" });
    if (apply) rmSync(path, { recursive: true });
  }
  return { changes, bytes, recovered, aliases };
}

export async function storeLock<T>(store: string, apply: boolean, run: () => Promise<T>): Promise<T> {
  if (!apply) return run();
  const state = join(store, "_state");
  mkdirSync(state, { recursive: true });
  const lock = join(state, "mutation.lock");
  try {
    mkdirSync(lock);
  } catch {
    throw new Error(`Plugin store is locked: ${lock}`);
  }
  try {
    return await run();
  } finally {
    rmSync(lock, { recursive: true });
  }
}
