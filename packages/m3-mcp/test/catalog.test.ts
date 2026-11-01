import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listPackages,
  listTemplates,
  lookupTokens,
  researchLinks,
  searchDocs,
  designCorpusRoot,
  validateTokens,
} from "../src/catalog";

test("packages include m3-mcp", () => {
  const p = listPackages().join("\n");
  expect(p).toContain("@aphrody/m3-mcp");
});
test("token lookup and validation", () => {
  expect(lookupTokens("corner-full")[0]?.value).toBe("9999px");
  expect(lookupTokens("on-primary-container").length).toBeGreaterThan(0);
  expect(validateTokens("a{color:var(--md-sys-color-primary);b:var(--md-nope)}").unknown).toEqual(["--md-nope"]);
});
test("docs, research and templates", () => {
  expect(searchDocs("Material", 3).length).toBeGreaterThan(0);
  const root = mkdtempSync(join(tmpdir(), "m3-research-links-"));
  try {
    mkdirSync(join(root, "docs/research"), { recursive: true });
    writeFileSync(join(root, "docs/research/GOOGLE-LINKS.md"), "| Material Design | https://m3.material.io/ |\n");
    const research = researchLinks(root, "");
    expect(research.files).toEqual([join("docs", "research", "GOOGLE-LINKS.md")]);
    expect(research.links).toContain("Material Design  https://m3.material.io/");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  expect(listTemplates()).toContain("packages/m3-templates/react");
});

test("native design corpus takes priority and exposes Markdown, JSON provenance and URL exports", () => {
  const root = mkdtempSync(join(tmpdir(), "m3-design-corpus-"));
  try {
    const framework = join(root, "m3");
    const corpus = join(root, "var/mirrors/design-sync");
    mkdirSync(join(framework, "docs"), { recursive: true });
    mkdirSync(join(corpus, "material-3/documents"), { recursive: true });
    writeFileSync(join(framework, "docs/old.md"), "Material historical guide");
    expect(designCorpusRoot(framework)).toBeUndefined();
    writeFileSync(join(corpus, "AI_READY.md"), "Material primary source https://m3.material.io/\n");
    writeFileSync(
      join(corpus, "material-3/documents/buttons.md"),
      "Material expressive buttons https://m3.material.io/components/buttons/overview\n",
    );
    writeFileSync(join(corpus, "assets.json"), '{"Material": "https://design.google/assets/pet.svg"}');
    expect(designCorpusRoot(framework)).toBe(corpus);
    expect(searchDocs("Material", 1, framework)).toEqual([
      "design-sync/AI_READY.md:1: Material primary source https://m3.material.io/",
    ]);
    expect(searchDocs("pet.svg", 3, framework)[0]).toContain("design-sync/assets.json:1:");
    expect(researchLinks(framework).links).toContain("https://design.google/assets/pet.svg");
    expect(researchLinks(framework).files).toContain("design-sync/material-3/documents/buttons.md");
    expect(searchDocs("Material", 10, framework).at(-1)).toContain("docs/old.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
