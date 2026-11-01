// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  indexCodebaseFingerprints,
  initLedgerDatabase,
  recordAuditReport,
  recordBenchmark,
  recordQualityGate,
  recordRemediation,
  recordSession,
  summarizeLedger,
  recordAgentTelemetry,
  recordTrainingSample,
} from "../src/ledger/index";
import { findRepoRoot } from "../src/vfs/index";

describe("Native Bun SQLite Audit & Training Ledger", () => {
  const root = findRepoRoot();
  const testDbPath = join(root, "var", "test-ledger.sqlite");
  const db = initLedgerDatabase(testDbPath);

  afterAll(() => {
    try {
      db.close();
      unlinkSync(testDbPath);
    } catch {
      // Ignore cleanup error
    }
  });

  it("initializes tables and records session correctly", () => {
    recordSession(db, {
      sessionId: "test-session",
      recordedAt: new Date().toISOString(),
      host: "test-host",
      os: "Linux",
      kernel: "6.18",
      platform: "linux",
      metadata: { test: true },
    });

    const row = db.query("SELECT * FROM sessions WHERE session_id = 'test-session'").get() as {
      host: string;
    };
    expect(row.host).toBe("test-host");
  });

  it("records audit reports, benchmarks, and quality gates", () => {
    recordAuditReport(db, {
      sessionId: "test-session",
      domain: "test_domain",
      auditor: "test_agent",
      verdict: "HEALTHY",
      summary: "All systems healthy",
      details: { score: 100 },
      recordedAt: new Date().toISOString(),
    });

    recordBenchmark(db, {
      sessionId: "test-session",
      benchmarkName: "test_bench",
      target: "test_target",
      iterations: 1000,
      latencyUs: 500,
      throughputOpsSec: 2000000,
      measuredAt: new Date().toISOString(),
    });

    recordQualityGate(db, {
      sessionId: "test-session",
      gateName: "test_gate",
      command: "echo test",
      exitCode: 0,
      passed: true,
      proofDetails: "stdout: test",
      recordedAt: new Date().toISOString(),
    });

    recordRemediation(db, {
      issueCode: "FIX-01",
      component: "test",
      description: "Resolved test issue",
      status: "RESOLVED",
      patchCommit: "abcdef",
      resolvedAt: new Date().toISOString(),
    });

    const summary = summarizeLedger(db);
    expect(summary.sessionCount).toBeGreaterThanOrEqual(1);
    expect(summary.auditCount).toBeGreaterThanOrEqual(1);
    expect(summary.benchmarkCount).toBeGreaterThanOrEqual(1);
    expect(summary.gateCount).toBeGreaterThanOrEqual(1);
    expect(summary.remediations.length).toBeGreaterThanOrEqual(1);
  });

  it("indexes codebase fingerprints cleanly", () => {
    const count = indexCodebaseFingerprints(db, join(root, "packages", "runtime-sdk"));
    expect(count).toBeGreaterThan(0);
    const summary = summarizeLedger(db);
    expect(summary.fingerprintCount).toBeGreaterThan(0);
  });

  it("records agent telemetry and training samples cleanly", () => {
    const now = new Date().toISOString();
    recordAgentTelemetry(db, {
      agent: "agy",
      sessionId: "test-agent-session-123",
      eventType: "write",
      targetPath: "/home/aphro/.gemini/test.txt",
      timestamp: now,
    });

    const telem = db.query("SELECT * FROM agent_telemetry WHERE session_id = 'test-agent-session-123'").get() as {
      agent: string;
      event_type: string;
    };
    expect(telem.agent).toBe("agy");
    expect(telem.event_type).toBe("write");

    recordTrainingSample(db, {
      sampleId: "sample-001",
      profile: "yolo",
      domain: "bun_typescript7",
      instruction: "Ensure strict TS without errors",
      inputContext: "tsc --noEmit",
      action: "Fix type annotations",
      outcome: "0 errors",
      rewardScore: 1.0,
      createdAt: now,
    });

    const sample = db.query("SELECT * FROM training_samples WHERE sample_id = 'sample-001'").get() as {
      domain: string;
      profile: string;
      reward_score: number;
    };
    expect(sample.domain).toBe("bun_typescript7");
    expect(sample.profile).toBe("yolo");
    expect(sample.reward_score).toBe(1.0);
  });

  it("strictly redacts secrets (OpenAI sk-*, Google AIza*, passwords, tokens) across all ledger records", () => {
    const now = new Date().toISOString();

    recordTrainingSample(db, {
      sampleId: "sample-secret-test",
      profile: "yolo",
      domain: "privacy_audit",
      instruction:
        "Use sk-proj-1234567890abcdef1234567890 to authenticate and AIzaSyD1234567890abcdefghijklmnopqrstuvw for Google",
      inputContext: '{"password": "plain_password_12345", "token": "ghp_1234567890abcdefghijklmnopqrstuvwxyz12"}',
      action: "Run command with --password=supersecret and Bearer 1234567890abcdef1234567890",
      outcome: "Success with password: secret_pass_987",
      rewardScore: 1.0,
      createdAt: now,
    });

    const row = db.query("SELECT * FROM training_samples WHERE sample_id = 'sample-secret-test'").get() as {
      instruction: string;
      input_context: string;
      action: string;
      outcome: string;
    };

    // OpenAI key redacted
    expect(row.instruction).not.toContain("sk-proj-1234567890abcdef1234567890");
    expect(row.instruction).toContain("[REDACTED_OPENAI_KEY]");

    // Google AIza key redacted
    expect(row.instruction).not.toContain("AIzaSyD1234567890abcdefghijklmnopqrstuvw");
    expect(row.instruction).toContain("[REDACTED_GOOGLE_KEY]");

    // GitHub token & password in JSON redacted
    expect(row.input_context).not.toContain("plain_password_12345");
    expect(row.input_context).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz12");
    expect(row.input_context).toContain("[REDACTED_SECRET]");

    // Password flag & Bearer token redacted
    expect(row.action).not.toContain("supersecret");
    expect(row.action).not.toContain("1234567890abcdef1234567890");
    expect(row.action).toContain("[REDACTED_SECRET]");
    expect(row.action).toContain("[REDACTED_TOKEN]");

    // Password assignment redacted
    expect(row.outcome).not.toContain("secret_pass_987");
    expect(row.outcome).toContain("[REDACTED_PASSWORD]");
  });
});
