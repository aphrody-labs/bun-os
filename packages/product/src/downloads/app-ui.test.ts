// SPDX-License-Identifier: Apache-2.0
import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_UI_ROUTES, createHandler, publicRouteSeo, siteOptions } from "./server";

const workspace = mkdtempSync(join(tmpdir(), "aphrody-public-ui-"));
const root = join(workspace, "downloads");
const site = join(workspace, "site");
const ui = join(workspace, "ui");
for (const directory of [root, site, ui, join(ui, "fonts"), join(site, "docs")])
  mkdirSync(directory, { recursive: true });
writeFileSync(join(site, "index.html"), "original static home");
writeFileSync(join(site, "docs", "index.html"), "preserved Bun documentation");
writeFileSync(join(site, "runtime.html"), "preserved runtime page");
writeFileSync(join(site, "install"), "preserved installer");
writeFileSync(join(ui, "index.html"), '<html><head><base href="/"></head><body><div id="root"></div></body></html>');
writeFileSync(
  join(ui, "public-home.html"),
  '<html lang="en"><head><base href="/"><title>Aphrody</title></head><body><h1>Aphrody</h1><a href="/os">Open Aphrody OS</a></body></html>',
);
writeFileSync(join(ui, "app.js"), "app script");
writeFileSync(join(ui, "app.css"), "app style");
writeFileSync(join(ui, "fonts", "pet.webp"), "pet image");
const catalogue = [
  { id: "runtime-architecture", title: "runtime architecture" },
  { id: "bun-native-framework", title: "Bun native framework" },
  { id: "material-3-design-tokens", title: "Material 3 design tokens" },
  { id: "tauri-desktop-bridge", title: "Tauri desktop bridge" },
  { id: "llms-txt-standard", title: "llms.txt standard" },
];
writeFileSync(join(ui, "public-docs.json"), JSON.stringify(catalogue));
mkdirSync(join(ui, "public-docs"));
for (const article of catalogue)
  writeFileSync(
    join(ui, "public-docs", article.id + ".html"),
    `<html><head><base href="/"><title>${article.title}</title></head><body><article><h1>${article.title}</h1></article></body></html>`,
  );
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
const options = { SITE_ROOT: site, APP_UI_ROOT: ui };
const handler = createHandler(root, siteOptions(root, options));
const request = (path: string, method = "GET", host = "aphrody.com") =>
  handler(new Request(`https://${host}${path}`, { method }));

test("public UI integration is explicit and validates the complete artifact", async () => {
  const original = createHandler(root, siteOptions(root, { SITE_ROOT: site }));
  expect(await (await original(new Request("https://aphrody.com/"))).text()).toBe("original static home");
  expect(() => siteOptions(root, { SITE_ROOT: site, APP_UI_ROOT: workspace })).toThrow("complete canonical");
});
test("explicit declaration enables only the protected current artifact and env takes precedence", () => {
  const base = join(workspace, "declaration");
  const downloads = join(base, "downloads");
  const directory = join(base, "app-ui");
  const current = join(directory, "current");
  mkdirSync(downloads, { recursive: true });
  cpSync(ui, current, { recursive: true });
  expect(siteOptions(downloads, {}).appUiRoot).toBeUndefined();
  const declaration = join(directory, "deployment.json");
  writeFileSync(declaration, JSON.stringify({ schemaVersion: 1, root: "current" }));
  expect(siteOptions(downloads, {}).appUiRoot).toBe(current);
  for (const invalid of [
    "{}",
    "{",
    JSON.stringify({ schemaVersion: 2, root: "current" }),
    JSON.stringify({ schemaVersion: 1, root: "../ui" }),
    JSON.stringify({
      schemaVersion: 1,
      root: "current",
      proxy: "http://localhost",
    }),
  ]) {
    writeFileSync(declaration, invalid);
    expect(() => siteOptions(downloads, {})).toThrow("Invalid app-ui deployment declaration");
    expect(siteOptions(downloads, { APP_UI_ROOT: ui }).appUiRoot).toBe(ui);
  }
  writeFileSync(declaration, JSON.stringify({ schemaVersion: 1, root: "current" }));
  rmSync(current, { recursive: true });
  const release = join(directory, "releases", "verified-release");
  cpSync(ui, release, { recursive: true });
  symlinkSync(release, current, process.platform === "win32" ? "junction" : "dir");
  expect(siteOptions(downloads, {}).appUiRoot).toBe(release);
  rmSync(current, { recursive: true });
  symlinkSync(ui, current, process.platform === "win32" ? "junction" : "dir");
  expect(() => siteOptions(downloads, {})).toThrow("Invalid app-ui deployment declaration");
});
test("canonical homepage and OS serve namespaced assets without exposing native RPC", async () => {
  const home = await request("/");
  expect(home.status).toBe(200);
  expect(await home.text()).toContain('href="/_app-ui/"');
  const os = await request("/os");
  expect(await os.text()).toContain('name="aphrody-rpc" content="unavailable"');
  expect(os.headers.get("content-security-policy")).toContain("base-uri 'self'");
  expect(await (await request("/_app-ui/app.js")).text()).toBe("app script");
  expect((await request("/_app-ui/fonts/pet.webp")).headers.get("content-type")).toBe("image/webp");
  expect(await (await request("/os", "HEAD")).text()).toBe("");
  expect((await request("/rpc", "POST")).status).toBe(405);
});
test("public product catalogue preserves all five IDs and static Bun routes take precedence", async () => {
  const api = await request("/api/docs");
  expect(api.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(await api.json()).toEqual(catalogue);
  expect(catalogue).toHaveLength(5);
  const article = await request("/docs/runtime-architecture");
  expect(article.status).toBe(200);
  const articleHtml = await article.text();
  expect(articleHtml).toContain('href="/_app-ui/"');
  expect(articleHtml).toContain(`<title>${catalogue[0].title} · runtime architecture</title>`);
  expect(articleHtml).not.toContain("Aphrody OS — Browser workspace");
  expect(await (await request("/api/docs", "HEAD")).text()).toBe("");
  expect((await request("/api/docs", "POST")).status).toBe(405);
  expect((await request("/docs/not-a-product-article")).status).toBe(404);
  writeFileSync(join(site, "docs", "runtime-architecture.html"), "existing Bun page wins");
  expect(await (await request("/docs/runtime-architecture")).text()).toBe("existing Bun page wins");
});
test("static docs runtime installers and download host remain isolated", async () => {
  await Promise.all(
    [
      ["/docs", "preserved Bun documentation"],
      ["/runtime", "preserved runtime page"],
      ["/install", "preserved installer"],
    ].map(async ([path, expected]) => {
      expect(await (await request(path!)).text()).toBe(expected!);
    }),
  );
  expect((await request("/os", "GET", "downloads.aphrody.com")).status).toBe(404);
  expect((await request("/_app-ui/%2e%2e%2fsite/index.html")).status).toBe(404);
  expect((await request("/_app-ui/.env")).status).toBe(404);
});
test("public assets opt in by artifact manifest and CSP admits only the declared R2 origin", async () => {
  const origin = "https://assets.aphrody.app";
  const manifest = join(ui, "public-assets.json");
  writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, baseUrl: origin }));
  try {
    const publicHandler = createHandler(root, siteOptions(root, options));
    const response = await publicHandler(new Request("https://aphrody.com/"));
    expect(await response.text()).toContain(`name="aphrody-assets-base" content="${origin}"`);
    expect(response.headers.get("content-security-policy")).toContain(`font-src 'self' ${origin}`);
    expect(response.headers.get("content-security-policy")).not.toContain("*.r2.dev");
    writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, baseUrl: "https://other.example" }));
    expect(() => siteOptions(root, options)).toThrow("Unqualified app-ui public asset origin");
  } finally {
    rmSync(manifest);
  }
});

// oxlint-disable eslint/no-await-in-loop -- bounded fixture requests include ordered static precedence mutation
test("declared UI deep links reload, static pages precede shells, unknown routes remain 404", async () => {
  for (const path of [
    "/studio?section=google",
    "/templates",
    "/material-3/components",
    "/material-3/theme/",
    "/settings/appearance",
    "/os/",
  ]) {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('name="aphrody-rpc" content="unavailable"');
    expect(await (await request(path, "HEAD")).text()).toBe("");
    expect((await request(path, "POST")).status).toBe(405);
  }
  expect(await (await request("/docs")).text()).toBe("preserved Bun documentation");
  writeFileSync(join(site, "templates.html"), "preserved static templates");
  expect(await (await request("/templates")).text()).toBe("preserved static templates");
  for (const path of [
    "/unknown",
    "/material-3/unknown",
    "/studio/unknown",
    "/templates/unknown",
    "/sources/private-id",
  ])
    expect((await request(path)).status).toBe(404);
});
// oxlint-enable eslint/no-await-in-loop

test("public fallback declarations are explicit canonical routes", async () => {
  for (const route of APP_UI_ROUTES) {
    expect(publicRouteSeo(route).canonical).toBe(`https://aphrody.com${route}`);
    expect(publicRouteSeo(route).title).toContain("Aphrody");
  }
});

// oxlint-disable eslint/no-await-in-loop -- three bounded source-contract GET checks
test("public route metadata emits canonical titles and descriptions", async () => {
  for (const path of ["/studio", "/material-3/components", "/material-3/icons"]) {
    const response = await request(path);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(`<title>${publicRouteSeo(path).title}</title>`);
    expect(html).toContain(`rel="canonical" href="https://aphrody.com${path}"`);
    expect(html).toContain(`name="description" content="${publicRouteSeo(path).description}"`);
  }
  const studio = await (await request("/studio")).text();
  expect(studio).toContain("Connected native tools require the installed application.");
});
