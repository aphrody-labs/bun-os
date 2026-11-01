import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonicalBunInputs, productBuildContext } from "./build-inputs";

test("selected product inputs point to the App UI build and public asset owners", async () => {
  const root = resolve(import.meta.dir, "../../..");
  const inputs = productBuildContext({
    NODE_ENV: "test",
    APHRODY_WORKSPACE_ROOT: root,
    APHRODY_BUN_CHECKOUT: join(root, "sources/bun"),
  });
  expect(inputs.workspaceRoot).toBe(root);
  expect(inputs.uiDist).toBe(join(root, "packages/app-ui/dist"));
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

test("canonical build inputs match the exact Git revision and reject dirty or escaping files", () => {
  const root = mkdtempSync(join(tmpdir(), "bun-product-inputs-"));
  const outside = mkdtempSync(join(tmpdir(), "bun-product-outside-"));
  const docs = "packages/app-ui/package.json";
  const search = "packages/google/package.json";
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
    const docsText = '{"name":"@aphrody/app-ui"}';
    const searchText = '{"name":"@aphrody/google"}';
    put(docs, docsText);
    put(search, searchText);
    git("init", "--quiet");
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "--quiet", "-m", "pinned inputs");
    const revision = git("rev-parse", "HEAD");
    const input = canonicalBunInputs(root, revision);
    const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
    expect(input.transferSourceCommit).toBe(revision);
    expect(input.docs.gitBlob).toBe(git("rev-parse", `${revision}:${docs}`));
    expect(input.search.gitBlob).toBe(git("rev-parse", `${revision}:${search}`));
    expect(input.transferDocs.sha256).toBe(hash(docsText));
    expect(input.transferSha256).toBe(hash(docsText));
    expect(input.docs.sha256).toBe(hash(docsText));
    expect(input.search.sha256).toBe(hash(searchText));
    expect(input.docs.path).toBe(docs);
    expect(input.search.path).toBe(search);
    expect(() => canonicalBunInputs(root, "c".repeat(40))).toThrow("revision mismatch");
    put(docs, "uncommitted replacement");
    expect(() => canonicalBunInputs(root, revision)).toThrow("pinned Git blob");
    put(docs, docsText);
    unlinkSync(join(root, docs));
    rmSync(join(root, "packages/app-ui"), { recursive: true, force: true });
    writeFileSync(join(outside, "package.json"), docsText);
    symlinkSync(outside, join(root, "packages/app-ui"), process.platform === "win32" ? "junction" : "dir");
    expect(() => canonicalBunInputs(root, revision)).toThrow("escapes the checkout");
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}, 30_000);
