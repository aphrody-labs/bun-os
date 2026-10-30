import { appendFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { classify } from "./git-affected.ts";
import { writeAttributes, writeCodeowners, writeGitmodulesKeys, writeIgnoreRevs } from "./git-generate.ts";
import {
  applyConfig,
  applyProfile,
  doctor,
  git,
  gitlinks,
  loadProfiles,
  measure,
  prune,
  setupMaintenance,
} from "./git-scale.ts";

const usage = `aphrody-bun git <command>
  doctor [--json]                          check the clone against the recommended settings (exit 1 if not ok)
  setup [--dry-run] [--no-maintenance] [--scheduler] [--fast-status] [--untracked-cache]   apply per-clone config idempotently, register maintenance
  profile <name|list> [--dry-run] [--no-submodules]    sparse-checkout cone + shallow submodules for a profile
  clone <url> <dir> [--profile <name>]     scalar clone (blobless, sparse) or git clone --filter=blob:none --sparse
  status                                   profile, sparse state, submodule count, timed git status
  prune [--profile <name>]                 deinit submodules outside a profile, refresh commit-graph and MIDX
  measure [--json]                         median-of-3 timings without/with the recommended settings
  ci-prepare <profile>                     CI: cone for the profile, update=none for every submodule outside it
  affected [--base <ref>] [--github-output]  areas touched by git diff <base>...HEAD (js, rust, docs, infra, all)
  generate attributes|codeowners|ignore-revs|gitmodules|all`;

// Not imported from index.ts: CI runs this entry before `bun install`, when workspace dependencies are absent.
const repositoryRoot = resolvePath(import.meta.dir, "../../..");

export async function gitCommand(args: string[]): Promise<number> {
  const ri = args.indexOf("--root");
  const explicitRoot = ri >= 0 ? args[ri + 1] : undefined;
  const [cmd = "help", ...rest] = ri >= 0 ? args.filter((_, i) => i !== ri && i !== ri + 1) : args;
  const flag = (n: string) => rest.includes(n);
  const opt = (n: string) => {
    const i = rest.indexOf(n);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const root = explicitRoot ?? repositoryRoot;
  switch (cmd) {
    case "doctor": {
      const r = await doctor(root);
      if (flag("--json")) console.log(JSON.stringify(r, null, 2));
      else {
        console.log(`${r.git}; scalar ${r.scalar ? "yes" : "no"}; backfill ${r.backfill ? "yes" : "no"}`);
        for (const s of r.settings)
          console.log(`${s.ok ? "ok  " : "FAIL"} ${s.key} = ${s.have ?? "(unset)"} (want ${s.want})`);
        console.log(
          `sparse ${r.sparse}; partial clone ${r.partialClone ?? "no"}; fsmonitor ${r.fsmonitorRunning ?? "n/a"}; commit-graph ${r.commitGraph}; midx ${r.multiPackIndex}; maintenance ${r.maintenanceRegistered}; submodules ${r.initializedSubmodules}/${r.gitlinks} initialised`,
        );
      }
      return r.ok ? 0 : 1;
    }
    case "setup": {
      const changed = await applyConfig(root, flag("--dry-run"));
      console.log(changed.length ? `config: ${changed.join(", ")}` : "config: already applied");
      if (flag("--dry-run")) return 0;
      if (flag("--fast-status")) await git(root, ["config", "--local", "diff.ignoreSubmodules", "dirty"]);
      if (flag("--untracked-cache")) await git(root, ["config", "--local", "core.untrackedCache", "true"]);
      await git(root, ["config", "--local", "blame.ignoreRevsFile", ".git-blame-ignore-revs"]);
      await git(root, ["commit-graph", "write", "--reachable", "--changed-paths", "--split"]);
      if (!flag("--no-maintenance")) console.log(`maintenance: ${await setupMaintenance(root, flag("--scheduler"))}`);
      return 0;
    }
    case "profile": {
      const name = rest.find(a => !a.startsWith("--"));
      if (!name || name === "list") {
        const f = await loadProfiles();
        for (const [n, p] of Object.entries(f.profiles)) console.log(`${n.padEnd(16)} ${p.description}`);
        return 0;
      }
      console.log(
        JSON.stringify(
          await applyProfile(root, name, { submodules: !flag("--no-submodules"), dryRun: flag("--dry-run") }),
          null,
          2,
        ),
      );
      return 0;
    }
    case "clone": {
      const [url, dir] = rest.filter(a => !a.startsWith("--") && a !== opt("--profile"));
      if (!url || !dir) throw new Error(usage);
      const branch = ["--branch", opt("--branch") ?? "main", "--single-branch"];
      const scalar = Bun.which("scalar");
      const r = scalar
        ? await Bun.spawn(["scalar", "clone", ...branch, url, dir], { stdout: "inherit", stderr: "inherit" }).exited
        : (await git(process.cwd(), ["clone", "--filter=blob:none", "--sparse", ...branch, url, dir])).code;
      if (r) return r;
      const target = scalar ? `${dir}/src` : dir;
      const { resolve } = await import("node:path");
      const w = resolve(process.cwd(), target);
      await applyConfig(w);
      console.log(JSON.stringify(await applyProfile(w, opt("--profile") ?? "core"), null, 2));
      return 0;
    }
    case "status": {
      const t = performance.now();
      const s = await git(root, ["status", "--porcelain=v1"]);
      const ms = Math.round(performance.now() - t);
      const sparse = (await git(root, ["sparse-checkout", "list"])).out.split("\n").filter(Boolean);
      const subs = (await git(root, ["submodule", "status"])).out.split("\n").filter(Boolean);
      console.log(
        `status ${ms} ms, ${s.out.split("\n").filter(Boolean).length} changes; cone dirs: ${sparse.length ? sparse.join(" ") : "(full)"}; submodules initialised ${subs.filter(l => !l.startsWith("-")).length}/${subs.length}`,
      );
      return 0;
    }
    case "prune":
      console.log(JSON.stringify(await prune(root, opt("--profile")), null, 2));
      return 0;
    case "measure": {
      const rows = await measure(root);
      if (flag("--json")) console.log(JSON.stringify(rows, null, 2));
      else for (const r of rows) console.log(`${r.mode.padEnd(9)} ${r.label.padEnd(24)} ${r.ms} ms`);
      return 0;
    }
    case "ci-prepare": {
      const name = rest[0];
      if (!name) throw new Error(usage);
      const plan = await applyProfile(root, name, { submodules: false });
      const wanted = new Set(plan.submodules);
      const skipped: string[] = [];
      for (const link of await gitlinks(root)) {
        if (wanted.has(link) || (plan.sparse === false && name === "all")) continue;
        await git(root, ["config", "--local", `submodule.${link}.update`, "none"]);
        skipped.push(link);
      }
      console.log(
        `profile ${name}: ${plan.cone.length} cone dirs, ${wanted.size} submodules kept, ${skipped.length} skipped`,
      );
      return 0;
    }
    case "affected": {
      const base = opt("--base") ?? "origin/main";
      const diff = await git(root, ["diff", "--name-only", `${base}...HEAD`]);
      if (diff.code) throw new Error(diff.err);
      const areas = classify(diff.out.split("\n").filter(Boolean));
      console.log(JSON.stringify(areas));
      if (flag("--github-output") && Bun.env.GITHUB_OUTPUT)
        appendFileSync(
          Bun.env.GITHUB_OUTPUT,
          Object.entries(areas)
            .map(([k, v]) => `${k}=${v}\n`)
            .join(""),
        );
      return 0;
    }
    case "generate": {
      const what = rest[0] ?? "all";
      if (["attributes", "all"].includes(what)) {
        await writeAttributes(root);
        console.log("wrote .gitattributes");
      }
      if (["codeowners", "all"].includes(what)) {
        await writeCodeowners(root);
        console.log("wrote .github/CODEOWNERS");
      }
      if (["ignore-revs", "all"].includes(what))
        console.log(`wrote .git-blame-ignore-revs (${(await writeIgnoreRevs(root)).length} commits)`);
      if (["gitmodules", "all"].includes(what))
        console.log(`.gitmodules: ${(await writeGitmodulesKeys(root)).length} keys changed`);
      return 0;
    }
    default:
      console.log(usage);
      return cmd === "help" ? 0 : 1;
  }
}

if (import.meta.main) process.exitCode = await gitCommand(Bun.argv.slice(2));
