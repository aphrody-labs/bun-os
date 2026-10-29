#!/usr/bin/env bun
/** One product version and internal dependency owner for flat Bun packages. */
const paths = [
  ...Array.from(new Bun.Glob("packages/*/package.json").scanSync({ cwd: "." })),
  ...Array.from(new Bun.Glob("apps/*/package.json").scanSync({ cwd: "." })),
]
  .map(path => path.replaceAll("\\", "/"))
  .sort();
const product = await Bun.file("package.json").json();
const entries = await Promise.all(paths.map(async path => ({ path, manifest: await Bun.file(path).json() })));
const names = new Set(entries.map(entry => entry.manifest.name));
if (!product.version || names.size !== entries.length || names.has(undefined))
  throw new Error("Product package identities must be present and unique.");
for (const entry of [{ path: "package.json", manifest: product }, ...entries]) {
  entry.manifest.version = product.version;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(entry.manifest[field] ?? {})) {
      if (names.has(name)) entry.manifest[field][name] = "workspace:*";
      else if (Object.hasOwn(product.catalog ?? {}, name)) entry.manifest[field][name] = "catalog:";
    }
  }
}
// Imported owners remain registered without rewriting their source manifests.
const importedMembers: string[] = (product.workspaces ?? []).filter(
  (member: string) => !member.startsWith("packages/") && !member.startsWith("apps/"),
);
product.workspaces = [...new Set([...paths.map(path => path.replace(/\/package\.json$/, "")), ...importedMembers])];
// check, lint, format and format:check are aliases of the bunos command registry (src/cli/commands.ts); only the workspace list is generated here.
product.scripts["workspace:manifests"] = "bun scripts/workspace-manifests.ts";
for (const entry of [{ path: "package.json", manifest: product }, ...entries])
  await Bun.write(entry.path, JSON.stringify(entry.manifest, null, 2) + "\n");
// tsconfig.json keeps its curated include list: the Next.js and Vite packages augment ProcessEnv/ImportMeta globally.
console.log(`Bun workspace: ${entries.length} packages at ${product.version}`);
