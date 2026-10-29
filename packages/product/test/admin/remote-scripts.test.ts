// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential by design: ordered steps, polling and one host after the other */
/** The shell scripts that run on the hosts, executed for real with `sh` against a fake `aphrody` in a temp HOME. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseProbe, readTrainStatus } from "../../src/admin/lib/doctor.ts";
import type { HostEntry } from "../../src/admin/lib/profile.ts";
import { SCRIPTS } from "../../src/admin/lib/remote.ts";
import { runRemote } from "../../src/admin/lib/ssh.ts";
import { realSystem, type System } from "../../src/admin/lib/system.ts";
import { launchJob, listJobs, readLog, stopJob, trainFlags, type TrainRequest } from "../../src/admin/lib/train.ts";
import { testContext } from "./helpers.ts";

const FAKE_APHRODY = `#!/bin/sh
case "$1" in
  --version) echo "aphrody 1.0.0-test"; exit 0 ;;
esac
[ "$1" = "train" ] || exit 64
case "$2" in
  status) echo '{'; echo '  "gpu_lock_active": false,'; echo '  "python_train_project": true'; echo '}'; exit 0 ;;
esac
shift 2
printf '%s\\n' "$@" > "$HOME/last-args.txt"
out=""; kind=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir) out=$2; shift ;;
    --kind) kind=$2; shift ;;
  esac
  shift
done
mkdir -p "$out"
echo '{"event":"start"}' > "$out/events.jsonl"
case "$kind" in
  dry-run) echo '{"event":"done"}' >> "$out/events.jsonl"; echo "finished fine"; exit 0 ;;
  triples) echo "boom" >&2; exit 3 ;;
  *) echo '{"event":"progress","step":1}' >> "$out/events.jsonl"; echo "working"; sleep 60 ;;
esac
`;

/** The launch script detaches jobs with util-linux `setsid`, present on every Linux host but absent from Windows/macOS shells. */
const detached = test.skipIf(Bun.which("setsid") === null);

let home = "";
let repo = "";
let bin = "";
let host: HostEntry;
let remote: System;

/** Pretends to be ssh: the last argument is the remote command line, run by a local `sh` like a login shell would. */
function localRemote(userHome: string): System {
  const real = realSystem({ ...process.env, HOME: userHome });
  return {
    ...real,
    async run(argv, options = {}) {
      if (argv[0] !== "ssh") return real.run(argv, options);
      return real.run(["sh", "-c", argv.at(-1)!], {
        ...options,
        env: { ...options.env, HOME: userHome },
      });
    },
  };
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "omar-remote-"));
  repo = join(home, "aphrody");
  mkdirSync(repo);
  bin = join(home, "bin-aphrody");
  writeFileSync(bin, FAKE_APHRODY);
  chmodSync(bin, 0o755);
  host = {
    address: "198.51.100.2",
    port: 22,
    user: "omar",
    roles: ["train"],
    repoDir: repo,
    aphrodyBin: bin,
  };
  remote = localRemote(home);
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

const request = (type: TrainRequest["type"], id: string, extra: Partial<TrainRequest> = {}): TrainRequest => ({
  type,
  host: "gpu",
  id,
  steps: 5,
  allowCpu: true,
  ...extra,
});

async function waitFor<T>(read: () => Promise<T | undefined> | T | undefined, ms = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error("timeout");
    await Bun.sleep(50);
  }
}

const jobState = async (paths: ReturnType<typeof testContext>["ctx"]["paths"], id: string) =>
  (await listJobs(remote, paths, "gpu")).jobs.find(job => job.id === id)?.state;

test("sonde reports the host in one read-only round trip", async () => {
  const { ctx } = testContext();
  const result = await runRemote(remote, ctx.paths, "gpu", SCRIPTS.sonde, {
    args: [bin, repo],
  });
  expect(result.code).toBe(0);
  const probe = parseProbe(result.stdout);
  expect(probe.cpu).toBeGreaterThan(0);
  expect(probe.aphrody).toContain("1.0.0-test");
  expect(probe.repo).toBe(true);
  expect(probe.jobs).toBe(0);
  expect(probe.diskAvailKb).toBeGreaterThan(0);
  expect(readTrainStatus(probe.train!).json).toEqual({
    gpu_lock_active: false,
    python_train_project: true,
  });
  const missing = parseProbe(
    (
      await runRemote(remote, ctx.paths, "gpu", SCRIPTS.sonde, {
        args: ["no-such-aphrody", "/nowhere"],
      })
    ).stdout,
  );
  expect(missing.aphrodyAbsent).toBe(true);
});

detached("a short job runs detached, finishes and is reported as finished with its log", async () => {
  const { ctx } = testContext();
  const started = await launchJob(remote, ctx.paths, request("test", "kit-test-finish"), host);
  expect(started.ok).toBe(true);
  expect(started.pid).toMatch(/^\d+$/);
  expect(
    await waitFor(async () => ((await jobState(ctx.paths, "kit-test-finish")) === "termine" ? "yes" : undefined)),
  ).toBe("yes");
  const log = await readLog(remote, ctx.paths, "gpu", "kit-test-finish", 20);
  expect(log.ok).toBe(true);
  expect(log.stdout).toContain("finished fine");
  const last = await readLog(remote, ctx.paths, "gpu", undefined, 20);
  expect(last.stdout).toContain("JOURNAL|kit-test-finish");
  const jobs = (await listJobs(remote, ctx.paths, "gpu")).jobs;
  expect(jobs.find(job => job.id === "kit-test-finish")?.last).toContain("done");
  // the supervisor's output folder lives inside the job folder, never elsewhere
  expect(existsSync(join(home, ".aphrody/omar-train/kit-test-finish/out/events.jsonl"))).toBe(true);
});

detached("a failing job is reported as failed", async () => {
  const { ctx } = testContext();
  expect(
    (
      await launchJob(
        remote,
        ctx.paths,
        request("donnees-triplets", "kit-test-fail", {
          entree: "data/in.jsonl",
        }),
        host,
      )
    ).ok,
  ).toBe(true);
  expect(
    await waitFor(async () => ((await jobState(ctx.paths, "kit-test-fail")) === "echec" ? "yes" : undefined)),
  ).toBe("yes");
  expect((await readLog(remote, ctx.paths, "gpu", "kit-test-fail", 5)).stdout).toContain("boom");
});

detached("flags reach aphrody expanded and quoted; ~/ is expanded on the host", async () => {
  const { ctx } = testContext();
  const flags = request("embeddings", "kit-test-args", {
    entree: "~/data/triples.jsonl",
    domaine: "wiki",
    steps: 7,
  });
  const started = await launchJob(remote, ctx.paths, flags, host);
  expect(started.ok).toBe(true);
  await waitFor(() => (existsSync(join(home, "last-args.txt")) ? true : undefined));
  const args = readFileSync(join(home, "last-args.txt"), "utf8").trim().split("\n");
  expect(args).toEqual([
    "--kind",
    "embed",
    "--id",
    "kit-test-args",
    "--steps",
    "7",
    "--input",
    `${home}/data/triples.jsonl`,
    "--allow-cpu",
    "--out-dir",
    `${home}/.aphrody/omar-train/kit-test-args/out`,
  ]);
  expect(readFileSync(join(home, ".aphrody/omar-train/kit-test-args/job.json"), "utf8")).toContain('"kind":"embed"');
  expect((await stopJob(remote, ctx.paths, "gpu", "kit-test-args", false)).ok).toBe(true);
});

detached("one job at a time, no overwrite, polite stop that keeps every file", async () => {
  const { ctx } = testContext();
  const first = await launchJob(
    remote,
    ctx.paths,
    request("embeddings", "kit-test-long", { entree: "data/in.jsonl" }),
    host,
  );
  expect(first.ok).toBe(true);
  expect(await jobState(ctx.paths, "kit-test-long")).toBe("en-cours");

  const second = await launchJob(remote, ctx.paths, request("test", "kit-test-second"), host);
  expect(second.ok).toBe(false);
  expect(second.message).toContain("déjà en cours");
  expect(existsSync(join(home, ".aphrody/omar-train/kit-test-second"))).toBe(false);

  const pid = Number(first.pid);
  const stopped = await stopJob(remote, ctx.paths, "gpu", "kit-test-long", false);
  expect(stopped).toMatchObject({ ok: true, stillRunning: false });
  expect(() => process.kill(pid, 0)).toThrow();
  expect(await jobState(ctx.paths, "kit-test-long")).toBe("arrete");
  expect(existsSync(join(home, ".aphrody/omar-train/kit-test-long/out/events.jsonl"))).toBe(true);
  expect(existsSync(join(home, ".aphrody/omar-train/kit-test-long/run.log"))).toBe(true);

  const again = await stopJob(remote, ctx.paths, "gpu", "kit-test-long", false);
  expect(again.ok).toBe(false);
  expect(again.message).toContain("pas en cours");

  const reuse = await launchJob(remote, ctx.paths, request("test", "kit-test-long"), host);
  expect(reuse.ok).toBe(false);
  expect(reuse.message).toContain("existe déjà");
});

test("stop never signals a process that only happens to have the pid of an old job", async () => {
  const { ctx } = testContext();
  const dir = join(home, ".aphrody/omar-train/kit-test-stale");
  mkdirSync(dir, { recursive: true });
  const innocent = Bun.spawn(["sleep", "30"], { windowsHide: true });
  writeFileSync(join(dir, "pid"), `${innocent.pid}\n`);
  try {
    expect(await jobState(ctx.paths, "kit-test-stale")).toBe("interrompu");
    const refused = await stopJob(remote, ctx.paths, "gpu", "kit-test-stale", true);
    expect(refused.ok).toBe(false);
    expect(() => process.kill(innocent.pid, 0)).not.toThrow();
  } finally {
    innocent.kill();
  }
});

test("unknown ids and unsafe ids are refused before anything is sent", async () => {
  const { ctx } = testContext();
  expect((await stopJob(remote, ctx.paths, "gpu", "nope-nope", false)).ok).toBe(false);
  expect((await stopJob(remote, ctx.paths, "gpu", "x; rm -rf /", false)).message).toContain("invalide");
  expect((await readLog(remote, ctx.paths, "gpu", "../../etc", 5)).message).toContain("invalide");
  const bad = await launchJob(remote, ctx.paths, request("test", "x; id"), host);
  expect(bad.ok).toBe(false);
  expect(trainFlags(request("test", "kit-x"))).toContain("--allow-cpu");
});

test("a missing repository or binary is reported before anything starts", async () => {
  const { ctx } = testContext();
  const noRepo = await launchJob(remote, ctx.paths, request("test", "kit-test-norepo"), {
    ...host,
    repoDir: "/definitely/missing",
  });
  expect(noRepo.message).toContain("dépôt");
  const noBin = await launchJob(remote, ctx.paths, request("test", "kit-test-nobin"), {
    ...host,
    aphrodyBin: "no-such-aphrody",
  });
  expect(noBin.message).toContain("aphrody est introuvable");
  expect(existsSync(join(home, ".aphrody/omar-train/kit-test-norepo"))).toBe(false);
  expect(existsSync(join(home, ".aphrody/omar-train/kit-test-nobin"))).toBe(false);
});
