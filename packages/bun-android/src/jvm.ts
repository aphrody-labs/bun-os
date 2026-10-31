// SPDX-License-Identifier: MIT
// Bun -> JVM through bun:ffi. The Rust core (crates/android-native, `invocation` feature) wraps the JNI invocation API
// (JNI_CreateJavaVM from libjvm) in a C ABI; this module loads it with dlopen and exposes a typed API. One JVM per
// process: start() is idempotent, a JVM cannot be restarted once created.
//
//   const jvm = Jvm.open();                       // target/release/libandroid_native.so, or BUNOS_JVM_BRIDGE
//   jvm.start({ classPath: ["target/jvm/bunos-jvm.jar"] });
//   jvm.callStaticString("java.lang.System", "getProperty", "java.version");
//   jvm.callStaticInt("java.lang.Math", "addExact", 20, 22);
import { CString, dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const symbols = {
  bunos_jvm_start: { args: [FFIType.cstring, FFIType.cstring], returns: FFIType.i32 },
  bunos_jvm_started: { args: [], returns: FFIType.i32 },
  bunos_jvm_call_static_string: { args: [FFIType.cstring, FFIType.cstring, FFIType.cstring], returns: FFIType.ptr },
  bunos_jvm_call_static_int2: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.i32, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  bunos_jvm_call_static_long: { args: [FFIType.cstring, FFIType.cstring, FFIType.ptr], returns: FFIType.i32 },
  bunos_jvm_last_error: { args: [], returns: FFIType.ptr },
  bunos_jvm_free: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

type Library = ReturnType<typeof dlopen<typeof symbols>>["symbols"];

export interface JvmStartOptions {
  /** Class path entries (jars or directories). */
  classPath?: string[];
  /** Extra JVM options, one per entry (`-Xmx256m`, `-Dkey=value`). */
  options?: string[];
  /** Path of libjvm.so; defaults to `$BUNOS_JVM_HOME|$JAVA_HOME/lib/server/libjvm.so`, then the LTS JDK. */
  libjvm?: string;
}

const encoder = new TextEncoder();
const cstr = (text: string) => ptr(encoder.encode(`${text}\0`));

/** Default bridge library: the host build of crates/android-native. */
export function defaultBridgePath(workspace = resolve(import.meta.dir, "..", "..", "..")): string {
  const name =
    process.platform === "win32"
      ? "android_native.dll"
      : process.platform === "darwin"
        ? "libandroid_native.dylib"
        : "libandroid_native.so";
  // target/android-native: the dedicated target dir of the Gradle uniffi task and the bridge build (docs/ANDROID.md).
  return process.env.BUNOS_JVM_BRIDGE ?? join(workspace, "target", "android-native", "release", name);
}

/** libjvm of the factory's LTS JDK (factory/android/jvm.json), overridable through BUNOS_JVM_HOME / JAVA_HOME. */
export function defaultLibjvm(): string | undefined {
  const homes = [
    process.env.BUNOS_JVM_HOME,
    process.env.JAVA_HOME,
    "/usr/lib/jvm/java-25-openjdk-amd64",
    "/usr/lib/jvm/java-21-openjdk-amd64",
  ];
  for (const home of homes) {
    if (!home) continue;
    const lib = join(home, "lib", "server", process.platform === "win32" ? "jvm.dll" : "libjvm.so");
    if (existsSync(lib)) return lib;
  }
  return undefined;
}

export class Jvm {
  private constructor(private readonly lib: Library) {}

  static open(bridge = defaultBridgePath()): Jvm {
    if (!existsSync(bridge))
      throw new Error(
        `JVM bridge not built: ${bridge} (cargo-serial build -p android-native --features invocation --release)`,
      );
    return new Jvm(dlopen(bridge, symbols).symbols);
  }

  get started(): boolean {
    return this.lib.bunos_jvm_started() === 1;
  }

  private take(pointer: Pointer | null): string | null {
    if (!pointer) return null;
    try {
      return new CString(pointer).toString();
    } finally {
      this.lib.bunos_jvm_free(pointer);
    }
  }

  private error(what: string): Error {
    return new Error(`${what}: ${this.take(this.lib.bunos_jvm_last_error()) ?? "unknown JVM bridge error"}`);
  }

  start(options: JvmStartOptions = {}): this {
    const lines = [
      ...(options.classPath?.length ? [`-Djava.class.path=${options.classPath.map(p => resolve(p)).join(":")}`] : []),
      ...(options.options ?? []),
    ];
    const libjvm = options.libjvm ?? defaultLibjvm();
    const code = this.lib.bunos_jvm_start(libjvm ? cstr(libjvm) : null, cstr(lines.join("\n")));
    if (code !== 0) throw this.error("JVM start failed");
    return this;
  }

  /** `static String className.method(String)`. Class names accept dots or slashes. */
  callStaticString(className: string, method: string, input = ""): string {
    const result = this.lib.bunos_jvm_call_static_string(cstr(className), cstr(method), cstr(input));
    if (!result) throw this.error(`${className}.${method}(String)`);
    return this.take(result)!;
  }

  /** `static int className.method(int, int)`. */
  callStaticInt(className: string, method: string, left: number, right: number): number {
    const out = new Int32Array(1);
    if (this.lib.bunos_jvm_call_static_int2(cstr(className), cstr(method), left | 0, right | 0, ptr(out)) !== 0)
      throw this.error(`${className}.${method}(int, int)`);
    return out[0]!;
  }

  /** `static long className.method()`. */
  callStaticLong(className: string, method: string): bigint {
    const out = new BigInt64Array(1);
    if (this.lib.bunos_jvm_call_static_long(cstr(className), cstr(method), ptr(out)) !== 0)
      throw this.error(`${className}.${method}()`);
    return out[0]!;
  }
}
