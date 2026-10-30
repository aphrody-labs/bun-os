// SPDX-License-Identifier: Apache-2.0
import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cargoJobsSetting,
  cargoSelection,
  desktopOffenders,
  desktopRequirements,
  expandHome,
  gitDaemonCommand,
  isSnapshotCollision,
  loadConfig,
  localQuote,
  sshBase,
  PIN_RETENTION_DAYS,
  pinRef,
  matchesPackageSpec,
  remoteCheckoutScript,
  remoteForgetScript,
  remoteRunScript,
  remoteSeedScript,
  remoteVerifyScript,
  repositoryConfig,
  secretLikePaths,
  shellQuote,
  SnapshotCollision,
  snapshot,
  tunnelCommand,
  withSnapshotBackoff,
} from "./vps-cargo";

const config = await loadConfig();
const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("vps-cargo", () => {
  test("explicit auto job selection reaches every CPU on the remote host", () => {
    expect(cargoJobsSetting(undefined, config)).toBe(12);
    expect(cargoJobsSetting("3", config)).toBe(3);
    expect(cargoJobsSetting("auto", config)).toBe("auto");
    expect(cargoJobsSetting("12", config)).toBe(12);
    expect(() => cargoJobsSetting("13", config)).toThrow("--jobs must be 1..12, or auto");
    expect(() => cargoJobsSetting("1.5", config)).toThrow("--jobs must be 1..12, or auto");

    const script = remoteRunScript(config, SHA, "all-cpus", ["check", "-p", "aphrody"], "auto");
    expect(script).toContain("APHRODY_CARGO_JOBS=auto");
    expect(script).toContain("flock --close /home/ubuntu/build/locks/heavy.lock");
    expect(script).toContain("aphrody.source.lock");
    expect(script).toContain("MemAvailable:");
    expect(script).toContain("policy.jobs=Math.min(policy.jobs,cpus)");
    expect(script).toContain("CARGO_BUILD_JOBS=");
  });

  test("quotes only what needs quoting", () => {
    expect(shellQuote("clippy")).toBe("clippy");
    expect(shellQuote("-D warnings")).toBe("'-D warnings'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  test("expands the home prefix only", () => {
    expect(expandHome("~/.ssh/cm/x", "/home/u")).toBe("/home/u/.ssh/cm/x");
    expect(expandHome("/abs", "/home/u")).toBe("/abs");
  });

  test("tunnel carries the reverse git-daemon forward and reconnects", () => {
    const command = tunnelCommand(config, "linux");
    expect(command).toContain("-R 127.0.0.1:19418:127.0.0.1:9418");
    expect(command).toContain("ExitOnForwardFailure=yes");
    expect(command.startsWith("while true; do ssh ")).toBe(true);
    expect(gitDaemonCommand(config)).toContain("--listen=127.0.0.1");
  });

  test("Windows tunnel uses native Bun and preserves each SSH argument", () => {
    const c = { ...config, host: "build host's alias" };
    const command = tunnelCommand(c, "win32");
    expect(command.startsWith("& '")).toBe(true);
    expect(command).toContain("Bun.spawn(");
    expect(command).toContain("build host''s alias");
    expect(sshBase(c, "win32")).toEqual(["ssh", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"]);
    expect(localQuote("C:/User's home", "win32")).toBe("'C:/User''s home'");
    expect(gitDaemonCommand({ ...config, gitDaemon: { ...config.gitDaemon, basePath: "C:/" } }, "win32")).toContain(
      "--base-path='C:'",
    );
    expect(
      gitDaemonCommand(
        {
          ...config,
          gitDaemon: { ...config.gitDaemon, basePath: "C:/User's home" },
        },
        "win32",
      ),
    ).toContain("--base-path='C:/User''s home'");
  });

  test("checkout pins the exact snapshot and pulls through the tunnel on demand", () => {
    const push = remoteCheckoutScript(config, SHA, false);
    expect(push).toContain(`git checkout --quiet --detach --force ${SHA}`);
    expect(push).not.toContain("git fetch");
    const pull = remoteCheckoutScript(config, SHA, true);
    expect(pull).toContain("git fetch --quiet git://127.0.0.1:19418/aphrody refs/workspace/snapshot");
  });

  test("run script holds the factory lock and never runs outside the snapshot", () => {
    const script = remoteRunScript(config, SHA, "job-1", ["clippy", "-p", "aphrody", "--", "-D", "warnings"], 4);
    expect(script).toContain("tmux new-window -d -t vps-cargo -n job-1");
    expect(script).toContain("APHRODY_CARGO_JOBS=4");
    expect(script).toContain("APHRODY_BUILD_HOST=vps");
    expect(script).toContain("flock --close /home/ubuntu/build/locks/heavy.lock");
    expect(script).toContain("checkout moved away from");
    expect(script).toContain("umask 022; cd ");
    expect(script).toContain(`exit "$(cat ${config.remoteLogDir}/job-1.exit)"`);
  });

  test("an external repository gets its own checkout, ref, target directory and the shared locks", async () => {
    const { config: vu, root } = repositoryConfig(config, "vu");
    expect(root.replaceAll("\\", "/").endsWith("/vu")).toBe(true);
    expect(vu.remoteWorkspace).toBe("/home/ubuntu/build/wsl/vu");
    expect(vu.snapshotRef).toBe("refs/vu/snapshot");
    expect(vu.remoteHeavyLock).toBe(config.remoteHeavyLock);
    const script = remoteRunScript(vu, SHA, "job-2", ["build", "--release", "-p", "vu"], 2);
    expect(script).toContain("cd /home/ubuntu/build/wsl/vu");
    expect(script).toContain("CARGO_TARGET_DIR=/home/ubuntu/build/storage/cache/cargo/vu-wsl");
    expect(script).toContain("flock --close /home/ubuntu/build/locks/heavy.lock");
    expect(script).toContain(
      "/home/ubuntu/build/wsl/aphrody/scripts/aphrody/build/rust/cargo-serial.sh build --release -p vu",
    );
    // No factory seed: the first push into the new checkout is a full pack.
    expect(remoteSeedScript(vu)).toContain("git init --quiet /home/ubuntu/build/wsl/vu");
    // The default repository keeps its relative wrapper.
    expect(remoteRunScript(config, SHA, "job-3", ["check"], 2)).toContain(
      " scripts/aphrody/build/rust/cargo-serial.sh check",
    );
    expect(() => repositoryConfig(config, "nope")).toThrow("unknown repository");
    await expect(loadConfig(undefined, "nope")).rejects.toThrow("unknown build host");
  });

  test("secret-like paths are refused", () => {
    const refused = secretLikePaths(
      ["src/lib.rs", ".env", "config/.env.local", "keys/id_ed25519", "a/secrets.json", "x.pem"],
      config.refuseSnapshotPaths,
    );
    expect(refused).toEqual([".env", "config/.env.local", "keys/id_ed25519", "a/secrets.json", "x.pem"]);
  });

  test("snapshot captures tracked and untracked changes without touching HEAD or the index", async () => {
    const repo = await mkdtemp(join(tmpdir(), "vps-cargo-"));
    try {
      await $`git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init`.cwd(repo);
      await Bun.write(join(repo, ".gitignore"), "ignored.txt\n");
      await Bun.write(join(repo, "new.txt"), "hello\n");
      await Bun.write(join(repo, "ignored.txt"), "nope\n");
      const head = (await $`git rev-parse HEAD`.cwd(repo).text()).trim();
      const sha = await snapshot(config, repo);
      expect(sha).not.toBe(head);
      expect((await $`git rev-parse HEAD`.cwd(repo).text()).trim()).toBe(head);
      expect((await $`git diff --cached --name-only`.cwd(repo).text()).trim()).toBe("");
      const files = (await $`git ls-tree --name-only ${sha}`.cwd(repo).text()).trim().split("\n");
      expect(files.sort()).toEqual([".gitignore", "new.txt"]);
      expect((await $`git rev-parse refs/workspace/snapshot`.cwd(repo).text()).trim()).toBe(sha);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("snapshot collisions", () => {
  const lockError = Object.assign(new Error("failed"), {
    exitCode: 128,
    stderr: "fatal: Unable to create '/r/.git/refs/workspace/snapshot.lock': File exists.",
  });

  test("only git lock and ref races count as collisions", () => {
    expect(isSnapshotCollision(lockError)).toBe(true);
    expect(isSnapshotCollision(new SnapshotCollision("push"))).toBe(true);
    expect(isSnapshotCollision({ exitCode: 128, stderr: "" })).toBe(true);
    expect(
      isSnapshotCollision({
        exitCode: 128,
        stderr: "fatal: x.index: index file smaller than expected",
      }),
    ).toBe(true);
    expect(
      isSnapshotCollision({
        exitCode: 128,
        stderr: "fatal: not a git repository",
      }),
    ).toBe(false);
    expect(isSnapshotCollision({ exitCode: 1, stderr: "index.lock" })).toBe(false);
    expect(
      isSnapshotCollision({
        exitCode: 1,
        stderr: " ! [remote rejected] sha -> refs/workspace/snapshot (incorrect old value provided)",
      }),
    ).toBe(true);
    expect(
      isSnapshotCollision({
        exitCode: 1,
        stderr: " ! [remote rejected] sha -> refs/workspace/snapshot (permission denied)",
      }),
    ).toBe(false);
    expect(isSnapshotCollision(new Error("boom"))).toBe(false);
    expect(isSnapshotCollision(null)).toBe(false);
  });

  test("backoff doubles the delay and returns once the race is won", async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withSnapshotBackoff(
      async () => {
        if (++calls < 4) throw lockError;
        return "sha";
      },
      {
        baseMs: 100,
        random: () => 0,
        sleep: async ms => void delays.push(ms),
      },
    );
    expect(result).toBe("sha");
    expect(calls).toBe(4);
    expect(delays).toEqual([100, 200, 400]);
  });

  test("a remote ref race retries the same pinned snapshot", async () => {
    let calls = 0;
    const result = await withSnapshotBackoff(
      async () => {
        if (++calls === 1)
          throw Object.assign(new Error("push failed"), {
            exitCode: 1,
            stderr: " ! [remote rejected] sha -> refs/workspace/snapshot (incorrect old value provided)",
          });
        return "pinned-sha";
      },
      { sleep: async () => {}, random: () => 0 },
    );
    expect(result).toBe("pinned-sha");
    expect(calls).toBe(2);
  });

  test("jitter is added and a persistent collision is rethrown after the last attempt", async () => {
    const delays: number[] = [];
    let calls = 0;
    const run = withSnapshotBackoff(
      async () => {
        calls++;
        throw lockError;
      },
      {
        attempts: 3,
        baseMs: 100,
        random: () => 0.5,
        sleep: async ms => void delays.push(ms),
      },
    );
    await expect(run).rejects.toBe(lockError);
    expect(calls).toBe(3);
    expect(delays).toEqual([150, 300]);
  });

  test("other failures are not retried", async () => {
    let calls = 0;
    const run = withSnapshotBackoff(
      async () => {
        calls++;
        throw new Error("refusing to snapshot secret-like paths: .env");
      },
      { sleep: async () => {} },
    );
    await expect(run).rejects.toThrow("secret-like");
    expect(calls).toBe(1);
  });

  test("concurrent snapshots of one worktree both succeed and leave no scratch index", async () => {
    const repo = await mkdtemp(join(tmpdir(), "vps-cargo-race-"));
    try {
      await $`git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init`.cwd(repo);
      await Bun.write(join(repo, "a.txt"), "a\n");
      const shas = await Promise.all(Array.from({ length: 6 }, () => snapshot(config, repo)));
      expect(new Set(shas).size).toBeGreaterThanOrEqual(1);
      for (const sha of shas) {
        expect((await $`git ls-tree --name-only ${sha}`.cwd(repo).text()).trim()).toContain("a.txt");
      }
      const leftovers = (await $`ls .git`.cwd(repo).text()).split("\n").filter(n => n.startsWith("vps-cargo."));
      expect(leftovers).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("snapshot pins and verification", () => {
  test("each snapshot gets its own ref next to the shared one, per repository", () => {
    expect(pinRef(config, SHA)).toBe("refs/workspace/pin/0123456789ab");
    const { config: vu } = repositoryConfig(config, "vu");
    expect(pinRef(vu, SHA)).toBe("refs/vu/pin/0123456789ab");
  });

  test("the verify script fails with exit 3 when an object is missing", () => {
    const script = remoteVerifyScript(config, SHA);
    expect(script).toContain(`git rev-list --objects --quiet ${SHA}`);
    expect(script).toContain("exit 3");
    expect(script).toContain(`cd ${config.remoteWorkspace}`);
  });

  test("the forget script only drops refs whose history is broken", () => {
    const script = remoteForgetScript(config);
    expect(script).toContain("refs/workspace/snapshot");
    expect(script).toContain("refs/workspace/pin");
    expect(script).toContain('git rev-list --objects --quiet "$ref" 2>/dev/null || git update-ref -d "$ref"');
  });

  test("the checkout script prunes old pins and keeps the recent ones", () => {
    const script = remoteCheckoutScript(config, SHA, false);
    expect(script).toContain("refs/workspace/pin");
    expect(script).toContain(String(PIN_RETENTION_DAYS * 86400));
    expect(script).toContain("committerdate:unix");
  });

  test("a damaged snapshot ref is repaired by a real push (objects collected on the remote)", async () => {
    const root = await mkdtemp(join(tmpdir(), "vps-cargo-pin-"));
    try {
      const remote = join(root, "remote");
      const work = join(root, "work");
      await $`git init -q ${remote} && git init -q ${work}`;
      await $`git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init`.cwd(work);
      await Bun.write(join(work, "a.txt"), "payload\n");
      const sha = await snapshot(config, work);
      const push = (refs: string[]) => $`git push -q --force --no-thin ${remote} ${refs}`.cwd(work).quiet();
      await push([`${sha}:refs/workspace/snapshot`]);
      // Collect the blob on the remote while the ref still advertises it: the damage seen in production.
      const blob = (await $`git rev-parse ${sha}:a.txt`.cwd(work).text()).trim();
      await rm(join(remote, ".git/objects", blob.slice(0, 2), blob.slice(2)), {
        force: true,
      });
      const integrity = () => $`git -C ${remote} rev-list --objects --quiet ${sha}`.nothrow().quiet();
      expect((await integrity()).exitCode).not.toBe(0);
      // A plain push resends nothing: the remote ref says it has the object.
      await push([`${sha}:refs/workspace/snapshot`, `${sha}:${pinRef(config, sha)}`]);
      expect((await $`git -C ${remote} rev-list --objects --quiet ${sha}`.nothrow().quiet()).exitCode).not.toBe(0);
      // Forget the broken refs, push again: the object is resent.
      const refs = (
        await $`git -C ${remote} for-each-ref ${"--format=%(refname)"} ${config.snapshotRef} ${pinRef(config, sha).slice(0, -12)}`.text()
      )
        .trim()
        .split("\n");
      for (const ref of refs.filter(Boolean)) {
        if ((await $`git -C ${remote} rev-list --objects --quiet ${ref}`.nothrow().quiet()).exitCode !== 0) {
          await $`git -C ${remote} update-ref -d ${ref}`.quiet();
        }
      }
      await push([`${sha}:refs/workspace/snapshot`, `${sha}:${pinRef(config, sha)}`]);
      expect((await $`git -C ${remote} rev-list --objects --quiet ${sha}`.nothrow().quiet()).exitCode).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("desktop-library routing", () => {
  // app --normal--> gtk-sys; cli --dev--> app; lib has no desktop dependency.
  const metadata = {
    packages: [
      { id: "app", name: "app" },
      { id: "cli", name: "cli" },
      { id: "lib", name: "lib" },
      { id: "gtk-sys", name: "gtk-sys" },
    ],
    workspace_members: ["app", "cli", "lib"],
    resolve: {
      nodes: [
        { id: "app", deps: [{ pkg: "gtk-sys", dep_kinds: [{ kind: null }] }] },
        {
          id: "cli",
          deps: [
            { pkg: "app", dep_kinds: [{ kind: "dev" }] },
            { pkg: "lib", dep_kinds: [{ kind: null }] },
          ],
        },
        { id: "lib", deps: [] },
        { id: "gtk-sys", deps: [] },
      ],
    },
  };
  const requirements = desktopRequirements(metadata, ["gtk-sys"]);

  test("normal and build dependencies decide plain builds, dev dependencies only test targets", () => {
    expect([...requirements.build]).toEqual(["app"]);
    expect([...requirements.all].sort()).toEqual(["app", "cli"]);
  });

  test("reads packages, exclusions, workspace and dev targets from a cargo command line", () => {
    expect(cargoSelection(["check", "-p", "a", "--package=b", "--exclude", "c"])).toEqual({
      subcommand: "check",
      packages: ["a", "b"],
      excluded: ["c"],
      workspace: false,
      devTargets: false,
    });
    expect(
      cargoSelection(["+nightly", "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]),
    ).toMatchObject({
      subcommand: "clippy",
      workspace: true,
      devTargets: true,
    });
    expect(cargoSelection(["test", "-p", "x"]).devTargets).toBe(true);
    expect(cargoSelection(["check", "--", "--all-targets"]).devTargets).toBe(false);
  });

  test("package specs accept versions and globs", () => {
    expect(matchesPackageSpec("aphrody-tauri", "aphrody-tauri")).toBe(true);
    expect(matchesPackageSpec("aphrody-tauri@3.0.0", "aphrody-tauri")).toBe(true);
    expect(matchesPackageSpec("aphrody-tauri-plugin-*", "aphrody-tauri-plugin-fs")).toBe(true);
    expect(matchesPackageSpec("aphrody-tauri-plugin-*", "aphrody-tauri")).toBe(false);
  });

  test("a package that needs the desktop libraries is reported, others are not", () => {
    expect(desktopOffenders(["check", "-p", "app"], requirements)).toEqual(["app"]);
    expect(desktopOffenders(["check", "-p", "lib"], requirements)).toEqual([]);
    // cli only needs them through its dev dependencies.
    expect(desktopOffenders(["check", "-p", "cli"], requirements)).toEqual([]);
    expect(desktopOffenders(["check", "-p", "cli", "--all-targets"], requirements)).toEqual(["cli"]);
    expect(desktopOffenders(["test", "-p", "cli"], requirements)).toEqual(["cli"]);
  });

  test("workspace-wide runs are offenders unless every desktop package is excluded", () => {
    expect(desktopOffenders(["check", "--workspace"], requirements)).toEqual(["app"]);
    expect(desktopOffenders(["check"], requirements)).toEqual(["app"]);
    expect(desktopOffenders(["check", "--workspace", "--exclude", "app"], requirements)).toEqual([]);
  });
});

test("dbfr is a bounded secondary factory; external repository builds stay on the VPS factory", async () => {
  const primary = await loadConfig();
  const dbfr = await loadConfig(undefined, "dbfr");
  expect(dbfr.host).toBe("dbfr");
  expect(dbfr.maxJobs).toBe(3);
  expect(dbfr.desktopLibraries).toBe(false);
  expect(dbfr.remoteEnv["SCCACHE_CACHE_SIZE"]).toBe("8G");
  expect(dbfr.remoteHeavyLock).toContain("/home/ubuntu/build/");
  expect(() => repositoryConfig(dbfr, "vu")).toThrow("primary host only");
  const { config } = repositoryConfig(primary, "vu");
  expect(config.host).toBe("vps");
  expect(config.remoteHeavyLock).toContain("/home/ubuntu/build/");
  expect(config.cargoSerial).toContain("/home/ubuntu/build/");
  expect(remoteRunScript(config, SHA, "vu-routing", ["check"], 2)).toContain("cd /home/ubuntu/build/wsl/vu");
});
