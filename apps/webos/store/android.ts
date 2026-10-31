// SPDX-License-Identifier: Apache-2.0
// Android APK catalog (/repo/android) and F-Droid repository (/repo/fdroid/repo) of the Bun OS Store.
// build(): release builds of apps/bun-android (Gradle wrapper, Compose M3 + Rust core for every ABI) and apps/bunos-flutter-store
// (flutter build apk) with the shared factory toolchain (/opt/android-sdk, factory/android/jvm.json), zipalign + apksigner with
// a release keystore kept in the protected store, then fdroidserver (`fdroid update`) publishes a signed F-Droid repo
// (index-v1/v2, entry.jar, icons). The fdroid work tree (config.yml, keystore paths) stays outside the served store;
// only its repo/ is copied below STORE_ROOT/repo/fdroid/repo.
// qualify(): emulator-free check of what is served: download, sha256, apksigner verify, aapt2 badging, F-Droid index.
import { chmod, cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { run, sha256, step, tail, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

const HOME = Bun.env.HOME ?? "/home/ubuntu";
const SDK = Bun.env.ANDROID_HOME ?? ((await Bun.file("/opt/android-sdk/build-tools/37.0.0/apksigner").exists()) ? "/opt/android-sdk" : join(HOME, "android-sdk"));
const BUILD_TOOLS = "37.0.0";
const FDROID = Bun.env.FDROID ?? join(HOME, ".local/share/fdroidserver-venv/bin/fdroid");
const JAVA_HOME = Bun.env.ANDROID_JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk-amd64";
const OWNERS = ["apps/bun-android", "apps/bunos-flutter-store", "apps/java-ffi", "packages/bun-android", "packages/android-pipeline", "packages/android-web", "crates/android-native", "crates/bunos-flutter-bridge"];
const APPS = new Set(["apps/bun-android", "apps/bunos-flutter-store"]);
const SUMMARY: Record<string, string> = {
  "apps/bun-android": "Bun OS companion for Android",
  "apps/bunos-flutter-store": "Bun OS Store in Flutter",
};
const DESC: Record<string, string> = {
  "apps/bun-android": "the Bun OS Android companion: Jetpack Compose Material 3 with the Bun OS tokens, the Rust core through JNI and uniffi, the Bun runtime and web assets.",
  "apps/bunos-flutter-store": "the Bun OS Store and WebOS status in Flutter Material 3, themed by the Bun OS tokens or any seed computed by the Rust core.",
};
const bt = (tool: string) => join(SDK, "build-tools", BUILD_TOOLS, tool);
// dl.google.com answers 404 over IPv6 from the VPS; the JVM tools go over IPv4.
const GRADLE_USER_HOME = Bun.env.GRADLE_USER_HOME ?? join(HOME, ".cache/bunos-android/gradle");
const env = { JAVA_HOME, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, GRADLE_USER_HOME, APHRODY_BUILD_HOST: "", APHRODY_LOCAL_CARGO: "1", APHRODY_CARGO_JOBS: "4", APHRODY_CARGO_LOCK_DIR: join(HOME, ".cache/aphrody/lanes/runtime"), JAVA_TOOL_OPTIONS: "-Djava.net.preferIPv4Stack=true", PATH: `${JAVA_HOME}/bin:${join(HOME, ".cargo/bin")}:${process.env.PATH}` };

/** Release build of one app; returns the APK to align and sign (unsigned, or debug-signed for Flutter). */
async function buildApp(ctx: Ctx, owner: string): Promise<{ apk?: string; reason?: string }> {
  const project = join(ctx.root, owner);
  if (owner === "apps/bun-android") {
    const r = await run([join(project, "gradlew"), "--max-workers=4", "-q", ":app:assembleRelease"], { cwd: project, env, timeout: 3_600_000 });
    const apk = join(project, "app/build/outputs/apk/release/app-release-unsigned.apk");
    return r.code === 0 && (await Bun.file(apk).exists()) ? { apk } : { reason: `Gradle release build failed: ${tail(r.out, 3)}` };
  }
  const flutterRoot = join(ctx.root, "vendor/flutter");
  const flutter = join(flutterRoot, "bin/flutter");
  if (!(await Bun.file(flutter).exists())) return { reason: "vendor/flutter missing (bun factory/android/jvm.ts flutter)" };
  const fenv = { ...env, FLUTTER_ROOT: flutterRoot, FLUTTER_GIT_URL: "https://github.com/aphrody-labs/flutter.git", PUB_CACHE: join(HOME, ".cache/bunos-android/pub"), FLUTTER_SUPPRESS_ANALYTICS: "true" };
  const r = await run([flutter, "build", "apk", "--release"], { cwd: project, env: fenv, timeout: 3_600_000 });
  const apk = join(project, "build/app/outputs/flutter-apk/app-release.apk");
  return r.code === 0 && (await Bun.file(apk).exists()) ? { apk } : { reason: `flutter build apk failed: ${tail(r.out, 3)}` };
}

/** Random secret stored once in the protected store (mode 600); never printed. */
async function secret(path: string): Promise<string> {
  const file = Bun.file(path);
  if (await file.exists()) return (await file.text()).trim();
  const value = new Bun.CryptoHasher("sha256").update(crypto.getRandomValues(new Uint8Array(32))).digest("hex").slice(0, 32);
  await Bun.write(path, value);
  await chmod(path, 0o600);
  return value;
}

async function keystore(dir: string, name: string, alias: string, dname: string) {
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);
  const pass = await secret(join(dir, `${name}.pass`));
  const path = join(dir, `${name}.jks`);
  if (!(await Bun.file(path).exists())) {
    const r = await run([join(JAVA_HOME, "bin/keytool"), "-genkeypair", "-keystore", path, "-storetype", "PKCS12", "-alias", alias, "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000", "-storepass:env", "KS_PASS", "-dname", dname], { env: { ...env, KS_PASS: pass } });
    if (r.code !== 0) throw new Error(`keytool failed: ${tail(r.out, 3).replaceAll(pass, "***")}`);
    await chmod(path, 0o600);
  }
  return { path, pass, alias };
}

export async function build(ctx: Ctx): Promise<void> {
  const out = join(ctx.store, "repo/android");
  const skipped: { name: string; reason: string }[] = [];
  const entries: IndexEntry[] = [];
  const signedApks: { owner: string; path: string }[] = [];
  if (!(await Bun.file(bt("apksigner")).exists())) for (const owner of APPS) skipped.push({ name: owner, reason: `Android SDK build-tools ${BUILD_TOOLS} missing at ${SDK}` });
  else {
    const ks = await keystore(join(ctx.secrets, "android"), "release", "bunos", "CN=Bun OS, O=Aphrody, C=FR");
    const work = join(ctx.store, ".android-staging");
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    for (const owner of APPS) {
      const built = await buildApp(ctx, owner);
      if (!built.apk) {
        skipped.push({ name: owner, reason: built.reason ?? "build failed" });
        continue;
      }
      const base = owner.split("/").pop()!;
      const aligned = join(work, `${base}-aligned.apk`);
      const signed = join(work, `${base}.apk`);
      const za = await run([bt("zipalign"), "-p", "-f", "4", built.apk, aligned], { env });
      const sg = za.code === 0 ? await run([bt("apksigner"), "sign", "--ks", ks.path, "--ks-key-alias", ks.alias, "--ks-pass", "env:KS_PASS", "--key-pass", "env:KS_PASS", "--out", signed, aligned], { env: { ...env, KS_PASS: ks.pass } }) : za;
      if (sg.code !== 0) skipped.push({ name: owner, reason: `signing failed: ${tail(sg.out, 2).replaceAll(ks.pass, "***")}` });
      else signedApks.push({ owner, path: signed });
    }
  }
  for (const owner of OWNERS.filter(o => !APPS.has(o)))
    skipped.push({ name: owner, reason: owner.startsWith("crates/") ? "native library linked into an APK, not an app" : "library or tooling owner of the Android build, not an installable app" });

  // F-Droid repository: the work tree holds config.yml and lives outside the served store.
  const fdroidWork = join(HOME, "apps/webos/fdroid");
  await mkdir(join(fdroidWork, "repo"), { recursive: true });
  for (const f of await readdir(join(fdroidWork, "repo")).catch(() => [] as string[])) if (f.endsWith(".apk")) await rm(join(fdroidWork, "repo", f));
  const apkNames: string[] = [];
  for (const a of signedApks) {
    const badging = await run([bt("aapt2"), "dump", "badging", a.path], { env });
    const m = /name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/.exec(badging.out);
    const id = m?.[1] ?? "com.aphrody.android.setup";
    const fileName = `${id}_${m?.[2] ?? "1"}.apk`;
    apkNames.push(fileName);
    await cp(a.path, join(fdroidWork, "repo", fileName));
    entries.push({
      name: id,
      version: m?.[3] ?? "unknown",
      desc: (/application-label:'([^']*)'/.exec(badging.out)?.[1] ?? "Bun Android") + ": " + DESC[a.owner],
      license: "Apache-2.0",
      size: Bun.file(a.path).size,
      sha256: await sha256(a.path),
      file: `/repo/android/${fileName}`,
      homepage: `https://github.com/aphrody-labs/bun-os/tree/main/${a.owner}`,
      member: a.owner,
      meta: { versionCode: Number(m?.[2] ?? 1), minSdk: /sdkVersion:'(\d+)'/.exec(badging.out)?.[1], targetSdk: /targetSdkVersion:'(\d+)'/.exec(badging.out)?.[1], display: /application-label:'([^']*)'/.exec(badging.out)?.[1], fdroid: `${ctx.origin}/repo/fdroid/repo` },
    });
  }
  if (signedApks.length) {
    const rks = await keystore(join(ctx.secrets, "fdroid"), "repo", "bunos-fdroid", "CN=Bun OS F-Droid, O=Aphrody, C=FR");
    const yml = [
      `repo_url: ${ctx.origin}/repo/fdroid/repo`,
      `repo_name: Bun OS`,
      `repo_description: Android apps of Bun OS, built from the aphrody-labs/bun-os repository on the Bun OS factory.`,
      `repo_icon: icon.png`,
      `archive_older: 0`,
      `sdk_path: ${SDK}`,
      `keystore: ${rks.path}`,
      `repo_keyalias: ${rks.alias}`,
      `keystorepass: {env: FDROID_KS_PASS}`,
      `keypass: {env: FDROID_KS_PASS}`,
      `keydname: CN=Bun OS F-Droid, O=Aphrody, C=FR`,
      `make_current_version_link: false`,
      ``,
    ].join("\n");
    await Bun.write(join(fdroidWork, "config.yml"), yml);
    await chmod(join(fdroidWork, "config.yml"), 0o600);
    // Repository icon: the app's launcher art rendered by the project is not a PNG; reuse the WebOS brand PNG.
    const icon = join(ctx.root, "apps/webos/public/og-image.png");
    await mkdir(join(fdroidWork, "repo/icons"), { recursive: true });
    if (await Bun.file(icon).exists()) await cp(icon, join(fdroidWork, "repo/icons/icon.png"));
    await mkdir(join(fdroidWork, "metadata"), { recursive: true });
    for (const e of entries)
      await Bun.write(
        join(fdroidWork, "metadata", `${e.name}.yml`),
        [`Categories:`, `  - System`, `License: Apache-2.0`, `AuthorName: Aphrody`, `WebSite: https://aphrody.com`, `SourceCode: ${e.homepage}`, `Name: ${String(e.meta?.display ?? "Bun Android")}`, `Summary: ${SUMMARY[String(e.member)] ?? "Bun OS app for Android"}`, `Description: |-`, `  ${e.desc}`, ``].join("\n"),
      );
    const fd = await run([FDROID, "update", "--create-metadata", "--pretty"], { cwd: fdroidWork, env: { ...env, FDROID_KS_PASS: rks.pass }, timeout: 900_000 });
    if (fd.code !== 0) skipped.push({ name: "fdroid", reason: `fdroid update failed: ${tail(fd.out, 4).replaceAll(rks.pass, "***")}` });
    else {
      const served = join(ctx.store, "repo/fdroid/repo");
      await rm(join(ctx.store, "repo/fdroid"), { recursive: true, force: true });
      await mkdir(served, { recursive: true });
      await cp(join(fdroidWork, "repo"), served, { recursive: true, dereference: true });
    }
  }
  // Plain catalog next to it.
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const n of apkNames) await cp(join(fdroidWork, "repo", n), join(out, n));
  await rm(join(ctx.store, ".android-staging"), { recursive: true, force: true });
  await Bun.write(join(out, "index.json"), JSON.stringify({ generated: new Date().toISOString(), fdroid: `${ctx.origin}/repo/fdroid/repo`, apps: entries, skipped }, null, 1));
  await run(["chmod", "-R", "a+rX", out, join(ctx.store, "repo/fdroid")]);
  await writeIndex(ctx, { format: "android", generated: new Date().toISOString(), url: "/repo/android/index.json", entries, skipped });
  console.log(`android: ${entries.length} APK, ${skipped.length} skipped`);
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const idx = (await Bun.file(join(ctx.store, "index/android.json")).json().catch(() => undefined)) as { entries: IndexEntry[] } | undefined;
  if (!idx?.entries.length) steps.push({ name: "APK catalog", ok: false, ms: 0, log: "No APK is published." });
  for (const e of idx?.entries ?? []) {
    const tmp = `/tmp/q-android-${e.sha256!.slice(0, 8)}.apk`;
    await step(steps, `download ${e.file} (sha256)`, async () => {
      const res = await fetch(ctx.origin + e.file!);
      if (!res.ok) return { code: 1, out: `HTTP ${res.status}` };
      const buf = new Uint8Array(await res.arrayBuffer());
      const hash = new Bun.CryptoHasher("sha256").update(buf).digest("hex");
      await Bun.write(tmp, buf);
      return hash === e.sha256 ? { code: 0, out: `${buf.length} bytes, sha256 ${hash}` } : { code: 1, out: "sha256 mismatch" };
    });
    await step(steps, "apksigner verify", () => run([bt("apksigner"), "verify", "--print-certs", tmp], { env }).then((r) => ({ code: r.code, out: r.out.split("\n").filter((l) => !/SHA-1|MD5/.test(l)).join("\n") })));
    await step(steps, "aapt2 dump badging", async () => {
      const r = await run([bt("aapt2"), "dump", "badging", tmp], { env });
      return { code: r.code === 0 && r.out.includes(`name='${e.name}'`) ? 0 : 1, out: r.out.split("\n").slice(0, 3).join("\n") };
    });
    await step(steps, "F-Droid index-v2 lists the APK", async () => {
      const res = await fetch(`${ctx.origin}/repo/fdroid/repo/index-v2.json`);
      if (!res.ok) return { code: 1, out: `HTTP ${res.status}` };
      const index = (await res.json()) as { packages?: Record<string, { versions?: Record<string, { file?: { sha256?: string } }> }> };
      const versions = Object.values(index.packages?.[e.name]?.versions ?? {});
      const listed = versions.some((v) => v.file?.sha256 === e.sha256);
      const jar = await fetch(`${ctx.origin}/repo/fdroid/repo/entry.jar`);
      return { code: listed && jar.ok ? 0 : 1, out: `${e.name}: ${versions.length} version(s) in index-v2, sha256 ${listed ? "matches" : "missing"}; entry.jar HTTP ${jar.status}` };
    });
    await rm(tmp, { force: true });
  }
  return { format: "android", ok: steps.length > 0 && steps.every((s) => s.ok), at: new Date().toISOString(), image: "host Android SDK build-tools", steps };
}
