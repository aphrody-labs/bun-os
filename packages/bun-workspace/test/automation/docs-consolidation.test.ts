// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ALL_SCOPE,
  UI_SCOPE,
  applyPathMap,
  applyPlan,
  buildConsolidationReport,
  buildLegacyPathMap,
  buildMentionPattern,
  classifyTopic,
  deriveStatus,
  describeDocument,
  inScope,
  isNoticeFile,
  matchHubPatterns,
  normalizedTokens,
  pathNormalizedSha,
  planOwnerDuplicates,
  pointerStub,
  recordInSourceMap,
  refreshHub,
  relativeDestination,
  retainDocumentationCopy,
  resolveLocalLink,
  rewriteMarkdown,
  scanLinkSites,
  scanScope,
  sha256Of,
  shingleSimilarity,
  titleOf,
  verifyReport,
  type DocEntry,
  type Plan,
  type ScanResult,
  type SourceMapFile,
} from "../../src/automation/docs-consolidation.ts";
import { markdownLinkDestinations } from "../../src/automation/docs-links.ts";
import { findDocumentOverlaps } from "../../src/automation/docs-overlaps.ts";

const FENCE = "```";
const SAMPLE = [
  "# Title",
  '[plain](../a/b.md) and [anchor](./c.md#intro "A title") and [wrapped](<../d e.md?x=1#y>)',
  "![image](img/p.png) [escaped](../Guide\\(draft\\).md) [site](/docs/route) [web](https://example.com/x.md)",
  "[ref]: ../e.md",
  FENCE,
  "[code](../never.md)",
  FENCE,
  "Inline `[code](../never2.md)` stays.",
  "",
].join("\n");

test("link sites carry offsets and agree with the shared destination grammar", () => {
  const sites = scanLinkSites(SAMPLE);
  expect(sites.map(site => site.dest)).toEqual(
    markdownLinkDestinations(SAMPLE.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "")),
  );
  for (const site of sites) expect(SAMPLE.slice(site.start, site.end)).toBe(site.raw);
  expect(sites.some(site => site.dest.includes("never"))).toBe(false);
});

test("local link resolution ignores external, site and anchor-only destinations", () => {
  expect(resolveLocalLink("docs/a/b.md", "../c/d.md#x")).toBe("docs/c/d.md");
  expect(resolveLocalLink("docs/a/b.md", "./Guide%20(1).md")).toBe("docs/a/Guide (1).md");
  expect(resolveLocalLink("docs/a/b.md", "https://x.dev/y.md")).toBeNull();
  expect(resolveLocalLink("docs/a/b.md", "/docs/route")).toBeNull();
  expect(resolveLocalLink("docs/a/b.md", "#top")).toBeNull();
  expect(resolveLocalLink("docs/a/b.md", "mailto:a@b.c")).toBeNull();
  expect(resolveLocalLink("a.md", "../../outside.md")).toBeNull();
});

test("relative destinations keep anchors, query strings and the ./ style", () => {
  expect(relativeDestination("docs/x/y.md", "docs/m3/z.md", "./z.md#top")).toBe("../m3/z.md#top");
  expect(relativeDestination("docs/m3/y.md", "docs/m3/z.md", "./z.md")).toBe("./z.md");
  expect(relativeDestination("docs/m3/y.md", "docs/m3/a b (1).md", "a.md")).toBe("a%20b%20%281%29.md");
});

test("markdown rewriting re-points links, definitions and literal paths but not code", () => {
  const moved = new Map([["docs/a/old.md", "docs/b/new.md"]]);
  const finalOf = (path: string) => moved.get(path) ?? path;
  const pattern = buildMentionPattern(moved.keys());
  const content = [
    "[l](./old.md#sec) [other](./keep.md)",
    "[ref]: ./old.md",
    "Path `docs/a/old.md` and docs/a/old.mdx stay distinct.",
    "```",
    "[no](./old.md)",
    "```",
  ].join("\n");
  const result = rewriteMarkdown(content, "docs/a/host.md", "docs/a/host.md", finalOf, pattern, finalOf);
  expect(result.content).toContain("[l](../b/new.md#sec)");
  expect(result.content).toContain("[other](./keep.md)");
  expect(result.content).toContain("[ref]: ../b/new.md");
  expect(result.content).toContain("`docs/b/new.md`");
  expect(result.content).toContain("docs/a/old.mdx");
  expect(result.content).toContain("[no](./old.md)");
  expect(result.links).toBe(2);
  expect(result.mentions).toBe(1);
});

test("a moved file keeps its own relative links valid", () => {
  const result = rewriteMarkdown(
    "[x](../c/target.md) [self](./old.md)",
    "docs/a/old.md",
    "docs/b/new.md",
    movedTarget,
    null,
    movedTarget,
  );
  expect(result.content).toBe("[x](../c/target.md) [self](./new.md)");
});

test("path-normalized hashing ignores relocated paths but not wording", () => {
  const before = "See [m3](../../crates/aphrody-m3-tokens/src/a.rs) and `crates/aphrody-render` here.";
  const after = "See [m3](../../../crates/ui/m3-tokens/src/a.rs) and `crates/ui/render` here.";
  expect(pathNormalizedSha(before)).toBe(pathNormalizedSha(after));
  expect(pathNormalizedSha(before)).not.toBe(pathNormalizedSha("See different words entirely."));
});

test("shingle similarity separates translations from copies", () => {
  const a = tokens("the quick brown fox jumps over the lazy dog every single morning");
  const b = tokens("the quick brown fox jumps over the lazy dog every single evening");
  const { jaccard, containment } = shingleSimilarity(a, b);
  expect(jaccard).toBeGreaterThan(0.5);
  expect(containment).toBeGreaterThanOrEqual(jaccard);
  expect(shingleSimilarity(new Set(), b)).toEqual({
    jaccard: 0,
    containment: 0,
  });
});

test("topic classification follows the path before the content", () => {
  expect(classifyTopic("docs/reference/ui/drive/docs/core/api.mdx")).toBe("spaceui");
  expect(classifyTopic("docs/reference/ui/tauri/plugins.md")).toBe("tauri");
  expect(classifyTopic("docs/reference/ui/WASM/wgpu-webgpu.md")).toBe("gpu-render");
  expect(classifyTopic("docs/architecture/ui/design/M3-RENDER.md")).toBe("gpu-render");
  expect(classifyTopic("packages/ui/material-web/docs/design/google-design-llms.txt")).toBe("google-design");
  expect(classifyTopic("docs/architecture/ui/design/M3-ICONS.md")).toBe("icons-fonts");
  expect(classifyTopic("docs/architecture/ui/design/aphrody-m3-tokens.md")).toBe("design-tokens");
  expect(classifyTopic("docs/architecture/ui/design/M3-FRAMEWORK.md")).toBe("m3-spec");
  expect(classifyTopic("docs/plans/ui/design/M3-PLAN.md")).toBe("m3-spec");
  expect(classifyTopic("docs/plans/ui/BACKEND-INTEGRATION-PLAN.md")).toBe("plans");
  expect(classifyTopic("docs/rg/notes.md", "tauri tauri tauri wgpu")).toBe("tauri");
  expect(classifyTopic("docs/rg/notes.md", "nothing relevant")).toBe("other");
});

test("scope selection honours exclusions and the mention threshold", () => {
  expect(inScope("docs/architecture/ui/x.md", "", UI_SCOPE)).toBe("path");
  expect(inScope("packages/ui/m3/README.md", "", UI_SCOPE)).toBe("owner");
  expect(inScope("docs/reference/os/x.md", "tauri tauri tauri tauri tauri", UI_SCOPE)).toBe("mention");
  expect(inScope("docs/reference/os/x.md", "tauri once", UI_SCOPE)).toBeNull();
  expect(inScope("docs/reference/upstream-bun/x.md", "wgpu ".repeat(9), UI_SCOPE)).toBeNull();
  expect(inScope("docs/migration/x.md", "wgpu ".repeat(9), UI_SCOPE)).toBeNull();
  expect(inScope("PLAN.md", "wgpu ".repeat(9), UI_SCOPE)).toBeNull();
});

test("status derivation distinguishes pointers, notices, legacy and dated evidence", () => {
  const base = { imported: false, generated: false, notice: false };
  expect(
    deriveStatus({
      ...base,
      path: "a.md",
      text: pointerStub("a.md", "b/c.md"),
    }),
  ).toBe("pointer");
  expect(deriveStatus({ ...base, path: "x/OFL.txt", text: "SIL", notice: true })).toBe("notice");
  expect(deriveStatus({ ...base, path: "x/ref.md", text: "x", generated: true })).toBe("generated");
  expect(
    deriveStatus({
      ...base,
      path: "x/tauri-2.0.md",
      text: "# Tauri 2.0 guide",
    }),
  ).toBe("legacy");
  expect(deriveStatus({ ...base, path: "x/audit-2026-09-30.md", text: "# Audit" })).toBe("historical");
  expect(deriveStatus({ ...base, path: "x/y.md", text: "# Y", imported: true })).toBe("imported");
  expect(deriveStatus({ ...base, path: "x/y.md", text: "# Y" })).toBe("canonical");
  expect(isNoticeFile("a/b/RobotoFlex-OFL.txt")).toBe(true);
  expect(isNoticeFile("a/b/LICENSE-NOTICE.txt")).toBe(true);
  expect(isNoticeFile("a/b/README.md")).toBe(false);
});

test("titles and descriptions come from the document text", () => {
  expect(titleOf("<!-- x -->\n# The `m3` framework\n\nBody.", "f")).toBe("The m3 framework");
  expect(titleOf('---\ntitle: "Accueil"\n---\n# Other', "f")).toBe("Accueil");
  expect(titleOf("", "fallback")).toBe("fallback");
  expect(describeDocument("# T\n\n| a | b |\n\nRust owns the [tokens](x.md). Second sentence.\n")).toBe(
    "Rust owns the tokens.",
  );
  expect(describeDocument("# Only a heading\n")).toBe("");
});

test("hub blocks are regenerated between markers and left alone otherwise", () => {
  const paths = ["docs/x/m3/A.md", "docs/x/m3/B.md", "docs/x/m3/README.md", "docs/x/gpu/C.md"];
  expect(matchHubPatterns("docs/x/m3", ["*.md", "!README.md"], paths)).toEqual(["docs/x/m3/A.md", "docs/x/m3/B.md"]);
  expect(matchHubPatterns("docs/x/m3", ["/docs/x/gpu/*.md"], paths)).toEqual(["docs/x/gpu/C.md"]);
  expect(matchHubPatterns("a", ["**/b.md"], ["a/c/d/b.md", "a/b.md", "a/c/x.md"])).toEqual(["a/b.md", "a/c/d/b.md"]);
  const hub = 'Intro\n<!-- docs-hub:begin include="*.md;!README.md" -->\nstale\n<!-- docs-hub:end -->\nOutro';
  const rows = (spec: { patterns: string[] }) =>
    matchHubPatterns("docs/x/m3", spec.patterns, paths).map(path => ({
      path,
      title: path.split("/").pop() ?? path,
      description: "d",
      status: "canonical" as const,
      date: "2026-10-01",
    }));
  const refreshed = refreshHub("docs/x/m3/README.md", hub, rows);
  expect(refreshed).toContain("| [A.md](A.md) | d | canonical | 2026-10-01 |");
  expect(refreshed).toContain("Intro");
  expect(refreshed).toContain("Outro");
  expect(refreshed).not.toContain("stale");
  expect(refreshHub("docs/x/m3/README.md", refreshed ?? "", rows)).toBeNull();
  expect(() => refreshHub("h.md", '<!-- docs-hub:begin include="*.md" -->', rows)).toThrow("not closed");
});

test("keyword overlap pairs are found above the threshold only", () => {
  const same = "alphabet gamma-ray deltas epsilon zeta-wave kappa-ray sigma-point";
  const overlaps = findDocumentOverlaps(
    [
      { file: "a.md", text: same },
      { file: "b.md", text: `${same} extra-word` },
      { file: "c.md", text: "completely unrelated vocabulary tokens here" },
    ],
    0.45,
  );
  expect(overlaps.map(overlap => [overlap.left, overlap.right])).toEqual([["a.md", "b.md"]]);
});

test("source map records removals as aliases and moves as imported targets", () => {
  const map: SourceMapFile = {
    entries: [
      {
        source: "ui/a.md",
        kind: "documentation",
        target: "docs/products/ui/a.md",
      },
      {
        source: "ui/b.md",
        kind: "documentation",
        target: "docs/architecture/ui/design/b.md",
        importedSha256: "old",
      },
      { source: "ui/c.md", kind: "documentation", target: "docs/x/c.md" },
      { source: "ui/s.ts", kind: "script", target: "scripts/s.ts" },
    ],
  };
  const updated = recordInSourceMap(
    map,
    [{ path: "docs/products/ui/a.md", canonical: "packages/ui/a/README.md" }],
    [
      {
        path: "docs/architecture/ui/design/b.md",
        to: "docs/architecture/ui/m3/b.md",
        sha256: "new",
      },
    ],
    "test-report",
  );
  expect(updated).toBe(2);
  expect(map.entries[0]).toMatchObject({
    target: null,
    duplicateOf: "packages/ui/a/README.md",
  });
  expect(map.entries[0]?.targetReason).toContain("docs/products/ui/a.md removed");
  expect(map.entries[1]).toMatchObject({
    importedTarget: "docs/architecture/ui/m3/b.md",
    importedSha256: "new",
  });
  expect(map.entries[2]?.target).toBe("docs/x/c.md");
});

function entry(partial: Partial<DocEntry> & Pick<DocEntry, "path" | "sha256">): DocEntry {
  return {
    bytes: 100,
    title: "",
    domain: "",
    category: "",
    ownerKind: partial.path.startsWith("docs/") ? "docs" : "package",
    topic: "other",
    tags: [],
    scopeReason: "path",
    lastGitDate: null,
    untracked: false,
    modified: false,
    status: "canonical",
    generated: false,
    imported: false,
    licensed: false,
    upstream: false,
    outbound: [],
    unresolvedOutbound: [],
    inbound: [],
    ...partial,
  };
}

test("owner duplicates: docs copies are planned for removal against tracked owners only", () => {
  const entries = [
    entry({
      path: "docs/products/ui/packages/m3-motion/README.md",
      sha256: "h1",
    }),
    entry({ path: "packages/ui/m3-motion/README.md", sha256: "h1" }),
    entry({ path: "docs/reference/ui/fonts/OFL.txt", sha256: "h2" }),
    entry({ path: "packages/ui/m3-fonts/OFL.txt", sha256: "h2" }),
    entry({ path: "docs/reference/ui/x.md", sha256: "h3" }),
    entry({ path: "packages/ui/assets/x.md", sha256: "h3", untracked: true }),
    entry({ path: "docs/reference/ui/y.md", sha256: "h4" }),
    entry({
      path: "tools/config/ai/plugins/aphrody/y.md",
      sha256: "h4",
      ownerKind: "config",
    }),
  ];
  const scan: ScanResult = {
    scope: "ui",
    nearThreshold: 0.8,
    entries,
    exactClusters: ["h1", "h2", "h3", "h4"].map(sha256 => ({
      sha256,
      bytes: 100,
      paths: entries.filter(item => item.sha256 === sha256).map(item => item.path),
    })),
    nearPairs: [],
    byTopic: {},
    unresolvedOutbound: 0,
  };
  const plan = planOwnerDuplicates(scan, [/^packages\/ui\//], path => (isNoticeFile(path) ? "notice" : null));
  expect(plan.actions.map(action => [action.action, action.path, action.canonical])).toEqual([
    ["remove-duplicate", "docs/products/ui/packages/m3-motion/README.md", "packages/ui/m3-motion/README.md"],
    ["retain", "docs/reference/ui/fonts/OFL.txt", "packages/ui/m3-fonts/OFL.txt"],
  ]);
});

test("owner duplicates: path-only differences are removed, diverged copies go to review", () => {
  const entries = [
    entry({
      path: "docs/products/ui/crates/aphrody-svg/README.md",
      sha256: "a1",
    }),
    entry({ path: "crates/ui/svg/README.md", sha256: "a2" }),
    entry({
      path: "docs/products/ui/crates/aphrody-app/README.md",
      sha256: "b1",
    }),
    entry({ path: "crates/ui/app/README.md", sha256: "b2" }),
    entry({
      path: "docs/reference/ui/packages/m3-ai/CHANGELOG.md",
      sha256: "c1",
    }),
    entry({ path: "packages/ui/m3-forms/CHANGELOG.md", sha256: "c2" }),
    entry({
      path: "docs/architecture/ui/packages/m3-design/README.md",
      sha256: "d1",
    }),
    entry({
      path: "packages/ui/m3-design/README.md",
      sha256: "d2",
      modified: true,
    }),
  ];
  const scan: ScanResult = {
    scope: "ui",
    nearThreshold: 0.8,
    entries,
    exactClusters: [],
    nearPairs: [
      pair("crates/ui/svg/README.md", "docs/products/ui/crates/aphrody-svg/README.md", "equal-modulo-paths"),
      pair("crates/ui/app/README.md", "docs/products/ui/crates/aphrody-app/README.md", "translation-or-variant"),
      pair("docs/reference/ui/packages/m3-ai/CHANGELOG.md", "packages/ui/m3-forms/CHANGELOG.md", "equal-modulo-paths"),
      pair(
        "docs/architecture/ui/packages/m3-design/README.md",
        "packages/ui/m3-design/README.md",
        "equal-modulo-paths",
      ),
    ],
    byTopic: {},
    unresolvedOutbound: 0,
  };
  const plan = planOwnerDuplicates(scan, [/^(packages|crates)\/ui\//], () => null);
  expect(plan.actions.map(action => [action.path, action.canonical, action.equivalence])).toEqual([
    ["docs/products/ui/crates/aphrody-svg/README.md", "crates/ui/svg/README.md", "equal-modulo-paths"],
  ]);
  expect(plan.review.map(item => [item.path, item.canonical])).toEqual([
    ["docs/products/ui/crates/aphrody-app/README.md", "crates/ui/app/README.md"],
  ]);
});

const phase = (id: string, equivalence: "identical" | "equal-modulo-paths") => ({
  schemaVersion: 1 as const,
  generatedAt: "t",
  tool: "t",
  dryRun: false,
  scope: "ui",
  root: "/r",
  actions: [
    {
      id,
      action: "remove-duplicate" as const,
      path: `docs/${id}.md`,
      canonical: `packages/${id}.md`,
      equivalence,
      reason: "r",
      inboundRewritten: [],
      sourceMapEntries: 1,
      outcome: "applied" as const,
    },
  ],
  rewrittenFiles: [{ file: "docs/a.md", links: 2, mentions: 1 }],
  skippedFiles: [],
  unresolvedRewrites: [],
  removedDirectories: [],
  sourceMap: { path: "docs/migration/source-map.json", entriesUpdated: 1 },
});

const pair = (left: string, right: string, relation: "equal-modulo-paths" | "translation-or-variant") => ({
  left,
  right,
  jaccard: 0.9,
  containment: 0.95,
  relation,
});

const tokens = (text: string) => new Set(normalizedTokens(text).map((_, i, all) => all.slice(i, i + 3).join(" ")));

const movedTarget = (path: string) => (path === "docs/a/old.md" ? "docs/b/new.md" : path);

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "docs-consolidation-"));
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await write(
    "packages/ui/pkg/README.md",
    "# Pkg\n\nThe package readme, long enough to be compared as a real document.\n",
  );
  await write(
    "docs/products/ui/packages/pkg/README.md",
    "# Pkg\n\nThe package readme, long enough to be compared as a real document.\n",
  );
  await write(
    "docs/architecture/ui/design/M3-X.md",
    "# M3 X\n\nSee [pkg](../../../products/ui/packages/pkg/README.md).\n",
  );
  await write(
    "docs/architecture/ui/design/other.md",
    "# Other\n\n[x](./M3-X.md#part) and [pkg](../../../products/ui/packages/pkg/README.md) and `docs/architecture/ui/design/M3-X.md`.\n",
  );
  await write("docs/migration/history.md", "[x](../architecture/ui/design/M3-X.md)\n");
  await write("docs/guides/ui/guide.md", "[x](../../architecture/ui/design/M3-X.md)\n");
  await write(
    "docs/migration/source-map.json",
    `${JSON.stringify(
      {
        entries: [
          {
            source: "ui/pkg/README.md",
            kind: "documentation",
            target: "docs/products/ui/packages/pkg/README.md",
            sha256: "x",
          },
          {
            source: "ui/M3-X.md",
            kind: "documentation",
            target: "docs/architecture/ui/design/M3-X.md",
            sha256: "y",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", root, ...args], { windowsHide: true });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
  return root;
}

test("apply moves, removes duplicates, rewrites inbound links and records aliases", async () => {
  const root = await fixture();
  try {
    const m3 = await readFile(join(root, "docs/architecture/ui/design/M3-X.md"));
    const dup = await readFile(join(root, "docs/products/ui/packages/pkg/README.md"));
    const plan: Plan = {
      schemaVersion: 1,
      scope: "ui",
      actions: [
        {
          id: "move:m3x",
          action: "move",
          path: "docs/architecture/ui/design/M3-X.md",
          sha256: sha256Of(m3),
          to: "docs/architecture/ui/m3/M3-X.md",
          reason: "topic folder",
        },
        {
          id: "dedup:pkg",
          action: "remove-duplicate",
          path: "docs/products/ui/packages/pkg/README.md",
          sha256: sha256Of(dup),
          canonical: "packages/ui/pkg/README.md",
          equivalence: "identical",
          reason: "owner copy",
        },
      ],
    };
    const dry = await applyPlan({
      root,
      plan,
      write: false,
      sourceMapPath: "docs/migration/source-map.json",
      reportName: "t",
    });
    expect(dry.dryRun).toBe(true);
    expect(existsSync(join(root, "docs/products/ui/packages/pkg/README.md"))).toBe(true);

    const report = await applyPlan({
      root,
      plan,
      write: true,
      sourceMapPath: "docs/migration/source-map.json",
      reportName: "t",
    });
    expect(existsSync(join(root, "docs/architecture/ui/design/M3-X.md"))).toBe(false);
    expect(existsSync(join(root, "docs/products/ui/packages/pkg/README.md"))).toBe(false);
    expect(existsSync(join(root, "docs/products/ui"))).toBe(false);
    const moved = await readFile(join(root, "docs/architecture/ui/m3/M3-X.md"), "utf8");
    expect(moved).toContain("(../../../../packages/ui/pkg/README.md)");
    const other = await readFile(join(root, "docs/architecture/ui/design/other.md"), "utf8");
    expect(other).toContain("[x](../m3/M3-X.md#part)");
    expect(other).toContain("(../../../../packages/ui/pkg/README.md)");
    expect(other).toContain("`docs/architecture/ui/m3/M3-X.md`");
    expect(await readFile(join(root, "docs/guides/ui/guide.md"), "utf8")).toContain("../../architecture/ui/m3/M3-X.md");
    // Historical evidence is never rewritten.
    expect(await readFile(join(root, "docs/migration/history.md"), "utf8")).toContain("design/M3-X.md");
    const map = JSON.parse(await readFile(join(root, "docs/migration/source-map.json"), "utf8")) as SourceMapFile;
    expect(map.entries[0]).toMatchObject({
      target: null,
      duplicateOf: "packages/ui/pkg/README.md",
    });
    expect(map.entries[1]).toMatchObject({
      importedTarget: "docs/architecture/ui/m3/M3-X.md",
    });
    expect(map.entries[1]?.importedSha256).toBe(sha256Of(moved));
    const dedup = report.actions.find(action => action.id === "dedup:pkg");
    expect(dedup?.inboundRewritten.map(item => item.file).toSorted()).toEqual([
      "docs/architecture/ui/design/other.md",
      "docs/architecture/ui/m3/M3-X.md",
    ]);
    expect(dedup?.sourceMapEntries).toBe(1);
    const findings = await verifyReport(root, report);
    expect(findings.filter(item => item.action !== "links")).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("apply supports identical-at-head, superseded reviews and pointer dispositions", async () => {
  const root = await fixture();
  try {
    const dup = sha256Of(await readFile(join(root, "docs/products/ui/packages/pkg/README.md")));
    // The owner copy gains uncommitted edits; its committed text still equals the docs copy.
    await writeFile(join(root, "packages/ui/pkg/README.md"), "# Pkg\n\nEdited after the commit.\n");
    const m3 = sha256Of(await readFile(join(root, "docs/architecture/ui/design/M3-X.md")));
    await writeFile(
      join(root, "docs/architecture/ui/design/other.md"),
      "# Other\n\n## Historique\n\nMerged from docs/architecture/ui/design/M3-X.md and docs/products/ui/packages/pkg/README.md.\n",
    );
    const other = sha256Of(await readFile(join(root, "docs/architecture/ui/design/other.md")));
    const base = { schemaVersion: 1 as const, scope: "ui" };
    await expect(
      applyPlan({
        root,
        write: false,
        reportName: "t",
        plan: {
          ...base,
          actions: [
            {
              id: "x",
              action: "remove-duplicate",
              path: "docs/products/ui/packages/pkg/README.md",
              sha256: dup,
              canonical: "packages/ui/pkg/README.md",
              equivalence: "superseded",
              reason: "",
            },
          ],
        },
      }),
    ).rejects.toThrow("superseded");
    const plan: Plan = {
      ...base,
      actions: [
        {
          id: "head",
          action: "remove-duplicate",
          path: "docs/products/ui/packages/pkg/README.md",
          sha256: dup,
          canonical: "packages/ui/pkg/README.md",
          equivalence: "identical-at-head",
          reason: "owner dirty",
        },
        {
          id: "merge",
          action: "merge",
          canonical: "docs/architecture/ui/design/other.md",
          sources: [
            {
              path: "docs/architecture/ui/design/M3-X.md",
              sha256: m3,
              disposition: "pointer",
            },
          ],
          reason: "fold",
        },
      ],
    };
    expect(other).toHaveLength(64);
    const report = await applyPlan({
      root,
      plan,
      write: true,
      reportName: "t",
    });
    expect(existsSync(join(root, "docs/products/ui/packages/pkg/README.md"))).toBe(false);
    const stub = await readFile(join(root, "docs/architecture/ui/design/M3-X.md"), "utf8");
    expect(stub).toStartWith("# Référence canonique");
    expect(stub).toContain("(other.md)");
    const findings = await verifyReport(root, report);
    expect(findings.filter(item => item.action !== "links")).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("legacy repository paths follow the recorded layout migrations", () => {
  const map = buildLegacyPathMap(
    {
      "crates/ui/aphrody-app": "crates/ui/app",
      "crates/ui/aphrody-render": "crates/ui/render",
      "crates/ui/aphrody-render-tools": "crates/ui/render-tools",
      "crates/os/aphrody-proc": "crates/os/ostd/proc",
    },
    {
      "crates/ui/aphrody-render3d": "crates/ui/aphrody-render-tools",
      "packages/m3": "packages/ui/m3",
    },
  );
  expect(map.get("crates/aphrody-app")).toBe("crates/ui/app");
  expect(map.get("crates/ui/aphrody-app")).toBe("crates/ui/app");
  expect(map.get("crates/aphrody-render3d")).toBe("crates/ui/render-tools");
  expect(map.get("packages/m3")).toBe("packages/ui/m3");
  expect(map.has("crates/os/aphrody-proc")).toBe(false);
  const text = [
    "`crates/aphrody-app/src/lib.rs`, `crates/aphrody-render` and crates/aphrody-render-tools stay exact.",
    "`packages/m3-theme` is not `packages/m3`; see [x](../../crates/aphrody-app/README.md) and ../crates/aphrody-render.",
  ].join("\n");
  const fixed = applyPathMap(text, map);
  expect(fixed.content).toContain("`crates/ui/app/src/lib.rs`");
  expect(fixed.content).toContain("`crates/ui/render`");
  expect(fixed.content).toContain("crates/ui/render-tools stay");
  expect(fixed.content).toContain("`packages/m3-theme` is not `packages/ui/m3`");
  expect(fixed.content).toContain("(../../crates/aphrody-app/README.md)");
  expect(fixed.content).toContain("../crates/aphrody-render.");
  expect(fixed.replacements).toBe(4);
});

test("fix-paths updates legacy paths in matched files after the other actions", async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, "docs/guides/ui/guide.md"),
      "# Guide\n\nSee `crates/aphrody-app/src/lib.rs` and [x](../../architecture/ui/design/M3-X.md).\n",
    );
    const plan: Plan = {
      schemaVersion: 1,
      scope: "ui",
      actions: [
        {
          id: "fix",
          action: "fix-paths",
          patterns: ["docs/guides/ui/*.md"],
          reason: "legacy",
        },
      ],
    };
    const legacyPathMap = new Map([["crates/aphrody-app", "crates/ui/app"]]);
    const report = await applyPlan({
      root,
      plan,
      write: true,
      reportName: "t",
      legacyPathMap,
      allowDirtyPrefixes: ["docs/guides/ui/"],
    });
    expect(await readFile(join(root, "docs/guides/ui/guide.md"), "utf8")).toContain("`crates/ui/app/src/lib.rs`");
    expect(report.actions[0]?.pathFixes).toEqual([{ file: "docs/guides/ui/guide.md", replacements: 1 }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("fix-paths preserves dirty files unless their prefix is allowed", async () => {
  const root = await fixture();
  try {
    const path = "docs/guides/ui/guide.md";
    const content = "# Guide\n\nLocal edit: `crates/aphrody-app/src/lib.rs`.\n";
    await writeFile(join(root, path), content);
    const options = {
      root,
      plan: {
        schemaVersion: 1 as const,
        scope: "ui",
        actions: [
          {
            id: "fix",
            action: "fix-paths" as const,
            patterns: [path],
            reason: "legacy",
          },
        ],
      },
      write: true,
      reportName: "t",
      legacyPathMap: new Map([["crates/aphrody-app", "crates/ui/app"]]),
    };
    const skipped = await applyPlan(options);
    expect(await readFile(join(root, path), "utf8")).toBe(content);
    expect(skipped.skippedFiles).toEqual([
      {
        file: path,
        reason: "uncommitted changes outside the allowed prefixes",
      },
    ]);
    expect(skipped.actions[0]?.pathFixes).toEqual([]);
    const allowed = await applyPlan({
      ...options,
      allowDirtyPrefixes: ["docs/guides/ui/"],
    });
    expect(allowed.skippedFiles).toEqual([]);
    expect(await readFile(join(root, path), "utf8")).toContain("`crates/ui/app/src/lib.rs`");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("verify detects stale definitions and literal mentions with exact path boundaries", async () => {
  const root = await fixture();
  try {
    const gone = "docs/architecture/ui/design/removed.md";
    const canonical = "packages/ui/pkg/README.md";
    const report = {
      actions: [
        {
          id: "removed",
          action: "remove-duplicate" as const,
          path: gone,
          canonical,
          reason: "duplicate",
          inboundRewritten: [],
          sourceMapEntries: 0,
          outcome: "applied" as const,
        },
      ],
      sourceMap: null,
    };
    const host = "docs/guides/ui/guide.md";
    await writeFile(join(root, host), "[ref]: ../../architecture/ui/design/removed.md#section\n");
    expect(await verifyReport(root, report)).toEqual([{ action: "links", problem: `${host} still links to ${gone}` }]);
    await writeFile(join(root, host), `See \`${gone}\` and ${gone}.\n`);
    expect(await verifyReport(root, report)).toEqual([{ action: "links", problem: `${host} still mentions ${gone}` }]);
    await writeFile(join(root, host), `See ${gone}x and prefix/${gone}.\n`);
    await writeFile(join(root, "docs/migration/old.md"), `Historical ${gone}.\n`);
    expect(await verifyReport(root, report)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("the consolidation report merges phases and keeps the measured numbers", () => {
  const report = buildConsolidationReport({
    name: "n",
    before: {
      summary: { nearThreshold: 0.8, documents: 10 },
      exactClusters: [],
      nearPairs: [],
    },
    after: { summary: { documents: 4 } },
    applies: [phase("a", "identical"), phase("b", "equal-modulo-paths")],
    metrics: { linkCheck: { before: 5, after: 3 } },
  }) as {
    summary: Record<string, unknown>;
    rewrittenFiles: Array<{ links: number }>;
  };
  expect(report.summary["actions"]).toMatchObject({
    removeDuplicate: 2,
    removeIdentical: 1,
    removeEqualModuloPaths: 1,
    sourceMapEntriesUpdated: 2,
  });
  expect(report.summary["linkCheck"]).toEqual({ before: 5, after: 3 });
  expect(report.rewrittenFiles).toEqual([{ file: "docs/a.md", links: 4, mentions: 2 }]);
});

test("apply rejects stale hashes, existing destinations and merges without provenance", async () => {
  const root = await fixture();
  try {
    const sha = sha256Of(await readFile(join(root, "docs/architecture/ui/design/M3-X.md")));
    const base = { schemaVersion: 1 as const, scope: "ui" };
    await expect(
      applyPlan({
        root,
        write: true,
        reportName: "t",
        plan: {
          ...base,
          actions: [
            {
              id: "m",
              action: "move",
              path: "docs/architecture/ui/design/M3-X.md",
              sha256: "0".repeat(64),
              to: "docs/architecture/ui/m3/M3-X.md",
              reason: "",
            },
          ],
        },
      }),
    ).rejects.toThrow("changed");
    await expect(
      applyPlan({
        root,
        write: true,
        reportName: "t",
        plan: {
          ...base,
          actions: [
            {
              id: "m",
              action: "move",
              path: "docs/architecture/ui/design/M3-X.md",
              sha256: sha,
              to: "docs/architecture/ui/design/other.md",
              reason: "",
            },
          ],
        },
      }),
    ).rejects.toThrow("never overwritten");
    await expect(
      applyPlan({
        root,
        write: true,
        reportName: "t",
        plan: {
          ...base,
          actions: [
            {
              id: "g",
              action: "merge",
              canonical: "docs/architecture/ui/design/other.md",
              sources: [{ path: "docs/architecture/ui/design/M3-X.md", sha256: sha }],
              reason: "",
            },
          ],
        },
      }),
    ).rejects.toThrow("Historique/Provenance");
    expect(existsSync(join(root, "docs/architecture/ui/design/M3-X.md"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("all scope includes Infra and preserves shipped copies while excluding imported history", async () => {
  const root = await fixture();
  try {
    const paths = [
      "packages/infra/tool/README.md",
      "docs/reference/infra/tool/README.md",
      "docs/templates/tool/README.md",
      "docs/plugins/tool/README.md",
      "docs/distribution/tool/README.md",
      "docs/reference/infra/tool/LICENSE.txt",
      "packages/infra/tool/LICENSE.txt",
      "docs/reference/imported/README.md",
      "docs/plans/infra/archive/README.md",
    ];
    await Promise.all(
      paths.map(async path => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(
          join(root, path),
          "# Tool\n\nFirst-party infrastructure documentation with enough text for duplicate comparison.\n",
        );
      }),
    );
    await mkdir(join(root, "tools/config/docs"), { recursive: true });
    await writeFile(
      join(root, "tools/config/docs/imported-upstream-docs.json"),
      JSON.stringify({
        trees: [{ id: "imported", include: ["docs/reference/imported/**"] }],
      }),
    );
    Bun.spawnSync(["git", "-C", root, "add", "-A"], { windowsHide: true });
    Bun.spawnSync(["git", "-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "docs"], {
      windowsHide: true,
    });
    const ui = await scanScope({ root });
    expect(ui.entries.some(item => item.path === paths[0])).toBe(false);
    const all = await scanScope({ root, scope: ALL_SCOPE });
    expect(all.scope).toBe("all");
    expect(all.entries.map(item => item.path)).toContain(paths[0]!);
    expect(all.entries.map(item => item.path)).not.toContain("docs/reference/imported/README.md");
    expect(all.entries.map(item => item.path)).not.toContain("docs/plans/infra/archive/README.md");
    const plan = planOwnerDuplicates(all, ALL_SCOPE.ownerRoots, retainDocumentationCopy);
    expect(plan.actions.find(action => action.path === "docs/reference/infra/tool/README.md")?.action).toBe(
      "remove-duplicate",
    );
    for (const path of [
      "docs/templates/tool/README.md",
      "docs/plugins/tool/README.md",
      "docs/distribution/tool/README.md",
      "docs/reference/infra/tool/LICENSE.txt",
    ])
      expect(plan.actions.find(action => action.path === path)?.action).toBe("retain");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("all scope ignores file and parent symlinks and rejects aliased plan destinations", async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "docs-consolidation-outside-"));
  try {
    const content = "# Outside\n\nExternal `crates/aphrody-app` must stay untouched.\n";
    await writeFile(join(outside, "alias.md"), content);
    await symlink(join(outside, "alias.md"), join(root, "docs/alias.md"));
    await symlink(outside, join(root, "docs/linked"));
    const scanned = await scanScope({ root, scope: ALL_SCOPE });
    expect(scanned.entries.map(item => item.path)).not.toContain("docs/alias.md");
    expect(scanned.entries.some(item => item.path.startsWith("docs/linked/"))).toBe(false);
    const plan: Plan = {
      schemaVersion: 1,
      scope: "all",
      actions: [
        {
          id: "fix",
          action: "fix-paths",
          patterns: ["docs/**/*.md"],
          reason: "legacy",
        },
      ],
    };
    const report = await applyPlan({
      root,
      plan,
      write: true,
      reportName: "t",
      allowDirtyPrefixes: ["docs/"],
      legacyPathMap: new Map([["crates/aphrody-app", "crates/ui/app"]]),
    });
    expect(await readFile(join(outside, "alias.md"), "utf8")).toBe(content);
    expect(await verifyReport(root, report)).toEqual([]);
    const path = "docs/architecture/ui/design/M3-X.md";
    for (const destination of ["docs/alias.md", "docs/linked/new.md", "../outside.md"]) {
      const unsafe: Plan = {
        schemaVersion: 1,
        scope: "all",
        actions: [
          {
            id: "move",
            action: "move",
            path,
            to: destination,
            // oxlint-disable-next-line no-await-in-loop -- each unsafe plan is built from the fixture as the previous rejection left it
            sha256: sha256Of(await readFile(join(root, path))),
            reason: "move",
          },
        ],
      };
      // oxlint-disable-next-line no-await-in-loop -- rejections are asserted one destination at a time against the same fixture
      await expect(applyPlan({ root, plan: unsafe, write: true, reportName: "t" })).rejects.toThrow("Unsafe global");
    }
    const findings = await verifyReport(root, {
      scope: "all",
      sourceMap: null,
      actions: [
        {
          id: "bad",
          action: "merge",
          canonical: path,
          sources: [{ path: "docs/alias.md", sha256: "x", disposition: "pointer" }],
          reason: "bad",
          inboundRewritten: [],
          sourceMapEntries: 0,
          outcome: "applied",
        },
      ],
    });
    expect(findings[0]?.action).toBe("paths");
    expect(await readFile(join(outside, "alias.md"), "utf8")).toBe(content);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}, 120_000);

test("all scope excludes private agent context before inventory and path rewriting", async () => {
  const root = await fixture();
  try {
    const paths = [
      "docs/privateMarkdown/context.md",
      "packages/infra/tool/private-markdown/context.md",
      "docs/.coord/context.md",
      "docs/MEMORY.md",
      "docs/CONVERSATIONS.md",
      "packages/infra/tool/TRANSCRIPTS.md",
      "docs/LIVE.md",
    ];
    const content = "# Synthetic private fixture\n\n`crates/aphrody-app` must remain unchanged.\n";
    await Promise.all(
      paths.map(async path => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
      }),
    );
    const scanned = await scanScope({ root, scope: ALL_SCOPE });
    expect(scanned.entries.some(item => paths.includes(item.path))).toBe(false);
    const report = await applyPlan({
      root,
      plan: {
        schemaVersion: 1,
        scope: "all",
        actions: [
          {
            id: "fix",
            action: "fix-paths",
            patterns: ["**/*.md"],
            reason: "legacy",
          },
        ],
      },
      write: true,
      reportName: "t",
      allowDirtyPrefixes: ["docs/", "packages/"],
      legacyPathMap: new Map([["crates/aphrody-app", "crates/ui/app"]]),
    });
    expect(report.actions[0]?.pathFixes).toEqual([]);
    const written = await Promise.all(paths.map(path => readFile(join(root, path), "utf8")));
    for (const text of written) expect(text).toBe(content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("scanScope inventories scope documents with hashes, topics and links", async () => {
  const root = await fixture();
  try {
    const scan = await scanScope({ root });
    const paths = scan.entries.map(item => item.path);
    expect(paths).toContain("docs/architecture/ui/design/M3-X.md");
    expect(paths).toContain("packages/ui/pkg/README.md");
    expect(paths.some(path => path.startsWith("docs/migration/"))).toBe(false);
    const readme = scan.entries.find(item => item.path === "packages/ui/pkg/README.md");
    expect(readme?.inbound).toEqual([]);
    const copy = scan.entries.find(item => item.path === "docs/products/ui/packages/pkg/README.md");
    expect(copy?.inbound).toContain("docs/architecture/ui/design/M3-X.md");
    expect(scan.exactClusters).toHaveLength(1);
    expect(scan.exactClusters[0]?.paths).toEqual([
      "docs/products/ui/packages/pkg/README.md",
      "packages/ui/pkg/README.md",
    ]);
    const x = scan.entries.find(item => item.path === "docs/architecture/ui/design/M3-X.md");
    expect(x?.lastGitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(x?.outbound).toEqual(["docs/products/ui/packages/pkg/README.md"]);
    expect(x?.unresolvedOutbound).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
