// SPDX-License-Identifier: Apache-2.0
/** Derive validation stages from the active manifests, bottom to top. */
import { basename, join, resolve } from "node:path";
import { firstPartyManifests } from "@aphrody/update/manifests";
const DOMAIN_ORDER = ["bun", "compat", "os", "shell", "interop", "infra", "ui", "web", "google", "ai", "fut", "rg"];
export async function pipelineCatalog(root: string) {
  root = resolve(root);
  const rootManifest = await Bun.file(join(root, "package.json")).json();
  const rootName = rootManifest.name?.replace(/-workspace$/, "");
  const repository = typeof rootName === "string" && /^[a-z0-9-]+$/.test(rootName) ? rootName : basename(root);
  const rootScripts: Record<string, string> = rootManifest.scripts ?? {};
  const isAphrody = repository === "aphrody";
  const stages: {
    id: string;
    parallel: boolean;
    steps: { repo: string; runner?: string; command: string[] }[];
  }[] = [];
  const structureGate = isAphrody
    ? "monorepo:layout"
    : ["check:workspace", "monorepo:layout"].find(name => rootScripts[name]);
  if (structureGate)
    stages.push({
      id: "structure",
      parallel: false,
      steps: [{ repo: repository, command: ["run", structureGate] }],
    });
  const rustSteps = isAphrody
    ? ["check", "clippy", "test"].map(gate => ({
        repo: repository,
        runner: "just",
        command: [gate],
      }))
    : ["check:rust", "test:rust"]
        .filter(gate => rootScripts[gate])
        .map(gate => ({ repo: repository, command: ["run", gate] }));
  if (rustSteps.length)
    stages.push({
      id: "rust-foundation",
      parallel: false,
      steps: rustSteps,
    });
  const groups = new Map<string, { repo: string; command: string[] }[]>();
  const absent: { path: string; missing: string[] }[] = [];
  const manifests = await Promise.all(
    (await firstPartyManifests(root)).map(async path => ({
      path,
      pkg: await Bun.file(join(root, path)).json(),
    })),
  );
  for (const { path, pkg } of manifests) {
    const domain = path.split("/")[1] ?? "other";
    const scripts: Record<string, string> = pkg.scripts ?? {};
    const selected = [["lint"], ["typecheck", "type-check"], ["test"], ["build"]].map(alternatives =>
      alternatives.find(name => scripts[name]),
    );
    absent.push({
      path,
      missing: ["lint", "typecheck", "test", "build"].filter((_, i) => !selected[i]),
    });
    const steps = groups.get(domain) ?? [];
    for (const name of selected)
      if (name)
        steps.push({
          repo: repository,
          command: ["run", "--filter", pkg.name, name],
        });
    groups.set(domain, steps);
  }
  for (const domain of [
    ...DOMAIN_ORDER,
    ...[...groups.keys()].filter(known => !DOMAIN_ORDER.includes(known)).toSorted(),
  ]) {
    const steps = groups.get(domain);
    if (steps?.length) stages.push({ id: `bun-${domain}`, parallel: false, steps });
  }
  return {
    config: {
      schemaVersion: 1,
      name: `${repository}-monorepo-validation`,
      authority: "@aphrody/bun-workspace/automation",
      workspaceRoot: "..",
      stages,
    },
    missingGates: absent.filter(p => p.missing.length),
  };
}
export async function runPipelineCatalog(args: string[]): Promise<number> {
  let root = process.cwd();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i] ?? "";
    else if (args[i] === "--apply") apply = true;
    else if (args[i] === "--help") {
      console.log("Usage: yolo ops pipeline-catalog [--root path] [--apply]");
      return 0;
    } else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const report = await pipelineCatalog(root);
  if (apply) await Bun.write(join(root, "infra/config/pipeline.json"), JSON.stringify(report.config, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        stages: report.config.stages.length,
        steps: report.config.stages.reduce((n, s) => n + s.steps.length, 0),
        missingGates: report.missingGates,
      },
      null,
      2,
    ),
  );
  return 0;
}
if (import.meta.main) process.exit(await runPipelineCatalog(process.argv.slice(2)));
