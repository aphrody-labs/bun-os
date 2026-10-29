// SPDX-License-Identifier: Apache-2.0
import type { Runner } from "./agent-home-drive-sync.ts";

export interface RagMonitorConfig {
  unit: `aphrody-${string}.service`;
  reportPath: string;
  intervalSeconds: number;
}
/** Only the current unit execution can establish completion; previous reports cannot. */
export function ragCounters(unit: string, report: Record<string, unknown>, journal = "") {
  const properties = Object.fromEntries(
    unit
      .trim()
      .split("\n")
      .map(line => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  const pid = Number(properties.MainPID);
  const running = ["active", "activating"].includes(properties.ActiveState ?? "") && pid > 1;
  const start = Number(properties.ExecMainStartTimestamp?.replace(/^@/, "")) * 1000;
  const observed = Date.parse(typeof report.generatedAt === "string" ? report.generatedAt : "");
  const current = Number.isFinite(start) && start > 0 && Number.isFinite(observed) && observed >= start;
  const complete =
    !running &&
    properties.ActiveState === "inactive" &&
    properties.Result === "success" &&
    properties.ExecMainStatus === "0" &&
    current &&
    report.failed === false;
  const progress = running ? [...journal.matchAll(/(\d+)\/(\d+) indexed/g)].at(-1) : undefined;
  const sources = current && Array.isArray(report.sources) ? report.sources : [];
  const indexed = sources.reduce(
    (count: number, source: Record<string, unknown>) =>
      count + (Number.isSafeInteger(source.indexed) && Number(source.indexed) >= 0 ? Number(source.indexed) : 0),
    0,
  );
  return {
    running: Number(running),
    completed: Number(complete),
    failed: Number(properties.ActiveState === "failed" || (current && report.failed === true)),
    source_count: sources.length,
    indexed,
    ...(progress
      ? {
          progress_current: Number(progress[1]),
          progress_total: Number(progress[2]),
        }
      : {}),
  };
}

export async function readRagStatus(config: RagMonitorConfig, run: Runner) {
  if (!/^aphrody-[a-z0-9-]+\.service$/.test(config.unit)) throw Error("Invalid RAG monitor unit");
  const unit = await run([
    "systemctl",
    "--user",
    "show",
    config.unit,
    "--timestamp=unix",
    "-p",
    "ActiveState",
    "-p",
    "MainPID",
    "-p",
    "ExecMainStartTimestamp",
    "-p",
    "Result",
    "-p",
    "ExecMainStatus",
  ]);
  const pid = Number(unit.match(/^MainPID=(\d+)$/m)?.[1]);
  const journal =
    pid > 1 ? await run(["journalctl", "--user", "-u", config.unit, `_PID=${pid}`, "-n", "30", "--output", "cat"]) : "";
  const report = await Bun.file(config.reportPath)
    .json()
    .catch(() => ({}));
  return ragCounters(unit, report, journal);
}
