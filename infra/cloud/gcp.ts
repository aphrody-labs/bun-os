#!/usr/bin/env bun
// Idempotent Google Cloud recipe for gcp.json: buckets and Artifact Registry repositories (+ cleanup policies).
//   bun infra/cloud/gcp.ts            dry run: what exists, what would be created
//   bun infra/cloud/gcp.ts --apply    create what is missing
// Uses the authenticated gcloud CLI; prints resource names only, never credentials.
import { join } from "node:path";
import { tmpdir } from "node:os";

interface Bucket {
  name: string;
  location: string;
  storageClass: string;
  uniformAccess: boolean;
  publicAccessPrevention: boolean;
}
interface Repo {
  name: string;
  location: string;
  format: string;
  use: string;
  cleanup: unknown[];
}
interface Recipe {
  project: string;
  buckets: Bucket[];
  artifactRegistry: Repo[];
}

const apply = process.argv.includes("--apply");
const recipe: Recipe = await Bun.file(join(import.meta.dir, "gcp.json")).json();
const exe = process.platform === "win32" ? "gcloud.cmd" : "gcloud";

async function gcloud(...a: string[]) {
  const p = Bun.spawn([exe, ...a, "--project", recipe.project], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1" },
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return {
    code,
    out: out.trim(),
    err: err
      .split("\n")
      .filter(l => !l.startsWith("WARNING"))
      .join(" ")
      .trim(),
  };
}

let failed = false;
const buckets = new Set(
  (await gcloud("storage", "buckets", "list", "--format=value(name)")).out.split(/\s+/).filter(Boolean),
);
for (const b of recipe.buckets) {
  if (buckets.has(b.name)) {
    console.log(`bucket ${b.name}: present`);
    continue;
  }
  if (!apply) {
    console.log(`bucket ${b.name}: missing (--apply creates it)`);
    continue;
  }
  const flags = ["--location", b.location, "--default-storage-class", b.storageClass];
  if (b.uniformAccess) flags.push("--uniform-bucket-level-access");
  if (b.publicAccessPrevention) flags.push("--public-access-prevention");
  const r = await gcloud("storage", "buckets", "create", `gs://${b.name}`, ...flags);
  console.log(`bucket ${b.name}: ${r.code === 0 ? "created" : `failed: ${r.err}`}`);
  failed ||= r.code !== 0;
}

for (const repo of recipe.artifactRegistry) {
  const have = await gcloud(
    "artifacts",
    "repositories",
    "describe",
    repo.name,
    "--location",
    repo.location,
    "--format=value(name)",
  );
  if (have.code !== 0) {
    if (!apply) {
      console.log(`artifact registry ${repo.location}/${repo.name}: missing (--apply creates it)`);
      continue;
    }
    const r = await gcloud(
      "artifacts",
      "repositories",
      "create",
      repo.name,
      "--location",
      repo.location,
      "--repository-format",
      repo.format,
      "--description",
      repo.use,
    );
    console.log(`artifact registry ${repo.location}/${repo.name}: ${r.code === 0 ? "created" : `failed: ${r.err}`}`);
    if (r.code !== 0) {
      failed = true;
      continue;
    }
  } else console.log(`artifact registry ${repo.location}/${repo.name}: present`);
  if (apply && repo.cleanup.length) {
    const policy = join(tmpdir(), `ar-${repo.name}-policy.json`);
    await Bun.write(policy, JSON.stringify(repo.cleanup));
    const r = await gcloud(
      "artifacts",
      "repositories",
      "set-cleanup-policies",
      repo.name,
      "--location",
      repo.location,
      "--policy",
      policy,
      "--no-dry-run",
    );
    console.log(`  cleanup policies: ${r.code === 0 ? "set" : `failed: ${r.err}`}`);
    failed ||= r.code !== 0;
  }
}
process.exit(failed ? 1 : 0);
