// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type CargoPackage,
  literalKeyFiles,
  owners,
  qualificationPlan,
  verifyStatic,
} from "./verify-google-pipeline.ts";

/** A disposable temporary directory seeded with files (paths relative to it). */
function tempDir(prefix: string, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return Object.assign(new String(root), {
    [Symbol.dispose]: () => rmSync(root, { recursive: true, force: true }),
  });
}

function fixture(root: string) {
  const paths = owners(root);
  const write = (file: string, text: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write(
    join(root, "package.json"),
    JSON.stringify({
      workspaces: ["./packages/*"],
    }),
  );
  for (const file of [
    join(paths.googleWorkspace, "Cargo.toml"),
    paths.cargoManifest,
    paths.rustCli,
    paths.boqManifest,
    join(dirname(paths.boqManifest), "src/lib.rs"),
    paths.facadeEntry,
  ])
    write(file, "");
  write(
    paths.facadeManifest,
    JSON.stringify({ name: "@aphrody/google", scripts: { test: "fixture", build: "fixture", verify: "fixture" } }),
  );
  const packages: CargoPackage[] = [
    {
      name: "aphrody-google",
      manifest_path: paths.cargoManifest,
      targets: [{ name: "aphrody_google", kind: ["lib"] }],
    },
    { name: "aphrody-boq", manifest_path: paths.boqManifest, targets: [{ name: "aphrody_boq", kind: ["lib"] }] },
  ];
  return { paths, packages, metadata: () => packages };
}

test("standalone Google ownership needs no neighbouring checkout, Python or application multicall", () => {
  using directory = tempDir("google-pipeline-owners", {});
  const { paths, metadata } = fixture(String(directory));
  const result = verifyStatic(paths, metadata);
  expect(result.crates).toEqual(["aphrody-boq", "aphrody-google"]);
  expect(paths.root).toBe(String(directory));
});

test("rejects Cargo metadata claiming Google sources from another owner", () => {
  using directory = tempDir("google-pipeline-wrong-owner", {});
  const { paths, packages, metadata } = fixture(String(directory));
  packages[0]!.manifest_path = join(String(directory), "wrong-owner/Cargo.toml");
  expect(() => verifyStatic(paths, metadata)).toThrow(
    `Cargo package aphrody-google is not owned by ${paths.cargoManifest}.`,
  );
});

test("finds literal key assignments while leaving protected stores and fixture data alone", () => {
  using directory = tempDir("google-pipeline-keys", {
    "ok.ts": "const key = process.env.GEMINI_API_KEY;\n",
    "nested/bad.rs": `// GOOGLE_API_KEY${"="}placeholder\n`,
    "notes.md": `GEMINI_API_KEY${"="}placeholder\n`,
    "node_modules/mock/bad.ts": `GOOGLE_API_KEY${"="}synthetic\n`,
  });
  expect(literalKeyFiles(String(directory)).map(file => file.replaceAll("\\", "/"))).toEqual(["nested/bad.rs"]);
});

test("source ownership fails on literal assignments without disclosing their value", () => {
  using directory = tempDir("google-pipeline-key-owner", {});
  const { paths, metadata } = fixture(String(directory));
  writeFileSync(paths.facadeEntry, `GOOGLE_API_KEY${"="}synthetic-fixture\n`);
  expect(() => verifyStatic(paths, metadata)).toThrow(
    `Literal API key assignment found under ${dirname(paths.facadeEntry)}.`,
  );
});

test("Rust source and facade qualifications use independent own-root plans", () => {
  using directory = tempDir("google-pipeline-plan", {});
  const { paths, metadata } = fixture(String(directory));
  const result = verifyStatic(paths, metadata);
  const rust = qualificationPlan(paths, result, "rust", "linux", "fixture-bun");
  expect(rust).toHaveLength(4);
  expect(rust.every(item => item.stage === "rust-source")).toBe(true);
  expect(rust[0]!.argv.slice(0, 3)).toEqual(["fixture-bun", paths.cargoSerial, "clippy"]);
  const windows = qualificationPlan(paths, result, "rust", "win32", "fixture-bun");
  expect(windows[0]!.argv.slice(0, 4)).toEqual(["fixture-bun", paths.cargoSerial, "--msvc", "clippy"]);
  const sdk = qualificationPlan(paths, result, "sdk", "linux", "fixture-bun");
  expect(sdk.map(item => item.stage)).toEqual(["facade-tests", "facade-build"]);
  expect(sdk[0]!.argv).toEqual(["fixture-bun", "test", paths.facadeTests]);
  expect(sdk.every(item => item.cwd.startsWith(paths.root))).toBe(true);
});

test("facade qualification remains available when the independent Rust workspace is unqualified", () => {
  using directory = tempDir("google-pipeline-independent-sdk", {});
  const { paths } = fixture(String(directory));
  const result = verifyStatic(
    paths,
    () => {
      throw new Error("Rust fixture is unqualified");
    },
    "sdk",
  );
  expect(result.crates).toEqual([]);
  expect(qualificationPlan(paths, result, "sdk", "linux", "fixture-bun").map(item => item.stage)).toEqual([
    "facade-tests",
    "facade-build",
  ]);
});
