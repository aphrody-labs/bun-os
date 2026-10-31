// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { testContext } from "../admin/helpers.ts";
import { main, parseRoles } from "../../src/setup/cli.ts";
import { R2_DIST } from "../../src/setup/r2.ts";
import { DEFAULT_BASE, MARKETPLACE, marketplaceJson, setupDirs, stepPlugins, stepsFor } from "../../src/setup/steps.ts";

const BASE = DEFAULT_BASE;
const touch = (path: string, text = "x") => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** A tar.gz holding one file, the format the publisher writes for plugins. */
function tarGz(name: string, content: string): Uint8Array {
  const header = new Uint8Array(512);
  const put = (text: string, at: number) => header.set(new TextEncoder().encode(text), at);
  put(name, 0);
  put("0000644\0", 100);
  put(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
  put("00000000000\0", 136);
  header[156] = 48;
  put("ustar\0", 257);
  put("        ", 148);
  const sum = header.reduce((a, b) => a + b, 0);
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const body = new Uint8Array(Math.ceil(content.length / 512) * 512);
  body.set(new TextEncoder().encode(content));
  const tar = new Uint8Array(512 + body.length + 1024);
  tar.set(header);
  tar.set(body, 512);
  return Bun.gzipSync(tar);
}

function site(files: Record<string, { name: string; bytes: Uint8Array; version?: string; platform?: string }>) {
  const artifacts = Object.entries(files).map(([file, { name, bytes, version, platform }]) => ({
    name,
    version: version ?? "1.0.0",
    platform: platform ?? "windows-x86_64",
    url: `${BASE}/files/${file}`,
    sha256: sha(bytes),
    size: bytes.length,
    file,
  }));
  const sums = artifacts.map(a => `${a.sha256}  ${a.file}`).join("\n");
  return async (input: string | URL | Request) => {
    const r2Url = String(input);
    if (r2Url.startsWith(`${R2_DIST}/`)) {
      const product = r2Url.includes("/bun/") ? "bun" : "aphrody";
      const archive = `${product}-windows-x64.zip`;
      const hash = "a".repeat(64);
      if (r2Url.endsWith("SHA256SUMS.txt")) return new Response(`${hash}  ${archive}`);
      return new Response(
        JSON.stringify({
          product,
          version: "1.0.0",
          platform: "windows-x64",
          archive,
          sha256: hash,
          ...(product === "bun"
            ? { binary: "bun-windows-x64/bun.exe", aliases: ["bun", "bunx"] }
            : {
                binaries: ["aphrody-windows-x64/aphrody.exe", "aphrody-windows-x64/aphrody-site.exe"],
                aliases: ["aphrody"],
              }),
        }),
      );
    }
    const url = String(input);
    if (url === "https://creator.aphrody.com/latest.json")
      return Response.json({
        schemaVersion: 1,
        name: "creator-kit",
        version: "0.2.4",
        releasedAt: "r",
        artifacts: [
          {
            id: "u",
            kind: "update",
            format: "tar.gz",
            platform: "windows-x64",
            file: "creator-kit.tar.gz",
            url: "https://creator.aphrody.com/creator-kit.tar.gz",
            sha256: "0".repeat(64),
            size: 1,
          },
        ],
      });
    if (url.endsWith("/latest.json"))
      return Response.json({
        schemaVersion: 1,
        release: { id: "r" },
        baseUrl: BASE,
        artifacts,
      });
    if (url.endsWith("/SHA256SUMS")) return new Response(sums);
    const file = url.split("/files/")[1];
    if (file && files[file]) return new Response(new Uint8Array(files[file]!.bytes).buffer);
    return new Response("nope", { status: 404 });
  };
}

test("roles parse in French and English, unknown roles are refused", () => {
  expect([...parseRoles("admin, createur")]).toEqual(["admin", "createur"]);
  expect([...parseRoles("creator")]).toEqual(["createur"]);
  expect(() => parseRoles("root")).toThrow("rôle inconnu");
  const base = stepsFor(new Set()).map(step => step.id);
  expect(base).toEqual(["setup", "aphrody", "plugins", "mcp", "raccourci"]);
  expect(stepsFor(new Set(["admin"])).map(s => s.id)).toContain("admin-tools");
  expect(stepsFor(new Set(["admin"])).map(s => s.id)).toContain("acces");
  expect(
    stepsFor(new Set(["createur"]))
      .map(s => s.id)
      .at(-1),
  ).toBe("creator-tools");
});

test("plugins land in a local Claude Code marketplace and are installed through the claude CLI", async () => {
  const files = Object.fromEntries(
    ["aphrody", "yolo"].map(name => [
      `plugin-${name}-2.2.0-abc.tar.gz`,
      {
        name: `plugin-${name}`,
        platform: "any",
        bytes: tarGz("README.md", `# ${name}`),
      },
    ]),
  );
  const { ctx, sys } = testContext({ fetchImpl: site(files) });
  touch(join(ctx.paths.home, ".local", "bin", "claude.exe"));
  sys.handlers.push({ match: /.*/, result: {} });
  const result = await stepPlugins.run(ctx, "executer", { repoReady: false });
  expect(result.state).toBe("fait");
  const root = setupDirs(ctx).plugins;
  expect(readFileSync(join(root, "plugin-yolo", "README.md"), "utf8")).toBe("# yolo");
  expect(JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8")).plugins).toEqual([
    { name: "aphrody", source: "./plugin-aphrody" },
    { name: "yolo", source: "./plugin-yolo" },
  ]);
  const lines = sys.calls.map(call => call.argv.slice(1).join(" "));
  expect(lines[0]).toBe(`plugin marketplace add ${root} --scope user`);
  expect(lines).toContain(`plugin install aphrody@${MARKETPLACE} --scope user`);
  expect(marketplaceJson([])).toContain(MARKETPLACE);
});

test("--oui --simuler changes nothing and reports every step", async () => {
  const { ctx, ui, sys } = testContext({
    fetchImpl: site({}),
    interactive: false,
  });
  expect(
    await main(["--oui", "--simuler", "--roles", "createur"], {
      ...ctx,
      version: "0.1.0",
    }),
  ).toBe(0);
  const text = ui.lines.join("\n");
  for (const title of ["aphrody", "Application Aphrody", "Plugins Claude", "Outils créateur"])
    expect(text).toContain(title);
  expect(sys.calls.filter(call => call.argv[0] !== "powershell")).toEqual([]);
  expect(existsSync(setupDirs(ctx).plugins)).toBe(false);
});

test("the wizard asks the two roles and can stop before anything is done", async () => {
  const { ctx, ui, sys } = testContext({
    fetchImpl: site({}),
    answers: ["n", "n", "n"],
  });
  expect(await main([], ctx)).toBe(0);
  expect(ui.questions).toHaveLength(3);
  expect(ui.lines.join("\n")).toContain("Rien n'a été modifié");
  expect(sys.calls).toEqual([]);
});
