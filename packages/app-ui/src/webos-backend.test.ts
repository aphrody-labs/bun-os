// SPDX-License-Identifier: Apache-2.0
// oxlint-disable-next-line import/no-unassigned-import -- the source package bunfig preload: registers the DOM before UI imports
import "../test/dom-preload.ts";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { fileURLToPath } from "node:url";
import { memoryImageStore, openWebOs } from "@aphrody/webos-wasm";
import {
  setWebOsForTesting,
  wantsHttpBackend,
  webOsRagSearch,
  webOsReadDir,
  webOsReadText,
  webOsRagStats,
  webOsTransport,
  usesBrowserBackend,
} from "./webos-backend";
import { keyToInput } from "./routes/terminal/keys.ts";

const wasm = await Bun.file(
  fileURLToPath(import.meta.resolve("@aphrody/webos-wasm/wasm/aphrody_webos_wasm_bg.wasm")),
).arrayBuffer();

beforeEach(() => {
  setUrl("/");
  setWebOsForTesting(openWebOs({ store: memoryImageStore(), wasm, flushDelayMs: 1 }));
});
afterEach(() => setWebOsForTesting(undefined));
// The DOM preload replaces WebSocket and other globals; later test files in the same run need the native ones.
afterAll(() => GlobalRegistrator.unregister());

const setUrl = (path: string) =>
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://localhost${path}`);
const sd = (path: string) => ({ Physical: { device_slug: "webos", path } });
const text = (value: string) => new TextEncoder().encode(value);

test("outside Tauri the Rust backend is used unless ?backend=http", () => {
  expect(usesBrowserBackend()).toBe(true);
  expect(wantsHttpBackend("?backend=http")).toBe(true);
  setUrl("/?backend=http");
  expect(usesBrowserBackend()).toBe(false);
});

test("Files commands read the WASM file system", async () => {
  const os = await (await import("./webos-backend")).getWebOs();
  os.fs.write("/home/user/docs/a.txt", text("alpha"));
  const listing = await webOsReadDir("/home/user/docs");
  expect(listing.entries).toEqual([{ name: "a.txt", path: "/home/user/docs/a.txt", is_dir: false, size: 5 }]);
  expect((await webOsReadDir("/home/user")).entries.map(e => e.name)).toContain("docs");
  expect((await webOsReadText("/home/user/docs/a.txt")).content).toBe("alpha");
});

test("RAG search and stats come from the Rust module", async () => {
  const os = await (await import("./webos-backend")).getWebOs();
  os.fs.write("/home/user/zebra.md", text("# Zebra\n\nStripes help a zebra confuse predators.\n"));
  os.fs.write("/home/user/other.md", text("# Other\n\nNothing relevant here.\n"));
  const results = await webOsRagSearch("zebra stripes", 3);
  expect(results[0]?.path).toBe("/home/user/zebra.md");
  expect(results[0]?.content).toContain("Stripes");
  expect(results[0]?.language).toBe("en");
  expect((await webOsRagSearch("zebra", 1)).length).toBe(1);
  expect(await webOsRagStats()).toEqual({ documents: 2, chunks: 2 });
});

test("the explorer wire protocol lists, renames and deletes through the Rust VFS", async () => {
  const transport = webOsTransport();
  const call = async (kind: "Query" | "Action", method: string, payload: unknown) => {
    const reply = (await transport.sendRequest({ [kind]: { method, library_id: null, payload } })) as {
      json?: unknown;
      error?: string;
    };
    if (reply.error) throw new Error(reply.error);
    return reply.json;
  };
  const os = await (await import("./webos-backend")).getWebOs();
  os.fs.mkdir("/home/user/photos");
  os.fs.write("/home/user/photos/note.txt", new TextEncoder().encode("hi\n"));
  const listing = (await call("Query", "query:files.directory_listing", {
    path: sd("/home/user"),
    limit: null,
    include_hidden: null,
    sort_by: "name",
    folders_first: true,
  })) as { files: { name: string; kind: string }[] };
  expect(listing.files.map(f => [f.name, f.kind])).toEqual([["photos", "Directory"]]);
  await call("Action", "action:files.rename", { target: sd("/home/user/photos/note.txt"), new_name: "renamed.txt" });
  expect(new TextDecoder().decode(os.fs.read("/home/user/photos/renamed.txt"))).toBe("hi\n");
  await call("Action", "action:files.delete", {
    targets: { paths: [sd("/home/user/photos")] },
    permanent: true,
    recursive: true,
  });
  await expect(
    call("Query", "query:files.directory_listing", {
      path: sd("/home/user/photos"),
      limit: null,
      include_hidden: null,
      sort_by: "name",
      folders_first: null,
    }),
  ).rejects.toThrow();
});

const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
  keyToInput({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

test("terminal key mapping", () => {
  expect(key("a")).toBe("a");
  expect(key("Enter")).toBe("\r");
  expect(key("ArrowUp")).toBe("\x1b[A");
  expect(key("c", { ctrlKey: true })).toBe("\x03");
  expect(key("c", { metaKey: true })).toBeNull();
  expect(key("Shift")).toBeNull();
});
