// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe, verifyVendor, qualifyRuntime, qualifyCompiledRuntimes, runtimeEvidence } from "./shenron-auto-deploy";
import { activeDeployment, deploymentIsCurrent, deploymentSelection } from "./shenron-deployment-identity";

test("a runtime-only change builds a distinct deployment without changing the Shenron Git commit", () => {
  const commit = "a".repeat(40);
  const config = {
    deploymentIdentity: "source-runtime-v1",
    runtimeSha256: "b".repeat(64),
    runtimeExpected: {
      version: "1.4.4",
      revision: "c".repeat(40),
      sourceUrl: "https://github.com/oven-sh/bun/releases/download/canary/bun-linux-x64.zip",
    },
  };
  const expected = deploymentSelection(commit, config);
  const active = activeDeployment({
    release: "/fixture/" + expected.releaseName,
    commit,
    deployment: expected.deployment,
  });
  expect(deploymentIsCurrent(active, deploymentSelection(commit, config))).toBe(true);
  for (const change of [
    { runtimeSha256: "d".repeat(64) },
    {
      runtimeExpected: { ...config.runtimeExpected, revision: "d".repeat(40) },
    },
    { runtimeExpected: { ...config.runtimeExpected, version: "1.4.6" } },
    {
      runtimeExpected: {
        ...config.runtimeExpected,
        sourceUrl: config.runtimeExpected.sourceUrl.replace("x64.zip", "arm64.zip"),
      },
    },
  ]) {
    const changed = deploymentSelection(commit, { ...config, ...change });
    expect(changed.commit).toBe(commit);
    expect(changed.id).not.toBe(expected.id);
    expect(changed.releaseName).not.toBe(expected.releaseName);
    expect(deploymentIsCurrent(active, changed)).toBe(false);
  }
  const legacy = activeDeployment({
    release: "/fixture/docker-" + commit,
    commit,
  });
  expect(deploymentIsCurrent(legacy, deploymentSelection(commit, {}))).toBe(true);
  expect(deploymentIsCurrent(legacy, expected)).toBe(false);
  expect(() =>
    activeDeployment({
      ...active,
      deployment: { ...expected.deployment!, id: "0".repeat(64) },
    }),
  ).toThrow();
  expect(() => activeDeployment({ ...active, release: legacy.release })).toThrow();
  expect(() =>
    activeDeployment({
      ...active,
      deployment: {
        ...expected.deployment!,
        runtime: { ...expected.deployment!.runtime, extra: "unsealed" },
      } as typeof expected.deployment,
    }),
  ).toThrow("identity differs");
  expect(() => deploymentSelection(commit, { ...config, runtimeSha256: "invalid" })).toThrow("exact qualified");
  expect(() =>
    deploymentSelection(commit, {
      ...config,
      runtimeSha256: config.runtimeSha256 + "\n",
    }),
  ).toThrow("exact qualified");
});

const nativeEvidence = {
  version: "1.4.4+fixture",
  revision: "a".repeat(40),
  sourceUrl: "https://github.com/oven-sh/bun/releases/download/fixture/bun.zip",
  features: { serve: true, fetch: true, sqlite: true, image: true },
};
test("runtime hash is checked before execution and evidence binds provenance and all native fixtures", async () => {
  const root = mkdtempSync(join(tmpdir(), "shenron-runtime-pin-"));
  temporary.push(root);
  const binary = join(root, "bun");
  await Bun.write(binary, "pinned runtime fixture");
  const sha = new Bun.CryptoHasher("sha256").update("pinned runtime fixture").digest("hex");
  let calls = 0;
  const run = async (args: string[], env: Record<string, string | undefined>) => {
    calls++;
    expect(args[0]).toBe(binary);
    expect(env.BUN_BE_BUN).toBe("1");
    return JSON.stringify(nativeEvidence);
  };
  expect(await qualifyRuntime(binary, sha, { revision: nativeEvidence.revision }, run)).toMatchObject({
    sha256: sha,
    size: 22,
    ...nativeEvidence,
  });
  await expect(qualifyRuntime(binary, "0".repeat(64), {}, run)).rejects.toThrow("digest differs");
  expect(calls).toBe(1);
  expect(() =>
    runtimeEvidence(
      JSON.stringify({
        ...nativeEvidence,
        features: { ...nativeEvidence.features, fetch: false },
      }),
    ),
  ).toThrow("differs");
  expect(() =>
    runtimeEvidence(JSON.stringify(nativeEvidence), {
      revision: "b".repeat(40),
    }),
  ).toThrow("differs");
});
test("both compiled product runtimes must pass the same isolated fixtures before promotion", async () => {
  const paths: string[] = [];
  const run = async (args: string[]) => {
    expect(args).toContain("none");
    expect(args).toContain("BUN_BE_BUN=1");
    paths.push(args[args.indexOf("--entrypoint") + 1]!);
    return JSON.stringify(nativeEvidence);
  };
  expect(
    Object.keys(await qualifyCompiledRuntimes("sha256:" + "a".repeat(64), { revision: nativeEvidence.revision }, run)),
  ).toEqual(["shenron-server", "shenron-bot"]);
  expect(paths).toEqual(["/usr/local/bin/shenron-server", "/usr/local/bin/shenron-bot"]);
  let calls = 0;
  await expect(
    qualifyCompiledRuntimes("image", {}, async () => {
      calls++;
      if (calls === 2) throw Error("bot fixture failed");
      return JSON.stringify(nativeEvidence);
    }),
  ).rejects.toThrow("bot fixture failed");
});

const temporary: string[] = [];
test("tracked Next fork archives are verified without a removed bootstrap script", async () => {
  const root = mkdtempSync(join(tmpdir(), "shenron-vendor-"));
  temporary.push(root);
  const archive = join(root, "vendor/next-fork/next.tgz");
  await Bun.write(archive, "qualified fixture");
  const manifest = join(root, "vendor/next-fork/manifest.json");
  await Bun.write(
    manifest,
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        {
          archive: "next.tgz",
          sha256: new Bun.CryptoHasher("sha256").update("qualified fixture").digest("hex"),
        },
      ],
    }),
  );
  await verifyVendor(root);
  await Bun.write(archive, "altered");
  await expect(verifyVendor(root)).rejects.toThrow("digest differs");
  await Bun.write(
    manifest,
    JSON.stringify({
      schemaVersion: 1,
      packages: [{ archive: "../escape.tgz", sha256: "a".repeat(64) }],
    }),
  );
  await expect(verifyVendor(root)).rejects.toThrow("Invalid Next fork archive identity");
});
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Integration test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Integration test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "shenron-sync-integration-"));
  temporary.push(root);
  const origin = join(root, "origin.git");
  const publisher = join(root, "publisher");
  const source = join(root, "source");
  const state = join(root, "state");
  git(root, "init", "--bare", "--initial-branch=main", origin);
  git(root, "clone", origin, publisher);
  await Bun.write(join(publisher, "content.txt"), "initial\n");
  git(publisher, "add", "content.txt");
  git(publisher, "commit", "-m", "Initial fixture");
  git(publisher, "push", "origin", "main");
  git(root, "clone", origin, source);
  const initial = git(source, "rev-parse", "HEAD");
  const config = join(root, "config.json");
  await Bun.write(
    config,
    JSON.stringify({
      source,
      state,
      bun: process.execPath,
      runtimeExpected: { version: Bun.version },
    }),
  );
  return {
    source,
    publisher,
    initial,
    async advance() {
      await Bun.write(join(publisher, "content.txt"), "upstream change\n");
      git(publisher, "commit", "-am", "Advance origin main");
      git(publisher, "push", "origin", "main");
      return git(publisher, "rev-parse", "HEAD");
    },
    async sync() {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "shenron-auto-deploy.ts"), "sync"], {
        cwd: root,
        env: { ...process.env, SHENRON_AUTO_DEPLOY_CONFIG: config },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const receipt = await Bun.file(join(state, "sync.json")).json();
      return { code, stdout, stderr, receipt };
    },
  };
}

test("sync fetches local origin/main and fast-forwards the real checkout", async () => {
  const f = await fixture();
  const latest = await f.advance();
  const result = await f.sync();
  expect(result.code, result.stderr).toBe(0);
  expect(git(f.source, "rev-parse", "HEAD")).toBe(latest);
  expect(git(f.source, "rev-parse", "origin/main")).toBe(latest);
  expect(await Bun.file(join(f.source, "content.txt")).text()).toBe("upstream change\n");
  expect(result.receipt).toMatchObject({
    status: "synchronized",
    commit: latest,
  });
});

test("sync preserves tracked and untracked local edits and exits 75", async () => {
  const f = await fixture();
  const latest = await f.advance();
  await Bun.write(join(f.source, "content.txt"), "local work\n");
  await Bun.write(join(f.source, "untracked.txt"), "unique work\n");
  const before = git(f.source, "status", "--porcelain");
  const result = await f.sync();
  expect(result.code, result.stderr).toBe(75);
  expect(result.receipt).toMatchObject({
    status: "skipped",
    reason: "local-changes",
  });
  expect(git(f.source, "rev-parse", "HEAD")).toBe(f.initial);
  expect(git(f.source, "rev-parse", "origin/main")).toBe(latest);
  expect(git(f.source, "status", "--porcelain")).toBe(before);
  expect(await Bun.file(join(f.source, "content.txt")).text()).toBe("local work\n");
  expect(await Bun.file(join(f.source, "untracked.txt")).text()).toBe("unique work\n");
});

test("sync refuses a different branch and preserves its checkout", async () => {
  const f = await fixture();
  await f.advance();
  git(f.source, "switch", "-c", "feature/local");
  const result = await f.sync();
  expect(result.code, result.stderr).toBe(75);
  expect(result.receipt).toMatchObject({
    status: "skipped",
    reason: "branch-not-main",
  });
  expect(git(f.source, "branch", "--show-current")).toBe("feature/local");
  expect(git(f.source, "rev-parse", "HEAD")).toBe(f.initial);
  expect(await Bun.file(join(f.source, "content.txt")).text()).toBe("initial\n");
});

test("sync refuses divergent history without discarding the local commit", async () => {
  const f = await fixture();
  const upstream = await f.advance();
  await Bun.write(join(f.source, "local.txt"), "committed local work\n");
  git(f.source, "add", "local.txt");
  git(f.source, "commit", "-m", "Unique local commit");
  const local = git(f.source, "rev-parse", "HEAD");
  const result = await f.sync();
  expect(result.code, result.stderr).toBe(75);
  expect(result.receipt).toMatchObject({
    status: "skipped",
    reason: "divergent-history",
  });
  expect(git(f.source, "rev-parse", "HEAD")).toBe(local);
  expect(git(f.source, "rev-parse", "origin/main")).toBe(upstream);
  expect(git(f.source, "status", "--porcelain")).toBe("");
  expect(await Bun.file(join(f.source, "local.txt")).text()).toBe("committed local work\n");
});

test.each(["stdout", "stderr"])("runtime probe bounds %s before waiting for exit", async stream => {
  await expect(
    probe(
      [process.execPath, "-e", `process.${stream}.write('x'.repeat(20_000));setInterval(()=>{},1000)`],
      process.env,
      1000,
    ),
  ).rejects.toThrow("Native runtime qualification failed");
});
test("runtime probe kills a stalled runtime and accepts bounded output", async () => {
  await expect(probe([process.execPath, "-e", "setInterval(()=>{},1000)"], process.env, 25)).rejects.toThrow(
    "Native runtime qualification failed",
  );
  expect(await probe([process.execPath, "-e", "console.log('bounded')"], process.env)).toBe("bounded\n");
});

test.each(["availability", "fetch", "sqlite", "image", "untrusted-secret"])(
  "runtime probe reports only a recognized fixture failure stage [%s]",
  async stage => {
    const failure = JSON.stringify({
      schema: "shenron-runtime-failure/v1",
      stage,
    });
    const command = `console.error('private-child-diagnostic');console.error(${JSON.stringify(failure)});process.exit(1)`;
    const error = await probe([process.execPath, "-e", command], process.env).then(
      () => {
        throw new Error("Fixture unexpectedly passed");
      },
      reason => reason as Error,
    );
    expect(error.message).toBe(
      "Native runtime qualification failed" + (stage === "untrusted-secret" ? "" : ` (stage: ${stage})`),
    );
    expect(error.message).not.toContain("private-child-diagnostic");
    expect(error.message).not.toContain("untrusted-secret");
  },
);

test("canonical auto-deploy configuration requires exact runtime qualification pins", async () => {
  const configuration = await Bun.file(
    join(import.meta.dir, "../../../tools/aphrody/config/shenron-auto-deploy.json"),
  ).json();
  expect(configuration.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(configuration.runtimeExpected.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(configuration.runtimeExpected.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(configuration.runtimeExpected.sourceUrl).toStartWith("https://github.com/oven-sh/bun/releases/download/");
});
