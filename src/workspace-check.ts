// SPDX-License-Identifier: Apache-2.0
// Root invariants: one Bun lockfile, one Cargo workspace and lockfile. Nested exceptions must be in docs/cargo-exceptions.json.
import { join } from "node:path";

type Entry = { path: string; class: string; reason: string };
type Ledger = {
  schemaVersion: number;
  classes: Record<string, string>;
  workspaces: Entry[];
  lockfiles: Entry[];
};

const BUN_LOCKS = new Set(["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
/** Third-party payloads and toolchains keep their own locks. */
const exempt = (path: string) => path.startsWith("vendor/") || path.startsWith("toolchains/");
const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);

async function tracked(root: string, patterns: string[]) {
  const proc = Bun.spawn(["git", "-c", "core.fsmonitor=false", "ls-files", "-z", "--", ...patterns], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ls-files failed: ${err}`);
  return out.split("\0").filter(Boolean).sort();
}

export async function checkWorkspaceInvariants(root: string) {
  const ledger = (await Bun.file(join(root, "docs/cargo-exceptions.json")).json()) as Ledger;
  const files = await tracked(root, [
    ":(glob)**/Cargo.lock",
    ":(glob)**/Cargo.toml",
    ...[...BUN_LOCKS].map(name => `:(glob)**/${name}`),
  ]);
  const workspaceManifests: string[] = [];
  for (const path of files.filter(file => base(file) === "Cargo.toml" && file !== "Cargo.toml" && !exempt(file))) {
    // Tracked but unmaterialized (sparse) manifests cannot be read; they are not declared roots.
    const file = Bun.file(join(root, path));
    if ((await file.exists()) && /^\[workspace[.\]]/m.test(await file.text())) workspaceManifests.push(path);
  }
  const cargoLocks = files.filter(file => base(file) === "Cargo.lock" && file !== "Cargo.lock" && !exempt(file));
  const violations: { kind: string; path: string; detail: string }[] = [];
  for (const path of files.filter(file => BUN_LOCKS.has(base(file)) && file !== "bun.lock" && !exempt(file)))
    violations.push({
      kind: "nested-bun-lock",
      path,
      detail: "Only the root bun.lock may exist outside vendor/ and toolchains/",
    });
  const check = (kind: string, found: string[], entries: Entry[]) => {
    const listed = new Map(entries.map(entry => [entry.path, entry]));
    for (const path of found) {
      const entry = listed.get(path);
      if (!entry)
        violations.push({
          kind: `unlisted-${kind}`,
          path,
          detail: "Not in docs/cargo-exceptions.json",
        });
      else if (!ledger.classes[entry.class] || !entry.reason)
        violations.push({
          kind: `invalid-${kind}-entry`,
          path,
          detail: "Unknown class or missing reason",
        });
    }
    for (const entry of entries)
      if (!found.includes(entry.path))
        violations.push({
          kind: `stale-${kind}-entry`,
          path: entry.path,
          detail: "Ledger entry has no tracked nested file",
        });
  };
  check("workspace", workspaceManifests, ledger.workspaces);
  check("cargo-lock", cargoLocks, ledger.lockfiles);
  const pendingMigrations = [...ledger.workspaces, ...ledger.lockfiles]
    .filter(entry => entry.class === "migrate")
    .map(entry => entry.path)
    .sort();
  return {
    ok: violations.length === 0,
    counts: {
      nestedWorkspaces: workspaceManifests.length,
      nestedCargoLocks: cargoLocks.length,
      violations: violations.length,
      pendingMigrations: pendingMigrations.length,
    },
    violations,
    pendingMigrations,
  };
}

/** Recursively sorted keys so persisted inventories diff meaningfully. */
export function stableJson(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, sort(v)]),
          )
        : item;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
