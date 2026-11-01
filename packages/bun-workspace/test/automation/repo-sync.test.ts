// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { yoloCliPath } from "../yolo-cli-path.ts";
import {
  acquireSourceSyncLock,
  loadSourceSyncConfig,
  syncRepository,
  watchSources,
  type SourceSyncConfig,
  type SyncOptions,
  type SyncReport,
  type SyncRepository,
} from "../../../../scripts/aphrody/tools/workspace/source-sync.ts";
import {
  FactoryBuildQueue,
  factoryBuildCommand,
  readRepoSyncStatus,
  runFactoryWorker,
  type FactoryJob,
} from "../../src/automation/repo-sync.ts";
import { hasMode } from "../../src/automation/portable-fs.ts";
import { buildFactoryPlan, readFactoryConfig } from "../../src/automation/build-factory.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function run(cwd: string, ...args: string[]) {
  const child = Bun.spawn(["git", ...args], {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Fixture Git failed: ${stderr}`);
  return stdout.trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-commit-sync-"));
  roots.push(root);
  const local = join(root, "source");
  const remote = join(root, "remote.git");
  await mkdir(local);
  await run(root, "init", "--bare", "--quiet", remote);
  await run(local, "init", "--quiet", "--initial-branch=main");
  await run(local, "config", "user.name", "fixture-owner");
  await run(local, "config", "user.email", "fixture@localhost");
  const commit = async (value: string) => {
    await writeFile(join(local, "source.txt"), value);
    await run(local, "add", "source.txt");
    await run(local, "commit", "--quiet", "-m", value);
    return run(local, "rev-parse", "HEAD");
  };
  const base = await commit("initial");
  await run(local, "remote", "add", "origin", remote);
  await run(local, "push", "--quiet", "origin", "main");
  await run(local, "checkout", "--quiet", "-b", "dev");
  const repository: SyncRepository = {
    id: "fixture",
    path: local,
    remote: "origin",
    sourceBranch: "dev",
    destinationBranch: "main",
    fastForward: false,
  };
  const config: SourceSyncConfig = {
    schemaVersion: 1,
    owners: ["aphrody-labs"],
    repositories: [repository],
    pollIntervalMs: 60000,
    debounceMs: 25,
    commandTimeoutMs: 10000,
  };
  const options: SyncOptions = {
    apply: true,
    remoteValidator: url => url === remote,
  };
  return { root, local, remote, base, commit, repository, config, options };
}

// Yolo is fused into the monorepo (cf2fa3f4b): only Aphrody and its Python sibling synchronize.
test("declaration synchronizes the canonical distribution and runtime branches", async () => {
  const config = await loadSourceSyncConfig();
  expect(config.repositories.map(repo => [repo.id, repo.remote, repo.sourceBranch, repo.destinationBranch])).toEqual([
    ["bun-os", "github", "os", "os"],
    ["bun-runtime", "origin", "main", "main"],
  ]);
  const bun = config.repositories.find(repository => repository.id === "bun-os")!;
  expect(bun.repositoryName).toBe("bun-distribution");
  expect(bun.buildEnabled).toBe(false);
});
test("plan does not fetch or push and dirty source commits synchronize without staging private files", async () => {
  const value = await fixture();
  const head = await value.commit("completed commit");
  await writeFile(join(value.local, "private.env"), "SECRET_FIXTURE_VALUE");
  await writeFile(join(value.local, "source.txt"), "concurrent owner work");
  const index = await run(value.local, "write-tree");
  const planned = await syncRepository(value.repository, value.config, {
    ...value.options,
    apply: false,
  });
  expect(planned).toMatchObject({
    status: "ahead",
    action: "planned",
    ahead: 1,
    dirty: true,
  });
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(value.base);
  const synchronized = await syncRepository(value.repository, value.config, value.options);
  expect(synchronized).toMatchObject({
    status: "current",
    action: "pushed",
    dirty: true,
  });
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(head);
  expect(await run(value.local, "write-tree")).toBe(index);
  expect(await readFile(join(value.local, "source.txt"), "utf8")).toBe("concurrent owner work");
  expect(await readFile(join(value.local, "private.env"), "utf8")).toBe("SECRET_FIXTURE_VALUE");
  expect(JSON.stringify(synchronized)).not.toContain("SECRET_FIXTURE_VALUE");
});
test("divergent destination history remains unchanged", async () => {
  const value = await fixture();
  const head = await value.commit("local commit");
  await run(value.local, "checkout", "--quiet", "main");
  const remoteHead = await value.commit("independent remote commit");
  await run(value.local, "push", "--quiet", "origin", "main");
  await run(value.local, "checkout", "--quiet", "dev");
  const row = await syncRepository(value.repository, value.config, value.options);
  expect(row.status).toBe("diverged");
  expect(await run(value.local, "rev-parse", "dev")).toBe(head);
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(remoteHead);
});
test("normal push rejection is reported without forcing destination history", async () => {
  const value = await fixture();
  await value.commit("new source");
  const hook = join(value.remote, "hooks", "update");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  const row = await syncRepository(value.repository, value.config, value.options);
  expect(row).toMatchObject({
    status: "push-error",
    action: "normal-push-refused",
  });
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(value.base);
});
test("unowned or credential-bearing remote and in-progress Git operations are preserved", async () => {
  const value = await fixture();
  await value.commit("new source");
  expect((await syncRepository(value.repository, value.config, { apply: true })).status).toBe("unowned-remote");
  await run(
    value.local,
    "remote",
    "set-url",
    "--push",
    "origin",
    "https://hidden:SECRET@github.com/aphrody-labs/fixture.git",
  );
  const row = await syncRepository(value.repository, value.config, value.options);
  expect(row.status).toBe("unowned-remote");
  expect(JSON.stringify(row)).not.toContain("SECRET");
  await run(value.local, "remote", "set-url", "--push", "origin", value.remote);
  await writeFile(join(value.local, ".git", "MERGE_HEAD"), value.base);
  expect((await syncRepository(value.repository, value.config, value.options)).status).toBe("operation-in-progress");
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(value.base);
});
test("behind checkout fast-forwards only when clean and on the same declared branch", async () => {
  const value = await fixture();
  const newer = await value.commit("remote advance");
  await run(value.local, "push", "--quiet", "origin", "dev:main");
  await run(value.local, "checkout", "--quiet", "main");
  const repository = {
    ...value.repository,
    sourceBranch: "main",
    fastForward: true,
  };
  await writeFile(join(value.local, "private.env"), "untouched");
  expect((await syncRepository(repository, value.config, value.options)).action).toBe("local-worktree-preserved");
  expect(await run(value.local, "rev-parse", "main")).toBe(value.base);
  await rm(join(value.local, "private.env"));
  expect((await syncRepository(repository, value.config, value.options)).action).toBe("fast-forwarded");
  expect(await run(value.local, "rev-parse", "main")).toBe(newer);
});
test("Git source-ref event triggers synchronization before the fallback and abort closes watch", async () => {
  const value = await fixture();
  const controller = new AbortController();
  const reports: SyncReport[] = [];
  let ready: (() => void) | undefined;
  const initial = new Promise<void>(resolveReady => {
    ready = resolveReady;
  });
  const deadline = setTimeout(() => controller.abort(), 3000);
  const watched = watchSources(value.config, {
    ...value.options,
    signal: controller.signal,
    onReport: report => {
      reports.push(report);
      ready?.();
      ready = undefined;
      if (report.rows[0]?.action === "pushed") controller.abort();
    },
  });
  try {
    await initial;
    const head = await value.commit("event driven commit");
    await watched;
    expect(reports.length).toBe(2);
    expect(reports[1]?.rows[0]?.action).toBe("pushed");
    expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(head);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await watched;
  }
}, 5000);
test("protected PID lock prevents overlapping owners and releases only its own lock", async () => {
  const value = await fixture();
  const state = join(value.root, "state");
  const release = acquireSourceSyncLock(state);
  expect(() => acquireSourceSyncLock(state)).toThrow("already has an owner");
  expect(hasMode((await stat(join(state, "owner.lock"))).mode, 0o600)).toBe(true);
  release();
  expect(existsSync(join(state, "owner.lock"))).toBe(false);
});
test("factory queue coalesces later commits while a real background worker is live", async () => {
  const value = await fixture();
  value.repository.buildCommand = ["fixture"];
  const directory = join(value.root, "builds");
  const jobs: FactoryJob[] = [];
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const queue = new FactoryBuildQueue(value.config, directory, path => {
    jobs.push(JSON.parse(readFileSync(path, "utf8")) as FactoryJob);
    const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(200)"], {
      windowsHide: true,
      stdout: "ignore",
      stderr: "ignore",
    });
    children.push(child);
    return child;
  });
  const report = (revision: string): SyncReport => ({
    schemaVersion: 3,
    at: new Date().toISOString(),
    mode: "apply",
    rows: [
      {
        repo: value.repository.id,
        remote: value.repository.remote,
        sourceBranch: "dev",
        destinationBranch: "main",
        status: "current",
        action: "pushed",
        sourceHead: revision,
        destinationHead: revision,
      },
    ],
  });
  try {
    queue.enqueue(report("a".repeat(40)));
    queue.enqueue(report("b".repeat(40)));
    queue.enqueue(report("c".repeat(40)));
    expect(jobs.map(job => job.revision)).toEqual(["a".repeat(40)]);
    await children[0]!.exited;
    await Bun.sleep(20);
    expect(jobs.map(job => job.revision)).toEqual(["a".repeat(40), "c".repeat(40)]);
    await children[1]!.exited;
    await Bun.sleep(20);
    queue.enqueue(report("c".repeat(40)));
    expect(jobs.length).toBe(2);
  } finally {
    queue.close();
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    await Promise.all(children.map(child => child.exited));
  }
});
test("factory queue adopts an existing live handle and watcher stop preserves it", async () => {
  const value = await fixture();
  value.repository.buildCommand = ["fixture"];
  const directory = join(value.root, "builds");
  await mkdir(directory);
  const job: FactoryJob = {
    repo: "fixture",
    revision: "a".repeat(40),
    token: crypto.randomUUID(),
    status: "running",
    phase: "build",
    requestedAt: new Date().toISOString(),
  };
  const path = join(directory, "fixture.json");
  const entry = join(value.root, "worker-proof.ts");
  await writeFile(
    entry,
    `import { answerFactoryJobProbe } from ${JSON.stringify(join(import.meta.dir, "../../src/automation/repo-sync.ts"))};\nconst stop = answerFactoryJobProbe(${JSON.stringify(path)}, ${JSON.stringify(job)});\nawait Bun.sleep(3000);\nstop();\n`,
  );
  const child = Bun.spawn([process.execPath, entry], {
    windowsHide: true,
    stdout: "ignore",
    stderr: "pipe",
  });
  job.pid = child.pid;
  await writeFile(path, JSON.stringify(job));
  let launched = false;
  const queue = new FactoryBuildQueue(value.config, directory, () => {
    launched = true;
    throw new Error("must not replace live worker");
  });
  const report: SyncReport = {
    schemaVersion: 3,
    at: "fixture",
    mode: "apply",
    rows: [
      {
        repo: "fixture",
        remote: "origin",
        sourceBranch: "dev",
        destinationBranch: "main",
        status: "current",
        action: "pushed",
        sourceHead: "b".repeat(40),
        destinationHead: "b".repeat(40),
      },
    ],
  };
  const respond = async () => {
    const probe = JSON.parse(await readFile(`${path}.probe.json`, "utf8"));
    // oxlint-disable-next-line no-await-in-loop -- Wait for this specific synthetic worker proof.
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        existsSync(`${path}.owner.json`) &&
        JSON.parse(readFileSync(`${path}.owner.json`, "utf8")).nonce === probe.nonce
      )
        return;
      // oxlint-disable-next-line no-await-in-loop -- Bound a live worker readiness check.
      await Bun.sleep(10);
    }
    throw new Error(`Fixture worker proof missing: ${await new Response(child.stderr).text()}`);
  };
  let restarted: FactoryBuildQueue | undefined;
  try {
    queue.enqueue(report);
    expect(JSON.parse(await readFile(`${path}.observation.json`, "utf8"))).toMatchObject({
      status: "running",
      reconciliationRequired: true,
    });
    await respond();
    queue.enqueue(report);
    expect(JSON.parse(await readFile(`${path}.observation.json`, "utf8"))).toMatchObject({
      token: job.token,
      revision: job.revision,
      pid: child.pid,
      status: "running",
      reconciliationRequired: false,
    });
    expect(launched).toBe(false);
    queue.close();
    expect(() => process.kill(child.pid, 0)).not.toThrow();
    expect(JSON.parse(await readFile(join(directory, "pending.json"), "utf8"))).toEqual({
      fixture: "b".repeat(40),
    });
    restarted = new FactoryBuildQueue(value.config, directory, () => {
      launched = true;
      throw new Error("must adopt rather than replace live worker");
    });
    restarted.enqueue(report);
    expect(JSON.parse(await readFile(`${path}.observation.json`, "utf8"))).toMatchObject({
      status: "running",
      reconciliationRequired: true,
    });
    await respond();
    restarted.enqueue(report);
    expect(launched).toBe(false);
    expect(JSON.parse(await readFile(`${path}.observation.json`, "utf8"))).toMatchObject({
      status: "running",
      reconciliationRequired: false,
    });
  } finally {
    queue.close();
    restarted?.close();
    child.kill("SIGKILL");
    await child.exited;
  }
});
function factoryReport(repo: string, revision: string): SyncReport {
  return {
    schemaVersion: 3,
    at: new Date().toISOString(),
    mode: "apply",
    rows: [
      {
        repo,
        remote: "origin",
        sourceBranch: "dev",
        destinationBranch: "main",
        status: "current",
        action: "current",
        sourceHead: revision,
        destinationHead: revision,
      },
    ],
  };
}
test.each(["missing-pid", "legacy-reused-pid", "stale-proof"])(
  "ambiguous factory %s holds pending across restart without duplicate dispatch",
  async kind => {
    const value = await fixture();
    value.repository.buildCommand = ["fixture"];
    const directory = join(value.root, "builds");
    await mkdir(directory);
    const path = join(directory, "fixture.json");
    const job: FactoryJob = {
      repo: "fixture",
      revision: "a".repeat(40),
      token: kind === "legacy-reused-pid" ? undefined : crypto.randomUUID(),
      pid: kind === "missing-pid" ? undefined : process.pid,
      status: kind === "missing-pid" ? "starting" : "running",
      phase: "prepare",
      requestedAt: new Date().toISOString(),
    };
    await writeFile(path, JSON.stringify(job));
    if (kind === "stale-proof")
      await writeFile(`${path}.owner.json`, JSON.stringify({ ...job, nonce: crypto.randomUUID() }));
    let launches = 0;
    const launch = () => {
      launches++;
      throw new Error("unverified process must not dispatch another SSH job");
    };
    const queue = new FactoryBuildQueue(value.config, directory, launch);
    try {
      queue.enqueue(factoryReport("fixture", "b".repeat(40)));
      const held = JSON.parse(await readFile(`${path}.observation.json`, "utf8"));
      expect(held).toMatchObject({
        revision: job.revision,
        reconciliationRequired: true,
        status: kind === "missing-pid" ? "lost" : "running",
      });
      expect(held.token).toBe(job.token);
    } finally {
      queue.close();
    }
    const restarted = new FactoryBuildQueue(value.config, directory, launch);
    try {
      restarted.enqueue(factoryReport("fixture", "c".repeat(40)));
      restarted.enqueue(factoryReport("fixture", job.revision));
      expect(launches).toBe(0);
      expect(JSON.parse(await readFile(join(directory, "pending.json"), "utf8"))).toEqual({
        fixture: "c".repeat(40),
      });
      expect(JSON.parse(await readFile(`${path}.observation.json`, "utf8"))).toMatchObject({
        revision: job.revision,
        reconciliationRequired: true,
      });
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(JSON.parse(JSON.stringify(job)));
    } finally {
      restarted.close();
    }
  },
);
test("an old process exit cannot complete a replacement job with the same requested SHA", async () => {
  const value = await fixture();
  value.repository.buildCommand = ["fixture"];
  const directory = join(value.root, "builds");
  let finish!: (code: number) => void;
  const queue = new FactoryBuildQueue(value.config, directory, () => ({
    pid: process.pid,
    exited: new Promise<number>(resolve => {
      finish = resolve;
    }),
    unref: () => {},
  }));
  try {
    queue.enqueue(factoryReport("fixture", "a".repeat(40)));
    const path = join(directory, "fixture.json");
    const old: FactoryJob = JSON.parse(await readFile(path, "utf8"));
    const replacement = {
      ...old,
      token: crypto.randomUUID(),
      pid: process.pid,
    };
    await writeFile(path, JSON.stringify(replacement));
    finish(0);
    await Bun.sleep(10);
    expect(JSON.parse(await readFile(`${path}.observation.json`, "utf8"))).toMatchObject({
      token: replacement.token,
      revision: old.revision,
      status: "starting",
      reconciliationRequired: true,
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(replacement);
  } finally {
    queue.close();
  }
});
test("worker terminal receipt releases a legacy reconciliation hold without watcher overwriting it", async () => {
  const value = await fixture();
  value.repository.buildCommand = ["fixture"];
  const directory = join(value.root, "builds");
  await mkdir(directory);
  const path = join(directory, "fixture.json");
  const job: FactoryJob = {
    repo: "fixture",
    revision: "a".repeat(40),
    pid: process.pid,
    status: "running",
    phase: "prepare",
    requestedAt: new Date().toISOString(),
  };
  await writeFile(path, JSON.stringify(job));
  const launches: FactoryJob[] = [];
  const queue = new FactoryBuildQueue(value.config, directory, launchedPath => {
    launches.push(JSON.parse(readFileSync(launchedPath, "utf8")));
    throw new Error("synthetic terminal worker; never reaches SSH");
  });
  try {
    queue.enqueue(factoryReport("fixture", "b".repeat(40)));
    expect(launches.length).toBe(0);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(job);
    await writeFile(
      path,
      JSON.stringify({
        ...job,
        status: "succeeded",
        phase: "complete",
        exitCode: 0,
      }),
    );
    queue.enqueue(factoryReport("fixture", "b".repeat(40)));
    expect(launches.map(launched => launched.revision)).toEqual(["b".repeat(40)]);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      revision: "b".repeat(40),
      status: "failed",
      exitCode: 2,
    });
  } finally {
    queue.close();
  }
});
test("native factory worker prepares the exact pin before its declared build and propagates rejection", async () => {
  const value = await fixture();
  value.repository.id = "yolo";
  value.repository.buildCommand = ["bash", "owned-build.sh"];
  await mkdir(join(value.root, "tools", "aphrody", "config"), { recursive: true });
  await writeFile(join(value.root, "tools", "aphrody", "config", "commit-sync.json"), JSON.stringify(value.config));
  const state = join(value.root, "state");
  await mkdir(join(state, "builds"), { recursive: true });
  const path = join(state, "builds", "yolo.json");
  const job: FactoryJob = {
    repo: "yolo",
    revision: "a".repeat(40),
    token: crypto.randomUUID(),
    status: "starting",
    phase: "prepare",
    requestedAt: "fixture",
  };
  await writeFile(path, JSON.stringify(job));
  const calls: string[][] = [];
  expect(
    await runFactoryWorker(
      path,
      value.root,
      async args => {
        calls.push(args);
        return 7;
      },
      state,
      job.token,
    ),
  ).toBe(7);
  expect(calls).toEqual([["prepare", "--repo", "yolo", "--revision", job.revision, "--apply"]]);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    status: "failed",
    exitCode: 7,
  });
  await writeFile(path, JSON.stringify(job));
  calls.length = 0;
  expect(
    await runFactoryWorker(
      path,
      value.root,
      async args => {
        calls.push(args);
        return 0;
      },
      state,
      job.token,
    ),
  ).toBe(0);
  expect(calls).toEqual([
    ["prepare", "--repo", "yolo", "--revision", job.revision, "--apply"],
    ["run", "--repo", "yolo", "--revision", job.revision, "--", "bash", "owned-build.sh"],
  ]);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    status: "succeeded",
    exitCode: 0,
    token: job.token,
    revision: job.revision,
  });
  const invoke = async () => {
    throw new Error(`wrong token must never reach the factory owner for ${job.repo}`);
  };
  await expect(runFactoryWorker(path, value.root, invoke, state, crypto.randomUUID())).rejects.toThrow(
    "Invalid protected factory job",
  );
  const replacement = { ...job, token: crypto.randomUUID() };
  await writeFile(path, JSON.stringify(job));
  const supersededCalls: string[][] = [];
  expect(
    await runFactoryWorker(
      path,
      value.root,
      async args => {
        supersededCalls.push(args);
        await writeFile(path, JSON.stringify(replacement));
        return 0;
      },
      state,
      job.token,
    ),
  ).toBe(2);
  expect(supersededCalls.length).toBe(1);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(replacement);
});
test("Bun native CI worker binds the protected revision and stable receipt id to the existing factory", async () => {
  const value = await fixture();
  Object.assign(value.repository, {
    id: "bun-runtime",
    repositoryName: "bun",
    buildEnabled: true,
    buildCommand: ["bun", "scripts/aphrody/native-ci.ts", "worker"],
  });
  await mkdir(join(value.root, "tools", "aphrody", "config"), { recursive: true });
  const configPath = join(value.root, "tools", "aphrody", "config", "commit-sync.json");
  await writeFile(configPath, JSON.stringify(value.config));
  const state = join(value.root, "state");
  await mkdir(join(state, "builds"), { recursive: true });
  const path = join(state, "builds", "bun-runtime.json");
  const job: FactoryJob = {
    repo: "bun-runtime",
    revision: "a".repeat(40),
    token: crypto.randomUUID(),
    status: "starting",
    phase: "prepare",
    requestedAt: "2026-10-11T12:00:00.000Z",
  };
  await writeFile(path, JSON.stringify(job));
  const calls: string[][] = [];
  expect(
    await runFactoryWorker(
      path,
      value.root,
      async args => {
        calls.push(args);
        return 0;
      },
      state,
      job.token,
    ),
  ).toBe(0);
  const command = factoryBuildCommand(value.repository, job);
  expect(calls).toEqual([
    ["prepare", "--repo", "bun-runtime", "--revision", job.revision, "--apply"],
    ["run", "--repo", "bun-runtime", "--revision", job.revision, "--", ...command],
  ]);
  expect(command.slice(0, 5)).toEqual(["bun", "scripts/aphrody/native-ci.ts", "worker", "--revision", job.revision]);
  expect(command[5]).toBe("--id");
  expect(command[6]).toMatch(/^native-aaaaaaaaaaaa-[a-f0-9]{12}$/);
  const factory = await readFactoryConfig(join(import.meta.dir, "../../../.."));
  const plan = buildFactoryPlan(factory!, "bun-runtime", job.revision, command);
  expect(plan.revision).toBe(job.revision);
  expect(plan.command).toEqual(calls[1]!.slice(calls[1]!.indexOf("--") + 1));
  expect(plan.transport[5]).toContain(command[6]!);
  expect(plan.transport[5]).toContain(job.revision);
  expect(factoryBuildCommand(value.repository, JSON.parse(await readFile(path, "utf8")))).toEqual(command);
  expect(
    factoryBuildCommand(value.repository, {
      ...job,
      requestedAt: "2026-10-11T12:01:00.000Z",
    })[6],
  ).not.toBe(command[6]);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    revision: job.revision,
    status: "succeeded",
    exitCode: 0,
  });
  value.repository.buildEnabled = false;
  await writeFile(configPath, JSON.stringify(value.config));
  await writeFile(path, JSON.stringify(job));
  calls.length = 0;
  await expect(
    runFactoryWorker(
      path,
      value.root,
      async args => {
        calls.push(args);
        return 0;
      },
      state,
      job.token,
    ),
  ).rejects.toThrow("enabled owner build");
  expect(calls).toEqual([]);
});

test("disabled Bun builds do not queue and native commands cannot replace their protected pin", async () => {
  const value = await fixture();
  Object.assign(value.repository, {
    id: "bun-runtime",
    buildEnabled: false,
    buildCommand: ["bun", "scripts/aphrody/native-ci.ts", "worker"],
  });
  const directory = join(value.root, "builds");
  let launched = false;
  const queue = new FactoryBuildQueue(value.config, directory, () => {
    launched = true;
    throw Error("disabled");
  });
  try {
    queue.enqueue(factoryReport("bun-runtime", "a".repeat(40)));
    expect(launched).toBe(false);
    expect(JSON.parse(await readFile(join(directory, "pending.json"), "utf8"))).toEqual({});
  } finally {
    queue.close();
  }
  value.repository.buildEnabled = true;
  const job: FactoryJob = {
    repo: "bun-runtime",
    revision: "a".repeat(40),
    status: "starting",
    phase: "prepare",
    requestedAt: new Date().toISOString(),
  };
  expect(() => factoryBuildCommand(value.repository, { ...job, revision: "main" })).toThrow();
  value.repository.buildCommand = ["bun", "scripts/aphrody/native-ci.ts", "worker", "--revision", "b".repeat(40)];
  expect(() => factoryBuildCommand(value.repository, job)).toThrow();
  await mkdir(join(value.root, "tools", "aphrody", "config"), { recursive: true });
  await writeFile(
    join(value.root, "tools", "aphrody", "config", "commit-sync.json"),
    JSON.stringify({
      ...value.config,
      repositories: [{ ...value.repository, buildEnabled: "false" }],
    }),
  );
  await expect(loadSourceSyncConfig(value.root)).rejects.toThrow("activation policy");
});

test("repo-sync status reads live receipts and pending metadata without exposing tokens or changing state", async () => {
  const value = await fixture();
  await mkdir(join(value.root, "tools", "aphrody", "config"), { recursive: true });
  const config = {
    ...value.config,
    repositories: ["yolo", "aphrody"].map(id => Object.assign({}, value.repository, { id, buildCommand: ["fixture"] })),
  };
  await writeFile(join(value.root, "tools", "aphrody", "config", "commit-sync.json"), JSON.stringify(config));
  const state = join(value.root, "protected-state");
  const absent = await readRepoSyncStatus(value.root, state);
  expect(absent.state).toBe("absent");
  expect(existsSync(state)).toBe(false);
  await mkdir(join(state, "builds"), { recursive: true });
  expect((await readRepoSyncStatus(value.root, state)).state).toBe("idle");
  const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(3000)"], {
    windowsHide: true,
    stdout: "ignore",
    stderr: "ignore",
  });
  const token = crypto.randomUUID();
  const sensitive = "FIXTURE_PRIVATE_CREDENTIAL";
  const files: Record<string, string> = {
    "owner.lock": JSON.stringify({
      pid: process.pid,
      token,
      at: new Date().toISOString(),
    }),
    "builds/yolo.json": JSON.stringify({
      repo: "yolo",
      revision: "a".repeat(40),
      pid: child.pid,
      token,
      status: "running",
      phase: "prepare",
      requestedAt: new Date().toISOString(),
      reconciliationRequired: true,
      credentials: sensitive,
    }),
    "builds/pending.json": JSON.stringify({
      yolo: "b".repeat(40),
      aphrody: "c".repeat(40),
      foreign: sensitive,
    }),
    "latest.json": JSON.stringify({
      ...factoryReport("yolo", "b".repeat(40)),
      credentials: sensitive,
    }),
    "builds/yolo.owner.json": JSON.stringify({ token, nonce: sensitive }),
    "builds/yolo.log": sensitive,
  };
  await Promise.all(Object.entries(files).map(([path, data]) => writeFile(join(state, path), data, { mode: 0o600 })));
  try {
    const status = await readRepoSyncStatus(value.root, state);
    expect(status.state).toBe("watching");
    expect(status.owner).toMatchObject({ pid: process.pid, live: true });
    expect(status.repositories.map(repository => repository.repo)).toEqual(["yolo", "aphrody"]);
    expect(status.jobs[0]).toMatchObject({
      pid: child.pid,
      processAlive: true,
      status: "running",
      phase: "prepare",
      reconciliationRequired: true,
    });
    expect(status.pending).toEqual({
      yolo: "b".repeat(40),
      aphrody: "c".repeat(40),
    });
    expect(status.latest?.rows[0]).toMatchObject({
      sourceHead: "b".repeat(40),
      status: "current",
    });
    const printed = JSON.stringify(status);
    expect(printed).not.toContain(token);
    expect(printed).not.toContain(sensitive);
    expect(printed).not.toContain("nonce");
    const unchanged = await Promise.all(
      Object.entries(files).map(async ([path, data]) => (await readFile(join(state, path), "utf8")) === data),
    );
    expect(unchanged.every(Boolean)).toBe(true);
    const yolo = yoloCliPath;
    const cli = Bun.spawn([process.execPath, yolo, "ops", "repo-sync", "status", "--json"], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        APHRODY_ROOT: value.root,
        APHRODY_HOME: join(value.root, "absent-home"),
        PATH: join(value.root, "no-global-commands"),
      },
    });
    const output = await new Response(cli.stdout).text();
    expect(await cli.exited).toBe(0);
    expect(JSON.parse(output).state).toBe("absent");
    expect(existsSync(join(value.root, "absent-home"))).toBe(false);
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
});
test.skipIf(process.platform === "win32")(
  "SIGTERM ends CLI watch and releases protected lock",
  async () => {
    const value = await fixture();
    await mkdir(join(value.root, "tools", "aphrody", "config"), { recursive: true });
    await writeFile(join(value.root, "tools", "aphrody", "config", "commit-sync.json"), JSON.stringify(value.config));
    const entry = join(value.root, "watch.ts");
    await writeFile(
      entry,
      `import { runSourceSync } from ${JSON.stringify(join(import.meta.dir, "../../../../scripts/aphrody/tools/workspace/source-sync.ts"))};\nprocess.exit(await runSourceSync(["watch"], ${JSON.stringify(value.root)}));\n`,
    );
    const home = join(value.root, "protected");
    const child = Bun.spawn([process.execPath, entry], {
      windowsHide: true,
      stdout: "ignore",
      stderr: "pipe",
      env: { ...process.env, APHRODY_HOME: home },
    });
    const lock = join(home, "state", "commit-sync", "owner.lock");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      // oxlint-disable-next-line no-await-in-loop -- Poll a specific live child readiness marker.
      for (let attempt = 0; attempt < 100 && !existsSync(lock); attempt++) await Bun.sleep(10);
      expect(existsSync(lock)).toBe(true);
      child.kill("SIGTERM");
      expect(await child.exited).toBe(0);
      expect(existsSync(lock)).toBe(false);
    } finally {
      clearTimeout(deadline);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  },
  5000,
);
