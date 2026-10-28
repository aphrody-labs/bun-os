#!/usr/bin/env bun
/**
 * Consistency check of the Bun OS heavy-component manifest, without building:
 *   bun factory/bunos/validate.ts
 * Checks PKGBUILD presence and identity, licence installation, allowed /usr prefixes,
 * that no model weight is packaged, and that image/system integrations are declared
 * by the /usr and image manifests.
 */
import { join, resolve } from "node:path";

const here = import.meta.dir;
const root = resolve(here, "../..");
const manifest = await Bun.file(join(here, "components.json")).json();
const usr = await Bun.file(join(root, "factory/usr/manifest.json")).json();
const gamingList = await Bun.file(join(root, "factory/images/bunos-gaming/gaming.packages")).text();
const imagesManifest = await Bun.file(join(root, "factory/images/manifest.json")).json();

const errors: string[] = [];
const missing: string[] = [];
const modes = new Set(["pacman-bunos", "pacman-system", "overlay", "image", "static-in", "excluded", "remaining"]);
const imagePackages = new Set(gamingList.split(/\s+/).filter(word => word && !word.startsWith("#")));
const usrPackages = new Set<string>([
  ...usr.basePackages,
  ...Object.values<any>(usr.compositions).flatMap(c => c.packages),
]);
const bunosPackages = new Set<string>();
const weight = /\.(gguf|onnx|safetensors|bin|pt|ckpt)\b/i;

for (const component of manifest.components) {
  const { id, integration } = component;
  if (!modes.has(integration?.mode)) errors.push(`${id}: unknown integration mode ${integration?.mode}`);
  if ((integration.mode === "excluded" || integration.mode === "remaining") && !integration.reason)
    errors.push(`${id}: ${integration.mode} without reason`);
  if (integration.mode === "pacman-bunos") {
    const name = integration.package;
    bunosPackages.add(name);
    const dir = integration.pkgbuilds ? join(root, integration.pkgbuilds) : join(here, "pkgbuilds");
    const file = Bun.file(join(dir, name, "PKGBUILD"));
    if (!(await file.exists())) {
      errors.push(`${id}: missing ${name}/PKGBUILD in ${dir}`);
      continue;
    }
    const text = await file.text();
    if (!new RegExp(`^pkgname=${name.replace(/[.]/g, "\\.")}$`, "m").test(text))
      errors.push(`${name}: pkgname mismatch`);
    if (!/^license=\(/m.test(text)) errors.push(`${name}: no license array`);
    if (!/\/usr\/share\/licenses\/\$\{?pkgname\}?/.test(text)) errors.push(`${name}: licence not installed`);
    if (integration.pkgbuilds) continue;
    if (/^source=\([^)]*\.(gguf|onnx|safetensors)/m.test(text)) errors.push(`${name}: packages model weights`);
    if (/\bcargo build\b/.test(text)) errors.push(`${name}: cargo must go through cargo-serial.sh`);
    for (const [, target] of text.matchAll(/\$pkgdir(\/usr\/[^"\s]*)/g)) {
      const path = target.replace(/\$pkgname/g, name);
      if (!manifest.prefixes.some((prefix: string) => path.startsWith(prefix)))
        errors.push(`${name}: ${path} outside allowed prefixes`);
    }
  }
  if (
    integration.mode === "image" &&
    /^[a-z0-9.+-]+$/.test(integration.package) &&
    !imagePackages.has(integration.package)
  )
    missing.push(`${id}: ${integration.package} absent from bunos-gaming gaming.packages`);
  if (
    integration.mode === "pacman-system" &&
    !integration.dependent &&
    !usrPackages.has(integration.package) &&
    !imagePackages.has(integration.package)
  )
    missing.push(`${id}: system package ${integration.package} not in a /usr composition`);
  if (
    integration.mode === "overlay" &&
    integration.target &&
    !manifest.prefixes.some((p: string) => integration.target.startsWith(p))
  )
    errors.push(`${id}: overlay target ${integration.target} outside allowed prefixes`);
  if (component.kind !== "model-weights" && weight.test(component.path ?? ""))
    errors.push(`${id}: weight path outside model-weights`);
}

for (const [composition, list] of Object.entries<string[]>(manifest.compositionPackages)) {
  if (!usr.compositions[composition]) errors.push(`compositionPackages.${composition}: unknown /usr composition`);
  for (const name of list)
    if (!bunosPackages.has(name)) errors.push(`compositionPackages.${composition}: ${name} has no component`);
}
if (usr.bunos?.manifest !== "factory/bunos/components.json")
  missing.push("factory/usr/manifest.json: bunos entry not wired");
const webapps = await Bun.file(join(here, "webapps.json")).json();
for (const app of webapps.apps) {
  const pkg = Bun.file(join(root, app.path, "package.json"));
  if (!(await pkg.exists())) errors.push(`webapps ${app.id}: ${app.path}/package.json missing`);
  else if (!(await pkg.json()).scripts?.[app.build]) errors.push(`webapps ${app.id}: no "${app.build}" script`);
  if (!/^[a-z0-9-]+$/.test(app.id)) errors.push(`webapps ${app.id}: invalid id`);
}

const shared = usr.localRepository?.packages;
if (shared) {
  const glob = new Bun.Glob("*/PKGBUILD");
  for (const own of glob.scanSync(join(here, "pkgbuilds")))
    if (await Bun.file(join(root, shared, own)).exists()) errors.push(`${own.split(/[\\/]/)[0]}: duplicates ${shared}`);
}
if (!usrPackages.has("bun-canary")) missing.push("/usr basePackages do not select the upstream runtime bun-canary");
if (
  imagesManifest.pins?.bun?.repository !== "oven-sh/bun" ||
  !/^[a-f0-9]{64}$/.test(imagesManifest.pins?.bun?.sha256 ?? "")
)
  missing.push("images do not pin the upstream oven-sh/bun runtime with a sha256");

for (const line of missing) console.log(`missing: ${line}`);
for (const line of errors) console.error(`error: ${line}`);
console.log(
  `${manifest.components.length} components, ${bunosPackages.size} bunos packages, ${errors.length} errors, ${missing.length} gaps`,
);
process.exit(errors.length ? 1 : 0);
