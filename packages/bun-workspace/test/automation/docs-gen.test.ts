// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { domainOf, renderDocsIndex, renderLlms, renderState, type Unit } from "../../src/automation/docs-gen.ts";

const unit = (over: Partial<Unit>): Unit => ({
  ecosystem: "rust",
  name: "x",
  path: "crates/ai/x",
  domain: "ai",
  role: "crate",
  version: "0.1.0",
  kinds: ["lib"],
  tests: true,
  todos: 0,
  lastCommit: "2026-10-02",
  ...over,
});

describe("docs-gen", () => {
  test("generated indexes contain tracked documents and exclude concurrent drafts", () => {
    const root = mkdtempSync(join(tmpdir(), "aphrody-docs-index-"));
    try {
      execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
      mkdirSync(join(root, "docs/guides/workspace"), { recursive: true });
      writeFileSync(join(root, "docs/guides/workspace/README.md"), "# Tracked guide\n");
      execFileSync("git", ["add", "."], { cwd: root, windowsHide: true });
      mkdirSync(join(root, "docs/audit/private-draft"), { recursive: true });
      writeFileSync(join(root, "docs/audit/private-draft/README.md"), "# Private draft\n");
      const index = renderDocsIndex(root);
      expect(index).toContain("[Tracked guide](guides/workspace/README.md)");
      expect(index).not.toContain("private-draft");
      const llms = renderLlms(root);
      expect(llms).toContain("Tracked guide");
      expect(llms).not.toContain("Private draft");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("domainOf reads the domain segment", () => {
    expect(domainOf("crates/ai/mcp")).toBe("ai");
    expect(domainOf("packages/bun-workspace")).toBe("bun-workspace");
    expect(domainOf("apps/rg/website")).toBe("rg");
    expect(domainOf("crates/infra/aphrody")).toBe("infra");
  });

  test("renderState counts crates, packages and apps per domain", () => {
    const text = renderState(
      [
        unit({}),
        unit({ name: "y", path: "crates/ai/y", todos: 2, tests: false }),
        unit({
          ecosystem: "bun",
          name: "@aphrody/z",
          path: "packages/ai/z",
          role: "package",
        }),
        unit({
          name: "cli",
          path: "crates/infra/aphrody",
          domain: "cli",
          role: "app",
          kinds: ["bin"],
        }),
      ],
      ["crates/os/kernel/comps/drive"],
      [],
    );
    expect(text).toContain("Totals: **2 crates**, **1 packages**, **1 apps**");
    expect(text).toContain("| [ai](#ai) | 2 | 1 | 0 | 2 |");
    expect(text).toContain("- `crates/os/kernel/comps/drive`");
    expect(text).toContain(
      "| `y` | [crates/ai/y](../../../crates/ai/y) | rust crate | 0.1.0 | lib | no | 2 | 2026-10-02 |",
    );
  });
});
