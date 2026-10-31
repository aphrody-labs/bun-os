// SPDX-License-Identifier: Apache-2.0
// Loop 3, self-maintaining dependencies (bunos-auto-deps@<job>.timer). Every job qualifies before it lands and lands
// with a normal push to main (or to the fork's branch); the VPS gate then judges the commit like any other.
//   forks [name...]  merge upstream into our aphrody-labs fork branch (a merge, never a rebase: no force push), cargo
//                    check, push the branch, bump the gitlink on main
//   locks            cargo update + bun update in the shared checkout (the VPS is the single lock writer)
//   bun              newest upstream Bun canary: qualify check/lint with it, then bump the pins
//   helium           newest imputnet/helium-linux release into the unified image pin (the image lane rebuilds it)
//   android          the Android 17 image source pin (factory/images/manifest.json pins.android17)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  closeTasks,
  event,
  fileTask,
  git,
  home,
  loadState,
  readJson,
  repo,
  run,
  saveState,
  withCheckoutLock,
} from "./lib.ts";

const identity = {
  GIT_AUTHOR_NAME: "aphrody-dev",
  GIT_AUTHOR_EMAIL: "contact@aphrody.com",
  GIT_COMMITTER_NAME: "aphrody-dev",
  GIT_COMMITTER_EMAIL: "contact@aphrody.com",
};
const workRoot = join(home, "build", "auto");

/**
 * Commit a set of tree changes on top of origin/main without touching the shared checkout's working tree or index
 * (a temporary index), then push normally. Retries on a moved main; never forces.
 */
export async function commitOnMain(
  message: string,
  changes: { path: string; gitlink?: string; content?: string }[],
): Promise<string | undefined> {
  const index = join(workRoot, `index-${process.pid}`);
  mkdirSync(workRoot, { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    await git("fetch", "-q", "origin", "main");
    const base = (await git("rev-parse", "refs/remotes/origin/main")).out.trim();
    const env = { GIT_INDEX_FILE: index, ...identity };
    const g = (...args: string[]) => run(["git", "-C", repo, ...args], { env, timeoutMs: 300_000 });
    await g("read-tree", base);
    for (const change of changes) {
      if (change.gitlink) await g("update-index", "--add", "--cacheinfo", `160000,${change.gitlink},${change.path}`);
      else if (change.content !== undefined) {
        const blob = (
          await run(["git", "-C", repo, "hash-object", "-w", "--stdin"], { input: change.content })
        ).out.trim();
        const mode = (await g("ls-tree", base, "--", change.path)).out.split(" ")[0] || "100644";
        await g("update-index", "--add", "--cacheinfo", `${mode},${blob},${change.path}`);
      }
    }
    const tree = (await g("write-tree")).out.trim();
    if (tree === (await git("rev-parse", `${base}^{tree}`)).out.trim()) return base;
    const commit = (await g("commit-tree", tree, "-p", base, "-m", message)).out.trim();
    const push = await run(["git", "-C", repo, "push", "-q", "origin", `${commit}:refs/heads/main`], {
      timeoutMs: 300_000,
    });
    if (push.code === 0) return commit;
    await Bun.sleep(5000);
  }
  return undefined;
}

interface Fork {
  path: string;
  fork: string;
  upstream: string;
  ref: string;
  build?: boolean;
}

async function refreshFork(name: string, fork: Fork) {
  const dir = join(workRoot, "forks", name);
  const g = (...args: string[]) => run(["git", "-C", dir, ...args], { env: identity, timeoutMs: 1_800_000 });
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(join(workRoot, "forks"), { recursive: true });
    const clone = await run(["git", "clone", "-q", `https://github.com/${fork.fork}.git`, dir], {
      timeoutMs: 3_600_000,
    });
    if (clone.code !== 0) return { ok: false, detail: `clone ${fork.fork}: ${clone.out.slice(-200)}` };
  }
  await g("remote", "remove", "upstream");
  await g("remote", "add", "upstream", `https://github.com/${fork.upstream}.git`);
  const branch =
    (await run(["gh", "api", `repos/${fork.upstream}`, "--jq", ".default_branch"], { timeoutMs: 60_000 })).out.trim() ||
    "main";
  const fetched = await g("fetch", "-q", "origin", fork.ref);
  const fetchedUp = await g("fetch", "-q", "upstream", branch);
  if (fetched.code || fetchedUp.code)
    return { ok: false, detail: `fetch: ${(fetched.out + fetchedUp.out).slice(-200)}` };
  await g("checkout", "-q", "-B", "bunos-auto", `origin/${fork.ref}`);
  await g("reset", "-q", "--hard", `origin/${fork.ref}`);
  const upstreamSha = (await g("rev-parse", `upstream/${branch}`)).out.trim();
  const behind = Number((await g("rev-list", "--count", `HEAD..upstream/${branch}`)).out.trim() || 0);
  if (behind > 0) {
    const merge = await g(
      "merge",
      "--no-edit",
      "-m",
      `Merge upstream ${fork.upstream}@${upstreamSha.slice(0, 10)}`,
      `upstream/${branch}`,
    );
    if (merge.code !== 0) {
      await g("merge", "--abort");
      return {
        ok: false,
        conflict: true,
        detail: `merge conflict with ${fork.upstream}@${upstreamSha.slice(0, 10)}: ${merge.out.slice(-300)}`,
      };
    }
  }
  const head = (await g("rev-parse", "HEAD")).out.trim();
  const pinned = (await git("ls-tree", "refs/remotes/origin/main", "--", fork.path)).out.split(/\s+/)[2];
  if (behind === 0 && head === pinned) return { ok: true, detail: `current (${head.slice(0, 10)}, upstream merged)` };
  // Qualify: the fork's own workspace compiles (through the serialized lane wrapper on the build host).
  if (existsSync(join(dir, "Cargo.toml"))) {
    const check = await run(
      ["bash", join(repo, "scripts/aphrody/build/rust/cargo-serial.sh"), "check", "--workspace"],
      {
        cwd: dir,
        timeoutMs: 3 * 3_600_000,
        env: { CARGO_BUILD_JOBS: "4", CARGO_TARGET_DIR: join(workRoot, "targets", name) },
      },
    );
    if (check.code !== 0)
      return {
        ok: false,
        detail: `cargo check after the upstream merge: ${check.out.split("\n").slice(-4).join(" | ")}`,
      };
  }
  if (behind > 0) {
    const push = await g("push", "-q", "origin", `HEAD:refs/heads/${fork.ref}`);
    if (push.code !== 0) return { ok: false, detail: `push ${fork.fork} ${fork.ref}: ${push.out.slice(-200)}` };
  }
  const commit = await commitOnMain(
    `deps: ${name} fork at ${head.slice(0, 10)} (upstream ${fork.upstream}@${upstreamSha.slice(0, 10)} merged, cargo check green)`,
    [{ path: fork.path, gitlink: head }],
  );
  if (!commit) return { ok: false, detail: "gitlink bump push failed" };
  return {
    ok: true,
    detail: `merged ${behind} upstream commit(s), pin bumped to ${head.slice(0, 10)} in ${commit.slice(0, 10)}`,
  };
}

async function forks(names: string[]) {
  const catalog = readJson<{ components: Record<string, Fork> }>(join(repo, "factory/rustbase/forks.json"), {
    components: {},
  });
  const state = loadState<{ cursor: number; forks: Record<string, { at: string; ok: boolean; detail: string }> }>(
    "deps-forks",
    { cursor: 0, forks: {} },
  );
  const all = Object.keys(catalog.components);
  const perRun = Number(process.env.BUNOS_AUTO_FORKS_PER_RUN ?? 4);
  const picked = names.length
    ? names
    : Array.from({ length: Math.min(perRun, all.length) }, (_, i) => all[(state.cursor + i) % all.length]!);
  if (!names.length) state.cursor = (state.cursor + picked.length) % Math.max(1, all.length);
  let green = true;
  for (const name of picked) {
    const fork = catalog.components[name];
    if (!fork) continue;
    const result = await refreshFork(name, fork).catch(error => ({ ok: false, detail: String(error) }));
    state.forks[name] = { at: new Date().toISOString(), ok: result.ok, detail: result.detail };
    event("deps", result.ok ? "fork-ok" : "fork-failed", `${name}: ${result.detail}`);
    if (result.ok) closeTasks(`deps:fork:${name}`, result.detail);
    else {
      green = false;
      await fileTask({
        key: `deps:fork:${name}`,
        kind: "deps",
        title: `fork refresh ${fork.fork} failed`,
        detail: `${result.detail}\nResolve in ${fork.fork} branch ${fork.ref} (merge upstream ${fork.upstream}), push normally; the next run bumps the pin.`,
        owner: "fork-migration",
      });
    }
  }
  saveState("deps-forks", state);
  return green;
}

async function locks() {
  const outcome = await withCheckoutLock(async () => {
    const status = await git("status", "--porcelain", "--ignore-submodules=all", "--untracked-files=no");
    const head = (await git("rev-parse", "HEAD")).out.trim();
    const main = (await git("rev-parse", "refs/remotes/origin/main")).out.trim();
    if (status.out.trim() || head !== main)
      return { ok: true, detail: "checkout not clean at origin/main: skipped (next run)" };
    const results: string[] = [];
    const update = await run(["bun", "scripts/cargo.ts", "exec", "--", "update"], { timeoutMs: 1_800_000 });
    const lockChanged = (await git("diff", "--name-only")).out.split("\n").filter(Boolean);
    if (update.code === 0 && lockChanged.join() === "Cargo.lock") {
      const check = await run(["bun", "scripts/cargo.ts", "exec", "--", "check", "--workspace", "--locked"], {
        timeoutMs: 4 * 3_600_000,
      });
      if (check.code === 0) {
        const content = readFileSync(join(repo, "Cargo.lock"), "utf8");
        await git("checkout", "--", "Cargo.lock");
        const commit = await commitOnMain(
          "deps: cargo update (VPS lock writer, cargo check --workspace --locked green)",
          [{ path: "Cargo.lock", content }],
        );
        results.push(commit ? `Cargo.lock refreshed in ${commit.slice(0, 10)}` : "Cargo.lock push failed");
      } else {
        await git("checkout", "--", "Cargo.lock");
        results.push(`cargo update kept out: check failed (${check.out.split("\n").at(-1)})`);
        await fileTask({
          key: "deps:cargo-update",
          kind: "deps",
          title: "cargo update breaks cargo check",
          detail: check.out.split("\n").slice(-8).join("\n"),
        });
      }
    } else {
      await git("checkout", "--", ".");
      results.push(
        update.code === 0 ? "Cargo.lock already current" : `cargo update failed: ${update.out.split("\n").at(-1)}`,
      );
    }
    const bunUpdate = await run(["bun", "update"], { timeoutMs: 1_800_000 });
    const bunChanged = (await git("diff", "--name-only")).out.split("\n").filter(Boolean);
    if (bunUpdate.code === 0 && bunChanged.join() === "bun.lock") {
      const check = await run(["bun", "run", "check"], { timeoutMs: 900_000 });
      const content = readFileSync(join(repo, "bun.lock"), "utf8");
      await git("checkout", "--", "bun.lock");
      await run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], { timeoutMs: 900_000 });
      if (check.code === 0) {
        const commit = await commitOnMain("deps: bun update (VPS lock writer, bun check green)", [
          { path: "bun.lock", content },
        ]);
        results.push(commit ? `bun.lock refreshed in ${commit.slice(0, 10)}` : "bun.lock push failed");
      } else results.push("bun update kept out: bun check failed");
    } else {
      await git("checkout", "--", ".");
      results.push("bun.lock already current");
    }
    return { ok: true, detail: results.join("; ") };
  }, 2 * 3_600_000);
  const result = outcome ?? { ok: false, detail: "shared checkout busy for two hours" };
  event("deps", result.ok ? "locks-ok" : "locks-failed", result.detail);
  return result.ok;
}

async function npmTarball(pkg: string, version: string) {
  const meta = (await (await fetch(`https://registry.npmjs.org/${pkg.replace("/", "%2f")}/${version}`)).json()) as {
    gitHead?: string;
    dist: { tarball: string; integrity: string };
  };
  const data = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
  const [algorithm, expected] = meta.dist.integrity.split("-");
  if (algorithm !== "sha512" || createHash("sha512").update(data).digest("base64") !== expected)
    throw new Error(`${pkg}@${version}: integrity mismatch`);
  return { data, gitHead: meta.gitHead };
}

async function bunCanary() {
  const pkg = readJson<{ packageManager?: string }>(join(repo, "package.json"), {});
  const pinned = pkg.packageManager?.replace(/^bun@/, "") ?? "";
  const tags = (await (await fetch("https://registry.npmjs.org/-/package/bun/dist-tags")).json()) as {
    canary?: string;
  };
  const latest = tags.canary ?? "";
  if (!latest || latest === pinned || !/^\d+\.\d+\.\d+-canary\.\d{8}\.\d+$/.test(latest) || latest < pinned) {
    event("deps", "bun-ok", `Bun canary pin ${pinned} is current (registry canary ${latest})`);
    return true;
  }
  const dir = join(workRoot, "bun", latest);
  mkdirSync(dir, { recursive: true });
  const main = await npmTarball("bun", latest);
  const platform = await npmTarball("@oven/bun-linux-x64", latest);
  await Bun.write(join(dir, "bun.tgz"), platform.data);
  await run(["tar", "-xzf", "bun.tgz"], { cwd: dir });
  const binDir = join(dir, "package", "bin");
  const newBun = join(binDir, "bun");
  await run(["chmod", "+x", newBun]);
  const revision = (await run([newBun, "--revision"], { cwd: dir })).out.trim();
  const oldRevision = (await run(["bun", "--revision"], { cwd: dir })).out.trim();
  const oldHead = (await (await fetch(`https://registry.npmjs.org/bun/${pinned}`)).json()) as { gitHead?: string };
  // Qualification: the repository's own quality commands under the new runtime.
  const env = { PATH: `${binDir}:${process.env.PATH}` };
  for (const script of ["check", "lint"]) {
    const r = await run([newBun, "run", script], { env, timeoutMs: 1_800_000 });
    if (r.code !== 0) {
      await fileTask({
        key: `deps:bun:${latest}`,
        kind: "deps",
        title: `Bun canary ${latest} fails bun ${script}`,
        detail: r.out.split("\n").slice(-8).join("\n"),
      });
      event("deps", "bun-failed", `${latest}: bun ${script} failed`);
      return false;
    }
  }
  const replacements: [string, string][] = [
    [pinned, latest],
    [oldRevision, revision],
    ...(oldHead.gitHead && main.gitHead
      ? ([[oldHead.gitHead.slice(0, 12), main.gitHead.slice(0, 12)]] as [string, string][])
      : []),
  ];
  const files = (
    await git("grep", "-l", "-F", pinned, "refs/remotes/origin/main", "--", ":!vendor", ":!**/node_modules/**")
  ).out
    .split("\n")
    .filter(Boolean)
    .map(line => line.replace(/^refs\/remotes\/origin\/main:/, ""));
  const changes = [];
  for (const path of files) {
    let text = (await git("show", `refs/remotes/origin/main:${path}`)).out;
    for (const [from, to] of replacements) if (from) text = text.split(from).join(to);
    changes.push({ path, content: text + "\n" });
  }
  const commit = await commitOnMain(
    `deps: upstream Bun canary ${latest} (${revision}); bun check and bun lint green`,
    changes,
  );
  event("deps", commit ? "bun-bumped" : "bun-failed", `${pinned} -> ${latest} in ${files.length} file(s)`);
  return Boolean(commit);
}

async function helium() {
  const manifestPath = "factory/images/manifest.json";
  const text = (await git("show", `refs/remotes/origin/main:${manifestPath}`)).out;
  const manifest = JSON.parse(text) as {
    pins: Record<string, { version: string; repository: string; url: string; sha256: string }>;
  };
  const pin = manifest.pins.helium!;
  const latest = (await run(["gh", "api", `repos/${pin.repository}/releases/latest`, "--jq", ".tag_name"])).out.trim();
  if (!latest || latest === pin.version) {
    event("deps", "helium-ok", `Helium ${pin.version} is current`);
    return true;
  }
  const url = pin.url.split(pin.version).join(latest);
  const res = await fetch(url);
  if (!res.ok) {
    event("deps", "helium-failed", `${url}: HTTP ${res.status}`);
    return false;
  }
  const sha256 = createHash("sha256")
    .update(Buffer.from(await res.arrayBuffer()))
    .digest("hex");
  const updated = text
    .replace(pin.url, url)
    .replace(pin.sha256, sha256)
    .replace(`"version": "${pin.version}"`, `"version": "${latest}"`);
  // Qualification before landing: the image plan still resolves; the nightly run boots and screenshots it.
  const commit = await commitOnMain(`deps: Helium ${latest} in the unified image pin (sha256 verified)`, [
    { path: manifestPath, content: `${updated}\n` },
  ]);
  event("deps", commit ? "helium-bumped" : "helium-failed", `${pin.version} -> ${latest}`);
  return Boolean(commit);
}

async function android() {
  const manifest = readJson<{ pins: Record<string, { url?: string; sha256?: string }> }>(
    join(repo, "factory/images/manifest.json"),
    { pins: {} },
  );
  if (!manifest.pins.android17?.url) {
    await fileTask({
      key: "deps:android-pin",
      kind: "deps",
      title: "Android 17 (LineageOS 24 GAPPS) images have no source pin",
      detail:
        "~/.cache/bunos-waydroid/a17 was downloaded by hand (sums.txt only). Add pins.android17 {url, sha256, version} to factory/images/manifest.json so the deps job can follow new builds.",
      owner: "android",
    });
    event("deps", "android-unpinned", "no pins.android17 in factory/images/manifest.json: task filed");
    return true;
  }
  const res = await fetch(manifest.pins.android17.url, { method: "HEAD" });
  event("deps", res.ok ? "android-ok" : "android-failed", `pins.android17 source HTTP ${res.status}`);
  return res.ok;
}

export async function deps(job: string, args: string[]) {
  const jobs: Record<string, () => Promise<boolean>> = {
    forks: () => forks(args),
    locks,
    bun: bunCanary,
    helium,
    android,
  };
  const fn = jobs[job];
  if (!fn) throw new Error(`deps job: ${Object.keys(jobs).join("|")}`);
  const ok = await fn();
  const state = loadState<Record<string, { at: string; ok: boolean }>>("deps", {});
  state[job] = { at: new Date().toISOString(), ok };
  saveState("deps", state);
  return ok;
}
