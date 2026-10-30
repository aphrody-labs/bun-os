#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Installs the host compose project ~/apps/compose.yaml (infra/config/host/apps/<host>/) and the compose file of every
// app it includes, from the one checkout of its repository (~/src/<repo>). Runs ON the host, from ~/src/aphrody:
//   bun scripts/aphrody/tools/infra/host-apps.ts --host vps|dbfr [--apply]
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hostLayout, type HostLayout } from "@aphrody/yolo-core/src/host/layout.ts";

const REPO = join(import.meta.dir, "..", "..", "..", "..");
export const HOSTS = ["vps", "dbfr"] as const;

/** Source (absolute, in ~/src/<repo>) -> destination on the host. */
export function hostAppFiles(host: (typeof HOSTS)[number], layout: HostLayout, repo = REPO): [string, string][] {
  const files: [string, string][] = [
    [join(repo, "infra/config/host/apps", host, "compose.yaml"), layout.compose],
    [join(repo, "infra/config/host/apps", host, "env"), join(dirname(layout.compose), ".env")],
    [join(repo, "tools/aphrody/config/container/compose.yaml"), join(layout.apps, "aphrody", "compose.yaml")],
  ];
  if (host === "vps") {
    for (const app of ["komodo"]) {
      files.push([
        join(repo, "infra/config/host/apps/vps", app, "compose.yaml"),
        join(layout.apps, app, "compose.yaml"),
      ]);
    }
  }
  if (host === "dbfr") {
    files.push([
      join(layout.src, "bun", "scripts/aphrody/deploy/docker/compose.yaml"),
      join(layout.apps, "aphrody-bun", "compose.yaml"),
    ]);
    files.push(
      [
        join(layout.src, "bun", "scripts/aphrody/deploy/docker/release-compose.yaml"),
        join(layout.apps, "aphrody-bun-release", "compose.yaml"),
      ],
      [
        join(layout.src, "bun", "scripts/aphrody/deploy/docker/bun-release.conf"),
        join(layout.apps, "aphrody-bun-release", "bun-release.conf"),
      ],
      [
        join(repo, "infra/config/host/apps/dbfr/aphrody-site/compose.yaml"),
        join(layout.apps, "aphrody-site", "compose.yaml"),
      ],
    );
    for (const filename of ["bun-prod-runtime.yaml", "bun-services-runtime.yaml"])
      files.push([join(repo, "infra/config/host/apps/dbfr", filename), join(layout.apps, filename)]);
  }
  return files;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const host = args[args.indexOf("--host") + 1] as (typeof HOSTS)[number];
  if (!args.includes("--host") || !HOSTS.includes(host)) {
    console.error(`usage: host-apps.ts --host ${HOSTS.join("|")} [--apply]`);
    process.exit(2);
  }
  const apply = args.includes("--apply");
  const layout = hostLayout(process.env["HOME"] || homedir());
  if (host === "dbfr") {
    const current = Bun.spawnSync(["docker", "exec", "aphrody-gateway-1", "cat", "/etc/nginx/nginx.conf"]);
    if (current.exitCode !== 0) throw new Error("Cannot inspect the existing gateway configuration");
    const include = "    include /etc/nginx/conf.d/*.conf;";
    const added = "    include /etc/aphrody-bun-release/bun-release.conf;";
    let config = current.stdout.toString();
    if (!config.includes(added)) {
      if (config.split(include).length !== 2) throw new Error("Unexpected gateway configuration");
      config = config.replace(include, `${include}\n${added}`);
    }
    const target = join(layout.apps, "aphrody-bun-release", "gateway-nginx.conf");
    console.log(`gateway configuration ${target}: inspected existing includes`);
    if (apply) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(`${target}.new`, config);
      renameSync(`${target}.new`, target);
    }
  }
  for (const [source, destination] of hostAppFiles(host, layout)) {
    const text = readFileSync(source, "utf8");
    const state = !existsSync(destination) ? "new" : readFileSync(destination, "utf8") === text ? "same" : "changed";
    console.log(`${state.padEnd(7)} ${destination} <- ${source}`);
    if (!apply || state === "same") continue;
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(`${destination}.new`, text);
    renameSync(`${destination}.new`, destination);
  }
  if (apply) {
    const check = Bun.spawnSync(["docker", "compose", "-f", layout.compose, "config", "--quiet"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (check.exitCode !== 0) process.exit(1);
    console.log(`${layout.compose}: valid (docker compose -f ${layout.compose} up -d applies it)`);
  }
}
