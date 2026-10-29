// SPDX-License-Identifier: Apache-2.0
// Source directories of every crate whose C symbols the single aphrody-ffi cdylib re-exports.
// n2b-core and oxc-bridge come from crates.io (sources in the former Bun fork packages/bun-n2b
// and packages/bun-oxc), so their sources are read from the Cargo registry at the pinned version.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const repo = join(import.meta.dir, "..", "..", "..", "..");

const REGISTRY_CRATES = ["aphrody-n2b-core", "aphrody-oxc-bridge"];

function pinnedVersion(name: string): string {
  const manifest = readFileSync(join(repo, "Cargo.toml"), "utf8");
  const m = manifest.match(new RegExp(`^${name}\\s*=\\s*\\{[^}\\n]*version\\s*=\\s*"=([^"]+)"`, "m"));
  if (!m) throw new Error(`${name} has no exact version pin in the workspace Cargo.toml`);
  return m[1]!;
}

function registrySource(name: string): string {
  const version = pinnedVersion(name);
  const root = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry", "src");
  for (const index of existsSync(root) ? readdirSync(root) : []) {
    const dir = join(root, index, `${name}-${version}`, "src");
    if (existsSync(dir)) return dir;
  }
  throw new Error(`${name} ${version} is not in the Cargo registry; run \`cargo fetch\` first`);
}

export function exportCrateDirs(): string[] {
  return [
    join(repo, "crates/interop/ffi/src"),
    join(repo, "crates/ui/bun/src"),
    ...REGISTRY_CRATES.map(registrySource),
  ];
}
