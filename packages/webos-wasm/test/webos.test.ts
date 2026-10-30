// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { decodeSlot, encodeSlot, memoryImageStore, openWebOs, slotImageStore, type ImageStore } from "../src/index";

const wasm = await Bun.file(
  fileURLToPath(import.meta.resolve("@aphrody/webos-wasm/wasm/aphrody_webos_wasm_bg.wasm")),
).arrayBuffer();
const open = (store: ImageStore) => openWebOs({ store, wasm, flushDelayMs: 1 });
const sd = (path: string) => ({ Physical: { device_slug: "webos", path } });
const query = (method: string, payload: unknown) => ({
  Query: { method, library_id: null, payload },
});
const listing = (path: string) =>
  query("query:files.directory_listing", {
    path: sd(path),
    limit: null,
    include_hidden: null,
    sort_by: "name",
    folders_first: true,
  });

/** In-memory stand-in for an OPFS directory. */
function fakeDirectory() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async getFileHandle(name: string) {
      return {
        async getFile() {
          const data = files.get(name) ?? new Uint8Array();
          return { arrayBuffer: async () => data.slice().buffer };
        },
        async createWritable() {
          return {
            write: async (data: Uint8Array) => void files.set(name, Uint8Array.from(data)),
            close: async () => {},
          };
        },
      };
    },
  };
}

describe("slot format", () => {
  test("round-trips and rejects foreign bytes", () => {
    const decoded = decodeSlot(encodeSlot(7n, new Uint8Array([1, 2, 3])));
    expect(decoded?.sequence).toBe(7n);
    expect([...decoded!.image]).toEqual([1, 2, 3]);
    expect(decodeSlot(new Uint8Array(32))).toBeNull();
  });
});

describe("explorer backend in Rust WASM", () => {
  test("serves the library context the explorer boots with", async () => {
    const os = await open(memoryImageStore());
    const libs = (await os.rpc(query("query:libraries.list", {}))) as { json: { name: string }[] };
    expect(libs.json[0]?.name).toBe("Aphrody OS");
    const locs = (await os.rpc(query("query:locations.list", {}))) as {
      json: { locations: { name: string }[] };
    };
    expect(locs.json.locations[0]?.name).toBe("Home");
    expect(await os.rpc("Ping")).toBe("Pong");
    const unsupported = (await os.rpc(query("query:jobs.list", {}))) as { error: string };
    expect(unsupported.error).toContain("not served");
  });

  test("files written through the API are seen by the explorer and persist across reopen", async () => {
    const store = slotImageStore(fakeDirectory());
    const os = await open(store);
    expect(os.persistent).toBe(true);
    os.fs.write("/home/user/note.txt", new TextEncoder().encode("persisted\n"));
    const reply = (await os.rpc(listing("/home/user"))) as {
      json: { files: { name: string; size: number }[] };
    };
    expect(reply.json.files.map(f => f.name)).toContain("note.txt");
    expect(reply.json.files.find(f => f.name === "note.txt")?.size).toBe(10);
    await os.flush();

    const again = await open(store);
    expect(new TextDecoder().decode(again.fs.read("/home/user/note.txt"))).toBe("persisted\n");
    const found = (await again.rpc(query("query:search.files", { query: "note", scope: "Library" }))) as {
      json: { total_found: number };
    };
    expect(found.json.total_found).toBe(1);
  });

  test("rename and delete go through the Rust backend", async () => {
    const os = await open(memoryImageStore());
    os.fs.write("/home/user/a.txt", new TextEncoder().encode("a"));
    await os.rpc({
      Action: {
        method: "action:files.rename",
        library_id: null,
        payload: { target: sd("/home/user/a.txt"), new_name: "b.txt" },
      },
    });
    expect(new TextDecoder().decode(os.fs.read("/home/user/b.txt"))).toBe("a");
    await os.rpc({
      Action: {
        method: "action:files.delete",
        library_id: null,
        payload: { targets: { paths: [sd("/home/user/b.txt")] }, permanent: true, recursive: true },
      },
    });
    expect(() => os.fs.read("/home/user/b.txt")).toThrow();
  });

  test("triage runs on a file of the shared file system", async () => {
    const os = await open(memoryImageStore());
    os.fs.write("/home/user/blob", new TextEncoder().encode("\0\0\0hello-triage\0"));
    expect(os.fs.strings("/home/user/blob", 4, 10)).toContain("hello-triage");
    expect(JSON.parse(os.fs.triage("/home/user/blob"))).toBeObject();
  });

  test("language detection labels search hits", async () => {
    const os = await open(memoryImageStore());
    expect(os.detectLanguage("こんにちは")).toEqual({
      language: "ja",
      confidence: expect.any(Number),
      isReliable: true,
    });
    os.fs.write("/home/user/lettre.md", new TextEncoder().encode("# Lettre\n\nbonjour et merci pour le colis\n"));
    const hits = JSON.parse(os.fs.ragSearch("colis", 5)) as {
      results: { path: string; language: string }[];
    };
    expect(hits.results[0]).toMatchObject({ path: "/home/user/lettre.md", language: "fr" });
  });
});
