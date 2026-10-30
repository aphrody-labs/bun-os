// SPDX-License-Identifier: Apache-2.0
// npm registry of Bun OS: static packuments and tarballs for every @aphrody/* workspace package, packed with
// `bun pm pack` (workspace: and catalog: ranges become exact versions). Served by nginx under /npm/.
//   bunfig.toml  [install.scopes]  "@aphrody" = "https://aphrody.com/npm/"
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { docker, run, safeName, sha256, tail, writeIndex, step, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

const SCOPE = "@aphrody/";

async function workspaceDirs(root: string): Promise<string[]> {
  const pkg = (await Bun.file(join(root, "package.json")).json()) as { workspaces?: string[] | { packages?: string[] } };
  const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue;
    for await (const file of new Bun.Glob(`${pattern.replace(/\/$/, "")}/package.json`).scan({ cwd: root, onlyFiles: true }))
      dirs.add(dirname(file));
  }
  // Packages of the repository that are not (yet) listed as workspaces are still members.
  for await (const file of new Bun.Glob("{packages,apps}/*/package.json").scan({ cwd: root, onlyFiles: true })) dirs.add(dirname(file));
  return [...dirs].sort();
}

export async function build(ctx: Ctx) {
  const out = join(ctx.store, "npm");
  const staging = join(ctx.store, ".npm-staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const packages = new Map<string, { dir: string; json: Record<string, any> }>();
  const skipped: { name: string; reason: string }[] = [];
  for (const dir of await workspaceDirs(ctx.root)) {
    const json = await Bun.file(join(ctx.root, dir, "package.json")).json().catch(() => undefined);
    if (!json?.name?.startsWith(SCOPE)) continue;
    if (!json.version) {
      skipped.push({ name: json.name, reason: "package.json has no version" });
      continue;
    }
    if (!packages.has(json.name)) packages.set(json.name, { dir, json });
  }
  const entries: IndexEntry[] = [];
  const queue = [...packages];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [name, { dir, json }] = item;
      const dest = join(staging, safeName(name));
      await mkdir(dest, { recursive: true });
      const packed = await run(["bun", "pm", "pack", "--destination", dest, "--quiet"], { cwd: join(ctx.root, dir), timeout: 180_000 });
      const files = (await readdir(dest)).filter((f) => f.endsWith(".tgz"));
      if (packed.code !== 0 || files.length !== 1) {
        skipped.push({ name, reason: `bun pm pack failed: ${tail(packed.out, 2)}` });
        continue;
      }
      const tmp = join(dest, files[0]!);
      const manifest = await run(["tar", "-xOzf", tmp, "package/package.json"]);
      if (manifest.code !== 0) {
        skipped.push({ name, reason: "tarball has no package/package.json" });
        continue;
      }
      const packedJson = JSON.parse(manifest.out) as Record<string, any>;
      const short = name.slice(SCOPE.length);
      const tarName = `${short}-${json.version}.tgz`;
      const dir2 = join(out, "@aphrody", short, "-");
      await mkdir(dir2, { recursive: true });
      await Bun.write(join(dir2, tarName), Bun.file(tmp));
      const bytes = await Bun.file(join(dir2, tarName)).bytes();
      const shasum = new Bun.CryptoHasher("sha1").update(bytes).digest("hex");
      const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
      const tarball = `${ctx.origin}/npm/@aphrody/${short}/-/${tarName}`;
      const time = new Date().toISOString();
      const version = { ...packedJson, _id: `${name}@${json.version}`, dist: { shasum, integrity, tarball, fileCount: undefined, unpackedSize: undefined } };
      const packument = {
        _id: name,
        name,
        description: json.description,
        "dist-tags": { latest: json.version },
        versions: { [json.version]: version },
        time: { modified: time, created: time, [json.version]: time },
        license: json.license,
        readme: "",
        homepage: json.homepage,
      };
      await Bun.write(join(out, "@aphrody", `${short}.json`), JSON.stringify(packument));
      entries.push({
        name,
        version: json.version,
        desc: String(json.description ?? ""),
        license: json.license,
        size: bytes.length,
        sha256: await sha256(join(dir2, tarName)),
        file: `/npm/@aphrody/${short}/-/${tarName}`,
        homepage: json.homepage,
        member: dir,
        meta: { private: Boolean(json.private), bin: json.bin ? Object.keys(typeof json.bin === "string" ? { [short]: 1 } : json.bin) : [], dependencies: Object.keys(packedJson.dependencies ?? {}).length },
      });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await Bun.write(join(out, "-", "ping"), "{}");
  await rm(staging, { recursive: true, force: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  await writeIndex(ctx, { format: "npm", generated: new Date().toISOString(), url: `${ctx.origin}/npm/`, entries, skipped });
  console.log(`npm: ${entries.length} packages, ${skipped.length} skipped`);
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const index = JSON.parse(await Bun.file(join(ctx.store, "index/npm.json")).text()) as { entries: IndexEntry[] };
  // A small package without dependencies keeps the check about the registry, not about npmjs.
  const pick = index.entries.filter((e) => !e.meta?.dependencies).sort((a, b) => (a.size ?? 0) - (b.size ?? 0))[0] ?? index.entries[0]!;
  const image = "oven/bun:1-alpine";
  const script = `set -e
mkdir /w && cd /w
printf '[install.scopes]\n"@aphrody" = "${ctx.origin}/npm/"\n' > bunfig.toml
echo '{"name":"qual","private":true}' > package.json
bun add ${pick.name}
test -f node_modules/${pick.name}/package.json
grep '"version"' node_modules/${pick.name}/package.json
bun pm ls | head -5`;
  await step(steps, `packument ${pick.name}`, () =>
    run(["sh", "-c", `curl -fsS ${ctx.origin}/npm/@aphrody%2f${pick.name.slice(SCOPE.length)} | head -c 300`]),
  );
  await step(steps, `bun add ${pick.name} (container ${image})`, () => docker(image, script, { timeout: 300_000 }));
  const ok = steps.every((s) => s.ok);
  return { format: "npm", ok, at: new Date().toISOString(), image, steps };
}
