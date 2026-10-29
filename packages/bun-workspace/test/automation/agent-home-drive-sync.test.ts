// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  counters,
  nativeAgentReport,
  resolveSyncContext,
  syncPass,
  type SyncConfig,
} from "../../src/automation/agent-home-drive-sync.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("local sync paths follow the selected context without rewriting remote stores", () => {
  const cwd = join(tmpdir(), "selected-checkout");
  const home = join(tmpdir(), "selected-owner");
  const resolved = resolveSyncContext(
    {
      ...config,
      root: ".",
      receiptRoot: "~/.aphrody/automation",
      drive: { ...config.drive, home: "~/.aphrody/workspaces/dbfr" },
    },
    cwd,
    home,
  );
  expect(resolved.root).toBe(cwd);
  expect(resolved.receiptRoot).toBe(join(home, ".aphrody", "automation"));
  expect(resolved.drive.home).toBe(join(home, ".aphrody", "workspaces", "dbfr"));
  expect(resolved.publication).toEqual(config.publication);
  expect(resolved.aphrody).toBe("aphrody");
  const replica = {
    incoming: "~/incoming",
    contract: "~/contract.json",
    directory: "/remote",
    stateRoot: "/state",
    extraStateRoot: "/extra",
    intervalSeconds: 300,
  };
  expect(resolveSyncContext({ ...config, replica }, cwd, home).replica?.contract).toBe(join(home, "contract.json"));
});
const config: SyncConfig = {
  version: 1,
  root: "/repo",
  aphrody: "aphrody",
  yolo: "yolo",
  receiptRoot: "/private",
  drive: { home: "/dbfr", folderId: "folder", intervalSeconds: 300 },
  agents: { intervalSeconds: 300 },
  homes: [{ profile: "dbfr", intervalSeconds: 86400 }],
  publication: { host: "vps", directory: "/protected" },
};
const agent = JSON.stringify({
  result: {
    structuredContent: {
      records_ingested: 4,
      sources_scanned: 2,
      sessions: [{ text: "private conversation" }],
      token: "private token",
    },
  },
});
test("Drive failure preserves its success and still collects agents and reconciles home", async () => {
  const visited: string[][] = [];
  const state = await syncPass(
    config,
    {
      drive: {
        ok: true,
        failures: 0,
        nextAt: 0,
        lastSuccess: { observedAt: "old", report: { staged: 2 } },
      },
    },
    async argv => {
      visited.push(argv);
      if (argv[0] === "yolo") throw Error("Drive offline");
      return argv.includes("mcp")
        ? agent
        : JSON.stringify({
            integrity: "ok",
            sessions: { counts: { unchanged: 3 } },
            backups: { verified: 1 },
          });
    },
    1000,
  );
  expect(visited).toHaveLength(3);
  expect(state.drive?.ok).toBe(false);
  expect(state.drive?.lastSuccess?.report).toEqual({ staged: 2 });
  expect(state.drive?.nextAt).toBe(61000);
  expect(state.agents?.ok).toBe(true);
  expect(state["home-dbfr"]?.ok).toBe(true);
  expect(JSON.stringify(state)).not.toContain("private conversation");
});
test("successful jobs are not rerun while a failed job retries; backups remain daily", async () => {
  const prior = {
    drive: { ok: false, failures: 1, nextAt: 100 },
    agents: { ok: true, failures: 0, nextAt: 5000 },
    "home-dbfr": { ok: true, failures: 0, nextAt: 86400000 },
  };
  const called: string[][] = [];
  const state = await syncPass(
    config,
    prior,
    async argv => {
      called.push(argv);
      return '{"unchanged":7}';
    },
    1000,
  );
  expect(called).toHaveLength(1);
  expect(called[0]?.[0]).toBe("yolo");
  expect(state.drive?.failures).toBe(0);
  expect(state["home-dbfr"]?.nextAt).toBe(86400000);
});
test("native tool errors never become successful receipts; only counters are public", () => {
  expect(() => nativeAgentReport('{"result":{"isError":true}}')).toThrow();
  expect(() => nativeAgentReport('{"result":{"structuredContent":{}}}')).toThrow();
  expect(nativeAgentReport(agent)).toEqual({
    records_ingested: 4,
    sources_scanned: 2,
  });
  expect(counters({ token: "secret", uploaded: -1, staged: "2", unchanged: 3 })).toEqual({
    unchanged: 3,
  });
});
