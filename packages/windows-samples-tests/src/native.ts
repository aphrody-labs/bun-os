/** Native build helpers: MSVC environment (vcvars64, found with vswhere) and cargo, both run without touching global state. */
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cached: Record<string, string> | undefined;

export async function msvcEnv(): Promise<Record<string, string>> {
  if (cached) return cached;
  const vswhere = "C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe";
  const p = Bun.spawn([vswhere, "-latest", "-products", "*", "-property", "installationPath"], { stdout: "pipe" });
  const install = (await p.stdout.text()).trim();
  const vcvars = join(install, "VC", "Auxiliary", "Build", "vcvars64.bat");
  if (!install || !existsSync(vcvars)) throw new Error("MSVC (VS Build Tools) not found");
  const bat = join(tmpdir(), "bunos-vcvars.bat");
  writeFileSync(
    bat,
    `@call "${vcvars}" >nul
@set
`,
  );
  const d = Bun.spawn(["cmd", "/c", bat], { stdout: "pipe" });
  const env: Record<string, string> = {};
  for (const line of (await d.stdout.text()).split(/\r?\n/)) {
    const k = line.indexOf("=");
    if (k > 0) env[line.slice(0, k)] = line.slice(k + 1);
  }
  return (cached = env);
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
