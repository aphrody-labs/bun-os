// Installs the exact upstream Bun build from its npm platform package (immutable, unlike the GitHub `canary` release).
// Usage: node install.mjs <version> <install-dir>
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [version, installDir] = process.argv.slice(2);
if (!version || !installDir) throw new Error("usage: install.mjs <version> <install-dir>");

const platforms = {
  "linux-x64": ["@oven/bun-linux-x64", "bun"],
  "linux-arm64": ["@oven/bun-linux-aarch64", "bun"],
  "win32-x64": ["@oven/bun-windows-x64", "bun.exe"],
};
const platform = platforms[`${process.platform}-${process.arch}`];
if (!platform) throw new Error(`no upstream Bun build for ${process.platform}-${process.arch}`);
const [name, exe] = platform;

async function packument(pkg) {
  const response = await fetch(`https://registry.npmjs.org/${pkg.replace("/", "%2f")}/${version}`);
  if (!response.ok) throw new Error(`${pkg}@${version}: registry answered ${response.status}`);
  return response.json();
}

const meta = await packument(name);
const main = await packument("bun");
const gitHead = main.gitHead;
if (!/^[0-9a-f]{40}$/.test(gitHead ?? "")) throw new Error(`bun@${version} has no gitHead`);
if (meta.gitHead && meta.gitHead !== gitHead) throw new Error(`${name} and bun disagree on gitHead`);

const tarball = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
const [algorithm, expected] = meta.dist.integrity.split("-");
if (algorithm !== "sha512" || createHash("sha512").update(tarball).digest("base64") !== expected)
  throw new Error(`${name}@${version}: tarball does not match the registry integrity`);

const work = mkdtempSync(join(tmpdir(), "bun-npm-"));
writeFileSync(join(work, "bun.tgz"), tarball);
const extract = spawnSync("tar", ["-xzf", "bun.tgz"], { cwd: work, stdio: "inherit" });
if (extract.status !== 0) throw new Error("tar failed");

mkdirSync(installDir, { recursive: true });
const target = join(installDir, exe);
copyFileSync(join(work, "package", "bin", exe), target);
chmodSync(target, 0o755);
const alias = join(installDir, exe === "bun" ? "bunx" : "bunx.exe");
if (exe === "bun") {
  if (!existsSync(alias)) symlinkSync("bun", alias);
} else copyFileSync(target, alias);

// Outside the checkout: the root bunfig preloads workspace plugins that are not installed yet.
const revision = spawnSync(target, ["-p", "Bun.revision"], { encoding: "utf8", cwd: work });
if (revision.status !== 0 || revision.stdout.trim() !== gitHead)
  throw new Error(`installed Bun reports revision ${revision.stdout.trim()}, expected ${gitHead}`);
console.log(`bun ${version} (${gitHead}) from ${name}`);
