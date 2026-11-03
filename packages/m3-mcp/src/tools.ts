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
  /** MCP structured result (an object); the text content carries the same value as JSON. */
  structuredContent?: Record<string, unknown>;
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

/** A structured result: the object as structuredContent and as JSON text for clients that read text only. */
const structured = (value: object, isError = false): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value as Record<string, unknown>,
  ...(isError ? { isError: true } : {}),
});

// 3Dviz Pro Max (@aphrody/viz3d): loaded by the viz3d tools only, so listing never reads the catalog.
const viz3d = () => import("@aphrody/viz3d");
const KNOWLEDGE_KIND = z.enum([
  "object-archetype",
  "material-profile",
  "physical-behavior",
  "tool-adapter",
  "inspection-pattern",
  "validation-profile",
  "style-profile",
  "theme-profile",
  "presentation-profile",
  "composition-profile",
  "motion-profile",
  "interaction-profile",
  "reasoning-rule",
  "domain-validation",
  "geometry-profile",
  "lighting-profile",
  "output-profile",
  "blueprint",
]);
const DELIVERY = z.enum(["web-desktop", "web-mobile", "offline-still", "presentation"]);

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
  tool(
    "viz3d_search",
    "Search the 3Dviz Pro Max 3D design catalog of @aphrody/viz3d (223 recipes, 440 knowledge records: looks, lighting, materials, physical behaviour, reasoning rules, 22 kit blueprints) with weighted-field BM25. Lexical candidates, not a design: resolve the chosen IDs with viz3d_resolve.",
    {
      query: z.string().min(1).describe("Plain words: subject and the unresolved decision"),
      collection: z.enum(["all", "recipes", "knowledge"]).default("all"),
      kind: KNOWLEDGE_KIND.optional().describe("Narrow knowledge to one kind, e.g. lighting-profile"),
      direction: z.string().optional().describe("Direction ID, e.g. linear-algebra"),
      exclude_ids: z.array(z.string()).default([]),
      algorithm: z.enum(["weighted-field-bm25", "overlap"]).optional(),
      limit: z.number().int().min(1).max(20).default(5),
    },
    async ({ query, collection, kind, direction, exclude_ids, algorithm, limit: maximum }) => {
      const { loadCatalog, search } = await viz3d();
      const { manifest, records } = loadCatalog(undefined, collection);
      return structured(
        search(query, manifest, records, {
          limit: maximum,
          collection,
          kind: kind ?? null,
          direction: direction ?? null,
          excludeIds: exclude_ids,
          algorithm: algorithm ?? null,
        }),
      );
    },
  ),
  tool(
    "viz3d_resolve",
    "Return the complete 3Dviz Pro Max records for the given IDs with their cited sources, the bundle hash and, for kit blueprints, the module, parameters, sockets and an import snippet. related adds one hop of linked records.",
    { ids: z.array(z.string().min(1)).min(1), related: z.boolean().default(false) },
    async ({ ids, related }) => {
      const { loadCatalog, resolveRecords } = await viz3d();
      const { manifest, records, sources } = loadCatalog(undefined, "all");
      return structured(resolveRecords(ids, manifest, records, sources, related));
    },
  ),
  tool(
    "viz3d_design_context",
    "Gather 3D design context for an objective: recipe candidates, chosen knowledge kinds, resolved records and sources; with blueprints, the kit blueprints compatible with the chosen looks; with host_ceiling, a per-blueprint quality brief (tier and reason) for the delivery target and hero IDs.",
    {
      objective: z.string().min(1),
      kinds: z.array(KNOWLEDGE_KIND).default([]),
      direction: z.string().optional(),
      exclude_ids: z.array(z.string()).default([]),
      blueprints: z.boolean().default(false),
      looks: z.array(z.string()).default([]).describe("Style, theme or lighting record IDs (with blueprints)"),
      host_ceiling: z
        .enum(["T0", "T1", "T2", "T3", "T4"])
        .optional()
        .describe("quality_ceiling of viz3d_host_probe; adds the quality brief (with blueprints)"),
      delivery: DELIVERY.default("web-desktop"),
      heroes: z.array(z.string()).default([]).describe("Blueprint IDs built at the host ceiling"),
    },
    async args => {
      const { gather, loadCatalog } = await viz3d();
      return structured(
        gather(args.objective, loadCatalog(undefined, "all"), {
          kinds: args.kinds,
          direction: args.direction ?? null,
          excludeIds: args.exclude_ids,
          blueprints: args.blueprints,
          looks: args.looks,
          host: args.host_ceiling ? { quality_ceiling: args.host_ceiling, quality_ceiling_reason: "given by the caller" } : null,
          delivery: args.delivery,
          heroes: args.heroes,
        }),
      );
    },
  ),
  tool(
    "viz3d_blueprints",
    "List the 3Dviz Pro Max kit blueprints (Three.js modules and glTF heroes) compatible with the given look IDs, or all 22 when looks is empty: asset, footprint, poly budget, sockets, detail ladder and default parameters.",
    { looks: z.array(z.string()).default([]) },
    async ({ looks }) => {
      const { blueprintsFor, loadCatalog } = await viz3d();
      const { records } = loadCatalog(undefined, "knowledge");
      return structured({ looks, blueprints: blueprintsFor(records, looks) });
    },
  ),
  tool(
    "viz3d_host_probe",
    "Probe this host for the 3D pipeline: OS, CPU, memory, GPU, a runnable Blender (version, >= 4.2 LTS), the CDP browser used for capture, and the shipped-kit quality ceiling (T3 with Blender, else T2). Read-only.",
    {},
    async () => structured(await (await viz3d()).probeHost()),
  ),
  tool(
    "viz3d_validate",
    "Validate the 3Dviz Pro Max dataset: manifest contract, record layout, JSON Schema 2020-12 of every recipe, knowledge record, source and direction, relationships, source references and the catalog-summary hashes.",
    {},
    async () => {
      const report = (await viz3d()).validateDataset();
      return structured(report, !report.ok);
    },
  ),
  tool(
    "viz3d_capture",
    "Serve a 3D scene on loopback and capture it through headless Chrome, Chromium or Edge (CDP): a kit blueprint (kit, tier, params) on Three.js WebGPU with WebGL2 fallback, a built scene directory (dir), or a running local URL. Writes PNGs and capture-log.json to out and returns the log: views, per-view usability, motion check, console errors, renderer and scene backend.",
    {
      kit: z.string().optional().describe("Blueprint record ID, e.g. knowledge.blueprint-timber-cottage"),
      tier: z.enum(["T1", "T2", "T3"]).optional(),
      params: z.record(z.string(), z.unknown()).optional(),
      dir: z.string().optional().describe("Built scene directory with index.html"),
      url: z.string().url().optional(),
      out: z.string().default("captures"),
      views: z.array(z.string()).default([]),
      all_views: z.boolean().default(true),
      clicks: z.array(z.string()).default([]),
      width: z.number().int().min(64).max(4096).default(1280),
      height: z.number().int().min(64).max(4096).default(720),
      motion_check_ms: z.number().int().min(0).max(30_000).default(0),
      ready_flag: z.string().regex(/^(none|[A-Za-z_$][\w$]*)$/).default("__sceneReady"),
      gpu: z.boolean().default(false),
      timeout_s: z.number().int().min(1).max(170).default(60),
    },
    async args => {
      const { capture, parseCaptureArgs } = await viz3d();
      const argv: string[] = ["--out", args.out, "--width", String(args.width), "--height", String(args.height)];
      argv.push("--timeout-s", String(args.timeout_s), "--ready-flag", args.ready_flag);
      if (args.kit) argv.push("--kit", args.kit);
      if (args.tier) argv.push("--tier", args.tier);
      if (args.params) argv.push("--params", JSON.stringify(args.params));
      if (args.dir) argv.push("--dir", args.dir);
      if (args.url) argv.push("--url", args.url);
      for (const view of args.views) argv.push("--view", view);
      if (args.all_views) argv.push("--all-views");
      for (const selector of args.clicks) argv.push("--click", selector);
      if (args.motion_check_ms) argv.push("--motion-check", String(args.motion_check_ms));
      if (args.gpu) argv.push("--gpu");
      const result = await capture(parseCaptureArgs(argv)!);
      return structured({ status: result.status, message: result.message, log: result.log }, result.status !== 0);
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
