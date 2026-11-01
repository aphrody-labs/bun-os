// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { PRIVATE_OWNER_ROOT } from "@aphrody/scaffold";
import type { MigrationRequirement } from "./requirements";
import { isSourceProjectConfig } from "./scanner";

interface PackageManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: { packages?: string[]; catalog?: Record<string, string> };
}

const readManifest = (path: string) => JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, "")));

/** Qualify imported package owners against the private checkout before writing an app. */
export function qualifyDependencies(
  file: string,
  code: string,
  sourceDir: string,
): {
  dependencies: Record<string, string>;
  requirements: MigrationRequirement[];
} {
  const owner = readManifest(resolve(PRIVATE_OWNER_ROOT, "package.json"));
  // The M3 owner is folded into the repository's single Bun workspace, which holds the members and the catalog.
  const repositoryRoot = PRIVATE_OWNER_ROOT;
  const repository = readManifest(resolve(repositoryRoot, "package.json"));
  const workspaces = repository.workspaces ?? owner.workspaces;
  const sourceManifest = resolve(sourceDir, "package.json");
  const declared = existsSync(sourceManifest) ? (readManifest(sourceManifest).dependencies ?? {}) : {};
  const dependencies: Record<string, string> = {};
  const requirements: MigrationRequirement[] = [];
  const add = (path: string, detail: string) =>
    requirements.push({
      file,
      capability: "source dependency adapter",
      detail: path + ": " + detail,
    });
  const loader = file.endsWith(".tsx") ? "tsx" : file.endsWith(".jsx") ? "jsx" : file.endsWith(".ts") ? "ts" : "js";
  let imports: ReturnType<Bun.Transpiler["scan"]>["imports"];
  try {
    imports = new Bun.Transpiler({ loader }).scan(code).imports;
  } catch {
    add(file, "transformed syntax requires a native adapter before activation");
    return { dependencies, requirements };
  }
  for (const { path } of imports) {
    if (path.startsWith("m3:")) continue;
    if (path.startsWith(".")) {
      try {
        const resolved = Bun.resolveSync(path.split(/[?#]/)[0]!, dirname(resolve(sourceDir, file)));
        const member = relative(realpathSync(sourceDir), realpathSync(resolved));
        if (isAbsolute(member) || member === ".." || member.startsWith(`..${sep}`))
          add(path, "the relative import escapes the preserved private source graph");
        else if (member.split(sep).some(part => part.startsWith(".")) || isSourceProjectConfig(basename(resolved)))
          add(path, "the imported source is protected or excluded configuration");
        else if (member.replaceAll("\\", "/").startsWith("public/"))
          add(path, "public URL assets require a native module mapping before relocation");
      } catch {
        add(path, "the source file cannot be resolved before migration");
      }
      continue;
    }
    if (path.startsWith("/")) {
      add(path, "absolute imports require a native source mapping before relocation");
      continue;
    }
    if (path.startsWith("node:") || path.startsWith("bun:") || builtins.has(path)) {
      add(path, "backend modules need a registered native request host before client activation");
      continue;
    }
    const name = path.startsWith("@") ? path.split("/").slice(0, 2).join("/") : path.split("/")[0]!;
    const memberManifest = [
      ...new Bun.Glob("packages/*/package.json").scanSync({
        cwd: PRIVATE_OWNER_ROOT,
        onlyFiles: true,
      }),
    ]
      .map(manifestPath => ({
        directory: dirname(resolve(PRIVATE_OWNER_ROOT, manifestPath)),
        manifest: readManifest(resolve(PRIVATE_OWNER_ROOT, manifestPath)),
      }))
      .find(candidate => candidate.manifest.name === name);
    let modulePath: string;
    try {
      modulePath = Bun.resolveSync(path, resolve(memberManifest?.directory ?? PRIVATE_OWNER_ROOT, "package.json"));
    } catch {
      add(path, "the installed private owner cannot resolve this import; qualify its source acquisition first");
      continue;
    }
    let directory = dirname(modulePath);
    let installed: PackageManifest | undefined;
    while (directory !== dirname(directory)) {
      const manifestPath = resolve(directory, "package.json");
      if (existsSync(manifestPath)) {
        const manifest = readManifest(manifestPath);
        if (manifest.name === name) {
          installed = manifest;
          break;
        }
      }
      directory = dirname(directory);
    }
    if (!installed) {
      add(path, "no canonical installed package owner was found");
      continue;
    }
    const member = relative(repositoryRoot, directory).replaceAll("\\", "/");
    const patterns = workspaces?.packages ?? [];
    const workspace =
      patterns.some(pattern => !pattern.startsWith("!") && new Bun.Glob(pattern).match(member)) &&
      !patterns.some(pattern => pattern.startsWith("!") && new Bun.Glob(pattern.slice(1)).match(member));
    const range = declared[name];
    if (range && !range.startsWith("workspace:") && range !== "catalog:") {
      try {
        if (!installed.version || !Bun.semver.satisfies(installed.version, range)) {
          add(path, "source range " + range + " is incompatible with installed owner version " + installed.version);
          continue;
        }
      } catch {
        add(path, "the source dependency range needs an explicit native source acquisition contract");
        continue;
      }
    }
    if (workspace) dependencies[name] = "workspace:*";
    else if (workspaces?.catalog?.[name]) dependencies[name] = "catalog:";
    else {
      const ownerRange = owner.dependencies?.[name] ?? owner.devDependencies?.[name];
      if (ownerRange) dependencies[name] = ownerRange;
      else
        add(
          path,
          "a transitive installation does not declare ownership; add a qualified private owner or catalog contract",
        );
    }
  }
  return { dependencies, requirements };
}
