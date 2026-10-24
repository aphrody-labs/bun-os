#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Run on the VPS, inside an existing factory slot. All studios must assemble
// successfully before an immutable release can replace the live symlink.
import { cp, mkdir, readlink, rename, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const args = Bun.argv.slice(2);
if (process.platform !== "linux" || Bun.env.APHRODY_BUILD_HOST !== "vps")
  throw new Error("Run on the VPS through bun scripts/factory/factory.ts run -- <this script>.");
if (args.some(arg => arg !== "--skip-build"))
  throw new Error("Only --skip-build is supported; partial deployments are refused.");
const home = homedir();
const deployment = join(home, "apps/craft-web");
const id = new Date().toISOString().replaceAll(/[:.]/g, "-");
const release = join(deployment, "releases", id);
const current = join(deployment, "current");
const assembled = join(root, "apps/webos/out/craft");
const studios = [
  ["photo", "PhotoCraft", "Image editing, with space to get every detail right.", "visual", "Image editing"],
  ["vector", "VectorCraft", "Shape an idea with precise, scalable vector graphics.", "visual", "Vector graphics"],
  ["film", "FilmCraft", "Find your story in the edit. A studio for your next film.", "motion", "Video editing"],
  ["design", "DesignCraft", "Bring type, images and considered layouts together.", "visual", "Layout & publishing"],
  ["fig", "FigCraft", "Give your next interface a place to take shape.", "visual", "Interface design"],
  ["effect", "EffectCraft", "Add another dimension with motion and visual effects.", "motion", "Motion & effects"],
  ["light", "LightCraft", "Organize your photographs and develop your perspective.", "visual", "RAW & photo library"],
  ["sound", "SoundCraft", "Make every cut, layer and moment sound right.", "motion", "Audio editing"],
  ["cad", "CADCraft", "Move from an early sketch to a precise technical drawing.", "visual", "Drafting & CAD"],
  ["word", "WordCraft", "A dedicated space for words worth putting on the page.", "work", "Word processing"],
  ["deck", "DeckCraft", "Turn a collection of ideas into a compelling presentation.", "work", "Presentations"],
  ["grid", "GridCraft", "Make sense of the numbers, one clear sheet at a time.", "work", "Spreadsheets"],
  ["pdf", "PDFCraft", "Read, review and edit your PDF documents in one studio.", "work", "PDF documents"],
  [
    "art",
    "ArtCraft",
    "Explore the desktop studio interface. Generation requires the desktop application.",
    "visual",
    "Browser preview",
  ],
] as const;

async function run(argv: string[], env: Record<string, string | undefined> = {}) {
  console.log(`craft: ${argv.slice(0, 3).join(" ")}`);
  const proc = Bun.spawn(argv, {
    cwd: root,
    env: { ...Bun.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error(`Craft command failed: ${argv[0]} ${argv[1] ?? ""}`);
}
async function output(argv: string[]) {
  const proc = Bun.spawn(argv, {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
  });
  const text = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`Failed: ${argv[0]}`);
  return text.trim();
}
if (!args.includes("--skip-build")) await run([process.execPath, "apps/webos/build-craft.ts"]);
const catalog = (await Bun.file(join(assembled, "index.json")).json()) as {
  id: string;
}[];
for (const [studio] of studios.filter(([studio]) => studio !== "art")) {
  if (!catalog.some(entry => entry.id === studio)) throw new Error(`Missing assembled Craft studio: ${studio}`);
}
await mkdir(release, { recursive: true });
for (const [studio] of studios.filter(([studio]) => studio !== "art")) {
  await cp(join(assembled, studio), join(release, studio), { recursive: true });
}
// ArtCraft retains its pinned runtime and frontend build owner.
const artRuntime = Bun.env.CRAFT_ART_RUNTIME ?? process.execPath;
await run([
  artRuntime,
  "-e",
  `const { buildFrontend } = await import('./packages/artcraft-frontend/scripts/artcraft.ts'); await buildFrontend({outdir: ${JSON.stringify(join(release, "art"))}, basePath:'/art/'});`,
]);
await mkdir(join(release, "previews"), { recursive: true });
for (const [studio] of studios) {
  if (studio !== "art")
    await cp(join(root, `assets/craft/previews/${studio}.jpg`), join(release, `previews/${studio}.jpg`));
}
for (const file of ["craft.css", "craft.js"]) await cp(join(import.meta.dir, file), join(release, file));
await cp(join(root, "packages/identity/assets/icon-64.png"), join(release, "aphrody-icon.png"));
const cards = studios
  .map(
    ([studio, title, summary, category, label]) => `<a class="card" href="/${studio}/" data-category="${category}">
  ${studio === "art" ? '<div class="preview art-preview" aria-hidden="true"><span>Make your mark.</span></div>' : `<div class="preview"><img src="/previews/${studio}.jpg" width="1280" height="800" loading="lazy" alt="${title} editor workspace"></div>`}
  <div class="card-info"><div class="card-top"><h3>${title}</h3><span aria-hidden="true">↗</span></div><p>${summary}</p><span class="category">${label}</span></div></a>`,
  )
  .join("\n");
await Bun.write(
  join(release, "index.html"),
  (await Bun.file(join(import.meta.dir, "craft-landing.html")).text()).replace("{{CARDS}}", cards),
);
await Bun.write(join(release, "robots.txt"), "User-agent: *\nAllow: /\n");

// Refuse incomplete output and record the exact bytes, dependencies and sources.
const film = Bun.file(join(release, "film/index.html"));
await Bun.write(film, (await film.text()).replaceAll("__FC_BUILD__", id));
const files: { path: string; size: number; sha256: string }[] = [];
for await (const path of new Bun.Glob("**/*").scan({
  cwd: release,
  onlyFiles: true,
})) {
  const file = Bun.file(join(release, path));
  files.push({
    path,
    size: file.size,
    sha256: new Bun.CryptoHasher("sha256").update(await file.bytes()).digest("hex"),
  });
}
for (const [studio] of studios) {
  if (!files.some(file => file.path === `${studio}/index.html`)) throw new Error(`${studio}: missing document`);
  if (
    studio !== "art" &&
    !files.some(file => file.path.startsWith(`${studio}/`) && file.path.endsWith(".wasm") && file.size > 1000)
  )
    throw new Error(`${studio}: missing WebAssembly`);
}
const receipt = {
  id,
  created: new Date().toISOString(),
  host: await output(["hostname"]),
  source: await output(["git", "rev-parse", "HEAD"]),
  sourceChanges: await output(["git", "status", "--porcelain", "--untracked-files=no"]),
  cargoLock: new Bun.CryptoHasher("sha256").update(await Bun.file(join(root, "Cargo.lock")).bytes()).digest("hex"),
  runtime: { version: Bun.version, revision: Bun.revision },
  studios: studios.map(([studio]) => studio),
  files,
};
await Bun.write(join(release, "release.json"), JSON.stringify(receipt, null, 2));

const vhost = "/etc/nginx/conf.d/craft.aphrody.app.conf";
const oldVhost = await output(["sudo", "cat", vhost]);
// Keep server configuration out of the publicly served release.
const backupPath = join(deployment, `nginx-${id}.conf`);
await Bun.write(backupPath, oldVhost);
await run(["sudo", "install", "-m", "644", join(root, "infra/config/host/nginx/craft/craft.aphrody.app.conf"), vhost]);
try {
  await run(["sudo", "nginx", "-t"]);
} catch (error) {
  await run(["sudo", "install", "-m", "644", backupPath, vhost]);
  throw error;
}
let previous: string;
try {
  previous = await readlink(current);
} catch {
  previous = join(deployment, "releases", `legacy-${id}`);
  await rename(current, previous);
  await symlink(previous, current);
}
async function activate(target: string) {
  const next = join(deployment, `activate-${crypto.randomUUID()}`);
  await symlink(target, next);
  await rename(next, current);
}
await activate(release);
try {
  await run(["sudo", "systemctl", "reload", "nginx"]);
  for (const path of ["/", ...studios.map(([studio]) => `/${studio}/`)]) {
    await run([
      "curl",
      "--fail",
      "--silent",
      "--show-error",
      "--output",
      "/dev/null",
      "--resolve",
      "craft.aphrody.app:443:127.0.0.1",
      `https://craft.aphrody.app${path}`,
    ]);
  }
} catch (error) {
  await activate(previous);
  await run(["sudo", "install", "-m", "644", backupPath, vhost]);
  await run(["sudo", "systemctl", "reload", "nginx"]);
  throw error;
}
console.log(`Craft deployed: ${studios.length} studios, VPS Nginx, release ${id}. Previous release: ${previous}`);
