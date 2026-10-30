// SPDX-License-Identifier: Apache-2.0
// Android APK catalog at /repo/android: every APK found among the built outputs of the Android owners is published with
// size and sha256. Owners without a built APK on this host are recorded as skipped with the reason (no Android SDK on the
// VPS; the Gradle build is not run here).
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { run, sha256, step, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

const OWNERS = ["apps/bun-android", "apps/java-ffi", "packages/bun-android", "packages/android-pipeline", "packages/android-web", "crates/android-native"];

async function findApks(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (d: string, depth: number) => {
    if (depth > 7) return;
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.name.endsWith(".apk")) found.push(p);
    }
  };
  await walk(dir, 0);
  return found;
}

export async function build(ctx: Ctx): Promise<void> {
  const out = join(ctx.store, "repo/android");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const entries: IndexEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const sdk = Bun.env.ANDROID_HOME || Bun.env.ANDROID_SDK_ROOT;
  for (const owner of OWNERS) {
    const apks = [...(await findApks(join(ctx.root, owner))), ...(await findApks(join(ctx.root, "build", owner)))];
    if (!apks.length) {
      skipped.push({ name: owner, reason: sdk ? "no built APK; run the Gradle build on the VPS" : "no built APK and no Android SDK on this host (Gradle build not run)" });
      continue;
    }
    for (const apk of apks) {
      const name = `${owner.split("/").pop()}-${basename(apk)}`;
      await cp(apk, join(out, name));
      const badging = await run(["sh", "-c", `command -v aapt2 >/dev/null && aapt2 dump badging '${apk}' | head -1`]);
      const m = /name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/.exec(badging.out);
      entries.push({
        name: m?.[1] ?? name.replace(/\.apk$/, ""),
        version: m?.[3] ?? "unknown",
        desc: `Android APK from ${owner}`,
        size: Bun.file(apk).size,
        sha256: await sha256(apk),
        file: `/repo/android/${name}`,
        member: owner,
        meta: { versionCode: m?.[2], aapt: !!m },
      });
    }
  }
  await Bun.write(join(out, "index.json"), JSON.stringify({ generated: new Date().toISOString(), apps: entries, skipped }, null, 1));
  await run(["chmod", "-R", "a+rX", out]);
  await writeIndex(ctx, { format: "android", generated: new Date().toISOString(), url: "/repo/android/index.json", entries, skipped });
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const idx = (await Bun.file(join(ctx.store, "index/android.json")).json().catch(() => undefined)) as { entries: IndexEntry[] } | undefined;
  if (!idx?.entries.length)
    steps.push({ name: "APK catalog", ok: false, ms: 0, log: "No APK is published: no built APK of the Android owners exists on the VPS and it has no Android SDK." });
  for (const e of idx?.entries ?? [])
    await step(steps, `download ${e.file} and verify sha256 and zip`, async () => {
      const res = await fetch(ctx.origin + e.file!);
      if (!res.ok) return { code: 1, out: `HTTP ${res.status}` };
      const buf = new Uint8Array(await res.arrayBuffer());
      const hash = new Bun.CryptoHasher("sha256").update(buf).digest("hex");
      if (hash !== e.sha256) return { code: 1, out: "sha256 mismatch" };
      const tmp = `/tmp/q-${hash.slice(0, 8)}.apk`;
      await Bun.write(tmp, buf);
      const t = await run(["unzip", "-tq", tmp]);
      await rm(tmp, { force: true });
      return t;
    });
  return { format: "android", ok: steps.length > 0 && steps.every((s) => s.ok), at: new Date().toISOString(), steps };
}
