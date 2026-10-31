// SPDX-License-Identifier: Apache-2.0
// Build every emulator WebAssembly recipe of recipes.json on the VPS, then index and smoke-qualify them.
//   bun packages/bun-engine/web-emulation/build-all.ts [--tmux] [--only id,id] [--no-smoke] [--qualify]
// --tmux relaunches this script in a detached tmux session (web-emulation) so the long builds survive the SSH session.
// Builds queue on the shared buncc slot (cargo --jobs 4) and wait only while the host is saturated (load > 3x cores).
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { rustCores } from "./build";

const here = import.meta.dir;
const root = resolve(here, "../../..");
const argv = Bun.argv.slice(2);

if (process.platform !== "linux") throw new Error("Run the emulator WebAssembly builds on the VPS (Linux)");

if (argv.includes("--tmux")) {
  const rest = argv
    .filter(a => a !== "--tmux")
    .map(a => `'${a}'`)
    .join(" ");
  const log = join(root, "build/web-emulation/build-all.log");
  const cmd = `mkdir -p '${join(root, "build/web-emulation")}' && cd '${root}' && '${process.execPath}' '${join(here, "build-all.ts")}' ${rest} 2>&1 | tee '${log}'`;
  const result = Bun.spawnSync(["tmux", "new-session", "-d", "-s", "web-emulation", cmd]);
  if (result.exitCode) throw new Error(`tmux failed: ${result.stderr.toString().trim()}`);
  console.log(`started tmux session web-emulation; follow with: tmux attach -t web-emulation (log: ${log})`);
  process.exit(0);
}

interface Recipe {
  id: string;
  kind: "rust" | "qt-emscripten";
  image?: string;
  prepare?: string[];
  build: string[];
  smoke: boolean;
  note?: string;
}
const file = (await Bun.file(join(here, "recipes.json")).json()) as { recipes: Recipe[] };
const onlyArg = argv.indexOf("--only");
const only = onlyArg >= 0 ? new Set(argv[onlyArg + 1]?.split(",")) : undefined;
const recipes = file.recipes.filter(r => !only || only.has(r.id));

// Every Rust core of build.ts needs a recipe so none is silently left out.
for (const id of Object.keys(rustCores))
  if (!file.recipes.some(r => r.id === id)) throw new Error(`rust core ${id} has no recipe in recipes.json`);

async function waitForCapacity() {
  // cargo already queues on the buncc build slot; this only avoids piling a Docker/Qt build onto a saturated host.
  const limit = cpus().length * 12;
  for (let waited = 0; loadavg()[0] > limit; waited += 30) {
    if (waited > 3600) throw new Error(`load stayed above ${limit} for an hour; not starting a build`);
    console.log(`load ${loadavg()[0].toFixed(1)} > ${limit}; waiting`);
    await Bun.sleep(30_000);
  }
}
async function run(label: string, cmd: string[]) {
  console.log(`== ${label}: ${cmd.join(" ")}`);
  const started = Date.now();
  const child = Bun.spawn(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  return { code, seconds: Math.round((Date.now() - started) / 1000) };
}

const report: Record<string, { built: boolean; smoke?: boolean; seconds: number }> = {};
for (const recipe of recipes) {
  await waitForCapacity();
  if (recipe.prepare) await run(`${recipe.id} image`, recipe.prepare);
  const built = await run(recipe.id, [process.execPath, join(here, "build.ts"), ...recipe.build]);
  report[recipe.id] = { built: built.code === 0, seconds: built.seconds };
  if (built.code !== 0) console.log(`recipe ${recipe.id} failed (continuing with the next one)`);
}
await run("index", [process.execPath, join(here, "build.ts"), "index"]);
if (!argv.includes("--no-smoke")) {
  for (const recipe of recipes.filter(r => r.smoke && report[r.id]?.built)) {
    const smoke = await run(`${recipe.id} smoke`, [process.execPath, join(here, "smoke.ts"), recipe.id]);
    report[recipe.id]!.smoke = smoke.code === 0;
  }
  await run("index (qualified)", [process.execPath, join(here, "build.ts"), "index"]);
}
// Publish the cores and free test ROMs to the WebOS objects directory; --qualify then boots each one inside the
// running WebOS (needs the deployed shell with /emulator.html): bun apps/webos/package.json qualify:emulators.
await run("webos publish", [process.execPath, join(here, "qualify-webos.ts"), "--no-run"]);
if (argv.includes("--qualify")) await run("webos qualification", [process.execPath, join(here, "qualify-webos.ts")]);
await Bun.write(join(root, "build/web-emulation/recipes-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (Object.values(report).some(r => !r.built)) process.exitCode = 1;
