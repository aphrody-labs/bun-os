#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Removes from a host the copies of services that Docker now runs, as declared by `purge` in
// infra/config/host/<host>/runtime.json: verified tar.gz backups in <archive>/host-purge-<date>/ first, then systemd
// units, apt packages (+ autoremove), paths, stray binaries, unused empty Docker images/volumes, then `post`.
// Idempotent; prints the plan without --apply. Runs ON the host as root:
//   sudo bun scripts/tools/infra/host-purge.ts --host vps|dbfr [--apply]
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOSTS = ["vps", "dbfr"] as const;
const SYSTEMD = "/etc/systemd/system";
const EMPTY_VOLUME_KB = 8;

type Purge = {
  backup: string[];
  units: string[];
  packages: string[];
  paths: string[];
  bin: Record<string, string[]>;
  dockerImages: string[];
  dockerVolumes: string[];
  post: string[];
};
type Runtime = {
  host: string;
  user: string;
  archive: string;
  docker: { containers: Record<string, string> };
  native: { units: Record<string, string> };
  purge: Purge;
};

function run(cmd: string[], env: Record<string, string> = {}) {
  const p = Bun.spawnSync(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  return {
    ok: p.exitCode === 0,
    out: p.stdout.toString().trim(),
    err: p.stderr.toString().trim(),
  };
}

function lexists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Dangling symlink, editor backup (`name~`) or a dated previous binary (`name.prev-YYYYMMDD`). */
export function isStrayBin(dir: string, name: string): boolean {
  if (name.endsWith("~") || /\.prev-\d+$/.test(name)) return true;
  const path = join(dir, name);
  return lstatSync(path).isSymbolicLink() && !existsSync(path);
}

/** Archive name of a backed-up path: /etc/nginx -> etc_nginx.tar.gz. */
export function archiveName(path: string): string {
  return `${path.replace(/^\/+/, "").replaceAll("/", "_")}.tar.gz`;
}

/** Declared unit names (keys are space-separated lists, `user: ` marks user units, `@.` templates match instances). */
export function declaredUnit(declared: Record<string, string>, unit: string): boolean {
  const names = new Set(Object.keys(declared).flatMap(k => k.replace(/^user:\s*/, "").split(/\s+/)));
  return names.has(unit) || names.has(unit.replace(/@[^.]+\./, "@."));
}

export function declaredContainer(declared: Record<string, string>, name: string): boolean {
  return Object.keys(declared).some(k => (k.endsWith("*") ? name.startsWith(k.slice(0, -1)) : k === name));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const host = args[args.indexOf("--host") + 1] as (typeof HOSTS)[number];
  if (!args.includes("--host") || !HOSTS.includes(host)) {
    console.error(`usage: host-purge.ts --host ${HOSTS.join("|")} [--apply]`);
    process.exit(2);
  }
  const apply = args.includes("--apply");
  if (apply && process.getuid?.() !== 0) {
    console.error("host-purge: --apply needs root");
    process.exit(2);
  }
  const rt: Runtime = JSON.parse(
    readFileSync(join(import.meta.dir, "../../../../infra/config/host", host, "runtime.json"), "utf8"),
  );
  if (rt.host !== host) throw new Error(`runtime.json declares host ${rt.host}, not ${host}`);
  const { purge } = rt;
  const tag = apply ? "do" : "plan";

  const act = (label: string, cmd: string[], env: Record<string, string> = {}) => {
    console.log(`${tag}: ${label}`);
    if (!apply) return true;
    const r = run(cmd, env);
    if (!r.ok) console.error(`  failed: ${r.err || r.out}`);
    return r.ok;
  };
  const remove = (path: string) => {
    console.log(`${tag}: rm -rf ${path}`);
    if (apply) rmSync(path, { recursive: true, force: true });
  };

  // 1. Backups: every existing path is archived and verified before anything is removed; a failure aborts the run.
  const dir = join(rt.archive, `host-purge-${new Date().toISOString().slice(0, 10)}`);
  const pending = purge.backup.filter(lexists);
  if (apply && pending.length) mkdirSync(dir, { recursive: true });
  for (const path of pending) {
    const tar = join(dir, archiveName(path));
    if (existsSync(tar) && run(["tar", "-tzf", tar]).ok) {
      console.log(`backup: ${tar} (kept)`);
      continue;
    }
    console.log(`${tag}: backup ${path} -> ${tar}`);
    if (!apply) continue;
    const made = run(["tar", "-czf", tar, "-C", "/", path.replace(/^\/+/, "")]);
    const list = run(["tar", "-tvzf", tar]);
    if (!made.ok || !list.ok || !list.out) {
      rmSync(tar, { force: true });
      console.error(`host-purge: backup of ${path} failed, nothing removed: ${made.err || list.err}`);
      process.exit(1);
    }
    writeFileSync(`${tar}.list`, `${list.out}\n`);
    const sha = new Bun.CryptoHasher("sha256").update(readFileSync(tar)).digest("hex");
    writeFileSync(join(dir, "SHA256SUMS"), `${sha}  ${archiveName(path)}\n`, {
      flag: "a",
    });
  }
  if (apply && existsSync(dir)) run(["chown", "-R", `${rt.user}:${rt.user}`, rt.archive]);

  // 2. systemd units (regular unit files are stopped and disabled first; masks and drop-in dirs are just removed).
  const units = purge.units.filter(u => lexists(join(SYSTEMD, u)));
  for (const u of units) {
    const path = join(SYSTEMD, u);
    if (lstatSync(path).isFile() && /\.(service|timer|socket)$/.test(u))
      act(`systemctl disable --now ${u}`, ["systemctl", "disable", "--now", u]);
    remove(path);
  }
  for (const wants of readdirSync(SYSTEMD).filter(n => /\.(wants|requires)$/.test(n)))
    for (const link of readdirSync(join(SYSTEMD, wants)))
      if (purge.units.includes(link)) remove(join(SYSTEMD, wants, link));
  if (units.length) {
    act("systemctl daemon-reload", ["systemctl", "daemon-reload"]);
    act("systemctl reset-failed", ["systemctl", "reset-failed"]);
  }

  // 3. apt packages still installed or with leftover config (rc).
  const installed = purge.packages.filter(p => {
    const r = run(["dpkg-query", "-W", "-f=${db:Status-Abbrev}", p]);
    return r.ok && r.out !== "" && !r.out.startsWith("un");
  });
  if (installed.length) {
    const apt = { DEBIAN_FRONTEND: "noninteractive" };
    act(`apt-get purge ${installed.join(" ")}`, ["apt-get", "purge", "-y", ...installed], apt);
    act("apt-get autoremove --purge", ["apt-get", "autoremove", "--purge", "-y"], apt);
  }

  // 4. Paths left behind by the packages and the old host services.
  for (const path of purge.paths) if (lexists(path)) remove(path);

  // 5. Binaries: listed names, plus dangling links, `~` backups and `.prev-*` copies in the same directories.
  for (const [binDir, names] of Object.entries(purge.bin)) {
    if (!existsSync(binDir)) continue;
    for (const name of readdirSync(binDir))
      if (names.includes(name) || isStrayBin(binDir, name)) remove(join(binDir, name));
  }

  // 6. Docker images no container uses.
  for (const image of purge.dockerImages) {
    if (!run(["docker", "image", "inspect", image]).ok) continue;
    if (run(["docker", "ps", "-aq", "--filter", `ancestor=${image}`]).out) {
      console.log(`keep: image ${image} (used by a container)`);
      continue;
    }
    act(`docker rmi ${image}`, ["docker", "rmi", image]);
  }

  // 7. Docker volumes: only unused AND empty ones (data volumes such as postgres/redis are never removed).
  const anonymous = run(["docker", "volume", "ls", "-q", "--filter", "dangling=true"])
    .out.split("\n")
    .filter(v => /^[0-9a-f]{64}$/.test(v));
  for (const volume of [...purge.dockerVolumes, ...anonymous]) {
    const inspect = run(["docker", "volume", "inspect", "-f", "{{.Mountpoint}}", volume]);
    if (!inspect.ok) continue;
    const kb = Number(run(["du", "-sk", inspect.out]).out.split(/\s/)[0] ?? Infinity);
    if (run(["docker", "ps", "-aq", "--filter", `volume=${volume}`]).out || !(kb <= EMPTY_VOLUME_KB)) {
      console.log(`keep: volume ${volume} (${kb} KiB or in use)`);
      continue;
    }
    act(`docker volume rm ${volume}`, ["docker", "volume", "rm", volume]);
  }

  // 8. Follow-up commands, as the host user.
  for (const cmd of purge.post) act(cmd, ["runuser", "-u", rt.user, "--", "sh", "-c", cmd]);

  // 9. Drift report: running host units and containers that runtime.json does not declare.
  const active = run([
    "systemctl",
    "list-units",
    "--type=service,timer,socket",
    "--state=active",
    "--no-legend",
    "--plain",
  ])
    .out.split("\n")
    .map(l => l.split(/\s+/)[0] ?? "")
    .filter(u => /^(aphrody|nie)-/.test(u));
  for (const u of active) if (!declaredUnit(rt.native.units, u)) console.log(`drift: host unit ${u} not declared`);
  for (const c of run(["docker", "ps", "--format", "{{.Names}}"]).out.split("\n").filter(Boolean))
    if (!declaredContainer(rt.docker.containers, c)) console.log(`drift: container ${c} not declared`);
}
