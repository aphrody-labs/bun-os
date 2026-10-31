// SPDX-License-Identifier: Apache-2.0
// Loop 5, nightly end-to-end qualification (bunos-auto-nightly.timer, 02:30 UTC): build the unified image, boot it as
// a session container, check the stream gateway, open Helium, a web app and Android, take screenshots, run the Gemini
// layer qualification, then publish the status page (aphrody.com/status) and the daily digest (a2a only).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  a2a,
  closeTasks,
  event,
  fileTask,
  home,
  loadState,
  recentEvents,
  repo,
  run,
  saveState,
  statusRoot,
} from "./lib.ts";
import { renderStatus } from "./status.ts";

const bun = process.execPath;

/** `bun factory image build bunos-unified --target session`, then wait for the job's status file to say done. */
export async function imageBuild() {
  const started = await run([bun, "factory/images/build.ts", "build", "bunos-unified", "--target", "session"], {
    timeoutMs: 1_800_000,
  });
  const json = started.out.slice(started.out.indexOf("{"));
  let job: { job?: string; remote?: string } = {};
  try {
    job = JSON.parse(json);
  } catch {
    return { ok: false, detail: `image build did not start: ${started.out.split("\n").slice(-3).join(" | ")}` };
  }
  const statusFile = join(job.remote ?? "", "status");
  const deadline = Date.now() + 3 * 3_600_000;
  while (Date.now() < deadline) {
    const status = existsSync(statusFile) ? await Bun.file(statusFile).text() : "";
    if (/^done$/m.test(status)) {
      const ok = /bunos-unified:session ok/.test(status);
      event("nightly", ok ? "image-built" : "image-failed", `${job.job}: ${status.replace(/\s+/g, " ").slice(0, 300)}`);
      return {
        ok,
        detail: `${job.job}: ${ok ? "bunos-unified:session built" : status.split("\n").find(l => /failed|missing|mismatch/.test(l))}`,
        job: job.job,
      };
    }
    await Bun.sleep(30_000);
  }
  return { ok: false, detail: `${job.job}: no result in 3 hours`, job: job.job };
}

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

export async function nightly(skipBuild = false) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const out = join(home, "bun-os-disk", `nightly-${stamp}`);
  mkdirSync(out, { recursive: true });
  const steps: Step[] = [];

  if (!skipBuild) {
    const image = await imageBuild();
    steps.push({ name: "image build", ok: image.ok, detail: image.detail });
  }

  // Boot and screenshots (qualify.sh session) in its own container so a qualification another agent runs is untouched.
  const name = "bunos-auto-nightly";
  const qualify = await run(["bash", "factory/images/bunos-unified/qualify.sh", "session", out], {
    timeoutMs: 1_800_000,
    env: { QUALIFY_NAME: name, TAG: "bunos-unified:session" },
  });
  const ready = existsSync(join(out, "ready.txt")) ? (await Bun.file(join(out, "ready.txt")).text()).trim() : "";
  const shots = readdirSync(out).filter(f => f.endsWith(".png"));
  steps.push({
    name: "boot",
    ok: qualify.code === 0 && ready.length > 0,
    detail: ready
      ? `ready: ${ready.replace(/\n/g, ", ")}`
      : `no ready marker: ${qualify.out.split("\n").slice(-3).join(" | ")}`,
  });
  steps.push({ name: "screenshots", ok: shots.length >= 2, detail: shots.join(", ") || "none" });
  const android = existsSync(join(out, "android.txt")) ? await Bun.file(join(out, "android.txt")).text() : "";
  steps.push({
    name: "android in session",
    ok: /Session:\s*RUNNING/i.test(android),
    detail: android.split("\n").slice(0, 3).join(" ").slice(0, 200) || "no android status",
  });
  // The stream gateway inside the session (aphrody-remote-desktop on :8794, docs/UNIFIED-IMAGE.md).
  const stream = await run([
    "docker",
    "exec",
    name,
    "sh",
    "-c",
    "ss -ltn 2>/dev/null | grep -q ':8794 ' && echo listening",
  ]);
  steps.push({
    name: "stream gateway",
    ok: stream.out.includes("listening"),
    detail: stream.out.slice(0, 120) || "not listening",
  });
  await run(["docker", "rm", "-f", name], { timeoutMs: 120_000 });

  // Gemini across the layers (aphrody-bot on Vertex).
  const gemini = await run([bun, "factory/google/qualify-gemini.ts", "--json"], { timeoutMs: 600_000 });
  let layers: { layer: string; status: string; detail: string }[] = [];
  try {
    layers = JSON.parse(gemini.out.slice(gemini.out.indexOf("["), gemini.out.lastIndexOf("]") + 1));
  } catch {
    layers = [];
  }
  for (const l of layers)
    steps.push({ name: `gemini: ${l.layer}`, ok: l.status !== "fail", detail: `${l.status} ${l.detail}` });
  if (!layers.length) steps.push({ name: "gemini", ok: false, detail: gemini.out.split("\n").slice(-2).join(" | ") });

  // Publish the screenshots with the run.
  const pub = join(statusRoot, "nightly", stamp);
  mkdirSync(pub, { recursive: true });
  for (const f of shots) copyFileSync(join(out, f), join(pub, f));
  const result = { at: new Date().toISOString(), stamp, out, green: steps.every(s => s.ok), steps, shots };
  saveState("nightly", result);
  const history = loadState<(typeof result)[]>("nightly-history", []);
  history.push(result);
  saveState("nightly-history", history.slice(-30));
  event(
    "nightly",
    result.green ? "green" : "red",
    steps
      .filter(s => !s.ok)
      .map(s => s.name)
      .join(", ") || "all steps green",
  );
  if (!result.green)
    await fileTask({
      key: "nightly",
      kind: "autofix",
      title: `nightly qualification ${stamp} is red`,
      detail: steps
        .filter(s => !s.ok)
        .map(s => `${s.name}: ${s.detail}`)
        .join("\n")
        .concat(`\nArtifacts: ${out}. Rerun: bun factory/automation/auto.ts nightly --skip-build`),
    });
  else closeTasks("nightly", `green ${stamp}`);
  await renderStatus();
  await digest();
  return result;
}

/** Daily digest: the last 24 hours of events, posted to a2a (product lead) and kept on the status page. */
export async function digest() {
  const events = recentEvents(86_400_000);
  const count = (loop: string, kind?: RegExp) =>
    events.filter(e => e.loop === loop && (!kind || kind.test(e.kind))).length;
  const nightlyState = loadState<{ green?: boolean; stamp?: string; steps?: Step[] }>("nightly", {});
  const tasks = loadState<{ state: string; title: string }[]>("tasks", []).filter(
    t => t.state === "open" || t.state === "dispatched",
  );
  const lines = [
    `Bun OS daily digest ${new Date().toISOString().slice(0, 10)} (https://aphrody.com/status)`,
    `nightly ${nightlyState.stamp ?? "-"}: ${nightlyState.green ? "green" : "red"} ${(nightlyState.steps ?? [])
      .filter(s => !s.ok)
      .map(s => s.name)
      .join(", ")}`,
    `deliveries: ${count("deliver", /delivered/)} ok, ${count("deliver", /partial|lane-failed/)} failed, ${count("deliver", /skipped-red/)} red gates`,
    `health: ${count("health", /restart/)} restarts, ${count("health", /down/)} outages, ${count("health", /recovered/)} recoveries`,
    `guard: ${count("guard", /pruned/)} prunes, ${count("guard", /oom/)} OOM reports, ${count("guard", /runaway/)} runaway builds stopped`,
    `deps: ${
      events
        .filter(e => e.loop === "deps")
        .map(e => e.detail.slice(0, 80))
        .slice(-6)
        .join("; ") || "no run"
    }`,
    `coordinator: ${count("coordinator", /dispatched/)} dispatches, ${count("coordinator", /line-done/)} lines done, ${count("coordinator", /requeued/)} re-queued`,
    `open tasks (${tasks.length}): ${tasks
      .slice(0, 8)
      .map(t => t.title)
      .join(" | ")}`,
  ];
  const text = lines.join("\n");
  mkdirSync(statusRoot, { recursive: true });
  await Bun.write(join(statusRoot, "digest.txt"), text + "\n");
  await a2a("product", text);
  event("nightly", "digest", "daily digest published");
  return text;
}

export { repo };
