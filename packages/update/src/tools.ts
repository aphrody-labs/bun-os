// SPDX-License-Identifier: Apache-2.0
/**
 * Toolchain module: installed vs pinned vs latest for bun, uv, rust and nushell,
 * and installation of an exact version. Pins are rewritten through ./pins.ts.
 */
import { Ctx } from "./context.ts";
import { apply as applyPin, check as checkPins, load } from "./pins.ts";
import { cmpVersion, registries } from "./deps/sync.ts";

export type ToolRow = {
  tool: string;
  pinned?: string;
  installed?: string;
  latest?: string;
};

const VERSION = /\d+\.\d+\.\d+/;
/** Upstream installer of stable Bun releases: `install` (POSIX shell) or `install.ps1` (Windows). */
export const BUN_INSTALLER = "https://bun.com/install";

export function installed(c: Ctx, tool: string): string | undefined {
  const cmds: Record<string, [string, string[]]> = {
    bun: ["bun", ["--version"]],
    uv: ["uv", ["--version"]],
    rust: ["rustc", ["--version"]],
    nushell: ["nu", ["--version"]],
  };
  const spec = cmds[tool];
  if (!spec) return undefined;
  const r = c.run(spec[0], spec[1]);
  return r.status === 0 ? VERSION.exec(r.stdout)?.[0] : undefined;
}

export async function latest(
  tool: string,
  src: {
    github?: string;
    pypi?: string;
    npm?: string;
    crate?: string;
    stripTag?: string;
  },
): Promise<string | undefined> {
  if (src.npm) return registries.npm(src.npm).catch(() => undefined);
  if (src.crate) return registries.crate(src.crate).catch(() => undefined);
  // PyPI is what `uv self update` serves; the GitHub tag can precede it.
  if (src.pypi) {
    const v = await registries.pypi(src.pypi).catch(() => undefined);
    if (v) return v;
  }
  if (src.github) {
    const rel = await registries.github(src.github).catch(() => []);
    const re = new RegExp(src.stripTag ?? "^v", "g");
    return rel
      .map(r => r.tag.replace(re, ""))
      .filter(t => /^\d+\.\d+\.\d+$/.test(t))
      .toSorted(cmpVersion)
      .at(-1);
  }
  return undefined;
}

export async function plan(c: Ctx): Promise<ToolRow[]> {
  const pins = new Map(checkPins(c).map(r => [r.tool, r.pin]));
  const rows: ToolRow[] = [];
  for (const [tool, def] of Object.entries(load(c).tools)) {
    rows.push({
      tool,
      pinned: pins.get(tool),
      installed: installed(c, tool),
      // oxlint-disable-next-line no-await-in-loop -- tool latest-version lookups run one by one: upstream registries rate-limit and the rows keep tool order
      latest: await latest(tool, def.latest),
    });
  }
  return rows;
}

/** Install exactly `version` for tools the host manages; returns false when only the pin can change. */
export function install(c: Ctx, tool: string, version: string): boolean {
  const run = (cmd: string, args: string[]) => c.run(cmd, args, { inherit: true }).status === 0;
  switch (tool) {
    case "uv":
      return run("uv", ["self", "update", version]);
    case "bun":
      return process.platform === "win32"
        ? run("pwsh", [
            "-NoProfile",
            "-Command",
            `& ([scriptblock]::Create((irm ${BUN_INSTALLER}.ps1))) -Version ${version}`,
          ])
        : run("bash", ["-c", `curl -fsSL ${BUN_INSTALLER} | bash -s bun-v${version}`]);
    case "rust":
      return run("rustup", ["toolchain", "install", version, "--profile", "minimal"]);
    case "nushell":
      return run("cargo", ["binstall", "-y", `nu@${version}`]);
    default:
      return false; // Unsupported tools have no qualified installer.
  }
}

export async function runTools(c: Ctx, args: string[]): Promise<number> {
  const only = args.filter(a => !a.startsWith("-"))[1];
  const rows = (await plan(c)).filter(r => !only || r.tool === only);
  let stale = 0;
  for (const r of rows) {
    const behind = r.latest && r.pinned && cmpVersion(r.pinned, r.latest) < 0;
    const lag = r.installed && r.pinned && r.installed !== r.pinned;
    console.log(
      `tool   ${r.tool.padEnd(10)} pinned ${r.pinned ?? "?"}  installed ${r.installed ?? "-"}  latest ${r.latest ?? "?"}${behind ? "  <- behind" : ""}${lag ? "  <- installed differs from pin" : ""}`,
    );
    if (!c.apply || !r.latest || !behind) continue;
    if (!install(c, r.tool, r.latest)) {
      console.error(`warn   could not install ${r.tool} ${r.latest}; pin left at ${r.pinned}`);
      continue;
    }
    // The installer channel can lag the tag: pin what is actually present when the tool is host-installed.
    const have = installed(c, r.tool);
    const target = r.tool === "uv" || r.tool === "bun" ? (have ?? r.latest) : r.latest;
    for (const f of applyPin(c, r.tool, target)) console.log(`pin    ${r.tool} ${target} -> ${f}`);
    stale++;
  }
  if (c.apply && stale) c.run("bun", ["install"], { inherit: true });
  return 0;
}
