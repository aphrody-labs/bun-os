/* SPDX-License-Identifier: Apache-2.0 */
/** Rank, group and audit owned GitHub repositories using the authenticated gh CLI. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Repo = {
  nameWithOwner: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  stargazerCount: number;
  forkCount: number;
  updatedAt: string;
};
// Repository root: this file lives in scripts/audit/workspace/.
const root = resolve(import.meta.dir, "../../../../");
const run = async (args: string[]) => (await Bun.$`gh ${args}`.text()).trim();
const repos = JSON.parse(
  await run([
    "repo",
    "list",
    "--limit",
    "1000",
    "--json",
    "nameWithOwner,url,description,isPrivate,isArchived,isFork,stargazerCount,forkCount,updatedAt",
  ]),
) as Repo[];
const priorities = ["aphrody-code/nie", "aphrody-code/bxc", "aphrody-code/n2b", "aphrody-code/aphrody"];
const packageTypes = ["npm", "container", "maven", "rubygems", "nuget", "docker"];
const packages = (
  await Promise.all(
    packageTypes.map(async type => {
      try {
        return JSON.parse(await run(["api", `user/packages?package_type=${type}&per_page=100`])) as Array<
          Record<string, unknown>
        >;
      } catch {
        return [];
      }
    }),
  )
)
  .flat()
  .map(item => ({
    name: item.name,
    type: item.package_type,
    visibility: item.visibility,
    updatedAt: item.updated_at,
  }));
const gists = JSON.parse(await run(["api", "gists?per_page=100"])) as Array<Record<string, unknown>>;
const active = repos.filter(r => !r.isArchived);
const score = (r: Repo): number => {
  const age = Math.max(0, (Date.now() - Date.parse(r.updatedAt)) / 86_400_000);
  return Math.round(
    r.stargazerCount * 10 + r.forkCount * 5 + Math.max(0, 100 - age) + (r.description ? 10 : 0) + (r.isPrivate ? 0 : 5),
  );
};
const ranked = active
  .map(repo => ({
    ...repo,
    priority: priorities.includes(repo.nameWithOwner),
    score: score(repo) + (priorities.includes(repo.nameWithOwner) ? 1000 : 0),
  }))
  .toSorted((a, b) => b.score - a.score || a.nameWithOwner.localeCompare(b.nameWithOwner));
const groups = new Map<string, string[]>();
for (const repo of active) {
  const [, name = repo.nameWithOwner] = repo.nameWithOwner.split("/");
  const key = name.toLowerCase().replace(/[-_.](cli|rs|cpp|csharp|py|ts)$/g, "");
  groups.set(key, [...(groups.get(key) ?? []), repo.nameWithOwner]);
}
const duplicates = [...groups]
  .filter(([, values]) => values.length > 1)
  .map(([key, values]) => ({ key, repositories: values }));
const report = {
  generatedBy: "aphrody git",
  generatedAt: new Date().toISOString(),
  owner: "aphrody-code",
  priorities,
  activeCount: active.length,
  archivedCount: repos.length - active.length,
  ranked,
  duplicateGroups: duplicates,
  packages,
  gists: gists.map(gist => ({
    id: gist.id,
    public: gist.public,
    updatedAt: gist.updated_at,
    url: gist.html_url,
  })),
};
const out = join(root, ".agents", "plugins", "github-repository-intelligence.json");
mkdirSync(join(root, ".agents", "plugins"), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`ranked ${active.length} active repositories; ${duplicates.length} duplicate groups; wrote ${out}`);
