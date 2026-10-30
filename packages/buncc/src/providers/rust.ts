import { join } from "node:path";
import { run } from "../process.ts";
import type { Context, Detection, InstallPlan, Provider } from "./types.ts";

export interface RustToolchainFile {
  channel?: string;
  profile?: string;
  components?: string[];
  targets?: string[];
}

/** Parse rust-toolchain.toml with Bun's built-in TOML parser. */
export function parseToolchain(text: string): RustToolchainFile {
  const data = Bun.TOML.parse(text) as { toolchain?: RustToolchainFile };
  return data.toolchain ?? {};
}

export async function readToolchain(root: string): Promise<RustToolchainFile | null> {
  const file = Bun.file(join(root, "rust-toolchain.toml"));
  if (!(await file.exists())) return null;
  return parseToolchain(await file.text());
}

export const rust: Provider = {
  id: "rust",
  description: "Rust toolchain pinned by rust-toolchain.toml (nightly), installed with rustup",
  platforms: ["win32", "linux", "darwin"],
  async detect(ctx: Context): Promise<Detection> {
    const cargo = Bun.which("cargo");
    if (!cargo) return { found: false, fixHint: "buncc install rustup, then rustup toolchain install" };
    const toolchain = await readToolchain(ctx.root);
    const result = await run(["rustc", "--version"], { cwd: ctx.root, output: "capture", timeoutMs: 600_000 });
    if (result.code !== 0)
      return {
        found: false,
        path: cargo,
        notes: [result.stderr.trim().slice(0, 200)],
        fixHint: "rustup toolchain install",
      };
    const version = result.stdout.trim();
    const notes: string[] = [];
    if (toolchain?.channel) notes.push(`pinned channel ${toolchain.channel}`);
    return { found: true, path: cargo, version, notes };
  },
  install(): InstallPlan {
    return { commands: [["rustup", "toolchain", "install", "--profile", "minimal"]] };
  },
  async env() {
    return {};
  },
  async pin(ctx) {
    return (await readToolchain(ctx.root))?.channel;
  },
};
