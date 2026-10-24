// SPDX-License-Identifier: Apache-2.0
// Installed root-owned under /usr/local/libexec; consumes the runner handoff.
import { lstat, readlink, rename, symlink, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const home = "/home/ubuntu";
const handoff = join(home, "build/cache/gitea-runner/webos-deploy");
const app = join(home, "apps/webos");
const ready = Bun.file(join(handoff, "ready"));
if (!(await ready.exists())) process.exit(0);
const name = (await ready.text()).trim();
if (!/^[a-f0-9]{40}-[0-9]+$/.test(name))
  throw new Error("Invalid release name");
const release = join(handoff, "releases", name);
const receipt = (await Bun.file(join(release, "receipt.json")).json()) as {
  sourceCommit: string;
  files: { path: string; bytes: number; sha256: string }[];
};
if (!name.startsWith(receipt.sourceCommit + "-") || !receipt.files.length)
  throw new Error("Invalid receipt");
for (const entry of receipt.files) {
  if (
    !entry.path ||
    entry.path
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || /[\\:\0]/.test(part),
      )
  )
    throw new Error("Unsafe release path");
  const path = resolve(release, entry.path);
  if (!(await lstat(path)).isFile())
    throw new Error("Release symlink or missing artifact");
  const file = Bun.file(path);
  if (
    file.size !== entry.bytes ||
    new Bun.CryptoHasher("sha256").update(await file.bytes()).digest("hex") !==
      entry.sha256
  )
    throw new Error(`Artifact differs from receipt: ${entry.path}`);
}
for (const path of [
  "server.js",
  "release.env",
  "dist/index.html",
  "dist/main.js",
  "dist/workspace/index.html",
])
  if (!receipt.files.some((file) => file.path === path))
    throw new Error(`Unreceipted ${path}`);
const current = join(app, "current");
const previous = await readlink(current).catch(() => undefined);
if (previous === release) {
  await rename(join(handoff, "ready"), join(handoff, "activated"));
  process.exit(0);
}
await mkdir(app, { recursive: true });
async function point(path: string) {
  const temp = join(app, `current-${process.pid}`);
  await symlink(path, temp);
  await rename(temp, current);
}
async function restart() {
  const child = Bun.spawn(["systemctl", "restart", "aphrody-webos.service"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await child.exited) throw new Error("Service restart failed");
}
await point(release);
try {
  await restart();
  let healthy = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch("http://127.0.0.1:8790/api/health", {
      signal: AbortSignal.timeout(2000),
    }).catch(() => undefined);
    if (
      response?.ok &&
      ((await response.json()) as { sourceCommit?: string }).sourceCommit ===
        receipt.sourceCommit
    ) {
      healthy = true;
      break;
    }
    await Bun.sleep(1000);
  }
  if (!healthy) throw new Error("Activated source did not become healthy");
  await Bun.write(
    join(app, "deployment.json"),
    JSON.stringify(
      {
        sourceCommit: receipt.sourceCommit,
        release,
        previous,
        activatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  await rename(join(handoff, "ready"), join(handoff, "activated"));
  console.log(`Activated WebOS ${receipt.sourceCommit}`);
} catch (error) {
  if (previous) {
    await point(previous);
    await restart();
  }
  throw error;
}
