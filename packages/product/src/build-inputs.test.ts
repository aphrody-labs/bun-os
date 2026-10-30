import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonicalBunInputs, productBuildContext } from "./build-inputs";

test("selected product inputs point to the existing desktop and public asset owners", async () => {
  const root = resolve(import.meta.dir, "../../..");
  const inputs = productBuildContext({
    NODE_ENV: "test",
    APHRODY_WORKSPACE_ROOT: root,
    APHRODY_BUN_CHECKOUT: join(root, "sources/bun"),
  });
  expect(inputs.workspaceRoot).toBe(root);
  expect(inputs.uiDist).toBe(join(root, "apps/aphrody-app/ui-dist"));
  expect(await Bun.file(join(inputs.uiDist, "index.html")).exists()).toBe(true);
  expect(inputs.publicAssets).toBe(join(root, "tools/aphrody/config/public-assets.json"));
  expect((await Bun.file(inputs.publicAssets).json()).schemaVersion).toBe(1);
  const sourceInputs = productBuildContext(
    { NODE_ENV: "test", APHRODY_ROOT: join(root, "nonexistent-other-checkout") },
    import.meta.dir,
  );
  expect(sourceInputs.workspaceRoot).toBe(root);
  expect(sourceInputs.bunCheckout).toBe(join(root, "sources/bun"));
  expect(sourceInputs.uiDist).toBe(inputs.uiDist);
});

test("current committed build inputs retain immutable historical transfer provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "bun-product-inputs-"));
  const outside = mkdtempSync(join(tmpdir(), "bun-product-outside-"));
  const docs = "packages/web/rust/crates/site/data/docs.json";
  const receipt = "packages/web/rust/transfer-receipt.json";
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const git = (...args: string[]) => {
    const child = Bun.spawnSync(["git", ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    if (child.exitCode) throw new Error(child.stderr.toString());
    return child.stdout.toString().trim();
  };
  try {
    put(docs, '{"current":"committed documentation after transfer"}');
    put("packages/bun-google/src/search.ts", "export const search = true;");
    put(
      receipt,
      JSON.stringify({
        schemaVersion: 1,
        sourceCommit: "a".repeat(40),
        files: [
          {
            source: "crates/web/site/data/docs.json",
            destination: "packages/bun-aphrody-web/crates/site/data/docs.json",
            sha256: "b".repeat(64),
          },
        ],
      }),
    );
    git("init", "--quiet");
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "--quiet", "-m", "pinned inputs");
    const revision = git("rev-parse", "HEAD");
    const receiptBefore = readFileSync(join(root, receipt), "utf8");
    const input = canonicalBunInputs(root, revision);
    expect(input.transferDocs.sha256).toBe("b".repeat(64));
    expect(input.docs.sha256).not.toBe(input.transferDocs.sha256);
    expect(input.docs.gitBlob).toBe(git("rev-parse", `${revision}:${docs}`));
    expect(input.docs.path).toBe(docs);
    expect(readFileSync(join(root, receipt), "utf8")).toBe(receiptBefore);
    expect(() => canonicalBunInputs(root, "c".repeat(40))).toThrow("revision mismatch");
    put(docs, "uncommitted replacement");
    expect(() => canonicalBunInputs(root, revision)).toThrow("pinned Git blob");
    put(docs, '{"current":"committed documentation after transfer"}');
    put(receipt, "{}");
    expect(() => canonicalBunInputs(root, revision)).toThrow("pinned Git blob");
    put(receipt, receiptBefore);
    unlinkSync(join(root, docs));
    writeFileSync(join(outside, "docs.json"), "private unrelated file");
    symlinkSync(join(outside, "docs.json"), join(root, docs));
    expect(() => canonicalBunInputs(root, revision)).toThrow("escapes the checkout");
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}, 30_000);
