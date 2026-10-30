// SPDX-License-Identifier: Apache-2.0
// VPS runner -> immutable release -> host activation, without cloud credentials.
import { cp, mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stageIso } from "./vm";
import { allAppCapabilities } from "@aphrody/bun-workspace/capabilities";

if (process.platform !== "linux")
  throw new Error("Deploy WebOS from the VPS factory");
const root = resolve(import.meta.dir, "../..");
function git(...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode)
    throw new Error("Cannot identify published WebOS source");
  return result.stdout.toString().trim();
}
const commit = git("rev-parse", "HEAD");
if (commit !== git("rev-parse", "refs/remotes/origin/main"))
  throw new Error("Deploy the published main tip");
if (git("diff", "HEAD", "--", "apps/webos", "infra/config/routes.catalog.json"))
  throw new Error("WebOS source must be committed before deployment");
const handoff = resolve(
  Bun.env.WEBOS_DEPLOY_ROOT ?? join(root, "build/webos-deploy"),
);
const release = join(handoff, "releases", `${commit}-${Date.now()}`);
await mkdir(release, { recursive: true });
const imported = Bun.env.WEBOS_PREBUILT_DIST;
if (!imported) {
  const build = Bun.spawn(
    [process.execPath, join(import.meta.dir, "build-product.ts")],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (await build.exited) throw new Error("WebOS product assembly failed");
}
await cp(
  resolve(imported ?? join(import.meta.dir, "dist")),
  join(release, "dist"),
  { recursive: true, dereference: true },
);
for (const required of [
  "index.html",
  "main.js",
  "registry.json",
  "workspace/index.html",
])
  if (!(await Bun.file(join(release, "dist", required)).exists()))
    throw new Error(`Missing ${required}`);
if (!imported) {
  const registry = (await Bun.file(
    join(release, "dist/registry.json"),
  ).json()) as { packages: { id: string }[] };
  for (const capability of allAppCapabilities()) {
    const id = capability.webosPackageId;
    if (!id) continue;
    if (!registry.packages.some((entry) => entry.id === id))
      throw new Error(`Missing installable ${id}`);
    const manifest = (await Bun.file(
      join(release, "dist/apps", id, "app.json"),
    ).json()) as { files: { path: string; bytes: number }[] };
    if (
      !manifest.files.some(
        (file) => file.path.endsWith(".wasm") && file.bytes > 0,
      )
    )
      throw new Error(`${id} has no executable WebAssembly artifact`);
  }
}
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "serve.ts")],
  outdir: release,
  naming: "server.js",
  target: "bun",
  minify: true,
});
if (!result.success)
  throw new AggregateError(result.logs, "Native HTTP bundle failed");
const iso = await stageIso();
await Bun.write(join(release, "objects", iso.key), Bun.file(iso.path));
await Bun.write(join(release, "release.env"), `SOURCE_COMMIT=${commit}\n`);
const files: { path: string; bytes: number; sha256: string }[] = [];
for await (const path of new Bun.Glob("**/*").scan({
  cwd: release,
  onlyFiles: true,
  dot: true,
})) {
  const file = Bun.file(join(release, path));
  files.push({
    path,
    bytes: file.size,
    sha256: new Bun.CryptoHasher("sha256")
      .update(await file.bytes())
      .digest("hex"),
  });
}
files.sort((a, b) => a.path.localeCompare(b.path));
await Bun.write(
  join(release, "receipt.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      sourceCommit: commit,
      runtime: Bun.revision,
      importedArtifact: Boolean(imported),
      createdAt: new Date().toISOString(),
      files,
    },
    null,
    2,
  ),
);
await Bun.write(join(handoff, "ready.tmp"), release.split("/").pop()! + "\n");
await rename(join(handoff, "ready.tmp"), join(handoff, "ready"));
console.log(`WebOS staged: ${release}; host activation is a separate gate.`);
