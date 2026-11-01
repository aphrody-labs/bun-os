// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { yoloCliPath } from "../yolo-cli-path.ts";
import {
  buildDocumentationManifest,
  documentationPath,
  loadDocumentationConfig,
  renderDocumentationAgentIndex,
  runDocumentation,
  type DocumentationConfig,
} from "../../src/automation/documentation.ts";

const config: DocumentationConfig = {
  schemaVersion: 1,
  owner: "@aphrody/bun-workspace/automation",
  visibility: "private",
  inventory: "docs/reference/workspace/documentation.json",
  agentIndex: "docs/llms.txt",
  entrypoints: ["docs/guides/workspace/main.md"],
  sources: [],
  site: {
    output: ".cache/documentation-site",
    include: ["docs/guides/workspace/main.md"],
  },
};

function fixture(): {
  root: string;
  put: (path: string, content: string) => void;
} {
  const root = mkdtempSync(join(tmpdir(), "aphrody-documentation-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  put("tools/config/docs/documentation.json", JSON.stringify(config));
  return { root, put };
}

describe("unified documentation", () => {
  test("inventories classifications and duplicate authority without deleting copies", () => {
    const { root, put } = fixture();
    try {
      put("docs/guides/workspace/main.md", "# Guide\n\nA reproducible task.\n");
      put("packages/infra/example/README.md", "# Guide\n\nA reproducible task.\n");
      put("docs/migration/proof.md", "# Proof\n");
      put("docs/reference/upstream-example/readme.md", "# Upstream\n");
      put("docs/apis/generated/api.md", "<!-- Generated from source. Do not edit. -->\n# API\n");
      put("docs/MEMORY.md", "# Private runtime context\n");
      execFileSync("git", ["add", "."], { cwd: root, windowsHide: true });
      put("docs/audit/private-draft.md", "# Concurrent private draft\n");
      const manifest = buildDocumentationManifest(root, config);
      expect(manifest.documents).toHaveLength(5);
      expect(manifest.documents.some(doc => doc.path.includes("private-draft"))).toBe(false);
      expect(manifest.duplicates).toHaveLength(1);
      expect(manifest.duplicates[0]?.action).toBe("retain");
      expect(manifest.duplicates[0]?.canonical).toBe("packages/infra/example/README.md");
      expect(manifest.documents.find(doc => doc.path.includes("migration"))?.status).toBe("historical");
      expect(manifest.documents.find(doc => doc.path.includes("upstream"))?.status).toBe("imported");
      expect(manifest.documents.find(doc => doc.path.includes("generated"))?.status).toBe("generated");
      expect(renderDocumentationAgentIndex(manifest, config)).toContain("[Guide](<guides/workspace/main.md>)");
      expect(() =>
        renderDocumentationAgentIndex(manifest, {
          ...config,
          entrypoints: ["missing.md"],
        }),
      ).toThrow("missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects traversal, symlinks and public visibility", () => {
    const { root, put } = fixture();
    try {
      expect(() => documentationPath(root, "../other.md")).toThrow("Unsafe");
      expect(() => documentationPath(root, "docs/../other.md")).toThrow("Unsafe");
      symlinkSync(tmpdir(), join(root, "linked"));
      expect(() => documentationPath(root, "linked/file.md")).toThrow("symlink");
      put("tools/config/docs/documentation.json", JSON.stringify({ ...config, visibility: "public" }));
      expect(() => loadDocumentationConfig(root)).toThrow("private visibility");
      put("tools/config/docs/documentation.json", JSON.stringify({ ...config, inventory: ".npmrc" }));
      expect(() => loadDocumentationConfig(root)).toThrow("owned docs paths");
      const target = {
        root: ".",
        id: "same",
        language: "typescript",
        paths: ["src.ts"],
      };
      put("tools/config/docs/documentation.json", JSON.stringify({ ...config, sources: [target, target] }));
      expect(() => loadDocumentationConfig(root)).toThrow("source id");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("AI is plan-only unless explicitly selected and online", async () => {
    const { root, put } = fixture();
    try {
      put("docs/guides/workspace/main.md", "# Guide\n");
      execFileSync("git", ["add", "."], { cwd: root, windowsHide: true });
      expect(await runDocumentation(["ai", "translate", "docs/guides/workspace/main.md", "en", "--root", root])).toBe(
        0,
      );
      expect(await runDocumentation(["--help"])).toBe(0);
      await expect(runDocumentation(["generate", "--unknown", "--root", root])).rejects.toThrow("Unknown");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("generation help works through the docs-gen alias without scanning the root", () => {
    for (const args of [
      ["docs-gen", "--help"],
      ["docs", "check", "-h"],
    ]) {
      const result = Bun.spawnSync(
        [process.execPath, yoloCliPath, "ops", ...args, "--root", join(tmpdir(), "nonexistent-docs-help-root")],
        { windowsHide: true },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("--skip-ecosystem");
      expect(result.stderr.toString()).toBe("");
    }
  });
});
