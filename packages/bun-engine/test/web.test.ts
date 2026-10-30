import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createWorkspaceServer } from "../src/workspace";

/** A Chrome-family executable Bun.WebView can spawn: BUN_CHROME_PATH, PATH, or a standard install location. */
function chromeAvailable(): boolean {
  if (process.env.BUN_CHROME_PATH) return true;
  const names = [
    "google-chrome-stable",
    "google-chrome",
    "chromium-browser",
    "chromium",
    "brave-browser",
    "microsoft-edge",
    "chrome",
    "brave",
    "msedge",
  ];
  if (names.some(name => Bun.which(name))) return true;
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(
    Boolean,
  ) as string[];
  const relative = [
    "Google/Chrome/Application/chrome.exe",
    "Microsoft/Edge/Application/msedge.exe",
    "BraveSoftware/Brave-Browser/Application/brave.exe",
  ];
  return (
    roots.some(root => relative.some(path => existsSync(join(root, path)))) ||
    existsSync("/usr/bin/google-chrome") ||
    existsSync("/Applications/Google Chrome.app")
  );
}

let server: ReturnType<typeof createWorkspaceServer>;

beforeAll(() => {
  server = createWorkspaceServer({ port: 0 });
});

afterAll(() => {
  server.stop(true);
});

describe("Bun Engine web", () => {
  test("serves the app and workspace API concurrently", async () => {
    const [app, workspace] = await Promise.all([
      fetch(new URL("/", server.url)),
      fetch(new URL("/api/workspace", server.url)),
    ]);

    expect(app.status).toBe(200);
    expect(app.headers.get("content-type")).toContain("text/html");
    expect(await app.text()).toContain("Bun Engine");
    expect(workspace.status).toBe(200);
    expect(workspace.headers.get("content-type")).toContain("application/json");
    expect(await workspace.json()).toMatchObject({
      schema: 1,
      distribution: "unified",
    });
  });

  test("rejects an invalid configured port before starting a listener", () => {
    expect(() => createWorkspaceServer({ port: Number.NaN })).toThrow(/invalid Bun Engine web port/);
    expect(() => createWorkspaceServer({ port: 65_536 })).toThrow(/invalid Bun Engine web port/);
  });

  test.skipIf(!chromeAvailable())(
    "loads the workspace API through real Chrome tabs concurrently",
    async () => {
      const readSchema = async () => {
        await using view = new Bun.WebView({ width: 800, height: 600, backend: "chrome" });
        await view.navigate(server.url.href);
        return await view.evaluate(
          "fetch('/api/workspace').then(response => response.json()).then(value => value.schema)",
        );
      };
      expect(await Promise.all([readSchema(), readSchema()])).toEqual([1, 1]);
    },
    30_000,
  );
});
