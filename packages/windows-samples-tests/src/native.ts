/** Native build helpers: MSVC environment (entered through buncc) and cargo, both run without touching global state. */
import { captureVcvars, findVisualStudio } from "@aphrody/buncc/msvc";

let cached: Record<string, string> | undefined;

/** The x64 developer environment, entered by buncc (the one vswhere/vcvarsall implementation) and merged over the process environment. */
export async function msvcEnv(): Promise<Record<string, string>> {
  if (cached) return cached;
  const studio = await findVisualStudio();
  if (!studio) throw new Error("MSVC (VS Build Tools) not found");
  const { env } = await captureVcvars(studio, { arch: "x64" });
  return (cached = { ...(process.env as Record<string, string>), ...env });
}

export interface Exec {
  code: number;
  out: string;
}

export async function exec(
  argv: string[],
  cwd: string,
  env?: Record<string, string>,
  timeoutMs = 600_000,
): Promise<Exec> {
  const proc = Bun.spawn(argv, {
    cwd,
    env: env ?? (process.env as Record<string, string>),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [o, e, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);
  return { code, out: o + e };
}

/** cl.exe in the MSVC environment; `args` are cl arguments (sources, /Fe, /link ...). */
export async function cl(cwd: string, args: string[]) {
  return exec(["cl.exe", "/nologo", "/EHsc", "/std:c++20", "/O2", "/utf-8", ...args], cwd, await msvcEnv());
}

export const NIGHTLY = Bun.env.BUNOS_RUST_TOOLCHAIN ?? "nightly-2026-09-15";
export const cargo = (cwd: string, args: string[]) =>
  exec(["cargo", `+${NIGHTLY}`, ...args], cwd, undefined, 1_200_000);
