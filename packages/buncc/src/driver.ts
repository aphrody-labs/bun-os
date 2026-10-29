import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectDialect, translate, type Dialect, type Translation } from "./flags.ts";
import { overlayEnv, sanitizeEnv, type Env } from "./env.ts";
import { run } from "./process.ts";
import { captureVcvars, findVisualStudio } from "./providers/msvc.ts";
import { findBinary } from "./providers/tools.ts";
import { decideWrapper, sccacheProbe } from "./sccache.ts";

export type DriverKind = "cc" | "c++" | "ar" | "link";

export interface Choice {
  /** Executable name looked up on PATH (after the MSVC environment is applied when needsVcvars). */
  name: string;
  dialect: Dialect;
  needsVcvars: boolean;
}

export interface ChooseInput {
  kind: DriverKind;
  platform: "win32" | "linux" | "darwin";
  /** Rust/cc-rs style target triple, when known. */
  target?: string;
  /** Explicit override: cl, clang-cl, clang, gcc. */
  preference?: string;
  /** Whether the tool can be found. For cl, lib and link this means "a Visual Studio with the C++ toolset exists". */
  has: (name: string) => boolean;
}

const WINDOWS_COMPILERS = {
  cc: { msvc: ["cl", "clang-cl", "clang"], gnu: ["clang", "gcc"] },
  "c++": { msvc: ["cl", "clang-cl", "clang++"], gnu: ["clang++", "g++"] },
} as const;

/** Pick the compiler, archiver or linker. Pure: all environment knowledge arrives through `has`. */
export function chooseTool(input: ChooseInput): Choice | null {
  const { kind, platform, target = "", has, preference } = input;
  const msvcTarget = platform === "win32" && !/-(gnu|gnullvm|mingw)/.test(target);
  const make = (name: string): Choice => {
    const msvcFamily = name === "cl" || name === "clang-cl" || name === "lib" || name === "link" || name === "lld-link";
    return {
      name,
      dialect: msvcFamily ? "msvc" : "gnu",
      needsVcvars: name === "cl" || name === "lib" || name === "link",
    };
  };
  const first = (names: readonly string[]): Choice | null => {
    for (const name of names) if (has(name)) return make(name);
    return null;
  };
  if (preference) {
    const mapped =
      kind === "c++" && preference === "clang"
        ? "clang++"
        : kind === "c++" && preference === "gcc"
          ? "g++"
          : preference;
    if (has(mapped)) return make(mapped);
  }
  if (kind === "ar") {
    if (msvcTarget) return first(["lib", "llvm-lib", "llvm-ar"]);
    return first(platform === "win32" ? ["llvm-ar", "ar"] : ["ar", "llvm-ar"]);
  }
  if (kind === "link") {
    if (msvcTarget) return first(["link", "lld-link"]);
    return first(["clang", "gcc"]);
  }
  if (platform === "win32") return first(WINDOWS_COMPILERS[kind][msvcTarget ? "msvc" : "gnu"]);
  return first(kind === "cc" ? ["clang", "gcc", "cc"] : ["clang++", "g++", "c++"]);
}

/** `ar rcs libx.a a.o b.o` to `lib /OUT:libx.lib a.o b.o`. Unknown operations are ignored with the archive still named. */
export function arToLib(argv: string[]): string[] {
  const rest = argv.filter(arg => arg !== "--plugin");
  const operation = rest[0] && !rest[0].startsWith("-") && /^[a-zA-Z]+$/.test(rest[0]) ? rest.shift() : undefined;
  void operation;
  const archive = rest.shift();
  return ["/nologo", `/OUT:${archive ?? "out.lib"}`, ...rest];
}

/** GNU-style link line to link.exe. */
export function gnuToLink(argv: string[]): string[] {
  const out: string[] = ["/nologo"];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-o") out.push(`/OUT:${argv[++i] ?? ""}`);
    else if (arg === "-shared") out.push("/DLL");
    else if (arg === "-L") out.push(`/LIBPATH:${argv[++i] ?? ""}`);
    else if (arg.startsWith("-L")) out.push(`/LIBPATH:${arg.slice(2)}`);
    else if (arg.startsWith("-l")) out.push(`${arg.slice(2)}.lib`);
    else out.push(arg);
  }
  return out;
}

const SOURCE = /\.(c|cc|cpp|cxx|c\+\+|m|mm)$/i;

export interface CompileCommand {
  directory: string;
  arguments: string[];
  file: string;
}

/** compile_commands.json entries for the translated command line. */
export function compileCommands(directory: string, program: string, args: string[]): CompileCommand[] {
  const compiling = args.some(arg => arg === "-c" || arg === "/c");
  if (!compiling) return [];
  return args
    .filter(arg => SOURCE.test(arg) && !arg.startsWith("-") && !/^\/(Fo|Fe|Tc|Tp)/.test(arg))
    .map(file => ({ directory, arguments: [program, ...args], file }));
}

/** Merge the JSONL log written by the driver into a deduplicated compile_commands.json (latest entry wins). */
export function mergeCompileLog(log: string): CompileCommand[] {
  const map = new Map<string, CompileCommand>();
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as CompileCommand;
      map.set(`${entry.directory}\0${resolve(entry.directory, entry.file)}`.toLowerCase(), entry);
    } catch {}
  }
  return [...map.values()];
}

export function writeCompileDatabase(logPath: string, outPath: string): number {
  const entries = existsSync(logPath) ? mergeCompileLog(readFileSync(logPath, "utf8")) : [];
  writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n");
  return entries.length;
}

export interface DriverResult {
  code: number;
  choice: Choice;
  translation?: Translation;
  argv: string[];
}

export async function hasTool(name: string, platform: ChooseInput["platform"], env: Env): Promise<boolean> {
  if (name === "cl" || name === "lib" || name === "link")
    return platform === "win32" && !!(await findVisualStudio(env));
  return !!findBinary(
    { bins: [name], dirs: platform === "win32" ? ["C:\\Program Files\\LLVM\\bin", "C:\\msys64\\ucrt64\\bin"] : [] },
    platform,
  );
}

/** Run `buncc cc|c++|ar|link ...`: choose the tool, translate flags, enter the MSVC environment, use sccache when healthy. */
export async function runDriver(kind: DriverKind, argv: string[], base: Env = Bun.env): Promise<DriverResult> {
  const platform = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
  const availability = new Map<string, boolean>();
  const names = [
    "cl",
    "lib",
    "link",
    "clang-cl",
    "llvm-lib",
    "lld-link",
    "clang",
    "clang++",
    "gcc",
    "g++",
    "cc",
    "c++",
    "ar",
    "llvm-ar",
  ];
  for (const name of names) availability.set(name, await hasTool(name, platform, base));
  const target = base.TARGET ?? base.CARGO_BUILD_TARGET ?? "";
  const choice = chooseTool({
    kind,
    platform,
    target,
    preference: base.BUNCC_COMPILER,
    has: name => availability.get(name) === true,
  });
  if (!choice) throw new Error(`buncc ${kind}: no suitable tool found. Run \`buncc doctor\`.`);

  let env: Env = sanitizeEnv(base).env;
  if (choice.needsVcvars) {
    const instance = await findVisualStudio(base);
    if (!instance) throw new Error("Visual Studio C++ toolset not found. Run `buncc install msvc`.");
    const arch = /aarch64|arm64/.test(target) ? "arm64" : "x64";
    env = overlayEnv(env, (await captureVcvars(instance, { arch }, base)).env);
  }

  let args: string[];
  let translation: Translation | undefined;
  const from = detectDialect(kind === "ar" || kind === "link" ? "" : choice.name === "cl" ? "" : "cc", argv);
  if (kind === "ar" && choice.dialect === "msvc") args = arToLib(argv);
  else if (kind === "link" && choice.dialect === "msvc") args = from === "gnu" ? gnuToLink(argv) : argv;
  else {
    translation = translate(argv, from, choice.dialect);
    args = translation.args;
  }
  if (choice.name === "cl" && kind !== "link") args = ["/nologo", ...args];

  const resolved =
    Bun.which(choice.name, { PATH: env.PATH ?? env.Path ?? "" } as never) ?? Bun.which(choice.name) ?? choice.name;
  let command = [resolved, ...args];
  const compiling = (kind === "cc" || kind === "c++") && args.some(arg => arg === "-c" || arg === "/c");
  if (compiling && base.BUNCC_SCCACHE !== "off") {
    const wrapper = decideWrapper(await sccacheProbe(env), base.BUNCC_SCCACHE).wrapper;
    if (wrapper) command = [wrapper, ...command];
  }
  const log = base.BUNCC_COMPILE_COMMANDS;
  if (log && compiling) {
    for (const entry of compileCommands(process.cwd(), resolved, args))
      appendFileSync(log, JSON.stringify(entry) + "\n");
  }
  const result = await run(command, { env, output: "inherit", stdin: "inherit" });
  return { code: result.code, choice, translation, argv: command };
}
