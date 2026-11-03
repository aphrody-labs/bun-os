// SPDX-License-Identifier: Apache-2.0
// Commit and push exactly the given paths from the working tree on top of origin/main, without touching the shared
// index, HEAD or any other file in the working tree (docs/ops/SYNC.md). Several agents share one checkout per host; a
// normal `git add` + `commit` sweeps in whatever another agent staged, and `pull --rebase` stalls on their dirty
// submodules. This builds the commit in a temporary index instead:
//
//   bun scripts/git-commit-paths.ts -m "message" <path>...
//
// Files are taken as they are in the working tree (a missing path is committed as a deletion); a submodule path is
// committed at its checked-out HEAD, which must already be on the submodule's remote. Retries when origin moved.
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const m = args.indexOf("-m");
if (m < 0 || !args[m + 1]) {
  console.error('usage: bun scripts/git-commit-paths.ts -m "message" <path>...');
  process.exit(2);
}
const message = args[m + 1];
const paths = args.filter((_, i) => i !== m && i !== m + 1);
if (paths.length === 0) {
  console.error("no paths given");
  process.exit(2);
}

const gitBin = Bun.which("git.exe") || "git";
const root = Bun.spawnSync([gitBin, "rev-parse", "--show-toplevel"]).stdout.toString().trim();
const dir = mkdtempSync(join(tmpdir(), "git-commit-paths-"));
const env = {
  ...process.env,
  GIT_INDEX_FILE: join(dir, "index"),
  GIT_AUTHOR_NAME: "aphrody-dev",
  GIT_AUTHOR_EMAIL: "contact@aphrody.com",
  GIT_COMMITTER_NAME: "aphrody-dev",
  GIT_COMMITTER_EMAIL: "contact@aphrody.com",
};
function git(argv: string[], input?: string) {
  const r = Bun.spawnSync([gitBin, "-C", root, ...argv], { env, stdin: input === undefined ? "ignore" : Buffer.from(input) });
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
}
function must(argv: string[], input?: string) {
  const r = git(argv, input);
  if (r.code !== 0) throw new Error(`git ${argv.join(" ")}: ${r.err || r.out}`);
  return r.out;
}

try {
  for (let attempt = 1; attempt <= 6; attempt++) {
    must(["fetch", "-q", "--no-recurse-submodules", "origin", "main"]);
    const base = must(["rev-parse", "origin/main"]);
    must(["read-tree", base]);
    for (const p of paths) {
      const abs = join(root, p);
      if (!existsSync(abs)) {
        git(["update-index", "--force-remove", "--", p]);
      } else if (statSync(abs).isDirectory() && existsSync(join(abs, ".git"))) {
        const sha = Bun.spawnSync([gitBin, "-C", abs, "rev-parse", "HEAD"]).stdout.toString().trim();
        must(["update-index", "--add", "--cacheinfo", `160000,${sha},${p.replaceAll("\\", "/")}`]);
      } else {
        // `git add` on the temporary index: honours .gitattributes (eol) and recurses into directories.
        must(["add", "--", p]);
        // core.filemode=false (Windows) adds every new file as 100644: give new scripts (#!) their executable bit.
        for (const f of must(["ls-files", "--", p]).split("\n").filter(Boolean)) {
          if (git(["cat-file", "-e", `${base}:${f}`]).code === 0) continue;
          if ((await Bun.file(join(root, f)).slice(0, 2).text()) === "#!") must(["update-index", "--chmod=+x", "--", f]);
        }
      }
    }
    const tree = must(["write-tree"]);
    if (tree === must(["rev-parse", `${base}:`])) {
      console.log("nothing to commit: origin/main already has these paths as they are");
      process.exit(0);
    }
    const commit = must(["commit-tree", tree, "-p", base, "-F", "-"], message);
    const push = git(["push", "-q", "origin", `${commit}:refs/heads/main`]);
    if (push.code === 0) {
      console.log(`pushed ${commit.slice(0, 10)} on ${base.slice(0, 10)}: ${message.split("\n")[0]}`);
      process.exit(0);
    }
    console.error(`push attempt ${attempt} rejected (origin moved?), retrying`);
    await Bun.sleep(1000 * attempt);
  }
  console.error("giving up after 6 attempts");
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
