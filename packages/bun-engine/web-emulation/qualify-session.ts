#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Qualify the native emulators, Wine and Proton inside the headless Gamescope Gaming session container
 * (factory/images/bunos-gaming, target session). Per entry of SESSION (emulators.ts): start the session with
 * BUNOS_SESSION=app and the emulator command on its free test ROM, take two gamescope screenshots
 * (gamescopectl screenshot) a few seconds apart, look for the client's PipeWire output stream and record its peak
 * level, then stop the container. Results go to <objects>/emulators/qualification.json (the report WebOS serves at
 * /api/emulators/qualification) with screenshots under emulators/shots/. At most four sessions run at a time.
 *
 *   bun packages/bun-engine/web-emulation/qualify-session.ts [--image bunos-gaming:session] [--only id,id]
 *     [--boot-seconds 45] [--jobs 2]
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EMULATORS, SESSION, type QualificationEntry, type QualificationReport } from "./emulators";
import { stageBuiltFixtures, stageFixtures, stageSessionFixtures, writeCatalog } from "./fixtures.ts";
import { pngHasLitPixel } from "./png.ts";

const root = resolve(import.meta.dir, "../../..");
const args = Bun.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const image = value("--image") ?? "bunos-gaming:session";
const only = value("--only")?.split(",");
const bootSeconds = Number(value("--boot-seconds") ?? 45);
const jobs = Math.min(4, Number(value("--jobs") ?? 2));
const objects = resolve(Bun.env.WEBOS_OBJECTS ?? join(Bun.env.HOME ?? root, "apps/webos/objects"));

async function sh(cmd: string[], timeoutMs = 120_000) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  return { code: await proc.exited, out, err };
}

/** Peak absolute sample of interleaved s16le PCM. */
function peak(pcm: Uint8Array) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2));
  let max = 0;
  for (let i = 0; i < view.byteLength; i += 2) max = Math.max(max, Math.abs(view.getInt16(i, true)));
  return max / 32768;
}

async function qualify(id: string, fixtures: string): Promise<QualificationEntry> {
  const launch = SESSION[id]!;
  const name = `bunos-q-${id}-${process.pid}`;
  const runtime = await mkdtemp(join(tmpdir(), "bunos-session-"));
  const entry: QualificationEntry = { id, status: "fail", errors: [], testedAt: new Date().toISOString() };
  const rom = launch.rom ? `/roms/${launch.rom}` : "";
  const command = launch.app.includes("{rom}") ? launch.app.replace("{rom}", rom) : `${launch.app}${rom ? ` ${rom}` : ""}`;
  try {
    // A writable copy of the fixtures: emulators write saves and configs next to the ROM (melonDS refuses to boot
    // when it cannot create GodMode9i.sav).
    await sh(["cp", "-r", fixtures, join(runtime, "roms")]);
    const started = await sh([
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--cpus",
      "4",
      "--memory",
      "6g",
      "--network",
      "none",
      "--device",
      "/dev/udmabuf",
      "-v",
      `${runtime}:/run/user/1000`,
      "-v",
      `${join(runtime, "roms")}:/roms`,
      "-e",
      "BUNOS_SESSION=app",
      "-e",
      `BUNOS_SESSION_APP=${command}`,
      image,
    ]);
    if (started.code) {
      entry.detail = `session did not start: ${started.err.trim().slice(-300)}`;
      return entry;
    }
    await Bun.sleep(bootSeconds * 1000);
    const shots: Uint8Array[] = [];
    for (const n of [1, 2]) {
      await sh([
        "docker",
        "exec",
        "-e",
        "GAMESCOPE_WAYLAND_DISPLAY=gamescope-0",
        name,
        "gamescopectl",
        "screenshot",
        `/tmp/q${n}.png`,
      ]);
      await Bun.sleep(3000);
      const copy = join(runtime, `q${n}.png`);
      await sh(["docker", "cp", `${name}:/tmp/q${n}.png`, copy]);
      if (await Bun.file(copy).exists()) shots.push(new Uint8Array(await Bun.file(copy).arrayBuffer()));
      if (n === 1) await Bun.sleep(4000);
    }
    const lit = shots.some(png => pngHasLitPixel(png));
    const moving =
      shots.length === 2 &&
      new Bun.CryptoHasher("sha256").update(shots[0]!).digest("hex") !==
        new Bun.CryptoHasher("sha256").update(shots[1]!).digest("hex");
    if (shots.length) {
      await mkdir(join(objects, "emulators/shots"), { recursive: true });
      await Bun.write(join(objects, "emulators/shots", `${id}.png`), shots.at(-1)!);
      entry.screenshot = `/api/emulators/qualification/${id}.png`;
    }
    // Audio: the client's output stream in the session PipeWire graph, and its level over two seconds.
    const dump = await sh(["docker", "exec", name, "pw-dump"]);
    let stream: { id: number; props: Record<string, unknown> } | undefined;
    try {
      const objectsList = JSON.parse(dump.out) as {
        id: number;
        type: string;
        info?: { props?: Record<string, unknown> };
      }[];
      const node = objectsList.find(
        o => o.type === "PipeWire:Interface:Node" && o.info?.props?.["media.class"] === "Stream/Output/Audio",
      );
      if (node) stream = { id: node.id, props: node.info!.props! };
    } catch {
      entry.errors.push("pw-dump output was not JSON");
    }
    let level = 0;
    if (stream) {
      await sh(
        [
          "docker",
          "exec",
          name,
          "sh",
          "-c",
          `timeout 2 pw-record --target ${stream.id} --format s16 --rate 48000 --channels 2 --raw /tmp/a.pcm; true`,
        ],
        30_000,
      );
      await sh(["docker", "cp", `${name}:/tmp/a.pcm`, join(runtime, "a.pcm")]);
      const file = Bun.file(join(runtime, "a.pcm"));
      if (await file.exists()) level = peak(new Uint8Array(await file.arrayBuffer()));
    }
    entry.lit = lit;
    entry.audio = stream
      ? `pipewire stream ${String(stream.props["application.name"] ?? stream.id)}, peak ${level.toFixed(3)}`
      : "no output stream";
    entry.renderer = "gamescope headless (lavapipe)";
    const logs = await sh(["docker", "logs", "--tail", "40", name]);
    const crashed = !(await sh(["docker", "inspect", "-f", "{{.State.Running}}", name])).out.includes("true");
    const problems: string[] = [];
    if (crashed) problems.push(`session exited: ${(logs.out + logs.err).trim().split("\n").slice(-3).join(" | ")}`);
    if (!shots.length) problems.push("no gamescope screenshot");
    else if (!lit) problems.push("the screen stayed black");
    if (!stream) problems.push("no PipeWire output stream");
    if (launch.blocker) {
      entry.status = problems.length ? "fail" : "untested";
      entry.detail = `${problems.length ? problems.join("; ") : `UI renders${moving ? " and animates" : ""} in the session`}; ROM boot blocked: ${launch.blocker}`;
    } else {
      entry.status = problems.length ? "fail" : "pass";
      entry.detail = problems.length
        ? problems.join("; ")
        : `booted ${launch.rom ?? launch.app} in the Gamescope session${moving ? ", frames changing" : ""}`;
    }
    return entry;
  } finally {
    await sh(["docker", "rm", "-f", name]);
    await rm(runtime, { recursive: true, force: true }).catch(() => {});
  }
}

if ((await sh(["docker", "image", "inspect", image])).code)
  throw new Error(`session image ${image} is not built (bun factory image build bunos-gaming --target session)`);
await stageFixtures(objects);
await stageSessionFixtures(objects);
await stageBuiltFixtures(objects);
await writeCatalog(objects);
const fixtures = join(objects, "emulation/fixtures");
const reportPath = join(objects, "emulators/qualification.json");
const previous: QualificationReport | undefined = (await Bun.file(reportPath).exists())
  ? await Bun.file(reportPath).json()
  : undefined;
const ids = Object.keys(SESSION).filter(id => (!only || only.includes(id)) && EMULATORS.some(e => e.id === id));
const results: Record<string, QualificationEntry> = {};
for (let i = 0; i < ids.length; i += jobs) {
  const batch = ids.slice(i, i + jobs);
  for (const entry of await Promise.all(
    batch.map(id =>
      qualify(id, fixtures).catch((e): QualificationEntry => ({
        id,
        status: "fail",
        errors: [],
        detail: String(e?.message ?? e),
      })),
    ),
  )) {
    results[entry.id] = entry;
    console.log(`${entry.id}: ${entry.status} (${entry.detail})`);
  }
  // Merge into the shared report after every batch: the WASM runner writes the same file.
  const current: QualificationReport = (await Bun.file(reportPath).exists())
    ? await Bun.file(reportPath).json()
    : (previous ?? { schemaVersion: 1, generatedAt: "", base: "", entries: {} });
  current.entries = { ...current.entries, ...results };
  current.generatedAt = new Date().toISOString();
  await mkdir(join(objects, "emulators"), { recursive: true });
  await Bun.write(reportPath, `${JSON.stringify(current, null, 2)}\n`);
}
if (Object.values(results).some(e => e.status === "fail")) process.exitCode = 1;
