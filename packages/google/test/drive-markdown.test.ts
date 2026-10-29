// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, open, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectRetrievalCandidate, reviewedSnapshotHashes } from "../src/drive-sync.ts";
import {
  nativeMarkdown,
  normalizeMarkdown,
  projectionAction,
  projectionMarkdown,
  type NativeDocument,
} from "../src/drive-markdown.ts";
const paragraph = (text: string) => ({ paragraph: { elements: [{ textRun: { content: text } }] } });
test("reviewed seed rejects a remote edit that arrived after the reviewed snapshot", () => {
  const snapshot = JSON.stringify({ body: { content: [paragraph("Reviewed content\n")] } });
  const original = new Bun.CryptoHasher("sha256").update("Reviewed content\n").digest("hex");
  const concurrent = new Bun.CryptoHasher("sha256").update("New remote content\n").digest("hex");
  expect(reviewedSnapshotHashes(snapshot, original).sourceRenderedHash).toBe(original);
  expect(() => reviewedSnapshotHashes(snapshot, concurrent)).toThrow(
    "Reviewed native snapshot no longer matches current remote content",
  );
});
describe("read-only native Google Docs Markdown projection", () => {
  test("retains avatar smart chips and Github text links in flattened MCP snapshots", () => {
    const doc: NativeDocument = {
      tabs: [
        {
          title: "Identity",
          body: {
            content: [
              {
                paragraph: {
                  elements: [
                    {
                      richLink: {
                        richLinkProperties: {
                          title: "avatar.png",
                          uri: "https://drive.google.com/file/d/avatar/view",
                        },
                      },
                    },
                    {
                      textRun: {
                        content: " aphrody-labs",
                        textStyle: { link: { url: "https://github.com/aphrody-labs" } },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    const md = nativeMarkdown(doc);
    expect(md).toContain("[avatar.png](https://drive.google.com/file/d/avatar/view)");
    expect(md).toContain("[aphrody-labs](https://github.com/aphrody-labs)");
  });
  test("walks all nested API tabs and renders headings and text styling", () => {
    const doc: NativeDocument = {
      tabs: [
        {
          tabProperties: { title: "Parent" },
          documentTab: {
            body: {
              content: [
                {
                  paragraph: {
                    paragraphStyle: { namedStyleType: "HEADING_1" },
                    elements: [{ textRun: { content: "Aphrody\n", textStyle: { bold: true } } }],
                  },
                },
              ],
            },
          },
          childTabs: [
            {
              tabProperties: { title: "Child" },
              documentTab: { body: { content: [paragraph("Yoyo et Omar\n")] } },
            },
          ],
        },
      ],
    };
    const md = nativeMarkdown(doc);
    expect(md).toContain("## Parent");
    expect(md).toContain("# **Aphrody**");
    expect(md).toContain("## Child");
    expect(md).toContain("Yoyo et Omar");
  });
  test("keeps nested bullet lists and numbered list start positions", () => {
    const doc: NativeDocument = {
      lists: {
        list: {
          listProperties: {
            nestingLevels: [{ glyphType: "DECIMAL", startNumber: 3 }, { glyphType: "BULLET" }],
          },
        },
      },
      body: {
        content: [
          { paragraph: { ...paragraph("first").paragraph, bullet: { listId: "list" } } },
          {
            paragraph: {
              ...paragraph("nested").paragraph,
              bullet: { listId: "list", nestingLevel: 1 },
            },
          },
          { paragraph: { ...paragraph("second").paragraph, bullet: { listId: "list" } } },
        ],
      },
    };
    const md = nativeMarkdown(doc);
    expect(md).toContain("3. first");
    expect(md).toContain("  - nested");
    expect(md).toContain("4. second");
  });
  test("preserves table cells and escapes pipe characters", () => {
    const md = nativeMarkdown({
      body: {
        content: [
          {
            table: {
              tableRows: [
                {
                  tableCells: [{ content: [paragraph("Name")] }, { content: [paragraph("Role")] }],
                },
                {
                  tableCells: [{ content: [paragraph("Aphrody")] }, { content: [paragraph("Dragon | Ball")] }],
                },
              ],
            },
          },
        ],
      },
    });
    expect(md).toContain("| Name | Role |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("Dragon \\| Ball");
  });
  test("retains reviewed persona frontmatter and is idempotent UTF8 LF without BOM", () => {
    const local = '\uFEFF---\r\nidentity: "Aphrody"\r\nbrevity: "terse"\r\n---\r\nold\r\n';
    const md = projectionMarkdown({ body: { content: [paragraph("Dragon\r\n")] } }, local);
    expect(md).toStartWith('---\nidentity: "Aphrody"\nbrevity: "terse"\n---\n');
    expect(md).not.toContain("\r");
    expect(normalizeMarkdown(md)).toBe(md);
    expect(projectionMarkdown({ body: { content: [paragraph("Dragon\n")] } }, md)).toBe(md);
  });
  test("uses remote persona frontmatter without duplicating the local block", () => {
    const local = '---\nidentity: "Local"\nbrevity: "balanced"\n---\nOld persona\n';
    const remote = '---\nidentity: "Drive"\nbrevity: "terse"\n---\n\nNew persona\n';
    const md = projectionMarkdown({ body: { content: [paragraph(remote)] } }, local);
    expect(md).toBe(normalizeMarkdown(remote));
    expect(md.match(/^---$/gm)).toHaveLength(2);
  });
  test("stages remote changes even when local is untouched and never trusts untracked local context", () => {
    expect(projectionAction({ remoteHash: "old", localHash: "local" }, "new", "local")).toBe("stage");
    expect(projectionAction({ remoteHash: "old", localHash: "local" }, "new", "modified")).toBe("stage");
    expect(projectionAction(undefined, "remote", "local")).toBe("stage");
    expect(projectionAction({ remoteHash: "same", localHash: "local" }, "same", "local")).toBe("unchanged");
    expect(projectionAction({ remoteHash: "same", localHash: "local" }, "same", "modified")).toBe("local-ahead");
  });
  test("rejects unsupported native content instead of silently deleting it", () => {
    expect(() => nativeMarkdown({ body: { content: [{ paragraph: { elements: [{}] } }] } })).toThrow(
      "Unsupported native element",
    );
  });
});

const temporary: string[] = [];
const snapshot = `USER.md-${"a".repeat(16)}-${"b".repeat(16)}`;
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "aphrody-drive-candidate-"));
  temporary.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
// The private projection relies on POSIX mode bits and rename over an open target.
describe.skipIf(process.platform === "win32")("private candidate retrieval projection", () => {
  test("copies only the remote candidate and leaves its source evidence unchanged", async () => {
    const root = await directory(),
      incoming = join(root, "incoming-markdown", snapshot);
    const source = {
      "remote.candidate.md": "Remote candidate\n",
      "local.md": "Local private version\n",
      "reviewed-baseline.md": "Reviewed private baseline\n",
      "remote.native.json": '{"native":"private"}',
      "evidence.json": '{"reason":"private review"}',
    };
    await Promise.all(Object.entries(source).map(([name, text]) => Bun.write(join(incoming, name), text)));
    await projectRetrievalCandidate(root, snapshot, source["remote.candidate.md"]);
    const retrieval = join(root, "retrieval-markdown"),
      projected = join(retrieval, snapshot);
    expect(await readdir(retrieval)).toEqual([snapshot]);
    expect(await readdir(projected)).toEqual(["remote.candidate.md"]);
    expect(await Bun.file(join(projected, "remote.candidate.md")).text()).toBe("Remote candidate\n");
    expect((await stat(retrieval)).mode & 0o777).toBe(0o700);
    expect((await stat(projected)).mode & 0o777).toBe(0o700);
    expect((await stat(join(projected, "remote.candidate.md"))).mode & 0o777).toBe(0o600);
    await Promise.all(
      Object.entries(source).map(async ([name, text]) =>
        expect(await Bun.file(join(incoming, name)).text()).toBe(text),
      ),
    );
  });
  test("unchanged candidates preserve their fingerprint while changed content is replaced atomically", async () => {
    const root = await directory();
    await projectRetrievalCandidate(root, snapshot, "First candidate\n");
    const path = join(root, "retrieval-markdown", snapshot, "remote.candidate.md"),
      before = await stat(path);
    await projectRetrievalCandidate(root, snapshot, "First candidate\n");
    const repeated = await stat(path);
    expect(repeated.ino).toBe(before.ino);
    expect(repeated.mtimeMs).toBe(before.mtimeMs);
    const reader = await open(path, "r");
    try {
      await projectRetrievalCandidate(root, snapshot, "Updated candidate\n");
      expect(await reader.readFile("utf8")).toBe("First candidate\n");
      expect(await Bun.file(path).text()).toBe("Updated candidate\n");
      expect(await readdir(join(path, ".."))).toEqual(["remote.candidate.md"]);
    } finally {
      await reader.close();
    }
  });
  test("unsafe snapshot paths and symlinked candidate files cannot write outside the projection", async () => {
    const root = await directory();
    await expect(projectRetrievalCandidate(root, "../escape", "candidate")).rejects.toThrow("snapshot name");
    await projectRetrievalCandidate(root, snapshot, "Initial candidate\n");
    const projected = join(root, "retrieval-markdown", snapshot, "remote.candidate.md"),
      outside = join(root, "local.md");
    await Bun.write(outside, "Protected local\n");
    await rm(projected);
    await symlink(outside, projected);
    await expect(projectRetrievalCandidate(root, snapshot, "Replacement\n")).rejects.toThrow("projection file");
    expect(await Bun.file(outside).text()).toBe("Protected local\n");
  });
});
