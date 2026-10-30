// SPDX-License-Identifier: Apache-2.0
/**
 * Relay download through an SSH host: steamcmd runs on the VPS (datacenter bandwidth, one
 * validated install), then the result is pulled with parallel rclone/SFTP streams (or scp as a
 * fallback). Credentials are never passed; anonymous login only unless the host holds its own.
 */
import { mkdirSync } from "node:fs";

export interface RemoteDownloadOptions {
  appid: number;
  host: string;
  dest: string;
  streams?: number | undefined;
  bwlimit?: string | undefined;
  steamcmd?: string | undefined;
  /** Remote staging directory. */
  remoteDir?: string | undefined;
}

const SSH = ["ssh", "-o", "ConnectTimeout=15", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30"];

async function run(cmd: string[], timeoutMs: number) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const t = setTimeout(() => p.kill(), timeoutMs);
  try {
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { out, err, code };
  } finally {
    clearTimeout(t);
  }
}

export async function remoteDownload(o: RemoteDownloadOptions) {
  if (!Number.isInteger(o.appid) || !o.dest) throw new Error("remote-download <appid> --host <h> --dest <dir>");
  const streams = o.streams ?? 16;
  const remoteDir = o.remoteDir ?? `/var/tmp/steam/${o.appid}`;
  const steamcmd = o.steamcmd ?? "steamcmd";
  const t0 = performance.now();
  const install = await run(
    [
      ...SSH,
      o.host,
      `mkdir -p ${remoteDir} && timeout 7200 ${steamcmd} +force_install_dir ${remoteDir} +login anonymous +app_update ${o.appid} validate +quit`,
    ],
    7_300_000,
  );
  if (install.code !== 0)
    throw new Error(`steamcmd on ${o.host} failed (${install.code}): ${install.err.trim().slice(-400)}`);
  const remoteMs = performance.now() - t0;

  mkdirSync(o.dest, { recursive: true });
  const rclone = Bun.which("rclone");
  let tool: string;
  let pull: { code: number; err: string };
  if (rclone) {
    tool = "rclone";
    const args = [
      "copy",
      `:sftp:${remoteDir}`,
      o.dest,
      "--sftp-ssh",
      `ssh -o BatchMode=yes ${o.host}`,
      "--transfers",
      String(streams),
      "--multi-thread-streams",
      String(Math.min(streams, 8)),
      "--multi-thread-cutoff",
      "64M",
      "--checkers",
      String(streams * 2),
      "--fast-list",
      "--no-traverse",
    ];
    if (o.bwlimit) args.push("--bwlimit", o.bwlimit);
    pull = await run([rclone, ...args], 7_200_000);
  } else {
    tool = "scp";
    pull = await run(
      ["scp", "-r", "-o", "BatchMode=yes", "-o", "Compression=no", `${o.host}:${remoteDir}/.`, o.dest],
      7_200_000,
    );
  }
  if (pull.code !== 0) throw new Error(`${tool} pull failed (${pull.code}): ${pull.err.trim().slice(-400)}`);
  return {
    appid: o.appid,
    host: o.host,
    dest: o.dest,
    tool,
    streams,
    remoteSeconds: Math.round(remoteMs / 1000),
    totalSeconds: Math.round((performance.now() - t0) / 1000),
  };
}
