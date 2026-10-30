// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageWorkspace } from "./workspace";
import { workspaceResponse } from "./services/workspace";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const html =
  '<!doctype html><base href="/workspace/"><script type="module" src="./app.js?v=1"></script><div id="root">Aphrody</div>';
describe("canonical workspace assembly", () => {
  test("stages an actual artifact and rejects an artifact for the wrong base", async () => {
    const root = await mkdtemp(join(tmpdir(), "aphrody-workspace-"));
    temporary.push(root);
    const source = join(root, "build/app-ui");
    const dist = join(root, "dist");
    await Bun.write(join(source, "index.html"), html);
    await Bun.write(join(source, "app.js"), "export const ready = true;");
    await Bun.write(
      join(source, "wasm/aphrody_webos_wasm_bg.wasm"),
      new Uint8Array([0, 97, 115, 109]),
    );
    await stageWorkspace(dist, root, source);
    expect(await Bun.file(join(dist, "workspace/index.html")).text()).toBe(
      html,
    );
    await Bun.write(
      join(source, "index.html"),
      html.replace("/workspace/", "/"),
    );
    await expect(stageWorkspace(dist, root, source)).rejects.toThrow(
      "--base /workspace/",
    );
  });
  test("refuses a missing real UI instead of silently staging the desktop as its replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "aphrody-workspace-"));
    temporary.push(root);
    await expect(
      stageWorkspace(join(root, "dist"), root, join(root, "absent")),
    ).rejects.toThrow("Missing App UI artifact");
  });
});
describe("workspace HTTP boundary", () => {
  test("deep navigation selects the workspace shell and HEAD returns no body", async () => {
    const seen: string[] = [];
    const assets = {
      async fetch(request: Request) {
        seen.push(new URL(request.url).pathname);
        return new Response(html, { headers: { "content-type": "text/html" } });
      },
    };
    const response = await workspaceResponse(
      new Request("https://aphrody.com/workspace/chat/thread-1"),
      assets,
    );
    expect(await response.text()).toBe(html);
    expect(seen).toEqual(["/workspace/index.html"]);
    const head = await workspaceResponse(
      new Request("https://aphrody.com/workspace/os", { method: "HEAD" }),
      assets,
    );
    expect(await head.text()).toBe("");
  });
  test("missing workspace and script assets never receive the desktop SPA fallback", async () => {
    const assets = {
      async fetch() {
        return new Response("<html>Desktop</html>", {
          headers: { "content-type": "text/html" },
        });
      },
    };
    expect(
      (
        await workspaceResponse(
          new Request("https://aphrody.com/workspace/os"),
          assets,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await workspaceResponse(
          new Request("https://aphrody.com/workspace/missing.js"),
          assets,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await workspaceResponse(
          new Request("https://aphrody.com/workspace/index.html"),
          assets,
        )
      ).status,
    ).toBe(503);
  });
  test("redirect preserves the query and write methods are rejected", async () => {
    const assets = {
      async fetch() {
        throw new Error("Unexpected asset request");
      },
    };
    const redirect = await workspaceResponse(
      new Request("https://aphrody.com/workspace?backend=http"),
      assets,
    );
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe(
      "https://aphrody.com/workspace/?backend=http",
    );
    expect(
      (
        await workspaceResponse(
          new Request("https://aphrody.com/workspace/os", { method: "POST" }),
          assets,
        )
      ).status,
    ).toBe(405);
  });
});
