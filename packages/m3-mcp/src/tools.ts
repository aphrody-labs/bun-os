// SPDX-License-Identifier: Apache-2.0
// The M3 design tool table. It is hosted by the single Aphrody MCP server (`aphrody-mcp`) through
// `tool-host.ts` (`list` / `call`); this package no longer speaks MCP itself.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Target } from "@aphrody/m3-os-themes";
import {
  listPackages,
  packageDir,
  listTemplates,
  lookupTokens,
  researchLinks,
  searchDocs,
  validateTokens,
} from "./catalog";

// The theme generators (16 ms with m3-tokens) and the symbol catalogue are loaded by the tools that use them, not at
// start-up: listing the tools never waits for them.
const osThemes = () => import("@aphrody/m3-os-themes");
const symbols = () => import("@aphrody/material-design-icons");

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface M3Tool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run(args: never, signal?: AbortSignal): Promise<ToolResult> | ToolResult;
}

const text = (t: string): ToolResult => ({
  content: [{ type: "text", text: t || "(no result)" }],
});

const themeInput = {
  seed: z.string().describe("Seed colour #rrggbb"),
  target: z.enum(["windows", "gnome", "cosmic", "chromium", "all"]).default("all"),
  name: z.string().default("Aphrody"),
};

const limit = (fallback: number) => z.number().int().min(1).max(500).default(fallback);

function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  run: (args: z.infer<z.ZodObject<S>>, signal?: AbortSignal) => Promise<ToolResult> | ToolResult,
): M3Tool {
  return { name, description, shape, run: run as M3Tool["run"] };
}

export const M3_TOOLS: M3Tool[] = [
  tool("m3_list_packages", "List the aphrody-m3 workspace packages with versions.", {}, () =>
    text(listPackages().join("\n")),
  ),
  tool(
    "m3_token_lookup",
    "Look up Material 3 design tokens (--md-*) by name or value fragment in m3-tokens.",
    { query: z.string(), limit: limit(50) },
    ({ query, limit: maximum }) =>
      text(
        lookupTokens(query, maximum)
          .map(t => `${t.name}: ${t.value}  [${t.source}]`)
          .join("\n"),
      ),
  ),
  tool(
    "m3_token_validate",
    "Validate that every --md-* custom property in a CSS snippet or name list exists in m3-tokens.",
    { css: z.string() },
    ({ css }) => {
      const r = validateTokens(css);
      return text(
        `checked ${r.checked.length}, unknown ${r.unknown.length}${r.unknown.length ? `\n${r.unknown.join("\n")}` : ""}`,
      );
    },
  ),
  tool(
    "m3_os_themes_list",
    "List the files m3-os-themes would generate for a seed colour and target (nothing is written).",
    themeInput,
    async ({ seed, target, name }) => {
      const { TARGETS, generate } = await osThemes();
      const targets: readonly Target[] = target === "all" ? TARGETS : [target];
      return text(
        generate({ name, seed, mode: "auto" }, targets)
          .map(f => f.path)
          .join("\n"),
      );
    },
  ),
  tool(
    "m3_os_themes_generate",
    "Return the text content of one generated OS theme file (path from m3_os_themes_list). Never writes to disk or the system.",
    { ...themeInput, path: z.string() },
    async ({ seed, target, name, path }) => {
      const { TARGETS, generate } = await osThemes();
      const targets: readonly Target[] = target === "all" ? TARGETS : [target];
      const file = generate({ name, seed, mode: "auto" }, targets).find(f => f.path === path);
      if (!file) return text(`unknown path ${path}`);
      return text(typeof file.content === "string" ? file.content : `(binary, ${file.content.length} bytes)`);
    },
  ),
  tool(
    "m3_docs_search",
    "Search the canonical native Web design-sync corpus (AI-ready Markdown, specs and asset JSON), followed by local M3 guides; returns source path:line hits.",
    { query: z.string(), limit: limit(20) },
    ({ query, limit: maximum }) => text(searchDocs(query, maximum).join("\n")),
  ),
  tool(
    "m3_research_links",
    "List the canonical native Web design-sync corpus files and source URLs; fall back to the dated local research index when no corpus has been acquired.",
    {},
    () => {
      const r = researchLinks();
      return text(`${r.files.join("\n")}\n\n${r.links.join("\n")}`);
    },
  ),
  tool("m3_list_templates", "List UI templates, examples and Tauri example apps.", {}, () =>
    text(listTemplates().join("\n")),
  ),
  tool(
    "m3_symbol_svg",
    "Return path and SVG source of a Material Symbol from the forked catalogue.",
    {
      name: z.string().regex(/^[a-z0-9_]+$/),
      style: z.enum(["outlined", "rounded", "sharp"]).default("outlined"),
      weight: z
        .union([
          z.literal(100),
          z.literal(200),
          z.literal(300),
          z.literal(400),
          z.literal(500),
          z.literal(600),
          z.literal(700),
        ])
        .default(400),
      filled: z.boolean().default(false),
    },
    async ({ name, style, weight, filled }) => {
      const { symbolSvgPath } = await symbols();
      const p = symbolSvgPath(name, style, weight, filled);
      return existsSync(p) ? text(`${p}\n${readFileSync(p, "utf8")}`) : text(`not found: ${p}`);
    },
  ),
  tool(
    "m3_symbol_search",
    "Search the full Material Symbols catalogue (4150 names) by substring; returns matching symbol names.",
    { query: z.string(), limit: limit(50) },
    async ({ query, limit: maximum }) => {
      const { searchSymbols, symbolNames } = await symbols();
      const hits = searchSymbols(query, maximum);
      return text(hits.length > 0 ? hits.join("\n") : `no match among ${symbolNames().length} symbols`);
    },
  ),
  tool(
    "m3_svg_to_ico",
    "Generate Tauri desktop icons (ico, icns, png) from a symbol name or SVG file.",
    {
      input: z.string(),
      out: z.string().default("src-tauri/icons"),
      style: z.enum(["outlined", "rounded", "sharp"]).default("outlined"),
      fill: z.string().optional(),
    },
    async ({ input, out, style, fill }, signal) => {
      const icons = packageDir("@aphrody/material-design-icons");
      if (!icons) return { ...text("@aphrody/material-design-icons is not installed"), isError: true };
      const args = [process.execPath, join(icons, "scripts/svg-to-ico.ts"), input, "--out", out, "--style", style];
      if (fill) args.push("--fill", fill);
      const { code, stdout, stderr } = await runBun(args, signal);
      return {
        ...text(`${code}\n${stdout}${stderr}`),
        ...(code !== 0 ? { isError: true } : {}),
      };
    },
  ),
  tool(
    "m3_design_search",
    "Search the bundled UI/UX Pro Max catalogs of @aphrody/m3-design (styles, colours, typography, UX guidelines, charts, icons, stacks including m3) with calibrated BM25; omit domain and stack to auto-detect the domain.",
    {
      query: z.string().min(1),
      domain: z
        .string()
        .optional()
        .describe(
          "style, color, chart, landing, product, ux, typography, google-fonts, icons, gsap, react, web, brand",
        ),
      stack: z.string().optional().describe("Stack guidelines, e.g. m3, react, nextjs, html-tailwind"),
      limit: z.number().int().min(1).max(20).default(3),
      json: z.boolean().default(false),
    },
    ({ query, domain, stack, limit: maximum, json }, signal) => {
      const args = ["search", query, "-n", String(maximum)];
      if (domain) args.push("--domain", domain);
      if (stack) args.push("--stack", stack);
      if (json) args.push("--json");
      return designCli(args, signal);
    },
  ),
  tool(
    "m3_design_system",
    "Generate a complete UI/UX Pro Max design-system recommendation (pattern, style, colours, typography, effects, anti-patterns) for a product query. Read-only: never persists files.",
    {
      query: z.string().min(1).describe("Product type, industry and style keywords"),
      projectName: z.string().optional(),
      format: z.enum(["ascii", "markdown"]).default("markdown"),
      brand: z.string().optional().describe("Brand theme id from brands.csv"),
    },
    ({ query, projectName, format, brand }, signal) => {
      const args = ["system", query, "-f", format];
      if (projectName) args.push("-p", projectName);
      if (brand) args.push("--brand", brand);
      return designCli(args, signal);
    },
  ),
  tool(
    "m3_contrast",
    "WCAG 2.2 contrast check of a design-token file's text/background pairs (Replica tokens.json or W3C tokens), or of one fg/bg hex pair. 'exit 1' on the first line means a pair fails AA.",
    {
      tokens: z.string().optional().describe("Path of a tokens.json file"),
      fg: z.string().optional().describe("Foreground #rrggbb when no token file is given"),
      bg: z.string().optional().describe("Background #rrggbb when no token file is given"),
      json: z.boolean().default(false),
    },
    ({ tokens, fg, bg, json }, signal) => {
      if (!tokens && !(fg && bg)) return { ...text("pass tokens, or fg and bg"), isError: true };
      const args = ["contrast", ...(tokens ? [tokens] : [fg!, bg!])];
      if (json) args.push("--json");
      return designCli(args, signal, [0, 1]);
    },
  ),
  tool(
    "m3_parity",
    "Feature parity score of an app clone from a Replica feature matrix CSV (weighted must/should/could) with the missing list in build order; optionally folds in m3_imgdiff --json layout scores.",
    {
      matrix: z.string().describe("Path of the features.csv matrix"),
      visual: z.array(z.string()).default([]).describe("Paths of imgdiff --json outputs"),
      markdown: z.boolean().default(false),
      json: z.boolean().default(false),
    },
    ({ matrix, visual, markdown, json }, signal) => {
      const args = ["parity", matrix];
      if (visual.length > 0) args.push("--visual", ...visual);
      if (markdown) args.push("--markdown");
      if (json) args.push("--json");
      return designCli(args, signal, [0, 1]);
    },
  ),
  tool(
    "m3_imgdiff",
    "Compare a screenshot of an original app with the same screen of its clone: layout mode ignores colour (rebrand-safe), pixel mode checks regressions. Writes a diff PNG only when out is given.",
    {
      original: z.string().describe("PNG of the original screen"),
      clone: z.string().describe("PNG of the clone screen"),
      mode: z.enum(["layout", "pixel"]).default("layout"),
      out: z.string().optional().describe("Path of a diff PNG to write"),
      json: z.boolean().default(false),
    },
    ({ original, clone, mode, out, json }, signal) => {
      const args = ["imgdiff", original, clone, "--mode", mode];
      if (out) args.push("--out", out);
      if (json) args.push("--json");
      return designCli(args, signal, [0, 1]);
    },
  ),
];

/** Run one bounded Bun child and collect its output. */
async function runBun(cmd: string[], signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn({
    windowsHide: true,
    cmd,
    stdout: "pipe",
    stderr: "pipe",
    signal,
    timeout: 30_000,
    killSignal: "SIGKILL",
    maxBuffer: 4 * 1024 * 1024,
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

/** The m3-design CLI of the installed `@aphrody/m3-design` dependency (the workspace link in a checkout). */
function designCliPath(): string | undefined {
  const dir = packageDir("@aphrody/m3-design");
  return dir ? join(dir, "src/cli.ts") : undefined;
}

/** Run an m3-design command. Exit codes in `ok` are results (1 = a gate failed); others are errors. */
async function designCli(args: string[], signal?: AbortSignal, ok: readonly number[] = [0]): Promise<ToolResult> {
  const cli = designCliPath();
  if (!cli) return { ...text("@aphrody/m3-design is not installed"), isError: true };
  const { code, stdout, stderr } = await runBun([process.execPath, cli, ...args], signal);
  const body = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
  return {
    ...text(ok.length > 1 ? `exit ${code}\n${body}` : body),
    ...(ok.includes(code) ? {} : { isError: true }),
  };
}

/** JSON Schema definitions in the shape every MCP client expects from `tools/list`. */
export function listM3Tools(): {
  name: string;
  description: string;
  inputSchema: unknown;
}[] {
  return M3_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(z.object(t.shape)),
  }));
}

/** Validate the arguments with the tool's schema, then run it; failures are `isError` results. */
export async function callM3Tool(name: string, args: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const found = M3_TOOLS.find(t => t.name === name);
  if (!found) return { ...text(`unknown tool ${name}`), isError: true };
  const parsed = z.object(found.shape).safeParse(args ?? {});
  if (!parsed.success) return { ...text(parsed.error.message), isError: true };
  try {
    return await found.run(parsed.data as never, signal);
  } catch (error) {
    return {
      ...text(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}
