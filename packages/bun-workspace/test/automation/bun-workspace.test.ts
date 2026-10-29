// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { firstPartyManifests } from "@aphrody/update/manifests";
import {
  checkManifest,
  M3_FAMILY,
  minimumBun,
  parseTsconfigExtends,
  run,
  staleInstallEntries,
} from "../../src/automation/bun-workspace.ts";

const root = {
  packageManager: "bun@1.4.2",
  workspaces: { catalog: { zod: "^4.6.4", typescript: "^7.0.2" } },
  aphrody: { m3Version: "3.3.0" },
};

describe("bun workspace contract", () => {
  test("minimum Bun comes from the root packageManager", () => {
    expect(minimumBun("bun@1.4.2")).toBe(">=1.4.2");
    expect(minimumBun("bun@1.4.3-aphrody.4")).toBe(">=1.4.3");
    expect(minimumBun("bun@1.4.3-aphrody.4", "1.4.3-aphrody.4")).toBe(">=1.4.3-aphrody.4");
    expect(minimumBun("bun@1.4.3-aphrody.4+41211b568", "1.4.3-aphrody.4")).toBe(">=1.4.3-aphrody.4");
    expect(() => minimumBun("bun@1.4.3-aphrody.4", "1.4.3-aphrody.3")).toThrow();
    expect(() => minimumBun("pnpm@9.0.0")).toThrow();
    expect(() => minimumBun("bun@1.4.3-invalid!")).toThrow();
    expect(() => minimumBun("bun@1.4.3 trailing")).toThrow();
  });

  test("tsconfig JSONC comments are parsed when reading the extends field", () => {
    expect(
      parseTsconfigExtends(
        '{\n  "extends": "../../tsconfig.json", // supported JSONC comment\n  "compilerOptions": {}\n}',
      ),
    ).toBe("../../tsconfig.json");
    expect(parseTsconfigExtends('{"compilerOptions": {}}')).toBeUndefined();
  });

  test("compliant manifest has no violation", () => {
    const manifest = {
      name: "@aphrody/os",
      engines: { bun: ">=1.4.2" },
      scripts: { typecheck: "bun check", test: "bun test" },
      dependencies: { zod: "catalog:", x: "workspace:*" },
    };
    expect(checkManifest("p", manifest, root, { hasTsconfig: true })).toEqual([]);
  });

  test("a qualified fork contract preserves the required fork version", () => {
    const forkRoot = { ...root, packageManager: "bun@1.4.3-aphrody.4" };
    const manifest = {
      name: "@fixture/db",
      engines: { bun: ">=1.4.3-aphrody.4" },
    };
    const context = {
      hasTsconfig: false,
      bunRuntimeVersion: "1.4.3-aphrody.4",
    };
    expect(checkManifest("p", manifest, forkRoot, context)).toEqual([]);
    manifest.engines.bun = ">=1.4.3";
    expect(checkManifest("p", manifest, forkRoot, context).map(violation => violation.rule)).toEqual(["engines"]);
  });

  test("named catalogs satisfy the centralized dependency contract", () => {
    const catalogRoot = {
      ...root,
      workspaces: {
        ...root.workspaces,
        catalogs: { drive: { tailwindcss: "^3.4.15" } },
      },
    };
    const manifest = {
      name: "@aphrody/drive-web",
      engines: { bun: ">=1.4.2" },
      scripts: { typecheck: "bun check" },
      dependencies: { tailwindcss: "catalog:drive" },
    };
    expect(
      checkManifest("drive/apps/web", manifest, catalogRoot, {
        hasTsconfig: true,
      }),
    ).toEqual([]);
  });

  test("Bun OS root catalogs, exact engines and product version are authoritative", () => {
    expect(
      checkManifest(
        "packages/m3/package.json",
        {
          name: "@aphrody/m3",
          version: "1.4.4",
          engines: { bun: "1.4.4" },
          dependencies: { zod: "catalog:" },
        },
        {
          version: "1.4.4",
          packageManager: "bun@1.4.4",
          engines: { bun: "=1.4.4" },
          catalog: { zod: "^4.6.4" },
        },
        { hasTsconfig: false },
      ),
    ).toEqual([]);
  });

  test("every rule fires and --fix repairs the fixable ones", () => {
    const manifest: Record<string, any> = {
      name: "@aphrody/os",
      packageManager: "bun@1.3.0",
      engines: { node: ">=18", bun: ">=1.3.0" },
      scripts: {
        gen: "node gen.mjs",
        pre: "npx only-allow bun",
        ok: "bun run nodemon-free",
      },
      devDependencies: { typescript: "^5.6.2", other: "^1.0.0" },
    };
    const found = checkManifest("p", manifest, root, {
      hasTsconfig: true,
      fix: true,
    });
    expect(found.map(v => v.rule).toSorted()).toEqual([
      "catalog",
      "engines",
      "engines",
      "pm",
      "scripts",
      "scripts",
      "typecheck",
    ]);
    expect(found.filter(v => !v.fixable)).toHaveLength(2);
    expect(manifest.packageManager).toBeUndefined();
    expect(manifest.engines).toEqual({ bun: ">=1.4.2" });
    expect(manifest.devDependencies).toEqual({
      typescript: "catalog:",
      other: "^1.0.0",
    });
    expect(checkManifest("p", manifest, root, { hasTsconfig: true }).map(v => v.rule)).toEqual(["scripts", "scripts"]);
  });

  test("the M3 family is versioned in lockstep and extends the shared presets", () => {
    for (const name of ["@aphrody/m3", "@aphrody/m3-tokens", "@aphrody/m3-react", "@aphrody/material-web"]) {
      expect(M3_FAMILY.test(name)).toBe(true);
    }
    for (const name of ["@aphrody/os", "@aphrody/canvas", "@aphrody/bun", "@spacedrive/primitives"])
      expect(M3_FAMILY.test(name)).toBe(false);

    const manifest: Record<string, any> = {
      name: "@aphrody/m3-forms",
      version: "0.1.0",
      engines: { bun: ">=1.4.2" },
      scripts: { typecheck: "bun check --noEmit" },
    };
    const found = checkManifest("p", manifest, root, {
      hasTsconfig: true,
      tsconfigExtends: "./base.json",
      hasDevTsconfig: true,
      fix: true,
    });
    expect(found.map(v => [v.rule, v.fixable])).toEqual([
      ["m3", true],
      ["m3", false],
      ["m3", false],
    ]);
    expect(manifest.version).toBe("3.3.0");
    expect(
      checkManifest("p", manifest, root, {
        hasTsconfig: true,
        tsconfigExtends: "@aphrody/m3-config/tsconfig.json",
      }),
    ).toEqual([]);
    // material-web keeps its own tsconfig; the FFI package extends the root base.
    expect(
      checkManifest("p", { ...manifest, name: "@aphrody/material-web" }, root, {
        hasTsconfig: true,
        tsconfigExtends: "./tsconfig.base.json",
      }),
    ).toEqual([]);
    // Private showcases are never published: no lockstep.
    expect(
      checkManifest(
        "p",
        {
          name: "@aphrody/m3-showcase",
          private: true,
          version: "0.0.0",
          engines: { bun: ">=1.4.2" },
        },
        root,
        { hasTsconfig: false },
      ),
    ).toEqual([]);
    expect(() => checkManifest("p", manifest, { ...root, aphrody: undefined }, { hasTsconfig: false })).toThrow(
      /m3Version/,
    );
  });

  test("a real package directory under node_modules is a stale install", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bun-install-"));
    try {
      const store = join(dir, "store");
      await Promise.all(
        ["store/react", "node_modules/.bin", "node_modules/react-dom", "node_modules/@scope/real"].map(p =>
          mkdir(join(dir, p), { recursive: true }),
        ),
      );
      await symlink(join(store, "react"), join(dir, "node_modules/react"), "junction");
      await symlink(join(store, "react"), join(dir, "node_modules/@scope/linked"), "junction");
      expect(await staleInstallEntries(dir)).toEqual(["@scope/real", "react-dom"]);
      expect(await staleInstallEntries(join(dir, "missing"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the repository itself satisfies the contract", async () => {
    const repo = resolve(import.meta.dir, "../../../..");
    const manifests = await firstPartyManifests(repo);
    expect(manifests).toContain("packages/bun-workspace/package.json");
    expect(manifests.some(p => p.startsWith("upstream/"))).toBe(false);
    expect(await run(repo, false)).toEqual([]);
  }, 30_000);
});
