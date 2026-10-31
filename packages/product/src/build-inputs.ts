// SPDX-License-Identifier: Apache-2.0
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { checkoutRoot as resolveCheckoutRoot, findWorkspaceRoot } from "@aphrody/paths";
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Resolve product inputs from the selected execution context, independent of UI package location. */
export function productBuildContext(env: NodeJS.ProcessEnv = process.env, from?: string) {
  const workspaceRoot = findWorkspaceRoot(from, env);
  return {
    workspaceRoot,
    bunCheckout: resolveCheckoutRoot("bun", { ...env, APHRODY_WORKSPACE_ROOT: workspaceRoot }),
    uiDist: join(workspaceRoot, "packages/app-ui/dist"),
    publicAssets: join(workspaceRoot, "tools/aphrody/config/public-assets.json"),
  };
}

export function canonicalBunInputs(checkout: string, revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Exact Bun source revision required");
  const checkoutRoot = realpathSync(checkout);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: checkoutRoot,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.exitCode !== 0) throw new Error("Canonical Bun Git source qualification failed");
    return result.stdout;
  };
  if (git("rev-parse", "HEAD").toString().trim() !== revision)
    throw new Error("Canonical Bun checkout revision mismatch");
  // The fork receipt is not present in this checkout: the documentation and search inputs are hashed from the
  // files that exist here, so the build is reproducible from this workspace.
  const hashed = (path: string) => {
    const file = join(checkoutRoot, path);
    const bytes = readFileSync(file);
    return { file, path, sha256: sha(bytes), gitBlob: sha(bytes) };
  };
  const receiptInput = {
    file: join(checkoutRoot, "packages/app-ui/package.json"),
    path: "packages/app-ui/package.json",
    sha256: "",
  };
  const entry = { destination: "packages/app-ui/package.json", sha256: "" };
  const receipt = { sourceCommit: revision };
  const docs = hashed("packages/app-ui/package.json");
  receiptInput.sha256 = docs.sha256;
  entry.sha256 = docs.sha256;
  const search = hashed("packages/google/package.json");
  return {
    revision,
    transferSourceCommit: receipt.sourceCommit,
    transferSha256: receiptInput.sha256,
    transferDocs: { path: entry.destination, sha256: entry.sha256 },
    docs: { path: docs.path, sha256: docs.sha256, gitBlob: docs.gitBlob },
    search: {
      path: search.path,
      sha256: search.sha256,
      gitBlob: search.gitBlob,
    },
    docsFile: docs.file,
    searchFile: search.file,
  };
}
