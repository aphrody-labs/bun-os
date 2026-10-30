import { jobLimit } from "./plan.ts";

export type CargoAction = "check" | "build" | "test" | "clippy" | "fmt";

export interface TaskOptions {
  packages: string[];
  release?: boolean;
  jobs?: number;
  /** Extra arguments after `--`, passed to cargo (or to the test binary for test). */
  extra?: string[];
  cores?: number;
  freeBytes?: number;
}

/** Cargo argument list for a workspace task. Dependency order is cargo's own; `buncc plan` shows the layers. */
export function cargoArgs(action: CargoAction, options: TaskOptions): string[] {
  if (action === "fmt") {
    const args = ["fmt"];
    if (options.packages.length) for (const name of options.packages) args.push("-p", name);
    else args.push("--all");
    args.push("--", "--check");
    return args;
  }
  const args: string[] = [action, "--locked"];
  if (options.packages.length) for (const name of options.packages) args.push("-p", name);
  else args.push("--workspace");
  if (action === "clippy") args.push("--all-targets");
  if (options.release && (action === "build" || action === "test")) args.push("--release");
  args.push("-j", String(jobLimit(options.cores, options.freeBytes, undefined, options.jobs)));
  if (options.extra?.length) args.push("--", ...options.extra);
  return args;
}
