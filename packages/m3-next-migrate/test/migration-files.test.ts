// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateProject } from "../src/migrator";
import { assertMigrationRequirements, migrationRequirements } from "../src/requirements";

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function fixture() {
  directory = await mkdtemp(join(tmpdir(), "m3-migration-files-"));
  const source = join(directory, "source");
  const target = join(directory, "output");
  await mkdir(join(source, "app"), { recursive: true });
  await mkdir(join(source, "public"));
  await writeFile(
    join(source, "app/page.tsx"),
    "import './page.css'; import labels from './labels.json'; export default function Page() { return <h1>{labels.title}</h1>; }",
  );
  await writeFile(join(source, "app/page.css"), "h1 { color: red; }");
  await writeFile(join(source, "app/labels.json"), '{"title":"Hello"}');
  await writeFile(join(source, "public/logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(source, "public/worker.js"), "self.postMessage('ready');");
  await writeFile(join(source, ".env.local"), "PRIVATE_FIXTURE=value");
  await writeFile(join(source, "package.json"), '{"name":"source-only"}');
  await writeFile(join(source, "tsconfig.json"), "{}");
  await writeFile(join(directory, "external.json"), '{"external":true}');
  await symlink(join(directory, "external.json"), join(source, "app/external.json"));
  return { source, target };
}

describe("migrated consumer file graph", () => {
  test("keeps local imports adjacent, public URLs rooted, and protected source files out of output", async () => {
    const { source, target } = await fixture();
    const report = await migrateProject({
      sourceDir: source,
      targetDir: target,
      target: "vite",
      scaffold: false,
    });
    expect(await Bun.file(join(target, "app/page.css")).exists()).toBe(true);
    expect(await Bun.file(join(target, "app/labels.json")).exists()).toBe(true);
    expect(await Bun.file(join(target, "public/logo.svg")).exists()).toBe(true);
    expect(await Bun.file(join(target, "public/worker.js")).exists()).toBe(true);
    expect(await Bun.file(join(target, "public/public/logo.svg")).exists()).toBe(false);
    expect(await Bun.file(join(target, "public/.env.local")).exists()).toBe(false);
    expect(await Bun.file(join(target, "app/external.json")).exists()).toBe(false);
    expect(await Bun.file(join(target, "package.json")).exists()).toBe(false);
    expect(report.skippedFiles).toContain(".env.local");
    expect(report.skippedFiles).toContain("app/external.json");
  });

  test("without scaffolding preserves original source and asset paths", async () => {
    const { source, target } = await fixture();
    await migrateProject({
      sourceDir: source,
      targetDir: target,
      scaffold: false,
    });
    expect(await Bun.file(join(target, "app/page.tsx")).exists()).toBe(true);
    expect(await Bun.file(join(target, "app/page.css")).exists()).toBe(true);
    expect(await Bun.file(join(target, "app/labels.json")).exists()).toBe(true);
    expect(await Bun.file(join(target, "public/logo.svg")).exists()).toBe(true);
  });

  test("outside-owner and unregistered workspace projects fail before any output", async () => {
    const { source, target } = await fixture();
    const outside = join(directory!, "outside");
    await expect(migrateProject({ sourceDir: source, targetDir: outside, target: "vite" })).rejects.toThrow(
      "Aphrody/M3 private owner workspace required",
    );
    expect(await Bun.file(join(outside, "package.json")).exists()).toBe(false);
    await expect(migrateProject({ sourceDir: source, targetDir: target, target: "vite" })).rejects.toThrow(
      "Aphrody/M3 private owner workspace required",
    );
    expect(await Bun.file(join(target, "package.json")).exists()).toBe(false);
  });

  test("source-root aliases resolve in the moved consumer graph", async () => {
    const { source, target } = await fixture();
    await mkdir(join(source, "src/app"), { recursive: true });
    await mkdir(join(source, "src/ui"));
    await writeFile(join(source, "src/ui/title.ts"), 'export const title = "Alias resolved";');
    await writeFile(join(source, "src/ui/style.css"), "h1 { color: blue; }");
    await writeFile(
      join(source, "src/app/page.tsx"),
      'import { title } from "@/ui/title"; import "@/ui/style.css"; export default function Page() { return <h1>{title}</h1>; }',
    );
    await migrateProject({
      sourceDir: source,
      targetDir: target,
      target: "vite",
      scaffold: false,
    });
    const page = join(target, "src/app/page.tsx");
    expect(await Bun.file(page).text()).toContain('from "../ui/title"');
    expect(await Bun.file(page).text()).toContain('import "../ui/style.css"');
    const build = await Bun.build({
      entrypoints: [page],
      target: "browser",
      external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
    });
    expect(build.success).toBe(true);
    expect(build.logs).toHaveLength(0);
  });

  test("configuration and illustrative aliases stay outside transformed imports", async () => {
    const { source, target } = await fixture();
    await writeFile(join(source, "next.config.ts"), 'import fs from "node:fs"; export default {};');
    await writeFile(join(source, "app/title.ts"), 'export const title = "Actual";');
    await writeFile(
      join(source, "app/page.tsx"),
      [
        '// import { absent } from "@/does-not-exist";',
        "const example = \"from '@/illustration-only'\";",
        'const { title } = require("@/app/title");',
        "export default function Page() { return <h1>{title}{example}</h1>; }",
      ].join("\n"),
    );
    const report = await migrateProject({
      sourceDir: source,
      targetDir: target,
      target: "vite",
      scaffold: false,
    });
    const migrated = await Bun.file(join(target, "app/page.tsx")).text();
    expect(migrated).toContain('require("./title")');
    expect(migrated).toContain('from "@/does-not-exist"');
    expect(migrated).toContain("from '@/illustration-only'");
    expect(report.skippedFiles).toContain("next.config.ts");
    expect(report.requirements).toEqual([]);
  });

  test("consumer source without scaffolding migrates and builds", async () => {
    const { source, target } = await fixture();
    await writeFile(
      join(source, "app/page.tsx"),
      'import { createElement } from "react"; export default function Page() { return createElement("h1", null, "Owner"); }',
    );
    await migrateProject({ sourceDir: source, targetDir: target, target: "vite", scaffold: false });
    const build = await Bun.build({
      entrypoints: [join(target, "app/page.tsx")],
      target: "browser",
      external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
    });
    expect(build.success).toBe(true);
    expect(build.logs).toHaveLength(0);
  });

  test("unscaffolded migration preserves imports for the consumer build to resolve", async () => {
    const { source, target } = await fixture();
    await writeFile(join(source, "app/page.tsx"), 'import missing from "./missing"; export default missing;');
    await migrateProject({ sourceDir: source, targetDir: target, target: "vite", scaffold: false });
    expect(await Bun.file(join(target, "app/page.tsx")).text()).toContain('from "./missing"');
    expect(await Bun.file(join(target, "package.json")).exists()).toBe(false);
  });

  test("unscaffolded migration leaves dependency ownership with the consumer", async () => {
    const { source, target } = await fixture();
    await writeFile(
      join(source, "app/page.tsx"),
      'import thing from "unqualified-m3-source-dependency"; export default thing;',
    );
    await migrateProject({ sourceDir: source, targetDir: target, target: "vite", scaffold: false });
    expect(await Bun.file(join(target, "package.json")).exists()).toBe(false);
    await writeFile(
      join(source, "app/page.tsx"),
      'import { createElement } from "react"; export default createElement;',
    );
    await writeFile(join(source, "package.json"), '{"dependencies":{"react":"<1.0.0"}}');
    await migrateProject({ sourceDir: source, targetDir: target, target: "vite", scaffold: false });
    expect(await Bun.file(join(target, "package.json")).exists()).toBe(false);
  });

  test("backend actions and invalid async conversion fail before creating output", async () => {
    const { source, target } = await fixture();
    await writeFile(join(source, "app/actions.ts"), '"use server"; export async function save() { return "backend"; }');
    const action = await Bun.file(join(source, "app/actions.ts")).text();
    expect(() => assertMigrationRequirements(migrationRequirements("app/actions.ts", action))).toThrow(
      "server-action adapter",
    );
    expect(await Bun.file(join(target, "package.json")).exists()).toBe(false);
    const preview = await migrateProject({
      sourceDir: source,
      targetDir: target,
      target: "vite",
      dryRun: true,
    });
    expect(preview.requirements.some(requirement => requirement.capability === "server-action adapter")).toBe(true);
    await rm(join(source, "app/actions.ts"));
    await writeFile(
      join(source, "app/page.tsx"),
      'export default async function Page() { const result = await fetch("/api"); return <h1>{result.status}</h1>; }',
    );
    await expect(
      migrateProject({ sourceDir: source, targetDir: target, target: "vite", scaffold: false }),
    ).rejects.toThrow("transformed syntax is invalid");
    expect(await Bun.file(join(target, "package.json")).exists()).toBe(false);
  });

  test("same-tree and nested destinations fail before altering the source", async () => {
    const { source } = await fixture();
    await Promise.all(
      [source, join(source, "output")].map(target =>
        expect(migrateProject({ sourceDir: source, targetDir: target })).rejects.toThrow("outside the source tree"),
      ),
    );
    expect(await Bun.file(join(source, "output/package.json")).exists()).toBe(false);
    expect(JSON.parse(await Bun.file(join(source, "package.json")).text()).name).toBe("source-only");
  });
});
