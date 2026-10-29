#!/usr/bin/env bun
/**
 * Computes factory/rustbase/catalog.json from factory/rustbase/domains.json: ranks are DATA.
 *   bun factory/rustbase/rank.ts [--only <domain>[,<domain>]] [--out <file>]
 * Sources (all queried live, nothing hand-typed): GitHub REST (repo, commits, releases, tags, refs, contents),
 * archlinux.org package search (official repos), AUR RPC, the pinned CachyOS-PKGBUILDS recipe catalog
 * (factory/arch/cachyos/catalog.json) and the Omarchy package lists (factory/arch/omarchy/packages.json).
 * Auth: token from `gh auth token`, kept in memory, never printed or written.
 */
import { join, resolve } from "node:path";

const root = process.env.RUSTBASE_ROOT ?? resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("--only")?.split(",");
const outFile = flag("--out") ?? join(import.meta.dir, "catalog.json");

const now = new Date();
const observedAt = now.toISOString().slice(0, 10);
const year = now.getUTCFullYear();
const since90 = new Date(now.getTime() - 90 * 86400_000).toISOString();

export const SCORING = {
  max: 88,
  stars: "25 * min(1, log10(stars + 1) / 5)",
  commits90d: "15 * min(1, commitsLast90d / 50) (API page cap 100)",
  release: "20 if latest stable release/tag dated in the current year, 10 previous year, 4 two years ago, else 0",
  license: "5 if GitHub reports an SPDX id other than NOASSERTION/none",
  arch: "15 official Arch repo (core/extra), 10 CachyOS-PKGBUILDS recipe, 5 AUR, 0 none",
  omarchy: "3 if the package is in an Omarchy default package list",
  tests: "5 if the repo root has a tests/test dir or CI workflows exist",
  credible: "not archived, primary language Rust (unless allowNonRust), stars >= 300, pushed within 400 days, score >= 45; otherwise the domain is a gap",
};

const token = (
  await (async () => {
    const p = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe" });
    const t = (await new Response(p.stdout).text()).trim();
    await p.exited;
    return t;
  })()
).trim();
if (!token) throw new Error("gh auth token returned nothing");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function gh(path: string, tries = 4): Promise<any | undefined> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "bunos-rustbase" },
    });
    if (res.status === 404 || res.status === 409) return undefined;
    if (res.status === 202 || res.status >= 500) {
      await sleep(1500 * (i + 1));
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000 - Date.now();
      await sleep(Math.min(Math.max(reset, 2000), 60_000));
      continue;
    }
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`${path}: gave up`);
}
async function web(url: string): Promise<any | undefined> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "bunos-rustbase" } });
      if (res.ok) return await res.json();
      if (res.status === 404) return undefined;
    } catch {}
    await sleep(1000 * (i + 1));
  }
}

// ---- distro signals --------------------------------------------------------------------------------------------
const cachy = await Bun.file(join(root, "factory/arch/cachyos/catalog.json")).json();
const cachyNames = new Set<string>();
for (const c of cachy.catalogs ?? [])
  for (const r of c.recipes ?? []) cachyNames.add(String(r.recipe).split("/")[0]);
const omarchyPk = await Bun.file(join(root, "factory/arch/omarchy/packages.json")).json();
const omarchyNames = new Set<string>();
for (const l of omarchyPk.lists ?? []) for (const p of l.packages ?? []) omarchyNames.add(String(p));

const archCache = new Map<string, any>();
async function archOfficial(name: string) {
  if (!archCache.has(name)) {
    const j = await web(`https://archlinux.org/packages/search/json/?name=${encodeURIComponent(name)}`);
    const hit = (j?.results ?? []).find((r: any) => r.arch === "x86_64" || r.arch === "any");
    archCache.set(
      name,
      hit && { pkgname: hit.pkgname, repo: hit.repo, version: `${hit.pkgver}-${hit.pkgrel}`, upstreamVersion: hit.pkgver, url: hit.url, licenses: hit.licenses },
    );
  }
  return archCache.get(name);
}
async function aur(names: string[]) {
  if (!names.length) return {};
  const q = names.map(n => `arg[]=${encodeURIComponent(n)}`).join("&");
  const j = await web(`https://aur.archlinux.org/rpc/v5/info?${q}`);
  const out: Record<string, any> = {};
  for (const r of j?.results ?? []) out[r.Name] = { pkgname: r.Name, version: r.Version, votes: r.NumVotes, popularity: r.Popularity, outOfDate: r.OutOfDate };
  return out;
}

// ---- GitHub ----------------------------------------------------------------------------------------------------
const isStable = (tag: string) => !/(nightly|canary|latest|dev|alpha|beta|rc|pre|snapshot)/i.test(tag);

async function resolveTag(repo: string, tag: string) {
  const ref = await gh(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag).replace(/%2F/g, "/")}`);
  let sha: string | undefined = ref?.object?.sha;
  let type: string | undefined = ref?.object?.type;
  for (let i = 0; i < 3 && sha && type === "tag"; i++) {
    const t = await gh(`/repos/${repo}/git/tags/${sha}`);
    sha = t?.object?.sha;
    type = t?.object?.type;
  }
  return sha;
}

async function latestRelease(repo: string, prefix?: string) {
  const rels: any[] = (await gh(`/repos/${repo}/releases?per_page=20`)) ?? [];
  const rel = rels.find(r => !r.draft && !r.prerelease && isStable(r.tag_name) && (!prefix || r.tag_name.startsWith(prefix)));
  if (rel) {
    const sha = await resolveTag(repo, rel.tag_name);
    if (sha) return { tag: rel.tag_name, sha, date: String(rel.published_at).slice(0, 10), source: "github-release", url: rel.html_url };
  }
  const tags: any[] = (await gh(`/repos/${repo}/tags?per_page=40`)) ?? [];
  const tag = tags.find(t => isStable(t.name) && /\d/.test(t.name) && (!prefix || t.name.startsWith(prefix)));
  if (!tag) return undefined;
  const sha = await resolveTag(repo, tag.name);
  const c = sha ? await gh(`/repos/${repo}/commits/${sha}`) : undefined;
  return { tag: tag.name, sha: sha ?? tag.commit.sha, date: String(c?.commit?.committer?.date ?? "").slice(0, 10) || undefined, source: "git-tag", url: `https://github.com/${repo}/releases/tag/${tag.name}` };
}

async function analyse(domain: any, cand: any) {
  const repoName: string = cand.repo;
  const r = await gh(`/repos/${repoName}`);
  if (!r) return { repo: repoName, error: "repository not found (404)" };
  const full: string = r.full_name;
  const [commits, release, rootList, wf] = await Promise.all([
    gh(`/repos/${full}/commits?since=${since90}&per_page=100`),
    latestRelease(full, cand.tagPrefix),
    gh(`/repos/${full}/contents/`),
    gh(`/repos/${full}/contents/.github/workflows`),
  ]);
  const names: string[] = Array.isArray(rootList) ? rootList.map((e: any) => e.name) : [];
  const testDirs = names.filter(n => /^(tests?|testing|spec|specs|e2e)$/i.test(n));
  const workflows = Array.isArray(wf) ? wf.length : 0;
  const officialHits = (await Promise.all((cand.arch ?? []).map((n: string) => archOfficial(n)))).filter(Boolean);
  const official = officialHits[0];
  const aurHits = official ? {} : await aur(cand.arch ?? []);
  const aurHit = Object.values(aurHits)[0] as any;
  const cachyHit = (cand.arch ?? []).find((n: string) => cachyNames.has(n));
  const omarchyHit = (cand.arch ?? []).find((n: string) => omarchyNames.has(n));

  const stars: number = r.stargazers_count;
  const spdx: string | null = r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : null;
  const commits90d = Array.isArray(commits) ? commits.length : 0;
  const relYear = release?.date ? Number(release.date.slice(0, 4)) : 0;
  const archTier = official ? 15 : cachyHit ? 10 : aurHit ? 5 : 0;
  const parts = {
    stars: +(25 * Math.min(1, Math.log10(stars + 1) / 5)).toFixed(2),
    commits90d: +(15 * Math.min(1, commits90d / 50)).toFixed(2),
    release: relYear === year ? 20 : relYear === year - 1 ? 10 : relYear === year - 2 ? 4 : 0,
    license: spdx ? 5 : 0,
    arch: archTier,
    omarchy: omarchyHit ? 3 : 0,
    tests: testDirs.length || workflows ? 5 : 0,
  };
  const total = +Object.values(parts).reduce((a, b) => a + b, 0).toFixed(2);
  const daysSincePush = (now.getTime() - Date.parse(r.pushed_at)) / 86400_000;
  const reasons: string[] = [];
  if (r.archived) reasons.push("archived");
  if (r.language !== "Rust" && !domain.allowNonRust) reasons.push(`primary language ${r.language}`);
  if (stars < 300) reasons.push(`stars ${stars} < 300`);
  if (daysSincePush > 400) reasons.push(`last push ${Math.floor(daysSincePush)} days ago`);
  if (total < 45) reasons.push(`score ${total} < 45`);
  return {
    repo: full,
    requestedRepo: repoName === full ? undefined : repoName,
    fork: cand.fork,
    url: r.html_url,
    description: r.description,
    stars,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    language: r.language,
    license: spdx,
    archived: r.archived,
    createdAt: String(r.created_at).slice(0, 10),
    pushedAt: String(r.pushed_at).slice(0, 10),
    commitsLast90d: commits90d,
    release: release ?? null,
    arch: {
      official: official ?? null,
      cachyosRecipe: cachyHit ?? null,
      aur: aurHit ?? null,
      omarchyDefault: omarchyHit ?? null,
    },
    tests: { rootDirs: testDirs, workflowFiles: workflows },
    score: { parts, total },
    credible: reasons.length === 0,
    notCredibleReasons: reasons,
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const spec = await Bun.file(join(import.meta.dir, "domains.json")).json();
const domains = spec.domains.filter((d: any) => !only || only.includes(d.id));
const analysed = new Map<string, any>();
const jobs: { d: any; c: any }[] = [];
for (const d of domains) for (const c of d.candidates) jobs.push({ d, c });
console.error(`${domains.length} domains, ${jobs.length} candidates`);
const results = await pool(jobs, 6, async ({ d, c }) => {
  const key = `${d.allowNonRust ? "x" : "r"}:${c.repo}`;
  if (!analysed.has(key)) analysed.set(key, analyse(d, c));
  const res = await analysed.get(key);
  console.error(`  ${d.id}: ${c.repo} -> ${res.error ?? res.score.total}`);
  return res;
});

let k = 0;
const outDomains = domains.map((d: any) => {
  const cands = d.candidates.map(() => results[k++]);
  const errors = cands.filter((c: any) => c.error);
  const ranked = cands
    .filter((c: any) => !c.error)
    .sort((a: any, b: any) => b.score.total - a.score.total || b.stars - a.stars)
    .map((c: any, i: number) => ({ rank: i + 1, ...c }));
  const credible = ranked.filter((c: any) => c.credible);
  const dataPick = credible[0];
  const ownerPick = d.ownerPick ? ranked.find((c: any) => c.repo.toLowerCase() === d.ownerPick.toLowerCase() || c.requestedRepo === d.ownerPick) : undefined;
  if (d.ownerPick && !ownerPick) throw new Error(`${d.id}: ownerPick ${d.ownerPick} not among candidates`);
  const status = ownerPick ? "directive" : dataPick ? "pick" : "gap";
  const chosen = ownerPick ?? dataPick;
  return {
    id: d.id,
    title: d.title,
    replaces: d.replaces,
    status,
    ownerDirective: d.ownerDirective,
    dataRank1: ranked[0]?.repo,
    pick: chosen ? chosen.repo : null,
    bestAvailable: chosen ? undefined : ranked[0]?.repo ?? null,
    runnersUp: ranked.filter((c: any) => c.repo !== chosen?.repo).map((c: any) => c.repo),
    candidates: ranked,
    errors: errors.map((e: any) => ({ repo: e.repo, error: e.error })),
  };
});

const counts = {
  domains: outDomains.length,
  candidates: jobs.length,
  picks: outDomains.filter((d: any) => d.status === "pick").length,
  directives: outDomains.filter((d: any) => d.status === "directive").length,
  gaps: outDomains.filter((d: any) => d.status === "gap").length,
  unresolvedCandidates: outDomains.reduce((a: number, d: any) => a + d.errors.length, 0),
};
const catalog = { schemaVersion: 1, kind: "bunos-rustbase-catalog", observedAt, generator: "factory/rustbase/rank.ts", scoring: SCORING, counts, domains: outDomains };
await Bun.write(outFile, JSON.stringify(catalog, null, 2) + "\n");
console.log(JSON.stringify(counts));
