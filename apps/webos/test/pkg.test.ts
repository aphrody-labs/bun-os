// SPDX-License-Identifier: Apache-2.0
// App store registry over real HTTP: the package manager reads /registry.json and tracks installed versions.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { RegistryEntry } from "../src/pkg";

const entry = (id: string, version: string, category: RegistryEntry["category"]): RegistryEntry => ({
  id,
  name: id,
  version,
  category,
  description: id,
  license: "MIT",
  glyph: "apps",
  size: 10,
  manifest: `/pkg/${id}.json`,
});
const entries = [entry("doom", "2.0.0", "games"), entry("calc", "1.0.0", "tools")];

let server: ReturnType<typeof Bun.serve>;
const realFetch = globalThis.fetch;
let hits = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/registry.json") {
        hits++;
        return Response.json({ packages: entries });
      }
      return new Response("nf", { status: 404 });
    },
  });
  // The app fetches same-origin paths; point them at the test server.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(
      typeof input === "string" && input.startsWith("/") ? `http://127.0.0.1:${server.port}${input}` : input,
      init,
    )) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  server.stop(true);
});
beforeEach(() => localStorage.clear());

describe("package registry", () => {
  test("loads the packages once and caches them", async () => {
    const { registry } = await import("../src/pkg");
    expect((await registry()).map(e => e.id)).toEqual(["doom", "calc"]);
    await registry();
    expect(hits).toBe(1);
  });

  test("an installed package older than the registry needs an update; the current one does not", async () => {
    const { needsUpdate, installed } = await import("../src/pkg");
    localStorage.setItem(
      "aph.packages",
      JSON.stringify({
        doom: { version: "1.0.0", size: 10, at: "now" },
        calc: { version: "1.0.0", size: 5, at: "now" },
      }),
    );
    expect(Object.keys(installed()).sort()).toEqual(["calc", "doom"]);
    expect(needsUpdate(entries[0]!)).toBe(true);
    expect(needsUpdate(entries[1]!)).toBe(false);
  });

  test("a package that is not installed never needs an update", async () => {
    const { needsUpdate } = await import("../src/pkg");
    expect(needsUpdate(entries[0]!)).toBe(false);
  });
});
