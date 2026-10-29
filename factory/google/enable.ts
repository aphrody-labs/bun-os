#!/usr/bin/env bun
// Idempotent `gcloud services enable` recipe for the Google APIs listed in apis.json.
//   bun factory/google/enable.ts            dry run: prints what is enabled and what is missing
//   bun factory/google/enable.ts --apply    enables the missing ones (free; see apis.json note)
//   --project <id>                          override the project (default: apis.json "project")
// Reads only service names; prints no secret. Works around a stale CLOUDSDK_PYTHON by falling
// back to the Python bundled with the Cloud SDK.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

interface Api {
  name: string;
  use: string;
}
interface Recipe {
  project: string;
  apis: Api[];
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const pi = args.indexOf("--project");
const recipe: Recipe = await Bun.file(join(import.meta.dir, "apis.json")).json();
const project = pi >= 0 ? (args[pi + 1] ?? recipe.project) : recipe.project;

function gcloudEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const py = env.CLOUDSDK_PYTHON;
  if (py && !existsSync(py)) {
    const exe = Bun.which("gcloud") ?? "";
    const bundled = join(dirname(dirname(exe)), "platform", "bundledpython", "python.exe");
    if (existsSync(bundled)) env.CLOUDSDK_PYTHON = bundled;
    else delete env.CLOUDSDK_PYTHON;
  }
  env.CLOUDSDK_CORE_DISABLE_PROMPTS = "1";
  return env;
}

async function gcloud(...a: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn([process.platform === "win32" ? "gcloud.cmd" : "gcloud", ...a], {
    env: gcloudEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

const listed = await gcloud("services", "list", "--enabled", "--project", project, "--format=value(config.name)");
if (listed.code !== 0) {
  console.error(
    `cannot list services of ${project}: ${listed.err
      .split("\n")
      .filter(l => !l.startsWith("WARNING"))
      .join(" ")
      .trim()}`,
  );
  process.exit(1);
}
const enabled = new Set(listed.out.split(/\s+/).filter(Boolean));
const missing = recipe.apis.filter(a => !enabled.has(a.name));
console.log(
  `project ${project}: ${enabled.size} APIs enabled, ${recipe.apis.length - missing.length}/${recipe.apis.length} of the recipe present`,
);
for (const a of recipe.apis) console.log(`${enabled.has(a.name) ? "ok     " : "MISSING"} ${a.name}  ${a.use}`);

if (missing.length === 0) {
  console.log("nothing to enable");
  process.exit(0);
}
if (!apply) {
  console.log(`dry run: re-run with --apply to enable ${missing.length} API(s)`);
  process.exit(0);
}
const r = await gcloud("services", "enable", ...missing.map(a => a.name), "--project", project);
if (r.code !== 0) {
  console.error(r.err);
  process.exit(r.code);
}
console.log(`enabled: ${missing.map(a => a.name).join(", ")}`);
