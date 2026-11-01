// SPDX-License-Identifier: Apache-2.0
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { workspaceBuildContext } from "@aphrody/paths";
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Resolve product inputs from the selected execution context, independent of UI package location. */
export function productBuildContext(env: NodeJS.ProcessEnv = process.env, from?: string) {
  const { workspaceRoot, bunCheckout } = workspaceBuildContext(env, from);
  return {
    workspaceRoot,
    bunCheckout,
    uiDist: join(workspaceRoot, "packages/app-ui/dist"),
    publicAssets: join(workspaceRoot, "tools/aphrody/config/public-assets.json"),
  };
}

export function canonicalBunInputs(checkout: string, revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Exact Bun source revision required");
  const checkoutRoot = realpathSync(checkout);
  const gitResult = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: checkoutRoot,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return result;
  };
  const git = (...args: string[]) => {
    const result = gitResult(...args);
    if (result.exitCode !== 0) throw new Error("Canonical Bun Git source qualification failed");
    return result.stdout;
  };
  if (git("rev-parse", "HEAD").toString().trim() !== revision)
    throw new Error("Canonical Bun checkout revision mismatch");
  const hashed = (path: string) => {
    const file = join(checkoutRoot, path);
    const resolved = realpathSync(file);
    const inside = relative(checkoutRoot, resolved);
    if (inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside))
      throw new Error("Canonical Bun source file escapes the checkout");
    if (!lstatSync(file).isFile()) throw new Error("Canonical Bun source is not a regular file");

    const treeEntry = git("ls-tree", "-z", revision, "--", path).toString();
    const [metadata, committedPath] = treeEntry.replace(/\0$/, "").split("\t");
    const [mode, type, gitBlob] = metadata?.split(" ") ?? [];
    if (committedPath !== path || type !== "blob" || !/^[a-f0-9]{40}$/.test(gitBlob ?? ""))
      throw new Error(`Canonical Bun input is not a committed regular file: ${path}`);
    if (mode !== "100644" && mode !== "100755") throw new Error(`Canonical Bun input is not a regular file: ${path}`);

    const dirty = gitResult("diff", "--quiet", revision, "--", path);
    if (dirty.exitCode === 1) throw new Error(`Canonical Bun input has changed from the pinned Git blob: ${path}`);
    if (dirty.exitCode !== 0) throw new Error("Canonical Bun Git source qualification failed");

    const committed = git("cat-file", "blob", gitBlob);
    const working = readFileSync(file);
    if (working.byteLength !== committed.byteLength || working.some((byte, index) => byte !== committed[index]))
      throw new Error(`Canonical Bun input does not match the pinned Git blob: ${path}`);
    return { file, path, sha256: sha(committed), gitBlob };
  };
  const docs = hashed("packages/app-ui/package.json");
  const search = hashed("packages/google/package.json");
  return {
    revision,
    transferSourceCommit: revision,
    transferSha256: docs.sha256,
    transferDocs: { path: docs.path, sha256: docs.sha256, gitBlob: docs.gitBlob },
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
