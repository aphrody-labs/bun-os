// SPDX-License-Identifier: Apache-2.0
// The Markdown renderer on the repository's own documentation, not on toy strings.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderMarkdown } from "../src/markdown";

const root = join(import.meta.dir, "../../..");

describe("markdown renderer", () => {
  test("renders a real repository document: headings and substantial content", async () => {
    const html = renderMarkdown(await Bun.file(join(root, "docs/GOAL.md")).text());
    expect(html).toMatch(/<h2>/);
    expect(html.length).toBeGreaterThan(1000);
    expect(html).not.toContain("<script");
  });

  test("escapes HTML coming from documents", () => {
    const html = renderMarkdown('# <img src=x onerror="alert(1)">\n\n```\n<b>code</b>\n```\n');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;b&gt;code&lt;/b&gt;");
  });

  test("closes lists and code fences", () => {
    const html = renderMarkdown("- a\n- b\n\ntext\n\n```\nx\n```\n");
    expect(html.match(/<ul>/g)).toHaveLength(1);
    expect(html.match(/<\/ul>/g)).toHaveLength(1);
    expect(html).toContain("<pre><code>");
    expect(html).toContain("</code></pre>");
  });
});
