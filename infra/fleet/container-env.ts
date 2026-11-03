#!/usr/bin/env bun
// Recreate a running Docker container with changed environment variables, keeping everything else (image, network,
// mounts, restart policy, command). Same safe swap as the auto app activator: create the new container, stop and
// rename the old one, start the new one, wait for it to be healthy, roll back on failure. Values are never printed.
//   bun infra/fleet/container-env.ts <container> KEY=VALUE [KEY=VALUE...]
const [name, ...pairs] = Bun.argv.slice(2);
if (!name || pairs.length === 0 || pairs.some(p => !p.includes("="))) {
  console.error("usage: container-env.ts <container> KEY=VALUE...");
  process.exit(2);
}

async function docker(...args: string[]): Promise<string> {
  const p = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(`docker ${args[0]}: ${err.slice(0, 300)}`);
  return out;
}

const [before] = JSON.parse(await docker("inspect", name));
const networks = Object.keys(before.NetworkSettings.Networks);
const env = new Map<string, string>(
  (before.Config.Env as string[]).map(s => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]),
);
for (const p of pairs) env.set(p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1));
const envFile = `/tmp/${name}-${Date.now()}.env`;
await Bun.write(envFile, `${[...env].map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
Bun.spawnSync(["chmod", "600", envFile]);

const args = ["create", "--name", `${name}-next`, "--network", networks[0], "--env-file", envFile];
args.push("--restart", before.HostConfig.RestartPolicy?.Name || "unless-stopped");
for (const m of before.Mounts ?? [])
  args.push(
    "--mount",
    `type=${m.Type},source=${m.Type === "volume" ? m.Name : m.Source},target=${m.Destination}${m.RW ? "" : ",readonly"}`,
  );
for (const g of before.HostConfig.GroupAdd ?? []) args.push("--group-add", g);
if (before.Config.Healthcheck?.Test?.[0] === "NONE") args.push("--no-healthcheck");
if (before.Config.User) args.push("--user", before.Config.User);
if (before.Config.WorkingDir) args.push("--workdir", before.Config.WorkingDir);
for (const [port, binds] of Object.entries(
  (before.HostConfig.PortBindings ?? {}) as Record<string, { HostIp: string; HostPort: string }[]>,
))
  for (const b of binds ?? []) args.push("-p", `${b.HostIp ? `${b.HostIp}:` : ""}${b.HostPort}:${port}`);
if (before.Config.Entrypoint?.length) args.push("--entrypoint", before.Config.Entrypoint.join(" "));
args.push(before.Config.Image, ...(before.Config.Cmd ?? []));

const old = `${name}-before-${Date.now()}`;
try {
  await docker(...args);
} finally {
  await Bun.file(envFile).delete();
}
await docker("stop", name);
await docker("rename", name, old);
await docker("rename", `${name}-next`, name);
try {
  await docker("start", name);
  let healthy = false;
  for (let i = 0; i < 45; i++) {
    const [r] = JSON.parse(await docker("inspect", name));
    if (r.State.Status !== "running") throw new Error("container stopped");
    if (!r.State.Health || r.State.Health.Status === "healthy") {
      healthy = i >= 2 || !r.State.Health;
      if (healthy) break;
    }
    await Bun.sleep(2000);
  }
  if (!healthy) throw new Error("health check failed");
  console.log(
    `${name}: recreated with ${pairs.map(p => p.slice(0, p.indexOf("="))).join(", ")}; previous kept stopped as ${old}`,
  );
} catch (e) {
  await docker("rm", "-f", name);
  await docker("rename", old, name);
  await docker("start", name);
  console.error(`${name}: rolled back (${(e as Error).message})`);
  process.exit(1);
}
