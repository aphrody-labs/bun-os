// SPDX-License-Identifier: MIT
// Gradle/AGP driver for Bun OS Android projects: runs the wrapper with Bun.spawn under the shared factory toolchain
// (factory/android/jvm.json, factory/android/android.env) and parses its plain-console output into a typed report:
// task outcomes (executed, FROM-CACHE, UP-TO-DATE, SKIPPED, NO-SOURCE), Kotlin/Java diagnostics, the BUILD verdict,
// the actionable-task summary and the produced artifacts.
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type TaskOutcome = "EXECUTED" | "FROM-CACHE" | "UP-TO-DATE" | "SKIPPED" | "NO-SOURCE" | "FAILED";

export interface GradleTask {
  path: string;
  outcome: TaskOutcome;
}

export interface GradleDiagnostic {
  severity: "error" | "warning";
  file?: string;
  line?: number;
  column?: number;
  message: string;
}

export interface GradleSummary {
  actionable: number;
  executed: number;
  fromCache: number;
  upToDate: number;
}

export interface GradleReport {
  ok: boolean;
  code: number;
  durationMs: number;
  /** "BUILD SUCCESSFUL in 41s" duration as Gradle printed it. */
  gradleDuration?: string;
  tasks: GradleTask[];
  summary?: GradleSummary;
  diagnostics: GradleDiagnostic[];
  /** "What went wrong" block of a failed build. */
  failure?: string;
  configurationCache?: "reused" | "stored" | "miss";
  artifacts: string[];
  output: string;
}

const TASK = /^> Task (\S+)(?: (FROM-CACHE|UP-TO-DATE|SKIPPED|NO-SOURCE|FAILED))?\s*$/;
const KOTLIN_DIAG = /^([ew]): (?:file:\/\/)?(\/[^:]+):(\d+):(\d+) (.*)$/;
const JAVA_DIAG = /^(\/\S+\.java):(\d+): (error|warning): (.*)$/;
const SUMMARY = /^(\d+) actionable tasks?: (.*)$/;

/** Parse Gradle `--console=plain` output. Pure. */
export function parseGradleOutput(output: string, code = 0): Omit<GradleReport, "durationMs" | "artifacts"> {
  const tasks: GradleTask[] = [];
  const diagnostics: GradleDiagnostic[] = [];
  let summary: GradleSummary | undefined;
  let gradleDuration: string | undefined;
  let configurationCache: GradleReport["configurationCache"];
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    let m = TASK.exec(line);
    if (m) {
      tasks.push({ path: m[1]!, outcome: (m[2] as TaskOutcome | undefined) ?? "EXECUTED" });
      continue;
    }
    if ((m = KOTLIN_DIAG.exec(line))) {
      diagnostics.push({
        severity: m[1] === "e" ? "error" : "warning",
        file: m[2],
        line: Number(m[3]),
        column: Number(m[4]),
        message: m[5]!,
      });
      continue;
    }
    if ((m = JAVA_DIAG.exec(line))) {
      diagnostics.push({ severity: m[3] as "error" | "warning", file: m[1], line: Number(m[2]), message: m[4]! });
      continue;
    }
    if ((m = SUMMARY.exec(line))) {
      const parts = Object.fromEntries(
        m[2]!.split(",").map(part => {
          const [n, ...words] = part.trim().split(" ");
          return [words.join(" "), Number(n)];
        }),
      );
      summary = {
        actionable: Number(m[1]),
        executed: parts["executed"] ?? 0,
        fromCache: parts["from cache"] ?? 0,
        upToDate: parts["up-to-date"] ?? 0,
      };
      continue;
    }
    if ((m = /^BUILD (?:SUCCESSFUL|FAILED) in (.+)$/.exec(line))) gradleDuration = m[1];
    if (line.startsWith("Reusing configuration cache.")) configurationCache = "reused";
    else if (line.startsWith("Configuration cache entry stored.")) configurationCache = "stored";
    else if (/^Calculating task graph as (?:no cached configuration|configuration cache cannot be reused)/.test(line))
      configurationCache ??= "miss";
  }
  const wrong = /\* What went wrong:\n([\s\S]*?)(?:\n\* Try:|\n\* Exception is:|$)/.exec(
    output.replaceAll("\r\n", "\n"),
  );
  const ok = code === 0 && /BUILD SUCCESSFUL/.test(output);
  return {
    ok,
    code,
    gradleDuration,
    tasks,
    summary,
    diagnostics,
    failure: wrong?.[1]?.trim(),
    configurationCache,
    output,
  };
}

/** Shared factory environment for Gradle: JDK 21, the shared Gradle user home and the shared SDK. */
export function gradleEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const home = homedir();
  const javaHome =
    process.env.BUNOS_GRADLE_JAVA_HOME ?? firstDir([process.env.JAVA_HOME, "/usr/lib/jvm/java-21-openjdk-amd64"]);
  const sdk = firstDir([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    "/opt/android-sdk",
    join(home, "android-sdk"),
    join(home, "Android", "Sdk"),
  ]);
  return {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? join(home, ".cache", "bunos-android", "gradle"),
    ...extra,
  };
}

function firstDir(candidates: (string | undefined)[]): string | undefined {
  return candidates.find((c): c is string => !!c && existsSync(c));
}

/** Files produced under `<project>/<module>/build/outputs` with a given extension, newest first. */
export function outputs(project: string, extension: ".apk" | ".aab" | ".html" | ".xml", module = "app"): string[] {
  const root = join(project, module, "build", "outputs");
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(extension)) found.push(path);
    }
  };
  walk(root);
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

export interface GradleRunOptions {
  project: string;
  tasks: string[];
  args?: string[];
  env?: Record<string, string | undefined>;
  /** Stream Gradle output to the terminal while capturing it. */
  echo?: boolean;
  timeoutMs?: number;
}

/** Run the project's Gradle wrapper and return the parsed report. Never throws on a failed build. */
export async function gradle(options: GradleRunOptions): Promise<GradleReport> {
  const project = resolve(options.project);
  const wrapper = join(project, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (!existsSync(wrapper)) throw new Error(`${project} has no Gradle wrapper`);
  const started = performance.now();
  const child = Bun.spawn([wrapper, ...options.tasks, "--console=plain", ...(options.args ?? [])], {
    cwd: project,
    env: gradleEnv(options.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeoutMs ?? 3_600_000,
  });
  const chunks: string[] = [];
  const pump = async (stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true });
      chunks.push(text);
      if (options.echo) sink.write(text);
    }
  };
  await Promise.all([pump(child.stdout, process.stdout), pump(child.stderr, process.stderr)]);
  const code = await child.exited;
  const parsed = parseGradleOutput(chunks.join(""), code);
  const wantsBundle = options.tasks.some(t => /bundle/i.test(t));
  return {
    ...parsed,
    durationMs: Math.round(performance.now() - started),
    artifacts: [...outputs(project, ".apk"), ...(wantsBundle ? outputs(project, ".aab") : [])],
  };
}

const variantTask = (verb: string, variant: string, module = "app") =>
  `:${module}:${verb}${variant[0]!.toUpperCase()}${variant.slice(1)}`;

export const assemble = (project: string, variant = "debug", extra: Partial<GradleRunOptions> = {}) =>
  gradle({ project, tasks: [variantTask("assemble", variant)], ...extra });
export const bundle = (project: string, variant = "release", extra: Partial<GradleRunOptions> = {}) =>
  gradle({ project, tasks: [variantTask("bundle", variant)], ...extra });
export const lint = (project: string, variant = "debug", extra: Partial<GradleRunOptions> = {}) =>
  gradle({ project, tasks: [variantTask("lint", variant)], ...extra });

/** One-line human summary of a report. */
export function describe(report: GradleReport): string {
  const s = report.summary;
  const cache = s
    ? `${s.actionable} actionable: ${s.executed} executed, ${s.fromCache} from cache, ${s.upToDate} up-to-date`
    : "no task summary";
  const errors = report.diagnostics.filter(d => d.severity === "error").length;
  const warnings = report.diagnostics.length - errors;
  return `${report.ok ? "BUILD SUCCESSFUL" : "BUILD FAILED"} in ${report.gradleDuration ?? `${report.durationMs} ms`}; ${cache}; configuration cache ${report.configurationCache ?? "n/a"}; ${errors} errors, ${warnings} warnings${report.failure ? `\n${report.failure}` : ""}`;
}
