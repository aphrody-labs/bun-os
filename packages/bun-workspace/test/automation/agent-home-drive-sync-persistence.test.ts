// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasFailedJob,
  publishSyncReceipts,
  syncPass,
  type SyncConfig,
  type SyncState,
} from "../../src/automation/agent-home-drive-sync.ts";
import { hasMode } from "../../src/automation/portable-fs.ts";

const config: SyncConfig = {
  version: 1,
  root: "/repo",
  aphrody: "aphrody",
  yolo: "yolo",
  receiptRoot: "/private",
  drive: { home: "/dbfr", folderId: "folder", intervalSeconds: 300 },
  retrieval: { root: "/staged", intervalSeconds: 3600 },
  jobs: ["drive-retrieval", "drive"],
  publication: {
    host: "local",
    directory: "/protected",
    receiptName: "agent-sync-vps-status.json",
  },
};
const state: SyncState = {
  drive: {
    ok: true,
    failures: 0,
    nextAt: 300_000,
    lastSuccess: {
      observedAt: "2026-10-07T13:00:00.000Z",
      report: { unchanged: 3 },
    },
  },
};
const temporary: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "aphrody-sync-publication-"));
  temporary.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

test("a selected Drive worker needs no agent settings and cannot retain unrelated job receipts", async () => {
  const previous: SyncState = {
    agents: { ok: false, failures: 3, nextAt: 0 },
    "rag-monitor": { ok: true, failures: 0, nextAt: 0 },
  };
  const calls: { argv: string[]; env?: Record<string, string> }[] = [];
  const next = await syncPass(
    {
      ...config,
      ragMonitor: {
        unit: "aphrody-rag-sync.service",
        reportPath: "/private/rag.json",
        intervalSeconds: 60,
      },
    },
    previous,
    async (argv, env) => {
      calls.push({ argv, env });
      return argv[0] === "yolo" ? '{"unchanged":3,"token":"private"}' : '{"indexed":1,"chunks":4,"errors":[]}';
    },
    1000,
  );
  expect(calls.map(({ argv }) => argv)).toEqual([
    ["yolo", "google", "drive", "sync", "--download-only"],
    ["aphrody", "home", "index", "/staged", "--label", "drive-dbfr-staged", "--profile", "dbfr"],
  ]);
  expect(calls[0]?.env).toEqual({
    APHRODY_AGENT_HOME: "/dbfr",
    APHRODY_GOOGLE_DRIVE_FOLDER_ID: "folder",
  });
  expect(Object.keys(next)).toEqual(["drive", "drive-retrieval"]);
  expect(next.drive?.lastSuccess?.report).toEqual({ unchanged: 3 });
  expect(next["drive-retrieval"]?.lastSuccess?.report).toEqual({
    indexed: 1,
    chunks: 4,
  });
  expect(previous.agents?.failures).toBe(3);
  expect(Object.keys(previous)).toEqual(["agents", "rag-monitor"]);
});

test("selected jobs keep their last success and backoff while excluded jobs never run", async () => {
  let calls = 0;
  const next = await syncPass(
    { ...config, jobs: ["drive"] },
    { ...state, agents: { ok: false, failures: 6, nextAt: 0 } },
    async () => {
      calls++;
      throw new Error("Drive unavailable");
    },
    300_000,
  );
  expect(calls).toBe(1);
  expect(next.drive?.ok).toBe(false);
  expect(next.drive?.nextAt).toBe(360_000);
  expect(next.drive?.lastSuccess).toEqual(state.drive?.lastSuccess);
  expect(next.agents).toBeUndefined();
});

test("invalid selections fail before calling any capability", async () => {
  let calls = 0;
  await Promise.all(
    [[], ["drive", "drive"], ["agents"], ["unknown"], null].map(jobs =>
      expect(
        syncPass({ ...config, jobs } as SyncConfig, {}, async () => {
          calls++;
          return "{}";
        }),
      ).rejects.toThrow("Selected sync jobs"),
    ),
  );
  expect(calls).toBe(0);
});

test("local publication atomically replaces only its distinct private receipt without SSH", async () => {
  const path = await directory();
  const legacy = ["drive-sync.json", "agent-sync.json", "rag-sync.json", "automation-sync.json"];
  await Promise.all(legacy.map(name => Bun.write(join(path, name), "owned-by-wsl")));
  const receipt = join(path, "agent-sync-vps-status.json");
  await Bun.write(receipt, "previous-complete-receipt", { mode: 0o666 });
  // Windows cannot rename over a file another handle holds open; the open-reader proof is POSIX-only.
  const reader = process.platform === "win32" ? undefined : await open(receipt, "r");
  try {
    await publishSyncReceipts(
      { ...config, publication: { ...config.publication, directory: path } },
      state,
      async () => {
        throw new Error("Local publication must not use SSH");
      },
    );
    if (reader) expect(await reader.readFile("utf8")).toBe("previous-complete-receipt");
    expect((await Bun.file(receipt).json()).jobs).toEqual(state);
    expect(hasMode((await stat(receipt)).mode, 0o600)).toBe(true);
    expect((await readdir(path)).toSorted()).toEqual([...legacy, "agent-sync-vps-status.json"].toSorted());
    await Promise.all(legacy.map(async name => expect(await Bun.file(join(path, name)).text()).toBe("owned-by-wsl")));
  } finally {
    await reader?.close();
  }
});

test("omitting a receipt name preserves the legacy per-capability publication contract", async () => {
  const path = await directory();
  await publishSyncReceipts({ ...config, publication: { host: "local", directory: path } }, state, async () => {
    throw new Error("Local publication must not use SSH");
  });
  expect((await readdir(path)).toSorted()).toEqual(["automation-sync.json", "drive-sync.json"]);
  expect(await Bun.file(join(path, "drive-sync.json")).json()).toEqual(state.drive?.lastSuccess);
  expect(hasMode((await stat(join(path, "automation-sync.json"))).mode, 0o600)).toBe(true);
});

test("unsafe receipt names cannot escape the destination or invoke a remote command", async () => {
  const path = await directory();
  let calls = 0;
  await Promise.all(
    [
      "../escape.json",
      "/absolute.json",
      "nested/receipt.json",
      "nested\\receipt.json",
      ".hidden.json",
      "receipt\n.json",
      "receipt\0.json",
      "receipt.txt",
      "",
      "a".repeat(130) + ".json",
    ].map(receiptName =>
      expect(
        publishSyncReceipts(
          {
            ...config,
            publication: { host: "vps", directory: path, receiptName },
          },
          state,
          async () => {
            calls++;
            return "sync-receipts-published";
          },
        ),
      ).rejects.toThrow("receipt basename"),
    ),
  );
  expect(calls).toBe(0);
  expect(await readdir(path)).toEqual([]);
});

test("review pending and blocked receipts gate downstream consumers even between review ticks", async () => {
  const driveReview = {
    intervalSeconds: 300,
    receiptRoot: "/private/reviews",
    stateFile: "/private/state",
    baselineDirectory: "/private/baseline",
    reviewedDirectory: "/private/reviewed",
    a2aUrl: "http://localhost:8788",
    tokenFile: "/private/token",
    peer: "codex",
    ownerModule: { path: "/private/owner", sha256: "a".repeat(64) },
    validatorModule: { path: "/private/validator", sha256: "b".repeat(64) },
  };
  await Promise.all(
    ([{ review_pending: 1 }, { review_blocked: 1 }] as Record<string, number>[]).map(async report => {
      const previous: SyncState = {
        "drive-review": {
          ok: true,
          nextAt: 5000,
          failures: 0,
          lastSuccess: { observedAt: "2026-10-07T13:00:00.000Z", report },
        },
      };
      let calls = 0;
      const next = await syncPass(
        {
          ...config,
          driveReview,
          jobs: ["drive-review", "drive-retrieval", "drive-replica"],
          replica: {
            incoming: "/private/incoming",
            directory: "/private/dest",
            stateRoot: "/private/stateRoot",
            extraStateRoot: "/private/extra",
            contract: "/private/contract",
            intervalSeconds: 300,
          },
        },
        previous,
        async () => {
          calls++;
          return "{}";
        },
        1000,
      );
      expect(calls).toBe(0);
      for (const job of ["drive-retrieval", "drive-replica"]) {
        expect(next[job]?.ok).toBe(false);
        expect(next[job]?.waiting?.report).toEqual(report);
        expect(next[job]?.lastSuccess).toBeUndefined();
      }
    }),
  );
});
test("reviewed indexing requires an intact managed generation rather than prior success alone", async () => {
  const root = await directory();
  let calls = 0;
  const next = await syncPass(
    {
      ...config,
      jobs: ["drive-review", "drive-retrieval"],
      driveReview: {
        intervalSeconds: 300,
        receiptRoot: root,
        stateFile: root + "/state",
        baselineDirectory: root + "/baseline",
        reviewedDirectory: root + "/absent",
        a2aUrl: "http://localhost:8788",
        tokenFile: root + "/token",
        peer: "codex",
        ownerModule: { path: root + "/owner", sha256: "a".repeat(64) },
        validatorModule: { path: root + "/validator", sha256: "b".repeat(64) },
      },
    },
    {
      "drive-review": {
        ok: true,
        failures: 0,
        nextAt: 5000,
        lastSuccess: {
          observedAt: "2026-10-07T13:00:00.000Z",
          report: { unchanged: 7, verified: 7 },
        },
      },
    },
    async () => {
      calls++;
      return '{"errors":[]}';
    },
    1000,
  );
  expect(calls).toBe(0);
  expect(next["drive-retrieval"]?.ok).toBe(false);
});
test("a job parked on review is waiting, not failed; a real failure clears the wait and fails the timer", async () => {
  const waiting = {
    observedAt: "2026-10-09T00:00:00.000Z",
    report: { review_blocked: 1 },
  };
  expect(
    hasFailedJob({
      drive: { ok: true, failures: 0, nextAt: 0 },
      "drive-replica": { ok: false, failures: 0, nextAt: 0, waiting },
    }),
  ).toBe(false);
  const next = await syncPass(
    { ...config, jobs: ["drive"] } as SyncConfig,
    { drive: { ok: false, failures: 0, nextAt: 0, waiting } },
    async () => {
      throw new Error("Drive unavailable");
    },
    1000,
  );
  expect(next.drive?.waiting).toBeUndefined();
  expect(hasFailedJob(next)).toBe(true);
});

test("remote receipts use native Bun atomic writes and expose only whitelisted public metadata", async () => {
  const path = await directory();
  const next: SyncState = {
    ...state,
    "drive-review": {
      ok: true,
      nextAt: 300000,
      failures: 0,
      lastSuccess: {
        observedAt: "2026-10-07T13:00:00.000Z",
        report: { review_pending: 1, token: "private" } as never,
      },
    },
    "drive-retrieval": {
      ok: false,
      failures: 0,
      nextAt: 60000,
      waiting: {
        observedAt: "2026-10-07T13:00:00.000Z",
        report: { review_pending: 1 },
      },
    },
    secret: { ok: true, failures: 0, nextAt: 1, token: "private" } as never,
  };
  await publishSyncReceipts(
    {
      ...config,
      publication: { ...config.publication, host: "vps", directory: path },
    },
    next,
    async argv => {
      const command = argv[argv.indexOf("--cmd") + 1]!;
      expect(command.startsWith("/home/ubuntu/.bun/bin/bun -e '")).toBe(true);
      expect(command).not.toContain("python");
      const prefix = "/home/ubuntu/.bun/bin/bun -e '";
      expect(command.endsWith("'")).toBe(true);
      // Undo the single-quote shell escaping so the remote script runs without a POSIX shell.
      const script = command.slice(prefix.length, -1).replaceAll("'\\''", "'");
      const child = Bun.spawn([process.execPath, "-e", script], {
        windowsHide: true,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [output, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(error).toBe("");
      expect(code).toBe(0);
      return output;
    },
  );
  const receipt = await Bun.file(join(path, "agent-sync-vps-status.json")).json();
  expect(JSON.stringify(receipt)).not.toContain("private");
  expect(receipt.jobs.secret).toBeUndefined();
  expect(receipt.jobs["drive-review"].lastSuccess.report).toEqual({
    review_pending: 1,
  });
  expect(receipt.jobs["drive-retrieval"].waiting.report).toEqual({
    review_pending: 1,
  });
  expect(hasMode((await stat(join(path, "agent-sync-vps-status.json"))).mode, 0o600)).toBe(true);
  expect(await readdir(path)).toEqual(["agent-sync-vps-status.json"]);
});
