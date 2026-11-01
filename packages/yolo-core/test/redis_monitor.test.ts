// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLedgerDatabase } from "../src/ledger/index";
import { AgentWatcher } from "../src/monitor/agent_watcher";
import { AutoSyncEngine } from "../src/monitor/auto_sync";

async function until(check: () => boolean, timeout = 1500): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Fixture timed out");
    // oxlint-disable-next-line no-await-in-loop -- polling loop: the fixture state is re-read after each sleep, so iterations depend on the previous check
    await Bun.sleep(10);
  }
}

it("reads complete Git state and reports invalid repositories explicitly", async () => {
  const root = mkdtempSync(join(tmpdir(), "yolo-monitor-git-"));
  const engine = new AutoSyncEngine({ trackedRepos: [root], beaconPaths: [] });
  try {
    Bun.spawnSync(["git", "init", "-q", root], { windowsHide: true });
    Bun.spawnSync(
      [
        "git",
        "-C",
        root,
        "-c",
        "user.name=aphrody-dev",
        "-c",
        "user.email=contact@aphrody.com",
        "commit",
        "--allow-empty",
        "-qm",
        "fixture",
      ],
      { windowsHide: true },
    );
    const state = await engine.getGitState(root);
    expect(state.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(state.dirty).toBe(false);
    writeFileSync(join(root, "changed.txt"), "changed");
    expect((await engine.getGitState(root)).uncommittedCount).toBe(1);
    expect((await engine.getGitState(join(root, "missing"))).error).toContain("failed");
  } finally {
    await engine.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

it("honors the sync interval, serializes cycles, and drains before stop returns", async () => {
  const engine = new AutoSyncEngine({
    trackedRepos: [tmpdir()],
    beaconPaths: [],
    syncIntervalMs: 5,
  });
  let active = 0;
  let maxActive = 0;
  let completed = 0;
  engine.getGitState = async () => {
    active++;
    maxActive = Math.max(active, maxActive);
    await Bun.sleep(30);
    active--;
    completed++;
    return {
      repo: "fixture",
      branch: "main",
      commit: "a".repeat(40),
      dirty: false,
      uncommittedCount: 0,
    };
  };
  try {
    engine.startPeriodic();
    engine.startPeriodic();
    await until(() => completed >= 2);
    await engine.stop();
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
    const before = completed;
    await Bun.sleep(40);
    expect(completed).toBe(before);
  } finally {
    await engine.stop();
  }
});

it("writes beacons only to explicit fixture paths and caches empty docs offline", async () => {
  const root = mkdtempSync(join(tmpdir(), "yolo-monitor-beacon-"));
  const target = join(root, "private", "beacon.json");
  const engine = new AutoSyncEngine({
    trackedRepos: [],
    beaconPaths: [target],
    docCacheTtlMs: 25,
    docCacheMaxEntries: 2,
  });
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await Bun.sleep(5);
    return "";
  };
  try {
    expect((await engine.runSyncCycle()).beaconWritten).toBe(true);
    expect((await Bun.file(target).json()).repositories).toEqual({});
    expect(
      await Promise.all([engine.cachedDocQuery("docs", fetcher), engine.cachedDocQuery(" DOCS ", fetcher)]),
    ).toEqual(["", ""]);
    expect(await engine.cachedDocQuery("docs", fetcher)).toBe("");
    expect(calls).toBe(1);
    await Bun.sleep(30);
    await engine.cachedDocQuery("docs", fetcher);
    expect(calls).toBe(2);
  } finally {
    await engine.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

describe("isolated agent watcher", () => {
  it("records actual filesystem events without reading session content", async () => {
    const root = mkdtempSync(join(tmpdir(), "yolo-watch-"));
    const db = initLedgerDatabase(":memory:");
    const watcher = new AgentWatcher({
      customDirs: [root],
      sqliteDb: db,
      endpoints: [],
      maxSessions: 2,
    });
    const sessionId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
    try {
      watcher.start();
      watcher.start();
      mkdirSync(join(root, sessionId));
      writeFileSync(join(root, sessionId, "event.jsonl"), "fixture");
      await until(() => watcher.getActiveSessions().some(session => session.sessionId === sessionId));
      await watcher.stop();
      expect(
        (
          db.query("SELECT COUNT(*) as count FROM agent_telemetry").get() as {
            count: number;
          }
        ).count,
      ).toBeGreaterThan(0);
      const snapshot = watcher.getActiveSessions();
      snapshot[0]!.path = "changed";
      expect(watcher.getActiveSessions()[0]!.path).not.toBe("changed");
    } finally {
      await watcher.stop();
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports 404 as offline, avoids overlapping probes and cancels on stop", async () => {
    let requests = 0;
    let active = 0;
    let maxActive = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch() {
        requests++;
        active++;
        maxActive = Math.max(active, maxActive);
        await Bun.sleep(30);
        active--;
        return new Response("missing", { status: 404 });
      },
    });
    const watcher = new AgentWatcher({
      customDirs: [],
      endpoints: [{ name: "fixture", url: `http://127.0.0.1:${server.port}` }],
      pollEndpointsIntervalMs: 5,
    });
    try {
      watcher.start();
      watcher.start();
      await until(() => requests >= 2);
      expect(watcher.getEndpointStatuses()[0]?.online).toBe(false);
      await watcher.stop();
      expect(maxActive).toBe(1);
      const before = requests;
      await Bun.sleep(40);
      expect(requests).toBe(before);
    } finally {
      await watcher.stop();
      await server.stop(true);
    }
  });
});
