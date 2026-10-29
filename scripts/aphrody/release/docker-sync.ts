#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Keep the Aphrody images identical on the owner PC, the VPS and dbfr.
 *
 *   bun scripts/release/docker-sync.ts [--source vps] [--image aphrody:runtime]... [--dry-run]
 *
 * The source host owns the image (the VPS builds it). Every other host whose image creation date differs receives it
 * through `docker save | gzip | docker load` over SSH (or the local engine for the PC); images are never pushed
 * to a registry. Only the listed Aphrody images move.
 */
export const HOSTS = ["pc", "vps", "dbfr"] as const;
export type Host = (typeof HOSTS)[number];
export const DEFAULT_IMAGES = ["aphrody:runtime", "aphrody-build:latest"];

export type Plan = {
  host: Host;
  image: string;
  from: string;
  to: string | null;
}[];

export function parseArgs(argv: string[]) {
  const o = { source: "vps" as Host, images: [] as string[], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--source" && argv[i + 1]) o.source = argv[++i] as Host;
    else if (a === "--image" && argv[i + 1]) o.images.push(argv[++i]!);
    else throw new Error(`unknown or incomplete option: ${a}`);
  }
  if (!HOSTS.includes(o.source)) throw new Error(`unknown source host: ${o.source}`);
  if (o.images.length === 0) o.images = DEFAULT_IMAGES;
  return o;
}

/** Hosts (other than the source) whose image creation date differs, in a stable order. */
export function plan(source: Host, ids: Record<string, Record<string, string | null>>): Plan {
  const out: Plan = [];
  for (const image of Object.keys(ids[source] ?? {})) {
    const from = ids[source]?.[image];
    if (!from) continue;
    for (const host of HOSTS) {
      if (host !== source && ids[host]?.[image] !== from)
        out.push({ host, image, from, to: ids[host]?.[image] ?? null });
    }
  }
  return out;
}

const SAFE = /^[A-Za-z0-9_./:@-]+$/;

/** Shell command line that runs `cmd` on a host: the local engine for the PC, SSH otherwise. */
const onHost = (host: Host, cmd: string) => (host === "pc" ? cmd : `ssh ${host} "${cmd.replaceAll('"', '\\"')}"`);

function imageId(host: Host, image: string): string | null {
  if (!SAFE.test(image)) throw new Error(`invalid image: ${image}`);
  const r = Bun.spawnSync(["sh", "-c", onHost(host, `docker image inspect -f '{{.Created}}' ${image}`)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
}

/** `user@hostname` of a host as the local SSH configuration resolves it (reachable from the other servers). */
function sshTarget(host: Host): string {
  const out = Bun.spawnSync(["ssh", "-G", host], {
    stdout: "pipe",
  }).stdout.toString();
  const get = (k: string) =>
    out
      .split("\n")
      .find(l => l.startsWith(`${k} `))
      ?.slice(k.length + 1)
      .trim();
  const target = `${get("user")}@${get("hostname")}`;
  if (!SAFE.test(target)) throw new Error(`invalid ssh target for ${host}: ${target}`);
  return target;
}

function ship(source: Host, host: Host, image: string): void {
  // Server to server the stream goes directly (no hop through the PC); otherwise through the local engine/SSH.
  const direct = source !== "pc" && host !== "pc";
  const line = direct
    ? onHost(source, `docker save ${image} | gzip -1 | ssh -o BatchMode=yes ${sshTarget(host)} 'gunzip | docker load'`)
    : `${onHost(source, `docker save ${image} | gzip -1`)} | ${onHost(host, "gunzip | docker load")}`;
  const r = Bun.spawnSync(["sh", "-c", line], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (r.exitCode !== 0) throw new Error(`sync ${image} ${source} -> ${host} failed`);
}

if (import.meta.main) {
  const { source, images, dryRun } = parseArgs(Bun.argv.slice(2));
  const ids: Record<string, Record<string, string | null>> = {};
  for (const h of HOSTS) ids[h] = Object.fromEntries(images.map(i => [i, imageId(h, i)]));
  const todo = plan(source, ids);
  for (const t of todo) {
    console.log(`${t.image}: ${source} -> ${t.host}${dryRun ? " (dry run)" : ""}`);
    if (!dryRun) ship(source, t.host, t.image);
  }
  if (todo.length === 0) console.log("images identical on pc, vps and dbfr");
}
