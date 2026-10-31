#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Bun -> JVM qualification: compile the Kotlin probe (apps/java-ffi/src/jvm) with kotlinc, start a JVM from libjvm through
// the bun:ffi JNI bridge (crates/android-native --features invocation), call Java and Kotlin statics, print a JSON report.
//   scripts/aphrody/build/rust/cargo-serial.sh build -p android-native --features invocation --release
//   bun packages/bun-android/scripts/jvm-probe.ts
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Jvm, defaultBridgePath, defaultLibjvm } from "../src/jvm.ts";

const root = resolve(import.meta.dir, "..", "..", "..");
const source = join(root, "apps/java-ffi/src/jvm/kotlin/com/aphrody/bunos/jvm/BunOsJvm.kt");
const jar = join(root, "target/jvm/bunos-jvm.jar");
const kotlinc =
  Bun.env.KOTLINC ??
  (existsSync("/opt/android-tools/kotlinc/bin/kotlinc") ? "/opt/android-tools/kotlinc/bin/kotlinc" : "kotlinc");

if (!existsSync(jar) || Bun.file(jar).lastModified < Bun.file(source).lastModified) {
  mkdirSync(join(root, "target/jvm"), { recursive: true });
  const proc = Bun.spawn([kotlinc, source, "-include-runtime", "-d", jar], {
    env: { ...process.env, JAVA_HOME: Bun.env.JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk-amd64" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error("kotlinc failed");
}

const started = performance.now();
const jvm = Jvm.open().start({ classPath: [jar], options: ["-Xmx256m", "-Xshare:auto"] });
const startMs = Math.round(performance.now() - started);
const t = performance.now();
const result = {
  bridge: defaultBridgePath(),
  libjvm: defaultLibjvm(),
  startMs,
  javaVersion: jvm.callStaticString("java.lang.System", "getProperty", "java.version"),
  vmName: jvm.callStaticString("java.lang.System", "getProperty", "java.vm.name"),
  mathAddExact: jvm.callStaticInt("java.lang.Math", "addExact", 20, 22),
  nanoTime: String(jvm.callStaticLong("java.lang.System", "nanoTime")),
  kotlinGreet: jvm.callStaticString("com.aphrody.bunos.jvm.BunOsJvm", "greet", `Bun ${Bun.version}`),
  kotlinAdd: jvm.callStaticInt("com.aphrody.bunos.jvm.BunOsJvm", "add", 40, 2),
  kotlinAnalyze: jvm.callStaticString(
    "com.aphrody.bunos.jvm.BunOsJvm",
    "analyze",
    "native Android M3 at the core of Bun OS",
  ),
  overflowError: (() => {
    try {
      jvm.callStaticInt("com.aphrody.bunos.jvm.BunOsJvm", "add", 2147483647, 1);
      return "no error";
    } catch (error) {
      return (error as Error).message;
    }
  })(),
  callsMs: Math.round((performance.now() - t) * 100) / 100,
};
console.log(JSON.stringify(result, null, 2));
if (result.mathAddExact !== 42 || result.kotlinAdd !== 42 || !result.kotlinGreet.startsWith("Hello Bun"))
  process.exit(1);
