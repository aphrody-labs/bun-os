// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTar } from "../../src/automation/canonical-tar.ts";
import {
  aphrodyClosure,
  archiveName,
  assertPublicEntries,
  auditArchive,
  embedExternalImports,
  exportTargets,
  portableArchive,
  publishAphrodyPackages,
  staleArchives,
  type AphrodyPackagesManifest,
} from "../../src/automation/aphrody-packages.ts";

const root = join(import.meta.dir, "../../../..");

test("reserved registry timestamps do not imply approval or allow dependent publication", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "aphrody-registry-visibility-"));
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      Response.json({
        versions: {},
        time: { "1.0.0": "2026-10-10T00:00:00Z" },
      }),
  });
  try {
    await writeFile(join(fixture, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    await Promise.all(
      ["base", "consumer"].map(async name => {
        const directory = join(fixture, "packages", name);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "index.js"), "export const ok = true;\n");
        await writeFile(
          join(directory, "package.json"),
          JSON.stringify({
            name: `@aphrody/${name}`,
            version: "1.0.0",
            exports: "./index.js",
            ...(name === "consumer" ? { dependencies: { "@aphrody/base": "1.0.0" } } : {}),
          }),
        );
      }),
    );
    for (const args of [
      ["init", "--quiet"],
      ["add", "package.json", "packages"],
    ]) {
      const initialized = Bun.spawnSync(["git", ...args], {
        cwd: fixture,
        windowsHide: true,
      });
      if (initialized.exitCode !== 0) throw new Error("registry fixture Git initialization failed");
    }
    const results = await publishAphrodyPackages({
      root: fixture,
      registry: server.url.origin,
    });
    expect(results.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: "@aphrody/base", status: "unverified" },
      { name: "@aphrody/consumer", status: "blocked" },
    ]);
    expect(results[0]!.detail).not.toContain("approval");
    expect(results[1]!.detail).toContain("@aphrody/base");
  } finally {
    server.stop(true);
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);

test("export targets cover every condition, main and module, but not patterns", () => {
  expect(
    exportTargets({
      version: "1.0.0",
      exports: {
        ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" },
        "./*": "./src/*.ts",
      },
      main: "./main.js",
    }).toSorted(),
  ).toEqual(["dist/index.d.mts", "dist/index.mjs", "main.js"]);
});

test("the closure packs the runtime SDK as a workspace member and leaves sibling-checkout members external", async () => {
  const { members, external } = await aphrodyClosure(root, ["@aphrody/yolo-core"]);
  expect(members.map(member => member.name)).toEqual(["@aphrody/paths", "@aphrody/runtime-sdk", "@aphrody/yolo-core"]);
  // The Bun runtime SDK is published from its own repository.
  expect(external).toEqual(["@aphrody/bun-runtime-sdk"]);
  expect(await aphrodyClosure(root, ["@aphrody/bun-web"])).toEqual({
    members: [],
    external: ["@aphrody/bun-web"],
  });
});

test("archive names are content addressed and pins detect missing or changed archives", async () => {
  const bytes = new TextEncoder().encode("archive");
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  expect(archiveName("@aphrody/paths", sha256)).toBe(`aphrody-paths-${sha256.slice(0, 16)}.tgz`);
  const directory = await mkdtemp(join(tmpdir(), "aphrody-packages-test-"));
  try {
    const pin: AphrodyPackagesManifest = {
      schemaVersion: 1,
      producer: "aphrody",
      revision: "0".repeat(40),
      dirty: false,
      packages: [
        { name: "@aphrody/paths", version: "0.1.0", archive: "a.tgz", sha256 },
        { name: "@aphrody/x", version: "1.0.0", archive: "b.tgz", sha256 },
      ],
      external: [],
    };
    await writeFile(join(directory, "a.tgz"), bytes);
    await writeFile(join(directory, "b.tgz"), "changed");
    expect(await staleArchives(pin, directory)).toEqual(["@aphrody/x"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const read = (archive: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(readTar(Bun.gunzipSync(new Uint8Array(archive)))[0]!.data));

test("portable archives replace producer-relative file: specs with the pinned version", () => {
  const encoder = new TextEncoder();
  const manifest = (dependencies: Record<string, string>) => {
    const data = encoder.encode(JSON.stringify({ name: "@aphrody/a", dependencies }));
    return [
      {
        name: "package/package.json",
        type: "file" as const,
        mode: 0o644,
        size: data.length,
        data,
      },
    ];
  };
  const pinned = new Map([["@aphrody/runtime-sdk", "0.1.0"]]);
  expect(
    read(portableArchive(manifest({ "@aphrody/runtime-sdk": "file:.cache/sdk.tgz", zod: "^4" }), pinned, "@aphrody/a"))
      .dependencies,
  ).toEqual({ "@aphrody/runtime-sdk": "0.1.0", zod: "^4" });
  expect(() => portableArchive(manifest({ other: "file:x.tgz" }), pinned, "@aphrody/a")).toThrow("unpinned");
});

const sourceEntry = (text: string) => {
  const data = new TextEncoder().encode(text);
  return {
    name: "package/src/config/catalog.ts",
    type: "file" as const,
    mode: 0o644,
    size: data.length,
    data,
  };
};

test("JSON imported from outside the package is embedded and its specifier rewritten", async () => {
  const repository = await mkdtemp(join(tmpdir(), "aphrody-packages-external-"));
  try {
    const packageDirectory = join(repository, "packages/web/x");
    await mkdir(join(repository, "crates/web/x/data"), { recursive: true });
    await writeFile(join(repository, "crates/web/x/data/catalog.json"), '{"operations":{}}');
    const entries = await embedExternalImports(
      [sourceEntry('import data from "../../../../../crates/web/x/data/catalog.json";\nimport x from "./x.ts";\n')],
      packageDirectory,
      repository,
    );
    expect(entries.map(entry => entry.name)).toEqual([
      "package/src/config/catalog.ts",
      "package/.aphrody-external/crates/web/x/data/catalog.json",
    ]);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe(
      'import data from "../../.aphrody-external/crates/web/x/data/catalog.json";\nimport x from "./x.ts";\n',
    );
    await expect(
      embedExternalImports([sourceEntry('import y from "../../../other/src/y.ts";')], packageDirectory, repository),
    ).rejects.toThrow("outside its package");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

const entry = (name: string) => ({
  name,
  type: "file" as const,
  mode: 0o644,
  size: 0,
  data: new Uint8Array(),
});

test("private or traversing entries are refused", () => {
  expect(() => assertPublicEntries([entry("package/src/index.ts")], "@aphrody/a")).not.toThrow();
  for (const name of [
    "package/.env",
    "package/.env.local",
    "package/.npmrc",
    "package/keys/a.pem",
    "package/data/game.cpk",
    "other/x.ts",
    "package/../x",
  ])
    expect(() => assertPublicEntries([entry(name)], "@aphrody/a")).toThrow("private or unsafe");
});

const member = (name: string, text: string) => {
  const data = new TextEncoder().encode(text);
  return { name, type: "file" as const, mode: 0o644, size: data.length, data };
};

test("publication audit refuses unshipped exports, workspace specs, credentials and host paths", () => {
  const manifest = (value: object) => member("package/package.json", JSON.stringify(value));
  expect(
    auditArchive(
      [manifest({ version: "1.0.0", exports: "./src/index.ts" }), member("package/src/index.ts", "")],
      "@aphrody/a",
    ),
  ).toEqual([]);
  const problems = auditArchive(
    [
      manifest({
        version: "1.0.0",
        exports: { bun: "./guest-js/index.ts" },
        dependencies: { "@aphrody/b": "workspace:*" },
      }),
      member("package/dist/a.js", 'const t = "npm_' + "a".repeat(36) + '";'),
      member("package/dist/b.js", "// built in /home/aphro/aphrody"),
    ],
    "@aphrody/a",
  );
  expect(problems.join("\n")).toContain("exports not shipped: guest-js/index.ts");
  expect(problems.join("\n")).toContain("unpublishable spec @aphrody/b@workspace:*");
  expect(problems.join("\n")).toContain("credential-like text in package/dist/a.js");
  expect(problems.join("\n")).toContain("host path in package/dist/b.js");
});
