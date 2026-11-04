// SPDX-License-Identifier: Apache-2.0
/**
 * Unified Build Pipeline for All Aphrody Bun OS Apps & Frontends
 * Runs type-checking, builds each frontend in apps/, and validates native Rust surfaces.
 * 
 * Usage: bun scripts/build-all-apps.ts
 */

import { $ } from "bun";
import { resolve } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

interface AppBuildResult {
  name: string;
  kind: "bun" | "rust" | "wasm";
  status: "success" | "skipped" | "failed";
  durationMs: number;
  error?: string;
}

const APPS_DIR = resolve("apps");
const results: AppBuildResult[] = [];

console.log("=== Aphrody Bun OS • Unified Apps Build Orchestrator ===");

// 1. Monorepo Quality Gate: bun check
console.log("\n[1/3] Running workspace typecheck (bun check)...");
const t0 = performance.now();
try {
  await $`bun check`.quiet();
  console.log(`  ✓ Typecheck passed in ${(performance.now() - t0).toFixed(1)}ms`);
} catch (err: any) {
  console.error("  ✗ Typecheck failed:", err.message);
  process.exit(1);
}

// 2. Discover and Build Standalone Bun Apps in apps/
console.log("\n[2/3] Building standalone apps under apps/...");
const entries = readdirSync(APPS_DIR);

for (const entry of entries) {
  const appPath = resolve(APPS_DIR, entry);
  if (!statSync(appPath).isDirectory()) continue;

  const pkgJsonPath = resolve(appPath, "package.json");
  const cargoPath = resolve(appPath, "Cargo.toml");

  const start = performance.now();

  if (existsSync(pkgJsonPath)) {
    const pkg = await Bun.file(pkgJsonPath).json().catch(() => null);
    if (pkg?.scripts?.build) {
      console.log(`  Building app: ${entry} (bun run build)...`);
      try {
        await $`bun run build`.cwd(appPath).quiet();
        results.push({
          name: entry,
          kind: "bun",
          status: "success",
          durationMs: performance.now() - start
        });
        console.log(`    ✓ ${entry} built in ${(performance.now() - start).toFixed(1)}ms`);
      } catch (err: any) {
        results.push({
          name: entry,
          kind: "bun",
          status: "failed",
          durationMs: performance.now() - start,
          error: err.message
        });
        console.warn(`    ⚠ ${entry} build failed: ${err.message}`);
      }
    } else {
      results.push({
        name: entry,
        kind: "bun",
        status: "skipped",
        durationMs: performance.now() - start
      });
    }
  } else if (existsSync(cargoPath)) {
    results.push({
      name: entry,
      kind: "rust",
      status: "skipped",
      durationMs: 0
    });
  }
}

// 3. Verify Aphrody WebOS Server (Axum HTTP/3)
console.log("\n[3/3] Validating native Rust web services (aphrody-webos-server)...");
const rustStart = performance.now();
try {
  await $`cargo check -p aphrody-webos-server`.quiet();
  results.push({
    name: "aphrody-webos-server",
    kind: "rust",
    status: "success",
    durationMs: performance.now() - rustStart
  });
  console.log(`  ✓ aphrody-webos-server passed cargo check in ${(performance.now() - rustStart).toFixed(1)}ms`);
} catch (err: any) {
  results.push({
    name: "aphrody-webos-server",
    kind: "rust",
    status: "failed",
    durationMs: performance.now() - rustStart,
    error: err.message
  });
  console.error("  ✗ aphrody-webos-server cargo check failed:", err.message);
}

// Summary Report
console.log("\n================ BUILD SUMMARY ================");
for (const res of results) {
  const icon = res.status === "success" ? "✓" : res.status === "skipped" ? "—" : "✗";
  console.log(`  ${icon} [${res.kind.toUpperCase()}] ${res.name.padEnd(25)} : ${res.status.toUpperCase()} (${res.durationMs.toFixed(1)}ms)`);
}
console.log("===============================================");
