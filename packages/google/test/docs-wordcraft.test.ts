// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { drive_v3 } from "@googleapis/drive";
import type { docs_v1 } from "@googleapis/docs";
import {
  exportGoogleDocForWordCraft,
  googleDocSnapshotToWordCraftMarkdown,
  WORDCRAFT_DOCX_MIME,
  saveGoogleDocSnapshot,
} from "../src/docs-wordcraft.ts";
import { runGoogle } from "../src/cli.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function destination() {
  const directory = await mkdtemp(join(tmpdir(), "wordcraft-doc-"));
  directories.push(directory);
  return join(directory, "document.docx");
}

function fakeDrive(
  source: () => Readable,
  called?: (params: { fileId: string; mimeType: string }) => void,
) {
  return {
    files: {
      export: async (params: { fileId: string; mimeType: string }) => {
        called?.(params);
        return { data: source() };
      },
    },
  } as unknown as drive_v3.Drive;
}

describe("Google Docs export for WordCraft", () => {
  test("saves a selected Docs API snapshot with tabs for offline use", async () => {
    const path = (await destination()).replace(/\.docx$/, ".json");
    const snapshot = {
      title: "Éditer",
      tabs: [
        {
          tabProperties: { title: "Page" },
          documentTab: { body: { content: [] } },
        },
      ],
    };
    let request: unknown;
    const docs = {
      documents: {
        get: async (params: unknown) => {
          request = params;
          return { data: snapshot };
        },
      },
    } as unknown as docs_v1.Docs;
    const result = await saveGoogleDocSnapshot(docs, "document-1", path);
    expect(request).toEqual({
      documentId: "document-1",
      includeTabsContent: true,
    });
    expect(await Bun.file(path).json()).toEqual(snapshot);
    expect(result.bytes).toBe((await Bun.file(path).arrayBuffer()).byteLength);
    await expect(
      saveGoogleDocSnapshot(docs, "document-1", path),
    ).rejects.toThrow();
    expect(await Bun.file(path).json()).toEqual(snapshot);
  });

  test("removes the local snapshot if the Docs API fails", async () => {
    const path = (await destination()).replace(/\.docx$/, ".json");
    const docs = {
      documents: {
        get: async () => {
          throw new Error("offline");
        },
      },
    } as unknown as docs_v1.Docs;
    await expect(
      saveGoogleDocSnapshot(docs, "document-1", path),
    ).rejects.toThrow("offline");
    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("projects a saved Google Docs snapshot without a network connection", () => {
    const snapshot = {
      body: {
        content: [
          {
            paragraph: {
              elements: [{ textRun: { content: "Local document\n" } }],
            },
          },
        ],
      },
    };
    expect(googleDocSnapshotToWordCraftMarkdown(snapshot)).toBe(
      "Local document\n",
    );
  });

  test("the Google CLI projects a saved snapshot offline and protects an existing output", async () => {
    const path = await destination();
    const snapshot = path.replace(/\.docx$/, ".json");
    const markdown = path.replace(/\.docx$/, ".md");
    await writeFile(
      snapshot,
      JSON.stringify({
        body: {
          content: [
            {
              paragraph: { elements: [{ textRun: { content: "Offline\n" } }] },
            },
          ],
        },
      }),
    );
    expect(await runGoogle(["docs", "project", snapshot, markdown])).toBe(0);
    expect(await Bun.file(markdown).text()).toBe("Offline\n");
    await expect(
      runGoogle(["docs", "project", snapshot, markdown]),
    ).rejects.toThrow();
    expect(await Bun.file(markdown).text()).toBe("Offline\n");
  });

  test("launches WordCraft with a local document as one argument", async () => {
    const path = await destination();
    await writeFile(path, "document");
    const binary = resolve(import.meta.dir, "wordcraft-test-binary");
    let command: unknown;
    const spawn = spyOn(Bun, "spawn").mockImplementation(((argv: unknown) => {
      command = argv;
      return { pid: 123, unref() {} };
    }) as typeof Bun.spawn);
    try {
      expect(await runGoogle(["docs", "open", path, "--binary", binary])).toBe(
        0,
      );
      expect(command).toEqual([binary, path]);
    } finally {
      spawn.mockRestore();
    }
  });

  test("yolo dispatches Docs offline projection without Google credentials", async () => {
    const path = await destination();
    const snapshot = path.replace(/\.docx$/, ".json");
    const markdown = path.replace(/\.docx$/, ".md");
    await writeFile(
      snapshot,
      JSON.stringify({
        body: {
          content: [
            {
              paragraph: { elements: [{ textRun: { content: "Via yolo\n" } }] },
            },
          ],
        },
      }),
    );
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../../yolo-cli/src/index.ts"),
        "google",
        "docs",
        "project",
        snapshot,
        markdown,
      ],
      {
        env: {
          ...process.env,
          APHRODY_GOOGLE_OAUTH_CLIENT_JSON: "",
          APHRODY_GOOGLE_OAUTH_TOKEN_JSON: "",
        },
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      },
    );
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("Saved offline projection");
    expect(stderr).toBe("");
    expect(await Bun.file(markdown).text()).toBe("Via yolo\n");
  });

  test("exports a selected document as DOCX to a new local file", async () => {
    const path = await destination();
    let request: { fileId: string; mimeType: string } | undefined;
    const drive = fakeDrive(
      () =>
        Readable.from([
          Buffer.from([0x50]),
          Buffer.from([0x4b, 0x03]),
          Buffer.from([0x04, 0x61, 0x62]),
        ]),
      (value) => {
        request = value;
      },
    );
    expect(await exportGoogleDocForWordCraft(drive, "doc-123", path)).toEqual({
      path,
      bytes: 6,
    });
    expect(request).toEqual({
      fileId: "doc-123",
      mimeType: WORDCRAFT_DOCX_MIME,
    });
    expect(await readFile(path)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x61, 0x62]),
    );
  });

  test("rejects non-ZIP exports and removes the partial file", async () => {
    const path = await destination();
    await expect(
      exportGoogleDocForWordCraft(
        fakeDrive(() => Readable.from([Buffer.from("<html>error</html>")])),
        "id",
        path,
      ),
    ).rejects.toThrow("not a ZIP package");
    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("does not overwrite existing documents", async () => {
    const path = await destination();
    await writeFile(path, "original");
    await expect(
      exportGoogleDocForWordCraft(
        fakeDrive(() => Readable.from([])),
        "id",
        path,
      ),
    ).rejects.toThrow();
    expect((await readFile(path)).toString()).toBe("original");
  });

  test("removes partial output when the stream fails or exceeds the limit", async () => {
    for (const source of [
      () =>
        Readable.from(
          (async function* () {
            yield Buffer.from("part");
            throw new Error("disconnected");
          })(),
        ),
      () => Readable.from([Buffer.alloc(32 * 1024 * 1024 + 1)]),
    ]) {
      const path = await destination();
      await expect(
        exportGoogleDocForWordCraft(fakeDrive(source), "id", path),
      ).rejects.toThrow();
      expect(await Bun.file(path).exists()).toBe(false);
    }
  });
});
