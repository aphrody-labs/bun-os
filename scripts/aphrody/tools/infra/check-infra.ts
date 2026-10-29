#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0

// oxlint-disable no-await-in-loop -- sequential file checks: the first missing file ends the run.
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

type A2aPeer = {
  id?: string;
  role?: string;
  transport?: string;
  endpoint?: string;
  authEnv?: string | null;
  rpcPath?: string;
  service?: string;
  status?: string | null;
};

type Route = {
  host?: string;
  service?: string;
  via?: string;
  publicHost?: string;
  paths?: string[];
};

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const yoloRoot = process.env.YOLO_ROOT ?? repo;

function fail(message: string): never {
  throw new Error(message);
}

async function readJson<T>(relative: string): Promise<T> {
  return JSON.parse(await Bun.file(resolve(repo, relative)).text()) as T;
}

export function sensitiveInventoryPath(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  if (/\.(?:example|sample|template)$/i.test(name)) return false;
  return /^(?:\.env($|\.)|.*\.(?:pem|key|p12|pfx|sqlite|db|dump)$)/i.test(name);
}

async function checkSensitiveFiles(): Promise<void> {
  // Check tracked Infra inventory, not protected .env files, caches, model data
  // or node_modules elsewhere in the consolidated monorepo. Never read values.
  const child = Bun.spawn(["git", "ls-files", "-z", "--", "config", "inventory", "systemd", "nginx"], {
    windowsHide: true,
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) fail(`Cannot inspect tracked Infra inventory: ${stderr.trim()}`);
  for (const path of stdout.split("\0").filter(Boolean))
    if (sensitiveInventoryPath(path)) fail(`Sensitive-looking tracked Infra file: ${path}`);
}

function hasOwn(value: object, key: string): boolean {
  return Object.hasOwn(value, key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main(): Promise<void> {
  await checkSensitiveFiles();

  const required = [
    "README.md",
    "tools/aphrody/config/local-ai.json",
    "tools/aphrody/config/local-ai.env.example",
  ];
  const yoloUnits = ["infra/config/host/catalog.json", "infra/config/host/inventory/vps-source.json"];
  for (const relative of yoloUnits) {
    try {
      if (!(await stat(join(yoloRoot, relative))).isFile()) fail(`Missing yolo host file: ${relative}`);
    } catch {
      fail(`Missing yolo host file: ${relative}`);
    }
  }
  for (const relative of required) {
    const path = join(repo, relative);
    try {
      if (!(await stat(path)).isFile()) fail(`Missing required file: ${relative}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Missing required file:")) throw error;
      fail(`Missing required file: ${relative}`);
    }
  }

  await readJson<JsonObject>(join(yoloRoot, "infra/config/host/inventory/vps-source.json"));
  const a2a = await readJson<{
    peers: A2aPeer[];
    protocol: { rpcPath: string; agentCardPath: string };
  }>("tools/aphrody/config/a2a-peers.json");
  const routes = await readJson<{ routes: Route[]; internal: Route[] }>(
    join(yoloRoot, "infra/config/host/nginx/routes.json"),
  );
  const catalog = await readJson<{ services: Array<{ id: string }> }>("infra/config/service-catalog.json");
  const ids = new Set<string>();

  for (const peer of a2a.peers) {
    for (const field of ["id", "role", "transport", "endpoint"] as const) {
      if (!peer[field]) fail(`a2a peer missing ${field}: ${peer.id ?? "<unknown>"}`);
    }

    const id = peer.id!;
    const endpoint = peer.endpoint!;
    const transport = peer.transport!;
    if (ids.has(id)) fail(`duplicate a2a peer: ${id}`);
    ids.add(id);

    if (peer.authEnv && !/^[A-Z][A-Z0-9_]*$/.test(peer.authEnv)) {
      fail(`a2a authEnv must be an env var name: ${id}`);
    }

    if (transport === "https-jsonrpc") {
      const rpcPath = peer.rpcPath ?? a2a.protocol.rpcPath;
      const endpointPattern = new RegExp(`^https://[^/]+${escapeRegExp(rpcPath)}$`);
      if (!endpointPattern.test(endpoint)) fail(`a2a endpoint must end with rpcPath: ${id}`);
      if (!catalog.services.some(service => service.id === peer.service)) {
        fail(`a2a peer service not in catalog: ${id}`);
      }
      // A retired peer keeps its record (the redeploy shape) but its public edge is gone: no live route is required,
      // so the service behind it can be served on loopback only (aphrody-a2a) without a public nginx route.
      if (peer.status === "retired") continue;

      const hostname = new URL(endpoint).hostname;
      const publicRoute = routes.routes.find(route => route.host === hostname);
      if (!publicRoute) fail(`a2a public host missing: ${hostname}`);
      const route =
        publicRoute.service === peer.service
          ? publicRoute
          : routes.internal.find(
              candidate =>
                candidate.service === peer.service &&
                candidate.via === "nginx" &&
                hasOwn(candidate, "publicHost") &&
                candidate.publicHost === hostname,
            );
      const routePaths = route && hasOwn(route, "paths") ? (route.paths ?? []) : [];
      if (
        !route ||
        (routePaths.length > 0 && (!routePaths.includes(rpcPath) || !routePaths.includes(a2a.protocol.agentCardPath)))
      ) {
        fail(`a2a nginx route missing for ${hostname}`);
      }
    } else if (transport === "coord-file") {
      if (endpoint !== `.coord/inbox-from-${id}.jsonl`) {
        fail(`a2a coord endpoint violates convention: ${id}`);
      }
    } else {
      fail(`unknown a2a transport: ${transport}`);
    }
  }

  console.log(`a2a-check: ok (${ids.size} peers)`);

  const generator = join(import.meta.dir, "gen-local-ai-env.ts");
  const child = Bun.spawn(["bun", generator, "--check"], {
    windowsHide: true,
    cwd: repo,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    fail(
      "tools/aphrody/config/local-ai.env.example drifted from tools/aphrody/config/local-ai.json (run bun scripts/aphrody/tools/infra/gen-local-ai-env.ts).",
    );
  }
  console.log("infra-check: ok");
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
