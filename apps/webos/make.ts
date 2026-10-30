// SPDX-License-Identifier: Apache-2.0
// The one WebOS build entry (ADR-002): a small task graph with content-addressed caching.
//
//   bun apps/webos/make.ts [build|app-ui|shell|wasm|craft|deploy|serve] [--force] [args...]
//
// Every task names its inputs as Git paths. The cache key is the Git tree id of each input at HEAD plus a digest of
// uncommitted changes under it, so a task reruns exactly when its sources change and the key costs a few git calls.
// Keys live in build/webos-cache/<task>.json next to the outputs they describe. VPS only (AGENTS.md).
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const cacheDir = join(root, "build/webos-cache");
const appUiDist = resolve(root, Bun.env.BUN_OS_APP_UI_DIST ?? "build/app-ui");
{
  const output = relative(resolve(root, "build"), appUiDist);
  if (
    !output ||
    output === ".." ||
    output.startsWith("../") ||
    isAbsolute(output)
  )
    throw new Error(
      "BUN_OS_APP_UI_DIST must select a dedicated directory under the root build directory.",
    );
}

interface Task {
  /** Git paths whose content decides the cache key; empty means always run (the task caches internally). */
  inputs: string[];
  /** Files that must exist for a cache hit. */
  outputs: string[];
  deps: string[];
  run(args: string[]): string[][];
}

const TASKS: Record<string, Task> = {
  "app-ui": {
    inputs: ["packages", "bun.lock"],
    outputs: [join(appUiDist, "index.html")],
    deps: [],
    run: () => [
      ["packages/app-ui/build.ts", "--base", "/workspace/", "--out", appUiDist],
    ],
  },
  // The shell stages the inventory of the whole repository (/api/inventory), so its key is the whole tree.
  shell: {
    inputs: ["."],
    outputs: [
      "apps/webos/dist/index.html",
      "apps/webos/dist/main.js",
      "apps/webos/dist/registry.json",
    ],
    deps: ["app-ui"],
    run: () => [["apps/webos/build.ts"]],
  },
  build: { inputs: [], outputs: [], deps: ["shell"], run: () => [] },
  // Rust to WebAssembly: build-wasm.ts and build-craft.ts keep their own per-crate up-to-date checks.
  wasm: {
    inputs: [],
    outputs: [],
    deps: [],
    run: (args) => [["apps/webos/build-wasm.ts", ...args]],
  },
  craft: {
    inputs: [],
    outputs: [],
    deps: [],
    run: (args) => [["apps/webos/build-craft.ts", ...args]],
  },
  deploy: {
    inputs: [],
    outputs: [],
    deps: [],
    run: () => [["apps/webos/deploy.ts"]],
  },
  serve: {
    inputs: [],
    outputs: [],
    deps: [],
    run: (args) => [["apps/webos/services/serve.ts", ...args]],
  },
};

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode)
    throw new Error(
      `git ${args.join(" ")}: ${result.stderr.toString().trim()}`,
    );
  return result.stdout.toString().trim();
}

function keyOf(task: Task): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const input of task.inputs) {
    hasher.update(git("rev-parse", `HEAD:${input === "." ? "" : input}`));
    hasher.update(git("diff", "HEAD", "--", input));
    hasher.update(
      git("ls-files", "--others", "--exclude-standard", "--", input),
    );
  }
  hasher.update(Bun.revision);
  return hasher.digest("hex");
}

async function run(
  name: string,
  args: string[],
  force: boolean,
  done: Set<string>,
): Promise<void> {
  if (done.has(name)) return;
  const task = TASKS[name];
  if (!task)
    throw new Error(
      `Unknown task ${name}; tasks: ${Object.keys(TASKS).join(", ")}`,
    );
  for (const dep of task.deps) await run(dep, [], force, done);
  done.add(name);
  const cacheFile = join(cacheDir, `${name}.json`);
  const key = task.inputs.length ? keyOf(task) : "";
  if (key && !force) {
    const cached = (await Bun.file(cacheFile)
      .json()
      .catch(() => ({}))) as { key?: string };
    const present = await Promise.all(
      task.outputs.map((o) => Bun.file(resolve(root, o)).exists()),
    );
    if (cached.key === key && present.every(Boolean)) {
      console.log(`== ${name}: up to date (${key.slice(0, 12)})`);
      return;
    }
  }
  for (const cmd of task.run(args)) {
    console.log(`== ${name}: bun ${cmd.join(" ")}`);
    const started = performance.now();
    const child = Bun.spawn([process.execPath, ...cmd], {
      cwd: root,
      env: { ...Bun.env, BUN_OS_APP_UI_DIST: appUiDist },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await child.exited;
    if (code !== 0) process.exit(code);
    console.log(
      `== ${name}: ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
  }
  if (key) {
    await mkdir(cacheDir, { recursive: true });
    await Bun.write(
      cacheFile,
      JSON.stringify({ key, at: new Date().toISOString() }) + "\n",
    );
  }
}

if (process.platform !== "linux")
  throw new Error("Build WebOS on the Linux VPS factory.");
const argv = Bun.argv.slice(2);
const force = argv.includes("--force");
const [name = "build", ...rest] = argv.filter((a) => a !== "--force");
await run(name, rest, force, new Set());
