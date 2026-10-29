// Copies a checkout of the upstream (or of the aphrody-labs fork) into the Bun OS layout
// described by lu-map.json and prints the commit that was imported.
// Usage: bun factory/ai/lu-sync.ts <upstream checkout> [--write]
// Without --write it only reports the files that differ (a resync preview).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const args = Bun.argv.slice(2);
const write = args.includes("--write");
const src = resolve(args.find(a => !a.startsWith("--")) ?? "");
if (!src || !existsSync(join(src, ".git"))) {
  console.error("usage: bun factory/ai/lu-sync.ts <upstream checkout> [--write]");
  process.exit(2);
}
const map = JSON.parse(readFileSync(join(import.meta.dir, "lu-map.json"), "utf8"));
const head = (await Bun.$`git -C ${src} rev-parse HEAD`.text()).trim();

const norm = (p: string) => p.replaceAll("\\", "/");
let changed = 0;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

for (const entry of map.copy as { from: string; to: string; skip?: string[] }[]) {
  const from = join(src, entry.from);
  if (!existsSync(from)) {
    console.warn(`missing upstream path: ${entry.from}`);
    continue;
  }
  const skips: string[] = entry.skip ?? [];
  const files = statSync(from).isDirectory() ? walk(from) : [from];
  for (const f of files) {
    const rel = norm(relative(src, f));
    if (skips.some(s => rel === s || rel.startsWith(s + "/"))) continue;
    const dest = statSync(from).isDirectory() ? join(root, entry.to, relative(from, f)) : join(root, entry.to);
    const a = readFileSync(f);
    const same = existsSync(dest) && Buffer.compare(a, readFileSync(dest)) === 0;
    if (same) continue;
    changed++;
    if (write) {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(f, dest);
    } else console.log(`differs: ${norm(relative(root, dest))}`);
  }
}
console.log(`${write ? "wrote" : "would write"} ${changed} files from ${map.upstream} @ ${head}`);
void rmSync;
