// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFactoryPlan,
  buildFactoryPreparePlan,
  factoryRemoteUrl,
  heavyBuildStatus,
  type BuildFactoryConfig,
} from "../../src/automation/build-factory.ts";
import { runInfra } from "../../src/automation/runtime.ts";

const config: BuildFactoryConfig = {
  schemaVersion: 1,
  enabled: true,
  target: "vps",
  cacheRoot: "/home/ubuntu/build/cache",
  artifactRoot: "/home/ubuntu/build/artifacts",
  lockPath: "/home/ubuntu/build/locks/heavy.lock",
  repositories: { aphrody: "/home/ubuntu/src/aphrody" },
  rust: { maxJobs: 6 },
};
const revision = "a".repeat(40);

test("declared source names and branches drive canonical OS and runtime verification", () => {
  const declared = {
    ...config,
    repositories: { "bun-os": "/home/ubuntu/src/bun-os", "bun-runtime": "/home/ubuntu/src/bun" },
  };
  for (const [id, repositoryName, branch, remote] of [
    ["bun-os", "bun-distribution", "os", "github"],
    ["bun-runtime", "bun", "main", "origin"],
  ] as const) {
    const source = {
      path: `/source/${id}`,
      repositoryName,
      branch,
      remote,
      url: `git@github-dev:aphrody-labs/${repositoryName}.git`,
      owners: ["aphrody-labs"],
    };
    const plan = buildFactoryPreparePlan(declared, id, revision, source);
    expect(plan.workspace).toBe(declared.repositories[id]);
    expect(plan.source.branch).toBe(branch);
    expect(plan.source.repositoryName).toBe(repositoryName);
    expect(plan.transport[5]).toContain(`refs/remotes/${remote}/${branch}`);
    expect(plan.transport[5]).toContain("git symbolic-ref --quiet --short HEAD");
    for (const mutation of ["git checkout", "git clone", "git reset", "git clean", "submodule update", "--detach"])
      expect(plan.transport[5]).not.toContain(mutation);
    expect(plan.initializesSubmodules).toBe(false);
    expect(() => buildFactoryPreparePlan(declared, id, revision, { ...source, branch: "../bad" })).toThrow("branch");
    expect(() =>
      buildFactoryPreparePlan(declared, id, revision, { ...source, url: "https://github.com/unowned/bun.git" }),
    ).toThrow("declared private");
    expect(() => buildFactoryPreparePlan(declared, id, "main", source)).toThrow("pinned");
  }
  for (const url of [
    "git@wrong-alias:aphrody-labs/example.git",
    "https://fixture:secret@github.com/aphrody-labs/example.git",
    "https://github.com/unowned/bun.git",
  ])
    expect(() => factoryRemoteUrl(url, "bun", ["aphrody-labs"])).toThrow("declared private");
});
async function preparationFixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-factory-prepare-"));
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const checkout = join(root, "workspaces/yolo");
  const remoteUrl = "https://github.com/aphrody-labs/yolo.git";
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `url.file://${remote}.insteadOf`,
    GIT_CONFIG_VALUE_0: remoteUrl,
    GIT_CONFIG_KEY_1: "protocol.file.allow",
    GIT_CONFIG_VALUE_1: "always",
  };
  const git = async (cwd: string, ...args: string[]) => {
    const child = Bun.spawn(["git", ...args], {
      windowsHide: true,
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
    });
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`Fixture Git failed: ${error}`);
    return output.trim();
  };
  await git(root, "init", "--bare", "--quiet", "-b", "main", remote);
  await git(root, "init", "--quiet", "-b", "main", source);
  await git(source, "config", "user.name", "fixture");
  await git(source, "config", "user.email", "fixture@localhost");
  await writeFile(join(source, "source.txt"), "initial source\n");
  await writeFile(join(source, ".gitignore"), "ignored/\n");
  await git(source, "add", ".");
  await git(source, "commit", "--quiet", "-m", "initial");
  const initial = await git(source, "rev-parse", "HEAD");
  await git(source, "remote", "add", "origin", remoteUrl);
  await git(source, "push", "--quiet", "origin", "main");
  const declared = {
    ...config,
    cacheRoot: join(root, "cache"),
    artifactRoot: join(root, "artifacts"),
    lockPath: join(root, "locks/heavy.lock"),
    repositories: {
      aphrody: join(root, "workspaces/aphrody"),
      yolo: checkout,
    },
  };
  const pin = {
    path: source,
    remote: "origin",
    url: remoteUrl,
    repositoryName: "yolo",
    branch: "main",
    owners: ["aphrody-labs"],
  };
  await git(root, "clone", "--quiet", remoteUrl, checkout);
  const prepare = async (pinnedRevision: string) => {
    const plan = buildFactoryPreparePlan(declared, "yolo", pinnedRevision, pin);
    // Execute the planned remote body against tiny local Git fixtures; no host or source repository is touched.
    const child = Bun.spawn(["bash", "-c", plan.transport[5]!], {
      windowsHide: true,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    const [output, error, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { output, error, exitCode };
  };
  const commit = async (message: string) => {
    await git(source, "add", "-A");
    await git(source, "commit", "--quiet", "-m", message);
    await git(source, "push", "--quiet", "origin", "main");
    return git(source, "rev-parse", "HEAD");
  };
  return {
    root,
    source,
    remote,
    checkout,
    env,
    git,
    initial,
    declared,
    pin,
    prepare,
    commit,
  };
}

test.skipIf(process.platform === "win32")(
  "verification reuses the canonical branch and refuses to move it to another requested pin",
  async () => {
    const f = await preparationFixture();
    try {
      await mkdir(f.declared.cacheRoot, { mode: 0o700 });
      const cacheBefore = await stat(f.declared.cacheRoot);
      expect((await f.prepare(f.initial)).exitCode).toBe(0);
      expect(await f.git(f.checkout, "rev-parse", "HEAD")).toBe(f.initial);
      expect(await f.git(f.checkout, "config", "--get", "remote.origin.url")).toBe(f.pin.url);
      const gitConfig = await readFile(join(f.checkout, ".git/config"), "utf8");
      expect(gitConfig).not.toContain("credential");
      expect(gitConfig).not.toContain("insteadOf");
      const inode = (await stat(join(f.checkout, ".git"))).ino;
      await writeFile(join(f.source, "source.txt"), "next source\n");
      const next = await f.commit("next");
      expect((await f.prepare(next)).exitCode).toBe(2);
      expect(await f.git(f.checkout, "rev-parse", "HEAD")).toBe(f.initial);
      expect((await stat(join(f.checkout, ".git"))).ino).toBe(inode);
      const cacheAfter = await stat(f.declared.cacheRoot);
      expect(cacheAfter.mode).toBe(cacheBefore.mode);
      expect(cacheAfter.uid).toBe(cacheBefore.uid);
      expect(cacheAfter.gid).toBe(cacheBefore.gid);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "preparation refuses dirty, ignored-overwrite, foreign-origin and off-main revisions",
  async () => {
    const f = await preparationFixture();
    try {
      expect((await f.prepare(f.initial)).exitCode).toBe(0);
      await writeFile(join(f.checkout, "source.txt"), "concurrent work\n");
      const dirty = await f.prepare(f.initial);
      expect(dirty.exitCode).toBe(2);
      expect(dirty.error).toContain("dirty; preserved");
      expect(await readFile(join(f.checkout, "source.txt"), "utf8")).toBe("concurrent work\n");
      await f.git(f.checkout, "restore", "source.txt");
      await mkdir(join(f.source, "ignored"));
      await writeFile(join(f.source, "ignored/collision.txt"), "new tracked source\n");
      await f.git(f.source, "add", "-f", "ignored/collision.txt");
      const next = await f.commit("tracked ignored collision");
      await mkdir(join(f.checkout, "ignored"));
      await writeFile(join(f.checkout, "ignored/collision.txt"), "protected ignored output\n");
      expect((await f.prepare(next)).exitCode).not.toBe(0);
      expect(await readFile(join(f.checkout, "ignored/collision.txt"), "utf8")).toBe("protected ignored output\n");
      expect(await f.git(f.checkout, "rev-parse", "HEAD")).toBe(f.initial);
      await f.git(f.checkout, "remote", "set-url", "origin", "git@github-dev:unowned/yolo.git");
      const foreign = await f.prepare(f.initial);
      expect(foreign.exitCode).toBe(2);
      expect(foreign.error).toContain("origin differs");
      await f.git(f.checkout, "remote", "set-url", "origin", f.pin.url);
      await f.git(f.source, "checkout", "--quiet", "-b", "unpublished");
      await writeFile(join(f.source, "off-main.txt"), "off main\n");
      await f.git(f.source, "add", "off-main.txt");
      await f.git(f.source, "commit", "--quiet", "-m", "off main");
      const offMain = await f.git(f.source, "rev-parse", "HEAD");
      await f.git(f.source, "push", "--quiet", "origin", "unpublished");
      const denied = await f.prepare(offMain);
      expect(denied.exitCode).toBe(2);
      expect(denied.error).toContain("HEAD differs from requested pin");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "preparation preserves an existing non-Git directory and symlink outside declared paths",
  async () => {
    const f = await preparationFixture();
    try {
      await rm(f.checkout, { recursive: true });
      await mkdir(f.checkout, { recursive: true });
      await writeFile(join(f.checkout, "unowned.txt"), "preserve me");
      const rejected = await f.prepare(f.initial);
      expect(rejected.exitCode).toBe(2);
      expect(rejected.error).toContain("Canonical factory checkout is absent");
      expect(await readFile(join(f.checkout, "unowned.txt"), "utf8")).toBe("preserve me");
      await rm(f.checkout, { recursive: true });
      const outside = join(f.root, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "sentinel.txt"), "outside source scope");
      await symlink(outside, f.checkout, "dir");
      const symlinked = await f.prepare(f.initial);
      expect(symlinked.exitCode).toBe(2);
      expect(symlinked.error).toContain("resolves elsewhere; preserved");
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside source scope");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test("execution-only hosts reject plans and never implicitly enable local builds", () => {
  const runtimeOnly = { ...config, executionOnlyTargets: ["vps"] };
  expect(() => buildFactoryPlan(runtimeOnly, "aphrody", revision, ["cargo", "test"])).toThrow("execution-only");
  expect(heavyBuildStatus(runtimeOnly, {}).route).toBe("factory");
  expect(heavyBuildStatus(runtimeOnly, { APHRODY_BUILD_HOST: "vps" }).route).toBe("factory");
  expect(heavyBuildStatus(runtimeOnly, { APHRODY_LOCAL_CARGO: "1" }).route).toBe("local");
  expect(
    heavyBuildStatus(runtimeOnly, {
      APHRODY_BUILD_HOST: "vps",
      APHRODY_LOCAL_CARGO: "1",
    }).route,
  ).toBe("factory");
  expect(heavyBuildStatus(runtimeOnly, {}).reason).toContain("new factory host");
  expect(heavyBuildStatus(runtimeOnly, { CLAUDE_CODE_REMOTE: "true" }).route).toBe("local");
  expect(heavyBuildStatus(runtimeOnly, { APHRODY_CLOUD: "1" }).route).toBe("local");
});

test.skipIf(process.platform === "win32")(
  "preparation checks dirty submodules and prevents ignored overwrites at their pinned revisions",
  async () => {
    const f = await preparationFixture();
    try {
      const childSource = join(f.root, "child-source");
      const childRemote = join(f.root, "child.git");
      await f.git(f.root, "init", "--quiet", "-b", "main", childSource);
      await f.git(f.root, "init", "--bare", "--quiet", "-b", "main", childRemote);
      await f.git(childSource, "config", "user.name", "fixture");
      await f.git(childSource, "config", "user.email", "fixture@localhost");
      await writeFile(join(childSource, "source.txt"), "child source\n");
      await writeFile(join(childSource, ".gitignore"), "ignored/\n");
      await f.git(childSource, "add", ".");
      await f.git(childSource, "commit", "--quiet", "-m", "child initial");
      await f.git(childSource, "remote", "add", "origin", `file://${childRemote}`);
      await f.git(childSource, "push", "--quiet", "origin", "main");
      await f.git(f.source, "submodule", "add", "--quiet", `file://${childRemote}`, "child");
      const parent = await f.commit("add child");
      await f.git(f.checkout, "fetch", "origin");
      await f.git(f.checkout, "merge", "--ff-only", parent);
      await f.git(f.checkout, "submodule", "update", "--init", "--recursive");
      expect((await f.prepare(parent)).exitCode).toBe(0);
      const childCheckout = join(f.checkout, "child");
      await f.git(f.checkout, "config", "submodule.child.ignore", "all");
      await writeFile(join(childCheckout, "source.txt"), "concurrent child work\n");
      const dirty = await f.prepare(parent);
      expect(dirty.exitCode).toBe(2);
      expect(dirty.error).toContain("dirty; preserved");
      expect(await readFile(join(childCheckout, "source.txt"), "utf8")).toBe("concurrent child work\n");
      await f.git(childCheckout, "restore", "source.txt");
      await mkdir(join(childSource, "ignored"));
      await writeFile(join(childSource, "ignored/collision.txt"), "new child source\n");
      await f.git(childSource, "add", "-f", "ignored/collision.txt");
      await f.git(childSource, "commit", "--quiet", "-m", "child collision");
      await f.git(childSource, "push", "--quiet", "origin", "main");
      const childNext = await f.git(childSource, "rev-parse", "HEAD");
      await f.git(join(f.source, "child"), "fetch", "origin");
      await f.git(join(f.source, "child"), "checkout", "--quiet", "--detach", childNext);
      const next = await f.commit("update child");
      await mkdir(join(childCheckout, "ignored"));
      await writeFile(join(childCheckout, "ignored/collision.txt"), "protected child output\n");
      const collision = await f.prepare(next);
      expect(collision.exitCode).not.toBe(0);
      expect(await readFile(join(childCheckout, "ignored/collision.txt"), "utf8")).toBe("protected child output\n");
      expect(await f.git(childCheckout, "rev-parse", "HEAD")).not.toBe(childNext);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "preparation CLI plans first and dispatches apply through the installed Infra owner",
  async () => {
    const f = await preparationFixture();
    try {
      const root = join(f.root, "owner-config");
      await mkdir(join(root, "tools", "aphrody", "config"), { recursive: true });
      await writeFile(join(root, "tools/aphrody/config/build-factory.json"), JSON.stringify(f.declared));
      await writeFile(
        join(root, "tools/aphrody/config/commit-sync.json"),
        JSON.stringify({
          schemaVersion: 1,
          owners: ["aphrody-labs"],
          pollIntervalMs: 60000,
          debounceMs: 250,
          commandTimeoutMs: 30000,
          repositories: [
            {
              id: "yolo",
              path: f.source,
              remote: "origin",
              sourceBranch: "main",
              destinationBranch: "main",
            },
            {
              id: "aphrody",
              path: root,
              remote: "workspace",
              sourceBranch: "main",
              destinationBranch: "main",
            },
          ],
        }),
      );
      const marker = join(f.root, "infra-call.json");
      const infra = join(f.root, "infra-fixture");
      await writeFile(
        infra,
        `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, JSON.stringify({args: process.argv.slice(2), timeout: process.env.APHRODY_SSH_COMMAND_TIMEOUT_SECS}));\nconsole.log("native owner dispatched");\n`,
      );
      await chmod(infra, 0o755);
      const run = async (apply: boolean) => {
        const child = Bun.spawn(
          [
            process.execPath,
            join(import.meta.dir, "../../src/automation/build-factory.ts"),
            "prepare",
            "--repo",
            "yolo",
            "--revision",
            f.initial,
            ...(apply ? ["--apply"] : []),
          ],
          {
            windowsHide: true,
            env: { ...f.env, BUN_OS_ROOT: root, APHRODY_INFRA_BIN: infra },
            stdout: "pipe",
            stderr: "pipe",
            timeout: 5_000,
          },
        );
        const [output, error, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        if (code !== 0) throw new Error(`Preparation CLI failed: ${output} ${error}`);
        return JSON.parse(output);
      };
      expect((await run(false)).executed).toBe(false);
      expect(await Bun.file(marker).exists()).toBe(false);
      const applied = await run(true);
      expect(applied.executed).toBe(true);
      expect(applied.success).toBe(true);
      expect(applied.stdout.trim()).toBe("native owner dispatched");
      const invocation = JSON.parse(await readFile(marker, "utf8"));
      expect(invocation.args.slice(2, 6)).toEqual(["ssh", "exec", "--host", "vps"]);
      expect(invocation.timeout).toBe("21600");
      expect(invocation.args[7]).toContain("flock --close");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "Infra propagates the factory command timeout per invocation without mutating global environment",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "aphrody-infra-env-"));
    const original = process.env.APHRODY_SSH_COMMAND_TIMEOUT_SECS;
    try {
      const binary = join(root, "infra-fixture");
      await writeFile(binary, `#!${process.execPath}\nconsole.log(process.env.APHRODY_SSH_COMMAND_TIMEOUT_SECS);\n`);
      await chmod(binary, 0o755);
      const result = await runInfra({
        args: ["ssh", "exec", "--host", "vps", "--cmd", "fixture"],
        env: {
          APHRODY_INFRA_BIN: binary,
          APHRODY_SSH_COMMAND_TIMEOUT_SECS: "21600",
        },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("21600");
      expect(process.env.APHRODY_SSH_COMMAND_TIMEOUT_SECS).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("factory plans use the existing Infra owner and shared serial lock", () => {
  const plan = buildFactoryPlan(config, "aphrody", revision, ["bun", "run", "build"]);
  expect(plan.transport.slice(0, 4)).toEqual(["ssh", "exec", "--host", "vps"]);
  expect(plan.transport[5]).toContain("flock --close -- /home/ubuntu/build/locks/heavy.lock");
  expect(plan.commandTimeoutSeconds).toBe(21600);
  expect(plan.transport[5]).toContain("git rev-parse HEAD");
  expect(plan.transport[5]).toContain("git status --porcelain");
  expect(plan.transport[5]).toContain("BUN_INSTALL_CACHE_DIR=");
  expect(plan.transport[5]).toContain("CARGO_NET_GIT_FETCH_WITH_CLI=true");
  expect(plan.transport[5]).toContain("APHRODY_CARGO_LOCK_DIR=/home/ubuntu/build/locks");
  expect(plan.command).toEqual(["bun", "run", "build"]);
});

test("Yolo shares factory caches while preserving its canonical packaging target directory", async () => {
  const declared: BuildFactoryConfig = await Bun.file(
    join(import.meta.dir, "../../../../tools/aphrody/config/build-factory.json"),
  ).json();
  expect(declared.repositories.yolo).toBe("/home/ubuntu/src/yolo");
  const plan = buildFactoryPlan(declared, "yolo", revision, ["just", "runtime-package"]);
  expect(plan.repository).toBe("yolo");
  expect(plan.workspace).toBe(declared.repositories.yolo!);
  expect(plan.transport.slice(0, 4)).toEqual(["ssh", "exec", "--host", "vps"]);
  expect(plan.transport[5]).not.toContain("CARGO_TARGET_DIR=");
  expect(plan.transport[5]).toContain(`SCCACHE_DIR=${declared.cacheRoot}/sccache`);
  expect(plan.transport[5]).toContain("git rev-parse HEAD");
  expect(plan.transport[5]).toContain("git status --porcelain");
  expect(plan.transport[5]).toContain("flock --close -- /home/ubuntu/build/locks/heavy.lock");
  expect(() => buildFactoryPlan({ ...declared, executionOnlyTargets: ["vps"] }, "yolo", revision, ["just"])).toThrow(
    "execution-only",
  );
});

test("factory requires pinned clean source policy and bounded compiler jobs", () => {
  expect(() => buildFactoryPlan(config, "aphrody", "main", ["bun"])).toThrow("pinned Git");
  expect(() => buildFactoryPlan(config, "unknown", revision, ["bun"])).toThrow("repository");
  expect(() => buildFactoryPlan({ ...config, enabled: false }, "aphrody", revision, ["bun"])).toThrow("enabled");
  expect(() => buildFactoryPlan({ ...config, rust: { maxJobs: 1025 } }, "aphrody", revision, ["bun"])).toThrow(
    "between",
  );
  expect(() => buildFactoryPlan(config, "aphrody", revision, [])).toThrow("owner command");
  expect(() => buildFactoryPlan({ ...config, commandTimeoutSeconds: 86401 }, "aphrody", revision, ["bun"])).toThrow(
    "commandTimeoutSeconds",
  );
});

test("factory quotes owner arguments without expanding shell expressions", () => {
  const plan = buildFactoryPlan(config, "aphrody", revision, ["bun", "name'$(echo hidden)"]);
  expect(plan.command[1]).toBe("name'$(echo hidden)");
  expect(plan.transport[5]).not.toContain("exec env bun name");
  expect(() => buildFactoryPlan(config, "aphrody", revision, ["bun", "\0"])).toThrow("NUL");
});

test.skipIf(process.platform === "win32")(
  "Yolo factory preserves literal shell-sensitive arguments and refuses changed source",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "aphrody-factory-"));
    try {
      const git = async (...args: string[]) => {
        const child = Bun.spawn(["git", ...args], {
          windowsHide: true,
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
        });
        const output = await new Response(child.stdout).text();
        expect(await child.exited).toBe(0);
        return output.trim();
      };
      await git("init", "--quiet");
      await writeFile(join(root, "source.txt"), "pinned source");
      await git("add", "source.txt");
      await git("-c", "user.name=fixture", "-c", "user.email=fixture@localhost", "commit", "--quiet", "-m", "fixture");
      await mkdir(join(root, "locks"));
      await writeFile(join(root, ".git/info/exclude"), "locks/\n");
      const fixtureConfig = {
        ...config,
        repositories: { yolo: root },
        lockPath: join(root, "locks/heavy.lock"),
        cacheRoot: join(root, "locks/cache"),
        artifactRoot: join(root, "locks/artifacts"),
        rust: { maxJobs: 1 },
        resources: {
          reserveMemoryGiB: 1,
          reserveDiskGiB: 1,
          memoryPerJobGiB: 1,
        },
      };
      await mkdir(fixtureConfig.cacheRoot);
      await mkdir(fixtureConfig.artifactRoot);
      const literal = "name'$(echo should-not-expand)`echo literal`";
      const plan = buildFactoryPlan(fixtureConfig, "yolo", await git("rev-parse", "HEAD"), [
        "bash",
        "-c",
        'printf "%s" "$1"',
        "--",
        literal,
      ]);
      const run = async () => {
        const child = Bun.spawn(["bash", "-c", plan.transport[5]!], {
          windowsHide: true,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [output, error, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { output, error, exitCode };
      };
      expect(await run()).toEqual({ output: literal, error: "", exitCode: 0 });
      await writeFile(join(root, "source.txt"), "changed source");
      const refused = await run();
      expect(refused.exitCode).toBe(2);
      expect(refused.error).toContain("source checkout is dirty");
      expect(refused.output).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("heavy build status owns the cargo-serial route decision", () => {
  const route = (env: Record<string, string>, honour = true, value: BuildFactoryConfig | null = config) =>
    heavyBuildStatus(value, env, honour).route;
  expect(route({})).toBe("factory");
  expect(route({ APHRODY_BUILD_HOST: "vps" })).toBe("local");
  expect(route({ APHRODY_LOCAL_CARGO: "1" })).toBe("local");
  expect(route({ APHRODY_LOCAL_CARGO: "1" }, false)).toBe("factory");
  expect(route({}, true, { ...config, enabled: false })).toBe("local");
  expect(route({}, true, null)).toBe("local");
  expect(heavyBuildStatus(config, {})).toEqual({
    configured: true,
    enabled: true,
    target: "vps",
    host: null,
    localCargo: false,
    route: "factory",
    reason: "heavy work runs on vps",
  });
});

// cargo-serial.sh is a POSIX wrapper, and its child bun process needs the workspace links of a Linux install.
test.skipIf(process.platform === "win32")("cargo-serial asks the build-factory owner for the route", async () => {
  const script = await Bun.file(join(import.meta.dir, "../../../../scripts/aphrody/build/rust/cargo-serial.sh")).text();
  expect(script).toContain('build-factory.ts" status --route');
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../src/automation/build-factory.ts"), "status", "--route"],
    {
      windowsHide: true,
      env: { ...process.env, APHRODY_BUILD_HOST: "vps" },
      stdout: "pipe",
    },
  );
  expect((await new Response(child.stdout).text()).trim()).toBe("local");
  expect(await child.exited).toBe(0);
});

test("source preparations use disjoint locks and builds also protect their pinned checkout", () => {
  const source = {
    path: "/source/aphrody",
    remote: "workspace",
    url: "git@github-dev:aphrody-labs/aphrody.git",
    repositoryName: "aphrody",
    branch: "main",
    owners: ["aphrody-labs"],
  };
  const first = buildFactoryPreparePlan(config, "aphrody", revision, source, {
    initializeSubmodules: false,
  });
  expect(first.lockPath).toBe("/home/ubuntu/build/locks/aphrody.source.lock");
  expect(first.transport[5]).toContain("aphrody.source.lock");
  expect(first.transport[5]).not.toContain("--detach");
  expect(first.transport[5]).not.toContain("submodule update --init");
  expect(first.transport[5]).toContain("submodule foreach --quiet --recursive");
  expect(first.initializesSubmodules).toBe(false);
  const otherConfig = {
    ...config,
    repositories: { ...config.repositories, yolo: "/home/ubuntu/src/yolo" },
  };
  const other = buildFactoryPreparePlan(otherConfig, "yolo", revision, {
    ...source,
    path: "/source/yolo",
    remote: "origin",
    url: "git@github-dev:aphrody-labs/yolo.git",
    repositoryName: "yolo",
    branch: "main",
  });
  expect(other.lockPath).not.toBe(first.lockPath);
  expect(other.initializesSubmodules).toBe(false);
  const build = buildFactoryPlan(config, "aphrody", revision, ["scripts/aphrody/build/rust/cargo-serial.sh", "check"]);
  expect(build.transport[5]).toContain(
    "flock --close -- /home/ubuntu/build/locks/heavy.lock flock --close -- /home/ubuntu/build/locks/aphrody.source.lock",
  );
});

test.skipIf(process.platform === "win32")(
  "source preparation progresses while an unrelated heavy build holds the global lock",
  async () => {
    const f = await preparationFixture();
    await mkdir(join(f.root, "locks"));
    const held = Bun.spawn(
      [
        "flock",
        "--close",
        f.declared.lockPath,
        process.execPath,
        "-e",
        "console.log('locked');setInterval(()=>{},1000)",
      ],
      { windowsHide: true, stdout: "pipe", stderr: "pipe" },
    );
    const reader = held.stdout.getReader();
    try {
      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toContain("locked");
      const prepared = await f.prepare(f.initial);
      expect(prepared.exitCode).toBe(0);
      expect(await f.git(f.checkout, "rev-parse", "HEAD")).toBe(f.initial);
    } finally {
      await reader.cancel();
      held.kill();
      await held.exited;
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test("factory admits twelve declared jobs only against fresh host reserves", async () => {
  const { factoryResourcePolicy, admitFactoryResources } = await import("../../src/automation/build-factory");
  const twelve = {
    ...config,
    rust: { maxJobs: 12 },
    resources: { reserveMemoryGiB: 8, reserveDiskGiB: 32, memoryPerJobGiB: 1 },
  };
  const policy = factoryResourcePolicy(twelve);
  const available = {
    cpus: 12,
    availableMemoryGiB: 27.86,
    cacheDiskGiB: 488,
    artifactDiskGiB: 488,
  };
  expect(admitFactoryResources(policy, available)).toEqual({
    policy,
    observed: available,
  });
  for (const change of [
    { cpus: 6 },
    { availableMemoryGiB: 19.9 },
    { cacheDiskGiB: 31.9 },
    { artifactDiskGiB: 31.9 },
    { cpus: NaN },
    { availableMemoryGiB: Infinity },
    { cacheDiskGiB: -1 },
  ])
    expect(() => admitFactoryResources(policy, { ...available, ...change })).toThrow();
  const plan = buildFactoryPlan(twelve, "aphrody", revision, ["bun", "build"]);
  expect(plan.transport[5]).toContain("CARGO_BUILD_JOBS=12");
  expect(plan.transport[5]).toContain("availableParallelism()");
  expect(plan.transport[5]).toContain("MemAvailable:");
  expect(plan.transport[5]).toContain("statfs(path)");
  expect(plan.transport[5]).toContain("heavy.lock");
  expect(plan.serialized).toBe(true);
  expect(factoryResourcePolicy(config)).toEqual({
    jobs: 6,
    reserveMemoryGiB: 4,
    reserveDiskGiB: 20,
    memoryPerJobGiB: 1,
  });
  expect(() => factoryResourcePolicy({ ...twelve, resources: { reserveMemoryGiB: NaN } })).toThrow("reserve");
});

test.skipIf(process.platform !== "linux")(
  "fresh resource refusal runs inside owner locks before any build command",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-admission-"));
    try {
      const source = join(root, "source");
      await mkdir(source);
      const git = async (...args: string[]) => {
        const child = Bun.spawn(["git", ...args], {
          cwd: source,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [text, error, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        if (code !== 0) throw Error(error);
        return text.trim();
      };
      await git("init", "--quiet");
      await git("config", "user.name", "fixture");
      await git("config", "user.email", "fixture@localhost");
      await writeFile(join(source, "source.txt"), "fixture");
      await git("add", "source.txt");
      await git("commit", "--quiet", "-m", "fixture");
      const declared = {
        ...config,
        cacheRoot: join(root, "cache"),
        artifactRoot: join(root, "artifacts"),
        lockPath: join(root, "locks/heavy.lock"),
        repositories: { aphrody: source },
        rust: { maxJobs: 1 },
        resources: {
          reserveMemoryGiB: 1024,
          reserveDiskGiB: 1,
          memoryPerJobGiB: 1,
        },
      };
      for (const path of [declared.cacheRoot, declared.artifactRoot, join(root, "locks")])
        // Each parent is independent; no build starts until the complete fixture exists.
        // eslint-disable-next-line no-await-in-loop
        await mkdir(path);
      const marker = join(root, "owner-ran");
      const plan = buildFactoryPlan(declared, "aphrody", await git("rev-parse", "HEAD"), [
        process.execPath,
        "-e",
        `await Bun.write(${JSON.stringify(marker)},'unexpected')`,
      ]);
      const child = Bun.spawn(["bash", "-c", plan.transport[5]!], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(stdout).toBe("");
      expect(stderr).toContain("host capacity cannot preserve");
      expect(status).not.toBe(0);
      expect(await Bun.file(marker).exists()).toBe(false);
      // The same generated command must admit a small real job, not merely reject everything.
      const admitted = buildFactoryPlan(
        {
          ...declared,
          resources: {
            reserveMemoryGiB: 1,
            reserveDiskGiB: 1,
            memoryPerJobGiB: 1,
          },
        },
        "aphrody",
        await git("rev-parse", "HEAD"),
        [
          process.execPath,
          "-e",
          `await Bun.write(${JSON.stringify(marker)},JSON.stringify({jobs:process.env.CARGO_BUILD_JOBS,ownerJobs:process.env.APHRODY_CARGO_JOBS}));`,
        ],
      );
      const accepted = Bun.spawn(["bash", "-c", admitted.transport[5]!], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [acceptedOut, acceptedErr, acceptedStatus] = await Promise.all([
        new Response(accepted.stdout).text(),
        new Response(accepted.stderr).text(),
        accepted.exited,
      ]);
      expect({
        stdout: acceptedOut,
        stderr: acceptedErr,
        status: acceptedStatus,
      }).toEqual({
        stdout: "",
        stderr: "",
        status: 0,
      });
      expect(await Bun.file(marker).json()).toEqual({
        jobs: "1",
        ownerJobs: "1",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
