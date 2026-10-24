// SPDX-License-Identifier: Apache-2.0
// Installed root-owned under /usr/local/libexec; consumes the runner handoff.
import { lstat, readlink, rename, symlink, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const home = "/home/ubuntu";
const handoff = join(home, "build/cache/gitea-runner/webos-deploy");
const app = join(home, "apps/webos");
const readyPath = join(handoff, "ready");
if (!(await Bun.file(readyPath).exists())) process.exit(0);
// Claim this request before activation; a newly published ready pointer stays queued.
const pending = join(handoff, `activating-${process.pid}`);
await rename(readyPath, pending);
const ready = Bun.file(pending);
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
// Read the existing local forge's published branch without network credentials.
const sourceRepository =
  Bun.env.WEBOS_SOURCE_REPOSITORY ??
  join(home, "apps/gitea/data/git/repositories/aphrody-dev/bun-os.git");
function publishedCommit() {
  const result = Bun.spawnSync([
    "git",
    "-c",
    `safe.directory=${sourceRepository}`,
    "--git-dir",
    sourceRepository,
    "rev-parse",
    "refs/heads/os",
  ]);
  if (result.exitCode !== 0)
    throw new Error("Cannot verify the published production branch");
  return result.stdout.toString().trim();
}
if (publishedCommit() !== receipt.sourceCommit) {
  await rename(pending, join(handoff, `superseded-${name}`));
  console.log(`Ignored superseded release ${receipt.sourceCommit}`);
  process.exit(0);
}
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
  await rename(pending, join(handoff, "activated"));
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
if (publishedCommit() !== receipt.sourceCommit)
  throw new Error("Production source advanced during activation");
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
  const publicHealth = await fetch("https://aphrody.com/api/health", {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (
    !publicHealth.ok ||
    ((await publicHealth.json()) as { sourceCommit?: string }).sourceCommit !==
      receipt.sourceCommit
  )
    throw new Error("Public ingress did not confirm the activated source");
  for (const path of ["/", "/workspace/", "/api/site/snapshot"]) {
    const response = await fetch(`https://aphrody.com${path}`, {
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Public route failed: ${path}`);
  }
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
  await rename(pending, join(handoff, "activated"));
  console.log(`Activated WebOS ${receipt.sourceCommit}`);
} catch (error) {
  if (previous) {
    await point(previous);
    await restart();
  }
  throw error;
}
