#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * 3-VPS Parallel Factory Orchestrator for Aphrody Bun OS
 * 
 * Exploits our 3 fleet hosts in parallel:
 *   - vps   : 12 vCPUs, 46 GiB RAM (Heavy builds: cargo workspace, images, kernel)
 *   - bunos :  6 vCPUs, 11 GiB RAM (Worker: packages, frontend apps, wasm, tests)
 *   - prod  :  8 vCPUs, 31 GiB RAM (Arch packaging, desktop PKGBUILDs, system validation)
 * Total compute power: 26 vCPUs, 88 GiB RAM across the WireGuard mesh.
 * 
 * Usage:
 *   bun scripts/fleet-parallel-factory.ts status
 *   bun scripts/fleet-parallel-factory.ts purge-old-builds [--run]
 *   bun scripts/fleet-parallel-factory.ts dispatch [--task <cargo|bun|distro|all>]
 */

import { resolve, join } from "node:path";
import fleetToml from "../infra/fleet/fleet.toml";

interface HostConfig {
  description: string;
  provider?: string;
  os: string;
  roles: string[];
  user?: string;
  mesh_ip: string;
  cpus?: number;
  memory_gib?: number;
  checkout?: string;
  managed?: boolean;
}

interface FleetConfig {
  hosts: Record<string, HostConfig>;
}

const fleet = fleetToml as unknown as FleetConfig;
const FACTORY_HOSTS = ["vps", "bunos", "prod"];

export interface HostMetrics {
  host: string;
  cpus: number;
  memoryGib: number;
  os: string;
  loadAvg: string;
  diskUsed: string;
  diskAvail: string;
  diskPercent: string;
  reclaimableDockerGb: number;
  status: "online" | "unreachable" | "degraded";
}

async function runSsh(host: string, command: string, timeoutMs = 25000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, "bash -s"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(command + "\n");
    await proc.stdin.end();

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
    }, timeoutMs);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    clearTimeout(timer);
    const exitCode = await proc.exited;
    return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: any) {
    return { ok: false, stdout: "", stderr: err.message };
  }
}

export async function probeFleetMetrics(): Promise<HostMetrics[]> {
  const probes = FACTORY_HOSTS.map(async (hostName): Promise<HostMetrics> => {
    const cfg = fleet.hosts[hostName];
    const probeCmd = `
      uptime | awk -F'load average:' '{ print $2 }'
      echo '---DISK---'
      df -h / | tail -n 1
      echo '---DOCKER---'
      docker system df --format '{{.Reclaimable}}' 2>/dev/null || echo '0B'
    `;

    const res = await runSsh(hostName, probeCmd);
    if (!res.ok) {
      return {
        host: hostName,
        cpus: cfg?.cpus ?? 0,
        memoryGib: cfg?.memory_gib ?? 0,
        os: cfg?.os ?? "unknown",
        loadAvg: "N/A",
        diskUsed: "N/A",
        diskAvail: "N/A",
        diskPercent: "N/A",
        reclaimableDockerGb: 0,
        status: "unreachable",
      };
    }

    const sections = res.stdout.split(/---DISK---|---DOCKER---/).map(s => s.trim());
    const loadAvg = sections[0] || "unknown";
    const diskLine = (sections[1] || "").split(/\s+/);
    const diskUsed = diskLine[2] || "unknown";
    const diskAvail = diskLine[3] || "unknown";
    const diskPercent = diskLine[4] || "unknown";

    // Estimate reclaimable docker space
    let dockerReclaimGb = 0;
    if (sections[2]) {
      const matches = sections[2].matchAll(/([\d.]+)\s*([GMK]B)/g);
      for (const m of matches) {
        const val = parseFloat(m[1]);
        const unit = m[2];
        if (unit === "GB") dockerReclaimGb += val;
        else if (unit === "MB") dockerReclaimGb += val / 1024;
      }
    }

    return {
      host: hostName,
      cpus: cfg?.cpus ?? 0,
      memoryGib: cfg?.memory_gib ?? 0,
      os: cfg?.os ?? "unknown",
      loadAvg,
      diskUsed,
      diskAvail,
      diskPercent,
      reclaimableDockerGb: Math.round(dockerReclaimGb * 10) / 10,
      status: "online",
    };
  });

  return Promise.all(probes);
}

export async function purgeHostBuildArtifacts(host: string, execute = false): Promise<string[]> {
  const actions: string[] = [];
  console.log(`\n🧹 [${host}] ${execute ? "Purging" : "Auditing"} stale build artifacts...`);

  // Target commands
  const cleanupScripts = [
    // 1. Docker builder cache & dangling images (prune)
    execute 
      ? `docker system prune -af --volumes 2>/dev/null; docker builder prune -af 2>/dev/null || true`
      : `docker system df 2>/dev/null || true`,
    // 2. Old target directories & intermediate work trees (bun-os and bun-ui builds)
    execute
      ? `rm -rf ~/build/wsl-kernel-work ~/build/docker-cli-work ~/build/bun-ui ~/build/target/bun-ui* ~/build/storage/artifacts/*-work ~/build/storage/targets/photocraft-* /tmp/bun-ui* /tmp/target 2>/dev/null || true`
      : `ls -d ~/build/wsl-kernel-work ~/build/docker-cli-work ~/build/storage/targets/* 2>/dev/null || true`,
    // 3. Clear transient sccache build artifacts if exceeding capacity
    execute
      ? `sccache --cleanup 2>/dev/null || true`
      : `sccache --show-stats 2>/dev/null || true`,
  ];

  for (const script of cleanupScripts) {
    const res = await runSsh(host, script, 35000);
    if (res.ok && res.stdout) {
      actions.push(res.stdout);
    }
  }

  return actions;
}

export async function dispatchParallelFactoryTasks(tasks: {
  vpsTask?: string;
  bunosTask?: string;
  prodTask?: string;
}) {
  console.log("\n⚡ Dispatching Parallel Factory Tasks Across 3 VPS...");
  const t0 = performance.now();

  const jobs = [
    tasks.vpsTask ? runSsh("vps", tasks.vpsTask, 120000).then(r => ({ host: "vps", result: r })) : null,
    tasks.bunosTask ? runSsh("bunos", tasks.bunosTask, 120000).then(r => ({ host: "bunos", result: r })) : null,
    tasks.prodTask ? runSsh("prod", tasks.prodTask, 120000).then(r => ({ host: "prod", result: r })) : null,
  ].filter(Boolean);

  const results = await Promise.all(jobs);
  const duration = ((performance.now() - t0) / 1000).toFixed(1);

  console.log(`\n✅ All factory jobs finished in ${duration}s:`);
  for (const job of results as any[]) {
    const icon = job.result.ok ? "✓" : "✗";
    console.log(`  ${icon} [${job.host}] Exited: ${job.result.ok ? "SUCCESS" : "FAILED"}`);
    if (job.result.stdout) {
      console.log(`    Output snippet: ${job.result.stdout.slice(0, 150).replace(/\n/g, " ")}...`);
    }
    if (!job.result.ok && job.result.stderr) {
      console.warn(`    Error: ${job.result.stderr.slice(0, 200)}`);
    }
  }

  return results;
}

// CLI entry point
if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const command = args[0] || "status";

  console.log("=================================================================");
  console.log("   Aphrody Bun OS • 3-VPS Distributed Parallel Factory");
  console.log("   vps (12c) + bunos (6c) + prod (8c) = 26 vCPUs Mesh Worker Pool");
  console.log("=================================================================");

  if (command === "status") {
    const metrics = await probeFleetMetrics();
    console.table(metrics);
  } else if (command === "purge-old-builds") {
    const run = args.includes("--run");
    for (const host of FACTORY_HOSTS) {
      await purgeHostBuildArtifacts(host, run);
    }
    if (!run) {
      console.log("\n💡 Dry run completed. Pass --run to execute cleanup on the hosts.");
    }
  } else if (command === "dispatch") {
    // Run an example tripartite parallel verification:
    // vps: check rust workspace
    // bunos: check bun apps & packages
    // prod: test arch pacman / system health
    await dispatchParallelFactoryTasks({
      vpsTask: "cd ~/src/bun-os && git status -s && bun --version",
      bunosTask: "cd ~/src/bun-os && bun --version && uptime",
      prodTask: "pacman -V | head -n 1 && uname -r",
    });
  } else {
    console.log(`Unknown command: ${command}`);
    console.log("Available commands: status, purge-old-builds [--run], dispatch");
  }
}
