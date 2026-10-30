#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Bun OS Store repositories (VPS only):
//   bun apps/webos/store/cli.ts build <pacman|apk|flatpak|npm|cargo|android|catalog|all>
//   bun apps/webos/store/cli.ts qualify <format|all>     installs from each served repository in a container
// Output goes to STORE_ROOT (default ~/apps/webos/store), served by nginx (infra/config/host/nginx/snippets/aphrody-store.inc)
// and /api/store/* (store/api.ts). Qualification records STORE_ROOT/qualification.json, shown in the Store.
import { join } from "node:path";
import { FORMATS, context, type Format, type QualResult } from "./common";
import { buildCatalog } from "./catalog";
import type { StoreQualification } from "./types";

if (process.platform !== "linux") throw new Error("The Store repositories are built on the VPS");
const [command, target = "all"] = Bun.argv.slice(2);
const ctx = context();
const dist = Bun.env.WEBOS_DIST ?? join(Bun.env.HOME ?? "/root", "apps/webos/current/dist");
const load = (format: Format) => import(`./${format}`) as Promise<{ build(ctx: typeof ctx): Promise<void>; qualify(ctx: typeof ctx): Promise<QualResult> }>;
const formats = (target === "all" || target === "catalog" ? [...FORMATS] : [target as Format]).filter((f) => FORMATS.includes(f));
if (target !== "all" && target !== "catalog" && !formats.length) throw new Error(`Unknown target ${target}`);

async function catalog() {
  const result = await buildCatalog(ctx, dist);
  await Bun.write(join(ctx.store, "catalog.json"), JSON.stringify(result));
  console.log(`catalog: ${result.apps.length} apps, ${result.sources.map((s) => `${s.id}=${s.count}`).join(" ")}`);
}

if (command === "build") {
  if (target !== "catalog") for (const format of formats) await (await load(format)).build(ctx);
  await catalog();
} else if (command === "qualify") {
  const file = join(ctx.store, "qualification.json");
  const previous = (await Bun.file(file).json().catch(() => undefined)) as StoreQualification | undefined;
  const results = new Map((previous?.results ?? []).map((r) => [r.format, r]));
  for (const format of formats) {
    const result = await (await load(format)).qualify(ctx);
    results.set(format, result);
    console.log(`${format}: ${result.ok ? "pass" : "FAIL"} (${result.steps.map((s) => `${s.ok ? "ok" : "FAIL"} ${s.name}`).join("; ")})`);
    // Persist after every format so the Store shows progress.
    const all = [...results.values()];
    await Bun.write(file, JSON.stringify({ schemaVersion: 1, generated: new Date().toISOString(), ok: all.every((r) => r.ok), results: all } satisfies StoreQualification));
  }
  await catalog();
} else {
  console.error("usage: cli.ts build|qualify <format|catalog|all>");
  process.exit(2);
}
