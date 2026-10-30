// SPDX-License-Identifier: Apache-2.0
// Fetches the upstream Bun build for musl (Alpine) from its npm platform package, checked against the registry integrity.
// The host runner cannot execute it, so the revision is compared with the gitHead of the main `bun` package instead.
// Usage: node fetch-bun-musl.mjs <version> <install-dir>
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [version, dir] = process.argv.slice(2);
if (!version || !dir) throw new Error("usage: fetch-bun-musl.mjs <version> <install-dir>");
const meta = await (await fetch(`https://registry.npmjs.org/@oven%2fbun-linux-x64-musl/${version}`)).json();
const main = await (await fetch(`https://registry.npmjs.org/bun/${version}`)).json();
if (meta.gitHead && meta.gitHead !== main.gitHead) throw new Error("musl package and bun disagree on gitHead");
const tgz = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
const [alg, expected] = meta.dist.integrity.split("-");
if (alg !== "sha512" || createHash("sha512").update(tgz).digest("base64") !== expected)
  throw new Error("integrity mismatch");
const work = mkdtempSync(join(tmpdir(), "bun-musl-"));
writeFileSync(join(work, "bun.tgz"), tgz);
if (spawnSync("tar", ["-xzf", "bun.tgz"], { cwd: work, stdio: "inherit" }).status !== 0) throw new Error("tar failed");
mkdirSync(dir, { recursive: true });
copyFileSync(join(work, "package", "bin", "bun"), join(dir, "bun"));
chmodSync(join(dir, "bun"), 0o755);
console.log(`bun ${version} musl (gitHead ${main.gitHead}) -> ${dir}/bun`);
