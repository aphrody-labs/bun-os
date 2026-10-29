/**
 * Install the pinned upstream .NET SDK and PowerShell tarballs (MIT, no click-through) into one prefix:
 *   <prefix>/dotnet            DOTNET_ROOT, SDK 10 and SDK 11 side by side (the SDK tarballs include the runtimes)
 *   <prefix>/pwsh/<version>    PowerShell, with <prefix>/bin/pwsh (and pwsh-preview) symlinks
 * The existing dotnet provider (../providers/dotnet.ts) owns discovery, global.json and publish arguments; this file only
 * adds the pinned, checksum-verified install it does not have (it resolves the newest archive from live metadata).
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { download, extractArchive, toolsDir } from "../providers/_shared.ts";
import { loadPins, resolvePinned, type Pins, type WhatKey } from "./pins.ts";

export function defaultPrefix(env: Record<string, string | undefined> = Bun.env): string {
  return resolve(env.BUNOS_DOTNET_LINUX_PREFIX ?? join(env.HOME ?? homedir(), ".bunos", "dotnet-linux"));
}

export function layout(prefix: string, what: WhatKey, version: string) {
  const root = join(prefix, "dotnet");
  return what === "pwsh" || what === "pwsh-preview"
    ? { dir: join(prefix, "pwsh", version), marker: join(prefix, "pwsh", version, "pwsh"), link: join(prefix, "bin", what) }
    : { dir: root, marker: join(root, "sdk", version), link: join(prefix, "bin", "dotnet") };
}

function treeSize(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    total += name.isDirectory() ? treeSize(p) : name.isSymbolicLink() ? 0 : statSync(p).size;
  }
  return total;
}

export interface InstallReceipt {
  what: WhatKey;
  version: string;
  rid: string;
  url: string;
  hash: string;
  algorithm: string;
  dir: string;
  status: "installed" | "already-installed" | "dry-run";
  archiveBytes?: number;
  installedBytes?: number;
  downloadSeconds?: number;
  extractSeconds?: number;
}

export async function installPinned(options: {
  root: string;
  what: WhatKey;
  rid: string;
  prefix?: string;
  dryRun?: boolean;
  pins?: Pins;
  fetcher?: typeof fetch;
}): Promise<InstallReceipt> {
  const pins = options.pins ?? loadPins(options.root);
  const a = resolvePinned(pins, options.what, options.rid);
  const prefix = resolve(options.prefix ?? defaultPrefix());
  const where = layout(prefix, options.what, a.version);
  const base = { what: a.what, version: a.version, rid: a.rid, url: a.url, hash: a.hash, algorithm: a.algorithm, dir: where.dir };
  if (existsSync(where.marker)) return { ...base, status: "already-installed" };
  if (options.dryRun) return { ...base, status: "dry-run" };

  const t0 = performance.now();
  const bytes = await download(a.url, a.hash, a.algorithm, options.fetcher); // throws ChecksumError before anything is written
  const t1 = performance.now();
  const staging = toolsDir("dotnet-linux-downloads");
  mkdirSync(staging, { recursive: true });
  const file = join(staging, a.name);
  await Bun.write(file, bytes);
  try {
    mkdirSync(where.dir, { recursive: true });
    await extractArchive(file, where.dir);
  } finally {
    rmSync(file, { force: true });
  }
  if (!existsSync(where.marker)) throw new Error(`extracted ${a.name} has no ${where.marker}`);
  if (a.what === "pwsh" || a.what === "pwsh-preview") {
    chmodSync(join(where.dir, "pwsh"), 0o755); // upstream tarball keeps the mode, but be explicit for archives extracted by bsdtar on a mounted volume
    mkdirSync(join(prefix, "bin"), { recursive: true });
    rmSync(where.link, { force: true });
    symlinkSync(join("..", "pwsh", a.version, "pwsh"), where.link);
  } else {
    mkdirSync(join(prefix, "bin"), { recursive: true });
    rmSync(where.link, { force: true });
    symlinkSync(join("..", "dotnet", "dotnet"), where.link);
  }
  const t2 = performance.now();
  writeFileSync(join(where.dir, `.bunos-${a.what}.pin`), `${a.version}\n${a.algorithm}:${a.hash}\n${a.url}\n`);
  return {
    ...base,
    status: "installed",
    archiveBytes: bytes.length,
    installedBytes: treeSize(where.dir),
    downloadSeconds: Math.round((t1 - t0)) / 1000,
    extractSeconds: Math.round(t2 - t1) / 1000,
  };
}

/** Environment for building and running with the prefix. PowerShell opt-outs: about_Telemetry / POWERSHELL_UPDATECHECK. */
export function prefixEnv(prefix: string, base: Record<string, string | undefined> = Bun.env): Record<string, string> {
  const path = [join(prefix, "bin"), join(prefix, "dotnet"), base.PATH ?? ""].filter(Boolean).join(":");
  return {
    DOTNET_ROOT: join(prefix, "dotnet"),
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    DOTNET_MULTILEVEL_LOOKUP: "0",
    POWERSHELL_TELEMETRY_OPTOUT: "1",
    POWERSHELL_UPDATECHECK: "Off",
    PATH: path,
  };
}
